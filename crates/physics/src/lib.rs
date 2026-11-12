//! Desktop-side motion integration (see docs/ARCHITECTURE.md, "The input path").
//!
//! The phone sends velocities; the desktop integrates them at the display rate so network
//! jitter never shows up as cursor stutter. A velocity expires after a short TTL, so the
//! cursor stops if packets stop. Flings decay exponentially (`v(t) = v0·e^(−kt)`).

use serde::{Deserialize, Serialize};

/// A display rectangle in the coordinate space used for input injection.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn contains(&self, p: (f64, f64)) -> bool {
        p.0 >= self.x && p.0 <= self.right() && p.1 >= self.y && p.1 <= self.bottom()
    }
    pub fn right(&self) -> f64 {
        self.x + self.w - 1.0
    }
    pub fn bottom(&self) -> f64 {
        self.y + self.h - 1.0
    }
    fn clamp(&self, p: (f64, f64)) -> (f64, f64) {
        (p.0.clamp(self.x, self.right()), p.1.clamp(self.y, self.bottom()))
    }
    pub fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }
}

/// The set of displays forming the virtual desktop.
#[derive(Debug, Clone, PartialEq)]
pub struct Layout {
    pub displays: Vec<Rect>,
}

impl Default for Layout {
    fn default() -> Self {
        Layout { displays: vec![Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1080.0 }] }
    }
}

impl Layout {
    pub fn new(displays: Vec<Rect>) -> Self {
        if displays.is_empty() {
            Layout::default()
        } else {
            Layout { displays }
        }
    }

    /// Keeps a point on some display. Returns the clamped point and whether it was clamped.
    pub fn clamp(&self, p: (f64, f64)) -> ((f64, f64), bool) {
        if self.displays.iter().any(|d| d.contains(p)) {
            return (p, false);
        }
        let best = self
            .displays
            .iter()
            .map(|d| {
                let c = d.clamp(p);
                (c, (c.0 - p.0).powi(2) + (c.1 - p.1).powi(2))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(c, _)| c)
            .unwrap_or(p);
        (best, true)
    }

    pub fn primary_center(&self) -> (f64, f64) {
        self.displays[0].center()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicsConfig {
    /// Seconds a velocity sample stays valid without a refresh.
    pub velocity_ttl: f64,
    /// Exponential friction for flings, s⁻¹.
    pub friction: f64,
    /// Flings stop below this speed (px/s).
    pub stop_speed: f64,
}

impl Default for PhysicsConfig {
    fn default() -> Self {
        PhysicsConfig { velocity_ttl: 0.05, friction: 2.5, stop_speed: 20.0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Step {
    pub position: (f64, f64),
    /// The position changed this step.
    pub moved: bool,
    /// Motion was stopped by a display edge this step.
    pub edge: bool,
}

/// Integrates pointer motion. Time is passed in explicitly (seconds) to keep it testable.
#[derive(Debug, Clone)]
pub struct Integrator {
    pub config: PhysicsConfig,
    pos: (f64, f64),
    vel: (f64, f64),
    vel_expires: f64,
    fling: Option<(f64, f64)>,
}

impl Integrator {
    pub fn new(start: (f64, f64), config: PhysicsConfig) -> Self {
        Integrator { config, pos: start, vel: (0.0, 0.0), vel_expires: 0.0, fling: None }
    }

    pub fn position(&self) -> (f64, f64) {
        self.pos
    }

    /// Re-synchronise with the real cursor (e.g. the user moved the physical mouse).
    pub fn set_position(&mut self, p: (f64, f64)) {
        self.pos = p;
    }

    pub fn set_velocity(&mut self, vx: f64, vy: f64, now: f64) {
        self.fling = None;
        self.vel = (vx, vy);
        self.vel_expires = now + self.config.velocity_ttl;
    }

    pub fn fling(&mut self, vx: f64, vy: f64) {
        self.vel = (0.0, 0.0);
        self.fling = if vx.hypot(vy) > self.config.stop_speed { Some((vx, vy)) } else { None };
    }

    pub fn stop(&mut self) {
        self.vel = (0.0, 0.0);
        self.fling = None;
    }

    pub fn is_moving(&self, now: f64) -> bool {
        self.fling.is_some() || (now < self.vel_expires && (self.vel.0 != 0.0 || self.vel.1 != 0.0))
    }

    pub fn step(&mut self, now: f64, dt: f64, layout: &Layout) -> Step {
        let dt = dt.clamp(0.0, 0.1);
        let v = if let Some((fx, fy)) = self.fling {
            let decay = (-self.config.friction * dt).exp();
            let (nx, ny) = (fx * decay, fy * decay);
            self.fling = if nx.hypot(ny) < self.config.stop_speed { None } else { Some((nx, ny)) };
            (nx, ny)
        } else if now < self.vel_expires {
            self.vel
        } else {
            (0.0, 0.0)
        };
        if v == (0.0, 0.0) {
            return Step { position: self.pos, moved: false, edge: false };
        }
        let target = (self.pos.0 + v.0 * dt, self.pos.1 + v.1 * dt);
        let (clamped, was_clamped) = layout.clamp(target);
        let moved = (clamped.0 - self.pos.0).abs() > 1e-9 || (clamped.1 - self.pos.1).abs() > 1e-9;
        let edge = was_clamped && (clamped.0 - target.0).abs() + (clamped.1 - target.1).abs() > 0.5;
        if edge && self.fling.is_some() {
            self.fling = None;
        }
        self.pos = clamped;
        Step { position: clamped, moved, edge }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(i: &mut Integrator, layout: &Layout, seconds: f64, hz: f64) -> Vec<Step> {
        let dt = 1.0 / hz;
        let mut t = 0.0;
        let mut out = vec![];
        while t < seconds {
            t += dt;
            out.push(i.step(t, dt, layout));
        }
        out
    }

    #[test]
    fn velocity_expires_after_ttl() {
        let layout = Layout::default();
        let mut i = Integrator::new((500.0, 500.0), PhysicsConfig::default());
        i.set_velocity(1000.0, 0.0, 0.0);
        run(&mut i, &layout, 0.5, 120.0);
        // Only ~TTL worth of motion (50 ms × 1000 px/s ≈ 50 px), not 500 px.
        let moved = i.position().0 - 500.0;
        assert!((40.0..=60.0).contains(&moved), "moved {moved}");
    }

    #[test]
    fn fling_distance_matches_analytic() {
        let layout = Layout::new(vec![Rect { x: 0.0, y: 0.0, w: 10_000.0, h: 1000.0 }]);
        let mut i = Integrator::new((100.0, 500.0), PhysicsConfig::default());
        i.fling(3000.0, 0.0);
        run(&mut i, &layout, 5.0, 120.0);
        let d = i.position().0 - 100.0;
        // (v0 − v_stop)/k ≈ 1192 px; frame quantisation gives a little less.
        assert!((1150.0..=1200.0).contains(&d), "distance {d}");
    }

    #[test]
    fn clamps_to_displays_and_reports_edges() {
        let layout = Layout::new(vec![Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1080.0 }, Rect { x: 1920.0, y: 0.0, w: 1280.0, h: 720.0 }]);
        let mut i = Integrator::new((3100.0, 700.0), PhysicsConfig::default());
        i.set_velocity(5000.0, 5000.0, 0.0);
        let steps = run(&mut i, &layout, 0.04, 120.0);
        assert!(steps.iter().any(|s| s.edge));
        let p = i.position();
        assert!(p.0 <= 3199.0 && p.1 <= 719.0);
        // Crossing onto the second display works.
        let mut j = Integrator::new((1900.0, 300.0), PhysicsConfig::default());
        j.set_velocity(2000.0, 0.0, 0.0);
        run(&mut j, &layout, 0.04, 120.0);
        assert!(j.position().0 > 1920.0);
    }
}
