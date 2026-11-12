# Testing Vanepoint locally

This guide takes you from a fresh clone to moving your computer's cursor with your phone. Every step runs locally, and nothing is published.

## 1. Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 22 or later (the simulator uses Node's built-in WebSocket) | Everything JavaScript (core, simulator, desktop UI, mobile app) |
| Rust | stable, via [rustup](https://rustup.rs) | Desktop agent and app |
| Windows | Visual Studio 2022 Build Tools ("Desktop development with C++") and WebView2 (preinstalled on Windows 10/11) | Building the desktop app |
| macOS | Xcode Command Line Tools | Building the desktop app |
| Phone | [Expo Go](https://expo.dev/go) from the App Store / Play Store | Running the mobile app without building it |

Your phone and computer must be on the **same Wi-Fi network**. Guest and venue networks often block device-to-device traffic, so a home network or your phone's hotspot works best for a first test.

```bash
npm install
```

```bash
npm run mobile:install
```

## 2. Automated tests (no phone needed)

```bash
npm test
```

This runs the TypeScript core tests (protocol, Noise handshake, motion maths, and a full session against an in-memory desktop) and the Rust tests (protocol, session crypto, replay window, trust store, physics, profiles, input).

```bash
npm run e2e
```

The end-to-end test starts the real Rust agent in **dry-run mode**, so your cursor is never touched. It then drives it with the phone simulator and checks 16 behaviours: pairing, encrypted motion, clicks, scrolling, the key allow-list, laser routing, haptics, RTT, reconnection, rejection of unknown phones, and refusal of a reused pairing code.

## 3. Try the agent with the simulator (no phone needed)

In one terminal, start the headless agent in dry-run mode. It prints a pairing QR code and its text:

```bash
npm run agent -- --pair --dry-run
```

In a second terminal, pair the simulator using the `vanepoint://pair?...` text the agent printed. Keep the quotes, because the text contains `&`:

```bash
npm run simulate -- pair "vanepoint://pair?v=1&k=...&e=..."
```

The agent asks `Allow "Vanepoint Simulator"…? [y/N]`. Type `y`. Then run a demo script:

```bash
npm run simulate -- run --script demo
```

The agent prints the input it *would* inject as JSON lines. Leave out `--dry-run` to let it move your real cursor. Press `Ctrl+C` to stop it.

## 4. Run the desktop app

Development mode, with hot reload of the UI:

```bash
npm run desktop:dev
```

Or build the release app and installers:

```bash
npm run desktop:build
```

The installers are written to `target/release/bundle/` (`nsis/Vanepoint_0.1.0_x64-setup.exe` and `msi/…` on Windows, `dmg/…` on macOS).

> **Windows firewall:** the first time Vanepoint listens on the network, Windows asks whether to allow it. Choose **Private networks**, or your phone can't connect.
>
> **macOS:** allow Vanepoint under **System Settings → Privacy & Security → Accessibility**. Without it the pointer won't move.

Closing the window keeps Vanepoint running in the system tray or menu bar. Use the tray menu to quit.

## 5. Run the mobile app on your phone

```bash
npm run mobile:dev
```

1. Expo prints a QR code. On **iPhone**, scan it with the Camera app. On **Android**, scan it from inside Expo Go.
2. The Vanepoint app opens inside Expo Go. Tap **Scan pairing code**.
3. On the computer, click **Pair a phone** in the desktop app and scan its QR code with the Vanepoint app.
4. Approve the phone on the computer.

You're connected. From now on the phone reconnects automatically whenever both devices are on the same network.

| Surface | Try this |
| --- | --- |
| **Present** | Tap the big Next area. Swipe right for Previous. Hold **Laser** and point the phone. Hold **Spot** for a spotlight. Tap the timer to start it. |
| **Air** | Hold the pad and sweep the phone. Hold **Click** to drag. |
| **Pad** | One finger moves. Tap clicks. Two-finger tap right-clicks. Two-finger drag scrolls. |
| **Ball** | Flick to glide across the screen. Touch to stop. |
| **Dial** | Circle one finger around the ring, or twist two fingers. Each step gives a haptic tick. |
| **Controls** | Appears when PowerPoint, Keynote or Premiere Pro is focused, and shows that app's profile buttons. |

If the pointer moves the wrong way, open **Settings → Sensor check** and use the invert switches.

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Phone can't reach the computer | Same Wi-Fi? Allow Vanepoint through the firewall (Private networks). Try your phone's hotspot. Venue networks often isolate clients. |
| "Pairing code has expired" | Codes last 2 minutes and work only once. Click **New code**. |
| Desktop app says it couldn't start | Another Vanepoint (or `vanepoint-headless`) is already using port 47800. Quit it. |
| Pointer doesn't move on macOS | Grant Accessibility permission, then restart Vanepoint. |
| Scrolling goes the wrong way | Toggle **Natural scrolling** in the phone's Settings. |
| Stuck or unwanted input | Press the kill switch: `Ctrl+Alt+Shift+Esc` (Windows) or `⌃⌥⌘ Esc` (macOS). |

## 7. Where your data lives

| Data | Location |
| --- | --- |
| Desktop identity key and trusted phones | `%APPDATA%\Vanepoint\` (Windows) or `~/Library/Application Support/Vanepoint/` (macOS) |
| Custom app profiles | `profiles/` inside that folder (`*.json`, same schema as the built-in ones) |
| Phone identity and paired computer | iOS Keychain / Android Keystore via `expo-secure-store` |

Delete the desktop folder to reset pairing completely.
