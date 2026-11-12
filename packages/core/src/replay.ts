/** Sliding anti-replay window (RFC 6479 style) over 64-bit counters. */
export class ReplayWindow {
  static readonly SIZE = 2048;
  private bits = new Uint32Array(ReplayWindow.SIZE / 32);
  private highest = -1;

  /** True if `n` has not been seen and is not too old. Does not record it. */
  check(n: number): boolean {
    if (!Number.isSafeInteger(n) || n < 0) return false;
    if (n > this.highest) return true;
    if (this.highest - n >= ReplayWindow.SIZE) return false;
    const i = n % ReplayWindow.SIZE;
    return (this.bits[i >>> 5] & (1 << (i & 31))) === 0;
  }

  /** Record `n` as seen (call only after the frame authenticates). */
  update(n: number): void {
    if (n > this.highest) {
      const advance = n - this.highest;
      if (advance >= ReplayWindow.SIZE) {
        this.bits.fill(0);
      } else {
        for (let k = this.highest + 1; k <= n; k++) {
          const i = k % ReplayWindow.SIZE;
          this.bits[i >>> 5] &= ~(1 << (i & 31));
        }
      }
      this.highest = n;
    }
    const i = n % ReplayWindow.SIZE;
    this.bits[i >>> 5] |= 1 << (i & 31);
  }
}
