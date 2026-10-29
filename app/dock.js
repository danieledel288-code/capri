// Capri docked: between calls all that's left of her is her mask, floating bottom-left, eyes
// shut. She cracks one open now and then; bring the pointer close and she stirs and watches it;
// click her to call. (Her biochip form, after capri-desktop's chip.js, MIT.)
const { drawMask, C } = window.CapriDraw;
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
const FRAME = 1000 / 24, K = 0.62;
let W, H, cx, cy, last = 0, shownAt = performance.now(), pointer = null, hover = false;
let nextPeek = performance.now() + 4000, peek = null;

function resize() {
  const dpr = devicePixelRatio || 1;
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = W / 2; cy = H - 52;
}
resize(); addEventListener('resize', resize);

const overMask = (x, y) => x > cx - 40 && x < cx + 40 && y > cy - 70 && y < cy + 40;

function loop(now) {
  requestAnimationFrame(loop);
  if (now - last < FRAME - 1) return;
  last = now;
  ctx.clearRect(0, 0, W, H);
  const frame = Math.floor(now / FRAME);
  if (now - shownAt < FRAME * 2) {   // lands as a white silhouette
    ctx.save(); ctx.translate(cx, cy); ctx.scale(K, K); drawMask(ctx, { flat: C.paper }); ctx.restore(); return;
  }
  ctx.save(); ctx.translate(cx, cy + [0, -1.5, -3, -1.5][Math.floor(frame / 6) % 4]); ctx.scale(K, K);   // slow float, on twos
  let eyes = [0, 0], look = null;
  if (!peek && now > nextPeek) { peek = { eye: Math.random() < 0.5 ? 0 : 1, until: now + 900 }; nextPeek = now + 7000 + Math.random() * 7000; }
  if (peek) { if (now > peek.until) peek = null; else eyes[peek.eye] = 0.45; }   // the wink
  if (pointer) { eyes = hover ? [1, 1] : [0.4, 0.4]; look = { x: (pointer.x - cx) / K, y: (pointer.y - cy) / K }; }
  const shake = hover ? (Math.random() - 0.5) * 2 : 0;
  ctx.translate(shake, 0);
  drawMask(ctx, { eyes, look, boil: 1.2, seed: Math.floor(frame / 2) });
  ctx.restore();
}
requestAnimationFrame(loop);

addEventListener('mousemove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  const h = overMask(e.clientX, e.clientY);
  if (h !== hover) { hover = h; document.body.classList.toggle('hover', h); window.capri.dockHover(h); }
});
addEventListener('mouseleave', () => { pointer = null; if (hover) { hover = false; document.body.classList.remove('hover'); window.capri.dockHover(false); } });
addEventListener('click', (e) => { if (overMask(e.clientX, e.clientY)) window.capri.dockClick(); });
window.capri.on('show', () => { shownAt = performance.now(); });
