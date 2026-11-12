"""Reproducible figures, simulations and equation images for the Vanepoint paper.

Usage:  python docs/paper/figures/make_figures.py
Outputs PNGs next to this script and prints the simulation metrics quoted in the paper.
Requires numpy and matplotlib.
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

OUT = Path(__file__).resolve().parent
COL_W = 3.3  # inches, IEEE-style column width
DPI = 300

VIOLET = "#6E56CF"
VIOLET_L = "#B4A7F0"
MINT = "#18A058"
AMBER = "#D08A10"
CORAL = "#D1343A"
INK = "#14141F"
GREY = "#8A8AA3"
LIGHT = "#ECEAF8"

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["Times New Roman", "Times", "DejaVu Serif"],
    "mathtext.fontset": "stix",
    "font.size": 8,
    "axes.titlesize": 8,
    "axes.labelsize": 8,
    "xtick.labelsize": 7,
    "ytick.labelsize": 7,
    "legend.fontsize": 6.5,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.linewidth": 0.6,
    "lines.linewidth": 1.0,
    "savefig.dpi": DPI,
    "savefig.bbox": "tight",
    "savefig.pad_inches": 0.02,
})

METRICS: dict = {}


# ============================================================ Fig. 1 architecture
def box(ax, x, y, w, h, text, fc, ec, fs=6.6, weight="normal", tc=INK, r=0.02):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}", fc=fc, ec=ec, lw=0.7))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fs, color=tc, weight=weight, linespacing=1.15)


def arrow(ax, x0, y0, x1, y1, color=INK, style="-|>", lw=0.8, ls="-", text=None, tx=0, ty=0, fs=6):
    ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle=style, mutation_scale=7, color=color, lw=lw, linestyle=ls))
    if text:
        ax.text((x0 + x1) / 2 + tx, (y0 + y1) / 2 + ty, text, fontsize=fs, color=color, ha="center", va="center", style="italic")


def fig_architecture():
    fig, ax = plt.subplots(figsize=(COL_W, 3.85))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1.17)
    ax.axis("off")

    # Mobile container
    ax.add_patch(FancyBboxPatch((0.01, 0.70), 0.98, 0.46, boxstyle="round,pad=0,rounding_size=0.025", fc="#F7F6FD", ec=VIOLET, lw=0.9))
    ax.text(0.03, 1.135, "Vanepoint Mobile  (React Native / Expo)", fontsize=7, weight="bold", color=VIOLET, va="center")
    box(ax, 0.04, 0.95, 0.28, 0.13, "Sensors\nrotation rate,\ngravity, 100–200 Hz", "white", GREY, fs=5.7)
    box(ax, 0.36, 0.95, 0.28, 0.13, "Motion pipeline\nproject → dead zone\n→ 1€ → gain", "white", GREY, fs=5.7)
    box(ax, 0.68, 0.95, 0.28, 0.13, "Mode surfaces\nAir · Pad · Present\nBall · Dial", "white", GREY, fs=5.7)
    box(ax, 0.04, 0.75, 0.28, 0.13, "Haptics engine\nCore Haptics /\nVibrationEffect", "white", GREY, fs=5.7)
    box(ax, 0.36, 0.75, 0.60, 0.13, "Session client: Noise IK ·\ntransport manager (WS | UDP | BLE)", LIGHT, VIOLET, fs=5.9)
    arrow(ax, 0.32, 1.015, 0.36, 1.015)
    arrow(ax, 0.68, 1.015, 0.64, 1.015)
    arrow(ax, 0.50, 0.95, 0.50, 0.88)
    arrow(ax, 0.36, 0.815, 0.32, 0.815)

    # Link
    ax.add_patch(FancyBboxPatch((0.17, 0.515), 0.66, 0.14, boxstyle="round,pad=0,rounding_size=0.02", fc="white", ec=INK, lw=0.6, ls=(0, (3, 2))))
    ax.text(0.50, 0.603, "Encrypted frames (ChaCha20-Poly1305)", fontsize=6.0, ha="center", va="center")
    ax.text(0.50, 0.565, "WebSocket · UDP · Bluetooth LE", fontsize=6.0, ha="center", va="center", color=GREY)
    arrow(ax, 0.30, 0.75, 0.30, 0.655, style="-|>", text="MOTION · SCROLL\nBUTTON · DIAL", tx=-0.17, fs=5.4)
    arrow(ax, 0.70, 0.655, 0.70, 0.75, style="-|>", text="HAPTIC ·\nPROFILE", tx=0.14, fs=5.4)

    # Desktop container
    ax.add_patch(FancyBboxPatch((0.01, 0.01), 0.98, 0.46, boxstyle="round,pad=0,rounding_size=0.025", fc="#F5FBF8", ec=MINT, lw=0.9))
    ax.text(0.03, 0.045, "Vanepoint Desktop  (Tauri 2: Rust core + React UI)", fontsize=7, weight="bold", color=MINT, va="center")
    box(ax, 0.04, 0.30, 0.60, 0.13, "Session server: pairing · trust list ·\nreplay window · transport migration", "#E3F4EA", MINT, fs=5.9)
    box(ax, 0.68, 0.30, 0.28, 0.13, "Profile engine\nfocused-app\nwatcher", "white", GREY, fs=5.7)
    box(ax, 0.04, 0.10, 0.28, 0.13, "Physics loop\nintegrate at\ndisplay rate", "white", GREY, fs=5.7)
    box(ax, 0.36, 0.10, 0.28, 0.13, "Input adapter\nCGEvent /\nSendInput", "white", GREY, fs=5.7)
    box(ax, 0.68, 0.10, 0.28, 0.13, "Overlay & tray\nlaser · spotlight\ndial HUD", "white", GREY, fs=5.7)
    arrow(ax, 0.30, 0.515, 0.30, 0.43)
    arrow(ax, 0.55, 0.43, 0.70, 0.515)
    arrow(ax, 0.18, 0.30, 0.18, 0.23)
    arrow(ax, 0.32, 0.165, 0.36, 0.165)
    arrow(ax, 0.68, 0.365, 0.64, 0.365)
    arrow(ax, 0.60, 0.30, 0.75, 0.23)
    fig.savefig(OUT / "fig1_architecture.png")
    plt.close(fig)


# ============================================================ Fig. 2 transfer function
G_MIN, G_MAX, S0, WID = 0.35, 2.4, 1.1, 0.30
K_PX = 1000.0  # reference px per rad at G = 1


def gain(s):
    return G_MIN + (G_MAX - G_MIN) / (1 + np.exp(-(s - S0) / WID))


def fig_transfer():
    s = np.linspace(0, 3.5, 400)
    fig, ax = plt.subplots(figsize=(COL_W, 1.75))
    ax.axvspan(0, 0.6, color=LIGHT, lw=0)
    ax.axvspan(1.8, 3.5, color="#E3F4EA", lw=0)
    ax.plot(s, gain(s), color=VIOLET, lw=1.4, label="Vanepoint default $G(s)$")
    ax.plot(s, np.full_like(s, 1.0), color=GREY, lw=0.8, ls="--", label="constant gain")
    ax.text(0.30, 2.25, "precision", ha="center", fontsize=6.5, color=VIOLET)
    ax.text(2.65, 0.75, "travel", ha="center", fontsize=6.5, color=MINT)
    ax.set_xlabel(r"angular speed $s=\Vert\omega_{\perp}\Vert$  (rad/s)")
    ax.set_ylabel(r"gain $G(s)$")
    ax.set_xlim(0, 3.5)
    ax.set_ylim(0, 2.6)
    ax.legend(loc="lower right", frameon=False)
    fig.savefig(OUT / "fig2_transfer.png")
    plt.close(fig)


# ============================================================ Fig. 3 1€ filter simulation
class OneEuro:
    def __init__(self, freq, mincutoff=1.0, beta=0.0, dcutoff=1.0):
        self.freq, self.mincutoff, self.beta, self.dcutoff = freq, mincutoff, beta, dcutoff
        self.x_prev = None
        self.dx_prev = 0.0

    @staticmethod
    def alpha(cutoff, freq):
        tau = 1.0 / (2 * np.pi * cutoff)
        te = 1.0 / freq
        return 1.0 / (1.0 + tau / te)

    def __call__(self, x):
        if self.x_prev is None:
            self.x_prev = x
            return x
        dx = (x - self.x_prev) * self.freq
        a_d = self.alpha(self.dcutoff, self.freq)
        dx_hat = a_d * dx + (1 - a_d) * self.dx_prev
        cutoff = self.mincutoff + self.beta * abs(dx_hat)
        a = self.alpha(cutoff, self.freq)
        x_hat = a * x + (1 - a) * self.x_prev
        self.x_prev, self.dx_prev = x_hat, dx_hat
        return x_hat


def ema(x, fc, fs):
    a = OneEuro.alpha(fc, fs)
    y = np.empty_like(x)
    y[0] = x[0]
    for i in range(1, len(x)):
        y[i] = a * x[i] + (1 - a) * y[i - 1]
    return y


def lag_ms(ref, sig, fs, window):
    """Delay (ms) maximising cross-correlation inside a window (1 kHz upsampling)."""
    i0, i1 = int(window[0] * fs), int(window[1] * fs)
    t = np.arange(i0, i1) / fs
    tf = np.arange(t[0], t[-1], 0.001)
    r = np.interp(tf, t, ref[i0:i1])
    s = np.interp(tf, t, sig[i0:i1])
    best, best_c = 0, -np.inf
    for k in range(0, 200):
        c = np.dot(r[: len(r) - k], s[k:])
        if c > best_c:
            best, best_c = k, c
    return float(best)


def fig_one_euro():
    rng = np.random.default_rng(7)
    fs = 100.0
    t = np.arange(0, 6.0, 1 / fs)
    truth = np.zeros_like(t)
    truth += 3.0 * np.exp(-0.5 * ((t - 1.8) / 0.07) ** 2)              # fast sweep
    slow = (t > 3.4) & (t < 5.4)
    truth[slow] += 0.15 * np.sin(2 * np.pi * 0.5 * (t[slow] - 3.4))      # slow precise motion
    tremor = 0.05 * np.sin(2 * np.pi * 9.5 * t + 0.3)                  # physiological tremor
    noise = rng.normal(0, 0.012, t.size)                                # sensor noise
    raw = truth + tremor + noise

    f_smooth = ema(raw, 1.0, fs)
    f_fast = ema(raw, 10.0, fs)
    oe = OneEuro(fs, mincutoff=0.8, beta=0.45, dcutoff=1.0)
    f_oe = np.array([oe(v) for v in raw])

    def jitter_px(sig, w=(0.3, 1.4)):
        i0, i1 = int(w[0] * fs), int(w[1] * fs)
        pos = np.cumsum(sig[i0:i1]) / fs * K_PX * G_MIN
        tt = t[i0:i1]
        pos -= np.polyval(np.polyfit(tt, pos, 1), tt)
        return float(np.sqrt(np.mean(pos ** 2)))

    def track_err(sig, w=(3.6, 5.2)):
        i0, i1 = int(w[0] * fs), int(w[1] * fs)
        return float(np.sqrt(np.mean((sig[i0:i1] - truth[i0:i1]) ** 2)))

    sweep = (1.45, 2.15)
    METRICS["one_euro"] = {
        name: {
            "jitter_px_rms": round(jitter_px(sig), 3),
            "sweep_lag_ms": lag_ms(truth, sig, fs, sweep),
            "slow_track_rmse_rad_s": round(track_err(sig), 4),
        }
        for name, sig in (("raw", raw), ("ema_1hz", f_smooth), ("ema_10hz", f_fast), ("one_euro", f_oe))
    }

    fig, (a1, a2) = plt.subplots(2, 1, figsize=(COL_W, 2.9), gridspec_kw={"height_ratios": [1.35, 1]})
    a1.plot(t, raw, color="#C9C9D6", lw=0.6, label="raw gyroscope")
    a1.plot(t, f_smooth, color=AMBER, lw=0.9, label="EMA $f_c$=1 Hz")
    a1.plot(t, f_fast, color=GREY, lw=0.7, ls="--", label="EMA $f_c$=10 Hz")
    a1.plot(t, f_oe, color=VIOLET, lw=1.2, label="1€ filter")
    a1.set_ylabel(r"$\omega_{yaw}$ (rad/s)")
    a1.set_xlim(0, 6)
    a1.legend(ncol=2, frameon=False, loc="upper right")
    a1.text(0.05, 2.6, "(a)", fontsize=7, weight="bold")

    z = (t > 3.3) & (t < 5.5)
    a2.plot(t[z], raw[z], color="#C9C9D6", lw=0.6)
    a2.plot(t[z], f_smooth[z], color=AMBER, lw=0.9)
    a2.plot(t[z], f_fast[z], color=GREY, lw=0.7, ls="--")
    a2.plot(t[z], f_oe[z], color=VIOLET, lw=1.2)
    a2.plot(t[z], truth[z], color=INK, lw=0.6, ls=":", label="true motion")
    a2.set_xlabel("time (s)")
    a2.set_ylabel(r"$\omega_{yaw}$ (rad/s)")
    a2.set_xlim(3.3, 5.5)
    a2.legend(frameon=False, loc="lower left")
    a2.text(3.33, 0.2, "(b)", fontsize=7, weight="bold")
    fig.tight_layout(h_pad=0.6)
    fig.savefig(OUT / "fig4_one_euro.png")
    plt.close(fig)


# ============================================================ Fig. 4 inertia
def fig_inertia():
    v0, v_stop, dt = 3000.0, 20.0, 1 / 120
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(COL_W, 1.6))
    METRICS["inertia"] = {}
    for k, col in ((1.5, AMBER), (2.5, VIOLET), (4.0, MINT)):
        t, v, x = [0.0], [v0], [0.0]
        while v[-1] > v_stop:
            v.append(v[-1] * np.exp(-k * dt))
            x.append(x[-1] + v[-1] * dt)
            t.append(t[-1] + dt)
        a1.plot(t, v, color=col, lw=1.1, label=f"k = {k} s$^{{-1}}$")
        a2.plot(t, x, color=col, lw=1.1)
        METRICS["inertia"][str(k)] = {"glide_s": round(t[-1], 2), "distance_px": round(x[-1]), "analytic_px": round((v0 - v_stop) / k)}
    a1.set_xlabel("time (s)")
    a1.set_ylabel("velocity (px/s)")
    a1.legend(frameon=False)
    a2.set_xlabel("time (s)")
    a2.set_ylabel("travel (px)")
    a1.text(0.02, 0.92, "(a)", transform=a1.transAxes, fontsize=7, weight="bold")
    a2.text(0.02, 0.92, "(b)", transform=a2.transAxes, fontsize=7, weight="bold")
    fig.tight_layout(w_pad=1.0)
    fig.savefig(OUT / "fig3_inertia.png")
    plt.close(fig)


# ============================================================ Fig. 5 latency budget
def fig_latency():
    stages = ["sensor sampling", "phone processing", "radio / link", "desktop OS stack", "session + decrypt", "physics tick wait", "injection"]
    colors = ["#B4A7F0", "#8E7BE0", VIOLET, "#3E2E8C", "#9AA0B4", MINT, "#0E6B3A"]
    budgets = {
        "Wi-Fi WebSocket": [5.0, 0.5, 3.0, 0.0, 0.3, 4.2, 0.3],
        "Wi-Fi UDP": [5.0, 0.5, 2.5, 0.0, 0.3, 4.2, 0.3],
        "Bluetooth LE": [5.0, 0.5, 10.5, 2.0, 0.3, 4.2, 0.3],
    }
    METRICS["latency_budget_ms"] = {k: round(sum(v), 1) for k, v in budgets.items()}
    fig, ax = plt.subplots(figsize=(COL_W, 1.55))
    names = list(budgets)[::-1]
    for yi, name in enumerate(names):
        left = 0.0
        for val, col in zip(budgets[name], colors):
            if val > 0:
                ax.barh(yi, val, left=left, color=col, height=0.55, edgecolor="white", lw=0.4)
            left += val
        ax.text(left + 0.4, yi, f"{left:.1f} ms", va="center", fontsize=6.5)
    ax.axvline(15, color=CORAL, lw=0.7, ls="--")
    ax.text(15.3, -0.4, "Wi-Fi target", color=CORAL, fontsize=5.6)
    ax.axvline(25, color=AMBER, lw=0.7, ls="--")
    ax.text(25.3, -0.4, "BLE target", color=AMBER, fontsize=5.6)
    ax.set_yticks(range(len(names)), names)
    ax.set_xlabel("estimated median motion-to-injection latency (ms)")
    ax.set_xlim(0, 32)
    ax.set_ylim(-0.5, 2.45)
    handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in colors]
    ax.legend(handles, stages, ncol=3, frameon=False, fontsize=5.4, loc="upper center", bbox_to_anchor=(0.45, -0.42))
    fig.savefig(OUT / "fig5_latency.png")
    plt.close(fig)


# ============================================================ Fig. 6 pairing sequence
def fig_pairing():
    fig, ax = plt.subplots(figsize=(COL_W, 2.75))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    xp, xd = 0.21, 0.79
    for x, label, col in ((xp, "Phone\n(initiator)", VIOLET), (xd, "Desktop\n(responder)", MINT)):
        box(ax, x - 0.12, 0.90, 0.24, 0.09, label, "white", col, fs=6.6, weight="bold", tc=col)
        ax.plot([x, x], [0.04, 0.90], color=GREY, lw=0.6, ls=(0, (2, 2)))

    def note(x, y, text, w=0.30):
        box(ax, x - w / 2, y - 0.035, w, 0.07, text, LIGHT, VIOLET, fs=5.6)

    note(xd, 0.835, "show QR: k, s, h, p, e\n(expires ≤ 120 s)", w=0.36)
    arrow(ax, xd - 0.15, 0.80, xp + 0.02, 0.75, color=GREY, ls="--", text="camera scan (out-of-band)", ty=0.03, fs=5.6)
    note(xp, 0.68, "rs ← k\npsk ← BLAKE2s(s)", w=0.36)
    arrow(ax, xp, 0.60, xd, 0.60, text="→ e, es, s, ss, psk  + {device, caps}", ty=0.03, fs=5.8)
    note(xd, 0.515, "verify psk, decrypt s\nask “Allow Pixel 9?”", w=0.36)
    arrow(ax, xd, 0.42, xp, 0.42, text="← e, ee, se  + {accepted}", ty=0.03, fs=5.8)
    note(xp, 0.335, "store k as trusted", w=0.36)
    note(xd, 0.335, "add s to trust list", w=0.36)
    arrow(ax, xp, 0.24, xd, 0.24, style="<|-|>", color=VIOLET, text="explicit-nonce AEAD frames", ty=0.03, fs=5.8)
    ax.text(0.5, 0.12, "Reconnect: Noise IK without PSK; rejected unless\nthe phone's static key is in the trust list.", ha="center", fontsize=5.8, color=GREY, style="italic")
    fig.savefig(OUT / "fig6_pairing.png")
    plt.close(fig)


# ============================================================ equations
EQUATIONS = {
    "eq01": r"$\omega_{yaw}=-\,\boldsymbol{\omega}\cdot\hat{\mathbf{g}},\qquad \omega_{pitch}=\boldsymbol{\omega}\cdot\dfrac{\hat{\mathbf{g}}\times\hat{\mathbf{f}}}{\Vert\hat{\mathbf{g}}\times\hat{\mathbf{f}}\Vert}$",
    "eq02": r"$\mathbf{v}=K\,G(s)\,\left(\omega_{yaw},\,\omega_{pitch}\right),\qquad s=\Vert(\omega_{yaw},\omega_{pitch})\Vert$",
    "eq03": r"$G(s)=G_{min}+\dfrac{G_{max}-G_{min}}{1+e^{-(s-s_0)/w}}$",
    "eq04": r"$\hat{x}_i=\alpha\,x_i+(1-\alpha)\,\hat{x}_{i-1},\qquad \alpha=\dfrac{1}{1+\tau/T_e},\quad \tau=\dfrac{1}{2\pi f_c}$",
    "eq05": r"$f_c=f_{c,min}+\beta\,\left|\hat{\dot{x}}_i\right|$",
    "eq06": r"$v_0=\dfrac{\sum_i (t_i-\bar{t})(p_i-\bar{p})}{\sum_i (t_i-\bar{t})^2}$",
    "eq07": r"$\mathbf{v}(t)=\mathbf{v}_0\,e^{-kt},\qquad d_\infty=\dfrac{\Vert\mathbf{v}_0\Vert}{k}$",
    "eq08": r"$\theta=\mathrm{atan2}(y_2-y_1,\;x_2-x_1),\qquad \Delta\theta=\mathrm{wrap}_{(-\pi,\pi]}(\theta_t-\theta_{t-1})$",
    "eq09": r"$n=\left\lfloor \dfrac{N\,\Theta}{2\pi}\right\rfloor,\qquad \Theta=\sum_t \Delta\theta$",
    "eq10": r"$\delta=\dfrac{(t_2-t_1)+(t_3-t_4)}{2},\qquad \mathrm{RTT}=(t_4-t_1)-(t_3-t_2)$",
    "eq11": r"$L_{m2i}=t_{inject}-\left(t_{sample}+\delta\right)$",
    "eq12": r"$ID=\log_2\!\left(\dfrac{D}{W}+1\right),\qquad TP=\dfrac{ID_e}{MT}$",
    "eq13": r"$ID_e=\log_2\!\left(\dfrac{D_e}{W_e}+1\right),\qquad W_e=4.133\,\sigma$",
}


def render_equations():
    eqdir = OUT / "eq"
    eqdir.mkdir(exist_ok=True)
    for name, tex in EQUATIONS.items():
        fig = plt.figure(figsize=(0.01, 0.01))
        fig.text(0, 0, tex, fontsize=9.5)
        fig.savefig(eqdir / f"{name}.png", dpi=600, bbox_inches="tight", pad_inches=0.02, transparent=False, facecolor="white")
        plt.close(fig)


if __name__ == "__main__":
    fig_architecture()
    fig_transfer()
    fig_one_euro()
    fig_inertia()
    fig_latency()
    fig_pairing()
    render_equations()
    (OUT / "metrics.json").write_text(json.dumps(METRICS, indent=2))
    print(json.dumps(METRICS, indent=2))
