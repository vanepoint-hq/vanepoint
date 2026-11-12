//! Vanepoint desktop app: hosts the agent, a tray icon, the main window and the overlay.

use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use vanepoint_agent::input::{InputSink, RecordingSink};
use vanepoint_agent::{Agent, AgentConfig, AgentEvent, DisplayRect, PairingView, SinkFactory, StatusView};

#[derive(Clone, Copy)]
struct OverlayGeometry {
    origin: (f64, f64),
    /// Injection-coordinate units per CSS pixel in the overlay.
    units_per_css: f64,
}

struct AppState {
    agent: Option<Agent>,
    error: Option<String>,
    overlay: Mutex<OverlayGeometry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    status: Option<StatusView>,
    error: Option<String>,
    kill_switch: String,
    platform: String,
}

fn kill_shortcut() -> Shortcut {
    if cfg!(target_os = "macos") {
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER), Code::Escape)
    } else {
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT), Code::Escape)
    }
}

fn kill_shortcut_label() -> String {
    if cfg!(target_os = "macos") {
        "⌃⌥⌘ Esc".into()
    } else {
        "Ctrl+Alt+Shift+Esc".into()
    }
}

fn agent(state: &State<AppState>) -> Result<Agent, String> {
    state.agent.clone().ok_or_else(|| state.error.clone().unwrap_or_else(|| "agent not running".into()))
}

#[tauri::command]
fn get_status(state: State<AppState>) -> StatusResponse {
    StatusResponse {
        status: state.agent.as_ref().map(|a| a.status()),
        error: state.error.clone(),
        kill_switch: kill_shortcut_label(),
        platform: std::env::consts::OS.into(),
    }
}

#[tauri::command]
fn open_pairing(state: State<AppState>) -> Result<PairingView, String> {
    Ok(agent(&state)?.open_pairing())
}

#[tauri::command]
fn cancel_pairing(state: State<AppState>) -> Result<(), String> {
    agent(&state)?.cancel_pairing();
    Ok(())
}

#[tauri::command]
fn respond_pairing(state: State<AppState>, request_id: u64, allow: bool) -> Result<bool, String> {
    Ok(agent(&state)?.respond(request_id, allow))
}

#[tauri::command]
fn revoke_device(state: State<AppState>, device_id: String) -> Result<bool, String> {
    Ok(agent(&state)?.revoke(&device_id))
}

#[tauri::command]
fn kill_switch(state: State<AppState>) -> Result<(), String> {
    agent(&state)?.kill_switch();
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Sends the monitor layout to the agent and fits the overlay to the primary display.
///
/// Windows injects physical pixels (the process is per-monitor DPI aware); macOS injects
/// points, so rectangles are divided by each monitor's scale factor there.
fn sync_displays(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let mac = cfg!(target_os = "macos");
    let monitors = win.available_monitors().unwrap_or_default();
    let primary = win.primary_monitor().ok().flatten();
    let rects: Vec<DisplayRect> = monitors
        .iter()
        .map(|m| {
            let s = if mac { m.scale_factor() } else { 1.0 };
            DisplayRect { x: m.position().x as f64 / s, y: m.position().y as f64 / s, w: m.size().width as f64 / s, h: m.size().height as f64 / s }
        })
        .collect();
    let velocity_scale = if mac { 1.0 } else { primary.as_ref().map(|p| p.scale_factor()).unwrap_or(1.0) };
    if let Some(a) = app.state::<AppState>().agent.as_ref() {
        a.set_layout(rects, velocity_scale);
    }
    if let (Some(p), Some(ov)) = (primary, app.get_webview_window("overlay")) {
        let _ = ov.set_position(PhysicalPosition::new(p.position().x, p.position().y));
        let _ = ov.set_size(PhysicalSize::new(p.size().width, p.size().height));
        let s = p.scale_factor();
        let geometry = if mac {
            OverlayGeometry { origin: (p.position().x as f64 / s, p.position().y as f64 / s), units_per_css: 1.0 }
        } else {
            OverlayGeometry { origin: (p.position().x as f64, p.position().y as f64), units_per_css: s }
        };
        *app.state::<AppState>().overlay.lock().unwrap() = geometry;
    }
}

fn set_overlay_visible(app: &AppHandle, visible: bool) {
    if let Some(ov) = app.get_webview_window("overlay") {
        if visible {
            let _ = ov.show();
            let _ = ov.set_ignore_cursor_events(true);
        } else {
            let _ = ov.hide();
        }
    }
}

fn forward(app: &AppHandle, e: AgentEvent) {
    match &e {
        AgentEvent::Laser { active, x, y, style } => {
            let g = *app.state::<AppState>().overlay.lock().unwrap();
            let payload = serde_json::json!({
                "kind": "laser",
                "active": active,
                "x": (x - g.origin.0) / g.units_per_css,
                "y": (y - g.origin.1) / g.units_per_css,
                "style": style,
            });
            let _ = app.emit_to("overlay", "overlay", payload);
            return;
        }
        AgentEvent::Dial { delta_rad, detents } => {
            let _ = app.emit_to("overlay", "overlay", serde_json::json!({ "kind": "dial", "deltaRad": delta_rad, "detents": detents }));
            return;
        }
        AgentEvent::DevicesChanged { devices } => {
            set_overlay_visible(app, devices.iter().any(|d| d.connected));
        }
        AgentEvent::PairingRequest { .. } => show_main(app),
        AgentEvent::Profile { name, .. } => {
            let _ = app.emit_to("overlay", "overlay", serde_json::json!({ "kind": "profile", "name": name }));
        }
        _ => {}
    }
    let _ = app.emit_to("main", "agent-event", &e);
}

fn native_sink() -> SinkFactory {
    Box::new(|| -> Box<dyn InputSink> {
        match vanepoint_agent::input::NativeSink::new() {
            Ok(s) => Box::new(s),
            Err(e) => {
                log::error!("native input unavailable: {e}");
                Box::new(RecordingSink::new(false))
            }
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).try_init();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && *shortcut == kill_shortcut() {
                        if let Some(a) = app.state::<AppState>().agent.as_ref() {
                            a.kill_switch();
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_status, open_pairing, cancel_pairing, respond_pairing, revoke_device, kill_switch])
        .setup(|app| {
            let config = AgentConfig::default();
            let (agent, error) = match tauri::async_runtime::block_on(Agent::start(config, native_sink())) {
                Ok(a) => (Some(a), None),
                Err(e) => {
                    log::error!("agent failed to start: {e:#}");
                    (None, Some(format!("{e:#}")))
                }
            };
            app.manage(AppState { agent: agent.clone(), error, overlay: Mutex::new(OverlayGeometry { origin: (0.0, 0.0), units_per_css: 1.0 }) });

            if let Some(agent) = agent {
                let mut rx = agent.subscribe();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        match rx.recv().await {
                            Ok(e) => forward(&handle, e),
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(_) => break,
                        }
                    }
                });
            }

            sync_displays(app.handle());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    sync_displays(&handle);
                }
            });

            if let Err(e) = app.global_shortcut().register(kill_shortcut()) {
                log::warn!("could not register the kill-switch shortcut: {e}");
            }

            let show = MenuItem::with_id(app, "show", "Show Vanepoint", true, None::<&str>)?;
            let pair = MenuItem::with_id(app, "pair", "Pair a phone…", true, None::<&str>)?;
            let kill = MenuItem::with_id(app, "kill", "Disconnect all (kill switch)", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Vanepoint", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &pair, &PredefinedMenuItem::separator(app)?, &kill, &PredefinedMenuItem::separator(app)?, &quit])?;
            let mut tray = TrayIconBuilder::with_id("vanepoint").tooltip("Vanepoint").menu(&menu).show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => show_main(app),
                "pair" => {
                    show_main(app);
                    let _ = app.emit_to("main", "ui-command", "pair");
                }
                "kill" => {
                    if let Some(a) = app.state::<AppState>().agent.as_ref() {
                        a.kill_switch();
                    }
                }
                "quit" => {
                    if let Some(a) = app.state::<AppState>().agent.as_ref() {
                        a.shutdown();
                    }
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    show_main(tray.app_handle());
                }
            })
            .build(app)?;

            if let Some(main) = app.get_webview_window("main") {
                let w = main.clone();
                main.on_window_event(move |event| {
                    // Closing the window keeps Vanepoint running in the tray.
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Vanepoint");
}
