"""Generate a redesigned app icon for Melk og Brød."""
from PIL import Image, ImageDraw

SIZE = 1024
OUT = "assets/images/icon.png"
OUT_512 = "assets/images/icon-512.png"

BG     = (250, 246, 240, 255)
RED    = (225, 10, 10)
RED_D  = (175, 8, 8)
WHITE  = (255, 255, 255)
BREAD  = (205, 150, 45)
BREAD_D = (160, 112, 22)


def rrect(draw, x0, y0, x1, y1, r, fill):
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    for cx, cy in [(x0, y0), (x1 - 2*r, y0), (x0, y1 - 2*r), (x1 - 2*r, y1 - 2*r)]:
        draw.ellipse([cx, cy, cx + 2*r, cy + 2*r], fill=fill)


def draw_bread(draw, cx, cy, w, h):
    bx, by = cx - w // 2, cy - h // 2

    # Body
    body_top = by + h // 3
    rrect(draw, bx, body_top, bx + w, by + h, 12, BREAD)

    # Crust bottom strip
    crust = h // 9
    rrect(draw, bx, by + h - crust, bx + w, by + h, 12, BREAD_D)

    # Three bumps on top
    bump_r = int(w * 0.175)
    bump_overlap = int(bump_r * 0.55)
    for i in range(3):
        bx_c = int(bx + (i + 0.5) * (w / 3))
        draw.ellipse([bx_c - bump_r, body_top - bump_r + bump_overlap,
                      bx_c + bump_r, body_top + bump_r + bump_overlap], fill=BREAD)

    # Highlight on center bump
    hl_r = int(bump_r * 0.38)
    mx = cx
    my = body_top - int(bump_r * 0.15)
    draw.ellipse([mx - hl_r, my - int(hl_r * 0.6), mx + hl_r, my + int(hl_r * 0.6)],
                 fill=(228, 182, 88))


def draw_carton(draw, cx, cy, w, h):
    bx, by = cx - w // 2, cy - h // 2

    roof_h = int(h * 0.15)
    body_top = by + roof_h

    # Body
    rrect(draw, bx, body_top, bx + w, by + h, 10, RED)

    # Gable roof
    peak_x = bx + w // 2
    draw.polygon([(bx, body_top), (bx + w, body_top), (peak_x, by)], fill=RED_D)

    # White flap at peak
    fw = int(w * 0.20)
    fh = int(roof_h * 0.70)
    draw.polygon([
        (peak_x - fw // 2, by + roof_h - fh),
        (peak_x + fw // 2, by + roof_h - fh),
        (peak_x, by),
    ], fill=WHITE)

    # Water drop (teardrop: pointed top, round bottom)
    drop_cx = bx + w // 2
    drop_cy = by + roof_h + int((h - roof_h) * 0.40)
    r = int(w * 0.195)
    tip_h = int(r * 1.0)
    # Circle (bottom of drop)
    draw.ellipse([drop_cx - r, drop_cy - r, drop_cx + r, drop_cy + r], fill=WHITE)
    # Triangle tip (pointing up)
    draw.polygon([
        (drop_cx - int(r * 0.62), drop_cy - int(r * 0.55)),
        (drop_cx + int(r * 0.62), drop_cy - int(r * 0.55)),
        (drop_cx, drop_cy - r - tip_h),
    ], fill=WHITE)

    # Two label stripes at bottom
    stripe_h = int(h * 0.048)
    gap = int(h * 0.028)
    margin = int(w * 0.14)
    y1 = by + h - int(h * 0.20)
    draw.rectangle([bx + margin, y1, bx + w - margin, y1 + stripe_h], fill=WHITE)
    draw.rectangle([bx + margin, y1 + stripe_h + gap,
                    bx + w - margin, y1 + stripe_h * 2 + gap], fill=WHITE)


img = Image.new("RGBA", (SIZE, SIZE), BG)
draw = ImageDraw.Draw(img)

# Dimensions — carton tall and narrow, bread shorter and wider
carton_w = int(SIZE * 0.36)
carton_h = int(SIZE * 0.58)
bread_w  = int(SIZE * 0.44)
bread_h  = int(SIZE * 0.30)

# Vertical center of both objects together
mid_y = SIZE // 2 + SIZE // 40

# Horizontal: overlap them so carton is in front-left, bread behind-right
carton_cx = SIZE // 2 - int(SIZE * 0.07)
carton_cy = mid_y

bread_cx = carton_cx + int(carton_w * 0.50)
bread_cy = mid_y + int(carton_h * 0.22)

# Draw bread first (behind)
draw_bread(draw, bread_cx, bread_cy, bread_w, bread_h)
# Draw carton on top
draw_carton(draw, carton_cx, carton_cy, carton_w, carton_h)

out = img.convert("RGB")
out.save(OUT, "PNG", optimize=True)
out.resize((512, 512), Image.LANCZOS).save(OUT_512, "PNG", optimize=True)
print(f"Saved {OUT} and {OUT_512}")
