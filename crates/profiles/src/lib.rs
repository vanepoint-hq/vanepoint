//! App profiles (see `docs/PROFILES.md` and `profiles/schema/profile.schema.json`).
//!
//! Profiles are pure data. They can only produce key chords, mouse clicks, scrolling and a
//! fixed set of built-in actions — never commands or file access. The full profile JSON is
//! forwarded to the phone, which renders its surfaces and sends `ACTION` ids back. An action
//! id is the index of the action in the profile's `actions` object (document order).

use std::path::Path;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum ProfileError {
    #[error("invalid profile JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("profile `{0}`: {1}")]
    Invalid(String, String),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Default)]
pub struct Match {
    #[serde(default)]
    pub macos: Option<MacMatch>,
    #[serde(default)]
    pub windows: Option<WinMatch>,
    #[serde(default, rename = "titlePattern")]
    pub title_pattern: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MacMatch {
    #[serde(rename = "bundleId")]
    pub bundle_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct WinMatch {
    pub exe: String,
}

fn one() -> u8 {
    1
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    Key {
        #[serde(default)]
        chord: Option<Vec<String>>,
        #[serde(default)]
        macos: Option<Vec<String>>,
        #[serde(default)]
        windows: Option<Vec<String>>,
        #[serde(default)]
        repeat: bool,
        #[serde(default)]
        confirm: bool,
    },
    Scroll {
        #[serde(default)]
        dx: f64,
        #[serde(default)]
        dy: f64,
    },
    Mouse {
        button: String,
        #[serde(default = "one")]
        clicks: u8,
    },
    Sequence {
        steps: Vec<String>,
        #[serde(default, rename = "delayMs")]
        delay_ms: u64,
    },
    Builtin {
        name: String,
    },
}

pub const BUILTINS: &[&str] = &["laser_toggle", "spotlight_toggle", "recenter", "mode_air", "mode_trackpad", "mode_present", "timer_reset"];

#[derive(Debug, Clone, Deserialize)]
struct ProfileFile {
    schema: u32,
    id: String,
    name: String,
    #[serde(rename = "match")]
    matcher: Match,
    actions: IndexMap<String, Action>,
}

/// One concrete thing to do, already resolved for the current platform.
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Chord(Vec<String>),
    Scroll { dx: f64, dy: f64 },
    Click { button: String, clicks: u8 },
    Builtin(String),
    Delay(u64),
}

#[derive(Debug, Clone)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub matcher: Match,
    pub actions: IndexMap<String, Action>,
    /// The original JSON, forwarded to the phone.
    pub raw: serde_json::Value,
    title_re: Option<regex::Regex>,
}

impl Profile {
    pub fn parse(json: &str) -> Result<Profile, ProfileError> {
        let raw: serde_json::Value = serde_json::from_str(json)?;
        let f: ProfileFile = serde_json::from_value(raw.clone())?;
        let invalid = |m: String| ProfileError::Invalid(f.id.clone(), m);
        if f.schema != 1 {
            return Err(invalid(format!("unsupported schema {}", f.schema)));
        }
        for (name, action) in &f.actions {
            match action {
                Action::Key { chord, macos, windows, .. } => {
                    if chord.is_none() && (macos.is_none() || windows.is_none()) {
                        return Err(invalid(format!("action `{name}` needs `chord` or both `macos` and `windows`")));
                    }
                    for k in chord.iter().chain(macos).chain(windows).flatten() {
                        if !vanepoint_input::is_known_key(k) {
                            return Err(invalid(format!("action `{name}` uses unknown key `{k}`")));
                        }
                    }
                }
                Action::Mouse { button, clicks } => {
                    if vanepoint_input::MouseButton::from_name(button).is_none() || !(1..=3).contains(clicks) {
                        return Err(invalid(format!("action `{name}` has an invalid mouse button or click count")));
                    }
                }
                Action::Sequence { steps, delay_ms } => {
                    if steps.len() < 2 || steps.len() > 10 || *delay_ms > 1000 {
                        return Err(invalid(format!("sequence `{name}` must have 2–10 steps and delayMs ≤ 1000")));
                    }
                    for s in steps {
                        match f.actions.get(s) {
                            None => return Err(invalid(format!("sequence `{name}` references missing action `{s}`"))),
                            Some(Action::Sequence { .. }) => return Err(invalid(format!("sequence `{name}` cannot nest sequence `{s}`"))),
                            _ => {}
                        }
                    }
                }
                Action::Builtin { name: b } => {
                    if !BUILTINS.contains(&b.as_str()) {
                        return Err(invalid(format!("unknown builtin `{b}`")));
                    }
                }
                Action::Scroll { dx, dy } => {
                    if dx.abs() > 100.0 || dy.abs() > 100.0 {
                        return Err(invalid(format!("scroll `{name}` out of range")));
                    }
                }
            }
        }
        let title_re = match &f.matcher.title_pattern {
            Some(p) => Some(regex::Regex::new(p).map_err(|e| invalid(format!("bad titlePattern: {e}")))?),
            None => None,
        };
        Ok(Profile { id: f.id, name: f.name, matcher: f.matcher, actions: f.actions, raw, title_re })
    }

    pub fn matches(&self, app: &ActiveApp) -> bool {
        let id_match = match (&self.matcher.macos, &app.bundle_id) {
            (Some(m), Some(b)) if m.bundle_id.eq_ignore_ascii_case(b) => true,
            _ => matches!((&self.matcher.windows, &app.exe), (Some(m), Some(e)) if m.exe.eq_ignore_ascii_case(e)),
        };
        let has_id_rule = self.matcher.macos.is_some() || self.matcher.windows.is_some();
        match &self.title_re {
            Some(re) => (id_match || !has_id_rule) && re.is_match(&app.title),
            None => id_match,
        }
    }

    pub fn action_by_index(&self, index: u16) -> Option<(&str, &Action)> {
        self.actions.get_index(index as usize).map(|(k, v)| (k.as_str(), v))
    }

    /// Resolves an action (expanding sequences one level) for the current platform.
    pub fn resolve(&self, name: &str) -> Vec<Step> {
        let Some(action) = self.actions.get(name) else { return vec![] };
        match action {
            Action::Sequence { steps, delay_ms } => {
                let mut out = Vec::new();
                for (i, s) in steps.iter().enumerate() {
                    if i > 0 && *delay_ms > 0 {
                        out.push(Step::Delay(*delay_ms));
                    }
                    if let Some(a) = self.actions.get(s) {
                        out.extend(resolve_simple(a));
                    }
                }
                out
            }
            a => resolve_simple(a),
        }
    }
}

fn resolve_simple(a: &Action) -> Vec<Step> {
    match a {
        Action::Key { chord, macos, windows, .. } => {
            let platform = if cfg!(target_os = "macos") { macos } else { windows };
            platform.clone().or_else(|| chord.clone()).map(Step::Chord).into_iter().collect()
        }
        Action::Scroll { dx, dy } => vec![Step::Scroll { dx: *dx, dy: *dy }],
        Action::Mouse { button, clicks } => vec![Step::Click { button: button.clone(), clicks: *clicks }],
        Action::Builtin { name } => vec![Step::Builtin(name.clone())],
        Action::Sequence { .. } => vec![],
    }
}

/// The focused application.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ActiveApp {
    pub exe: Option<String>,
    pub bundle_id: Option<String>,
    pub title: String,
}

/// Queries the OS for the focused application.
pub fn active_app() -> Option<ActiveApp> {
    let w = active_win_pos_rs::get_active_window().ok()?;
    let exe = w.process_path.file_name().map(|s| s.to_string_lossy().to_string());
    #[cfg(target_os = "macos")]
    let bundle_id = mac_bundle_id(&w.process_path);
    #[cfg(not(target_os = "macos"))]
    let bundle_id: Option<String> = None;
    Some(ActiveApp { exe, bundle_id, title: w.title })
}

#[cfg(target_os = "macos")]
fn mac_bundle_id(process_path: &Path) -> Option<String> {
    let app = process_path.ancestors().find(|p| p.extension().is_some_and(|e| e == "app"))?;
    let plist = plist::Value::from_file(app.join("Contents/Info.plist")).ok()?;
    plist.as_dictionary()?.get("CFBundleIdentifier")?.as_string().map(str::to_string)
}

const BUILTIN_JSON: &[&str] = &[
    include_str!("../../../profiles/microsoft.powerpoint.json"),
    include_str!("../../../profiles/apple.keynote.json"),
    include_str!("../../../profiles/adobe.premiere-pro.json"),
];

/// Built-in profiles plus any `*.json` in the user's profile folder (user profiles win).
#[derive(Debug, Clone, Default)]
pub struct ProfileSet {
    pub profiles: Vec<Profile>,
}

impl ProfileSet {
    pub fn builtin() -> Self {
        let profiles = BUILTIN_JSON.iter().filter_map(|j| Profile::parse(j).map_err(|e| log::error!("built-in profile rejected: {e}")).ok()).collect();
        ProfileSet { profiles }
    }

    pub fn load(user_dir: Option<&Path>) -> Self {
        let mut set = ProfileSet::builtin();
        if let Some(dir) = user_dir {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for e in entries.flatten() {
                    let p = e.path();
                    if p.extension().is_some_and(|x| x == "json") {
                        match std::fs::read_to_string(&p).map_err(|e| e.to_string()).and_then(|s| Profile::parse(&s).map_err(|e| e.to_string())) {
                            Ok(profile) => {
                                set.profiles.retain(|q| q.id != profile.id);
                                set.profiles.insert(0, profile);
                            }
                            Err(e) => log::warn!("skipping profile {}: {e}", p.display()),
                        }
                    }
                }
            }
        }
        set
    }

    pub fn find(&self, app: &ActiveApp) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.matches(app))
    }

    pub fn get(&self, id: &str) -> Option<&Profile> {
        self.profiles.iter().find(|p| p.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_profiles_load() {
        let set = ProfileSet::builtin();
        assert_eq!(set.profiles.len(), 3);
    }

    #[test]
    fn matches_windows_exe_case_insensitively() {
        let set = ProfileSet::builtin();
        let app = ActiveApp { exe: Some("powerpnt.exe".into()), bundle_id: None, title: "Deck".into() };
        assert_eq!(set.find(&app).unwrap().id, "microsoft.powerpoint");
        let mac = ActiveApp { exe: Some("Keynote".into()), bundle_id: Some("com.apple.iWork.Keynote".into()), title: String::new() };
        assert_eq!(set.find(&mac).unwrap().id, "apple.keynote");
        assert!(set.find(&ActiveApp::default()).is_none());
    }

    #[test]
    fn resolves_platform_chords_and_indices() {
        let set = ProfileSet::builtin();
        let p = set.get("microsoft.powerpoint").unwrap();
        assert_eq!(p.action_by_index(0).unwrap().0, "next");
        assert_eq!(p.resolve("next"), vec![Step::Chord(vec!["ArrowRight".into()])]);
        let start = p.resolve("start_beginning");
        let expected = if cfg!(target_os = "macos") { vec!["Meta", "Shift", "Enter"] } else { vec!["F5"] };
        assert_eq!(start, vec![Step::Chord(expected.into_iter().map(String::from).collect())]);
    }

    #[test]
    fn rejects_unsafe_or_invalid_profiles() {
        let shell =
            r#"{"schema":1,"id":"bad","name":"Bad","match":{"windows":{"exe":"x.exe"}},"actions":{"run":{"kind":"shell","cmd":"rm -rf /"}},"surfaces":[]}"#;
        assert!(Profile::parse(shell).is_err());
        let badkey =
            r#"{"schema":1,"id":"bad","name":"Bad","match":{"windows":{"exe":"x.exe"}},"actions":{"k":{"kind":"key","chord":["Hyper"]}},"surfaces":[]}"#;
        assert!(Profile::parse(badkey).is_err());
    }
}
