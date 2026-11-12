# 0002. One Noise-based security layer for every transport

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** project lead

## Context

Vanepoint carries input over three transports: WebSocket (TCP), UDP datagrams, and Bluetooth LE GATT. Sessions must be mutually authenticated, encrypted, protected against replay, and able to **move between transports** without the user noticing, for example when Wi-Fi drops and BLE takes over.

Using TLS for WebSocket, DTLS for UDP, and BLE's own pairing would mean three security stacks with different trust models. BLE link-layer pairing also gives no guarantee about *which application* is on the other end.

## Decision

Use the **Noise Protocol Framework** at the application layer, independent of the transport:

- **First pairing:** `Noise_IKpsk1_25519_ChaChaPoly_BLAKE2s`. The desktop's static key and a one-time PSK come from the QR code. Placing the PSK at the end of message 1 (rather than message 2, as WireGuard does) means the desktop can verify the phone saw the current code *before* showing an approval prompt or sending any reply.
- **Reconnect:** `Noise_IK_25519_ChaChaPoly_BLAKE2s`, accepted only if the phone's static key is in the desktop's trust list.
- **Transport phase:** stateless, explicit-nonce AEAD frames with a sliding replay window (Noise `SetNonce`, in the style of WireGuard). Every frame is self-describing, so any transport can carry any frame.
- **Implementations:** `snow` on the desktop (Rust). On mobile, a libsodium-based implementation tested for interoperability against the official Noise test vectors and `snow`.

## Alternatives considered

| Option | Why not |
| --- | --- |
| TLS + DTLS with certificate pinning | Two stacks, no BLE story, certificate lifecycle overhead |
| BLE link-layer pairing only | Authenticates devices, not applications; doesn't cover Wi-Fi |
| Custom protocol on raw X25519 + AEAD | Rolling our own handshake is error-prone; Noise is analysed and widely deployed (WireGuard, WhatsApp, Lightning) |

## Consequences

- ✅ One trust model: "the phone knows the desktop key it scanned; the desktop knows phones it approved."
- ✅ Seamless transport migration with no new handshake.
- ✅ Identity hiding and forward secrecy come for free with `IK`.
- ⚠️ The mobile Noise implementation needs careful interoperability testing. Fuzzing and test vectors are part of the Phase 1 exit criteria.
- ⚠️ 25 bytes of overhead per frame, which is acceptable for 16-byte motion messages at up to 200 Hz (about 8 KB/s).
