# Contributing to Vanepoint

Thanks for your interest in Vanepoint! This guide explains how to propose changes, what we expect from a pull request, and where help is most valuable right now.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Where help is most valuable

Vanepoint is in the **design phase**. Before Phase 0 code lands, these contributions have the biggest impact:

| Area | How to help | Start here |
| --- | --- | --- |
| **App profiles** | Add a JSON profile for an app you use daily | [`docs/PROFILES.md`](docs/PROFILES.md) |
| **Protocol & security review** | Look for flaws in pairing, replay protection, transport selection | [`docs/PROTOCOL.md`](docs/PROTOCOL.md), [`SECURITY.md`](SECURITY.md) |
| **Design review** | Critique layouts, haptics, onboarding, accessibility | [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) |
| **Research** | Improve the evaluation protocol, suggest related work | [`docs/paper/`](docs/paper/) |
| **Platform expertise** | Input injection, BLE, mDNS quirks on specific OS versions | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |

## Ways to contribute

### 1. Report a bug or propose a feature

Use the [issue templates](https://github.com/vanepoint-hq/vanepoint/issues/new/choose). Search existing issues first. For security problems, **do not open a public issue** — follow [`SECURITY.md`](SECURITY.md).

### 2. Start a discussion

Open-ended ideas, design questions, and "would this work?" belong in [GitHub Discussions](https://github.com/vanepoint-hq/vanepoint/discussions). Ideas that gain consensus become issues.

### 3. Propose a significant change (RFC)

Changes to the wire protocol, security model, profile schema, or public APIs need an **Architecture Decision Record** before implementation:

1. Copy the template at the bottom of [`docs/adr/README.md`](docs/adr/README.md).
2. Open a pull request adding `docs/adr/NNNN-short-title.md` with status `Proposed`.
3. A maintainer will label it `rfc` and leave it open for at least 7 days of comment.
4. Once accepted, implementation PRs reference the ADR.

### 4. Submit a pull request

1. Fork the repository and create a branch from `main`:
   `git checkout -b feat/dial-detent-haptics`
2. Make your change with tests and documentation where relevant.
3. Run the checks locally (see below).
4. Open a PR using the template. Link the issue it resolves (`Closes #123`).
5. A maintainer will review within a few days. Please keep the PR focused — one logical change per PR.

## Development setup

The full walkthrough is in [`docs/TESTING.md`](docs/TESTING.md).

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 20 LTS or later | Mobile app, desktop UI, shared packages |
| Rust | stable (via `rustup`) | Desktop core, protocol, transport crates |
| Expo Go (phone) / EAS | latest | Run the mobile app without building it; EAS for store builds (no Mac required) |
| Xcode | latest | Only for local iOS or macOS desktop builds |

```bash
npm install && npm run mobile:install
npm test              # Vitest + cargo test
npm run e2e           # real agent vs phone simulator
npm run typecheck     # TypeScript across core, simulator, desktop UI
cargo clippy --workspace --all-targets -- -D warnings
npm run desktop:dev   # Tauri dev build
npm run mobile:dev    # Expo dev server
```

## Conventions

### Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(mobile): add haptic detents to the rotary dial
fix(transport): drop stale UDP packets outside the replay window
docs(protocol): clarify motion packet byte order
```

Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`. Scopes: `mobile`, `desktop`, `protocol`, `transport`, `input`, `motion`, `profiles`, `docs`, `paper`.

### Branches

`feat/…`, `fix/…`, `docs/…`, `refactor/…`, `profile/<app-name>`.

### Code style

- **TypeScript:** strict mode, ESLint + Prettier defaults in the repo. No `any` without a comment explaining why.
- **Rust:** `cargo fmt`, `cargo clippy -- -D warnings`. Public items need doc comments.
- **Performance-sensitive paths** (sensor loop, transport, input injection) must not allocate per sample. Include a benchmark when you change them.

### Design changes

UI changes must include before/after screenshots or a short screen recording, in both light and dark themes, and must meet the accessibility rules in [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md#accessibility).

## Pull request checklist

- [ ] The PR has a clear title in Conventional Commits format
- [ ] Linked to an issue or ADR
- [ ] Tests added or updated, and `npm test` and `npm run e2e` pass
- [ ] Docs updated (README, protocol, profiles) if behaviour changed
- [ ] Screenshots for UI changes (light + dark)
- [ ] No secrets, API keys, or personal data in code, fixtures, or screenshots

## Developer Certificate of Origin

All commits must be signed off to certify you wrote the code or have the right to submit it under the project's MIT license ([DCO](https://developercertificate.org/)):

```bash
git commit -s -m "feat(motion): add 1€ filter"
```

## Recognition

Every merged contributor is added to the contributors list. Significant contributions to the research are acknowledged in the paper.

Thank you for helping build Vanepoint!
