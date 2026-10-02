// Signal path: the processing-graph node list (pure) and its p5 view (snake layout, animated
// flow, truncated subtitles). Extracted from V1 pathNodesFor and createSketch pathPos/
// ensurePathSubs/drawPath (index.html@a7b7a23, sections 7 and 9); bodies unchanged.
// V2 extends pathNodesFor with filter, ADSR, additive and stereo nodes.

import { WAVEFORM_LABELS, LIMITER_THRESHOLD_DB } from '../core/constants.js';
import { sig } from '../core/math.js';
import { formatFrequency } from '../core/frequency.js';

// V1: pathNodesFor (index.html@a7b7a23). st: bridge state (waveform, labels).
export function pathNodesFor(plan, st) {
  const t = plan ? plan.type : 'const';
  const modulated = !!(plan && plan.modulated) || t === 'dual';
  let mod = { title: 'MODULATION', sub: 'none · fixed frequency' };
  if (t === 'steps') mod = { title: 'FREQUENCY STEPS', sub: `${plan.steps.length} scheduled steps` };
  if (t === 'ramps') mod = { title: 'FREQUENCY RAMP', sub: plan.segments[0].curve === 'log' ? 'exponential ramp' : 'linear ramp' };
  if (t === 'lfo') mod = { title: 'LFO → FREQUENCY', sub: `${sig(plan.rate, 3)} Hz · ±${formatFrequency(plan.depth)}` };
  if (t === 'am') mod = { title: 'LFO → GAIN (AM)', sub: `${sig(plan.modFreq, 3)} Hz · ${Math.round(plan.depth * 100)} %` };
  if (t === 'fm') mod = { title: 'MODULATOR → FREQ', sub: `${sig(plan.modFreq, 3)} Hz · ±${formatFrequency(plan.depth)}` };
  if (t === 'dual') mod = { title: plan.stereo ? 'STEREO PANNERS' : 'MIX (MONO)', sub: plan.stereo ? 'A → left · B → right' : 'A + B summed' };
  const osc = t === 'dual'
    ? { title: 'OSC A + OSC B', sub: `${formatFrequency(plan.a.freq)} · ${formatFrequency(plan.b.freq)}` }
    : { title: 'OSCILLATOR', sub: `${WAVEFORM_LABELS[st.waveform] || 'Sine'} · ${st.labels.freq}` };
  return [
    { ...osc, mod: false },
    { ...mod, mod: true, enabled: modulated },
    { title: 'ENVELOPE', sub: `A ${st.labels.attack} · R ${st.labels.release}`, mod: false },
    { title: 'MASTER GAIN', sub: `logical ${st.labels.gain}`, mod: false },
    { title: 'LIMITER', sub: `${LIMITER_THRESHOLD_DB} dBFS threshold`, mod: false },
    { title: 'ANALYSER', sub: 'FFT 8192 · visualizer', mod: false },
    { title: 'DEVICE OUTPUT', sub: 'speaker output unknown', mod: false },
  ];
}

export const PATH_GAP_X = 14;
export const PATH_GAP_Y = 20;

/**
 * createSignalPathView() -> { id: 'path', draw(h, st, now) } for createP5Host.
 * h: host context { p, W, H, pal, label, fits, charW }.
 */
export function createSignalPathView() {
  let p; let W; let H; let pal; let label; let fits; let charW;
  const bind = (h) => ({ p, W, H, pal, label, fits, charW } = h);

  // signal-path layout, scratch position and truncated-subtitle cache
  let pCols = 1;
  let pBw = 1;
  let pBh = 1;
  let pTop = 0;
  const pPos = new Float64Array(2);
  let pathSubs = [];
  let pathSubsNodes = null;
  let pathSubsBw = -1;
  let pathTitles = [];
  let pathSubsSize = -1;
  let pathGapX = PATH_GAP_X;
  let pathGapY = PATH_GAP_Y;
  let pathFooter = 14;

  // V1: pathPos, ensurePathSubs, drawPath (index.html@a7b7a23)
  /** Top-left corner of node i in the snake layout, written into pPos. */
  function pathPos(i) {
    const r = Math.floor(i / pCols);
    let c = i % pCols;
    if (r % 2 === 1) c = pCols - 1 - c; // snake layout keeps arrows short
    pPos[0] = 12 + c * (pBw + pathGapX);
    pPos[1] = pTop + r * (pBh + pathGapY);
  }
  /** Titles and subtitles truncated to the box width; rebuilt only when the nodes or the
   *  width change. */
  function ensurePathSubs(nodes, titleSize) {
    if (nodes === pathSubsNodes && pBw === pathSubsBw && titleSize === pathSubsSize) return;
    const room = pBw - 9;
    const fit = (t, size) => {
      if (fits(t, size, room)) return t;
      return `${t.slice(0, Math.max(3, Math.floor(room / charW[size]) - 1))}…`;
    };
    pathTitles = nodes.map((n) => fit(n.title, titleSize));
    pathSubs = nodes.map((n) => fit(n.sub, 8));
    pathSubsNodes = nodes;
    pathSubsBw = pBw;
    pathSubsSize = titleSize;
  }
  function drawPath(st, now) {
    const nodes = st.pathNodes;
    if (!nodes.length) return;
    pCols = W >= 760 ? 7 : W >= 430 ? 4 : 3;
    const rows = Math.ceil(nodes.length / pCols);
    pathGapX = W < 430 ? 10 : PATH_GAP_X;
    pathGapY = H < 160 ? 8 : PATH_GAP_Y;
    pathFooter = H < 140 ? 0 : 14;
    // an unmodulated source skips the modulation stage: OSC → ENVELOPE runs over a bypass arc
    // above the first row (the first three nodes always share it)
    const bypass = nodes.length > 2 && nodes[1].mod && !nodes[1].enabled;
    const arcRoom = bypass ? 12 : 0;
    const avail = H - pathFooter - arcRoom - 8;
    pBw = (W - 24 - pathGapX * (pCols - 1)) / pCols;
    pBh = Math.max(12, Math.min(58, (avail - pathGapY * (rows - 1)) / rows));
    pTop = arcRoom + 4 + Math.max(0, (avail - (rows * pBh + (rows - 1) * pathGapY)) / 2);
    const titleSize = pBw < 90 || pBh < 26 ? 8 : 10;
    ensurePathSubs(nodes, titleSize);
    const playing = st.playing && st.live.voice;
    const t = (now / 1000) * 0.6;
    for (let i = 0; i < nodes.length - 1; i++) {
      pathPos(i);
      const ax = pPos[0];
      const ay = pPos[1];
      pathPos(i + 1);
      const bx = pPos[0];
      const by = pPos[1];
      const sameRow = Math.abs(ay - by) < 1;
      const x1 = sameRow ? (bx > ax ? ax + pBw : ax) : ax + pBw / 2;
      const y1 = sameRow ? ay + pBh / 2 : ay + pBh;
      const x2 = sameRow ? (bx > ax ? bx : bx + pBw) : bx + pBw / 2;
      const y2 = sameRow ? by + pBh / 2 : by;
      // OSC → MODULATION and MODULATION → ENVELOPE carry nothing while bypassed
      const bypassed = bypass && i < 2;
      const active = playing && !bypassed && (nodes[i + 1].mod ? nodes[i + 1].enabled : true);
      p.stroke(active ? pal.accent : bypassed ? pal.gridSoft : pal.grid);
      p.strokeWeight(active ? 1.5 : 1);
      p.line(x1, y1, x2, y2);
      if (active && !st.reducedMotion) {
        const k = (t + i * 0.15) % 1;
        p.noStroke();
        p.fill(pal.accent);
        p.circle(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, 4);
      }
    }
    if (bypass) {
      pathPos(0);
      const ax = pPos[0] + pBw / 2;
      const ay = pPos[1];
      pathPos(2);
      const bx = pPos[0] + pBw / 2;
      const h = (arcRoom * 4) / 3; // a cubic with both handles at h peaks at 0.75 h
      p.noFill();
      p.stroke(playing ? pal.accent : pal.grid);
      p.strokeWeight(playing ? 1.5 : 1);
      p.bezier(ax, ay, ax, ay - h, bx, ay - h, bx, ay);
      if (playing && !st.reducedMotion) {
        const k = t % 1;
        p.noStroke();
        p.fill(pal.accent);
        p.circle(p.bezierPoint(ax, ax, bx, bx, k), p.bezierPoint(ay, ay - h, ay - h, ay, k), 4);
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      pathPos(i);
      const x = pPos[0];
      const y = pPos[1];
      const on = playing && (!n.mod || n.enabled);
      const pulse = on && !st.reducedMotion ? 0.5 + 0.5 * Math.sin(now / 600 + i) : 0;
      p.fill(pal.bg);
      p.stroke(on ? pal.accent : n.mod && !n.enabled ? pal.gridSoft : pal.grid);
      p.strokeWeight(on ? 1.5 + pulse * 0.8 : 1);
      p.rect(x, y, pBw, pBh, Math.min(6, pBh / 3));
      label(pathTitles[i], x + 7, pBh >= 26 ? y + 16 : y + pBh / 2 + 3, on ? pal.fg : pal.muted, titleSize);
      if (pBh > 34) label(pathSubs[i], x + 7, y + 31, pal.muted, 8);
    }
    if (pathFooter) label(playing ? 'active path' : 'idle — subdued nodes are not processing', 12, H - 6, pal.muted, 9);
  }

  return {
    id: 'path',
    draw(h, st, now) { bind(h); drawPath(st, now); },
  };
}
