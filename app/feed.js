// Capri's holo feed for the call chip: her mask and mane, acted like cel animation, plus the
// effects around her (shards, shockwaves, red lightning, data glyphs, the shutter, the void).
//
// Adapted from capri-desktop by mochiiwuff (fx.js, acting.js, chip.js), MIT License,
// Copyright (c) 2026 Capri Desktop contributors. Kept: the vector mask, exposure-sheet acting
// (drawings held for N frames at 24 fps, nothing tweened), smears, echoes, impact frames,
// shards, bolts, glyphs, shockwave, concentration lines. New here: a procedural mane with
// specks, line boil, a talking jaw, the holo feed (tint, scanlines, interference), and the
// holocall pickup / hang-up sequences.
(function () {
  const FPS = 24, FRAME_MS = 1000 / FPS;
  const C = { red: '#ff2152', green: '#36ff7a', ink: '#14101c', violet: '#7b3dff', paper: '#fff4f6', blue: '#3d6bff', cyan: '#3ef2ff' };
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // deterministic noise per drawing, so a held drawing doesn't shimmer but each new one boils
  const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

  // ---------- acting: exposure sheets ----------
  const rep = (n, keys) => Array.from({ length: n }, () => keys).flat();
  const NEUTRAL = { head: 0, bob: 0, sx: 1, sy: 1, mane: 0, hair: 0, smear: [0, 0], echo: [0, 0], flat: null, gone: false };
  const ACTS = {
    // floating, four drawings: the mane lags behind the body
    stand: { loop: true, keys: [[6, { bob: 0, hair: -2.5 }], [4, { bob: -1.5, hair: 0 }], [6, { bob: -3, hair: 2.5 }], [4, { bob: -1.5, hair: 0 }]] },
    // thinking: eyes up, mane drifting, a slow sway
    ponder: { loop: true, keys: [[8, { head: 0.1, bob: -1, hair: 1.5, mane: 0.05 }], [8, { head: 0.13, bob: -2.5, hair: -1, mane: 0.08 }]] },
    // little nods while the words come out, two drawings on threes
    talk: { priority: 0, keys: rep(2, [[3, { head: 0.05, mane: 0.1, bob: -1 }], [3, { head: 0, mane: 0.03 }]]) },
    // cocked head: anticipation the other way, a smear, a long hold
    curious: { priority: 1, keys: [[1, { head: -0.06, mane: 0.04 }], [1, { head: 0.14, mane: 0.16, smear: [-10, 3] }], [12, { head: 0.2, mane: 0.15 }], [6, { head: 0.17, mane: 0.1 }], [1, { head: 0.07 }]] },
    // head snapping one way then the other, held each time
    look: { priority: 1, keys: [[1, { head: 0.08, smear: [-7, 0] }], [8, { head: 0.16 }], [1, { head: 0 }], [1, { head: -0.08, smear: [7, 0] }], [8, { head: -0.16 }], [1, { head: -0.05 }], [3, {}]] },
    // pickup: she lands as a white stretched silhouette, squashes, overshoots, settles
    arrive: { priority: 3, keys: [[1, { flat: 'paper', sx: 0.55, sy: 1.55, bob: -10 }, 'impact'], [1, { sx: 1.3, sy: 0.75, bob: 4, smear: [0, -12], mane: 0.3 }],
      [2, { sx: 0.93, sy: 1.08, bob: -4, mane: 0.22, echo: [5, 0] }], [2, { sx: 1.04, sy: 0.97, mane: 0.1, echo: [2, 0] }], [3, { mane: 0.04 }]] },
    // she got something: a sharp nod with the mane bristling
    ack: { priority: 1, keys: [[1, { head: -0.05, bob: 1 }], [1, { head: 0.08, bob: -3, mane: 0.25, smear: [0, 6] }], [5, { head: 0.04, mane: 0.15 }], [3, { mane: 0.05 }]] },
    // a glitch: her green and red copies pull away and snap back
    glitch: { priority: 2, keys: [[1, { echo: [7, 1] }], [1, { echo: [-9, -1], sx: 1.05 }], [2, { echo: [4, 0] }], [1, {}]] },
    // hang-up: anticipation squash, a stretch up with a smear, white, gone
    leave: { priority: 4, keys: [[3, { sx: 1.16, sy: 0.84, bob: 3, mane: -0.1 }], [1, { sx: 0.7, sy: 1.4, bob: -8, smear: [0, -16], mane: 0.3 }],
      [1, { flat: 'paper', sx: 0.3, sy: 1.9, bob: -14 }], [40, { gone: true }]] },
  };

  class Actor {
    constructor() { this.loop = 'stand'; this.loopAt = 0; this.act = null; }
    setLoop(name, now) { if (this.loop !== name) { this.loop = name; this.loopAt = now; } }
    play(name, now, onCue) {
      const a = ACTS[name];
      if (this.act && ACTS[this.act.name].priority > a.priority) return;
      this.act = { name, at: now, cued: -1, onCue };
    }
    keyAt(keys, f, loop) {
      const total = keys.reduce((s, k) => s + k[0], 0);
      if (loop) f %= total; else if (f >= total) return null;
      for (let i = 0; i < keys.length; i++) { if (f < keys[i][0]) return { key: keys[i], i }; f -= keys[i][0]; }
      return null;
    }
    pose(now) {
      const p = { ...NEUTRAL };
      const lf = Math.floor((now - this.loopAt) / FRAME_MS);
      Object.assign(p, this.keyAt(ACTS[this.loop].keys, lf, true).key[1]);
      if (this.act) {
        const f = Math.floor((now - this.act.at) / FRAME_MS);
        const hit = this.keyAt(ACTS[this.act.name].keys, f, false);
        if (!hit) this.act = null;
        else {
          Object.assign(p, hit.key[1]);
          if (hit.key[2] && this.act.cued < hit.i) { this.act.cued = hit.i; this.act.onCue?.(hit.key[2]); }
        }
      }
      return p;
    }
  }

  // ---------- her ----------
  const MASK = {
    face: [[-48, -20], [-12, -22], [48, -26], [46, 20], [-45, 23]],
    spike: [[-32, -20], [-37, -50], [-22, -63], [6, -67], [24, -75], [34, -99], [49, -90], [44, -66], [30, -48], [2, -42], [-10, -40], [-12, -21]],
    fang: [[-6, 22], [1, 27], [8, 22], [13, 26], [22, 21], [8, 52]],
    eyes: [[-23, 0], [22, -3]],
  };
  // mane strands: root (on the back of her head), then direction + length; they flow back and down
  const STRANDS = [
    { root: [-30, -30], a: 2.55, len: 120, w: 26 }, { root: [-40, -10], a: 2.25, len: 140, w: 30 },
    { root: [-42, 10], a: 1.95, len: 130, w: 28 }, { root: [-20, -40], a: 2.85, len: 95, w: 20 },
    { root: [40, -20], a: 0.55, len: 90, w: 22 }, { root: [44, 6], a: 0.95, len: 110, w: 24 },
    { root: [-34, 20], a: 1.7, len: 105, w: 22 },
  ];

  function poly(ctx, pts, dx = 0, dy = 0, boil = 0, seed = 0) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = boil ? (hash(seed + i * 3.1) - 0.5) * boil : 0, jy = boil ? (hash(seed + i * 7.7) - 0.5) * boil : 0;
      i ? ctx.lineTo(x + dx + jx, y + dy + jy) : ctx.moveTo(x + dx + jx, y + dy + jy);
    });
    ctx.closePath();
  }

  function drawMane(ctx, p, seed, flat) {
    STRANDS.forEach((s, i) => {
      const a = s.a - (s.a > 1.57 ? 1 : -1) * p.mane * 0.9;   // flare: strands spread out
      const sway = p.hair * (1 + i * 0.25);
      const [rx, ry] = s.root;
      const ex = rx + Math.cos(a) * s.len + sway * 3, ey = ry + Math.sin(a) * s.len;
      const mx = rx + Math.cos(a) * s.len * 0.55 + sway, my = ry + Math.sin(a) * s.len * 0.55 + (i % 2 ? 6 : -6);
      const nx = -Math.sin(a), ny = Math.cos(a);
      const strand = (dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(rx + nx * s.w * 0.5 + dx, ry + ny * s.w * 0.5 + dy);
        ctx.quadraticCurveTo(mx + nx * s.w * 0.35 + dx, my + ny * s.w * 0.35 + dy, ex + dx + (hash(seed + i) - 0.5) * 3, ey + dy);
        ctx.quadraticCurveTo(mx - nx * s.w * 0.35 + dx, my - ny * s.w * 0.35 + dy, rx - nx * s.w * 0.5 + dx, ry - ny * s.w * 0.5 + dy);
        ctx.closePath();
      };
      if (flat) { strand(0, 0); ctx.fillStyle = flat; ctx.fill(); return; }
      strand(3, 3); ctx.fillStyle = C.violet; ctx.fill();
      strand(0, 0); ctx.fillStyle = C.ink; ctx.fill();
      if (i % 3 === 0) { ctx.strokeStyle = C.red; ctx.lineWidth = 1.6; ctx.stroke(); }
      // white specks along the strand, her constellation
      for (let k = 1; k <= 3; k++) {
        const t = (k / 4) + (hash(seed * 0.1 + i + k) - 0.5) * 0.08;
        const px = lerp(rx, ex, t) + nx * (hash(i * 9 + k) - 0.5) * s.w * 0.5, py = lerp(ry, ey, t) + ny * (hash(i * 5 + k) - 0.5) * s.w * 0.5;
        ctx.fillStyle = C.paper;
        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      }
    });
  }

  function drawMask(ctx, { eyes = [1, 1], look = null, talk = 0, flat = null, boil = 0, seed = 0 } = {}) {
    const jaw = talk * 9;
    const fang = MASK.fang.map(([x, y]) => [x, y + jaw]);
    ctx.lineJoin = 'miter';
    const shapes = [MASK.spike, MASK.face, fang];
    if (flat) { shapes.forEach((s) => { poly(ctx, s, 0, 0, boil, seed); ctx.fillStyle = flat; ctx.fill(); }); return; }
    shapes.forEach((s) => { poly(ctx, s, 3, 3, boil, seed); ctx.fillStyle = C.violet; ctx.fill(); });
    poly(ctx, MASK.spike, 0, 0, boil, seed); ctx.fillStyle = C.green; ctx.fill();
    poly(ctx, MASK.face, 0, 0, boil, seed + 1); ctx.fillStyle = C.green; ctx.fill();
    if (jaw > 1) {
      ctx.beginPath(); ctx.moveTo(-8, 21); ctx.lineTo(24, 20); ctx.lineTo(20, 21 + jaw); ctx.lineTo(-4, 22 + jaw); ctx.closePath();
      ctx.fillStyle = C.ink; ctx.fill();
    }
    poly(ctx, fang, 0, 0, boil, seed + 2); ctx.fillStyle = C.paper; ctx.fill(); ctx.strokeStyle = C.green; ctx.lineWidth = 2.2; ctx.stroke();
    MASK.eyes.forEach(([ex, ey], i) => {
      const o = eyes[i];
      if (o < 0.15) {
        ctx.beginPath(); ctx.moveTo(ex - 15, ey - 4); ctx.lineTo(ex, ey + 5); ctx.lineTo(ex + 15, ey - 4);
        ctx.strokeStyle = C.ink; ctx.lineWidth = 4.5; ctx.stroke(); return;
      }
      let px = 0, py = 0;
      if (look) { const d = Math.hypot(look.x - ex, look.y - ey) || 1; px = ((look.x - ex) / d) * 3; py = ((look.y - ey) / d) * 2.4; }
      ctx.save(); ctx.translate(ex, ey); ctx.scale(1, o);
      ctx.beginPath(); ctx.moveTo(-19, 0); ctx.quadraticCurveTo(0, -24, 19, 0); ctx.quadraticCurveTo(0, 24, -19, 0);
      ctx.fillStyle = C.ink; ctx.fill();
      const disk = (dx, dy, r, c) => { ctx.beginPath(); ctx.arc(dx, dy, r, 0, 6.2832); ctx.fillStyle = c; ctx.fill(); };
      disk(px * 0.4, py * 0.4, 10.5, C.green); disk(px * 0.4, py * 0.4, 8.8, C.ink); disk(px * 0.7, py * 0.7, 7.6, C.blue);
      ctx.beginPath(); ctx.ellipse(px, py, 3, 4, 0, 0, 6.2832); ctx.fillStyle = C.paper; ctx.fill();
      ctx.restore();
    });
  }

  // ---------- the feed ----------
  class Feed {
    // box: where the feed frame sits in the canvas (css px)
    constructor(canvas, box) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.box = box;
      this.actor = new Actor();
      this.items = []; this.state = 'idle'; this.stateAt = 0;
      this.speaking = false; this.thinking = false; this.look = null;
      this.blinkUntil = 0; this.nextBlink = 0; this.nextGlitch = 0; this.nextBolt = 0; this.nextGlyph = 0; this.nextPulse = 0; this.nextAct = 0;
      this.skin = null; this.faceKey = null; this.swapAt = 0; this.mood = null; this.moodUntil = 0; this.thinkAt = 0;
      this.last = 0; this.resize();
      requestAnimationFrame((t) => this.frame(t));
    }

    resize() {
      const dpr = window.devicePixelRatio || 1, r = this.canvas.getBoundingClientRect();
      if (r.width === this.w && r.height === this.h && this.dpr === dpr) return;
      this.w = r.width; this.h = r.height; this.dpr = dpr;
      this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    set(state) {
      const now = performance.now();
      this.state = state; this.stateAt = now;
      const { cx, cy, w } = this.geo();
      if (state === 'opening') this.actor.loop = 'stand';
      if (state === 'ending') { this.actor.play('leave', now); this.slices(cx, cy - w / 2, w * 1.3, w, 10); }
    }
    setThinking(on) { this.thinking = on; const now = performance.now(); if (on) this.thinkAt = now; this.actor.setLoop(on ? 'ponder' : 'stand', now); if (on) this.actor.play('curious', now); }
    setSpeaking(on) { const now = performance.now(); if (on && !this.speaking) { this.actor.play('ack', now); this.setMood('smug', 700); } this.speaking = on; }
    setMood(face, ms) { this.mood = face; this.moodUntil = performance.now() + ms; }

    // ----- skin: frames of her from the show (assets/skin, from capri-desktop; personal use) -----
    // urls: { file name: data URL } (data URLs keep the canvas untainted for the channel split)
    async loadSkin(urls) {
      const load = (f) => new Promise((ok, bad) => { if (!urls[f]) return bad(new Error(f)); const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = urls[f]; });
      try {
        const strip = await load('intro-face.webp');
        const faces = {};
        for (const k of ['calm', 'aside', 'smug', 'wide', 'look', 'laugh', 'many']) faces[k] = await load(`face-${k}.png`);
        // red / green / blue channel copies, for the signal-coming-in split
        const channels = (img) => [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(([r, g, b]) => {
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const x = c.getContext('2d'); x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height);
          for (let i = 0; i < d.data.length; i += 4) { d.data[i] *= r; d.data[i + 1] *= g; d.data[i + 2] *= b; }
          x.putImageData(d, 0, 0); return c;
        });
        this.skin = { strip, faces, stripCh: channels(strip), faceCh: Object.fromEntries(Object.entries(faces).map(([k, v]) => [k, channels(v)])) };
      } catch (e) { console.warn('[capri] no skin, using the vector mask', e); }
    }

    // which picture of her right now: [kind, key] (strip frame number, or a face name)
    pickFace(now, frame) {
      if (this.state === 'opening') { const o = this.openFrame ?? 0; return o < 14 ? ['strip', [0, 0, 1, 1, 2, 2, 2][Math.min(6, o >> 1)]] : ['strip', 3]; }
      if (this.mood && now < this.moodUntil) return ['face', this.mood];
      if (this.thinking) return ['face', now - this.thinkAt < 1300 ? 'many' : 'aside'];   // reading your screen, then mulling it
      if (this.speaking) return ['strip', [3, 6, 7, 8, 7, 6, 3, 7, 8, 6][Math.floor(frame / 2) % 10]];   // mouth on twos
      if (this.idleFace && now < this.idleUntil) return ['face', this.idleFace];
      return ['strip', [3, 4, 5, 4][Math.floor(frame / 4) % 4]];
    }

    drawPortrait(now, frame, p, ghost) {
      const { ctx } = this, { x, y, w, h } = this.geo(), sk = this.skin;
      const [kind, key] = this.pickFace(now, frame);
      const id = kind + key;
      if (!ghost && id !== this.faceKey) {   // a new face cuts in with a glitch (not on the strip's own frame steps)
        if (this.faceKey && (kind === 'face' || this.faceKey.startsWith('face'))) this.swapAt = now;
        this.faceKey = id;
      }
      const src = (ch) => {
        if (kind === 'strip') { const N = 400; return [ch == null ? sk.strip : sk.stripCh[ch], key * N, 0, N, N]; }
        const im = ch == null ? sk.faces[key] : sk.faceCh[key][ch]; return [im, 0, 0, im.width, im.height];
      };
      const zoom = 1.12 * (kind === 'strip' && this.state === 'opening' ? 1 : 1.04);
      const dw = w * zoom * p.sx, dh = h * zoom * p.sy;
      const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2 + p.bob * 1.5 + (1 - p.sy) * h * 0.4;
      const put = (ch, ox = 0, oy = 0, alpha = 1) => {
        const [im, sx, sy, sw, sh] = src(ch);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.translate(dx + dw / 2 + ox, dy + dh / 2 + oy); ctx.rotate(p.head * 0.35);
        ctx.drawImage(im, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      };
      ctx.save(); this.bevelPath(x, y, w, h); ctx.clip();
      if (ghost) { ctx.globalCompositeOperation = 'lighter'; put(ghost === '#ff2152' ? 0 : 2); ctx.restore(); return; }
      if (p.flat) { ctx.fillStyle = C[p.flat] || p.flat; ctx.fillRect(x, y, w, h); ctx.restore(); return; }   // impact frame
      put(null);
      if (p.smear[0] || p.smear[1]) for (const [m, a] of [[1, 0.25], [0.55, 0.4]]) put(null, p.smear[0] * m * 1.5, p.smear[1] * m * 1.5, a);
      if (p.echo[0] || p.echo[1]) {   // her green and red selves pulling away: channel copies, added
        ctx.globalCompositeOperation = 'lighter';
        put(1, p.echo[0] * 1.6, p.echo[1], 0.55); put(0, -p.echo[0] * 1.6, -p.echo[1], 0.55);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }

    her(now, frame, x, y, k, pose, flat) {
      if (this.skin) return this.drawPortrait(now, frame, pose, flat);
      return this.drawHer(now, frame, x, y, k, flat ? { ...pose, flat } : pose, { clipBox: this.box });
    }


    geo() { const { x, y, w, h } = this.box; return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }; }

    // ----- effects (ported) -----
    add(it) { it.born = performance.now(); this.items.push(it); return it; }
    burst(x, y, { count = 16, power = 1, spread = 30 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = rand(0, 6.28), s = rand(120, 380) * power;
        this.add({ type: 'shard', life: rand(240, 560), x: x + rand(-spread, spread) * 0.5, y: y + rand(-spread, spread) * 0.5,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: rand(0, 6.3), vr: rand(-9, 9), len: rand(6, 18), wid: rand(2, 6),
          color: C[pick(['red', 'red', 'red', 'ink', 'green', 'violet', 'paper', 'cyan'])] });
      }
    }
    vortex(x, y, radius, life = 520) {
      const ps = Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * 6.28 + rand(-0.25, 0.25), r: rand(0.6, 1.1),
        color: C[pick(['red', 'red', 'cyan', 'ink', 'violet'])], len: rand(7, 16), wid: rand(2, 5) }));
      this.add({ type: 'vortex', life, x, y, radius, ps });
    }
    ring(x, y, size = 1) { this.add({ type: 'ring', life: 300, x, y, size }); }
    slices(x, y, w, h, count = 7) {
      for (let i = 0; i < count; i++) this.add({ type: 'slice', life: rand(90, 200), x: x + rand(-w * 0.3, w * 0.3), y: y + rand(0, h),
        w: rand(w * 0.3, w), h: rand(1.5, 4), dx: rand(-40, 40), color: C[pick(['red', 'green', 'cyan', 'paper'])] });
    }
    bolt(from, to, life = 240) { this.add({ type: 'bolt', life, from, to }); }
    glyph(x, y) { this.add({ type: 'glyph', life: rand(800, 1300), x: x + rand(-30, 30), y, text: pick(['01', '10', '▚', '▞', '◢', '>_', '{}', '#', '⌁', '0x', 'KT']), drift: rand(-8, 8) }); }
    lines(x, y, inner) { this.add({ type: 'lines', life: 280, x, y, inner }); }

    jag(a, b, jitter) {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      const n = Math.max(4, Math.round(len / 14)); let side = 1; const pts = [];
      for (let i = 0; i <= n; i++) {
        let t = i / n, off = 0;
        if (i > 0 && i < n) { t += rand(-0.3, 0.3) / n; if (Math.random() < 0.8) side = -side; off = side * rand(0.2, 1) * jitter; }
        pts.push([lerp(a.x, b.x, t) + nx * off, lerp(a.y, b.y, t) + ny * off]);
      }
      return pts;
    }
    stroke(pts, color, width, dx = 0, dy = 0) {
      const { ctx } = this; ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    }
    shard(len, wid, color) {
      const { ctx } = this;
      const shape = (dx, dy) => { ctx.beginPath(); ctx.moveTo(-len * 0.5 + dx, dy); ctx.lineTo(dx, -wid * 0.5 + dy); ctx.lineTo(len * 0.5 + dx, wid * 0.15 + dy); ctx.lineTo(-len * 0.1 + dx, wid * 0.5 + dy); ctx.closePath(); };
      shape(-1.5, 1.5); ctx.fillStyle = C.violet; ctx.fill(); shape(0, 0); ctx.fillStyle = color; ctx.fill();
    }
    sparkle(x, y, s, fill) {
      const { ctx } = this, w = s * 0.24; ctx.beginPath();
      ctx.moveTo(x, y - s); ctx.lineTo(x + w, y - w); ctx.lineTo(x + s, y); ctx.lineTo(x + w, y + w); ctx.lineTo(x, y + s); ctx.lineTo(x - w, y + w); ctx.lineTo(x - s, y); ctx.lineTo(x - w, y - w);
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    }
    redLine(x, y, h) {
      const { ctx } = this;
      ctx.fillStyle = C.violet; ctx.fillRect(x - 3, y - h / 2 + 2, 4, h);
      ctx.fillStyle = C.red; ctx.fillRect(x - 1.5, y - h / 2, 3, h);
      ctx.fillStyle = C.paper; ctx.fillRect(x - 0.5, y - h * 0.42, 1, h * 0.84);
    }
    bevelPath(x, y, w, h, dx = 0, dy = 0) {
      const c = w * 0.14, ctx = this.ctx; ctx.beginPath();
      ctx.moveTo(x + c + dx, y + dy); ctx.lineTo(x + w + dx, y + dy); ctx.lineTo(x + w + dx, y + h - c + dy);
      ctx.lineTo(x + w - c + dx, y + h + dy); ctx.lineTo(x + dx, y + h + dy); ctx.lineTo(x + dx, y + c + dy); ctx.closePath();
    }

    // her, in a pose, centred at (x, y), k = scale
    drawHer(now, frame, x, y, k, p, { clipBox = null } = {}) {
      const { ctx } = this;
      if (p.gone) return;
      const seed = Math.floor(frame / 2);   // a new drawing every other frame: line boil on twos
      const blink = now < this.blinkUntil ? 0.1 : 1;
      if (now > this.nextBlink) { this.blinkUntil = now + 110; this.nextBlink = now + rand(2400, 5500); }
      let look = null;
      if (this.thinking) look = { x: 60, y: -120 };
      else if (this.look) look = { x: (this.look.x - x) / k, y: (this.look.y - y) / k };
      const talk = this.speaking ? [0, 0.55, 1, 0.7, 0.25][Math.floor(frame / 2) % 5] * (0.6 + hash(seed) * 0.4) : 0;
      const one = (ox, oy, flat, alpha = 1) => {
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.translate(x + ox, y + p.bob * k * 1.2 + oy); ctx.rotate(p.head); ctx.scale(k * p.sx, k * p.sy);
        drawMane(ctx, p, seed, flat);
        drawMask(ctx, { eyes: [blink, blink], look, talk, flat, boil: flat ? 0 : 1.6, seed });
        ctx.restore();
      };
      if (clipBox) { ctx.save(); this.bevelPath(clipBox.x, clipBox.y - 30, clipBox.w, clipBox.h + 30); ctx.clip(); }
      if (p.echo[0] || p.echo[1]) {   // her green and red copies
        one(p.echo[0] * k * 2, p.echo[1] * k * 2, C.green, 0.75);
        one(-p.echo[0] * k * 2, -p.echo[1] * k * 2, C.red, 0.75);
      }
      if (p.smear[0] || p.smear[1]) {   // smear frame: multiples trailing behind
        for (const [m, a] of [[1, 0.25], [0.6, 0.45], [0.3, 0.7]]) one(p.smear[0] * k * 2 * m, p.smear[1] * k * 2 * m, null, a);
      }
      one(0, 0, p.flat ? (C[p.flat] || p.flat) : null);
      if (clipBox) ctx.restore();
    }

    feedBox(now, { open = 1, split = 0, glitch = 0, flash = false } = {}, drawContents) {
      const { ctx } = this;
      const { x, y, w, h, cx } = this.geo();
      ctx.save();
      if (open < 1) { ctx.beginPath(); ctx.rect(cx - (w * open) / 2, 0, w * open, this.h); ctx.clip(); }
      this.bevelPath(x, y, w, h, 3, 3); ctx.fillStyle = C.violet; ctx.fill();
      this.bevelPath(x, y, w, h); ctx.fillStyle = '#07060d'; ctx.fill();
      if (flash) { ctx.strokeStyle = C.paper; ctx.lineWidth = 2.5; ctx.stroke(); }
      if (split) { ctx.globalCompositeOperation = 'lighter'; ctx.save(); ctx.translate(-split, 0); ctx.globalAlpha = 0.5; drawContents('#ff2152'); ctx.restore(); ctx.save(); ctx.translate(split, 0); ctx.globalAlpha = 0.5; drawContents('#3ef2ff'); ctx.restore(); ctx.globalCompositeOperation = 'source-over'; }
      drawContents(null);
      // holo: tint, scanlines, interference band
      ctx.save(); this.bevelPath(x, y, w, h); ctx.clip();
      ctx.fillStyle = 'rgba(62,242,255,0.07)'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let yy = y; yy < y + h; yy += 3) ctx.fillRect(x, yy, w, 1);
      ctx.fillStyle = 'rgba(62,242,255,0.09)'; ctx.fillRect(x, y + ((now / 10) % (h + 30)) - 15, w, 8);
      for (let g = 0; g < glitch; g++) {
        const gy = y + rand(0, h), gh = rand(2, 8), d = this.dpr;
        ctx.drawImage(this.canvas, x * d, gy * d, w * d, gh * d, x + rand(-10, 10), gy, w, gh);
        ctx.fillStyle = pick([C.red, C.green, C.cyan]); ctx.globalAlpha = 0.45; ctx.fillRect(x + rand(0, w * 0.6), gy, w * 0.3, 1.5); ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.fillStyle = C.red; ctx.fillRect(x + w * 0.14, y - 1, w * 0.86, 2);
      ctx.restore();
      if (open < 1) { this.redLine(cx - (w * open) / 2, y + h / 2, h * 1.06); this.redLine(cx + (w * open) / 2, y + h / 2, h * 1.06); }
    }

    tag(text, x, y, s = 1) {
      const { ctx } = this; ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.font = '700 12px Rajdhani, sans-serif';
      const skew = 6, h = 16, w = ctx.measureText(text).width + 16 + skew;
      const band = (dx, dy) => { ctx.beginPath(); ctx.moveTo(skew + dx, -h / 2 + dy); ctx.lineTo(w + dx, -h / 2 + dy); ctx.lineTo(w - skew + dx, h / 2 + dy); ctx.lineTo(dx, h / 2 + dy); ctx.closePath(); };
      band(3, 3); ctx.fillStyle = C.violet; ctx.fill(); band(0, 0); ctx.fillStyle = C.red; ctx.fill();
      ctx.fillStyle = C.paper; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, 1);
      ctx.restore();
    }

    // ----- loop -----
    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      if (now - this.last < FRAME_MS - 2) return;
      const dt = Math.min(0.08, (now - (this.last || now)) / 1000);
      this.last = now;
      this.resize();
      const { ctx } = this;
      ctx.clearRect(0, 0, this.w, this.h);
      const frame = Math.floor(now / FRAME_MS);
      const f = Math.floor((now - this.stateAt) / FRAME_MS);
      const { x, y, w, h, cx, cy } = this.geo();
      const k = w / 175;
      const herY = cy + h * 0.2;

      if (this.state === 'ringing') {
        if (now > this.nextPulse) { this.vortex(cx, cy, w * 0.75); this.ring(cx, cy, w / 120); this.nextPulse = now + 650; }
        this.sparkle(cx, cy, [3, 5, 4, 7, 5, 8][Math.floor(f / 2) % 6], C.red);
        this.sparkle(cx, cy, 2, C.paper);
      } else if (this.state === 'opening') {
        if (f < 4) {
          const lh = h * [0.15, 0.45, 0.8, 1.06][f];
          this.redLine(cx, cy, lh); this.sparkle(cx, cy - lh / 2, 5, C.paper); this.sparkle(cx, cy + lh / 2, 5, C.paper);
        } else {
          const o = f - 4;
          if (o === 0) this.actor.play('arrive', now, (cue) => cue === 'impact' && this.burst(cx, cy, { count: 14, power: 0.6, spread: w }));
          if (o === 9) this.lines(cx, cy, w * 0.6);
          this.openFrame = o;
          const OPEN = [0.05, 0.15, 0.3, 0.5, 0.68, 0.82, 0.92, 0.98], SPLIT = [10, 8, 7, 6, 5, 4, 3, 2, 1];
          const pose = this.actor.pose(now);
          this.feedBox(now, { open: OPEN[o] ?? 1, split: SPLIT[o] ?? 0, glitch: o < 3 ? 2 : 0, flash: o === 8 },
            (flat) => this.her(now, frame, cx, herY, k, pose, flat));
          if (o >= 9 && o < 30) this.tag('ONLINE', x + 4, y + h - 8, [0.4, 1.25, 0.95][o - 9] ?? 1);
          if (o > 30) this.set('live');
        }
      } else if (this.state === 'live' || this.state === 'ending') {
        let glitch = 0, split = 0;
        if (this.state === 'live' && now > this.nextGlitch) { glitch = 2; split = 3; this.actor.play('glitch', now); this.nextGlitch = now + rand(4000, 9000); }
        if (this.state === 'live' && !this.speaking && !this.thinking && now > this.nextAct) {   // idle life
          this.actor.play(pick(['look', 'curious', 'look']), now); this.nextAct = now + rand(7000, 14000);
          this.idleFace = pick(['calm', 'look', 'smug', 'calm']); this.idleUntil = now + rand(1200, 2600);
        }
        if (this.speaking && !this.actor.act) this.actor.play('talk', now);
        const pose = this.actor.pose(now);
        if (this.state === 'ending' && f >= 5) {
          // she's gone up and out: the feed squeezes into a void slit, then shards
          if (f < 9) {
            const sw = [w * 0.6, w * 0.3, w * 0.1, 3][f - 5];
            ctx.fillStyle = C.violet; ctx.fillRect(cx - sw / 2 - 2, y, sw + 4, h);
            ctx.fillStyle = C.ink; ctx.fillRect(cx - sw / 2, y, sw, h);
            ctx.fillStyle = C.red; ctx.fillRect(cx - 1, y + h * 0.08, 2, h * 0.84);
          } else if (f === 9) this.burst(cx, cy, { count: 18, power: 0.7 });
        } else {
          if (now - this.swapAt < FRAME_MS * 3) { glitch = Math.max(glitch, 3); split = Math.max(split, 4); }
          this.feedBox(now, { glitch, split }, (flat) => this.her(now, frame, cx, herY, k, pose, flat));
        }
        if (this.speaking && now > this.nextBolt) {
          const a = { x: cx + rand(-w * 0.15, w * 0.15), y: herY - h * 0.15 };
          const b = pick([{ x: x - 2, y: y + rand(0, h) }, { x: x + w + 2, y: y + rand(0, h) }, { x: x + rand(0, w), y: y - 2 }]);
          this.bolt(a, b, rand(140, 260)); this.nextBolt = now + rand(400, 1000);
        }
        if (this.thinking && now > this.nextGlyph) { this.glyph(cx, y + h - 6); this.nextGlyph = now + 200; }
      }

      this.items = this.items.filter((it) => now - it.born < it.life);
      for (const it of this.items) this.draw(it, (now - it.born) / it.life, dt, now);
    }

    draw(it, t, dt, now) {
      const { ctx } = this;
      switch (it.type) {
        case 'shard': {
          it.x += it.vx * dt; it.y += it.vy * dt; it.vx *= 0.86; it.vy *= 0.86; it.rot += it.vr * dt;
          const s = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.rot); this.shard(it.len * s, it.wid * s, it.color); ctx.restore(); break;
        }
        case 'vortex': {
          const e = t * t;
          for (const p of it.ps) {
            const a = p.a + e * 2.4, r = it.radius * p.r * (1 - e);
            ctx.save(); ctx.translate(it.x + Math.cos(a) * r, it.y + Math.sin(a) * r); ctx.rotate(a + 1.57); this.shard(p.len * (1 - e * 0.6), p.wid, p.color); ctx.restore();
          }
          break;
        }
        case 'ring': {
          const s = Math.floor(t * 6) / 6, r = (12 + 70 * s) * it.size, lw = Math.max(1, 5 * (1 - s));
          for (const [dx, color] of [[-2, C.violet], [0, C.red]]) { ctx.beginPath(); ctx.arc(it.x + dx, it.y - dx, r, 0, 6.2832); ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); }
          break;
        }
        case 'slice': ctx.fillStyle = it.color; ctx.globalAlpha = 1 - t; ctx.fillRect(it.x + it.dx * t, it.y, it.w, it.h); ctx.globalAlpha = 1; break;
        case 'bolt': {
          if (Math.floor((now - it.born) / FRAME_MS) % 3 === 2) break;
          const pts = this.jag(it.from, it.to, 6);
          ctx.save(); ctx.lineJoin = 'miter';
          this.stroke(pts, C.violet, 3, -1, 1); this.stroke(pts, C.red, 2.6); this.stroke(pts, C.paper, 0.8);
          ctx.restore(); break;
        }
        case 'glyph': {
          ctx.save(); ctx.font = '600 9px "Share Tech Mono", monospace';
          ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
          const gy = Math.round(it.y - t * 50), gx = Math.round(it.x + it.drift * t);
          ctx.fillStyle = C.violet; ctx.fillText(it.text, gx - 1, gy + 1); ctx.fillStyle = C.green; ctx.fillText(it.text, gx, gy);
          ctx.restore(); break;
        }
        case 'lines': {
          const fr = Math.floor((t * it.life) / FRAME_MS);
          if (!it.strokes || it.drawn !== fr >> 1) {
            it.drawn = fr >> 1;
            it.strokes = Array.from({ length: 22 }, () => ({ a: rand(0, 6.28), w: rand(0.012, 0.03), r0: it.inner * rand(1, 1.4), color: C[pick(['paper', 'paper', 'violet', 'red', 'cyan'])] }));
          }
          const outer = it.inner * 3;
          ctx.save(); ctx.globalAlpha = t > 0.7 ? 1 - Math.floor(((t - 0.7) / 0.3) * 3) / 3 : 1;
          for (const s of it.strokes) {
            ctx.beginPath(); ctx.moveTo(it.x + Math.cos(s.a - s.w) * outer, it.y + Math.sin(s.a - s.w) * outer);
            ctx.lineTo(it.x + Math.cos(s.a) * s.r0, it.y + Math.sin(s.a) * s.r0); ctx.lineTo(it.x + Math.cos(s.a + s.w) * outer, it.y + Math.sin(s.a + s.w) * outer);
            ctx.closePath(); ctx.fillStyle = s.color; ctx.fill();
          }
          ctx.restore(); break;
        }
      }
    }
  }

  window.CapriFeed = Feed;
  window.CapriDraw = { drawMask, C };
})();
