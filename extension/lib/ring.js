/*
 * JAAL ring renderer. Classic script, no dependencies -> globalThis.JaalRing.
 * Works on web pages and in Chrome extension pages (no eval, no inline handlers,
 * no injected <style>: motion uses the Web Animations API).
 *
 *   JaalRing.render(container, ring, { size, width, height, animate, compact, labels, pulse, colors })
 *     -> { svg, replay(), destroy() }
 *   JaalRing.exportPNG(ring, { width: 1200, height: 675, title, subtitle, footer, as: 'blob'|'dataUrl' })
 *     -> Promise<{ blob, dataUrl, canvas }>
 *   JaalRing.layout(ring, geometry) -> positioned nodes (deterministic: same input, same picture)
 *
 * Ring (SPEC): { center, nodes: [{ id, type, label, hop, reports, confirmed }], edges: [{ source, target, type }] }
 */
(function (root) {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var DEFAULTS = {
    ink900: '#0A0C0F', ink700: '#16191D', ink500: '#2A2F35',
    textHi: '#F4F3F0', textLo: '#9BA1A8', brand: '#6E5BFF', confirmed: '#E5484D'
  };
  // Reveal timeline from SPEC.md (ms)
  var T = { center: 0, hop1: 150, hop1Stagger: 24, edge: 200, hop2: 500, hop2Stagger: 14, pulse: 900 };
  var R1 = 64, R2 = 128, TAU = Math.PI * 2;

  function hash(str) {
    var h = 2166136261;
    str = String(str);
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function readColors(el, over) {
    var c = {}, k;
    for (k in DEFAULTS) c[k] = DEFAULTS[k];
    try {
      var cs = el && root.getComputedStyle ? root.getComputedStyle(el) : null;
      if (cs) {
        var map = { brand: '--brand', confirmed: '--state-confirmed', textLo: '--text-lo', textHi: '--text-hi', ink900: '--ink-900' };
        for (k in map) { var v = cs.getPropertyValue(map[k]).trim(); if (v) c[k] = v; }
      }
    } catch (e) { /* defaults */ }
    if (over) for (k in over) c[k] = over[k];
    return c;
  }

  /* ---------------- layout ---------------- */

  function normalise(ring) {
    var nodes = (ring && ring.nodes) || [];
    var edges = (ring && ring.edges) || [];
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    var centerId = ring && ring.center && byId[ring.center] ? ring.center : (nodes[0] && nodes[0].id);
    var adj = {};
    edges.forEach(function (e) {
      if (!byId[e.source] || !byId[e.target]) return;
      (adj[e.source] = adj[e.source] || []).push(e.target);
      (adj[e.target] = adj[e.target] || []).push(e.source);
    });
    // hop: trust given value, else BFS from centre
    var hop = {};
    hop[centerId] = 0;
    var q = [centerId];
    while (q.length) {
      var cur = q.shift();
      (adj[cur] || []).forEach(function (n) { if (hop[n] === undefined) { hop[n] = hop[cur] + 1; q.push(n); } });
    }
    var list = nodes.slice(0, 40).map(function (n) {
      var h = n.id === centerId ? 0 : (n.hop === 1 || n.hop === 2 ? n.hop : Math.min(2, hop[n.id] || 2));
      return { id: n.id, type: n.type, label: n.label || n.id, reports: Math.max(0, +n.reports || 0), confirmed: !!n.confirmed, hop: h };
    });
    var keep = {};
    list.forEach(function (n) { keep[n.id] = true; });
    return { centerId: centerId, nodes: list, edges: edges.filter(function (e) { return keep[e.source] && keep[e.target]; }), adj: adj };
  }

  /**
   * Deterministic radial layout. Hop-1 nodes get angular sectors weighted by how many
   * hop-2 children they carry; hop-2 children fan out inside their parent's sector.
   * A few rounds of angular collision relaxation keep nodes from touching.
   * geometry: { cx, cy, sx, sy, nodeScale }
   */
  function layout(ring, g) {
    var N = normalise(ring);
    var cx = g.cx, cy = g.cy, sx = g.sx, sy = g.sy, ns = g.nodeScale || 1;
    var maxRep = 1;
    N.nodes.forEach(function (n) { if (n.reports > maxRep) maxRep = n.reports; });
    N.nodes.forEach(function (n) {
      var t = Math.log(1 + n.reports) / Math.log(1 + maxRep);
      var d = n.hop === 0 ? 18 : 6 + 12 * t; // diameter 6..18 by reports
      n.r = (d / 2) * ns;
    });
    var center = null, h1 = [], h2 = [];
    N.nodes.forEach(function (n) { if (n.hop === 0) center = n; else if (n.hop === 1) h1.push(n); else h2.push(n); });
    var sortKey = function (a, b) { return (hash(a.id) - hash(b.id)) || (a.id < b.id ? -1 : 1); };
    h1.sort(sortKey);
    h2.sort(sortKey);

    // parent of each hop-2 node: its first hop-1 neighbour in stable order
    var h1Set = {};
    h1.forEach(function (n) { h1Set[n.id] = n; n.children = []; });
    var orphans = [];
    h2.forEach(function (n) {
      var nb = (N.adj[n.id] || []).filter(function (id) { return h1Set[id]; }).sort();
      if (nb.length) h1Set[nb[0]].children.push(n); else orphans.push(n);
    });

    var base = (hash(N.centerId) % 360) / 360 * TAU;
    var totalW = 0;
    h1.forEach(function (n) { n.w = 1 + n.children.length * 0.9; totalW += n.w; });
    if (orphans.length) totalW += orphans.length * 0.9;
    var a = base;
    h1.forEach(function (n) {
      var span = (n.w / totalW) * TAU;
      n.angle = a + span / 2;
      n.span = span;
      a += span;
      var k = n.children.length;
      n.children.forEach(function (c, i) {
        var f = k === 1 ? 0.5 : i / (k - 1);
        c.angle = n.angle + (f - 0.5) * span * 0.86;
        c.rad = R2 * (k > 2 && i % 2 ? 0.9 : 1);
      });
    });
    orphans.forEach(function (c, i) {
      var span = (0.9 / totalW) * TAU;
      c.angle = a + span * (i + 0.5);
      c.rad = R2;
    });
    h1.forEach(function (n) { n.rad = R1; });

    // light collision relaxation on each ring, angular only (radius is meaningful)
    function relax(list) {
      if (list.length < 2) return;
      for (var it = 0; it < 24; it++) {
        var moved = false;
        list.sort(function (p, q) { return p.angle - q.angle; });
        for (var i = 0; i < list.length; i++) {
          var p = list[i], q = list[(i + 1) % list.length];
          var da = q.angle - p.angle;
          if (i === list.length - 1) da += TAU;
          var arcR = Math.min(p.rad, q.rad) * Math.min(sx, sy);
          var need = (p.r + q.r + 3 * ns) / Math.max(arcR, 1);
          if (da < need) {
            var push = (need - da) / 2;
            p.angle -= push; q.angle += push; moved = true;
          }
        }
        if (!moved) break;
      }
    }
    relax(h1);
    relax(h2);

    if (center) { center.x = cx; center.y = cy; center.angle = 0; }
    h1.concat(h2).forEach(function (n) {
      n.x = cx + Math.cos(n.angle) * n.rad * sx;
      n.y = cy + Math.sin(n.angle) * n.rad * sy;
    });
    return { center: center, hop1: h1, hop2: h2, nodes: N.nodes, edges: N.edges, byId: N.nodes.reduce(function (m, n) { m[n.id] = n; return m; }, {}) };
  }

  function nodeColor(n, C) {
    if (n.hop === 0) return { fill: C.brand, op: 1 };
    if (n.confirmed) return { fill: C.confirmed, op: 1 };
    return { fill: C.textLo, op: 0.4 };
  }

  /* ---------------- SVG render ---------------- */

  function el(name, attrs, parent) {
    var e = root.document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function render(container, ring, opts) {
    opts = opts || {};
    if (!container) throw new Error('JaalRing.render: container required');
    var compact = !!opts.compact;
    var rect = container.getBoundingClientRect ? container.getBoundingClientRect() : { width: 0, height: 0 };
    var W = opts.width || opts.size || Math.round(rect.width) || (compact ? 240 : 320);
    var H = opts.height || (compact ? 72 : (opts.size || Math.round(rect.height) || W));
    var labels = !!opts.labels && !compact;
    var C = readColors(container, opts.colors);
    var pad = compact ? 6 : (labels ? 34 : 14);
    var sy = (H / 2 - pad) / (R2 + 9);
    var sx = (W / 2 - pad) / (R2 + 9);
    if (compact) sx = Math.min(sx, sy * 3.2); else { var s = Math.min(sx, sy); sx = sy = s; }
    var nodeScale = compact ? Math.max(0.34, sy * 1.15) : Math.max(0.6, Math.min(1.7, sy));
    var L = layout(ring, { cx: W / 2, cy: H / 2, sx: sx, sy: sy, nodeScale: nodeScale });

    var animate = opts.animate !== false && !reducedMotion() && typeof Element !== 'undefined' && !!Element.prototype.animate;
    container.innerHTML = '';
    var confirmedCount = L.nodes.filter(function (n) { return n.confirmed; }).length;
    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: compact ? H : '100%',
      role: 'img', 'aria-label': 'Ring of ' + L.nodes.length + ' linked identifiers, ' + confirmedCount + ' confirmed',
      preserveAspectRatio: 'xMidYMid meet', focusable: 'false'
    }, container);
    svg.style.display = 'block';
    svg.style.overflow = 'visible';
    var gE = el('g', { 'stroke-linecap': 'round' }, svg);
    var gP = el('g', {}, svg);
    var gN = el('g', {}, svg);
    var gL = el('g', {}, svg);
    var anims = [];

    function appearAt(n) {
      if (n.hop === 0) return T.center;
      if (n.hop === 1) return T.hop1 + L.hop1.indexOf(n) * T.hop1Stagger;
      return T.hop2 + L.hop2.indexOf(n) * T.hop2Stagger;
    }

    L.edges.forEach(function (e) {
      var a = L.byId[e.source], b = L.byId[e.target];
      if (a.hop > b.hop) { var t = a; a = b; b = t; }
      var line = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: C.textLo, 'stroke-opacity': 0.2, 'stroke-width': compact ? 0.75 : 1, 'vector-effect': 'non-scaling-stroke' }, gE);
      if (animate) {
        var len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        line.setAttribute('stroke-dasharray', len + ' ' + len);
        anims.push(line.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
          { duration: T.edge, delay: Math.max(0, appearAt(b) - 40), easing: 'cubic-bezier(0.2,0.8,0.2,1)', fill: 'both' }));
      }
    });

    var pulseIter = opts.pulse === 'loop' ? Infinity : (typeof opts.pulse === 'number' ? opts.pulse : 3);
    L.nodes.forEach(function (n) {
      var col = nodeColor(n, C);
      var g = el('g', { transform: 'translate(' + n.x.toFixed(2) + ' ' + n.y.toFixed(2) + ')' }, gN);
      var c = el('circle', { cx: 0, cy: 0, r: n.r.toFixed(2), fill: col.fill, 'fill-opacity': col.op }, g);
      if (n.hop === 0) el('circle', { cx: 0, cy: 0, r: (n.r + 3 * nodeScale).toFixed(2), fill: 'none', stroke: C.brand, 'stroke-opacity': 0.35, 'stroke-width': 1 }, g);
      var title = el('title', {}, c);
      title.textContent = n.label + (n.reports ? ' · ' + n.reports + ' reports' : '') + (n.confirmed ? ' · confirmed' : '');
      if (animate) {
        c.style.transformBox = 'fill-box';
        c.style.transformOrigin = 'center';
        anims.push(c.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: 260, delay: appearAt(n), easing: 'cubic-bezier(0.2,0.8,0.2,1.2)', fill: 'both' }));
        if (n.hop === 0) anims.push(g.lastChild.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 120, fill: 'both' }));
      }
      if (n.confirmed && animate && pulseIter > 0) {
        var halo = el('circle', { cx: n.x, cy: n.y, r: n.r.toFixed(2), fill: 'none', stroke: col.fill, 'stroke-width': compact ? 1 : 1.5 }, gP);
        halo.style.transformBox = 'fill-box';
        halo.style.transformOrigin = 'center';
        halo.style.opacity = '0';
        anims.push(halo.animate([{ transform: 'scale(1)', opacity: 0.7 }, { transform: 'scale(2.8)', opacity: 0 }],
          { duration: 1600, delay: T.pulse + (n.hop === 0 ? 0 : 60 * n.hop), iterations: pulseIter, easing: 'cubic-bezier(0.2,0.8,0.2,1)', fill: 'none' }));
      }
    });

    if (labels) {
      var max = opts.maxLabels || 6;
      var cand = L.nodes.filter(function (n) { return n.hop === 0 || n.confirmed; })
        .sort(function (a, b) { return a.hop - b.hop || b.reports - a.reports; }).slice(0, max);
      var placed = [];
      cand.forEach(function (n) {
        var dx = n.x - W / 2, dy = n.y - H / 2;
        var d = Math.hypot(dx, dy) || 1;
        var ux = n.hop === 0 ? 0 : dx / d, uy = n.hop === 0 ? 1 : dy / d;
        var tx = n.x + ux * (n.r + 6), ty = n.y + uy * (n.r + 6) + (n.hop === 0 ? 8 : 4);
        for (var i = 0; i < placed.length; i++) if (Math.abs(placed[i][0] - tx) < 80 && Math.abs(placed[i][1] - ty) < 14) return;
        placed.push([tx, ty]);
        var anchor = n.hop === 0 || Math.abs(ux) < 0.3 ? 'middle' : (ux > 0 ? 'start' : 'end');
        var t = el('text', { x: tx.toFixed(1), y: ty.toFixed(1), 'text-anchor': anchor, fill: n.hop === 0 ? C.textHi : C.textLo, 'font-size': 11, 'font-family': 'Inter, system-ui, sans-serif' }, gL);
        t.textContent = n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label;
        if (animate) anims.push(t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: appearAt(n) + 120, fill: 'both' }));
      });
    }

    return {
      svg: svg,
      layout: L,
      replay: function () { anims.forEach(function (a) { try { a.cancel(); a.play(); } catch (e) { /* noop */ } }); },
      destroy: function () { anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* noop */ } }); container.innerHTML = ''; }
    };
  }

  /* ---------------- PNG export (same layout, canvas) ---------------- */

  function wrap(ctx, text, maxW) {
    var words = String(text || '').split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function drawMark(ctx, x, y, s, color) {
    // the JAAL net mark: a node with three knots, matches favicon.svg
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s / 32, s / 32);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    var pts = [[16, 6], [26, 22], [6, 22]];
    ctx.beginPath();
    pts.forEach(function (p) { ctx.moveTo(16, 16); ctx.lineTo(p[0], p[1]); });
    ctx.moveTo(16, 6); ctx.lineTo(26, 22); ctx.lineTo(6, 22); ctx.closePath();
    ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1;
    pts.forEach(function (p) { ctx.beginPath(); ctx.arc(p[0], p[1], 2.6, 0, TAU); ctx.fill(); });
    ctx.beginPath(); ctx.arc(16, 16, 4, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function exportPNG(ring, opts) {
    opts = opts || {};
    var W = opts.width || 1200, H = opts.height || 675;
    var C = readColors(opts.colorSource || (root.document && root.document.documentElement), opts.colors);
    var canvas = root.document.createElement('canvas');
    var dpr = opts.pixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    var ready = root.document.fonts && root.document.fonts.ready ? root.document.fonts.ready : Promise.resolve();
    return Promise.resolve(ready).then(function () {
      var F = 'Inter, "Noto Sans Devanagari", "Noto Sans Gujarati", system-ui, sans-serif';
      ctx.fillStyle = C.ink900; ctx.fillRect(0, 0, W, H);
      // hairline frame
      ctx.strokeStyle = C.ink500 || DEFAULTS.ink500; ctx.lineWidth = 1;
      ctx.strokeRect(24.5, 24.5, W - 49, H - 49);

      // ring on the right
      var rcx = W * 0.745, rcy = H / 2, budget = Math.min(W * 0.22, H * 0.42);
      var s = budget / (R2 + 9);
      var L = layout(ring, { cx: rcx, cy: rcy, sx: s, sy: s, nodeScale: Math.max(1, s * 0.9) });
      // faint orbit guides
      ctx.strokeStyle = C.textLo; ctx.globalAlpha = 0.08; ctx.setLineDash([2, 6]);
      [R1, R2].forEach(function (r) { ctx.beginPath(); ctx.arc(rcx, rcy, r * s, 0, TAU); ctx.stroke(); });
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.2; ctx.lineWidth = 1.25;
      L.edges.forEach(function (e) {
        var a = L.byId[e.source], b = L.byId[e.target];
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });
      L.nodes.forEach(function (n) {
        var col = nodeColor(n, C);
        if (n.confirmed || n.hop === 0) {
          ctx.globalAlpha = 0.25; ctx.strokeStyle = col.fill; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 1.9, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = col.op; ctx.fillStyle = col.fill;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, TAU); ctx.fill();
      });
      ctx.globalAlpha = 1;

      // text block on the left
      var x = 72, maxW = W * 0.46 - 40;
      drawMark(ctx, x, 64, 36, C.brand);
      ctx.fillStyle = C.textHi; ctx.font = '600 30px ' + F; ctx.textBaseline = 'middle';
      ctx.fillText('jaal', x + 46, 83);
      ctx.textBaseline = 'alphabetic';
      var title = opts.title || 'A scam ring, mapped';
      var size = title.length > 48 ? 46 : 56;
      ctx.font = '600 ' + size + 'px ' + F;
      var lines = wrap(ctx, title, maxW).slice(0, 4);
      var y = H / 2 - ((lines.length - 1) * size * 1.12) / 2 - 10;
      lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * size * 1.12); });
      y += (lines.length - 1) * size * 1.12;
      if (opts.subtitle) {
        ctx.fillStyle = C.textLo; ctx.font = '400 26px ' + F;
        wrap(ctx, opts.subtitle, maxW).slice(0, 3).forEach(function (l, i) { ctx.fillText(l, x, y + 52 + i * 36); });
      }
      ctx.fillStyle = C.textLo; ctx.font = '400 18px ' + F;
      var confirmed = L.nodes.filter(function (n) { return n.confirmed; }).length;
      ctx.fillText(opts.footer || (L.nodes.length + ' linked identifiers · ' + confirmed + ' confirmed · jaal checks before you pay'), x, H - 64);
      // legend
      var lx = W - 72;
      ctx.textAlign = 'right';
      ctx.fillText('confirmed', lx, H - 64);
      var tw = ctx.measureText('confirmed').width;
      ctx.fillStyle = C.confirmed; ctx.beginPath(); ctx.arc(lx - tw - 14, H - 70, 6, 0, TAU); ctx.fill();
      ctx.textAlign = 'left';

      var dataUrl = canvas.toDataURL('image/png');
      return new Promise(function (resolve) {
        if (canvas.toBlob) canvas.toBlob(function (blob) { resolve({ blob: blob, dataUrl: dataUrl, canvas: canvas }); }, 'image/png');
        else resolve({ blob: null, dataUrl: dataUrl, canvas: canvas });
      });
    });
  }

  function downloadPNG(ring, opts, filename) {
    return exportPNG(ring, opts).then(function (out) {
      var a = root.document.createElement('a');
      var href = out.blob ? URL.createObjectURL(out.blob) : out.dataUrl;
      a.href = href; a.download = filename || 'jaal-ring.png';
      root.document.body.appendChild(a); a.click(); a.remove();
      if (out.blob) setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
      return out;
    });
  }

  root.JaalRing = { render: render, exportPNG: exportPNG, downloadPNG: downloadPNG, layout: layout, timeline: T, version: '1.0.0' };
})(typeof globalThis !== 'undefined' ? globalThis : this);
