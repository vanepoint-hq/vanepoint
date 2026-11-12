//! The input engine: a dedicated thread that owns the OS input sink and the physics
//! integrator, stepping at the display rate (see docs/ARCHITECTURE.md, "The input path").
//!
//! Running on its own thread keeps platform input APIs (which are not always `Send`) off the
//! async runtime and gives the integrator a steady clock independent of network jitter.

use std::collections::HashSet;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use tokio::sync::mpsc::UnboundedSender;
use vanepoint_input::{InputSink, MouseButton};
use vanepoint_physics::{Integrator, Layout, PhysicsConfig, Rect};

pub type SinkFactory = Box<dyn FnOnce() -> Box<dyn InputSink> + Send>;

#[derive(Debug)]
pub enum EngineCmd {
    Velocity { vx: f64, vy: f64 },
    Fling { vx: f64, vy: f64 },
    Stop,
    Button { button: MouseButton, down: bool },
    Scroll { dx: f64, dy: f64 },
    Chord(Vec<String>),
    Text(String),
    Sleep(u64),
    Layout(Vec<Rect>),
    Laser(bool),
    Center,
    ReleaseAll,
    Shutdown,
}

#[derive(Debug, Clone, PartialEq)]
pub enum EngineEvent {
    Edge,
    Laser { x: f64, y: f64 },
    Error(String),
}

#[derive(Clone)]
pub struct EngineHandle {
    tx: Sender<EngineCmd>,
}

impl EngineHandle {
    pub fn send(&self, cmd: EngineCmd) {
        let _ = self.tx.send(cmd);
    }
}

pub fn spawn(factory: SinkFactory, hz: u32, events: UnboundedSender<EngineEvent>) -> EngineHandle {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new().name("vanepoint-input".into()).spawn(move || run(factory, hz.clamp(30, 500), rx, events)).expect("spawn input thread");
    EngineHandle { tx }
}

struct State {
    sink: Box<dyn InputSink>,
    layout: Layout,
    layout_from_backend: bool,
    cursor: Integrator,
    laser: Integrator,
    laser_on: bool,
    buttons: HashSet<MouseButtonKey>,
    scroll_acc: (f64, f64),
    last_laser_emit: Instant,
}

#[derive(Hash, PartialEq, Eq, Clone, Copy)]
struct MouseButtonKey(u8);

fn key_of(b: MouseButton) -> MouseButtonKey {
    MouseButtonKey(match b {
        MouseButton::Left => 0,
        MouseButton::Right => 1,
        MouseButton::Middle => 2,
    })
}

fn button_of(k: MouseButtonKey) -> MouseButton {
    match k.0 {
        0 => MouseButton::Left,
        1 => MouseButton::Right,
        _ => MouseButton::Middle,
    }
}

fn run(factory: SinkFactory, hz: u32, rx: Receiver<EngineCmd>, events: UnboundedSender<EngineEvent>) {
    let mut sink = factory();
    let (layout, from_backend) = match sink.display_size() {
        Some((w, h)) if w > 0.0 && h > 0.0 => (Layout::new(vec![Rect { x: 0.0, y: 0.0, w, h }]), true),
        _ => (Layout::default(), true),
    };
    let start_pos = sink.cursor_position().unwrap_or_else(|| layout.primary_center());
    let mut s = State {
        sink,
        cursor: Integrator::new(start_pos, PhysicsConfig::default()),
        laser: Integrator::new(start_pos, PhysicsConfig::default()),
        layout,
        layout_from_backend: from_backend,
        laser_on: false,
        buttons: HashSet::new(),
        scroll_acc: (0.0, 0.0),
        last_laser_emit: Instant::now(),
    };
    let epoch = Instant::now();
    let tick = Duration::from_secs_f64(1.0 / hz as f64);
    let mut last = epoch.elapsed().as_secs_f64();
    loop {
        let now = epoch.elapsed().as_secs_f64();
        let active = s.cursor.is_moving(now) || (s.laser_on && s.laser.is_moving(now));
        // Idle: block until a command arrives (no busy loop). Active: drain and step.
        let first = if active {
            match rx.try_recv() {
                Ok(c) => Some(c),
                Err(mpsc::TryRecvError::Empty) => None,
                Err(mpsc::TryRecvError::Disconnected) => break,
            }
        } else {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(c) => Some(c),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        };
        let mut shutdown = false;
        if let Some(c) = first {
            shutdown |= handle(&mut s, c, epoch, &events);
            while let Ok(c) = rx.try_recv() {
                shutdown |= handle(&mut s, c, epoch, &events);
            }
        }
        if shutdown {
            release_all(&mut s);
            break;
        }
        let now = epoch.elapsed().as_secs_f64();
        let dt = (now - last).max(0.0);
        last = now;
        if s.laser_on {
            let step = s.laser.step(now, dt, &s.layout);
            if step.moved && s.last_laser_emit.elapsed() >= Duration::from_millis(14) {
                s.last_laser_emit = Instant::now();
                let _ = events.send(EngineEvent::Laser { x: step.position.0, y: step.position.1 });
            }
        } else {
            let step = s.cursor.step(now, dt, &s.layout);
            if step.moved {
                if let Err(e) = s.sink.move_to(step.position.0, step.position.1) {
                    let _ = events.send(EngineEvent::Error(e.to_string()));
                }
            }
            if step.edge {
                let _ = events.send(EngineEvent::Edge);
            }
        }
        if s.cursor.is_moving(now) || (s.laser_on && s.laser.is_moving(now)) {
            let elapsed = epoch.elapsed().as_secs_f64() - now;
            let remaining = tick.as_secs_f64() - elapsed;
            if remaining > 0.0 {
                std::thread::sleep(Duration::from_secs_f64(remaining));
            }
        }
    }
}

/// Returns true on shutdown.
fn handle(s: &mut State, cmd: EngineCmd, epoch: Instant, events: &UnboundedSender<EngineEvent>) -> bool {
    let now = epoch.elapsed().as_secs_f64();
    let report = |r: vanepoint_input::Result<()>| {
        if let Err(e) = r {
            let _ = events.send(EngineEvent::Error(e.to_string()));
        }
    };
    match cmd {
        EngineCmd::Velocity { vx, vy } => {
            if s.laser_on {
                s.laser.set_velocity(vx, vy, now);
            } else {
                if !s.cursor.is_moving(now) {
                    // Motion is starting: pick up wherever the real cursor is now.
                    if let Some(p) = s.sink.cursor_position() {
                        s.cursor.set_position(s.layout.clamp(p).0);
                    }
                }
                s.cursor.set_velocity(vx, vy, now);
            }
        }
        EngineCmd::Fling { vx, vy } => {
            if !s.laser_on {
                if !s.cursor.is_moving(now) {
                    if let Some(p) = s.sink.cursor_position() {
                        s.cursor.set_position(s.layout.clamp(p).0);
                    }
                }
                s.cursor.fling(vx, vy);
            }
        }
        EngineCmd::Stop => {
            s.cursor.stop();
            s.laser.stop();
        }
        EngineCmd::Button { button, down } => {
            if down {
                s.buttons.insert(key_of(button));
            } else {
                s.buttons.remove(&key_of(button));
            }
            report(s.sink.button(button, down));
        }
        EngineCmd::Scroll { dx, dy } => {
            s.scroll_acc.0 += dx;
            s.scroll_acc.1 += dy;
            let (ix, iy) = (s.scroll_acc.0.trunc(), s.scroll_acc.1.trunc());
            if ix != 0.0 || iy != 0.0 {
                s.scroll_acc.0 -= ix;
                s.scroll_acc.1 -= iy;
                report(s.sink.scroll(ix as i32, iy as i32));
            }
        }
        EngineCmd::Chord(keys) => report(s.sink.chord(&keys)),
        EngineCmd::Text(t) => report(s.sink.text(&t)),
        EngineCmd::Sleep(ms) => std::thread::sleep(Duration::from_millis(ms.min(1000))),
        EngineCmd::Layout(rects) => {
            if !rects.is_empty() {
                s.layout = Layout::new(rects);
                s.layout_from_backend = false;
            }
        }
        EngineCmd::Laser(on) => {
            if on && !s.laser_on {
                let p = s.sink.cursor_position().unwrap_or_else(|| s.cursor.position());
                s.laser.set_position(s.layout.clamp(p).0);
                s.laser.stop();
                let pos = s.laser.position();
                let _ = events.send(EngineEvent::Laser { x: pos.0, y: pos.1 });
            }
            s.laser_on = on;
            s.cursor.stop();
        }
        EngineCmd::Center => {
            let c = s.layout.primary_center();
            s.cursor.stop();
            s.cursor.set_position(c);
            if s.laser_on {
                s.laser.set_position(c);
                let _ = events.send(EngineEvent::Laser { x: c.0, y: c.1 });
            } else {
                report(s.sink.move_to(c.0, c.1));
            }
        }
        EngineCmd::ReleaseAll => release_all(s),
        EngineCmd::Shutdown => return true,
    }
    false
}

fn release_all(s: &mut State) {
    s.cursor.stop();
    s.laser.stop();
    for b in s.buttons.drain().collect::<Vec<_>>() {
        let _ = s.sink.button(button_of(b), false);
    }
    s.laser_on = false;
}
