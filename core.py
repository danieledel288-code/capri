"""Capri's sidecar: the Electron app drives this over stdin/stdout, one JSON object per line.

in  {"op": "new_call"} | {"op": "say", "text"} | {"op": "ask", "text", "eye"} |
    {"op": "mic_down"} | {"op": "mic_up"} | {"op": "stop"}
out {"ev": "ready"} | {"ev": "heard", "text"} | {"ev": "thinking", "on"} | {"ev": "saw"} |
    {"ev": "reply", "text", "marks", "monitor", "ink"} | {"ev": "speaking", "on", "text"} |
    {"ev": "scrolled"} | {"ev": "log", "msg"}
"""
import ctypes
import json
import os
import sys
import threading
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)   # mouse hook + screen capture both in physical px

from pynput import keyboard, mouse

import screen
from brain import Brain
from snap import ink_map, snap
from voice import Listener, Speaker

DEBUG = bool(os.environ.get("CAPRI_DEBUG"))
CONFIG = json.loads(open("config.json", encoding="utf-8").read())
_out_lock = threading.Lock()
# the protocol owns the real stdout; stray prints from libraries go to stderr
_proto = sys.stdout
sys.stdout = sys.stderr


def emit(ev, **kw):
    with _out_lock:
        _proto.write(json.dumps({"ev": ev, **kw}) + "\n")
        _proto.flush()


def log(msg):
    emit("log", msg=str(msg))


class Core:
    def __init__(self):
        self.brain = Brain(model=CONFIG["model"])
        self.speaker = Speaker(voice=CONFIG["voice"], speed=CONFIG["voice_speed"],
                               pitch=CONFIG.get("voice_pitch", 0), comms_fx=CONFIG["comms_fx"])
        self.listener = Listener(model=CONFIG["stt_model"])
        self.turn = 0   # bumps on every new turn / hang-up, so stale replies are dropped

    def say(self, text, turn):
        if turn != self.turn:
            return
        emit("speaking", on=True, text=text)
        spoke = self.speaker.say(text, on_sentence=lambda s: turn == self.turn and emit("sentence", text=s))
        if not spoke:   # no TTS: still give the subtitles a moment on screen
            emit("sentence", text=text)
        if turn == self.turn:
            emit("speaking", on=False)

    def ask(self, text, eye, focus=None):
        """focus: [x1, y1, x2, y2] physical screen px of something Daniel highlighted (a ping)."""
        self.turn += 1
        turn = self.turn
        self.speaker.stop()
        emit("thinking", on=True)
        img = size = rect = full = None
        extra = []
        if eye or focus:
            try:
                img, size, rect, full = screen.capture(at=focus and ((focus[0] + focus[2]) // 2, (focus[1] + focus[3]) // 2))
                emit("saw")
            except Exception as e:
                log(f"capture failed: {e}")
        if focus and full is not None:
            # where it is in the screenshot, plus a full-res crop around it so small text reads cleanly
            k = size[0] / full.shape[1]
            fx1, fy1, fx2, fy2 = focus[0] - rect[0], focus[1] - rect[1], focus[2] - rect[0], focus[3] - rect[1]
            box = [round(v * k) for v in (fx1, fy1, fx2, fy2)]
            extra.append(screen.crop_b64(full, fx1 - 160, fy1 - 90, fx2 + 160, fy2 + 90))
            text = (f"[PING: Daniel just {'double-clicked' if fx2 - fx1 < 8 else 'highlighted'} something at "
                    f"box {box} in the screenshot. The second image is a zoomed crop around it. "
                    f"Figure out exactly what it is (a word, a symbol, an equation, a line of code...) and help with it.]\n{text}")
        # looking at work on screen: the stronger model (math accuracy beats a second of latency)
        model = CONFIG.get("work_model") if img else None
        reply, marks = self.brain.ask(text, img, size, extra, model=model)
        emit("thinking", on=False)
        if turn != self.turn:
            return
        payload = {"text": reply, "marks": [], "monitor": rect}
        if marks and full is not None:
            scale = full.shape[1] / size[0]
            payload["marks"] = snap(full, marks, scale)
            payload["ink"] = ink_map(full)
        elif marks:   # no screenshot: only the cards that stand on their own (plots, worked solutions)
            payload["marks"] = [dict(m, t=m.get("t") or m.get("type")) for m in marks
                                if (m.get("t") or m.get("type")) in ("work", "graph")]
            for m in payload["marks"]:
                m.pop("box", None)
        emit("reply", **payload)
        self.say(reply, turn)

    def mic_up(self, eye):
        text = self.listener.stop()
        if not text:
            emit("heard", text="")
            return
        emit("heard", text=text)
        self.ask(text, eye)

    def handle(self, msg):
        op = msg.get("op")
        if op == "new_call":
            self.turn += 1
            self.brain.new_call()
        elif op == "say":
            self.turn += 1
            threading.Thread(target=self.say, args=(msg["text"], self.turn), daemon=True).start()
        elif op == "ask":
            threading.Thread(target=self.ask, args=(msg["text"], msg.get("eye", True), msg.get("focus")), daemon=True).start()
        elif op == "mic_down":
            self.speaker.stop()
            self.listener.start()
        elif op == "mic_up":
            threading.Thread(target=self.mic_up, args=(msg.get("eye", True),), daemon=True).start()
        elif op == "mic_cancel":   # push-to-talk turned out to be a Ctrl+Win+<key> shortcut
            threading.Thread(target=self.listener.stop, daemon=True).start()
        elif op == "stop":
            self.turn += 1
            self.speaker.stop()


class Gestures:
    """Watches the mouse for a text selection (left-drag) or a double-click, and tells the app,
    which offers a 'ping Capri' tag by the pointer. Physical screen px."""
    DBL_MS, DBL_PX, DRAG_PX = 0.45, 6, 12

    def __init__(self):
        self.down = None        # (x, y, t) of the current left press
        self.last_up = None     # (x, y, t) of the previous left release

    def on_click(self, x, y, button, pressed):
        if button != mouse.Button.left:
            return
        now = time.monotonic()
        if pressed:
            self.down = (x, y, now)
            return
        if not self.down:
            return
        dx, dy, dt = x, y, now
        sx, sy, st = self.down
        self.down = None
        w, h = abs(dx - sx), abs(dy - sy)
        if (w > self.DRAG_PX or h > self.DRAG_PX) and dt - st < 6 and h < 500:   # a selection, not a long window drag
            emit("gesture", kind="select", rect=[min(sx, dx), min(sy, dy) - 12, max(sx, dx), max(sy, dy) + 12], pos=[dx, dy])
            self.last_up = None
            return
        if self.last_up:
            lx, ly, lt = self.last_up
            if dt - lt < self.DBL_MS and abs(dx - lx) < self.DBL_PX and abs(dy - ly) < self.DBL_PX:
                emit("gesture", kind="double", rect=[dx - 40, dy - 16, dx + 40, dy + 16], pos=[dx, dy])
                self.last_up = None
                return
        self.last_up = (dx, dy, dt)


class PushToTalk:
    """Hold Ctrl+Win anywhere to talk (like Wispr Flow). Emits ptt on/off, or cancel when a third key
    joins in, because then it was a Windows shortcut (Ctrl+Win+arrow switches desktops)."""
    MASK_VK = 0xE8   # unassigned virtual key: tapping it stops Windows reading the Win release as "open Start"
    CTRL = {keyboard.Key.ctrl, keyboard.Key.ctrl_l, keyboard.Key.ctrl_r}
    WIN = {keyboard.Key.cmd, keyboard.Key.cmd_l, keyboard.Key.cmd_r}

    def __init__(self):
        self.down = set()
        self.live = False

    def _mask(self):
        u = ctypes.windll.user32
        u.keybd_event(self.MASK_VK, 0, 0, 0)
        u.keybd_event(self.MASK_VK, 0, 2, 0)   # KEYEVENTF_KEYUP

    def on_press(self, key):
        if getattr(key, "vk", None) == self.MASK_VK:
            return
        self.down.add(key)
        ctrl, win = bool(self.down & self.CTRL), bool(self.down & self.WIN)
        others = self.down - self.CTRL - self.WIN
        if self.live and others:
            self.live = False
            if DEBUG:
                log(f"ptt cancel by {key}")
            emit("ptt", on=False, cancel=True)
        elif not self.live and ctrl and win and not others:
            self.live = True
            self._mask()
            emit("ptt", on=True)

    def on_release(self, key):
        if getattr(key, "vk", None) == self.MASK_VK:
            return
        self.down.discard(key)
        if self.live and (key in self.CTRL or key in self.WIN):
            self.live = False
            if DEBUG:
                log(f"ptt off by {key}")
            emit("ptt", on=False)
        if not self.down & (self.CTRL | self.WIN):
            self.down.clear()   # a missed key-up (e.g. lock screen) can't wedge it


def main():
    core = Core()
    gestures = Gestures()
    # marks are pinned to screen pixels, so a scroll makes them lie
    mouse.Listener(on_scroll=lambda *_: emit("scrolled"), on_click=gestures.on_click).start()
    if CONFIG.get("ptt", "ctrl+win"):
        ptt = PushToTalk()
        keyboard.Listener(on_press=ptt.on_press, on_release=ptt.on_release).start()
    emit("ready")
    for line in sys.stdin:
        try:
            core.handle(json.loads(line))
        except Exception as e:  # never let one bad message kill the sidecar
            log(f"error: {e!r}")


if __name__ == "__main__":
    main()
