"""Generate a discount-tag style app icon for Melk og Brød.

Produces:
  icon.png / icon-512.png             — full app icon (red bg + tag + drop)
  android-icon-foreground.png         — tag only, transparent bg, safe-area padded
  android-icon-background.png         — solid red background
  android-icon-monochrome.png         — tag silhouette in white with hole + % cut out

Renders at 4x size then downsamples for smooth edges (supersampling).
"""
from PIL import Image, ImageDraw, ImageFont

FINAL = 1024
SCALE = 4
SIZE = FINAL * SCALE

OUT = "assets/images/icon.png"
OUT_512 = "assets/images/icon-512.png"
OUT_ANDROID_FG = "assets/images/android-icon-foreground.png"
OUT_ANDROID_BG = "assets/images/android-icon-background.png"
OUT_ANDROID_MONO = "assets/images/android-icon-monochrome.png"
OUT_SPLASH = "assets/images/splash-icon.png"

RED      = (225, 10, 10)
WHITE    = (255, 255, 255)
CREAM    = (252, 240, 220)

FONT_PATH = "/System/Library/Fonts/HelveticaNeue.ttc"


def rrect_mask(draw, xy, r, fill):
    x0, y0, x1, y1 = xy
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    for cx, cy in [(x0, y0), (x1 - 2*r, y0), (x0, y1 - 2*r), (x1 - 2*r, y1 - 2*r)]:
        draw.ellipse([cx, cy, cx + 2*r, cy + 2*r], fill=fill)


def get_font(font_size):
    try:
        return ImageFont.truetype(FONT_PATH, font_size, index=1)
    except Exception:
        return ImageFont.truetype(FONT_PATH, font_size)


def build_tag_alpha(size, color=WHITE):
    """Build the tag as an RGBA image where the silhouette is `color` and the
    hole + % area are transparent. Returns the layer rotated by -9°."""
    layer_size = int(size * 1.5)
    # L-mode mask: 255 where the tag is visible.
    mask = Image.new("L", (layer_size, layer_size), 0)
    md = ImageDraw.Draw(mask)

    lcx = layer_size // 2
    lcy = layer_size // 2

    tag_w = int(size * 0.66)
    tag_h = int(size * 0.48)
    tag_l = lcx - tag_w // 2 + int(size * 0.06)
    tag_t = lcy - tag_h // 2
    tag_r = tag_l + tag_w
    tag_b = tag_t + tag_h
    corner = int(size * 0.05)
    rrect_mask(md, [tag_l, tag_t, tag_r, tag_b], corner, 255)

    point_tip_x = tag_l - int(size * 0.14)
    md.polygon([
        (tag_l + corner, tag_t + corner),
        (tag_l + corner, tag_b - corner),
        (point_tip_x, lcy),
    ], fill=255)
    md.rectangle([tag_l, tag_t + corner, tag_l + corner * 2, tag_b - corner], fill=255)

    # Punch the tip hole.
    hole_r = int(size * 0.058)
    hole_cx = tag_l - int(size * 0.005)
    hole_cy = lcy
    md.ellipse([hole_cx - hole_r, hole_cy - hole_r,
                hole_cx + hole_r, hole_cy + hole_r], fill=0)

    # Punch the % glyph.
    font = get_font(int(size * 0.38))
    text = "%"
    bbox = md.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    text_cx = (tag_l + tag_r) // 2 + int(size * 0.04)
    text_cy = (tag_t + tag_b) // 2
    text_x = text_cx - tw // 2 - bbox[0]
    text_y = text_cy - th // 2 - bbox[1]
    md.text((text_x, text_y), text, font=font, fill=0)

    # Composite: solid `color` everywhere, alpha from mask.
    layer = Image.new("RGBA", (layer_size, layer_size), color + (0,))
    layer.putalpha(mask)
    return layer.rotate(-9, resample=Image.BICUBIC, expand=False)


def save_downsampled(img, path, final_size=FINAL, mode="RGB"):
    out = img.resize((final_size, final_size), Image.LANCZOS).convert(mode)
    out.save(path, "PNG", optimize=True)


def paste_centered(canvas, layer):
    canvas.paste(layer, ((canvas.width - layer.width) // 2,
                         (canvas.height - layer.height) // 2), layer)


# 1. Full app icon — red bg + white tag (% and hole transparent so bg shows red through them) + cream drop.
img = Image.new("RGBA", (SIZE, SIZE), RED + (255,))
paste_centered(img, build_tag_alpha(SIZE, color=WHITE))

fd = ImageDraw.Draw(img)
drop_cx = int(SIZE * 0.17)
drop_cy = int(SIZE * 0.18)
drop_r = int(SIZE * 0.042)
fd.ellipse([drop_cx - drop_r, drop_cy - drop_r,
            drop_cx + drop_r, drop_cy + drop_r], fill=CREAM + (255,))
tip_h = int(drop_r * 1.1)
fd.polygon([
    (drop_cx - int(drop_r * 0.58), drop_cy - int(drop_r * 0.55)),
    (drop_cx + int(drop_r * 0.58), drop_cy - int(drop_r * 0.55)),
    (drop_cx, drop_cy - drop_r - tip_h),
], fill=CREAM + (255,))

save_downsampled(img, OUT)
save_downsampled(img, OUT_512, final_size=512)

# 2. Android adaptive foreground — same tag shrunk to ~66% safe area, transparent bg.
fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
paste_centered(fg, build_tag_alpha(int(SIZE * 0.66), color=WHITE))
save_downsampled(fg, OUT_ANDROID_FG, mode="RGBA")

# 3. Android adaptive background — solid Meny red.
Image.new("RGB", (FINAL, FINAL), RED).save(OUT_ANDROID_BG, "PNG", optimize=True)

# 4. Android monochrome — same silhouette in white; launcher tints to theme color.
mono = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
paste_centered(mono, build_tag_alpha(int(SIZE * 0.66), color=WHITE))
save_downsampled(mono, OUT_ANDROID_MONO, mode="RGBA")

# 5. Splash icon — red tag with cut-out % on transparent bg.
# Renders against the cream splash background as a stand-alone discount tag.
splash = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
paste_centered(splash, build_tag_alpha(SIZE, color=RED))
save_downsampled(splash, OUT_SPLASH, mode="RGBA")

print(f"Saved:\n  {OUT}\n  {OUT_512}\n  {OUT_ANDROID_FG}\n  {OUT_ANDROID_BG}\n  {OUT_ANDROID_MONO}\n  {OUT_SPLASH}")
