# Privacy Policy

**Effective date:** to be set at first public release
**Applies to:** Vanepoint Mobile (iOS, Android) and Vanepoint Desktop (macOS, Windows)

Vanepoint is designed so that your data stays on your devices. This policy explains, in plain language, what the apps access, why, and where that data goes.

## The short version

- Vanepoint **does not have accounts**, servers, or advertising.
- Sensor and touch data travel **only between your phone and your computer**, encrypted, over your local network or Bluetooth.
- Vanepoint collects **no analytics or telemetry by default**.
- Optional AI features are **off by default**, use **your own API key**, and send only what you explicitly choose.

## What the apps access and why

| Data / permission | Platform | Why | Leaves your devices? |
| --- | --- | --- | --- |
| Motion sensors (gyroscope, accelerometer) | Mobile | Air Pointer and gesture input | No — sent only to your paired computer |
| Touch input | Mobile | Trackpad, Trackball, Dial, Present | No — sent only to your paired computer |
| Camera | Mobile | Scanning the pairing QR code. Frames are processed on device and never stored | No |
| Local network | Mobile (iOS "Local Network") | Discovering and connecting to your computer | No |
| Bluetooth | Mobile and desktop | Fallback connection when Wi-Fi blocks local traffic | No |
| Accessibility / input control | Desktop | Moving the cursor and sending key presses on your behalf | No |
| Active application name | Desktop | Switching to the matching app profile | No |
| Device name | Both | Showing which devices are paired | No |

## Data stored on your devices

- **Pairing keys and the trusted-device list.** On the phone they are kept in the iOS Keychain / Android Keystore. On the computer they are kept in your user's app-data folder.
- **Your settings and app profiles**, stored locally.
- **Diagnostics logs**, stored locally, rotated automatically, and never uploaded. You can export them yourself when reporting a bug and review them before sharing.

## Optional AI features

The **AI Profile Generator** (and any future AI feature) is disabled until you turn it on and provide your own Anthropic API key. When you use it:

- Vanepoint sends **only** the content you choose — for example, an application name, a list of keyboard shortcuts you paste, or a screenshot you explicitly attach.
- Requests go directly from your device to Anthropic's API. Vanepoint operates no intermediary server.
- Anthropic's handling of that data is governed by [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy) and the terms attached to your API key.
- Vanepoint never captures your screen in the background and never sends input events to any AI service.

## Crash reports and analytics

None by default. If an opt-in crash reporter is added in the future, it will be off by default, clearly explained on first use, strip personal data, and be documented here before release.

## Children

Vanepoint is a general-purpose utility and does not knowingly collect any personal information from anyone, including children under 13 (or the equivalent minimum age in your country).

## Your rights

Because Vanepoint does not collect personal data on any server, there is nothing for us to access, correct, or delete on your behalf. You can remove all Vanepoint data at any time by unpairing devices and uninstalling the apps. If you are in the EU/EEA or UK, you retain all rights under the GDPR / UK GDPR.

## Changes to this policy

Changes will be published in this file, summarised in the [CHANGELOG](CHANGELOG.md), and shown in the apps when they materially affect you.

## Contact

Questions about privacy can be raised in [GitHub Discussions](https://github.com/vanepoint-hq/vanepoint/discussions) or, for sensitive matters, privately with a maintainer listed in [GOVERNANCE.md](GOVERNANCE.md).
