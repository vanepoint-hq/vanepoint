# 0001. Native apps instead of a browser client

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** project lead

## Context

The first concept for Vanepoint was a progressive web app (PWA). The phone would open a URL from a QR code and talk to a Python agent over WebSockets. Prototyping that design surfaced hard platform limits:

- **Sensor access in iOS Safari** requires a secure context (HTTPS) and a user-gesture permission prompt. On a local network, HTTPS means either a self-signed certificate, which brings warnings and unreliable `wss://` support, or installing a CA profile, which defeats the "zero install" premise.
- **No haptics on iOS:** Safari does not implement the Vibration API, so one of Vanepoint's core features would be missing on iPhones.
- **Lifecycle:** browser tabs are suspended when the screen locks. A web page cannot reliably keep the session alive or reconnect in the background.
- **Bluetooth:** iOS Safari does not support Web Bluetooth, so there is no fallback when venue Wi-Fi isolates clients.
- **Feel:** browser touch handling and animation compete with the main thread, which makes 120 Hz, jitter-free interaction hard to guarantee.

## Decision

Build **native apps**:

- **Mobile:** React Native with Expo. v0.1 sticks to modules bundled in Expo Go so contributors can run it instantly. A development build adds Reanimated/Skia UI-thread gestures and native modules (high-rate sensors, custom haptics, BLE peripheral).
- **Desktop:** Tauri 2, with a Rust core for networking, crypto, and input injection, and a React UI for the tray, onboarding, and overlay.

## Alternatives considered

| Option | Why not |
| --- | --- |
| PWA + Python agent | Platform limits above; Python is also hard to package and sign for macOS permissions |
| Flutter (mobile) | Excellent UI, but no code sharing with the desktop's web-technology UI and design tokens |
| Fully native (Swift + Kotlin + Swift/C#) | Best possible feel, but three or four codebases for a small team |
| Electron (desktop) | Installers of 150 MB or more, higher idle memory; Tauri's Rust core is a better fit for low-level input and networking |

## Consequences

- ✅ Real haptics, background-safe sessions, BLE fallback, and no certificate problems.
- ✅ A signed desktop app bundle owns the macOS Accessibility permission, which makes onboarding clearer.
- ⚠️ Users must install two apps. Distribution goes through the App Store, Play Store, and signed desktop installers, which brings review and signing work.
- ⚠️ iOS builds use EAS cloud builds, and macOS desktop builds need a Mac or a CI macOS runner.
- ⚠️ "Zero install" is no longer a selling point. The pitch becomes **"feels like dedicated hardware."**
