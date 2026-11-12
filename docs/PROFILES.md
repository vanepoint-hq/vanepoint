# Writing App Profiles

An **app profile** tells Vanepoint what the phone should show when a given desktop application is in focus: which surfaces appear, what each button does, and how dials map to shortcuts. Profiles are single JSON files, so they make an ideal first contribution.

## How profiles work

1. The desktop app watches the focused application (bundle ID on macOS, executable name on Windows).
2. When a profile's `match` rule fits, the desktop sends its layout to the phone (`CONTROL {op: "profile"}`).
3. Buttons on the phone send an `ACTION` id. The desktop looks up the action in the profile and performs it with the OS input adapter.

Profiles are **data, not code**. They can only produce key chords, mouse clicks, scrolling, and a small set of built-in Vanepoint actions (laser, spotlight, recenter, mode switches). They cannot run commands or access files. The [JSON Schema](../profiles/schema/profile.schema.json) enforces this.

## Anatomy of a profile

```jsonc
{
  "$schema": "./schema/profile.schema.json",
  "schema": 1,                                  // profile format version
  "id": "microsoft.powerpoint",                 // unique, lowercase
  "name": "PowerPoint",
  "version": "0.1.0",
  "match": {
    "macos":   { "bundleId": "com.microsoft.Powerpoint" },
    "windows": { "exe": "POWERPNT.EXE" }
  },
  "actions": {
    "next":            { "kind": "key", "chord": ["ArrowRight"] },
    "start_beginning": { "kind": "key", "macos": ["Meta", "Shift", "Enter"], "windows": ["F5"] },
    "end_show":        { "kind": "key", "chord": ["Escape"], "confirm": true },
    "laser":           { "kind": "builtin", "name": "laser_toggle" }
  },
  "surfaces": [
    {
      "mode": "present",
      "controls": [
        { "type": "button", "label": "Next", "action": "next", "emphasis": "primary", "span": 4 },
        { "type": "button", "label": "Laser", "action": "laser", "span": 2 }
      ]
    }
  ]
}
```

### Actions

| `kind` | Fields | Example |
| --- | --- | --- |
| `key` | `chord`, or both `macos` and `windows`; optional `repeat`, `confirm` | `{ "kind": "key", "chord": ["Control", "KeyZ"] }` |
| `scroll` | `dx`, `dy` (lines, −100…100) | `{ "kind": "scroll", "dy": -3 }` |
| `mouse` | `button` (`left`/`right`/`middle`), `clicks` (1–3) | `{ "kind": "mouse", "button": "left", "clicks": 2 }` |
| `sequence` | `steps` (2–10 action names), `delayMs` | `{ "kind": "sequence", "steps": ["select_all", "copy"] }` |
| `builtin` | `name` | `{ "kind": "builtin", "name": "spotlight_toggle" }` |

Key names use W3C [`KeyboardEvent.code`](https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values) values (`KeyA`, `Digit1`, `ArrowLeft`, `F5`, `Equal`…) and the modifiers `Meta`, `Control`, `Alt`, `Shift`. `Meta` is ⌘ on macOS and the Windows key on Windows. Use separate `macos` and `windows` chords whenever the platforms differ.

### Controls

| `type` | Purpose | Key fields |
| --- | --- | --- |
| `button` | A tap target | `label` (≤ 18 chars), `action`, `icon`, `haptic`, `span` (1–4 columns), `emphasis` |
| `dial` | Rotary control | `label`, `cw`, `ccw`, `detentsPerTurn` (4–96), `accelerate` |
| `swipe` | Directional swipes on the surface | `left`, `right`, `up`, `down` (at least two) |

Icons use names from the [Lucide](https://lucide.dev/icons/) icon set.

### Surfaces

`mode` can be `present`, `buttons`, `dial`, `trackpad`, `air`, or `trackball`. Buttons are laid out on a 4-column grid in order, and `span` sets the width.

## Guidelines

- **Use the app's default shortcuts.** Say so in `description` if a profile assumes a custom keymap.
- **Mark destructive actions** (quit, close without saving, end show) with `"confirm": true` and `"emphasis": "danger"`.
- **Keep surfaces focused**: at most 8 controls on a `buttons` surface for one-handed use.
- **Labels are verbs or nouns**, without punctuation: "Next", "Cut", "Mark in".
- **Test on both platforms** if your profile has both `macos` and `windows` match rules, or remove the one you can't test.

## Submitting a profile

1. Create `profiles/<vendor>.<app>.json`. Look at the [existing profiles](../profiles/) for examples.
2. Validate it locally:

   ```bash
   npx --yes ajv-cli@5 validate --spec=draft2020 -s profiles/schema/profile.schema.json -d profiles/<your-file>.json
   ```

3. Open a PR titled `feat(profiles): add <App Name>`. CI runs the same validation.

Want a profile but can't build it? Open an [app profile request](https://github.com/vanepoint-hq/vanepoint/issues/new?template=profile_request.yml).
