//! OS input injection behind [`InputSink`].
//!
//! * [`NativeSink`] (feature `native`) drives the real cursor and keyboard via `enigo`
//!   (CGEvent on macOS, SendInput on Windows). Absolute positioning is used so the user's
//!   OS pointer acceleration never stacks on top of Vanepoint's own transfer function.
//! * [`RecordingSink`] records events instead — used by tests and `--dry-run`.

use std::sync::{Arc, Mutex};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

impl MouseButton {
    pub fn from_wire(b: u8) -> Option<Self> {
        match b {
            0 => Some(MouseButton::Left),
            1 => Some(MouseButton::Right),
            2 => Some(MouseButton::Middle),
            _ => None,
        }
    }

    pub fn from_name(s: &str) -> Option<Self> {
        match s {
            "left" => Some(MouseButton::Left),
            "right" => Some(MouseButton::Right),
            "middle" => Some(MouseButton::Middle),
            _ => None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum InputError {
    #[error("unknown key `{0}`")]
    UnknownKey(String),
    #[error("input backend error: {0}")]
    Backend(String),
}

pub type Result<T> = std::result::Result<T, InputError>;

/// Everything the agent can do to the OS.
pub trait InputSink {
    fn move_to(&mut self, x: f64, y: f64) -> Result<()>;
    fn button(&mut self, button: MouseButton, down: bool) -> Result<()>;
    /// Whole wheel notches; positive `dy` scrolls content down (wheel towards the user).
    fn scroll(&mut self, dx: i32, dy: i32) -> Result<()>;
    /// `code` is a W3C `KeyboardEvent.code` value or a modifier (`Meta`, `Control`, `Alt`, `Shift`).
    fn key(&mut self, code: &str, down: bool) -> Result<()>;
    fn text(&mut self, text: &str) -> Result<()>;
    fn cursor_position(&mut self) -> Option<(f64, f64)>;

    /// Size of the main display, if the backend knows it.
    fn display_size(&mut self) -> Option<(f64, f64)> {
        None
    }

    /// Presses keys in order and releases them in reverse.
    fn chord(&mut self, codes: &[String]) -> Result<()> {
        for c in codes {
            if !is_known_key(c) {
                return Err(InputError::UnknownKey(c.clone()));
            }
        }
        let mut pressed = Vec::new();
        let mut result = Ok(());
        for c in codes {
            match self.key(c, true) {
                Ok(()) => pressed.push(c),
                Err(e) => {
                    result = Err(e);
                    break;
                }
            }
        }
        for c in pressed.iter().rev() {
            let _ = self.key(c, false);
        }
        result
    }
}

/// Keys accepted in profiles and CONTROL `key` messages (mirrors the profile JSON Schema).
pub fn is_known_key(code: &str) -> bool {
    matches!(
        code,
        "Meta"
            | "Control"
            | "Alt"
            | "Shift"
            | "Enter"
            | "Escape"
            | "Space"
            | "Tab"
            | "Backspace"
            | "Delete"
            | "Home"
            | "End"
            | "PageUp"
            | "PageDown"
            | "ArrowUp"
            | "ArrowDown"
            | "ArrowLeft"
            | "ArrowRight"
            | "Equal"
            | "Minus"
            | "BracketLeft"
            | "BracketRight"
            | "Backslash"
            | "Semicolon"
            | "Quote"
            | "Comma"
            | "Period"
            | "Slash"
            | "Backquote"
    ) || key_char(code).is_some()
        || function_key(code).is_some()
}

/// `KeyA` → 'a', `Digit1` → '1', punctuation codes → their US-layout character.
pub fn key_char(code: &str) -> Option<char> {
    if let Some(l) = code.strip_prefix("Key") {
        let c = l.chars().next()?;
        return (l.len() == 1 && c.is_ascii_uppercase()).then(|| c.to_ascii_lowercase());
    }
    if let Some(d) = code.strip_prefix("Digit") {
        let c = d.chars().next()?;
        return (d.len() == 1 && c.is_ascii_digit()).then_some(c);
    }
    Some(match code {
        "Equal" => '=',
        "Minus" => '-',
        "BracketLeft" => '[',
        "BracketRight" => ']',
        "Backslash" => '\\',
        "Semicolon" => ';',
        "Quote" => '\'',
        "Comma" => ',',
        "Period" => '.',
        "Slash" => '/',
        "Backquote" => '`',
        _ => return None,
    })
}

pub fn function_key(code: &str) -> Option<u8> {
    let n: u8 = code.strip_prefix('F')?.parse().ok()?;
    (1..=24).contains(&n).then_some(n)
}

// ---------------------------------------------------------------------------- recording

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InputEvent {
    Move { x: f64, y: f64 },
    Button { button: MouseButton, down: bool },
    Scroll { dx: i32, dy: i32 },
    Key { code: String, down: bool },
    Text { text: String },
}

/// Records events (optionally echoing them as JSON lines to stdout) instead of touching the OS.
#[derive(Clone)]
pub struct RecordingSink {
    pub events: Arc<Mutex<Vec<InputEvent>>>,
    echo: bool,
    pos: (f64, f64),
}

impl RecordingSink {
    pub fn new(echo: bool) -> Self {
        RecordingSink { events: Arc::new(Mutex::new(Vec::new())), echo, pos: (960.0, 540.0) }
    }

    fn push(&mut self, e: InputEvent) {
        if self.echo {
            if let Ok(line) = serde_json::to_string(&serde_json::json!({ "type": "input", "event": e })) {
                println!("{line}");
            }
        }
        if let Ok(mut v) = self.events.lock() {
            v.push(e);
        }
    }
}

impl InputSink for RecordingSink {
    fn move_to(&mut self, x: f64, y: f64) -> Result<()> {
        self.pos = (x, y);
        self.push(InputEvent::Move { x: (x * 10.0).round() / 10.0, y: (y * 10.0).round() / 10.0 });
        Ok(())
    }
    fn button(&mut self, button: MouseButton, down: bool) -> Result<()> {
        self.push(InputEvent::Button { button, down });
        Ok(())
    }
    fn scroll(&mut self, dx: i32, dy: i32) -> Result<()> {
        self.push(InputEvent::Scroll { dx, dy });
        Ok(())
    }
    fn key(&mut self, code: &str, down: bool) -> Result<()> {
        if !is_known_key(code) {
            return Err(InputError::UnknownKey(code.into()));
        }
        self.push(InputEvent::Key { code: code.into(), down });
        Ok(())
    }
    fn text(&mut self, text: &str) -> Result<()> {
        self.push(InputEvent::Text { text: text.into() });
        Ok(())
    }
    fn cursor_position(&mut self) -> Option<(f64, f64)> {
        Some(self.pos)
    }
}

// ---------------------------------------------------------------------------- native

#[cfg(feature = "native")]
pub use native::NativeSink;

#[cfg(feature = "native")]
mod native {
    use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};

    use super::{function_key, key_char, InputError, InputSink, MouseButton, Result};

    /// Real input via enigo. Not `Send` on every platform: create it on the thread that uses it.
    pub struct NativeSink {
        enigo: Enigo,
    }

    impl NativeSink {
        pub fn new() -> Result<Self> {
            let enigo = Enigo::new(&Settings::default()).map_err(|e| InputError::Backend(e.to_string()))?;
            Ok(NativeSink { enigo })
        }

        /// Size of the main display in injection coordinates.
        pub fn main_display(&self) -> Option<(f64, f64)> {
            self.enigo.main_display().ok().map(|(w, h)| (w as f64, h as f64))
        }
    }

    fn map_key(code: &str) -> Option<Key> {
        Some(match code {
            "Meta" => Key::Meta,
            "Control" => Key::Control,
            "Alt" => Key::Alt,
            "Shift" => Key::Shift,
            "Enter" => Key::Return,
            "Escape" => Key::Escape,
            "Space" => Key::Space,
            "Tab" => Key::Tab,
            "Backspace" => Key::Backspace,
            "Delete" => Key::Delete,
            "Home" => Key::Home,
            "End" => Key::End,
            "PageUp" => Key::PageUp,
            "PageDown" => Key::PageDown,
            "ArrowUp" => Key::UpArrow,
            "ArrowDown" => Key::DownArrow,
            "ArrowLeft" => Key::LeftArrow,
            "ArrowRight" => Key::RightArrow,
            other => {
                if let Some(n) = function_key(other) {
                    return function(n);
                }
                return key_char(other).map(Key::Unicode);
            }
        })
    }

    fn function(n: u8) -> Option<Key> {
        Some(match n {
            1 => Key::F1,
            2 => Key::F2,
            3 => Key::F3,
            4 => Key::F4,
            5 => Key::F5,
            6 => Key::F6,
            7 => Key::F7,
            8 => Key::F8,
            9 => Key::F9,
            10 => Key::F10,
            11 => Key::F11,
            12 => Key::F12,
            13 => Key::F13,
            14 => Key::F14,
            15 => Key::F15,
            16 => Key::F16,
            17 => Key::F17,
            18 => Key::F18,
            19 => Key::F19,
            20 => Key::F20,
            _ => return None,
        })
    }

    fn err(e: impl std::fmt::Display) -> InputError {
        InputError::Backend(e.to_string())
    }

    impl InputSink for NativeSink {
        fn move_to(&mut self, x: f64, y: f64) -> Result<()> {
            self.enigo.move_mouse(x.round() as i32, y.round() as i32, Coordinate::Abs).map_err(err)
        }

        fn button(&mut self, button: MouseButton, down: bool) -> Result<()> {
            let b = match button {
                MouseButton::Left => Button::Left,
                MouseButton::Right => Button::Right,
                MouseButton::Middle => Button::Middle,
            };
            self.enigo.button(b, if down { Direction::Press } else { Direction::Release }).map_err(err)
        }

        fn scroll(&mut self, dx: i32, dy: i32) -> Result<()> {
            if dy != 0 {
                self.enigo.scroll(dy, Axis::Vertical).map_err(err)?;
            }
            if dx != 0 {
                self.enigo.scroll(dx, Axis::Horizontal).map_err(err)?;
            }
            Ok(())
        }

        fn key(&mut self, code: &str, down: bool) -> Result<()> {
            let k = map_key(code).ok_or_else(|| InputError::UnknownKey(code.into()))?;
            self.enigo.key(k, if down { Direction::Press } else { Direction::Release }).map_err(err)
        }

        fn text(&mut self, text: &str) -> Result<()> {
            self.enigo.text(text).map_err(err)
        }

        fn cursor_position(&mut self) -> Option<(f64, f64)> {
            self.enigo.location().ok().map(|(x, y)| (x as f64, y as f64))
        }

        fn display_size(&mut self) -> Option<(f64, f64)> {
            self.main_display()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_codes() {
        assert_eq!(key_char("KeyK"), Some('k'));
        assert_eq!(key_char("Digit7"), Some('7'));
        assert_eq!(key_char("Equal"), Some('='));
        assert_eq!(key_char("Keyboard"), None);
        assert_eq!(function_key("F5"), Some(5));
        assert!(is_known_key("ArrowRight"));
        assert!(!is_known_key("rm -rf"));
    }

    #[test]
    fn chord_presses_and_releases_in_order() {
        let mut s = RecordingSink::new(false);
        s.chord(&["Control".into(), "KeyK".into()]).unwrap();
        let ev = s.events.lock().unwrap().clone();
        assert_eq!(
            ev,
            vec![
                InputEvent::Key { code: "Control".into(), down: true },
                InputEvent::Key { code: "KeyK".into(), down: true },
                InputEvent::Key { code: "KeyK".into(), down: false },
                InputEvent::Key { code: "Control".into(), down: false },
            ]
        );
        assert!(s.chord(&["Control".into(), "Nope".into()]).is_err());
    }
}
