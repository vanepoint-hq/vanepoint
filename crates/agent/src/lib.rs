//! The Vanepoint desktop agent.
//!
//! Owns the desktop identity and trust list, runs the WebSocket server, performs Noise
//! handshakes, dispatches decrypted input to the [`engine`] thread and reports everything
//! that happens as [`AgentEvent`]s for a UI (the Tauri app) or a terminal (the headless bin).

pub mod engine;
pub mod net;
mod server;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{broadcast, mpsc, oneshot};
use vanepoint_physics::Rect;
use vanepoint_profiles::ProfileSet;
use vanepoint_protocol::{Message, PairingInfo};
use vanepoint_session::{fingerprint, pairing_psk, random_secret, Identity, TrustStore};

pub use engine::{EngineCmd, EngineEvent, SinkFactory};
pub use vanepoint_input as input;
pub use vanepoint_physics::Rect as DisplayRect;
pub use vanepoint_protocol::DEFAULT_PORT;

#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub port: u16,
    pub desktop_name: String,
    pub data_dir: PathBuf,
    /// Approve every pairing request automatically (tests and demos only).
    pub auto_approve: bool,
    pub physics_hz: u32,
    pub pairing_ttl: Duration,
    pub advertise_mdns: bool,
    /// Watch the focused application and switch profiles.
    pub watch_focus: bool,
}

impl AgentConfig {
    pub fn default_data_dir() -> PathBuf {
        dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Vanepoint")
    }

    pub fn default_name() -> String {
        std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "Vanepoint Desktop".into())
    }
}

impl Default for AgentConfig {
    fn default() -> Self {
        AgentConfig {
            port: vanepoint_protocol::DEFAULT_PORT,
            desktop_name: AgentConfig::default_name(),
            data_dir: AgentConfig::default_data_dir(),
            auto_approve: false,
            physics_hz: 120,
            pairing_ttl: Duration::from_secs(120),
            advertise_mdns: true,
            watch_focus: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub paired_at: u64,
    pub last_seen: u64,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingView {
    pub uri: String,
    pub expires_at: u64,
    pub addresses: Vec<String>,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusView {
    pub desktop_name: String,
    pub fingerprint: String,
    pub port: u16,
    pub addresses: Vec<String>,
    pub devices: Vec<DeviceView>,
    pub pairing: Option<PairingView>,
    pub profile: Option<String>,
}

/// Everything the agent reports to its UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AgentEvent {
    Ready { port: u16, addresses: Vec<String>, fingerprint: String, desktop_name: String },
    PairingOpened { uri: String, expires_at: u64, addresses: Vec<String>, port: u16 },
    PairingClosed { reason: String },
    PairingRequest { request_id: u64, device_name: String, platform: String, fingerprint: String },
    PairingResolved { request_id: u64, allowed: bool },
    DevicesChanged { devices: Vec<DeviceView> },
    DeviceConnected { device_id: String, name: String, address: String },
    DeviceDisconnected { device_id: String, name: String, reason: String },
    Telemetry { device_id: String, rtt_ms: f64 },
    Mode { device_id: String, mode: String },
    Profile { id: Option<String>, name: Option<String> },
    Laser { active: bool, x: f64, y: f64, style: String },
    Dial { delta_rad: f64, detents: i32 },
    Edge,
    Log { level: String, message: String },
}

pub(crate) struct PairingWindow {
    psk: [u8; 32],
    expires_at: u64,
    view: PairingView,
}

pub(crate) enum Outbound {
    Message(Message),
    Close(u16, String),
}

pub(crate) struct SessionHandle {
    device_id: String,
    tx: mpsc::UnboundedSender<Outbound>,
}

pub(crate) struct Inner {
    config: AgentConfig,
    identity: Identity,
    fingerprint: String,
    port: u16,
    addresses: Vec<String>,
    trust: Mutex<TrustStore>,
    pairing: Mutex<Option<PairingWindow>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<bool>>>,
    sessions: Mutex<HashMap<u64, SessionHandle>>,
    next_id: AtomicU64,
    events: broadcast::Sender<AgentEvent>,
    engine: engine::EngineHandle,
    profiles: ProfileSet,
    current_profile: Mutex<Option<String>>,
    laser: Mutex<Option<String>>,
    velocity_scale: Mutex<f64>,
    shutdown: AtomicBool,
    _advertiser: Mutex<Option<net::Advertiser>>,
}

impl Inner {
    pub(crate) fn emit(&self, e: AgentEvent) {
        let _ = self.events.send(e);
    }

    pub(crate) fn log(&self, level: &str, message: impl Into<String>) {
        let message = message.into();
        match level {
            "error" => log::error!("{message}"),
            "warn" => log::warn!("{message}"),
            _ => log::info!("{message}"),
        }
        self.emit(AgentEvent::Log { level: level.into(), message });
    }

    pub(crate) fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    pub(crate) fn device_views(&self) -> Vec<DeviceView> {
        let connected: Vec<String> = self.sessions.lock().unwrap().values().map(|s| s.device_id.clone()).collect();
        self.trust
            .lock()
            .unwrap()
            .devices()
            .iter()
            .map(|d| DeviceView {
                id: d.id.clone(),
                name: d.name.clone(),
                platform: d.platform.clone(),
                paired_at: d.paired_at,
                last_seen: d.last_seen,
                connected: connected.contains(&d.id),
            })
            .collect()
    }

    pub(crate) fn broadcast(&self, m: Message) {
        for s in self.sessions.lock().unwrap().values() {
            let _ = s.tx.send(Outbound::Message(m.clone()));
        }
    }

    pub(crate) fn profile_message(&self) -> Message {
        let id = self.current_profile.lock().unwrap().clone();
        let profile = id.and_then(|id| self.profiles.get(&id)).map(|p| p.raw.clone()).unwrap_or(serde_json::Value::Null);
        Message::control(serde_json::json!({ "op": "profile", "profile": profile })).expect("op present")
    }

    pub(crate) fn set_laser(&self, style: Option<String>) {
        let changed = {
            let mut l = self.laser.lock().unwrap();
            let changed = *l != style;
            *l = style.clone();
            changed
        };
        if changed {
            self.engine.send(EngineCmd::Laser(style.is_some()));
            if style.is_none() {
                self.emit(AgentEvent::Laser { active: false, x: 0.0, y: 0.0, style: String::new() });
            }
        }
    }
}

/// Cloneable handle to a running agent.
#[derive(Clone)]
pub struct Agent {
    inner: Arc<Inner>,
}

impl Agent {
    /// Binds the server, loads identity/trust/profiles and spawns the input engine.
    /// Must be called inside a Tokio runtime.
    pub async fn start(config: AgentConfig, sink_factory: SinkFactory) -> anyhow::Result<Agent> {
        std::fs::create_dir_all(&config.data_dir)?;
        let identity = Identity::load_or_create(&config.data_dir.join("identity.key"))?;
        let fp = fingerprint(identity.public_key());
        let trust = TrustStore::load(&config.data_dir.join("trusted-devices.json"));
        let profiles = ProfileSet::load(Some(&config.data_dir.join("profiles")));
        let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port))
            .await
            .map_err(|e| anyhow::anyhow!("could not listen on port {}: {e} (is another Vanepoint running?)", config.port))?;
        let port = listener.local_addr()?.port();
        let addresses = net::local_addresses();
        let (events, _) = broadcast::channel(512);
        let (engine_tx, engine_rx) = mpsc::unbounded_channel();
        let engine = engine::spawn(sink_factory, config.physics_hz, engine_tx);
        let advertiser = if config.advertise_mdns { net::Advertiser::start(&config.desktop_name, port, &fp) } else { None };
        let inner = Arc::new(Inner {
            identity,
            fingerprint: fp.clone(),
            port,
            addresses: addresses.clone(),
            trust: Mutex::new(trust),
            pairing: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            events,
            engine,
            profiles,
            current_profile: Mutex::new(None),
            laser: Mutex::new(None),
            velocity_scale: Mutex::new(1.0),
            shutdown: AtomicBool::new(false),
            _advertiser: Mutex::new(advertiser),
            config,
        });
        tokio::spawn(server::accept_loop(inner.clone(), listener));
        tokio::spawn(server::engine_events(inner.clone(), engine_rx));
        tokio::spawn(server::pairing_expiry(inner.clone()));
        if inner.config.watch_focus {
            tokio::spawn(server::watch_focus(inner.clone()));
        }
        inner.emit(AgentEvent::Ready { port, addresses, fingerprint: fp, desktop_name: inner.config.desktop_name.clone() });
        Ok(Agent { inner })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.inner.events.subscribe()
    }

    pub fn port(&self) -> u16 {
        self.inner.port
    }

    /// Opens (or refreshes) the pairing window and returns the QR contents.
    pub fn open_pairing(&self) -> PairingView {
        let i = &self.inner;
        let secret = random_secret();
        let expires_at = vanepoint_session::now_secs() + i.config.pairing_ttl.as_secs();
        let mut hosts = net::local_addresses();
        if hosts.is_empty() {
            hosts = i.addresses.clone();
        }
        if hosts.is_empty() {
            hosts.push("127.0.0.1".into());
        }
        let info = PairingInfo {
            version: 1,
            desktop_key: *i.identity.public_key(),
            secret,
            hosts: hosts.clone(),
            port: i.port,
            name: i.config.desktop_name.clone(),
            expires_at,
        };
        let view = PairingView { uri: info.to_uri(), expires_at, addresses: hosts, port: i.port };
        *i.pairing.lock().unwrap() = Some(PairingWindow { psk: pairing_psk(&secret), expires_at, view: view.clone() });
        i.emit(AgentEvent::PairingOpened { uri: view.uri.clone(), expires_at, addresses: view.addresses.clone(), port: i.port });
        view
    }

    pub fn cancel_pairing(&self) {
        if self.inner.pairing.lock().unwrap().take().is_some() {
            self.inner.emit(AgentEvent::PairingClosed { reason: "cancelled".into() });
        }
    }

    /// Answers a pending [`AgentEvent::PairingRequest`].
    pub fn respond(&self, request_id: u64, allow: bool) -> bool {
        match self.inner.pending.lock().unwrap().remove(&request_id) {
            Some(tx) => tx.send(allow).is_ok(),
            None => false,
        }
    }

    pub fn devices(&self) -> Vec<DeviceView> {
        self.inner.device_views()
    }

    /// Removes a phone from the trust list and disconnects it.
    pub fn revoke(&self, device_id: &str) -> bool {
        let removed = {
            let mut t = self.inner.trust.lock().unwrap();
            let r = t.remove(device_id);
            if r {
                let _ = t.save();
            }
            r
        };
        for s in self.inner.sessions.lock().unwrap().values().filter(|s| s.device_id == device_id) {
            let _ = s.tx.send(Outbound::Close(vanepoint_protocol::close::REVOKED, "revoked".into()));
        }
        if removed {
            self.inner.emit(AgentEvent::DevicesChanged { devices: self.inner.device_views() });
        }
        removed
    }

    /// Kill switch: drop every session, close pairing, release held buttons.
    pub fn kill_switch(&self) {
        let i = &self.inner;
        i.pairing.lock().unwrap().take();
        for s in i.sessions.lock().unwrap().values() {
            let _ = s.tx.send(Outbound::Close(vanepoint_protocol::close::KILLED, "kill switch".into()));
        }
        for (_, tx) in i.pending.lock().unwrap().drain() {
            let _ = tx.send(false);
        }
        i.set_laser(None);
        i.engine.send(EngineCmd::ReleaseAll);
        i.emit(AgentEvent::PairingClosed { reason: "kill switch".into() });
        i.log("warn", "Kill switch: all sessions closed");
    }

    /// Display layout in injection coordinates, plus the factor that converts the phone's
    /// reference pixels into those coordinates (Windows: monitor scale; macOS: 1).
    pub fn set_layout(&self, displays: Vec<Rect>, velocity_scale: f64) {
        *self.inner.velocity_scale.lock().unwrap() = velocity_scale.clamp(0.25, 8.0);
        self.inner.engine.send(EngineCmd::Layout(displays));
    }

    pub fn status(&self) -> StatusView {
        let i = &self.inner;
        StatusView {
            desktop_name: i.config.desktop_name.clone(),
            fingerprint: i.fingerprint.clone(),
            port: i.port,
            addresses: i.addresses.clone(),
            devices: i.device_views(),
            pairing: i.pairing.lock().unwrap().as_ref().filter(|w| w.expires_at >= vanepoint_session::now_secs()).map(|w| w.view.clone()),
            profile: i.current_profile.lock().unwrap().clone().and_then(|id| i.profiles.get(&id).map(|p| p.name.clone())),
        }
    }

    pub fn shutdown(&self) {
        self.inner.shutdown.store(true, Ordering::SeqCst);
        self.kill_switch();
        self.inner.engine.send(EngineCmd::Shutdown);
    }
}
