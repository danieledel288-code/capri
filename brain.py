"""Capri's brain: headless Claude Code (`claude -p`), so it runs on the Claude
subscription and inherits Daniel's MCP connectors (Calendar, Gmail) and memory.
Screenshots go in as image blocks via --input-format stream-json."""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).parent
PERSONA = (ROOT / "persona.md").read_text(encoding="utf-8")
MARKS_RE = re.compile(r"<marks>(.*?)</marks>", re.S)

# Read-only by default. Add tools here deliberately; -p mode can't ask permission.
ALLOWED_TOOLS = [
    "Read", "Glob", "Grep", "WebSearch", "WebFetch",
    "mcp__claude_ai_Google_Calendar__list_events",
    "mcp__claude_ai_Google_Calendar__search_events",
    "mcp__claude_ai_Google_Calendar__get_event",
    "mcp__claude_ai_Gmail__search_threads",
    "mcp__claude_ai_Gmail__get_thread",
    "mcp__claude_ai_Gmail__get_message",
]


def split_marks(reply):
    """'spoken text <marks>[...]</marks>' -> (spoken text, [marks])"""
    marks = []
    for block in MARKS_RE.findall(reply):
        try:
            marks += json.loads(block)
        except json.JSONDecodeError:
            print(f"[capri] unparseable marks: {block[:200]}")
    return MARKS_RE.sub("", reply).strip(), marks


class Brain:
    def __init__(self, model="sonnet", workdir=None):
        self.model = model
        self.workdir = workdir or str(Path.home())
        self.session_id = None
        self.exe = shutil.which("claude") or str(Path.home() / ".local/bin/claude.exe")

    def new_call(self):
        """Each holocall is a fresh conversation."""
        self.session_id = None

    def ask(self, text, image_b64=None, image_size=None, extra_images=(), timeout=180, model=None):
        """Returns (spoken_reply, marks). extra_images: more JPEGs (b64) after the screenshot, e.g. a zoomed crop."""
        content = []
        if image_b64:
            content.append({"type": "image",
                            "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64}})
            text = f"[Screen attached: {image_size[0]}x{image_size[1]} px]\n{text}"
        for b64 in extra_images:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}})
        content.append({"type": "text", "text": text})
        msg = {"type": "user", "message": {"role": "user", "content": content}}

        cmd = [self.exe, "-p", "--input-format", "stream-json", "--output-format", "stream-json",
               "--verbose", "--model", model or self.model,
               "--append-system-prompt", PERSONA,
               "--allowedTools", ",".join(ALLOWED_TOOLS)]
        if self.session_id:
            cmd += ["--resume", self.session_id]
        env = dict(os.environ)
        # An API key in env would silently bill the API instead of the subscription.
        env.pop("ANTHROPIC_API_KEY", None)
        try:
            proc = subprocess.run(cmd, input=json.dumps(msg) + "\n", capture_output=True, text=True,
                                  encoding="utf-8", timeout=timeout, cwd=self.workdir, env=env,
                                  creationflags=subprocess.CREATE_NO_WINDOW)
        except subprocess.TimeoutExpired:
            return "Signal's dragging. Took too long, try me again.", []

        result = None
        for line in proc.stdout.splitlines():
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("type") == "result":
                result = ev
        if not result:
            print(f"[capri] brain error: {proc.stderr[-500:]}")
            return "Lost the link to my core. Check the console.", []
        self.session_id = result.get("session_id", self.session_id)
        if result.get("is_error"):
            print(f"[capri] brain error result: {result}")
        return split_marks((result.get("result") or "").strip() or "...")
