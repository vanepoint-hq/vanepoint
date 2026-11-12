# 0003. AI generates profiles offline and never sits in the input path

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** project lead

## Context

The original concept used Claude for "smart gestures". The user would draw a symbol, Vanepoint would capture the screen and send it to Claude, and Claude would decide on and run a contextual action. Analysis showed several problems:

- **Latency:** a screenshot upload plus model inference takes seconds. That is far beyond the threshold where input feels direct, since lag of around 75 ms already measurably degrades performance (MacKenzie & Ware, 1993).
- **Privacy:** sending screenshots to a cloud service on every gesture is unacceptable, especially while presenting to an audience.
- **Reliability and safety:** model-chosen actions vary from run to run. An action like "run the tests" is better expressed as a deterministic shortcut.
- **Gesture recognition doesn't need an LLM:** template matchers such as the $1 Recognizer (Wobbrock et al., 2007) recognise drawn symbols on device in under a millisecond.

## Decision

AI is used **only to author profiles, ahead of time**:

1. The user asks for a profile for an app, optionally pasting its shortcut list or attaching one screenshot.
2. The desktop calls the Anthropic Messages API with the user's own key, and the output is constrained to the profile JSON Schema.
3. The output is validated, linted for unsafe or duplicate chords, and shown on a review screen.
4. Once the user accepts it, the profile runs locally and deterministically, with no further AI calls.

Gestures are recognised on the phone and mapped to profile actions.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Real-time AI actions per gesture | Latency, privacy, cost, non-determinism |
| On-device LLM for actions | Model size and battery cost on phones, and it still isn't deterministic |
| No AI at all | Hand-writing profiles for the long tail of apps limits adoption; AI drafting is a real accelerator |

## Consequences

- ✅ The input path stays under 30 ms and works fully offline.
- ✅ Privacy is simple to explain: AI is off by default, the user brings their own key, and only content they explicitly choose is sent.
- ✅ Generated profiles are reviewable, shareable artifacts that the community registry can curate.
- ⚠️ The "magic" pitch shifts from *the phone understands your screen* to *any app supported in a minute*.
