# Roadmap

Vanepoint ships in phases. Each phase has **exit criteria** — a phase is done when the criteria are met and measured, not when the features merely exist.

Progress is tracked on the [project board](https://github.com/vanepoint-hq/vanepoint/projects) and in [milestones](https://github.com/vanepoint-hq/vanepoint/milestones).

---

## Phase 0 — Latency spike

**Goal:** prove the core loop feels physical before building any UI.

- [x] Tauri agent: WebSocket server, mDNS advertisement, cursor injection (macOS `CGEvent`, Windows `SendInput`)
- [x] Expo app: device-motion `rotationRate` → pointing frame → 1€ filter → WebSocket
- [x] Round-trip-time telemetry on both ends (clock-offset estimation still to do)
- [ ] Latency harness: 10,000-sample runs on three network types (home router, enterprise AP, laptop hotspot)

### Exit criteria

- Wi-Fi motion-to-injection **median ≤ 15 ms, p95 ≤ 30 ms** on a consumer router
- Jitter at rest **< 0.5 px RMS** at default gain
- Results and raw logs published in [`docs/benchmarks/`](docs/benchmarks/)

## Phase 1 — Presenter MVP

**Goal:** a presenter can install both apps and run a talk without touching the laptop.

- [x] QR pairing with Noise `IKpsk1`; trusted-device list; revocation
- [x] Automatic reconnection and keep-awake while connected
- [x] Air Pointer (roll-invariant mapping, clutch, recenter, pointer acceleration)
- [x] Trackpad (tap, two-finger scroll, right-click)
- [x] Present mode (Next/Previous, timer, laser and spotlight overlay)
- [x] Haptic vocabulary v1 (click, edge bump, connection alerts) via `expo-haptics`
- [x] Desktop tray app with pairing, approvals and devices (onboarding wizard and permission deep links still to do)
- [x] Kill switch hotkey

### Exit criteria

- First-run pairing including OS permissions in **under 60 seconds** for 8 of 10 test users
- No session drop during a 30-minute talk on a home network
- Accessibility audit passes (VoiceOver/TalkBack labels, Dynamic Type, contrast)

## Phase 2 — Precision & reliability

**Goal:** creative professionals use Vanepoint as a daily controller; conference Wi-Fi is no longer a blocker.

- [x] Inertia Trackball with desktop-side physics
- [x] Rotary Dial with haptic detents and configurable step size
- [ ] Bluetooth LE transport (phone as GATT peripheral, desktop as central)
- [ ] UDP datagram transport with explicit nonces and replay window
- [ ] Automatic transport selection and seamless hand-over
- [x] App profile engine + first-party profiles (PowerPoint, Keynote, Premiere Pro); Google Slides, DaVinci Resolve, Figma, VS Code still to do

### Exit criteria

- BLE motion-to-injection **p95 ≤ 45 ms**
- Transport hand-over without a visible cursor jump
- ISO 9241-411 pointing study completed (paper Section XI)

## Phase 3 — Intelligence & ecosystem

**Goal:** anyone can add an app in minutes.

- [ ] AI Profile Generator (bring-your-own-key, schema-constrained output, review screen)
- [ ] Gesture Pad with on-device recognition and user-trainable templates
- [ ] Community profile registry with signed profiles
- [ ] Linux desktop support (X11 and Wayland via `libei` where available)

### Exit criteria

- A generated profile passes schema validation on the first attempt for ≥ 90% of a 50-app benchmark set
- Profile registry has 25+ community profiles

---

## Not planned

To keep Vanepoint focused, these are explicitly **out of scope** for now: screen mirroring, file transfer, remote access over the internet, and running arbitrary shell commands from the phone.
