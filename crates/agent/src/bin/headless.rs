//! `vanepoint-headless` — run the Vanepoint desktop agent without the GUI.
//!
//! Useful for development, CI end-to-end tests and quick trials with a phone:
//!
//! ```text
//! cargo run -p vanepoint-agent --bin vanepoint-headless -- --pair
//! cargo run -p vanepoint-agent --bin vanepoint-headless -- --pair --dry-run --auto-approve --json
//! ```

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::time::Duration;

use clap::Parser;
use vanepoint_agent::input::{InputSink, RecordingSink};
use vanepoint_agent::{Agent, AgentConfig, AgentEvent};

#[derive(Parser, Debug)]
#[command(name = "vanepoint-headless", version, about = "Vanepoint desktop agent without the GUI")]
struct Args {
    /// TCP port for the WebSocket server (0 = pick a free port).
    #[arg(long, default_value_t = vanepoint_agent::DEFAULT_PORT)]
    port: u16,
    /// Name shown on the phone.
    #[arg(long)]
    name: Option<String>,
    /// Where the identity key and trusted devices are stored.
    #[arg(long)]
    data_dir: Option<PathBuf>,
    /// Open a pairing window immediately and print the QR code.
    #[arg(long)]
    pair: bool,
    /// Approve pairing requests without asking (testing only!).
    #[arg(long)]
    auto_approve: bool,
    /// Record input as JSON instead of moving the real cursor.
    #[arg(long)]
    dry_run: bool,
    /// Print every agent event as a JSON line on stdout.
    #[arg(long)]
    json: bool,
    /// Physics/injection rate in Hz.
    #[arg(long, default_value_t = 120)]
    hz: u32,
    /// Do not watch the focused application for profile switching.
    #[arg(long)]
    no_focus: bool,
    /// Address to advertise in the pairing code (repeatable). Defaults to this machine's LAN addresses.
    #[arg(long = "host")]
    hosts: Vec<String>,
}

fn print_qr(uri: &str) {
    match qrcode::QrCode::new(uri.as_bytes()) {
        Ok(code) => {
            let art = code
                .render::<qrcode::render::unicode::Dense1x2>()
                .dark_color(qrcode::render::unicode::Dense1x2::Light)
                .light_color(qrcode::render::unicode::Dense1x2::Dark)
                .quiet_zone(true)
                .build();
            eprintln!("{art}");
        }
        Err(e) => eprintln!("(could not render QR: {e})"),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).target(env_logger::Target::Stderr).init();
    let args = Args::parse();
    let config = AgentConfig {
        port: args.port,
        desktop_name: args.name.clone().unwrap_or_else(AgentConfig::default_name),
        data_dir: args.data_dir.clone().unwrap_or_else(AgentConfig::default_data_dir),
        auto_approve: args.auto_approve,
        physics_hz: args.hz,
        watch_focus: !args.no_focus,
        advertise_hosts: (!args.hosts.is_empty()).then(|| args.hosts.clone()),
        ..AgentConfig::default()
    };
    let dry = args.dry_run;
    let factory: vanepoint_agent::SinkFactory = Box::new(move || -> Box<dyn InputSink> {
        if dry {
            return Box::new(RecordingSink::new(true));
        }
        #[cfg(feature = "native")]
        match vanepoint_agent::input::NativeSink::new() {
            Ok(s) => return Box::new(s),
            Err(e) => log::error!("native input unavailable ({e}); recording instead"),
        }
        Box::new(RecordingSink::new(true))
    });

    let agent = Agent::start(config, factory).await?;
    let mut events = agent.subscribe();
    let status = agent.status();
    eprintln!("Vanepoint agent \"{}\" listening on port {} ({})", status.desktop_name, status.port, status.addresses.join(", "));
    eprintln!("Desktop key fingerprint: {}", status.fingerprint);
    if args.json {
        println!("{}", serde_json::to_string(&serde_json::json!({ "type": "status", "status": status }))?);
    }
    if args.pair {
        let view = agent.open_pairing();
        if args.json {
            println!("{}", serde_json::to_string(&serde_json::json!({ "type": "pairingOpened", "uri": view.uri, "expiresAt": view.expires_at }))?);
        }
        eprintln!("\nScan this code with the Vanepoint app (expires in 2 minutes):");
        print_qr(&view.uri);
        eprintln!("{}\n", view.uri);
    }

    // stdin answers approval prompts.
    let (answer_tx, mut answer_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if answer_tx.send(line).is_err() {
                break;
            }
        }
    });

    let ctrl_c = tokio::signal::ctrl_c();
    tokio::pin!(ctrl_c);
    loop {
        tokio::select! {
            _ = &mut ctrl_c => break,
            e = events.recv() => {
                let Ok(e) = e else { continue };
                if args.json {
                    println!("{}", serde_json::to_string(&e)?);
                    let _ = std::io::stdout().flush();
                }
                match &e {
                    AgentEvent::PairingRequest { request_id, device_name, platform, fingerprint } => {
                        if !args.auto_approve {
                            eprint!("Allow \"{device_name}\" ({platform}, {fingerprint}) to control this computer? [y/N] ");
                            let _ = std::io::stderr().flush();
                            let answer = tokio::time::timeout(Duration::from_secs(85), answer_rx.recv()).await.ok().flatten().unwrap_or_default();
                            agent.respond(*request_id, matches!(answer.trim(), "y" | "Y" | "yes"));
                        }
                    }
                    AgentEvent::DeviceConnected { name, address, .. } => eprintln!("● {name} connected from {address}"),
                    AgentEvent::DeviceDisconnected { name, reason, .. } => eprintln!("○ {name} disconnected ({reason})"),
                    AgentEvent::PairingClosed { reason } => eprintln!("pairing window closed: {reason}"),
                    AgentEvent::Profile { name, .. } => eprintln!("profile: {}", name.as_deref().unwrap_or("none")),
                    _ => {}
                }
            }
        }
    }
    agent.shutdown();
    tokio::time::sleep(Duration::from_millis(200)).await;
    Ok(())
}
