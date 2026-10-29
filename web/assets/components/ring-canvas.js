// RingCanvas: thin wrapper over shared/ring.js (globalThis.JaalRing).
import { h } from '../lib.js';

export function RingCanvas(ring, opts = {}) {
  const box = h('div', { class: 'ringcanvas ' + (opts.compact ? 'ringthumb' : ''), style: opts.style || null });
  let ctl = null;
  const draw = () => {
    if (!ring || !globalThis.JaalRing) return;
    ctl = globalThis.JaalRing.render(box, ring, opts);
  };
  // draw once the box is in the DOM and has a size
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = 0, first = true;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (!w || Math.abs(w - lastW) < 24) return;
      lastW = w;
      opts = { ...opts, animate: first ? opts.animate : false };
      first = false;
      draw();
    });
    ro.observe(box);
    box._ro = ro;
  } else requestAnimationFrame(draw);
  box.replay = () => ctl && ctl.replay();
  return box;
}
