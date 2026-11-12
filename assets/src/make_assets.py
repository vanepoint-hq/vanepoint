"""Generate Vanepoint brand assets: logo (SVG + PNG), README banners, social preview.

Usage:  python assets/src/make_assets.py
Requires Pillow. Fonts: Segoe UI (Windows) with a DejaVu fallback.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parents[1]
SS = 4  # supersampling factor for anti-aliasing

INK_950 = (11, 11, 18)
INK_800 = (28, 28, 41)
INK_700 = (42, 42, 58)
INK_400 = (138, 138, 163)
INK_100 = (236, 236, 244)
PAPER_50 = (250, 250, 252)
PAPER_200 = (228, 228, 238)
SLATE_600 = (92, 92, 112)
SLATE_900 = (20, 20, 31)
VIOLET = (110, 86, 207)
VIOLET_DEEP = (91, 67, 196)
VIOLET_LIGHT = (180, 167, 240)
MINT = (61, 214, 140)

FONT_DIRS = [Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu")]


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    candidates = {
        "semibold": ["seguisb.ttf", "DejaVuSans-Bold.ttf"],
        "bold": ["segoeuib.ttf", "DejaVuSans-Bold.ttf"],
        "regular": ["segoeui.ttf", "DejaVuSans.ttf"],
        "light": ["segoeuil.ttf", "DejaVuSans.ttf"],
    }[name]
    for d in FONT_DIRS:
        for c in candidates:
            if (d / c).exists():
                return ImageFont.truetype(str(d / c), size)
    return ImageFont.load_default()


# --------------------------------------------------------------------------- logo
# Geometry on a 512 x 512 grid: rounded square, cursor arrow, three "air" arcs.
CURSOR = [(0, 0), (0, 19.5), (5.2, 14.9), (8.6, 22.6), (11.9, 21.2), (8.6, 13.6), (15.2, 13.6)]
CURSOR_SCALE = 10.4
CURSOR_TIP = (164.0, 222.0)
ARC_CENTER = CURSOR_TIP
ARC_RADII = (84.0, 134.0, 184.0)
ARC_SPAN = (290.0, 348.0)  # degrees, clockwise from 3 o'clock (screen coords)
ARC_WIDTH = 28.0
ARC_ALPHA = (255, 200, 140)


def cursor_points(scale=1.0, ox=0.0, oy=0.0):
    tx, ty = CURSOR_TIP
    return [((tx + x * CURSOR_SCALE) * scale + ox, (ty + y * CURSOR_SCALE) * scale + oy) for x, y in CURSOR]


def draw_logo(size: int, bg=True) -> Image.Image:
    """Render the logo mark at `size` px with supersampling."""
    S = size * SS
    k = S / 512.0
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    if bg:
        # diagonal gradient rounded square
        grad = Image.new("RGBA", (S, S))
        gd = ImageDraw.Draw(grad)
        c0, c1 = (128, 104, 226), VIOLET_DEEP
        for i in range(2 * S):
            t = i / (2 * S)
            col = tuple(int(c0[j] + (c1[j] - c0[j]) * t) for j in range(3)) + (255,)
            gd.line([(i, 0), (0, i)], fill=col, width=2)
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(116 * k), fill=255)
        img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    cx, cy = ARC_CENTER[0] * k, ARC_CENTER[1] * k
    for r, a in zip(ARC_RADII, ARC_ALPHA):
        rr, w = r * k, ARC_WIDTH * k
        layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.arc([cx - rr, cy - rr, cx + rr, cy + rr], ARC_SPAN[0], ARC_SPAN[1], fill=(255, 255, 255, 255), width=int(w))
        # round caps: the arc stroke spans radius (rr - w, rr]
        mid = rr - w / 2
        for ang in ARC_SPAN:
            ex, ey = cx + mid * math.cos(math.radians(ang)), cy + mid * math.sin(math.radians(ang))
            ld.ellipse([ex - w / 2, ey - w / 2, ex + w / 2, ey + w / 2], fill=(255, 255, 255, 255))
        alpha = layer.getchannel("A").point(lambda v, a=a: v * a // 255)
        layer.putalpha(alpha)
        img = Image.alpha_composite(img, layer)
        d = ImageDraw.Draw(img)

    # cursor with soft shadow
    pts = cursor_points(k)
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon([(x + 6 * k, y + 10 * k) for x, y in pts], fill=(30, 10, 80, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10 * k))
    img = Image.alpha_composite(img, shadow)
    d = ImageDraw.Draw(img)
    d.polygon(pts, fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


def logo_svg() -> str:
    def arc_path(r):
        mid = r - ARC_WIDTH / 2
        a0, a1 = map(math.radians, ARC_SPAN)
        x0, y0 = ARC_CENTER[0] + mid * math.cos(a0), ARC_CENTER[1] + mid * math.sin(a0)
        x1, y1 = ARC_CENTER[0] + mid * math.cos(a1), ARC_CENTER[1] + mid * math.sin(a1)
        return f"M{x0:.1f} {y0:.1f} A{mid:.1f} {mid:.1f} 0 0 1 {x1:.1f} {y1:.1f}"

    arcs = "\n    ".join(
        f'<path d="{arc_path(r)}" stroke="#fff" stroke-opacity="{a / 255:.2f}" stroke-width="{ARC_WIDTH:.0f}" stroke-linecap="round" fill="none"/>'
        for r, a in zip(ARC_RADII, ARC_ALPHA)
    )
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in cursor_points())
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Vanepoint logo">
  <title>Vanepoint</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8068E2"/>
      <stop offset="1" stop-color="#5B43C4"/>
    </linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="6" dy="10" stdDeviation="9" flood-color="#1E0A50" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#g)"/>
  <g>
    {arcs}
  </g>
  <polygon points="{pts}" fill="#fff" filter="url(#s)"/>
</svg>
"""


# ------------------------------------------------------------------- illustrations
def radial_glow(w, h, cx, cy, radius, color, strength):
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color + (int(255 * strength),))
    return glow.filter(ImageFilter.GaussianBlur(radius * 0.45))


def draw_phone(img: Image.Image, x, y, w, h, dark: bool, k: float):
    """Phone mock showing the Dial surface. Coordinates already supersampled."""
    d = ImageDraw.Draw(img)
    frame = INK_700 if dark else (205, 205, 220)
    body = (6, 6, 10)
    r = int(w * 0.16)
    # shadow
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([x + 10 * k, y + 30 * k, x + w + 10 * k, y + h + 30 * k], radius=r, fill=(0, 0, 0, 120 if dark else 60))
    sh = sh.filter(ImageFilter.GaussianBlur(40 * k))
    img.alpha_composite(sh)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=frame)
    inset = int(w * 0.035)
    sx0, sy0, sx1, sy1 = x + inset, y + inset, x + w - inset, y + h - inset
    d.rounded_rectangle([sx0, sy0, sx1, sy1], radius=r - inset, fill=body)
    sw, shh = sx1 - sx0, sy1 - sy0
    # dynamic island
    iw, ih = sw * 0.30, sw * 0.085
    d.rounded_rectangle([sx0 + (sw - iw) / 2, sy0 + sw * 0.04, sx0 + (sw + iw) / 2, sy0 + sw * 0.04 + ih], radius=int(ih / 2), fill=(0, 0, 0))
    # status strip
    f_small = font("semibold", int(sw * 0.052))
    sy = sy0 + sw * 0.19
    d.ellipse([sx0 + sw * 0.08, sy, sx0 + sw * 0.08 + sw * 0.035, sy + sw * 0.035], fill=MINT)
    d.text((sx0 + sw * 0.14, sy - sw * 0.016), "Studio MacBook · 9 ms", font=f_small, fill=INK_400)
    f_micro = font("bold", int(sw * 0.045))
    d.text((sx0 + sw * 0.08, sy0 + sw * 0.30), "SCRUB  ·  PREMIERE PRO", font=f_micro, fill=VIOLET_LIGHT)

    # dial ring
    ccx, ccy = sx0 + sw / 2, sy0 + shh * 0.52
    R = sw * 0.36
    ring_w = int(sw * 0.075)
    d.ellipse([ccx - R, ccy - R, ccx + R, ccy + R], outline=INK_800, width=ring_w)
    # active arc with glow
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).arc([ccx - R, ccy - R, ccx + R, ccy + R], 135, 330, fill=VIOLET + (255,), width=ring_w)
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(18 * k)))
    d = ImageDraw.Draw(img)
    d.arc([ccx - R, ccy - R, ccx + R, ccy + R], 135, 330, fill=VIOLET, width=ring_w)
    # ticks
    for i in range(48):
        a = math.radians(i * 7.5)
        r0, r1 = R + ring_w * 0.9, R + ring_w * (1.35 if i % 6 == 0 else 1.15)
        col = INK_400 if i % 6 == 0 else INK_700
        d.line([(ccx + r0 * math.cos(a), ccy + r0 * math.sin(a)), (ccx + r1 * math.cos(a), ccy + r1 * math.sin(a))], fill=col, width=max(2, int(3 * k)))
    # knob dot
    a = math.radians(330)
    kx, ky = ccx + (R - ring_w / 2) * math.cos(a), ccy + (R - ring_w / 2) * math.sin(a)
    kr = ring_w * 0.62
    d.ellipse([kx - kr, ky - kr, kx + kr, ky + kr], fill=(255, 255, 255))
    # value
    f_val = font("semibold", int(sw * 0.20))
    f_lab = font("semibold", int(sw * 0.055))
    txt = "01:24:17"
    tw = d.textlength(txt, font=font("semibold", int(sw * 0.115)))
    d.text((ccx - tw / 2, ccy - sw * 0.10), txt, font=font("semibold", int(sw * 0.115)), fill=INK_100)
    lab = "FRAME 17 / 24"
    lw = d.textlength(lab, font=f_lab)
    d.text((ccx - lw / 2, ccy + sw * 0.06), lab, font=f_lab, fill=INK_400)
    # bottom buttons
    by0 = sy0 + shh * 0.83
    bh = shh * 0.085
    gap = sw * 0.04
    bw = (sw - sw * 0.16 - gap) / 2
    bx = sx0 + sw * 0.08
    d.rounded_rectangle([bx, by0, bx + bw, by0 + bh], radius=int(bh * 0.32), fill=VIOLET)
    d.rounded_rectangle([bx + bw + gap, by0, bx + 2 * bw + gap, by0 + bh], radius=int(bh * 0.32), fill=INK_800)
    f_btn = font("semibold", int(sw * 0.058))
    for label, x0, col in (("Play", bx, (255, 255, 255)), ("Cut", bx + bw + gap, INK_100)):
        tw = d.textlength(label, font=f_btn)
        d.text((x0 + (bw - tw) / 2, by0 + bh * 0.22), label, font=f_btn, fill=col)
    # home indicator
    hw = sw * 0.32
    d.rounded_rectangle([ccx - hw / 2, sy1 - sw * 0.05, ccx + hw / 2, sy1 - sw * 0.035], radius=6, fill=INK_700)


def chip(d: ImageDraw.ImageDraw, x, y, label, f, dark, k, accent=False):
    pad_x, h = 22 * k, 46 * k
    tw = d.textlength(label, font=f)
    fill = (VIOLET if accent else (INK_800 if dark else (238, 236, 250)))
    outline = None if accent else (INK_700 if dark else PAPER_200)
    col = (255, 255, 255) if accent else (INK_100 if dark else SLATE_900)
    d.rounded_rectangle([x, y, x + tw + 2 * pad_x, y + h], radius=int(h / 2), fill=fill, outline=outline, width=max(1, int(1.5 * k)))
    bbox = f.getbbox(label)
    d.text((x + pad_x, y + (h - (bbox[3] + bbox[1])) / 2), label, font=f, fill=col)
    return x + tw + 2 * pad_x + 12 * k


def hero(w: int, h: int, dark: bool, social=False) -> Image.Image:
    k = SS * (h / 640.0)
    W, H = w * SS, h * SS
    bg = INK_950 if dark else PAPER_50
    img = Image.new("RGBA", (W, H), bg + (255,))
    img.alpha_composite(radial_glow(W, H, int(W * 0.78), int(H * 0.45), int(H * 0.55), VIOLET, 0.55 if dark else 0.22))
    img.alpha_composite(radial_glow(W, H, int(W * 0.10), int(H * 1.05), int(H * 0.45), MINT, 0.10 if dark else 0.06))
    # subtle dot grid
    d = ImageDraw.Draw(img)
    step = int(32 * k)
    dot = INK_800 if dark else (232, 232, 242)
    for gx in range(0, W, step):
        for gy in range(0, H, step):
            d.ellipse([gx - k, gy - k, gx + k, gy + k], fill=dot)

    # phone (right)
    ph = H * 0.86
    pw = ph * 0.49
    px, py = W * 0.70, H * 0.10
    draw_phone(img, px, py, pw, ph, dark, k)
    d = ImageDraw.Draw(img)

    # air waves between text and phone
    cx, cy = px - 30 * k, py + ph * 0.52
    for i, r in enumerate(() if social else (60, 110, 160)):
        rr = r * k
        col = VIOLET_LIGHT if dark else VIOLET
        alpha = (170, 110, 60)[i]
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(layer).arc([cx - rr, cy - rr, cx + rr, cy + rr], 150, 210, fill=col + (alpha,), width=int(10 * k))
        img.alpha_composite(layer)
    d = ImageDraw.Draw(img)

    # left: logo + wordmark + tagline
    lx = int(W * 0.065)
    logo_px = int(112 * k)
    logo = draw_logo(logo_px)
    ly = int(H * 0.17)
    img.alpha_composite(logo, (lx, ly))
    d = ImageDraw.Draw(img)
    f_word = font("semibold", int(92 * k))
    text_col = INK_100 if dark else SLATE_900
    d.text((lx + logo_px + 28 * k, ly + logo_px / 2 - 62 * k), "Vanepoint", font=f_word, fill=text_col)

    f_tag = font("semibold", int(44 * k))
    f_sub = font("regular", int(27 * k))
    ty = ly + logo_px + 54 * k
    d.text((lx, ty), "Your phone is the best input", font=f_tag, fill=text_col)
    d.text((lx, ty + 58 * k), "device you already own.", font=f_tag, fill=VIOLET_LIGHT if dark else VIOLET_DEEP)
    sub_col = INK_400 if dark else SLATE_600
    d.text((lx, ty + 138 * k), "Air mouse · presenter remote · inertia trackball · precision dial", font=f_sub, fill=sub_col)
    d.text((lx, ty + 176 * k), "Low-latency, haptic, end-to-end encrypted. Open source.", font=f_sub, fill=sub_col)

    f_chip = font("semibold", int(21 * k))
    cx0, cy0 = lx, ty + 240 * k
    for i, lab in enumerate(["iOS", "Android", "macOS", "Windows"]):
        cx0 = chip(d, cx0, cy0, lab, f_chip, dark, k, accent=False)
    if social:
        d.text((lx, H - 70 * k), "github.com/vanepoint-hq/vanepoint", font=font("semibold", int(24 * k)), fill=sub_col)
    return img.convert("RGB").resize((w, h), Image.LANCZOS)


def main():
    (OUT / "logo.svg").write_text(logo_svg(), encoding="utf-8")
    draw_logo(512).save(OUT / "logo-512.png")
    draw_logo(1024).save(OUT / "logo-1024.png")
    hero(1600, 640, dark=True).save(OUT / "banner-dark.png", optimize=True)
    hero(1600, 640, dark=False).save(OUT / "banner-light.png", optimize=True)
    hero(1280, 640, dark=True, social=True).save(OUT / "social-preview.png", optimize=True)
    print("wrote:", ", ".join(sorted(p.name for p in OUT.glob("*.*"))))


if __name__ == "__main__":
    main()
