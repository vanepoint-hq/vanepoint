# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **v0.1 developer preview implementation.**
  - Desktop app (Tauri 2): tray icon, pairing QR with countdown, approval dialog, paired-device management, kill switch, laser/spotlight/dial overlay; Windows installers (NSIS, MSI).
  - Rust agent crates: protocol, session (Noise `IKpsk1`/`IK`, explicit-nonce transport, replay window, trust store), physics, input, profiles, agent server; `vanepoint-headless` binary with terminal QR.
  - Mobile app (Expo SDK 58): QR pairing, automatic reconnection, Present, Air Pointer, Trackpad, Trackball, Dial and profile Controls surfaces, settings with sensor check, haptics.
  - Shared TypeScript core (protocol, Noise, motion maths), a command-line phone simulator, and a 16-check end-to-end test.
  - Local testing guide (`docs/TESTING.md`) and CI for tests, lint and builds.

### Changed

- Pairing pattern changed from `IKpsk2` to `IKpsk1`, so the desktop verifies the one-time secret before prompting for approval.
- Project renamed from AirDeck to Vanepoint.

- Project concept, architecture, and repository structure.
- Wire protocol specification v0.1 (`docs/PROTOCOL.md`).
- Design system: colour, typography, motion, and haptic vocabulary (`docs/DESIGN_SYSTEM.md`).
- App profile JSON Schema and first-party example profiles.
- Architecture Decision Records 0001–0003.
- Community health files: contributing guide, code of conduct, security policy, privacy policy, governance.
