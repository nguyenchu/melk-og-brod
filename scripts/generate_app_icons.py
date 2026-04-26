#!/usr/bin/env python3

import math
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets" / "images"


def make_canvas(width, height, color=(0, 0, 0, 0)):
  row = [list(color) for _ in range(width)]
  return [[pixel[:] for pixel in row] for _ in range(height)]


def blend_pixel(canvas, x, y, color):
  height = len(canvas)
  width = len(canvas[0])
  if x < 0 or y < 0 or x >= width or y >= height:
    return

  sr, sg, sb, sa = color
  if sa <= 0:
    return

  dst = canvas[y][x]
  dr, dg, db, da = dst
  src_a = sa / 255.0
  dst_a = da / 255.0
  out_a = src_a + dst_a * (1.0 - src_a)
  if out_a <= 0:
    canvas[y][x] = [0, 0, 0, 0]
    return

  out_r = (sr * src_a + dr * dst_a * (1.0 - src_a)) / out_a
  out_g = (sg * src_a + dg * dst_a * (1.0 - src_a)) / out_a
  out_b = (sb * src_a + db * dst_a * (1.0 - src_a)) / out_a
  canvas[y][x] = [round(out_r), round(out_g), round(out_b), round(out_a * 255)]


def fill_rect(canvas, x0, y0, x1, y1, color):
  for y in range(max(0, y0), min(len(canvas), y1)):
    for x in range(max(0, x0), min(len(canvas[0]), x1)):
      blend_pixel(canvas, x, y, color)


def fill_circle(canvas, cx, cy, radius, color):
  left = max(0, int(cx - radius))
  right = min(len(canvas[0]), int(cx + radius + 1))
  top = max(0, int(cy - radius))
  bottom = min(len(canvas), int(cy + radius + 1))
  r2 = radius * radius
  for y in range(top, bottom):
    for x in range(left, right):
      dx = x + 0.5 - cx
      dy = y + 0.5 - cy
      if dx * dx + dy * dy <= r2:
        blend_pixel(canvas, x, y, color)


def fill_rounded_rect(canvas, x0, y0, x1, y1, radius, color):
  left = max(0, x0)
  right = min(len(canvas[0]), x1)
  top = max(0, y0)
  bottom = min(len(canvas), y1)
  for y in range(top, bottom):
    for x in range(left, right):
      dx = min(x + 0.5 - x0, x1 - (x + 0.5))
      dy = min(y + 0.5 - y0, y1 - (y + 0.5))
      if dx >= radius or dy >= radius:
        blend_pixel(canvas, x, y, color)
      else:
        cx = x0 + radius if x + 0.5 < x0 + radius else x1 - radius
        cy = y0 + radius if y + 0.5 < y0 + radius else y1 - radius
        if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius ** 2:
          blend_pixel(canvas, x, y, color)


def point_in_polygon(x, y, points):
  inside = False
  j = len(points) - 1
  for i in range(len(points)):
    xi, yi = points[i]
    xj, yj = points[j]
    intersects = ((yi > y) != (yj > y)) and (
      x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi
    )
    if intersects:
      inside = not inside
    j = i
  return inside


def fill_polygon(canvas, points, color):
  min_x = max(0, int(min(x for x, _ in points)))
  max_x = min(len(canvas[0]), int(max(x for x, _ in points) + 1))
  min_y = max(0, int(min(y for _, y in points)))
  max_y = min(len(canvas), int(max(y for _, y in points) + 1))
  for y in range(min_y, max_y):
    for x in range(min_x, max_x):
      if point_in_polygon(x + 0.5, y + 0.5, points):
        blend_pixel(canvas, x, y, color)


def fill_droplet(canvas, cx, cy, size, color):
  fill_circle(canvas, cx, cy + size * 0.12, size * 0.34, color)
  fill_polygon(
    canvas,
    [
      (cx, cy - size * 0.52),
      (cx - size * 0.28, cy + size * 0.02),
      (cx + size * 0.28, cy + size * 0.02),
    ],
    color,
  )


def draw_logo(canvas, transparent_background=False, monochrome=False):
  width = len(canvas[0])
  height = len(canvas)

  cream = (255, 244, 232, 255)
  red = (216, 63, 58, 255)
  red_dark = (177, 42, 38, 255)
  gold = (228, 169, 73, 255)
  gold_dark = (193, 131, 41, 255)
  white = (255, 255, 255, 255)
  shadow = (119, 56, 20, 26)
  mono = (32, 32, 32, 255)

  if not transparent_background:
    fill_rect(canvas, 0, 0, width, height, cream)

  symbol_scale = width / 1024.0

  def s(value):
    return int(round(value * symbol_scale))

  if not monochrome:
    fill_circle(canvas, s(525), s(820), s(240), shadow)

  milk_color = mono if monochrome else red
  milk_shade = mono if monochrome else red_dark
  bread_color = mono if monochrome else gold
  bread_shade = mono if monochrome else gold_dark
  accent = (255, 255, 255, 255) if not monochrome else (255, 255, 255, 0)

  fill_rounded_rect(canvas, s(430), s(458), s(828), s(740), s(74), bread_color)
  fill_circle(canvas, s(520), s(468), s(90), bread_color)
  fill_circle(canvas, s(640), s(438), s(102), bread_color)
  fill_circle(canvas, s(764), s(470), s(86), bread_color)
  fill_rounded_rect(canvas, s(452), s(610), s(806), s(652), s(20), bread_shade)

  fill_polygon(
    canvas,
    [
      (s(238), s(300)),
      (s(462), s(300)),
      (s(516), s(374)),
      (s(516), s(774)),
      (s(238), s(774)),
    ],
    milk_color,
  )
  fill_polygon(
    canvas,
    [
      (s(238), s(300)),
      (s(352), s(230)),
      (s(462), s(300)),
      (s(516), s(374)),
      (s(404), s(374)),
    ],
    milk_shade,
  )
  fill_polygon(
    canvas,
    [
      (s(352), s(230)),
      (s(430), s(278)),
      (s(392), s(356)),
      (s(318), s(312)),
    ],
    white if not monochrome else mono,
  )
  fill_droplet(canvas, s(377), s(515), s(145), accent)
  fill_rect(canvas, s(278), s(660), s(456), s(690), accent)
  fill_rect(canvas, s(278), s(708), s(420), s(734), accent)


def resize_nearest(source, new_width, new_height):
  src_height = len(source)
  src_width = len(source[0])
  out = make_canvas(new_width, new_height)
  for y in range(new_height):
    src_y = min(src_height - 1, int(y * src_height / new_height))
    for x in range(new_width):
      src_x = min(src_width - 1, int(x * src_width / new_width))
      out[y][x] = source[src_y][src_x][:]
  return out


def write_png(path, canvas):
  height = len(canvas)
  width = len(canvas[0])
  raw = bytearray()
  for row in canvas:
    raw.append(0)
    for r, g, b, a in row:
      raw.extend((r, g, b, a))

  def chunk(name, data):
    return (
      struct.pack(">I", len(data))
      + name
      + data
      + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)
    )

  png = bytearray(b"\x89PNG\r\n\x1a\n")
  png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
  png.extend(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
  png.extend(chunk(b"IEND", b""))
  path.write_bytes(png)


def main():
  icon = make_canvas(1024, 1024)
  draw_logo(icon)
  write_png(ASSETS / "icon.png", icon)

  adaptive_bg = make_canvas(512, 512, (255, 244, 232, 255))
  write_png(ASSETS / "android-icon-background.png", adaptive_bg)

  adaptive_fg = make_canvas(512, 512)
  draw_logo(adaptive_fg, transparent_background=True)
  write_png(ASSETS / "android-icon-foreground.png", adaptive_fg)

  mono = make_canvas(432, 432)
  draw_logo(mono, transparent_background=True, monochrome=True)
  write_png(ASSETS / "android-icon-monochrome.png", mono)

  favicon = resize_nearest(icon, 48, 48)
  write_png(ASSETS / "favicon.png", favicon)


if __name__ == "__main__":
  main()
