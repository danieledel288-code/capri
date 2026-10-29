// CAPRI desktop app: a tray icon, a global hotkey that "dials" her, a tiny holo chip window,
// and a full-screen click-through overlay for her annotations and subtitles.
// Voice, screen capture and the Claude brain live in the Python sidecar (core.py).
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

// in the installed app the Python side ships as extraResources
const CORE_DIR = app.isPackaged ? path.join(process.resourcesPath, 'core') : path.join(__dirname, '..');
const ASSETS = app.isPackaged ? path.join(process.resourcesPath, 'assets') : path.join(__dirname, '..', 'assets');
const CONFIG = JSON.parse(fs.readFileSync(path.join(CORE_DIR, 'config.json'), 'utf8'));
const HOTKEY = (CONFIG.hotkey || 'ctrl+alt+c').split('+').map((k) => k[0].toUpperCase() + k.slice(1)).join('+');
const RING_MS = Math.round((CONFIG.max_ring_seconds || 3.5) * 1000);
const GREETINGS = ["Capri here! What've you got?", "Line's hot! Talk to me, choom!", 'You rang? Finally, something fun!', "I'm in! Show me the problem!"];
const CHIP = { w: 360, h: 150 };   // window incl. transparent margin for effects to spill into

// school mode: while this file exists she refuses to start at all (no tray, no hotkey, no sidecar).
// school-mode/capri-off.ps1 writes it; ON in the settings panel deletes it.
// `Capri.exe --settings` (the desktop shortcut) opens only the ON / OFF / SCHOOL panel, even while locked.
const SCHOOL_LOCK = path.join(app.getPath('appData'), 'capri', 'SCHOOL_MODE');
const SETTINGS = process.argv.includes('--settings');
const locked = () => fs.existsSync(SCHOOL_LOCK);
if (locked() && !SETTINGS) app.exit(0);
else if (!app.requestSingleInstanceLock()) app.quit();

function schoolMode() {
  fs.mkdirSync(path.dirname(SCHOOL_LOCK), { recursive: true });
  fs.writeFileSync(SCHOOL_LOCK, new Date().toISOString());
  app.setLoginItemSettings({ openAtLogin: false });
  // the script also closes every Claude process
  const off = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), 'school-mode', 'capri-off.ps1');
  // started through WMI so it is not our child: anything Capri spawns dies with her when she quits,
  // which killed the script before it reached Claude
  if (fs.existsSync(off)) {
    const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${off}"`;
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${cmd.replace(/'/g, "''")}'} | Out-Null`],
        { windowsHide: true, timeout: 15000 });
    } catch (e) { console.log('[capri] school mode launch failed', e.message); }
  }
  app.isQuitting = true;
  app.quit();
}

// ---------- settings panel ----------
let panel = null, booted = false;
const mode = () => (booted ? 'on' : locked() ? 'school' : 'off');

function openPanel() {
  if (panel) { panel.show(); panel.focus(); return; }
  panel = new BrowserWindow({
    width: 340, height: 214, frame: false, transparent: true, resizable: false, alwaysOnTop: true,
    backgroundColor: '#00000000', title: 'Capri settings', icon: path.join(ASSETS, 'settings.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  panel.loadFile(path.join(__dirname, 'panel.html'));
  panel.on('closed', () => { panel = null; if (!booted && !app.isQuitting) app.quit(); });
}

function quitAll() {
  app.isQuitting = true;
  if (core?.pid) try { execFileSync('taskkill', ['/PID', String(core.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  app.quit();
}

ipcMain.handle('mode', () => mode());
ipcMain.on('set-mode', (_e, m) => {
  if (m === 'school') return schoolMode();
  fs.rmSync(SCHOOL_LOCK, { force: true });
  if (m === 'on') { boot(); send(panel, 'mode', mode()); }
  else quitAll();
});
ipcMain.on('panel-close', () => panel?.close());

let tray, chip, overlay, dock, ping, core;
let pingFocus = null, pingTimer = null, pingsOn = CONFIG.ping !== false;
let inCall = false, eye = CONFIG.screen_vision !== false, callTimer = null, lookTimer = null;

// ---------- sidecar ----------
function startCore() {
  core = spawn(CONFIG.python || 'python', ['-u', 'core.py'], { cwd: CORE_DIR, windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' } });
  readline.createInterface({ input: core.stdout }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    onCore(msg);
  });
  core.stderr.on('data', (d) => process.env.CAPRI_DEBUG && process.stderr.write(d));
  core.on('exit', (code) => { console.log('[capri] core exited', code); if (!app.isQuitting) setTimeout(startCore, 2000); });
}
const toCore = (msg) => core?.stdin.writable && core.stdin.write(JSON.stringify(msg) + '\n');

function onCore(msg) {
  switch (msg.ev) {
    case 'ready': console.log('[capri] core ready'); break;
    case 'log': console.log('[core]', msg.msg); break;
    case 'heard': send(chip, 'heard', msg.text); break;
    case 'thinking': send(chip, 'thinking', msg.on); break;
    case 'saw': send(chip, 'saw'); break;
    case 'reply':
      if (msg.marks?.length) send(overlay, 'marks', place(msg));
      break;
    case 'speaking':
      send(chip, 'speaking', msg.on);
      if (msg.on) send(chip, 'say', msg.text);
      if (!msg.on) send(overlay, 'subtitle', null);
      break;
    case 'sentence': send(overlay, 'subtitle', msg.text); break;
    case 'scrolled': send(overlay, 'clear'); break;
    case 'gesture': offerPing(msg); break;
    case 'ptt': pushToTalk(msg); break;
  }
}

// Python works in physical pixels of the captured monitor; the overlay in DIPs of its display.
function place(msg) {
  if (!msg.monitor) {   // no screenshot (stand-alone cards): the display under the pointer
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    overlay.setBounds(display.bounds);
    return { marks: msg.marks, ink: null, scale: 1 / display.scaleFactor };
  }
  const [ml, mt, mw, mh] = msg.monitor;
  const display = screen.getAllDisplays().find((d) =>
    Math.abs(d.bounds.width * d.scaleFactor - mw) < 4 && Math.abs(d.bounds.height * d.scaleFactor - mh) < 4 &&
    Math.abs(d.bounds.x * d.scaleFactor - ml) < mw && Math.abs(d.bounds.y * d.scaleFactor - mt) < mh) || screen.getPrimaryDisplay();
  overlay.setBounds(display.bounds);
  return { marks: msg.marks, ink: msg.ink, scale: 1 / display.scaleFactor };
}

const send = (win, ch, ...args) => win && !win.isDestroyed() && win.webContents.send(ch, ...args);

// ---------- windows ----------
function createWindows() {
  const work = screen.getPrimaryDisplay().workArea;
  chip = new BrowserWindow({
    width: CHIP.w, height: CHIP.h, x: work.x + (CONFIG.x ?? 12), y: work.y + (CONFIG.y ?? 12),
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  chip.setAlwaysOnTop(true, 'screen-saver');
  if (!process.env.CAPRI_VISIBLE) chip.setContentProtection(true);   // she never sees herself in her own screenshots
  chip.setIgnoreMouseEvents(true, { forward: true });   // only the chip itself catches the mouse
  chip.loadFile(path.join(__dirname, 'chip.html'));

  const d = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    ...d.bounds, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true);
  if (!process.env.CAPRI_VISIBLE) overlay.setContentProtection(true);
  overlay.loadFile(path.join(__dirname, 'overlay.html'));

  // between calls: her mask, docked bottom-left above the taskbar; click it to call
  dock = new BrowserWindow({
    width: 130, height: 150, x: work.x + 10, y: work.y + work.height - 150,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false,
    hasShadow: false, backgroundColor: '#00000000', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  dock.setAlwaysOnTop(true, 'screen-saver');
  if (!process.env.CAPRI_VISIBLE) dock.setContentProtection(true);
  dock.setIgnoreMouseEvents(true, { forward: true });
  dock.loadFile(path.join(__dirname, 'dock.html'));
  // shows for a few seconds at launch so you know she's up, then tucks away (tray from then on)
  dock.once('ready-to-show', () => { dock.showInactive(); send(dock, 'show'); setTimeout(() => dock.hide(), 6000); });

  // the ping tag: pops up by the pointer after you highlight or double-click something
  ping = new BrowserWindow({
    width: 150, height: 40, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, hasShadow: false, backgroundColor: '#00000000', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  ping.setAlwaysOnTop(true, 'screen-saver');
  if (!process.env.CAPRI_VISIBLE) ping.setContentProtection(true);
  ping.loadFile(path.join(__dirname, 'ping.html'));
}

// ---------- push-to-talk: hold Ctrl+Win anywhere ----------
function pushToTalk({ on, cancel }) {
  if (on) {
    if (!inCall) dial({ instant: true, onConnect: () => {} });
    toCore({ op: 'mic_down' });
    send(chip, 'ptt', true);
  } else {
    toCore(cancel ? { op: 'mic_cancel' } : { op: 'mic_up', eye });
    send(chip, 'ptt', false);
    if (cancel) send(chip, 'heard', '');
  }
}

// ---------- pings ----------
const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

function offerPing(g) {
  if (!pingsOn) return;
  const at = screen.screenToDipPoint({ x: g.pos[0], y: g.pos[1] });
  if ((chip.isVisible() && inside(at, chip.getBounds())) || (ping.isVisible() && inside(at, ping.getBounds()))) return;
  pingFocus = g.rect;
  const work = screen.getDisplayNearestPoint(at).workArea;
  const x = Math.min(Math.round(at.x + 14), work.x + work.width - 150), y = Math.min(Math.round(at.y + 16), work.y + work.height - 40);
  ping.setBounds({ x, y, width: 150, height: 40 });
  ping.showInactive();
  send(ping, 'show', g.kind);
  clearTimeout(pingTimer);
  pingTimer = setTimeout(() => ping.hide(), 3500);
}

function doPing() {
  ping.hide();
  const focus = pingFocus, text = 'What is this? Help me with it.';
  if (!focus) return;
  if (inCall) { toCore({ op: 'ask', text, eye, focus }); send(chip, 'heard', 'ping: what you highlighted'); return; }
  dial({ quick: true, onConnect: () => { toCore({ op: 'ask', text, eye, focus }); send(chip, 'heard', 'ping: what you highlighted'); } });
}

// ---------- the call ----------
function dial(opts = {}) {
  if (inCall && !opts.quick) return hangUp();
  if (inCall) return;
  inCall = true;
  dock.hide();
  toCore({ op: 'new_call' });
  const ringMs = opts.instant ? 120 : opts.quick ? 1000 : RING_MS;
  send(chip, 'ringing', ringMs);
  chip.showInactive();
  clearInterval(lookTimer);
  lookTimer = setInterval(() => {   // her eyes follow the pointer anywhere on the desktop
    const c = screen.getCursorScreenPoint(), b = chip.getBounds();
    send(chip, 'look', { x: c.x - b.x, y: c.y - b.y });
  }, 80);
  clearTimeout(callTimer);
  callTimer = setTimeout(() => {
    if (!inCall) return;
    send(chip, 'connected', !!opts.instant);
    if (opts.instant) chip.showInactive();   // you're talking into another app's window: don't steal focus
    else { chip.show(); chip.focus(); }
    if (opts.onConnect) return opts.onConnect();
    toCore({ op: 'say', text: GREETINGS[Math.floor(Math.random() * GREETINGS.length)] });
    if (process.env.CAPRI_TEST_ASK) setTimeout(() => toCore({ op: 'ask', text: process.env.CAPRI_TEST_ASK, eye }), 2500);   // dev hook
  }, ringMs);
}

function hangUp() {
  inCall = false;
  clearTimeout(callTimer);
  toCore({ op: 'stop' });
  send(chip, 'ended');
  send(overlay, 'clear');
  send(overlay, 'subtitle', null);
  setTimeout(() => { if (!inCall) { chip.hide(); clearInterval(lookTimer); } }, 1100);
}

ipcMain.on('ask', (_e, text) => toCore({ op: 'ask', text, eye }));
ipcMain.on('mic-down', () => toCore({ op: 'mic_down' }));
ipcMain.on('mic-up', () => toCore({ op: 'mic_up', eye }));
ipcMain.on('hang-up', () => hangUp());
ipcMain.on('clear', () => send(overlay, 'clear'));
ipcMain.on('eye', (_e, on) => { eye = !!on; });
ipcMain.on('hover', (_e, over) => chip.setIgnoreMouseEvents(!over, { forward: true }));
ipcMain.on('dock-hover', (_e, over) => dock.setIgnoreMouseEvents(!over, { forward: true }));
ipcMain.on('dock-click', () => { dock.hide(); dial(); });
ipcMain.on('ping', () => doPing());
ipcMain.handle('assets', () => ASSETS);
// her show frames (assets/skin, personal use), as data URLs so the canvas can split channels
ipcMain.handle('skin', () => {
  const dir = path.join(ASSETS, 'skin'), out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const type = f.endsWith('.webp') ? 'image/webp' : 'image/png';
    out[f] = `data:${type};base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`;
  }
  return out;
});

// ---------- tray ----------
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'icon.png')).resize({ width: 16, height: 16 }));
  const build = () => Menu.buildFromTemplate([
    { label: inCall ? 'Hang up' : `Call Capri  (${HOTKEY})`, click: dial },
    { type: 'separator' },
    { label: 'Screen vision', type: 'checkbox', checked: eye, click: (i) => { eye = i.checked; send(chip, 'eye', eye); } },
    { label: 'Ping tag on highlight / double-click', type: 'checkbox', checked: pingsOn, click: (i) => { pingsOn = i.checked; } },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Settings (on / off / school mode)', click: openPanel },
    { label: 'Quit', click: quitAll },
  ]);
  tray.setToolTip('CAPRI');
  tray.on('click', dial);
  tray.on('right-click', () => tray.popUpContextMenu(build()));
}

function boot() {
  if (booted) return;
  booted = true;
  startCore();
  createWindows();
  createTray();
  if (!globalShortcut.register(HOTKEY, dial)) console.log(`[capri] ${HOTKEY} is taken by another app`);
}

app.whenReady().then(() => {
  if (SETTINGS) return openPanel();
  if (!locked()) boot();
});
app.on('second-instance', (_e, argv) => (argv.includes('--settings') ? openPanel() : booted && dial()));
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => { globalShortcut.unregisterAll(); core?.kill(); });
