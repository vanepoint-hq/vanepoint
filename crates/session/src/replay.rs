/// Sliding anti-replay window (RFC 6479 style) over 64-bit counters.
pub struct ReplayWindow {
    bits: [u64; Self::SIZE / 64],
    highest: Option<u64>,
}

impl Default for ReplayWindow {
    fn default() -> Self {
        ReplayWindow { bits: [0; Self::SIZE / 64], highest: None }
    }
}

impl ReplayWindow {
    pub const SIZE: usize = 2048;

    fn bit(n: u64) -> (usize, u64) {
        let i = (n % Self::SIZE as u64) as usize;
        (i / 64, 1u64 << (i % 64))
    }

    /// True if `n` is new and inside the window. Does not record it.
    pub fn check(&self, n: u64) -> bool {
        match self.highest {
            None => true,
            Some(h) if n > h => true,
            Some(h) if h - n >= Self::SIZE as u64 => false,
            Some(_) => {
                let (w, m) = Self::bit(n);
                self.bits[w] & m == 0
            }
        }
    }

    /// Records `n` (call only after the frame authenticates).
    pub fn update(&mut self, n: u64) {
        let advance = match self.highest {
            None => Some(u64::MAX),
            Some(h) if n > h => Some(n - h),
            _ => None,
        };
        if let Some(adv) = advance {
            if adv >= Self::SIZE as u64 {
                self.bits = [0; Self::SIZE / 64];
            } else {
                let start = self.highest.map_or(0, |h| h + 1);
                for k in start..=n {
                    let (w, m) = Self::bit(k);
                    self.bits[w] &= !m;
                }
            }
            self.highest = Some(n);
        }
        let (w, m) = Self::bit(n);
        self.bits[w] |= m;
    }
}

#[cfg(test)]
mod tests {
    use super::ReplayWindow;

    #[test]
    fn window_semantics() {
        let mut w = ReplayWindow::default();
        assert!(w.check(0));
        w.update(0);
        assert!(!w.check(0));
        w.update(5000);
        assert!(!w.check(5000 - ReplayWindow::SIZE as u64));
        assert!(w.check(4990));
        w.update(4990);
        assert!(!w.check(4990));
        assert!(w.check(5001));
    }
}
