//! WebSocket server: handshakes, per-session message handling and background tasks.

use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::WebSocketStream;
use vanepoint_input::MouseButton;
use vanepoint_profiles::Step;
use vanepoint_protocol::{
    close, decode, encode, transport_kind, HandshakeReply, HandshakeRequest, Haptic, Message, HANDSHAKE_PAIR, HANDSHAKE_RECONNECT, PROTOCOL_VERSION,
};
use vanepoint_session::{now_secs, Responder, TransportRx, TransportTx, TrustedDevice};

use crate::engine::{EngineCmd, EngineEvent};
use crate::{AgentEvent, Inner, Outbound, SessionHandle};

type Ws = WebSocketStream<TcpStream>;
type WsSink = futures_util::stream::SplitSink<Ws, WsMessage>;
type WsStream = futures_util::stream::SplitStream<Ws>;

fn now_micros() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0)
}

pub(crate) async fn accept_loop(inner: Arc<Inner>, listener: TcpListener) {
    loop {
        if inner.shutdown.load(Ordering::SeqCst) {
            break;
        }
        match listener.accept().await {
            Ok((stream, addr)) => {
                let _ = stream.set_nodelay(true);
                tokio::spawn(handle_connection(inner.clone(), stream, addr));
            }
            Err(e) => {
                inner.log("warn", format!("accept failed: {e}"));
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

async fn close_with(sink: &mut WsSink, code: u16, reason: &str) {
    let frame = CloseFrame { code: CloseCode::from(code), reason: reason.to_string().into() };
    let _ = sink.send(WsMessage::Close(Some(frame))).await;
    let _ = sink.close().await;
}

async fn next_binary(stream: &mut WsStream) -> Option<Vec<u8>> {
    while let Some(msg) = stream.next().await {
        match msg {
            Ok(WsMessage::Binary(b)) => return Some(b.to_vec()),
            Ok(WsMessage::Close(_)) | Err(_) => return None,
            Ok(_) => {}
        }
    }
    None
}

async fn handle_connection(inner: Arc<Inner>, stream: TcpStream, addr: SocketAddr) {
    let ws = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log::debug!("websocket upgrade from {addr} failed: {e}");
            return;
        }
    };
    let (mut sink, mut stream) = ws.split();
    let first = match tokio::time::timeout(Duration::from_secs(10), next_binary(&mut stream)).await {
        Ok(Some(b)) if !b.is_empty() => b,
        _ => return,
    };
    match first[0] {
        HANDSHAKE_PAIR => pair(inner, sink, stream, &first[1..], addr).await,
        HANDSHAKE_RECONNECT => reconnect(inner, sink, stream, &first[1..], addr).await,
        _ => close_with(&mut sink, close::HANDSHAKE_FAILED, "unknown handshake").await,
    }
}

fn reply_bytes(inner: &Inner, accepted: bool, session_id: u64, reason: Option<&str>) -> Vec<u8> {
    serde_json::to_vec(&HandshakeReply {
        accepted,
        desktop_name: inner.config.desktop_name.clone(),
        protocol: PROTOCOL_VERSION,
        session_id: format!("{session_id:016x}"),
        capabilities: vec!["haptics".into(), "profiles".into(), "laser".into()],
        reason: reason.map(str::to_string),
    })
    .unwrap_or_default()
}

async fn pair(inner: Arc<Inner>, mut sink: WsSink, stream: WsStream, msg1: &[u8], addr: SocketAddr) {
    let psk = {
        let p = inner.pairing.lock().unwrap();
        p.as_ref().filter(|w| w.expires_at >= now_secs()).map(|w| w.psk)
    };
    let Some(psk) = psk else {
        inner.log("warn", format!("pairing attempt from {} but no pairing window is open", addr.ip()));
        return close_with(&mut sink, close::PAIRING_CLOSED, "pairing closed").await;
    };
    let mut responder = match Responder::pair(&inner.identity, &psk, transport_kind::WEBSOCKET) {
        Ok(r) => r,
        Err(e) => return inner.log("error", format!("noise setup failed: {e}")),
    };
    // IKpsk1: message 1 only decrypts if the phone knows the current one-time secret.
    let (payload, phone_key) = match responder.read_message1(msg1) {
        Ok(x) => x,
        Err(_) => {
            inner.log("warn", format!("rejected pairing from {}: wrong or expired code", addr.ip()));
            return close_with(&mut sink, close::HANDSHAKE_FAILED, "handshake failed").await;
        }
    };
    let req = serde_json::from_slice::<HandshakeRequest>(&payload)
        .unwrap_or(HandshakeRequest { device_name: String::new(), platform: String::new(), app_version: String::new(), protocol: vec![], capabilities: vec![] })
        .sanitized();
    let request_id = inner.next_id();
    let allowed = if inner.config.auto_approve {
        true
    } else {
        let (tx, rx) = oneshot::channel();
        inner.pending.lock().unwrap().insert(request_id, tx);
        inner.emit(AgentEvent::PairingRequest {
            request_id,
            device_name: req.device_name.clone(),
            platform: req.platform.clone(),
            fingerprint: vanepoint_session::fingerprint(&phone_key),
        });
        let r = tokio::time::timeout(Duration::from_secs(90), rx).await;
        inner.pending.lock().unwrap().remove(&request_id);
        matches!(r, Ok(Ok(true)))
    };
    inner.emit(AgentEvent::PairingResolved { request_id, allowed });
    let reason = (!allowed).then_some("Pairing was declined on the desktop.");
    let (m2, tx, rx) = match responder.write_message2(&reply_bytes(&inner, allowed, request_id, reason)) {
        Ok(x) => x,
        Err(e) => return inner.log("error", format!("handshake failed: {e}")),
    };
    if sink.send(WsMessage::binary(m2)).await.is_err() {
        return;
    }
    if !allowed {
        inner.log("info", format!("declined pairing from {}", req.device_name));
        tokio::time::sleep(Duration::from_millis(200)).await;
        return close_with(&mut sink, close::DENIED, "declined").await;
    }
    let device = {
        let mut t = inner.trust.lock().unwrap();
        let d = t.add(&phone_key, &req.device_name, &req.platform);
        if let Err(e) = t.save() {
            log::error!("could not save trusted devices: {e}");
        }
        d
    };
    if inner.pairing.lock().unwrap().take().is_some() {
        inner.emit(AgentEvent::PairingClosed { reason: "paired".into() });
    }
    inner.log("info", format!("paired {} ({})", device.name, device.id));
    run_session(inner, sink, stream, tx, rx, device, addr).await;
}

async fn reconnect(inner: Arc<Inner>, mut sink: WsSink, stream: WsStream, msg1: &[u8], addr: SocketAddr) {
    let mut responder = match Responder::reconnect(&inner.identity, transport_kind::WEBSOCKET) {
        Ok(r) => r,
        Err(e) => return inner.log("error", format!("noise setup failed: {e}")),
    };
    let (_payload, phone_key) = match responder.read_message1(msg1) {
        Ok(x) => x,
        Err(_) => return close_with(&mut sink, close::HANDSHAKE_FAILED, "handshake failed").await,
    };
    let device = inner.trust.lock().unwrap().find_by_key(&phone_key).cloned();
    let Some(device) = device else {
        inner.log("warn", format!("rejected unknown phone from {}", addr.ip()));
        return close_with(&mut sink, close::NOT_TRUSTED, "not trusted").await;
    };
    let session_id = inner.next_id();
    let (m2, tx, rx) = match responder.write_message2(&reply_bytes(&inner, true, session_id, None)) {
        Ok(x) => x,
        Err(e) => return inner.log("error", format!("handshake failed: {e}")),
    };
    if sink.send(WsMessage::binary(m2)).await.is_err() {
        return;
    }
    {
        let mut t = inner.trust.lock().unwrap();
        t.touch(&device.id);
        let _ = t.save();
    }
    run_session(inner, sink, stream, tx, rx, device, addr).await;
}

async fn writer(mut sink: WsSink, mut tx: TransportTx, mut out: mpsc::UnboundedReceiver<Outbound>) {
    let mut msg_id: u16 = 0;
    let mut ping = tokio::time::interval(Duration::from_secs(1));
    loop {
        let outbound = tokio::select! {
            o = out.recv() => match o { Some(o) => o, None => break },
            _ = ping.tick() => Outbound::Message(Message::Ping { t1: now_micros() }),
        };
        match outbound {
            Outbound::Message(m) => {
                let pt = encode(&m, msg_id, 0);
                msg_id = msg_id.wrapping_add(1);
                let Ok(frame) = tx.seal(&pt) else { break };
                if sink.send(WsMessage::binary(frame)).await.is_err() {
                    break;
                }
            }
            Outbound::Close(code, reason) => {
                close_with(&mut sink, code, &reason).await;
                break;
            }
        }
    }
}

async fn run_session(inner: Arc<Inner>, sink: WsSink, mut stream: WsStream, tx: TransportTx, mut rx: TransportRx, device: TrustedDevice, addr: SocketAddr) {
    let session_id = inner.next_id();
    let (out_tx, out_rx) = mpsc::unbounded_channel();
    inner.sessions.lock().unwrap().insert(session_id, SessionHandle { device_id: device.id.clone(), tx: out_tx.clone() });
    let writer_task = tokio::spawn(writer(sink, tx, out_rx));
    inner.emit(AgentEvent::DeviceConnected { device_id: device.id.clone(), name: device.name.clone(), address: addr.ip().to_string() });
    inner.emit(AgentEvent::DevicesChanged { devices: inner.device_views() });
    let _ = out_tx.send(Outbound::Message(Message::Haptic { pattern: Haptic::Connected as u8, intensity: 255 }));
    let _ = out_tx.send(Outbound::Message(inner.profile_message()));

    let mut reason = "closed".to_string();
    loop {
        let next = tokio::time::timeout(Duration::from_secs(6), stream.next()).await;
        match next {
            Ok(Some(Ok(WsMessage::Binary(frame)))) => {
                let Some(pt) = rx.open(&frame) else { continue };
                let Some(env) = decode(&pt) else { continue };
                if !handle_message(&inner, &device, &out_tx, env.message) {
                    reason = "bye".into();
                    break;
                }
            }
            Ok(Some(Ok(WsMessage::Close(_)))) | Ok(None) => break,
            Ok(Some(Err(_))) => {
                reason = "connection error".into();
                break;
            }
            Ok(Some(Ok(_))) => {}
            Err(_) => {
                reason = "timeout".into();
                break;
            }
        }
        if writer_task.is_finished() {
            break;
        }
    }

    inner.sessions.lock().unwrap().remove(&session_id);
    drop(out_tx);
    let _ = tokio::time::timeout(Duration::from_millis(500), writer_task).await;
    if inner.sessions.lock().unwrap().is_empty() {
        inner.engine.send(EngineCmd::ReleaseAll);
        inner.set_laser(None);
    }
    inner.emit(AgentEvent::DeviceDisconnected { device_id: device.id.clone(), name: device.name.clone(), reason });
    inner.emit(AgentEvent::DevicesChanged { devices: inner.device_views() });
}

fn scale(inner: &Inner) -> f64 {
    *inner.velocity_scale.lock().unwrap()
}

/// Returns false when the phone said goodbye.
fn handle_message(inner: &Arc<Inner>, device: &TrustedDevice, out: &mpsc::UnboundedSender<Outbound>, m: Message) -> bool {
    match m {
        Message::Motion { vx, vy, .. } => {
            let s = scale(inner);
            inner.engine.send(EngineCmd::Velocity { vx: vx as f64 * s, vy: vy as f64 * s });
        }
        Message::Fling { vx, vy, .. } => {
            let s = scale(inner);
            inner.engine.send(EngineCmd::Fling { vx: vx as f64 * s, vy: vy as f64 * s });
        }
        Message::Scroll { dx, dy, .. } => inner.engine.send(EngineCmd::Scroll { dx: dx.clamp(-50.0, 50.0) as f64, dy: dy.clamp(-50.0, 50.0) as f64 }),
        Message::Button { button, down } => {
            if let Some(b) = MouseButton::from_wire(button) {
                inner.engine.send(EngineCmd::Button { button: b, down });
            }
        }
        Message::Dial { delta_rad, detents, .. } => inner.emit(AgentEvent::Dial { delta_rad: delta_rad as f64, detents: detents as i32 }),
        Message::Action { id } => run_action(inner, out, id),
        Message::Control(body) => {
            let op = body.get("op").and_then(|v| v.as_str()).unwrap_or_default();
            match op {
                "bye" => return false,
                "mode" => {
                    let mode = body.get("mode").and_then(|v| v.as_str()).unwrap_or("").chars().take(16).collect::<String>();
                    if mode != "present" && mode != "air" {
                        inner.set_laser(None);
                    }
                    inner.emit(AgentEvent::Mode { device_id: device.id.clone(), mode });
                }
                "laser" => {
                    let on = body.get("on").and_then(|v| v.as_bool()).unwrap_or(false);
                    let style = body.get("style").and_then(|v| v.as_str()).unwrap_or("dot");
                    let style = if style == "spotlight" { "spotlight" } else { "dot" };
                    inner.set_laser(on.then(|| style.to_string()));
                }
                "recenter" => inner.engine.send(EngineCmd::Center),
                "key" => {
                    let chord: Vec<String> = body
                        .get("chord")
                        .and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|k| k.as_str().map(str::to_string)).take(5).collect())
                        .unwrap_or_default();
                    if !chord.is_empty() && chord.iter().all(|k| vanepoint_input::is_known_key(k)) {
                        inner.engine.send(EngineCmd::Chord(chord));
                    }
                }
                "text" => {
                    if let Some(t) = body.get("value").and_then(|v| v.as_str()) {
                        let t: String = t.chars().filter(|c| !c.is_control() || *c == '\n').take(256).collect();
                        if !t.is_empty() {
                            inner.engine.send(EngineCmd::Text(t));
                        }
                    }
                }
                "profile_request" => {
                    let _ = out.send(Outbound::Message(inner.profile_message()));
                }
                _ => {}
            }
        }
        Message::Ping { t1 } => {
            let t = now_micros();
            let _ = out.send(Outbound::Message(Message::Pong { t1, t2: t, t3: t }));
        }
        Message::Pong { t1, t2, t3 } => {
            let t4 = now_micros();
            let rtt = (t4.saturating_sub(t1)).saturating_sub(t3.saturating_sub(t2)) as f64 / 1000.0;
            if rtt < 10_000.0 {
                inner.emit(AgentEvent::Telemetry { device_id: device.id.clone(), rtt_ms: (rtt * 10.0).round() / 10.0 });
            }
        }
        Message::Haptic { .. } | Message::Ack { .. } => {}
    }
    true
}

fn run_action(inner: &Arc<Inner>, out: &mpsc::UnboundedSender<Outbound>, id: u16) {
    let current = inner.current_profile.lock().unwrap().clone();
    let Some(profile) = current.and_then(|pid| inner.profiles.get(&pid).cloned()) else {
        return inner.log("warn", format!("ACTION {id} received but no profile is active"));
    };
    let Some((name, _)) = profile.action_by_index(id) else { return };
    for step in profile.resolve(name) {
        match step {
            Step::Chord(keys) => inner.engine.send(EngineCmd::Chord(keys)),
            Step::Scroll { dx, dy } => inner.engine.send(EngineCmd::Scroll { dx, dy }),
            Step::Click { button, clicks } => {
                if let Some(b) = MouseButton::from_name(&button) {
                    for _ in 0..clicks {
                        inner.engine.send(EngineCmd::Button { button: b, down: true });
                        inner.engine.send(EngineCmd::Button { button: b, down: false });
                    }
                }
            }
            Step::Delay(ms) => inner.engine.send(EngineCmd::Sleep(ms)),
            Step::Builtin(b) => match b.as_str() {
                "laser_toggle" | "spotlight_toggle" => {
                    let style = if b == "spotlight_toggle" { "spotlight" } else { "dot" };
                    let on = inner.laser.lock().unwrap().as_deref() != Some(style);
                    inner.set_laser(on.then(|| style.to_string()));
                }
                "recenter" => inner.engine.send(EngineCmd::Center),
                "mode_air" | "mode_trackpad" | "mode_present" => {
                    let mode = b.trim_start_matches("mode_");
                    if let Some(m) = Message::control(serde_json::json!({ "op": "mode", "mode": mode })) {
                        let _ = out.send(Outbound::Message(m));
                    }
                }
                "timer_reset" => {
                    if let Some(m) = Message::control(serde_json::json!({ "op": "timer_reset" })) {
                        let _ = out.send(Outbound::Message(m));
                    }
                }
                _ => {}
            },
        }
    }
}

/// Forwards engine events: edge haptics to phones, laser positions to the UI.
pub(crate) async fn engine_events(inner: Arc<Inner>, mut rx: mpsc::UnboundedReceiver<EngineEvent>) {
    let mut last_edge = Instant::now() - Duration::from_secs(1);
    while let Some(e) = rx.recv().await {
        match e {
            EngineEvent::Edge => {
                if last_edge.elapsed() > Duration::from_millis(400) {
                    last_edge = Instant::now();
                    inner.broadcast(Message::Haptic { pattern: Haptic::Edge as u8, intensity: 200 });
                    inner.emit(AgentEvent::Edge);
                }
            }
            EngineEvent::Laser { x, y } => {
                let style = inner.laser.lock().unwrap().clone();
                if let Some(style) = style {
                    inner.emit(AgentEvent::Laser { active: true, x, y, style });
                }
            }
            EngineEvent::Error(msg) => inner.log("error", format!("input: {msg}")),
        }
    }
}

/// Closes the pairing window when it expires.
pub(crate) async fn pairing_expiry(inner: Arc<Inner>) {
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tick.tick().await;
        if inner.shutdown.load(Ordering::SeqCst) {
            break;
        }
        let expired = {
            let mut p = inner.pairing.lock().unwrap();
            if p.as_ref().is_some_and(|w| w.expires_at < now_secs()) {
                p.take();
                true
            } else {
                false
            }
        };
        if expired {
            inner.emit(AgentEvent::PairingClosed { reason: "expired".into() });
        }
    }
}

/// Switches profiles when the focused application changes.
pub(crate) async fn watch_focus(inner: Arc<Inner>) {
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    loop {
        tick.tick().await;
        if inner.shutdown.load(Ordering::SeqCst) {
            break;
        }
        let Ok(Some(app)) = tokio::task::spawn_blocking(vanepoint_profiles::active_app).await else { continue };
        let own = app.exe.as_deref().is_some_and(|e| e.to_ascii_lowercase().contains("vanepoint"));
        if own {
            continue;
        }
        let found = inner.profiles.find(&app).map(|p| (p.id.clone(), p.name.clone()));
        let changed = {
            let mut cur = inner.current_profile.lock().unwrap();
            let new_id = found.as_ref().map(|f| f.0.clone());
            if *cur != new_id {
                *cur = new_id;
                true
            } else {
                false
            }
        };
        if changed {
            inner.emit(AgentEvent::Profile { id: found.as_ref().map(|f| f.0.clone()), name: found.map(|f| f.1) });
            inner.broadcast(inner.profile_message());
        }
    }
}
