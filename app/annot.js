// Capri's annotations: she marks up your work like a tutor with a red pen, in HUD style.
//   error  red lock-on brackets + underline, the correction on a card
//   fix    the same in cyan: what it should be / the part that's right
//   step   numbered badge + side bracket, for walkthroughs
//   focus  white brackets, "look here"
//   strike a jagged red slash through it
//   circle a quick hand-drawn red ring around it
//   work   a worked-solution card, one equation per line (box optional)
//   graph  a plotted function card: curves, axes, labelled points (box optional)
// Boxes arrive already snapped to the ink (snap.py). Cards go where the screen is empty,
// using the ink map, and never on top of a marked box. Everything moves on twos at 24 fps.
// The lock-on bracket slam is adapted from capri-desktop's pointer (MIT, (c) 2026 Capri
// Desktop contributors).
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const FRAME = 1000 / 24;
  const TONE = { error: '#ff2152', fix: '#3ef2ff', step: '#f3e600', focus: '#fff4f6', strike: '#ff2152', circle: '#ff2152', work: '#3ef2ff', graph: '#3ef2ff' };
  const HEAD = { error: 'ERR', fix: 'FIX', step: 'STEP', focus: 'NOTE', circle: 'LOOK', work: 'WORK', graph: 'PLOT' };
  const CURVE = ['#3ef2ff', '#f3e600', '#ff2152', '#fff4f6'];
  const svg = document.getElementById('lines'), cards = document.getElementById('cards'), root = document.getElementById('marks');
  const subs = document.getElementById('subs');
  let gen = 0;   // bumps on clear, so late animations from an old batch stop
  let plotId = 0;

  const el = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.appendChild(e);
    return e;
  };
  // run fn(i) for n drawings on twos; stops if the batch was cleared
  const onTwos = (n, fn, done) => {
    const g = gen; let i = 0;
    const tick = () => { if (g !== gen) return; fn(i); if (++i < n) setTimeout(tick, FRAME * 2); else done?.(); };
    tick();
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerpN = (a, b, t) => a + (b - a) * t;

  // a single-escaped "\frac" in JSON arrives as form feed + "rac" (\t \n \b \r too): put the backslash back
  const CTRL = { '\f': '\\f', '\t': '\\t', '\n': '\\n', '\b': '\\b', '\r': '\\r', '\v': '\\v' };
  const fixTex = (t) => t.replace(/[\f\t\n\b\r\v]/g, (c) => CTRL[c]);

  function renderNote(text) {
    // "$...$" segments are math (KaTeX), the rest is plain text
    return text.split(/(\$[^$]+\$)/).map((seg) => {
      if (seg.startsWith('$') && seg.endsWith('$') && seg.length > 2) {
        try { return katex.renderToString(fixTex(seg.slice(1, -1)), { throwOnError: false, output: 'html' }); } catch { return seg; }
      }
      const d = document.createElement('span'); d.textContent = seg; return d.outerHTML;
    }).join('');
  }
  // a line that is all math renders in display style (full-size fractions, sums, integrals)
  function renderLine(text) {
    const t = String(text).trim();
    if (/^\$[^$]+\$$/.test(t)) {
      try { return katex.renderToString(fixTex(t.slice(1, -1)), { throwOnError: false, output: 'html', displayMode: true }); } catch {}
    }
    return renderNote(t);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ----- graphs -----
  function niceStep(span) {
    const raw = span / 5, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
    return p * (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10);
  }
  const fmt = (v) => (Math.abs(v) < 1e-9 ? '0' : Math.abs(v) >= 1000 || Math.abs(v) < 0.01 ? v.toExponential(0) : +v.toFixed(2) + '');

  function compileFn(f) {
    const src = String(typeof f === 'object' ? f.f : f).replace(/^\s*(y|f\(x\)|[a-z]\(x\))\s*=/i, '').replace(/\bln\(/g, 'log(');
    const code = math.compile(src);
    const fn = (x) => { try { const v = code.evaluate({ x }); return typeof v === 'number' ? v : NaN; } catch { return NaN; } };
    let label = typeof f === 'object' && f.label;
    if (!label) { try { label = `$y=${math.parse(src).toTex({ implicit: 'hide', parenthesis: 'auto' })}$`; } catch { label = src; } }
    return { fn, label };
  }

  const TONES = { red: '#ff2152', cyan: '#3ef2ff', yellow: '#f3e600', white: '#fff4f6', violet: '#a77bff' };
  const plain = (t) => String(t ?? '').replace(/\$([^$]+)\$/g, '$1');   // drop math delimiters, keep a lone "$" (prices)

  // m: fn (curves), x/y ranges, pts, vec (arrows), shade (areas), lines (dashed x=/y= guides),
  // drop (dashed guides from points to the axes), xlabel/ylabel, equal (same scale both axes)
  function graphHTML(m) {
    const W = 380, H = 236, R = 12, T = 10, L = m.ylabel ? 56 : 42, B = m.xlabel ? 38 : 24;
    const curves = [];
    for (const f of [].concat(m.fn || [])) { try { curves.push(compileFn(f)); } catch {} }
    // vectors: [x, y, "label"] from the origin, or [x0, y0, x1, y1, "label"]
    const vecs = [].concat(m.vec || []).map((v) => (Array.isArray(v) && v.length >= 4 && typeof v[3] === 'number'
      ? { x0: +v[0], y0: +v[1], x1: +v[2], y1: +v[3], label: v[4] }
      : Array.isArray(v) ? { x0: 0, y0: 0, x1: +v[0], y1: +v[1], label: v[2] } : { x0: +(v.x0 || 0), y0: +(v.y0 || 0), x1: +v.x, y1: +v.y, label: v.label }))
      .filter((v) => [v.x0, v.y0, v.x1, v.y1].every(Number.isFinite));
    let x0, x1;
    if (Array.isArray(m.x) && m.x.length === 2) [x0, x1] = m.x.map(Number);
    else if (vecs.length && !curves.length) {
      const xs = vecs.flatMap((v) => [v.x0, v.x1, 0]);
      x0 = Math.min(...xs); x1 = Math.max(...xs); const pad = Math.max(1, (x1 - x0) * 0.15); x0 -= pad; x1 += pad;
    } else [x0, x1] = [-10, 10];
    const N = 400, samples = curves.map(({ fn }) => Array.from({ length: N + 1 }, (_, i) => { const x = x0 + (x1 - x0) * i / N; return [x, fn(x)]; }));
    const pts = [].concat(m.pts || []).map((q) => {
      const r = Array.isArray(q) ? { x: q[0], y: q[1], label: q[2] } : { ...q };
      if (r.y == null && curves[0]) r.y = curves[0].fn(+r.x);
      return r;
    }).filter((q) => Number.isFinite(+q.x) && Number.isFinite(+q.y));
    const guides = [].concat(m.lines || []).filter((g) => g && (Number.isFinite(+g.x) || Number.isFinite(+g.y)));
    let y0, y1;
    if (Array.isArray(m.y) && m.y.length === 2) [y0, y1] = m.y.map(Number);
    else {   // robust auto range: ignore the top/bottom 3% (asymptotes), keep points, vectors and the x-axis in view
      const ys = samples.flat().map((q) => q[1]).filter(Number.isFinite).sort((u, v) => u - v);
      y0 = ys.length ? ys[Math.floor(ys.length * 0.03)] : Infinity; y1 = ys.length ? ys[Math.ceil(ys.length * 0.97) - 1] : -Infinity;
      for (const q of pts) { y0 = Math.min(y0, +q.y); y1 = Math.max(y1, +q.y); }
      for (const v of vecs) { y0 = Math.min(y0, v.y0, v.y1, 0); y1 = Math.max(y1, v.y0, v.y1, 0); }
      for (const g of guides) if (Number.isFinite(+g.y)) { y0 = Math.min(y0, +g.y); y1 = Math.max(y1, +g.y); }
      if (!Number.isFinite(y0)) { y0 = -1; y1 = 1; }
      if (y0 > 0 && y0 < (y1 - y0) * 0.6) y0 = 0;
      if (y1 < 0 && -y1 < (y1 - y0) * 0.6) y1 = 0;
      if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
      const pad = (y1 - y0) * 0.1; y0 -= pad; y1 += pad;
    }
    const PW = W - L - R, PH = H - T - B;
    if (m.equal || (vecs.length && !curves.length && m.equal !== false)) {   // one unit is the same length both ways
      const k = Math.max((x1 - x0) / PW, (y1 - y0) / PH), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      x0 = cx - k * PW / 2; x1 = cx + k * PW / 2; y0 = cy - k * PH / 2; y1 = cy + k * PH / 2;
    }
    const sx = (x) => L + (x - x0) / (x1 - x0) * PW, sy = (y) => T + (y1 - y) / (y1 - y0) * PH;
    const clip = `pc${++plotId}`, arrow = `ah${plotId}`;
    let s = `<svg class="plot" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><clipPath id="${clip}"><rect x="${L}" y="${T}" width="${PW}" height="${PH}"/></clipPath>`
      + vecs.map((_, k) => `<marker id="${arrow}_${k}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${CURVE[(curves.length + k) % CURVE.length]}"/></marker>`).join('') + `</defs>`;
    const xs = niceStep(x1 - x0), ysT = niceStep(y1 - y0);
    for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) {
      s += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${H - B}" class="gl"/><text x="${sx(v)}" y="${H - B + 14}" text-anchor="middle" class="tk">${fmt(v)}</text>`;
    }
    for (let v = Math.ceil(y0 / ysT) * ysT; v <= y1 + 1e-9; v += ysT) {
      s += `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" class="gl"/><text x="${L - 5}" y="${sy(v) + 3.5}" text-anchor="end" class="tk">${fmt(v)}</text>`;
    }
    if (y0 <= 0 && y1 >= 0) s += `<line x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}" class="ax"/>`;
    if (x0 <= 0 && x1 >= 0) s += `<line x1="${sx(0)}" x2="${sx(0)}" y1="${T}" y2="${H - B}" class="ax"/>`;
    if (m.xlabel) s += `<text x="${L + PW / 2}" y="${H - 6}" text-anchor="middle" class="al">${esc(plain(m.xlabel))}</text>`;
    if (m.ylabel) s += `<text x="13" y="${T + PH / 2}" text-anchor="middle" class="al" transform="rotate(-90 13 ${T + PH / 2})">${esc(plain(m.ylabel))}</text>`;
    s += `<g clip-path="url(#${clip})">`;
    // shaded areas: under curve "f" (index) down to the axis, down to a level "y" (consumer surplus), or between curves "f" and "g", from..to
    for (const sh of [].concat(m.shade || [])) {
      const top = curves[+(sh.f ?? 0)], bot = sh.g != null ? curves[+sh.g] : Number.isFinite(+sh.y) && sh.y !== null ? { fn: () => +sh.y } : null;
      if (!top) continue;
      const a = Number.isFinite(+sh.from) ? +sh.from : x0, b = Number.isFinite(+sh.to) ? +sh.to : x1, n = 80;
      const up = [], dn = [];
      for (let i = 0; i <= n; i++) {
        const x = a + (b - a) * i / n, yt = top.fn(x), yb = bot ? bot.fn(x) : 0;
        if (Number.isFinite(yt) && Number.isFinite(yb)) { up.push([sx(x), sy(Math.max(y0, Math.min(y1, yt)))]); dn.push([sx(x), sy(Math.max(y0, Math.min(y1, yb)))]); }
      }
      if (up.length < 2) continue;
      const tone = TONES[sh.tone] || CURVE[+(sh.f ?? 0) % CURVE.length];
      const poly = [...up, ...dn.reverse()].map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' ');
      s += `<polygon points="${poly}" class="area" fill="${tone}"/>`;
      if (sh.label) {
        const mid = up[Math.floor(up.length / 2)], lo = dn[dn.length - 1 - Math.floor(up.length / 2)];
        s += `<text x="${mid[0]}" y="${(mid[1] + lo[1]) / 2 + 4}" text-anchor="middle" class="pl">${esc(plain(sh.label))}</text>`;
      }
    }
    // dashed guides: {x: 2} vertical (asymptote, a bound), {y: 40} horizontal (a price ceiling)
    for (const g of guides) {
      const tone = TONES[g.tone] || 'rgba(255,244,246,.55)';
      if (Number.isFinite(+g.x)) s += `<line x1="${sx(+g.x)}" x2="${sx(+g.x)}" y1="${T}" y2="${H - B}" class="gd" stroke="${tone}"/>`
        + (g.label ? `<text x="${sx(+g.x) + 4}" y="${T + 11}" class="pl">${esc(plain(g.label))}</text>` : '');
      else s += `<line x1="${L}" x2="${W - R}" y1="${sy(+g.y)}" y2="${sy(+g.y)}" class="gd" stroke="${tone}"/>`
        + (g.label ? `<text x="${W - R - 4}" y="${sy(+g.y) - 5}" text-anchor="end" class="pl">${esc(plain(g.label))}</text>` : '');
    }
    samples.forEach((ss, k) => {
      // break the path at gaps and asymptotes instead of drawing a vertical wall
      let d = '', pen = false, prev = null;
      const span = y1 - y0;
      for (const [x, y] of ss) {
        const ok = Number.isFinite(y) && y > y0 - span * 3 && y < y1 + span * 3 && !(prev !== null && Math.abs(y - prev) > span * 1.5);
        if (ok) { d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`; pen = true; } else pen = false;
        prev = Number.isFinite(y) ? y : null;
      }
      s += `<path d="${d}" class="sh"/><path d="${d}" class="curve" stroke="${CURVE[k % CURVE.length]}"/>`;
    });
    let vlabels = '';
    // longest first, so a short vector along the same line (v vs Av) stays visible on top
    vecs.map((v, k) => [v, k]).sort((a, b) => Math.hypot(b[0].x1 - b[0].x0, b[0].y1 - b[0].y0) - Math.hypot(a[0].x1 - a[0].x0, a[0].y1 - a[0].y0)).forEach(([v, k]) => {
      const tone = CURVE[(curves.length + k) % CURVE.length];
      const ax = sx(v.x0), ay = sy(v.y0), bx = sx(v.x1), by = sy(v.y1);
      s += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="sh"/><line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="vec curve" stroke="${tone}" marker-end="url(#${arrow}_${k})"/>`;
      if (v.label) {   // past the tip, kept inside the frame (labels sit outside the clip so they never get cut)
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        const tx = Math.max(L + 4, Math.min(W - R - 4, bx + dx / len * 10)), ty = Math.max(T + 10, Math.min(H - B - 4, by + dy / len * 10 + 4));
        const anchor = Math.abs(dx) < len * 0.3 ? 'middle' : dx > 0 ? 'start' : 'end';
        vlabels += `<text x="${tx}" y="${ty}" text-anchor="${tx > W - R - 60 ? 'end' : tx < L + 60 ? 'start' : anchor}" class="pl" fill="${tone}">${esc(plain(v.label))}</text>`;
      }
    });
    s += `</g>` + vlabels;
    for (const q of pts) {
      const px = sx(+q.x), py = sy(+q.y);
      if (px < L || px > W - R || py < T || py > H - B) continue;
      if (m.drop) {   // dashed guides down and across to the axes, like an equilibrium on a supply/demand graph
        const axY = y0 <= 0 && y1 >= 0 ? sy(0) : H - B, axX = x0 <= 0 && x1 >= 0 ? sx(0) : L;
        s += `<path d="M${px} ${py} L${px} ${axY} M${px} ${py} L${axX} ${py}" class="gd" stroke="rgba(255,244,246,.6)"/>`
          + `<text x="${px}" y="${axY + 12}" text-anchor="middle" class="pv">${fmt(+q.x)}</text>`
          + `<text x="${axX + 3}" y="${py - 4}" class="pv">${fmt(+q.y)}</text>`;
      }
      s += `<rect x="${px - 4}" y="${py - 4}" width="8" height="8" class="pt" transform="rotate(45 ${px} ${py})"/>`;
      const lbl = q.label ?? `(${fmt(+q.x)}, ${fmt(+q.y)})`, right = px < W - 90;
      s += `<text x="${px + (right ? 8 : -8)}" y="${py - 7}" text-anchor="${right ? 'start' : 'end'}" class="pl">${esc(plain(lbl))}</text>`;
    }
    s += `</svg>`;
    const legend = curves.map((c, k) => `<div class="lg"><i style="background:${CURVE[k % CURVE.length]}"></i>${renderNote(c.label)}</div>`).join('');
    return `${legend ? `<div class="legend">${legend}</div>` : ''}${s}${m.note ? `<div class="cap">${renderNote(String(m.note))}</div>` : ''}`;
  }

  function animateCurves(card) {
    const paths = [...card.querySelectorAll('.curve, .sh')];
    for (const p of paths) { const len = p.getTotalLength() || 1; p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.dataset.len = len; }
    onTwos(8, (i) => { for (const p of paths) p.style.strokeDashoffset = p.dataset.len * (1 - (i + 1) / 8); });
  }

  // ----- free-space layout -----
  function makeOccupancy(ink, scale) {
    if (!ink) return () => 0;
    const cell = ink.cell * scale, rows = ink.rows;
    return (r) => {   // fraction of the rect's cells that have content
      const c0 = Math.max(0, Math.floor(r.x / cell)), c1 = Math.floor((r.x + r.w) / cell);
      const r0 = Math.max(0, Math.floor(r.y / cell)), r1 = Math.floor((r.y + r.h) / cell);
      let busy = 0, all = 0;
      for (let y = r0; y <= r1 && y < rows.length; y++) for (let x = c0; x <= c1 && x < rows[y].length; x++) { all++; if (rows[y][x] === '1') busy++; }
      return all ? busy / all : 0;
    };
  }
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  function placeCard(box, w, h, occ, taken, boxes) {
    const W = innerWidth, H = innerHeight, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const cands = [];
    for (const gap of [18, 44, 90, 150]) {
      cands.push({ x: box.x + box.w + gap, y: cy - h / 2 }, { x: box.x - gap - w, y: cy - h / 2 },
        { x: cx - w / 2, y: box.y + box.h + gap }, { x: cx - w / 2, y: box.y - gap - h },
        { x: box.x + box.w + gap, y: box.y - h - gap * 0.5 }, { x: box.x + box.w + gap, y: box.y + box.h + gap * 0.5 },
        { x: box.x - gap - w, y: box.y - h - gap * 0.5 }, { x: box.x - gap - w, y: box.y + box.h + gap * 0.5 });
    }
    let best = null, bestScore = Infinity;
    for (const c of cands) {
      const r = { x: c.x, y: c.y, w, h };
      if (r.x < 8 || r.y < 8 || r.x + w > W - 8 || r.y + h > H - 8) continue;
      let s = occ({ x: r.x - 6, y: r.y - 6, w: w + 12, h: h + 12 }) * 500;
      for (const t of taken) s += overlap(r, t) * 10;
      for (const b of boxes) s += overlap({ x: r.x - 8, y: r.y - 8, w: w + 16, h: h + 16 }, b) * 6;
      if (r.x < 380 && r.y < 180) s += 400;   // the call chip lives top-left
      // the leader shouldn't cut through other writing: sample along it
      const lx = r.x + w / 2, ly = r.y + h / 2;
      for (let k = 2; k < 12; k++) {
        const px = lerpN(cx, lx, k / 12), py = lerpN(cy, ly, k / 12);
        if (px > box.x - 4 && px < box.x + box.w + 4 && py > box.y - 4 && py < box.y + box.h + 4) continue;
        if (px > r.x && px < r.x + w && py > r.y && py < r.y + h) continue;
        s += occ({ x: px - 3, y: py - 3, w: 6, h: 6 }) * 60;
      }
      s += Math.hypot(r.x + w / 2 - cx, r.y + h / 2 - cy) * 0.35;
      if (s < bestScore) { bestScore = s; best = r; }
    }
    return best || { x: Math.min(W - w - 8, box.x + box.w + 18), y: Math.max(8, cy - h / 2), w, h };
  }

  // ----- margin layout: how a TA marks a page -----
  // Cards go in a column just right of the written work, each level with its line (pushed
  // down to avoid each other). Leaders leave the box, drop into the blank gutter between
  // lines of math, run across it, and come up to the card, so they never cut through writing.
  function rowClear(occ, x0, x1, y) {
    if (x1 <= x0) return true;
    return occ({ x: x0, y: y - 2, w: x1 - x0, h: 4 }) < 0.04;
  }

  function marginLayout(items, occ, ink, scale) {
    if (!ink) return null;
    const W = innerWidth, cell = ink.cell * scale;
    const top = Math.min(...items.map((i) => i.box.y)) - 40, bot = Math.max(...items.map((i) => i.box.y + i.box.h)) + 40;
    let right = Math.max(...items.map((i) => i.box.x + i.box.w));
    ink.rows.forEach((row, r) => {
      const y = r * cell;
      if (y < top || y > bot) return;
      const last = row.lastIndexOf('1');
      if (last >= 0) right = Math.max(right, (last + 1) * cell);
    });
    const colX = right + 36, maxW = Math.max(...items.map((i) => i.w));
    if (colX + maxW > W - 12) return null;   // no room on the right: fall back to free space

    const out = [];
    let floor = -Infinity;
    for (const it of [...items].sort((a, b) => a.box.y - b.box.y)) {
      const want = it.box.y + it.box.h / 2 - it.h / 2;
      const y = Math.max(want, floor + 10, 8);
      floor = y + it.h;
      const r = { x: colX, y, w: it.w, h: it.h };
      const b = it.box, cy = r.y + r.h / 2, by = b.y + b.h / 2;
      let pts;
      if (rowClear(occ, b.x + b.w + 6, colX - 4, by)) {
        pts = [[b.x + b.w + 4, by], [colX - 18, by], [colX - 8, cy], [colX, cy]];   // straight across
      } else {
        // find the gutter under (or over) the line, a strip that's empty all the way to the margin
        let gy = null;
        for (let d = 3; d < 34 && gy === null; d += 2) {
          if (rowClear(occ, b.x + b.w / 2, colX - 4, b.y + b.h + d)) gy = b.y + b.h + d;
          else if (rowClear(occ, b.x + b.w / 2, colX - 4, b.y - d)) gy = b.y - d;
        }
        if (gy === null) gy = b.y + b.h + 6;
        const sx = Math.min(b.x + b.w - 6, b.x + b.w / 2 + 30), sy = gy > by ? b.y + b.h + 3 : b.y - 3;
        pts = [[sx, sy], [sx, gy], [colX - 18, gy], [colX - 8, cy], [colX, cy]];
      }
      out.push({ it, r, pts });
    }
    return out;
  }

  function drawLeader(pts, tone) {
    const d = 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L');
    const shadow = el('path', { d, fill: 'none', stroke: '#7b3dff', 'stroke-width': 3, transform: 'translate(2 2)', opacity: 0.8 });
    const line = el('path', { d, fill: 'none', stroke: tone, 'stroke-width': 1.6 });
    const len = line.getTotalLength();
    for (const p of [shadow, line]) { p.style.strokeDasharray = len; p.style.strokeDashoffset = len; }
    el('rect', { x: pts[0][0] - 3, y: pts[0][1] - 3, width: 6, height: 6, fill: tone });
    onTwos(4, (i) => { const off = len * (1 - (i + 1) / 4); shadow.style.strokeDashoffset = off; line.style.strokeDashoffset = off; });
  }

  // leader: from the box edge facing the card, one elbow, to the card edge
  function leader(box, card, tone) {
    const bx = card.x > box.x + box.w ? box.x + box.w + 4 : card.x + card.w < box.x ? box.x - 4 : box.x + box.w / 2;
    const by = card.y > box.y + box.h ? box.y + box.h + 4 : card.y + card.h < box.y ? box.y - 4 : box.y + box.h / 2;
    const ex = card.x > bx ? card.x : card.x + card.w < bx ? card.x + card.w : card.x + card.w / 2;
    const ey = card.y + card.h / 2 > by + 30 && Math.abs(ex - bx) < card.w ? card.y : card.y + card.h < by - 30 && Math.abs(ex - bx) < card.w ? card.y + card.h : card.y + card.h / 2;
    const midX = Math.abs(ex - bx) > Math.abs(ey - by) ? bx + (ex - bx) * 0.35 : bx;
    const pts = [[bx, by], [midX, by], [midX + (ex - midX) * 0.2, ey], [ex, ey]];
    const d = 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L');
    const shadow = el('path', { d, fill: 'none', stroke: '#7b3dff', 'stroke-width': 3, transform: 'translate(2 2)', opacity: 0.8 });
    const line = el('path', { d, fill: 'none', stroke: tone, 'stroke-width': 1.6 });
    const len = line.getTotalLength();
    for (const p of [shadow, line]) { p.style.strokeDasharray = len; p.style.strokeDashoffset = len; }
    el('rect', { x: bx - 3, y: by - 3, width: 6, height: 6, fill: tone });
    onTwos(4, (i) => { const off = len * (1 - (i + 1) / 4); shadow.style.strokeDashoffset = off; line.style.strokeDashoffset = off; });
  }

  // lock-on brackets: come in wide, slam, bounce once, hold; white while landing
  function brackets(box, tone, { only = null } = {}) {
    const g = el('g', {});
    const SLAM = [44, 24, 10, 1, 6, 3];
    onTwos(SLAM.length, (i) => {
      g.replaceChildren();
      const pad = SLAM[i], x0 = box.x - pad, y0 = box.y - pad, x1 = box.x + box.w + pad, y1 = box.y + box.h + pad;
      const arm = Math.min(12, (x1 - x0) / 3, (y1 - y0) / 2.5);
      const color = i < 3 ? '#fff4f6' : tone;
      for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
        if (only === 'left' && sx < 0) continue;
        const d = `M${cx} ${cy + sy * arm} L${cx} ${cy} L${cx + sx * arm} ${cy}`;
        el('path', { d, fill: 'none', stroke: '#7b3dff', 'stroke-width': 3.5, transform: 'translate(1.5 1.5)' }, g);
        el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.2, 'stroke-linecap': 'square' }, g);
      }
    });
  }

  function highlight(box, tone, kind) {
    const fill = el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, fill: tone, opacity: 0 });
    const under = el('rect', { x: box.x - 3, y: box.y + box.h + 3, width: 0, height: 2.5, fill: tone });
    setTimeout(() => {
      onTwos(3, (i) => { fill.setAttribute('opacity', [0.28, 0.16, kind === 'error' ? 0.13 : 0.1][i]); under.setAttribute('width', (box.w + 6) * (i + 1) / 3); });
    }, FRAME * 8);
  }

  function strike(box) {
    const jag = () => {
      const pts = [], n = 6;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push([box.x - 4 + (box.w + 8) * t + (i && i < n ? rand(-3, 3) : 0), box.y + box.h + 2 - (box.h + 4) * t + (i && i < n ? rand(-3, 3) : 0)]);
      }
      return 'M' + pts.map((p) => p.join(' ')).join(' L');
    };
    const shadow = el('path', { d: jag(), fill: 'none', stroke: '#7b3dff', 'stroke-width': 4, transform: 'translate(2 2)' });
    const line = el('path', { d: jag(), fill: 'none', stroke: TONE.strike, 'stroke-width': 3, 'stroke-linejoin': 'miter' });
    const len = line.getTotalLength();
    for (const p of [shadow, line]) { p.style.strokeDasharray = len; p.style.strokeDashoffset = len; }
    onTwos(3, (i) => { const off = len * (1 - (i + 1) / 3); line.style.strokeDashoffset = off; shadow.style.strokeDashoffset = off; });
  }

  // a quick pen ring: a bit more than one lap, wobbly, slightly tilted, overshooting the start
  function circle(box) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, rx = box.w / 2 + 10, ry = box.h / 2 + 8, tilt = rand(-0.12, 0.12);
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = -2.2 + (i / 40) * Math.PI * 2.25, w = 1 + rand(-0.04, 0.04) + i * 0.0025;
      const x = rx * w * Math.cos(a), y = ry * w * Math.sin(a);
      pts.push([cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)]);
    }
    const d = 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L');
    const shadow = el('path', { d, fill: 'none', stroke: '#7b3dff', 'stroke-width': 4, transform: 'translate(2 2)' });
    const line = el('path', { d, fill: 'none', stroke: TONE.circle, 'stroke-width': 2.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const len = line.getTotalLength();
    for (const p of [shadow, line]) { p.style.strokeDasharray = len; p.style.strokeDashoffset = len; }
    onTwos(5, (i) => { const off = len * (1 - (i + 1) / 5); line.style.strokeDashoffset = off; shadow.style.strokeDashoffset = off; });
  }

  function stepBadge(box, n) {
    const x = box.x - 22, y = box.y + box.h / 2, r = 10;
    const pts = [0, 1, 2, 3, 4, 5].map((i) => [x + r * Math.cos((i * Math.PI) / 3), y + r * Math.sin((i * Math.PI) / 3)].join(',')).join(' ');
    el('polygon', { points: pts, fill: '#7b3dff', transform: 'translate(2 2)' });
    el('polygon', { points: pts, fill: TONE.step });
    const t = el('text', { x, y: y + 4, 'text-anchor': 'middle', 'font-family': 'Rajdhani, sans-serif', 'font-weight': 700, 'font-size': 13, fill: '#0a0b11' });
    t.textContent = n;
  }

  function makeCard(m) {
    const c = document.createElement('div');
    c.className = 'card' + (m.t === 'work' || m.t === 'graph' ? ' big ' + m.t : '');
    c.style.setProperty('--tone', TONE[m.t] || TONE.focus);
    const head = m.t === 'step' ? `STEP ${m.n ?? ''}` : m.title ? renderNote(String(m.title)) : HEAD[m.t] || 'NOTE';
    let body;
    if (m.t === 'graph') body = graphHTML(m);
    else if (m.t === 'work') {
      body = [].concat(m.lines || m.note || []).map((l, i, all) =>
        `<div class="ln${i === all.length - 1 && all.length > 1 ? ' last' : ''}"><span class="no">${i + 1}</span><div class="eq">${renderLine(l)}</div></div>`).join('');
    } else body = renderNote(String(m.note));
    c.innerHTML = `<div class="in"><div class="hd">${head}</div><div class="bd">${body}</div></div>`;
    c.style.visibility = 'hidden';
    cards.appendChild(c);
    return c;
  }
  const hasCard = (m) => m.note || m.t === 'work' || m.t === 'graph';

  // a card with nothing to point at (a plot, a worked solution): the emptiest spot, right side first
  function freeSpot(w, h, occ, taken, boxes) {
    const W = innerWidth, H = innerHeight;
    // settle next to the work: just right of what's marked (and its margin notes), level with its top
    const near = [...boxes, ...taken];
    const ax = near.length ? Math.max(...near.map((b) => b.x + b.w)) + 40 : W, ay = near.length ? Math.min(...near.map((b) => b.y)) : 0;
    let best = null, bestScore = Infinity;
    for (let y = 16; y + h < H - 16; y += 32) for (let x = 16; x + w < W - 16; x += 32) {
      const r = { x, y, w, h };
      let s = occ({ x: x - 8, y: y - 8, w: w + 16, h: h + 16 }) * 800;
      for (const t of taken) s += overlap(r, t) * 10;
      for (const b of boxes) s += overlap({ x: x - 12, y: y - 12, w: w + 24, h: h + 24 }, b) * 10;
      if (x < 380 && y < 180) s += 600;                     // the call chip
      if (y + h > H * 0.86 && x < W * 0.7 && x + w > W * 0.3) s += 300;   // the subtitles
      s += near.length ? Math.hypot(x - ax, (y - ay) * 1.5) * 0.06 : (W - x - w) * 0.03;
      if (s < bestScore) { bestScore = s; best = r; }
    }
    return best || { x: W - w - 16, y: 200, w, h };
  }

  function draw({ marks, ink, scale }) {
    clear(true);
    const occ = makeOccupancy(ink, scale);
    const items = marks.filter((m) => Array.isArray(m.box) || m.t === 'work' || m.t === 'graph').map((m) => {
      if (!Array.isArray(m.box)) return { m, box: null };
      const [x1, y1, x2, y2] = m.box.map((v) => v * scale);
      return { m, box: { x: x1, y: y1, w: Math.max(6, x2 - x1), h: Math.max(6, y2 - y1) } };
    });
    // cards: build hidden, measure, lay out together (margin column, else free space)
    const noted = items.filter((i) => hasCard(i.m));
    for (const it of noted) it.card = makeCard(it.m);
    // KaTeX's fonts load on first use; measure after they land or big cards come out too small
    const g0 = gen;
    document.fonts.ready.then(() => { if (g0 === gen) layout(items, noted, occ, ink, scale); });
  }

  function layout(items, noted, occ, ink, scale) {
    for (const it of noted) { it.w = it.card.offsetWidth; it.h = it.card.offsetHeight; }
    const anchored = noted.filter((i) => i.box), floating = noted.filter((i) => !i.box);
    const boxes = items.filter((i) => i.box).map((i) => i.box), taken = [];
    const layout = anchored.length ? marginLayout(anchored, occ, ink, scale) : [];
    if (layout) for (const { it, r, pts } of layout) { it.r = r; it.pts = pts; taken.push(r); }
    else for (const it of anchored) { it.r = placeCard(it.box, it.w, it.h, occ, taken, boxes); taken.push(it.r); }
    for (const it of floating) { it.r = freeSpot(it.w, it.h, occ, taken, boxes); taken.push(it.r); }
    const g = gen;
    items.forEach((it, i) => setTimeout(() => {
      if (g !== gen) return;
      const { m, box } = it, tone = TONE[m.t] || TONE.focus;
      if (box) {
        if (m.t === 'strike') strike(box);
        else if (m.t === 'circle') circle(box);
        else if (m.t === 'step') { stepBadge(box, m.n ?? i + 1); brackets(box, tone, { only: 'left' }); }
        else { brackets(box, tone); highlight(box, tone, m.t); }
      }
      if (it.card) {
        it.card.style.left = it.r.x + 'px'; it.card.style.top = it.r.y + 'px';
        if (box) { if (it.pts) drawLeader(it.pts, tone); else leader(box, it.r, tone); }
        setTimeout(() => {
          if (g !== gen) return;
          it.card.style.visibility = 'visible'; it.card.classList.add('enter');
          if (m.t === 'graph') animateCurves(it.card);
        }, box ? FRAME * 8 : 0);
      }
    }, i * 260));
  }

  function clear(instant = false) {
    gen++;
    const wipe = () => { svg.replaceChildren(); cards.replaceChildren(); root.classList.remove('fading'); };
    if (instant || !svg.childElementCount) return wipe();
    root.classList.add('fading');
    setTimeout(wipe, 260);
  }

  // ----- subtitles -----
  let subTimer = null, wordTimer = null;
  function subtitle(text) {
    clearTimeout(subTimer); clearInterval(wordTimer);
    if (!text) { subTimer = setTimeout(() => subs.classList.remove('on'), 2200); return; }
    subs.innerHTML = '<b>CAPRI</b>' + text.split(/(\s+)/).map((w) => `<span class="w">${w.replace(/</g, '&lt;')}</span>`).join('');
    subs.classList.add('on');
    const words = [...subs.querySelectorAll('.w')];
    let i = 0;   // words land at roughly speaking pace
    wordTimer = setInterval(() => { for (let k = 0; k < 2 && i < words.length; k++) words[i++].classList.add('v'); if (i >= words.length) clearInterval(wordTimer); }, 150);
  }

  window.capri.on('marks', draw);
  window.capri.on('clear', () => clear());
  window.capri.on('subtitle', subtitle);
  window.CapriAnnot = { draw, clear, subtitle };   // for previews
})();
