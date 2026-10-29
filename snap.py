"""Make Claude's marks land on the actual ink.

Claude's coordinates are close but loose (it reads a downscaled screenshot). Here, on the
full-res frame, each mark's box is pulled tight around the strokes it covers, and a point is
grown into the glyph group under it. Also builds a coarse ink map so the overlay can put
labels in empty space instead of on top of the problem.
"""
from collections import deque

import numpy as np

INK_CELL = 12  # px per ink-map cell (physical)


def luminance(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def _ink(lum, x1, y1, x2, y2):
    """Boolean ink mask for a region: pixels that differ from the region's background."""
    region = lum[y1:y2, x1:x2]
    if region.size == 0:
        return region.astype(bool)
    border = np.concatenate([region[0], region[-1], region[:, 0], region[:, -1]])
    bg = np.median(border)
    return np.abs(region - bg) > 48


def _dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def _clamp_box(b, w, h):
    x1, y1, x2, y2 = b
    return max(0, int(x1)), max(0, int(y1)), min(w, int(x2)), min(h, int(y2))


def tighten_box(lum, box, pad=5, slack=10):
    """Shrink/grow a box to the ink inside it (with a little slack for loose aim)."""
    h, w = lum.shape
    x1, y1, x2, y2 = _clamp_box((box[0] - slack, box[1] - slack, box[2] + slack, box[3] + slack), w, h)
    if x2 - x1 < 4 or y2 - y1 < 4:
        return box
    ink = _ink(lum, x1, y1, x2, y2)
    ys, xs = np.nonzero(ink)
    if len(xs) < 6:
        return box
    # ignore lone specks at the edges: keep the central 98% of ink
    lx, hx = np.percentile(xs, [1, 99])
    ly, hy = np.percentile(ys, [1, 99])
    return [x1 + lx - pad, y1 + ly - pad, x1 + hx + pad, y1 + hy + pad]


def grow_point(lum, x, y, rx=70, ry=40, pad=5):
    """The glyph group under/nearest a point: connected ink (letters merged by dilation)."""
    h, w = lum.shape
    x1, y1, x2, y2 = _clamp_box((x - rx, y - ry, x + rx, y + ry), w, h)
    ink = _ink(lum, x1, y1, x2, y2)
    if not ink.any():
        return None
    merged = _dilate(ink, 3)
    ys, xs = np.nonzero(merged)
    px, py = x - x1, y - y1
    i = np.argmin((xs - px) ** 2 + (ys - py) ** 2)
    sx, sy = xs[i], ys[i]
    if (sx - px) ** 2 + (sy - py) ** 2 > 30 ** 2:
        return None
    seen = np.zeros_like(merged)
    q = deque([(sy, sx)])
    seen[sy, sx] = True
    minx = maxx = sx
    miny = maxy = sy
    H, W = merged.shape
    while q:
        cy, cx = q.popleft()
        minx, maxx, miny, maxy = min(minx, cx), max(maxx, cx), min(miny, cy), max(maxy, cy)
        for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
            if 0 <= ny < H and 0 <= nx < W and merged[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return [x1 + minx - pad + 3, y1 + miny - pad + 3, x1 + maxx + pad - 3, y1 + maxy + pad - 3]


FLOATING = ("work", "graph")   # cards that may stand on their own, with nothing on screen to point at


def snap(rgb, marks, scale):
    """rgb: full-res frame. marks: Claude's, in screenshot px. scale: full-res px per screenshot px.
    Returns marks in full-res px, each with a tight 'box'."""
    lum = luminance(rgb.astype(np.float32))
    out = []
    for m in marks:
        m = dict(m)
        t = m.get("t") or m.get("type")
        m["t"] = t
        try:
            if t in FLOATING and not isinstance(m.get("box"), list):
                m.pop("box", None)   # a graph's "x"/"y" are axis ranges, not a point
            elif "box" in m:
                b = [v * scale for v in m["box"]]
                m["box"] = tighten_box(lum, b)
            elif "x" in m and "y" in m:
                x, y = m["x"] * scale, m["y"] * scale
                m["x"], m["y"] = x, y
                m["box"] = grow_point(lum, x, y) or [x - 14, y - 14, x + 14, y + 14]
            elif t not in FLOATING:
                continue
        except (TypeError, ValueError, IndexError):
            continue
        out.append(m)
    return out


def ink_map(rgb):
    """Coarse occupancy grid: '1' where a cell has content. Rows of '0'/'1' strings."""
    lum = luminance(rgb.astype(np.float32))
    h, w = lum.shape
    rows, cols = h // INK_CELL, w // INK_CELL
    cells = lum[: rows * INK_CELL, : cols * INK_CELL].reshape(rows, INK_CELL, cols, INK_CELL)
    busy = cells.std(axis=(1, 3)) > 10
    return {"cell": INK_CELL, "rows": ["".join("1" if v else "0" for v in r) for r in busy]}
