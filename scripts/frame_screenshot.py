#!/usr/bin/env python3
"""
Setter et iOS-skjermbilde inn i en iPhone-ramme.

Bruk:
    python scripts/frame_screenshot.py screenshots/01_tilbud.png
    python scripts/frame_screenshot.py screenshots/*.png
"""

import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

# Rammeparametere (skaleres etter skjermbildets bredde)
SIDE_PADDING_RATIO = 0.055     # padding på hver side relativt til skjermbredde
TOP_PADDING_RATIO  = 0.055
BOTTOM_PADDING_RATIO = 0.045
CORNER_RADIUS_RATIO  = 0.11    # avrunding på ytre hjørner

FRAME_COLOR   = (20, 20, 22)   # nesten svart (titan-look)
BEZEL_COLOR   = (30, 30, 33)
SHADOW_RADIUS = 40
SHADOW_ALPHA  = 120

# Dynamic Island
ISLAND_HEIGHT_RATIO = 0.018
ISLAND_WIDTH_RATIO  = 0.28


def round_rect_mask(size, radius):
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return mask


def add_shadow(img, radius, alpha):
    shadow_base = Image.new("RGBA", img.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_base)
    shadow_draw.rectangle([radius, radius, img.width - radius, img.height - radius], fill=(0, 0, 0, alpha))
    shadow_base = shadow_base.filter(ImageFilter.GaussianBlur(radius))
    result = Image.new("RGBA", img.size, (0, 0, 0, 0))
    result.paste(shadow_base, (0, 0))
    result.paste(img, (0, 0), img)
    return result


def frame_screenshot(input_path: Path, output_path: Path):
    screen = Image.open(input_path).convert("RGBA")
    sw, sh = screen.size

    side   = int(sw * SIDE_PADDING_RATIO)
    top    = int(sh * TOP_PADDING_RATIO)
    bottom = int(sh * BOTTOM_PADDING_RATIO)

    phone_w = sw + side * 2
    phone_h = sh + top + bottom
    corner  = int(phone_w * CORNER_RADIUS_RATIO)

    # Telefon-kropp
    phone = Image.new("RGBA", (phone_w, phone_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(phone)

    # Ytre ramme (lys kant)
    draw.rounded_rectangle([0, 0, phone_w - 1, phone_h - 1], radius=corner, fill=(55, 55, 58))

    # Indre kropp
    inset = 4
    draw.rounded_rectangle(
        [inset, inset, phone_w - inset - 1, phone_h - inset - 1],
        radius=corner - inset,
        fill=FRAME_COLOR,
    )

    # Skjermvindu (svart bak avrunding)
    screen_x, screen_y = side, top
    draw.rounded_rectangle(
        [screen_x - 2, screen_y - 2, screen_x + sw + 1, screen_y + sh + 1],
        radius=int(corner * 0.35),
        fill=(0, 0, 0),
    )

    # Lim inn skjermbilde
    screen_mask = round_rect_mask((sw, sh), int(corner * 0.33))
    phone.paste(screen, (screen_x, screen_y), screen_mask)

    # Dynamic Island
    iw = int(sw * ISLAND_WIDTH_RATIO)
    ih = int(sh * ISLAND_HEIGHT_RATIO)
    ix = screen_x + (sw - iw) // 2
    iy = screen_y + int(sh * 0.008)
    draw.rounded_rectangle([ix, iy, ix + iw, iy + ih], radius=ih // 2, fill=(0, 0, 0))

    # Legg til skygge og lagre på hvit bakgrunn
    canvas_pad = SHADOW_RADIUS * 2
    canvas = Image.new("RGBA", (phone_w + canvas_pad * 2, phone_h + canvas_pad * 2), (255, 255, 255, 255))
    phone_with_shadow = add_shadow(
        Image.new("RGBA", (phone_w + canvas_pad * 2, phone_h + canvas_pad * 2), (0, 0, 0, 0)),
        SHADOW_RADIUS,
        SHADOW_ALPHA,
    )
    # Tegn shadow-form
    shadow_img = Image.new("RGBA", (phone_w + canvas_pad * 2, phone_h + canvas_pad * 2), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_img)
    shadow_draw.rounded_rectangle(
        [canvas_pad, canvas_pad, canvas_pad + phone_w - 1, canvas_pad + phone_h - 1],
        radius=corner,
        fill=(0, 0, 0, SHADOW_ALPHA),
    )
    shadow_img = shadow_img.filter(ImageFilter.GaussianBlur(SHADOW_RADIUS))
    canvas.paste(shadow_img, (0, 0), shadow_img)
    canvas.paste(phone, (canvas_pad, canvas_pad), phone)

    out = canvas.convert("RGB")
    out.save(output_path, quality=95)
    print(f"  ✓ {output_path}")


def main():
    if len(sys.argv) < 2:
        print("Bruk: python frame_screenshot.py <screenshot.png> [...]")
        sys.exit(1)

    for arg in sys.argv[1:]:
        p = Path(arg)
        if not p.exists():
            print(f"  ! Finner ikke: {p}")
            continue
        out = p.with_name(p.stem + "_framed.jpg")
        frame_screenshot(p, out)


if __name__ == "__main__":
    main()
