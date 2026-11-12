# Governance

Vanepoint is an open-source project run in the open. This document describes who makes decisions and how.

## Roles

| Role | Responsibilities | How to become one |
| --- | --- | --- |
| **Contributor** | Anyone who opens an issue, reviews, or submits a PR | Participate |
| **Triager** | Labels issues, reproduces bugs, welcomes newcomers | Sustained helpful participation; nominated by a maintainer |
| **Maintainer** | Reviews and merges PRs, owns releases, enforces the Code of Conduct | Significant, sustained contributions; consensus of existing maintainers |
| **Project lead** | Final decision on deadlocked issues, roadmap stewardship | Founder; transferable by maintainer vote |

## Current maintainers

| Name | GitHub | Areas |
| --- | --- | --- |
| Shourya Kapoor | ShouryaKapoor | Project lead, architecture, research |

## Decision making

1. **Lazy consensus** for day-to-day changes: a PR with one maintainer approval and no objections for 48 hours can be merged.
2. **ADR process** for protocol, security, schema, or public API changes — see [`docs/adr/`](docs/adr/README.md). Requires approval from two maintainers once the project has two or more.
3. **Project lead decides** if consensus cannot be reached after a reasonable discussion period, and records the reasoning in the ADR.

## Releases

- Semantic Versioning (`MAJOR.MINOR.PATCH`). Pre-1.0 releases may break compatibility in minor versions.
- Wire-protocol versions are negotiated at handshake time and evolve independently of app versions (see [`docs/PROTOCOL.md`](docs/PROTOCOL.md#10-versioning)).
- Every release has a [CHANGELOG](CHANGELOG.md) entry and signed tags.

## Code of Conduct

All participants follow the [Code of Conduct](CODE_OF_CONDUCT.md). Maintainers handle reports confidentially.
