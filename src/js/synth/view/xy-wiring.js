// The XY pad's one shared mount (plan K167, over K097; K183 option B): every node and edge the
// pad's surface edits, every note it plays and every path that releases what it holds. The
// Synth workspace's XY tab (view/xy-tab.js) calls it, and the live landing composes the same
// mount rather than a second wiring. No other file builds the pad's cables (tests/unit/
// xy-wiring.test.mjs greps the sources); synth/library.js only lists and loads whole patches of
// the one patch catalog, and synth/xy.js xyInsertAction cables Y at the panel's insertion.
//
//   mountSynthXy(host, { store, transport, panel, owner, app, arm, say, jackName, dispatch,
//     notes, mountPad, sampleRate, claim }) -> { view, owner, notes, release(reason), destroy() }
//     store      the Studio store handle (getModel, dispatch): the one writer of the document
//     transport  the Studio transport, or a function returning it (late-bound: null before
//                audio); the pad's X and Y reach its node through transport.live, never the
//                model
//     owner      who owns the mount, default 'synth' (the Synth workspace); a later target
//                owned by 'landing' (its home: the landing) is released by Stop like this one,
//                never by the Synth panel's own live updates
//     app        the Alpine component: its root's `osc:ui` 'mode' event (a workspace leave),
//                its outputOwner (the audio owner), its audioState (a suspended context: the
//                cold first touch) and kbdPad (the keys' note layer, below); optional
//     arm()      the first touch arms the instrument (synth/ui.js synthArm): true, or the
//                reason it did not ({ ok: false, reason, said } | reason | false); the reason
//                is said (assertively, unless `said`) and shown on the line that describes the
//                pad, so a refused touch is never silent (project.no-silent-feedback)
//     notes      the note input the pad plays (default app.kbdPad(release), midi/keyboard-ui.js:
//                { noteOn, noteOff, legato, velocity, off }); without one the pad plays only its
//                own node
//     claim      false: the pad claims no notes from the docked keyboard (K220, pad R under the
//                Panel face, beside the keyboard); default true (the XY tab, K171)
//     mountPad   the pad kind's mount (ui/kinds/xy-pad.js mountXyPad; a seam for unit tests)
//     sampleRate()  the running AudioContext's rate, null before one exists (default: none);
//                Y's value is sized at its 0.95 x Nyquist (xyYReading), else at the provisional
//                44.1 kHz, and a value the compiler holds there says so with the rate it used
//   view.destroy() releases and removes every subscription; a second destroy changes nothing.
//   xyPresetAction(model, panel, id) -> { action } | { reason }   a built-in XY preset
//   keysSilenceHtml(model, panel, buttonClass) -> markup | ''   the Panel tab's notice while the
//     panel's keys sound nothing (xy.js keysSilence, review S8), with Unpatch the pad when the
//     pad's cables are the cause (on the XY tab the pad plays, and a key says the same)
//   wireKeysSilence(root, { model, panel, dispatch, say })   Unpatch the pad's click under
//     `root`: xy.js xyUnpatchAction, one BATCH
//
// The pad is one more note input of the keys (K183, option B; K178's one Keys source): a touch
// presses the note under X (xyDegree, the same quantisation as the pad node's pitch, one
// function) through midi/notes.js as source 'kbd-xy', at Y's velocity (K220); a move into another
// scale cell is notes.legato (no new gate: the Keys node's glide); the release, and every
// release path below, is its note-off. So the pad plays exactly what the keys play (the route of
// midi/routes.js: the panel's Keys or the engine on Synth), with the Keys node's own priority
// between pad, keys and MIDI, and no Pitch or Gate cable is needed: the keyboard's normals stay
// and a computer key still sounds. Y is an ordinary cable from the pad's node (the default
// Synth document has xy.y into LPF Cutoff, synth/xy.js xyInsertAction); X and Y reach the node
// through transport.live from a touch on (F1), and Y goes back to its rest on every release
// (N2); the pad's own Pitch and Gate outputs feed only the cables a user patches from them.
//
// The pad talks to what it plays through one small internal interface, the target:
//   target = { owner, output, wire(slot) -> spec | null, unwire(), live(kind, x, y),
//              arm() -> true | refusal, release(reason) -> released }
//   spec   = { params, steps, deg(i) (its note heard, or `sends`), sent(i) (the note it plays),
//              from, scale, target, lead, stated, reading }
// The document's Synth panel (documentTarget) is the only implementation: its controls edit
// the StudioModel, one BATCH and one undo entry each, and it plays the panel's xy-pad node
// through transport.live. The release paths are the mount's, never a target's: transport
// Stop (its 'state' event with playing false), leaving the workspace (`osc:ui` 'mode' on the
// app root), the audio owner moving away from the target's output (app.outputOwner; a change
// to no owner at all is the Stop's, released as 'stop'), page hide, blur and Escape (the pad
// kind's own listeners) and the keys' forced releases (kbdPad). Each closes the pad's gate, sends
// its note-off and then the router's all-off (studio/live-notes.js through transport.live), so a
// lost note-off never leaves a voice held. No window listener and no key binding is added here.
//
// First open (K183 supersedes K167's phone first action): opening the tab edits nothing (no
// BATCH, no history entry, no dirty document); the pad is enabled and states its default and
// "Touch the pad to play". Nothing arms and nothing sounds before that touch. A touch while the
// AudioContext is still suspended (a phone's first touch: its activation comes only at the
// lift) shows "Tap once to start audio" on that line; once the context runs, within the same
// gesture or the next, a note still held is played again (project.a-phone-sounds, the cold first
// touch).
//
// The note owner (K171): the mounted pad plays the notes (enabled from the first touch, K183),
// so while it is mounted and shown (a box on screen, R7) the mount claims the notes of its
// home workspace for 'xy-pad' (midi/dock-yield.js claimNotes) and drops the claim when it is
// hidden or destroyed; mount.notes says which. The docked keyboard derives its state from that claim and its route (midi/routes.js
// dockState); nothing here touches the dock.
//
// The pad's view (S3) is what the pad sends, drawn: each X cell is labelled by the note of
// xyDegree, the function the runtime adapter quantises X with, at the x the mount sends for
// that cell (xyCellX), moved by the octaves the lowest audible VCO adds (xySounding: the note
// heard, so XY bass at 16' names D1 for the pad's D2), or, when no note is known, the pad's own
// note said as "sends D3" (the ring, X's aria-valuetext, the readout line and the range text alike);
// Y's readout is what its target plays at y, xyYReading's at(y) (the
// compiler's own computeBases at the context's Nyquist limit, every cable's constant part in
// it) in the target knob's own text (knob.js), "held" when the compiler scaled Y's excursion
// down to stay at or below 0.95 x Nyquist; the Y ends are at(0) and at(1), read again on each
// drawn frame. The readout line sits above the pad, clear of the docked keyboard.
//   xyCellX(i, steps) -> the x (0..1) the mount sends for cell i: its centre
//
// Pad L (K220) is the same pad kind, mounted here too (the kind's one mount site): the panel's
// `xyl` module, which plays no notes; its X and Y reach its node through transport.live (on,
// move, off; all-off on a release with no touch), and its typed normals carry them to the LPF
// and HPF cutoffs. It releases through the same paths as pad R (padReleasePaths).
//   padReleasePaths({ transport, app, owner, output, release }) -> { listenStop(), off() }
//   padTargets(model, panel, module = 'xyl') -> { x: [jack], y: [jack] }   what each output
//     drives, normals and cables alike ('lpf.frequency'); muted edges left out
//   mountPadL(host, { store, transport, panel, app, arm, say, jackName, mountPad, owner })
//     -> { view, record, release(reason), destroy() }
//     Its Record switch (K231, ui/kinds/record-switch.js) arms the transport's one recorder
//     (studio/notes-record.js) with padTakeId(pad L's node): a take of its X and Y is written as
//     automation of the pad's own x and y while the timeline plays, which replays through
//     whatever its normals or cables feed.
//   PADS_TEXT   the pads' sentences (Czech, Q104)

import { mountXyPad } from '../../ui/kinds/xy-pad.js';
import { xyDegree } from '../../studio/nodes/instrument.js';
import { NOTE_NAMES, SCALE_LABELS, midiToName } from '../../core/music.js';
import { SAFE_NYQUIST_FACTOR_TEXT } from '../../core/constants.js';
import {
  KEYS_SILENT, XY_RECIPES, keysSilence, xyPatchAction, xyPresetPatch, xyRoom, xySounding,
  xyTarget, xyTargetAction, xyTargets, xyUnpatchAction, xyYReading,
} from '../xy.js';
import { limitBoundText } from '../../studio/compiler.js';
import { esc } from './face.js';
import { claimNotes, hasBox } from '../../midi/dock-yield.js';
import { knobModel } from './knob.js';
import { padTakeId } from '../../studio/notes-record.js';
import {
  PAD_RECORD_TEXT, bindRecordSwitch, recordSwitchHtml,
} from '../../ui/kinds/record-switch.js';

export const XY_TEXT = Object.freeze({
  missing: 'The XY pad is not in this Studio document: press Add the XY pad first.',
  first: 'Touch the pad to play. Nothing sounds until you do.',
  refused: 'The instrument did not start, so the pad plays nothing.',
  cold: 'Tap once to start audio.',
  /** Y with no cable (the default since K220): the touch's velocity only, and how to add a
   *  target. */
  free: 'Y je síla úhozu: z jacku Y padu nevede žádný kabel. Cíl přidáte v poli Y drives.',
});
export const XY_LEAD = XY_RECIPES.find((r) => r.id === 'xy-lead');
export const XY_OWNER = 'synth';
/** The pad's source in the keys' note layer (midi/notes.js: input 'xy'). */
export const XY_SOURCE = 'kbd-xy';
/**
 * The velocity of the note a touch plays (K220, the coordinator oscilla-43's decision of
 * 2026-11-09): pad R's Y, 0 to 1, as MIDI velocity XY_VELOCITY_FLOOR to 127 (the filter axis
 * moved to pad L). The floor keeps the pad's bottom edge and a keyboard Enter at the cursor's
 * rest (Y 0) heard: 40 plays 8 dB under the keys' default 100 through VELOCITY, where velocity 1
 * would be 40 dB under it; Y 5 % and 95 % still play 8.9 dB apart.
 */
export const XY_VELOCITY_FLOOR = 40;
export const xyVelocity = (y) => Math.max(XY_VELOCITY_FLOOR, Math.min(127,
  Math.round(XY_VELOCITY_FLOOR + (127 - XY_VELOCITY_FLOOR) * (Number.isFinite(y) ? y : 0))));
// The workspace an owner's mount lives in: leaving it releases the pad.
/** Y's name when it drives no cable: the touch's velocity (K220). */
const VELOCITY_NAME = 'síla úhozu';
const HOME = Object.freeze({ synth: 'synth', landing: 'landing' });
const SELECT = 'h-11 rounded-lg border border-solid border-gray-300 bg-gray-50 px-3 text-sm '
  + 'text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white';

/** The x the mount sends for cell i of `steps`: the cell's centre (what xyDegree quantises). */
export const xyCellX = (i, steps) => (i + 0.5) / steps;

const CURSORS = new WeakMap(); // store -> the pad's cursor: performance state, never the model
const APP_HUBS = new WeakMap(); // app -> key -> listeners: one $watch per app and key

let mounts = 0;

/** A built-in XY preset as one BATCH (xy.js: the recipe's patch on the document's panel). */
export function xyPresetAction(model, panel, id) {
  const recipe = XY_RECIPES.find((x) => x.id === id);
  if (!recipe) return { reason: `There is no XY preset "${id}".` };
  try {
    return xyPatchAction(model, panel, xyPresetPatch(model, panel, recipe));
  } catch (e) {
    return { reason: e.message };
  }
}

export function keysSilenceHtml(model, panel, buttonClass) {
  const q = keysSilence(model, panel);
  const undo = q && q.pad ? `<button type="button" data-xy-unpatch="" class="${buttonClass}">`
    + 'Unpatch the pad</button>' : '';
  return q ? '<div class="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-yellow-50 p-3 '
    + 'text-sm text-yellow-800 dark:bg-gray-800 dark:text-yellow-300" role="alert" '
    + `data-osc="synth.keys-silent"><p>${esc(q.reason)}</p>${undo}</div>` : '';
}

export function wireKeysSilence(root, { model, panel, dispatch, say }) {
  const button = root && root.querySelector('[data-xy-unpatch]');
  if (!button) return;
  button.addEventListener('click', () => {
    const a = xyUnpatchAction(model(), panel);
    if (a.reason) say(a.reason, true);
    else if (dispatch(a.action).ok) say(KEYS_SILENT.unpatched);
  });
}

/** fn(value) on each change of app[key]; -> off. */
function onApp(app, key, fn) {
  if (!app || typeof app.$watch !== 'function') return () => {};
  let hubs = APP_HUBS.get(app);
  if (!hubs) {
    hubs = new Map();
    APP_HUBS.set(app, hubs);
  }
  let hub = hubs.get(key);
  if (!hub) {
    hub = new Set();
    hubs.set(key, hub);
    // Alpine's $watch cannot be undone: one per app and key, fanned out to the live mounts.
    app.$watch(key, (now) => { for (const f of [...hub]) f(now); });
  }
  hub.add(fn);
  return () => hub.delete(fn);
}

/** The document's Synth panel as the pad's target (the only target today). */
function documentTarget({ store, panel, transport, owner, arm, say, jackName, dispatch,
  sampleRate }) {
  const model = () => store.getModel();
  const pad = () => panel.resolve(model()).get('xy');
  const offs = [];
  const act = (a, done) => {
    if (a.reason) say(a.reason, true);
    else if (dispatch(a.action).ok && done) say(done);
  };
  const on = (el, type, fn) => {
    if (!el) return;
    el.addEventListener(type, fn);
    offs.push(() => el.removeEventListener(type, fn));
  };
  let steps = 1;
  let roomOf = { m: null, r: null }; // the document xyRoom last read, and what it said
  return {
    owner,
    output: 'studio', // the panel sounds through the Studio transport
    /** Render the controls into `slot` and return what the pad shows, or null without a pad. */
    wire(slot) {
      if (!pad()) return null;
      const m = model(); // read only: opening the pad edits nothing
      const to = xyTarget(m, panel);
      slot.innerHTML = '<label for="synth-xy-y" class="text-sm text-gray-700 dark:text-gray-300">'
        + `Y drives</label><select id="synth-xy-y" data-osc="synth.xy.target" class="${SELECT}">`
        + `<option value="">Nothing</option>${xyTargets(panel).map((t) => `<option value=`
        + `"${t.id}"${t.id === to ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}`
        + '</select>';
      const s = slot.querySelector('[data-osc="synth.xy.target"]');
      on(s, 'change', () => act(xyTargetAction(model(), panel, s.value || null),
        s.value ? `Y drives ${s.selectedOptions[0].text}.` : XY_TEXT.free));
      const p = pad().params;
      steps = xyDegree(1, p).steps;
      const scale = `${p.key} ${SCALE_LABELS[p.mode]}`;
      const leadScale = p.mode === XY_LEAD.scale.mode && p.key === XY_LEAD.scale.key;
      const lead = leadScale && to === XY_LEAD.y;
      // The default since K220: the lead's scale, Y the velocity and no Y cable (pad L owns the
      // filters).
      const byDefault = leadScale && !to;
      // The note the voice sounds (xySounding: the VCOs' footage on the pad's note path, the
      // keys' pitch since K183); when that is not one known note, the pad's own note, said as
      // what it sends ("sends D3"). `sent` is the note the pad plays into the keys' note layer.
      const heard = xySounding(m, panel);
      const sent = (i) => xyDegree(xyCellX(i, steps), p);
      const deg = (i) => {
        const d = sent(i);
        if (!heard) return { ...d, sends: true };
        const note = d.note + 12 * heard.octaves;
        return { ...d, note, name: midiToName(note), sends: false };
      };
      const low = deg(0);
      const from = `${low.name}${low.sends ? ' (nota, kterou pad posílá)' : ''}`;
      const range = `${scale}, ${p.span} oct od ${from}`;
      const tag = lead ? " (the XY lead's scale and target)" : '';
      // What Y's target plays, read from the document and the context's rate at each reading.
      let seen = { m: null, sr: null, r: null };
      const reading = () => {
        const now = model();
        const sr = sampleRate() || null;
        if (now !== seen.m || sr !== seen.sr) {
          seen = { m: now, sr, r: xyYReading(now, panel, { sampleRate: sr }) };
        }
        return seen.r;
      };
      return { params: p, steps, deg, sent, from, scale, reading,
        target: to ? jackName(to) : VELOCITY_NAME, cabled: !!to, lead,
        stated: `${byDefault ? 'Výchozí: ' : ''}${range}; pad hraje to, co hrají klávesy; `
          + (to ? `Y řídí ${jackName(to)}${tag} a sílu úhozu.` : XY_TEXT.free) };
    },
    unwire() {
      while (offs.length) offs.pop()();
    },
    live(kind, x, y) {
      const t = transport();
      const n = pad();
      return t && t.playing && n ? t.live(n.id, { kind, x: xyCellX(x, steps), y }) : null;
    },
    arm,
    /**
     * Y held below its depth by its target's range (xy.js xyRoom), or null; computed once per
     * document (review of PR 428 NF6: it ran on every show and pointermove), again on any change.
     */
    room() {
      const m = model();
      if (m !== roomOf.m) roomOf = { m, r: xyRoom(m, panel) };
      return roomOf.r;
    },
    /** The router's release (live-notes.js all-off): whatever the pad's node still holds. */
    release() {
      const t = transport();
      const n = pad();
      return t && t.playing && n ? t.live(n.id, { kind: 'all-off' }).released || 0 : 0;
    },
  };
}

/**
 * The release paths every Synth pad mount shares (K220: pad R's mountSynthXy and pad L's
 * view/pads.js): transport Stop (its 'state' event with playing false), leaving the workspace
 * (`osc:ui` 'mode' on the app root) and the audio owner moving away from `output` (a change to
 * no owner at all is the Stop's, released as 'stop'). -> { listenStop(), off() }; listenStop
 * follows a transport made only by a later touch.
 */
export function padReleasePaths({ transport, app, owner, output, release }) {
  const offs = [];
  let heard = null; // the transport whose Stop this mount listens to
  let offHeard = () => {};
  const listenStop = () => {
    const t = transport();
    if (!t || t === heard || typeof t.on !== 'function') return;
    offHeard();
    heard = t;
    offHeard = t.on((type, d) => {
      if (type === 'state' && d && d.playing === false) release('stop');
    });
  };
  listenStop();
  const root = app && app.$root;
  if (root && typeof root.addEventListener === 'function') { // leaving the workspace
    const home = HOME[owner] || app.workspace;
    const leave = (e) => {
      const d = e.detail || {};
      if (d.kind === 'mode' && d.value !== home) release('leave');
    };
    root.addEventListener('osc:ui', leave);
    offs.push(() => root.removeEventListener('osc:ui', leave));
  }
  // A notification is a move only when the owner changed: the playback bus re-reads
  // outputOwner on its own claim (C051), and a touch's arm made it say null again.
  let seen = app ? app.outputOwner : undefined;
  offs.push(onApp(app, 'outputOwner', (now) => {
    if (now === seen) return;
    seen = now;
    if (now !== output) release(now === null ? 'stop' : 'owner');
  }));
  return {
    listenStop,
    off() {
      offHeard();
      while (offs.length) offs.pop()();
    },
  };
}

export function mountSynthXy(host, { store, transport = null, panel, owner = XY_OWNER, app = null,
  arm = null, say = () => {}, jackName = (id) => String(id), dispatch = null, notes = null,
  mountPad = mountXyPad, sampleRate = () => null, claim = true } = {}) {
  const tp = () => (typeof transport === 'function' ? transport() : transport);
  const target = documentTarget({ store, panel, transport: tp, owner, say, jackName,
    sampleRate, dispatch: dispatch || ((a) => store.dispatch(a)),
    arm: arm || (() => {
      const t = tp();
      return !!t && (t.playing || t.arm().ok);
    }) });
  const uid = `synth-xy-${(mounts += 1)}`;
  const offs = [];
  let view = null;
  let destroyed = false;
  let owns = null; // 'xy-pad' while the pad is mounted and playable: it owns the notes (K171)
  let held = null; // the note the pad holds in the keys' note layer, while its gate is open
  let opening = false; // inside the touch that opens the gate (its arm claims the output)
  // The keys' note layer: the pad is one more of its inputs; its forced releases close the gate,
  // except the one its own first touch causes (the arm's claim stops the output's last player).
  const input = notes || (app && typeof app.kbdPad === 'function'
    ? app.kbdPad((why) => (opening ? 0 : release(why))) : null);

  /** arm()'s answer as { ok, reason, said }. */
  const armed = () => {
    const r = target.arm();
    if (r === true || (r && r.ok === true)) return { ok: true };
    return { ok: false, reason: (typeof r === 'string' && r) || (r && r.reason)
      || XY_TEXT.refused, said: !!(r && r.said) };
  };

  /** Close the pad's gate, then the router's all-off: nothing the pad held stays held. */
  function release(reason) {
    if (destroyed) return 0;
    const gated = !!(view && view.model.gated);
    if (gated) view.model.end(reason); // onGate(false): the note-off, then the router's all-off
    else target.release(reason);
    return gated ? 1 : 0;
  }

  // ---- the release paths (the mount's, never the target's)
  const paths = padReleasePaths({ transport: tp, app, owner, output: target.output, release });
  const { listenStop } = paths;
  // Page hide, blur and Escape: the pad kind's own listeners end the gate ('hide', 'blur',
  // 'escape'), which onGate below routes through the same release.

  // ---- the surface
  host.innerHTML = '<div class="flex flex-wrap items-center gap-2" data-xy-controls=""></div>'
    + '<p class="mt-2 text-sm text-gray-700 dark:text-gray-300" data-xy-default=""></p>'
    + `<p id="${uid}-first" class="mt-1 text-sm font-semibold text-gray-900 dark:text-white" `
    + 'data-xy-first="" aria-live="polite"></p>'
    // The readout above the pad, where the docked keyboard never covers it (S3), its lines
    // reserved (3 on a phone, 2 from sm, 1 from lg) so that a longer reading never moves the
    // pad under the finger.
    + '<p data-osc="synth.xy.readout" class="mt-2 min-h-[3.75rem] font-mono text-sm '
    + 'text-gray-700 sm:min-h-[2.5rem] lg:min-h-[1.25rem] dark:text-gray-300"></p>'
    + '<div class="mt-2" data-osc="synth.xy.pad"></div>';
  const spec = target.wire(host.querySelector('[data-xy-controls]'));
  const box = host.querySelector('[data-osc="synth.xy.pad"]');
  if (spec && box) {
    const { steps, deg, sent, from, scale, target: to, cabled, params: p, reading } = spec;
    // K220: Y is the touch's velocity always, and with a cable also what it drives.
    const yDoes = cabled ? `Y řídí ${to} a sílu úhozu` : `Y je ${VELOCITY_NAME}`;
    /** A cell's note as the pad names it: the note heard, else "sends D3" (xySounding). */
    const noteText = (d) => (d.sends ? `sends ${d.name}` : d.name);
    /**
     * What Y's target plays at y, in the target knob's text; '' when Y drives nothing. `why`:
     * 'line' names the bound a held value stays under and its rate, 'aria' as the Inspector
     * writes it (limitBoundText), 'ring' only "held", 'end' the value alone.
     */
    const yValue = (y, why = 'ring') => {
      const r = reading();
      if (!r) return '';
      const v = r.at(y);
      const text = knobModel(r.param).text(v);
      const past = v > r.param.max || v < r.param.min ? 'mimo rozsah' : '';
      const held = r.limited && r.cap && why !== 'end';
      const nyq = held && r.cap.bound === 'nyquist';
      const before = nyq && r.provisional ? ' do spuštění zvuku' : '';
      if (why === 'aria') {
        return `${text}${past ? ` (${past})` : ''}${held ? `, drženo nejvýš na ${limitBoundText({
          cap: r.cap.value, bound: r.cap.bound, sampleRate: r.sampleRate })}${before
          ? `,${before}` : ''}` : ''}`;
      }
      const rate = `${Number((r.sampleRate / 1000).toFixed(3))} kHz`;
      const how = !held ? '' : why === 'ring' ? 'drženo' : nyq
        ? `drženo ≤ ${SAFE_NYQUIST_FACTOR_TEXT} × Nyquist při ${rate}${before}`
        : 'drženo ≤ horní mez rozsahu';
      const notes = [past, how].filter(Boolean).join(', ');
      return notes ? `${text} (${notes})` : text;
    };
    const others = () => {
      const r = reading();
      if (!r || !r.others) return '';
      const n = r.others;
      return `, a do něj vede ještě ${n} ${n === 1 ? 'kabel' : n < 5 ? 'kabely' : 'kabelů'}`;
    };
    const ends = reading() ? () => [yValue(0, 'end'), yValue(1, 'end')] : null;
    host.querySelector('[data-xy-default]').textContent = spec.stated;
    const first = host.querySelector('[data-xy-first]');
    first.textContent = XY_TEXT.first;
    /** The line under the pad: a refusal or the cold first touch, until a touch plays. */
    const line = (text, mark) => {
      first.textContent = text;
      first.setAttribute(mark, '');
    };
    const clear = (mark) => {
      if (!first.hasAttribute(mark)) return false;
      first.removeAttribute(mark);
      first.textContent = XY_TEXT.first;
      return true;
    };
    const out = host.querySelector('[data-osc="synth.xy.readout"]');
    /**
     * The readout above the pad says what sounds (K183 review N2, N4; S3): the cursor's note (the
     * note heard, or "sends D3"), Y as the node plays it (its rest, 0, without a touch; where the
     * cursor is, the next touch starts) with what its target plays there (yValue), whether the
     * gate is open, and a Y the target's range holds below its depth.
     */
    const show = (v, r = null) => {
      const d = deg(v.x);
      const on = (r && r.held) || gated();
      const pct = (y) => Math.round(y * 100);
      const room = typeof target.room === 'function' ? target.room() : null;
      const yv = yValue(on ? v.y : 0, 'line');
      out.textContent = `${noteText(d)} · degree ${d.degree} of ${scale} · Y ${on ? pct(v.y) : 0}`
        + ` % → ${to}${yv ? ` ${yv}` : ''}${on ? ' · gate open' : v.y > 0
          ? ` · další dotek začne z Y ${pct(v.y)} %` : ''}${room ? ` · ${room.text}` : ''}`;
    };
    // The pad's node hears X and Y only from a touch on (K183 review F1): until the first
    // onGate(true), and between touches, the cursor moves the readout alone, so Y stays at 0
    // (the node's rest) and the Y cable adds nothing to its target before a touch.
    const live = (kind, v) => {
      const r = target.live(kind, v.x, v.y);
      show(v, r);
      return r;
    };
    const gated = () => held !== null || !!(view && view.model && view.model.gated);
    const press = (v) => { // the note under X, through the keys' note layer
      if (!input) return;
      held = sent(v.x).note;
      input.noteOn(held, xyVelocity(v.y), XY_SOURCE); // Y is the touch's velocity (K220)
    };
    const lift = () => {
      if (held === null) return;
      const n = held;
      held = null;
      if (input) input.noteOff(n, XY_SOURCE);
    };
    // The cold first touch: once the context runs, a note still held is played again.
    const audio = () => (app && typeof app.audioState === 'string' ? app.audioState : 'running');
    offs.push(onApp(app, 'audioState', (now) => {
      if (now !== 'running' || !clear('data-xy-cold')) return;
      if (view && view.model.gated && held !== null && input) {
        input.noteOn(held, xyVelocity(view.model.value.y), XY_SOURCE);
        live('on', view.model.value);
      }
    }));
    /** A touch opens the gate: arm on the first, then the note under X and the pad's X, Y. */
    const open1 = (v) => {
      const t = tp();
      // The first touch arms the instrument, as the first key does (synth/ui.js synthArm).
      if (!(t && t.playing)) {
        const a = armed();
        if (!a.ok) {
          if (!a.said) say(a.reason, true);
          line(a.reason, 'data-xy-refused');
          view.model.end('refused'); // the touch holds nothing: the gate closes again
          return;
        }
      }
      clear('data-xy-refused');
      listenStop(); // the transport may exist only from this touch on
      press(v);
      live('on', v);
      if (audio() !== 'running') line(XY_TEXT.cold, 'data-xy-cold');
    };
    const was = CURSORS.get(store);
    // Y at its rest, 0, as the node is until a touch (F1, N2); X where the cursor was.
    let pos = was && was.x < steps ? { ...was, y: 0 } : { x: Math.floor(steps / 2), y: 0 };
    const keep = (v) => {
      pos = v;
      CURSORS.set(store, v);
    };
    view = mountPad(box, {
      label: `XY pad: noty ve stupnici ${scale}, ${yDoes}`,
      description: `X je nota: ${steps} kroků stupnice ${scale}, ${p.span} oct od `
        + `${from}, nízké vlevo, hraje se jako klávesy. ${yDoes}, nízké dole. `
        + 'Šipky posouvají kurzor; podržte Enter nebo se dotkněte a nota zazní; Escape '
        + 'ji uvolní.',
      describedBy: [`${uid}-first`],
      // Each cell's note, as the runtime quantises its x: the full name where the row has room,
      // else on the roots (the key at each octave) and the note letter between them.
      cells: Array.from({ length: steps }, (_, i) => {
        const d = deg(i);
        const root = d.degree === 1;
        return { label: steps <= 15 || root ? d.name : NOTE_NAMES[((d.note % 12) + 12) % 12],
          root };
      }),
      disabled: null,
      x: { key: 'x', label: 'Note', type: 'integer', min: 0, max: steps - 1, step: 1,
        default: Math.floor(steps / 2) },
      // The kind names the axis itself ("Y: …", review R2-K220-3): the label is its target.
      y: { key: 'y', label: to, type: 'number', min: 0, max: 1, default: 0 },
      value: pos,
      text: { x: (i) => `${noteText(deg(i))}, degree ${deg(i).degree}`,
        y: (v) => {
          const yv = yValue(v, 'aria');
          if (!cabled) return `${Math.round(v * 100)} %: ${VELOCITY_NAME} ${xyVelocity(v)}`;
          return `${Math.round(v * 100)} % to ${to}${yv ? `: ${yv}${others()}` : ''}`;
        } },
      readout: { x: (i) => noteText(deg(i)), y: (v) => (yValue(v) ? `${to} ${yValue(v)}` : null),
        yEnds: ends },
      onPreview(v) {
        keep(v);
        const n = sent(v.x).note;
        if (held !== null && n !== held && input) { // another scale cell: legato, no new gate
          input.legato(held, n, XY_SOURCE);
          held = n;
        }
        if (gated()) live('move', v); else show(v); // no gate: the cursor alone moves
      },
      onGate(open, v, reason) {
        keep(v);
        if (open) {
          opening = true;
          try { open1(v); } finally { opening = false; }
          return;
        }
        lift();
        live('off', v);
        if (reason !== 'release') target.release(reason);
        // Every release puts Y back at its rest (live-notes.js, K183 review N2): the cursor and
        // the readout show what sounds, Y at 0; the next touch starts where it lands.
        const rest = { ...v, y: 0 };
        keep(rest);
        if (view && typeof view.model.place === 'function') view.model.place(rest);
        show(rest);
      },
    });
    show(pos); // the cursor shown; the node hears nothing before the first touch
    owns = 'xy-pad'; // mounted and playable: enabled from the first touch (K183)
  }
  const win = host.ownerDocument && host.ownerDocument.defaultView;
  // The pad owns the notes only while it is shown (K171 R7): a box on screen, not a face hidden
  // below xl (`max-xl:hidden`) or a closed tab; its ResizeObserver follows it shown and hidden.
  // Pad R under the Panel face (K220) plays beside the docked keyboard: it claims nothing.
  const surface = owns && claim ? box.querySelector('[data-xy-surface]') || box : null;
  let claimed = false;
  const shown = () => typeof surface.getBoundingClientRect !== 'function'
    || hasBox(surface.getBoundingClientRect());
  const sync = () => {
    if (destroyed || !surface || shown() === claimed) return;
    claimed = !claimed;
    claimNotes(win, claimed ? { id: uid, owner: owns, home: HOME[owner] || owner, el: surface }
      : { id: uid, owner: null });
  };
  if (surface) {
    sync();
    if (win && typeof win.ResizeObserver === 'function') {
      const ro = new win.ResizeObserver(sync);
      ro.observe(surface);
      offs.push(() => ro.disconnect());
    }
  }

  return {
    get view() { return view; },
    get notes() { return claimed ? owns : null; },
    owner,
    release,
    destroy() {
      if (destroyed) return;
      if (view) view.destroy(); // the kind ends a held gate ('hide'): onGate releases it
      else target.release('destroy');
      destroyed = true;
      view = null;
      paths.off();
      while (offs.length) offs.pop()();
      if (input && typeof input.off === 'function') input.off();
      target.unwire();
      if (claimed) claimNotes(win, { id: uid, owner: null });
      claimed = false;
    },
  };
}

// ---------------------------------------------------------------- pad L (K220)

export const PADS_TEXT = Object.freeze({
  title: 'PADY',
  intro: 'Pad L ladí dolní propust, pad R hraje noty stupnice; puštěním se oba vrátí do '
    + 'klidu.',
  none: 'nic',
  axes: (x, y) => `X ladí ${x}, Y ladí ${y}.`,
  missing: (label) => `Tento dokument Studia nemá ${label}.`,
  restore: (label) => `Přidat ${label}`,
  scale: (key, mode) => `Pad R hraje stupnici ${key} ${mode}.`,
  choose: 'Zobrazený pad',
});

let padMounts = 0;
const PAD_LABEL = 'text-sm text-gray-700 dark:text-gray-300';
const RECORD_BUTTON = 'inline-flex h-11 items-center gap-1 rounded-lg border border-solid '
  + 'border-gray-300 bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-100 '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 '
  + 'aria-checked:border-red-600 aria-checked:text-red-700 dark:border-gray-600 dark:bg-gray-800 '
  + 'dark:text-white dark:hover:bg-gray-700';

export function padTargets(model, panel, module = 'xyl') {
  const res = panel.resolve(model);
  const node = res.get(module);
  const out = { x: [], y: [] };
  if (!node) return out;
  const byNode = new Map([...res].filter(([, n]) => n).map(([mid, n]) => [n.id, mid]));
  for (const e of model.graph.edges) {
    if (e.from.node !== node.id || !(e.from.port in out) || (e.props && e.props.muted)) continue;
    out[e.from.port].push(`${byNode.get(e.to.node) || e.to.node}.${e.to.port}`);
  }
  return out;
}

/** arm()'s answer as { ok, reason, said } (xy-wiring.js reads its own the same way). */
function armedOf(arm) {
  const r = arm();
  if (r === true || (r && r.ok === true)) return { ok: true };
  return { ok: false, reason: (typeof r === 'string' && r) || (r && r.reason) || '',
    said: !!(r && r.said) };
}

export function mountPadL(host, { store, transport = null, panel, app = null, arm = null,
  say = () => {}, jackName = (id) => String(id), mountPad = mountXyPad, owner = 'synth' } = {}) {
  const tp = () => (typeof transport === 'function' ? transport() : transport);
  const node = () => panel.resolve(store.getModel()).get('xyl');
  const uid = `synth-pad-l-${(padMounts += 1)}`;
  let view = null;
  let destroyed = false;
  let gated = false;
  const live = (kind, v) => {
    const t = tp();
    const n = node();
    return t && t.playing && n ? t.live(n.id, { kind, x: v.x, y: v.y }) : null;
  };
  function release(reason) {
    if (destroyed) return 0;
    if (view && view.model.gated) {
      view.model.end(reason); // onGate(false): X and Y back at rest
      return 1;
    }
    live('all-off', { x: 0, y: 0 });
    return 0;
  }
  const paths = padReleasePaths({ transport: tp, app, owner, output: 'studio', release });
  const t = padTargets(store.getModel(), panel);
  const name = (list) => (list.length ? list.map(jackName).join(' + ') : PADS_TEXT.none);
  const nx = name(t.x);
  const ny = name(t.y);
  host.innerHTML = `<p class="${PAD_LABEL}" data-pad-axes="">${esc(PADS_TEXT.axes(nx, ny))}</p>`
    + `<p id="${uid}-line" class="mt-1 text-sm font-semibold text-gray-900 dark:text-white" `
    + 'data-pad-line="" aria-live="polite"></p>'
    + '<div class="mt-2" data-osc="synth.pads.l.pad"></div>'
    + '<div class="mt-2 flex items-center gap-2" data-pad-record="">'
    + `${recordSwitchHtml(RECORD_BUTTON)}</div>`;
  const line = host.querySelector('[data-pad-line]');
  const pct = (v) => Math.round(v * 100);
  view = mountPad(host.querySelector('[data-osc="synth.pads.l.pad"]'), {
    label: `Pad L: X ladí ${nx}, Y ladí ${ny}`,
    description: `X ladí ${nx}, nízké vlevo; Y ladí ${ny}, nízké dole. Šipky posouvají kurzor; `
      + 'podržte Enter nebo se dotkněte a pad ladí; puštěním se X i Y vrátí do klidu.',
    describedBy: [`${uid}-line`],
    disabled: null,
    x: { key: 'x', label: nx, type: 'number', min: 0, max: 1, default: 0 },
    y: { key: 'y', label: ny, type: 'number', min: 0, max: 1, default: 0 },
    value: { x: 0, y: 0 },
    text: { x: (v) => `${pct(v)} %: ${nx}`, y: (v) => `${pct(v)} %: ${ny}` },
    readout: { x: (v) => `X ${pct(v)} %`, y: (v) => `Y ${pct(v)} %` },
    onPreview(v) {
      if (gated) live('move', v);
    },
    onGate(open, v) {
      if (open) {
        const a = armedOf(arm || (() => !!tp() && (tp().playing || tp().arm().ok)));
        if (!a.ok) { // a refused touch is never silent (project.no-silent-feedback)
          if (a.reason && !a.said) say(a.reason, true);
          line.textContent = a.reason;
          view.model.end('refused');
          return;
        }
        line.textContent = '';
        paths.listenStop(); // the transport may exist only from this touch on
        gated = true;
        live('on', v);
        return;
      }
      if (!gated) return;
      gated = false;
      live('off', v); // live-notes.js rests X and Y (handle.rest)
      if (view && typeof view.model.place === 'function') view.model.place({ x: 0, y: 0 });
    },
  });
  const record = bindRecordSwitch(host.querySelector('[data-pad-record] [data-notes-record]'), {
    transport: tp, store, say, text: PAD_RECORD_TEXT,
    clipId: () => {
      const n = node();
      return n ? padTakeId(n.id) : null;
    },
  });
  return {
    get view() { return view; },
    record,
    release,
    destroy() {
      if (destroyed) return;
      if (view) view.destroy(); // the kind ends a held gate ('hide'): onGate releases it
      destroyed = true;
      view = null;
      record.destroy();
      paths.off();
    },
  };
}
