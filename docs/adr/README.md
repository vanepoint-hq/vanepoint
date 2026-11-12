# Architecture Decision Records

An ADR records one significant decision: the context, the decision itself, and its consequences. ADRs are never deleted. A decision that changes later is *superseded* by a new ADR that links back to the old one.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-native-apps-over-web-client.md) | Native apps instead of a browser client | Accepted |
| [0002](0002-noise-protocol-for-all-transports.md) | One Noise-based security layer for every transport | Accepted |
| [0003](0003-ai-outside-the-input-path.md) | AI generates profiles offline and never sits in the input path | Accepted |

## Process

1. Copy the template below into `NNNN-short-title.md`, using the next free number.
2. Open a PR with status **Proposed**. The PR is labelled `rfc` and stays open for at least 7 days of comment.
3. Once maintainers approve it, set the status to **Accepted** and merge.

## Template

```markdown
# NNNN. Title

- **Status:** Proposed | Accepted | Superseded by [NNNN](…)
- **Date:** YYYY-MM-DD
- **Deciders:** @handle, @handle

## Context

What problem are we solving? What forces and constraints apply?

## Decision

What did we decide, stated plainly?

## Alternatives considered

What else did we evaluate, and why not?

## Consequences

What becomes easier or harder? What follow-up work does this create?
```
