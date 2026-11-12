# Design System

Vanepoint is an *instrument*, not a dashboard. Every screen is a control surface you use without looking, so the design system puts three things first: **tactility** (haptics and motion that confirm every action), **glanceability** (state readable in under a second, even in a dark auditorium), and **restraint** (one job per surface).

Tokens will live in `packages/design-tokens` (Phase 0) and are shared by the mobile app and the desktop UI.

## Contents

- [Principles](#principles)
- [Colour](#colour)
- [Typography](#typography)
- [Space, shape and elevation](#space-shape-and-elevation)
- [Motion](#motion)
- [Haptic vocabulary](#haptic-vocabulary)
- [Mobile surfaces](#mobile-surfaces)
- [Desktop app](#desktop-app)
- [Onboarding](#onboarding)
- [Accessibility](#accessibility)

## Principles

1. **Eyes-free first.** Every primary action on a surface can be done without looking: large targets, edge anchoring, and haptic confirmation.
2. **One surface, one job.** Modes are full-screen. Settings never share a screen with a control surface.
3. **Dark by default.** Phones stay in dark mode while connected, so the presenter's face isn't lit up on stage. Light mode is fully supported everywhere else.
4. **State is never ambiguous.** Connection, mode, and transport always appear together as an icon, a label, and a colour. Colour is never the only signal.
5. **Motion explains, never decorates.** Animation shows cause and effect, such as momentum, snapping, or a mode change. It never blocks input.

## Colour

### Core palette

| Token | Hex | Use |
| --- | --- | --- |
| `ink.950` | `#0B0B12` | Dark background, presenter surfaces |
| `ink.900` | `#12121C` | Dark surface |
| `ink.800` | `#1C1C29` | Raised dark surface, cards |
| `ink.700` | `#2A2A3A` | Dark borders, dividers |
| `ink.400` | `#8A8AA3` | Secondary text (dark) |
| `ink.100` | `#ECECF4` | Primary text (dark) |
| `paper.50` | `#FAFAFC` | Light background |
| `paper.0` | `#FFFFFF` | Light surface |
| `paper.200` | `#E4E4EE` | Light borders |
| `slate.600` | `#5C5C70` | Secondary text (light) |
| `slate.900` | `#14141F` | Primary text (light) |

### Brand and semantic colours

| Token | Dark theme | Light theme | Use |
| --- | --- | --- | --- |
| `brand` | `#6E56CF` | `#5B43C4` | Primary fills, active mode, focus rings |
| `brand.text` | `#B4A7F0` | `#4C36B0` | Brand-coloured text and links (meets 4.5:1) |
| `success` | `#3DD68C` | `#18A058` | Connected, saved |
| `warning` | `#F5A524` | `#B26B00` | Degraded link, permission needed |
| `danger` | `#F2555A` | `#D1343A` | Disconnected, kill switch, destructive actions |
| `laser` | `#FF3B30` | `#FF3B30` | Laser pointer core (overlay only) |

### Rules

- Body text meets WCAG 2.2 AA contrast (4.5:1). Large text and UI components meet at least 3:1.
- `brand` (`#6E56CF`) on `ink.950` is about 3.6:1. Use it for fills and large elements only. For text, use `brand.text`.
- Surfaces never use pure black (`#000`). `ink.950` keeps OLED power savings while avoiding smearing during scrolling.

## Typography

Vanepoint uses each platform's **system typeface** so it feels native: SF Pro (iOS, macOS), Roboto (Android), and Segoe UI Variable (Windows). Numbers that update live, such as timers, latency, and dial values, use **tabular figures**.

| Style | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| `display` | 34 / 40 | Semibold | Present timer, dial value |
| `title` | 22 / 28 | Semibold | Screen titles |
| `headline` | 17 / 22 | Semibold | Section labels |
| `body` | 17 / 22 | Regular | Default text |
| `callout` | 15 / 20 | Regular | Secondary descriptions |
| `caption` | 13 / 16 | Medium | Status chips, hints |
| `micro` | 11 / 13 | Semibold, +4% tracking, uppercase | Mode labels on surfaces |

All text scales with Dynamic Type (iOS) and font scale (Android). Control surfaces keep their geometry and scale only their labels.

## Space, shape and elevation

- **Spacing:** 4-pt grid. Common steps are 4, 8, 12, 16, 24, 32, and 48.
- **Radii:** `sm 8` (chips), `md 12` (buttons, inputs), `lg 20` (cards), `xl 32` (surface panels). iOS uses continuous corners.
- **Hit targets:** at least 44 × 44 pt (iOS) or 48 × 48 dp (Android). Primary surface targets are much larger (see below).
- **Elevation:** dark themes signal elevation through lighter surface tones (`ink.900` → `ink.800`), not shadows. Light themes use one soft shadow: `0 8 24 rgba(20,20,31,0.08)`.

## Motion

| Token | Spec | Use |
| --- | --- | --- |
| `spring.snappy` | damping 22, stiffness 320, mass 1 | Button press, toggle, snap to detent |
| `spring.gentle` | damping 26, stiffness 180, mass 1 | Mode transitions, sheets |
| `spring.momentum` | physics-driven (friction k = 2.5 s⁻¹) | Trackball, flings |
| `duration.micro` | 120 ms, ease-out | Highlights, ripples |
| `duration.standard` | 220 ms, ease-in-out | Fades, cross-dissolves |

### Rules

- All gesture-driven animation should run on the UI thread (Reanimated worklets) at the display's native refresh rate. *(v0.1 uses `PanResponder` and React state so it runs in Expo Go; worklets arrive with a development build.)*
- Input is never blocked by an animation. A tap during a transition goes to the destination surface.
- When **Reduce Motion** is on, springs are replaced by 150 ms cross-fades and parallax is disabled.

## Haptic vocabulary

Haptics are a language. Each pattern means exactly one thing everywhere in the app.

| Event | Meaning | iOS (Core Haptics) | Android (`VibrationEffect.Composition`) |
| --- | --- | --- | --- |
| `click` | Left click / primary tap | Transient · intensity 0.6 · sharpness 0.7 | `PRIMITIVE_CLICK` @ 0.6 |
| `click_strong` | Right click / long press | Transient · intensity 1.0 · sharpness 0.5 | `PRIMITIVE_CLICK` @ 1.0 |
| `detent` | Dial step, slider notch | Transient · intensity 0.35 · sharpness 0.9 | `PRIMITIVE_TICK` @ 0.5 |
| `edge` | Cursor reached a screen edge | Transient · intensity 0.8 · sharpness 0.2 | `PRIMITIVE_THUD` @ 0.7 (API 31+), else `EFFECT_HEAVY_CLICK` |
| `connected` | Session established | Two transients rising 0.4 → 0.8, 80 ms apart | `PRIMITIVE_QUICK_RISE` + `PRIMITIVE_CLICK` |
| `disconnected` | Session lost | Two transients 0.7, 120 ms apart | `PRIMITIVE_CLICK` × 2, 120 ms delay |
| `warning` | Degraded link, permission needed | Three transients 0.5, 70 ms apart | `PRIMITIVE_TICK` × 3 |
| `success` | Profile saved, pairing complete | Continuous 60 ms ramp + transient 0.9 | `PRIMITIVE_QUICK_RISE` @ 0.8 |

### Rules

- **Rate limit:** at most one non-detent haptic per 40 ms. Detents may fire at up to 60 Hz. Beyond that, haptics merge into a texture.
- Haptics always **accompany** a visual or audible signal. They are never the only feedback.
- Users can set intensity (Off / Subtle / Standard / Strong) globally. *(v0.1 offers on/off.)*
- **v0.1 implementation:** so the app runs in Expo Go, patterns map onto `expo-haptics` primitives (`impact`, `selection`, `notification`). The custom Core Haptics / `VibrationEffect` patterns in the table arrive with a development build.
- Devices without advanced haptics fall back to the closest predefined effect. Devices without any haptics show a brief visual pulse instead.

## Mobile surfaces

All surfaces are full-bleed below a 52 pt status strip and a segmented **mode bar** (Present · Air · Pad · Ball · Dial, plus Controls when the focused app has a profile). Modes are switched with the bar rather than by swiping, because several surfaces use horizontal gestures themselves. The strip shows the connected desktop, the current latency and the active profile.

### Present

```text
┌──────────────────────────────┐
│ ● Studio MacBook · Wi-Fi 9ms │  status strip
│ 12:48        Slide 7 / 24    │  timer · progress (display)
│ ──────────────────────────── │
│                              │
│                              │
│            NEXT              │  ≥ 60% of screen height
│              →               │  tap = next · swipe right = previous
│                              │
│                              │
│ ──────────────────────────── │
│  ◀ Prev      ◉ Laser (hold)  │  thumb row, 72 pt tall
└──────────────────────────────┘
```

### Air Pointer

```text
┌──────────────────────────────┐
│ ● Studio MacBook · Wi-Fi 9ms │
│                              │
│        ╭────────────╮        │
│        │  HOLD TO   │        │  clutch: pointer moves only while held
│        │   POINT    │        │  (can be switched to always-on)
│        ╰────────────╯        │
│                              │
│ ┌────────────┐┌────────────┐ │
│ │   CLICK    ││   RIGHT    │ │  large split buttons at thumb height
│ └────────────┘└────────────┘ │
│        ⟲ Recenter            │
└──────────────────────────────┘
```

### Dial

A full-width ring drawn with Skia. Two-finger rotation anywhere on the surface turns it, and a one-finger drag around the ring works too. Each detent shows a tick mark and fires a `detent` haptic. The current value is shown in `display` style in the centre, and a desktop HUD mirrors it.

### Left-handed and landscape

Every surface has a mirrored layout and a landscape variant. The thumb row follows the dominant-hand setting.

## Desktop app

### Tray popover (360 × 480)

```text
┌────────────────────────────────────┐
│ Vanepoint                    ⚙  ⏻   │
├────────────────────────────────────┤
│ ● Connected — Pixel 9              │
│   Wi-Fi · 9 ms · 0.1% loss         │
│   Mode: Present                    │
├────────────────────────────────────┤
│ Paired devices                     │
│   Pixel 9            active   ⋯    │
│   iPad Mini          last 2d  ⋯    │
│   + Pair a new device              │
├────────────────────────────────────┤
│ Profile: PowerPoint (auto)     ▾   │
│ Kill switch: ⌃⌥⌘ Esc               │
└────────────────────────────────────┘
```

The tray icon reflects state: outline for idle, filled for connected, an amber dot for degraded, and a red slash for a revoked permission.

### Overlay

The overlay is a transparent, always-on-top window that clicks pass through. It renders:

- **Laser:** a 9 px `laser` core with a 28 px soft glow. It fades out 600 ms after release.
- **Spotlight:** dims the screen to 35% brightness, except for a 220 px feathered circle around the pointer.
- **Dial HUD:** a pill 48 px above the bottom edge showing the parameter name and value. It hides after 1.2 s of inactivity.

## Onboarding

Target: **under 60 seconds** from launch to the first cursor movement.

1. **Welcome:** one sentence and a *Get started* button.
2. **Permission:** explains why Accessibility (macOS) is needed, with a button that deep-links to the exact Settings pane. The app detects the grant automatically and moves on.
3. **Pair:** a large QR code with a 120-second countdown ring. The phone scans it, the desktop asks *"Allow Pixel 9?"*, and the user confirms.
4. **Try it:** a target on screen to hit with the Air Pointer, with haptics firing. Then *You're ready*.

## Accessibility

- **Screen readers:** every control has a VoiceOver/TalkBack label and hint. Surfaces announce mode changes.
- **Dynamic Type:** all non-surface UI supports sizes up to iOS AX5 and Android 200% font scale.
- **Contrast:** WCAG 2.2 AA throughout, with a high-contrast theme option.
- **Motor:** adjustable pointer gain, dead zone, and dwell-click. *Always-on* or *hold-to-point* clutch. Left-handed layouts.
- **Reduce Motion** and **Reduce Transparency** are respected on all platforms.
- **Feedback redundancy:** state changes are signalled through at least two of visual, haptic, and audible channels.
