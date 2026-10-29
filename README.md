# CAPRI

A cyberpunk holocall assistant for Windows. Press **Ctrl+Alt+C** (or click the tray icon) to dial her. A small holo chip pops up in the corner, she answers out loud, and her lines run as game-style subtitles at the bottom of the screen. Hold **Space** to talk, or just start typing. Ask about whatever's on screen and she marks up your work with red-pen HUD annotations.

The name and backstory come from Capri, the Kang Tao AI in *Cyberpunk: Edgerunners 2*.

**Ping her:** highlight text (drag-select) or double-click anything, and a small "ASK CAPRI" tag pops up by your pointer for a few seconds. Click it and she picks up fast and helps with exactly that. She doesn't read your clipboard. She gets the screenshot, the spot you highlighted, and a full-res zoomed crop of it. Turn the tag off in the tray menu.

**Dock:** at launch her mask shows bottom-left for a few seconds so you know she's up, then she lives in the tray.

**Show art:** the feed uses frames of her from the show, from mochiiwuff's capri-desktop (`assets/skin/`). They're copyrighted, so they're gitignored and for personal use only: they're not in this repo, and an installer built with them inside stays on your own machine. Without `assets/skin/`, the feed falls back to the vector mask.

## Install / run

- **Installer:** `npm run dist` builds `dist/Capri-Setup-x.y.z.exe`. It's a one-click per-user install with a desktop shortcut. The tray menu has "Start with Windows".
- **Dev:** `npm start`. Set `CAPRI_DEBUG=1` for sidecar logs and `CAPRI_VISIBLE=1` to let screenshot tools see the windows.
- **Needs:** Python 3.13 on PATH with `pip install pywebview pynput sounddevice faster-whisper kokoro-onnx mss pillow numpy`, plus Claude Code logged in (`claude /login`). Kokoro models go in `models/`.
- **Custom ringtone:** drop your own `assets/ringtone.wav` and it overrides the generated one.

## How it's built

```
Electron (app/)                          Python sidecar (core.py, stdin/stdout JSON lines)
  main.js     tray, hotkey, windows  <->   brain.py   claude -p, stream-json, screenshot in
  chip.*      312x104 call chip            voice.py   Kokoro TTS (sentence-streamed), Whisper STT
  feed.js     her animated holo feed       screen.py  monitor under cursor, WDA-excluded
  overlay.*   click-through full screen    snap.py    snap marks to ink, build ink map
  annot.js    annotations + subtitles
```

### The holo feed (feed.js)

Cel animation, adapted from mochiiwuff's capri-desktop: exposure sheets of drawings held for N frames at 24 fps, with nothing tweened. Moves use anticipation, one-frame smears, impact frames (a white silhouette for a single drawing), squash and stretch, and green/red echo copies.

On top of that:
- **New here:** line boil on twos, a procedural mane with white specks that sways and flares, a talking jaw, eyes that track the cursor anywhere on the desktop, and a holo tint with scanlines.
- **Acts:** stand, ponder, talk, curious, look, arrive, ack, glitch, leave.
- **Call sequence:** ringing (shards spiral in, a shockwave per ring), then pickup (red line, shutter, RGB split, "ONLINE"), then live, then hang-up (a squash, a stretch up, a void slit, shards).

### Math annotations (snap.py + annot.js)

1. Claude returns marks with tight boxes: `error` (red), `fix` (cyan), `step` (numbered), `focus`, `strike`. Notes are in LaTeX.
2. `snap.py` pulls each box onto the actual ink in the full-resolution frame, since Claude's aim on a downscaled screenshot is close but loose.
3. Cards go in a margin column just right of the work, level with their line, like a TA marking a page. Leaders run through the blank gutters between lines, never across writing. If there's no room in the margin, a free-space search uses the ink map instead.
4. Notes render with KaTeX. Brackets lock on (slam, bounce, hold), leaders draw in, and cards glitch in, all on twos.
5. Marks clear on your next question, on scroll, on hang-up, or with CLR.

## Credits

Animation code adapted from [capri-desktop](https://github.com/mochiiwuff/capri-desktop) (MIT). See THIRD_PARTY_NOTICES.md.

## Settings: ON / OFF / SCHOOL (proctored work)

The one desktop shortcut, **Capri** (gear icon), runs `Capri.exe --settings`. That opens only a small panel with three modes. The tray's "Settings" item opens the same panel.

- **ON**: clears the school lock and starts her.
- **OFF**: closes her and the sidecar tree.
- **SCHOOL** (needs a second click to confirm): runs `school-mode/capri-off.ps1`, which kills Capri, its sidecar, and every Claude process (Claude Code sessions, the Claude desktop app and its Chrome bridge). It also removes the Start-with-Windows entry and writes `%APPDATA%\capri\SCHOOL_MODE`.

While the school lock exists, a plain Capri.exe exits on launch before it creates a window, a tray icon, the hotkey or the mouse hook. Only `--settings` still opens, so you can turn her back on. Run `capri-off.ps1 -List` to see what SCHOOL would kill without killing anything.

## Push-to-talk

Hold **Ctrl+Win** anywhere to talk, and let go to send. If she isn't on a call she picks up instantly with no ringtone, and she doesn't take focus from the window you're in. Adding a third key (Ctrl+Win+arrow and so on) cancels, so Windows' own shortcuts still work. While the combo is down, core.py taps an unassigned virtual key (0xE8) so Windows doesn't treat letting go of Win as a request to open Start. Set `"ptt": ""` in config.json to turn it off.

## Work cards

Besides the point-at marks (error / fix / step / focus / strike / circle), she can put up:
- `work`: a worked solution, one equation per line in KaTeX display style, with the last line highlighted.
- `graph`: a plotted function (mathjs syntax), with auto range, asymptote breaks and labelled points.

Neither needs a box. Both work without a screenshot and settle in empty space next to the marked work. Questions that come with a screenshot use `work_model` (opus by default) for accuracy. Plain chat uses `model`.

### Graph options (for lin alg, calc, econ, physics)

`fn`, `x`/`y` ranges, `xlabel`/`ylabel`, `pts` (+ `drop` for dashed guides to the axes), `shade` (under a curve, between two curves, or down to a level `y` for surplus), `lines` (dashed `x=`/`y=` guides for asymptotes, bounds, price ceilings), `vec` (arrows; vector-only plots use equal axes), and `note`. The persona has a SUBJECTS section with per-course habits: row ops on arrows and multiply-back checks; technique first and re-differentiate to check; P against Q with equilibria and surplus; units on every line, 3 sig figs, FBD vectors.
