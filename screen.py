"""Screen capture for Capri: grab the monitor under the cursor, sized for Claude vision."""
import base64
import ctypes
import io
import math
from ctypes import wintypes

import mss
import numpy as np
from PIL import Image

MAX_EDGE = 1568            # Claude's vision sweet spot; bigger just gets downscaled server-side
MAX_PIXELS = 1_150_000
WDA_EXCLUDEFROMCAPTURE = 0x11


def cursor_pos():
    pt = wintypes.POINT()
    ctypes.windll.user32.GetCursorPos(ctypes.byref(pt))
    return pt.x, pt.y


def capture(at=None):
    """Grab the monitor containing `at` (physical px; default: the cursor).
    Returns (jpeg_b64, (img_w, img_h), (mon_left, mon_top, mon_w, mon_h), full_res_rgb)."""
    with mss.MSS() as sct:   # mss makes the process DPI-aware, so these are physical px
        cx, cy = at or cursor_pos()
        mon = next((m for m in sct.monitors[1:]
                    if m["left"] <= cx < m["left"] + m["width"] and m["top"] <= cy < m["top"] + m["height"]),
                   sct.monitors[1])
        shot = sct.grab(mon)
    img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    full = np.asarray(img)
    w, h = img.size
    scale = min(1.0, MAX_EDGE / max(w, h), math.sqrt(MAX_PIXELS / (w * h)))
    if scale < 1:
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    rect = (mon["left"], mon["top"], mon["width"], mon["height"])
    return base64.b64encode(buf.getvalue()).decode(), img.size, rect, full


def crop_b64(full, x1, y1, x2, y2, max_edge=1200):
    """A full-res crop (monitor px) as JPEG b64, for reading small things up close."""
    h, w = full.shape[:2]
    x1, y1, x2, y2 = max(0, int(x1)), max(0, int(y1)), min(w, int(x2)), min(h, int(y2))
    img = Image.fromarray(full[y1:y2, x1:x2])
    if max(img.size) > max_edge:
        k = max_edge / max(img.size)
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92)
    return base64.b64encode(buf.getvalue()).decode()


def hide_from_capture(hwnd):
    """Keep a window out of screenshots (and screen recordings) so Capri never sees herself."""
    return bool(ctypes.windll.user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE))


def find_window(title):
    return ctypes.windll.user32.FindWindowW(None, title)
