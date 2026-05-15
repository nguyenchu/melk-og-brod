"""Generate a discount-tag style app icon for Melk og Brød.

Renders at 4x size then downsamples for smooth edges (supersampling).
"""
from PIL import Image, ImageDraw, ImageFont

FINAL = 1024
SCALE = 4
SIZE = FINAL * SCALE

OUT = "assets/images/icon.png"
OUT_512 = "assets/images/icon-512.png"

RED      = (225, 10, 10)
WHITE    = (255, 255, 255)
CREAM    = (252, 240, 220)

FONT_PATH = "/System/Library/Fonts/HelveticaNeue.ttc"


def rrect(draw, xy, r, fill):
    x0, y0, x1, y1 = xy
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    for cx, cy in [(x0, y0), (x1 - 2*r, y0), (x0, y1 - 2*r), (x1 - 2*r, y1 - 2*r)]:
        draw.ellipse([cx, cy, cx + 2*r, cy + 2*r], fill=fill)


# 1. Solid red background
img = Image.new("RGBA", (SIZE, SIZE), RED + (255,))

# 2. Build the tag on a larger transparent layer so rotation has room
LAYER = int(SIZE * 1.5)
layer = Image.new("RGBA", (LAYER, LAYER), (0, 0, 0, 0))
ld = ImageDraw.Draw(layer)

lcx = LAYER // 2
lcy = LAYER // 2

# Tag body
tag_w = int(SIZE * 0.66)
tag_h = int(SIZE * 0.48)
tag_l = lcx - tag_w // 2 + int(SIZE * 0.06)
tag_t = lcy - tag_h // 2
tag_r = tag_l + tag_w
tag_b = tag_t + tag_h
corner = int(SIZE * 0.05)
rrect(ld, [tag_l, tag_t, tag_r, tag_b], corner, WHITE)

# Triangular point on left
point_tip_x = tag_l - int(SIZE * 0.14)
ld.polygon([
    (tag_l + corner, tag_t + corner),
    (tag_l + corner, tag_b - corner),
    (point_tip_x, lcy),
], fill=WHITE)

# Smooth the join between body and point (cover any anti-alias seam)
ld.rectangle([tag_l, tag_t + corner, tag_l + corner * 2, tag_b - corner], fill=WHITE)

# Hole near the tip — drawn red so it blends with background after rotation
hole_r = int(SIZE * 0.058)
hole_cx = tag_l - int(SIZE * 0.005)
hole_cy = lcy
ld.ellipse([hole_cx - hole_r, hole_cy - hole_r,
            hole_cx + hole_r, hole_cy + hole_r], fill=RED + (255,))

# Percent symbol with a real bold font, drawn in red on the tag
font_size = int(SIZE * 0.38)
try:
    font = ImageFont.truetype(FONT_PATH, font_size, index=1)  # bold variant
except Exception:
    font = ImageFont.truetype(FONT_PATH, font_size)

text = "%"
# Measure & center inside tag (slightly right of geometric center to balance the point)
bbox = ld.textbbox((0, 0), text, font=font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
text_cx = (tag_l + tag_r) // 2 + int(SIZE * 0.04)
text_cy = (tag_t + tag_b) // 2
text_x = text_cx - tw // 2 - bbox[0]
text_y = text_cy - th // 2 - bbox[1]
ld.text((text_x, text_y), text, font=font, fill=RED + (255,))

# 3. Rotate slightly for dynamic feel
rotated = layer.rotate(-9, resample=Image.BICUBIC, expand=False)
img.paste(rotated, ((SIZE - LAYER) // 2, (SIZE - LAYER) // 2), rotated)

# 4. Small cream milk-drop accent in upper-left to keep brand identity
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

# 5. Downsample with high-quality resampling for smooth edges
final = img.resize((FINAL, FINAL), Image.LANCZOS).convert("RGB")
final.save(OUT, "PNG", optimize=True)
final.resize((512, 512), Image.LANCZOS).save(OUT_512, "PNG", optimize=True)
print(f"Saved {OUT} and {OUT_512}")
