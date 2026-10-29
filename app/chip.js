// The call chip: tiny holocall panel. Her lines show up full-size as subtitles on the overlay;
// here she gets a 3-line caption, typed out.
const $ = (id) => document.getElementById(id);
const feed = new CapriFeed($('fx'), { x: 20, y: 10, w: 104, h: 108 });
window.capri.skin().then((urls) => feed.loadSkin(urls));
const bars = $('bars');
for (let i = 0; i < 10; i++) bars.appendChild(document.createElement('i'));

let assets = '', typing = null, barTimer = null;
window.capri.assets().then((p) => { assets = 'file:///' + p.replace(/\\/g, '/'); });

function sound(name) {
  const a = new Audio(`${assets}/${name}`);
  a.play().catch(() => {});
  return a;
}
let ringAudio = null;

function caption(text, sys = false) {
  clearInterval(typing);
  const el = $('caption');
  el.classList.toggle('sys', sys);
  if (sys) { el.textContent = text; return; }
  // typed out a few characters per frame, a red block for a cursor
  let n = 0;
  typing = setInterval(() => {
    n = Math.min(text.length, n + 3);
    el.innerHTML = '';
    el.append(text.slice(0, n));
    if (n < text.length) { const c = document.createElement('span'); c.className = 'cur'; el.append(c); } else clearInterval(typing);
  }, 1000 / 24);
}

function talkBars(on) {
  clearInterval(barTimer);
  const els = [...bars.children];
  if (!on) { els.forEach((b) => (b.style.height = '2px')); return; }
  barTimer = setInterval(() => els.forEach((b) => (b.style.height = 2 + Math.random() * 12 + 'px')), 1000 / 12);
}

const on = window.capri.on;
on('ringing', (ms) => {
  document.body.className = 'ringing';
  $('status').textContent = 'INCOMING HOLO';
  caption('// routing through blackwall relay', true);
  feed.set('ringing');
  if (ms < 500) return;   // push-to-talk: straight through, no ringtone in your mic
  ringAudio = sound('ringtone.wav');
  ringAudio.onerror = () => { ringAudio = sound('ring_generated.wav'); };
});
on('connected', (quiet) => {
  document.body.className = '';
  ringAudio?.pause();
  if (!quiet) sound('pickup.wav');
  if (!$('mic').classList.contains('live')) $('status').textContent = 'CONNECTION SECURED';
  feed.set('opening');
});
on('ended', () => {
  ringAudio?.pause();
  talkBars(false);
  feed.setSpeaking(false); feed.setThinking(false);
  feed.set('ending');
  $('status').textContent = 'DISCONNECTED';
  document.body.className = 'ended';
  closeInput();
});
on('heard', (t) => caption(t ? `> ${t}` : '// no audio caught', true));
on('saw', () => {});
on('thinking', (v) => { feed.setThinking(v); if (v) { $('status').textContent = 'PROCESSING'; caption('// optics: frame captured · thinking', true); } });
on('speaking', (v) => { feed.setSpeaking(v); talkBars(v); if (v) $('status').textContent = 'CONNECTION SECURED'; });
on('say', (t) => caption(t));
on('look', (p) => { feed.look = p; });
on('eye', (v) => $('eye').classList.toggle('on', v));
on('ptt', (v) => {   // Ctrl+Win held somewhere else
  $('mic').classList.toggle('live', v);
  if (v) { feed.setSpeaking(false); talkBars(false); $('status').textContent = 'LISTENING · CTRL+WIN'; caption('// mic open, let go to send', true); }
  else $('status').textContent = 'CONNECTION SECURED';
});

// ----- input: type to ask, hold Space (or TALK) to speak -----
function openInput(ch = '') {
  document.body.classList.add('typing');
  const i = $('input'); i.value = ch; i.focus();
}
function closeInput() { document.body.classList.remove('typing'); $('input').blur(); }
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const t = $('input').value.trim();
    if (t) { window.capri.ask(t); caption(`> ${t}`, true); }
    closeInput(); e.preventDefault();
  } else if (e.key === 'Escape') closeInput();
});
let micLive = false;
const micDown = () => { if (micLive) return; micLive = true; $('mic').classList.add('live'); $('status').textContent = 'LISTENING'; window.capri.micDown(); };
const micUp = () => { if (!micLive) return; micLive = false; $('mic').classList.remove('live'); window.capri.micUp(); };
window.addEventListener('keydown', (e) => {
  if (document.body.classList.contains('typing')) return;
  if (e.code === 'Space') { e.preventDefault(); micDown(); }
  else if (e.key.length === 1 && !e.ctrlKey && !e.altKey) { openInput(e.key); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') micUp(); });
$('mic').addEventListener('mousedown', micDown);
window.addEventListener('mouseup', micUp);
$('end').addEventListener('click', () => window.capri.hangUp());
$('clr').addEventListener('click', () => window.capri.clear());
$('eye').addEventListener('click', () => window.capri.eye($('eye').classList.toggle('on')));

// only the panel catches the mouse; the transparent margin lets clicks through
$('panel').addEventListener('mouseenter', () => window.capri.hover(true));
$('panel').addEventListener('mouseleave', () => window.capri.hover(false));
