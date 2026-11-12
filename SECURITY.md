# Security Policy

Vanepoint injects keyboard and mouse input into your computer. A flaw in Vanepoint can be equivalent to someone else typing on your keyboard, so we treat security as a core feature, not an afterthought.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public issues, discussions, or pull requests.**

Report privately through GitHub's **[private vulnerability reporting](https://github.com/vanepoint-hq/vanepoint/security/advisories/new)** (Security tab → *Report a vulnerability*). Include:

- the affected component (mobile, desktop, protocol, transport, profiles),
- version or commit hash, OS and device,
- steps to reproduce or a proof of concept,
- the impact you believe it has.

### What to expect

| Step | Target time |
| --- | --- |
| Acknowledgement of your report | 3 business days |
| Initial assessment and severity rating | 7 days |
| Fix or mitigation for critical/high issues | 30 days |
| Public advisory and credit (if you wish) | After a fix is released |

We follow coordinated disclosure and will credit reporters in the advisory and release notes unless you ask us not to.

## Supported versions

| Version | Supported |
| --- | :---: |
| `main` (pre-release) | ✅ |
| Tagged releases | Latest minor only, once 1.0 ships |

## Threat model

The full analysis is in Section VIII of the [research paper](docs/paper/Vanepoint-Paper.pdf). Summary:

### Assets

1. **Input control** of the paired computer (keyboard, mouse, shortcuts).
2. **Pairing secrets** — device static keys and the trust list.
3. **Screen context** shared with optional AI features.

### Adversaries considered

| Adversary | Capability | Mitigation |
| --- | --- | --- |
| Passive network observer (same Wi-Fi) | Reads all packets | Noise `IK` handshake; ChaCha20-Poly1305 encryption of every message |
| Active network attacker (ARP/mDNS spoofing) | Impersonates the desktop or phone | Desktop public key pinned via QR; phone keys pinned in the desktop trust list |
| Replay attacker | Re-sends captured packets | Per-session keys, monotonically increasing nonces, sliding replay window on UDP |
| Unpaired device on the LAN | Connects to the agent port | Handshake rejected unless the initiator's static key is in the trust list or the one-time pairing secret is valid |
| Shoulder-surfer photographing the QR | Captures pairing secret | Secret is single-use and expires after 120 s; desktop shows and confirms the new device name before trusting it |
| Malicious or AI-generated profile | Tries to run dangerous actions | Profiles may only emit keyboard, mouse, and scroll actions; no shell or file access; schema-validated; user review required |
| Stolen phone | Holds a trusted key | One-click revocation on desktop; optional biometric lock in the mobile app; kill switch hotkey |

### Out of scope

- An attacker with code execution on the desktop or phone already controls input.
- Physical attacks on device secure storage.
- Denial of service by RF jamming or Wi-Fi deauthentication.

## Security design principles

- **No listening without consent.** The desktop agent only accepts pairing while the pairing window is open.
- **Least privilege on desktop.** The agent requests Accessibility (macOS) or standard input permissions only; it never runs elevated by default.
- **No cloud in the input path.** Input messages never leave the local network or Bluetooth link.
- **Kill switch.** `⌃⌥⌘ Esc` (macOS) or `Ctrl+Alt+Shift+Esc` (Windows) terminates all sessions immediately.
- **Secrets at rest:** on the phone, the identity key lives in the iOS Keychain / Android Keystore (`expo-secure-store`). On the desktop, v0.1 stores the identity key in the per-user app-data folder (owner-only permissions on macOS); moving it into the OS keychain is planned before 1.0.
