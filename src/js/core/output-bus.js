// The playback bus (plan issues C002, C036, C037; docs/v31/compiler.md, "exclusive"): one
// output owner at a time, and one claim API every player starts through.
//
// Every player calls claim(owner, reason) once before it sounds and release(owner) when it
// ends (C037): the instrument and the riff audition through the engine.play guard (main.js,
// audio/lab-play-options.js), the sequencer editor through its engine.claimOutput, the Studio
// transport (PLAY, the Synth arm) through its onClaimOutput, the keyboard and MIDI notes
// through the note layer's claim (midi/notes.js). A guarded module (audio/, studio/,
// sequencer/) never imports this file: the claim is injected through the options it takes.
//
// OUTPUT_OWNER_TABLE below is the one table of who may own the shared output, in precedence
// order: what refuses every claim (a measurement, a microphone level-reference capture), what
// yields to whom when an owner takes it, what refuses the keyboard and MIDI notes and with
// which sentence, and how the views name the owner. Every other site imports a projection of
// it (C036): OUTPUT_REFUSALS and OUTPUT_YIELDS here (ui/output-owner.js re-exports them), the views' owners and names
// (visualization/output-owner.js), the notes' refusals (midi/ui.js, midi/keyboard-ui.js), the
// Space owners (ui/shortcuts.js), the instrument's "another owner's voice" check
// (core/instrument.js) and the riff audition's owner mark (studio/riffs/audition.js).
// tests/unit/output-owner-one-table.test.mjs refuses a second table anywhere in src/js, and
// tests/unit/output-claims.test.mjs a start of sound outside a claim.
//
// A measurement, and a microphone level-reference capture, is never displaced: while one holds
// the output every other claim is refused with its notice. Any other claim takes the output in
// the action itself, from the live state of each owner, never from the 150 ms app.seqPlaying
// copy the views read. The Synth workspace is no owner of its own: its panel sounds through the
// Studio transport (studio) and its keys and XY pad are notes.
//
// No Web Audio here: the owners stop through their own click-free paths (editor.stop(),
// cmp.stopNow(), cmp.studioStop(), cmp.midiAllOff()), so the AudioEngine stays the one
// authority over nodes. No imports either: every layer may read this table and inject the bus.

export const OUTPUT_REFUSAL = 'Výstup patří měření: před přehráváním ho zastavte (Esc).';
export const REFERENCE_REFUSAL = 'Výstup zůstává tichý, dokud se z mikrofonu snímá referenční '
  + 'úroveň: před přehráváním snímání zastavte.';

/**
 * The one table, in precedence order. A row:
 *   owner     the owner's id
 *   refuses   'all' (every claim and every note is refused while it holds the output) or
 *             'notes' (only the keyboard and MIDI notes are; the other claims take it over)
 *   probe     the component's method that says it holds the output now (the sequencer's is
 *             the editor's own flag, read through createOutputOwner and the MIDI part)
 *   title, text   the notice of a refused claim ('all' rows)
 *   notes     { midi, keyboard }: the sentence a refused note says, per player
 *   yields    who stops when this owner claims the output
 *   forced    the yields stop without asking whether they sound (the notes are released even
 *             where no key is lit: an XY pad's note, a note routed to the Synth)
 *   view      the name the views give it (the scope label, the canvas description, the status
 *             bar); rows without one are never named as the output owner
 * Precedence: the refusing rows first (the measurement, then the reference), then the views'
 * order: the instrument, the sequencer, the Studio, the held notes (refused while the
 * sequencer or the Studio owns the output; a note and an instrument voice never sound
 * together, ADR 0002). The audition plays through the instrument's path under its own name.
 * The measurement row's yields are the claim of MEASURE (stopPlayback).
 */
export const OUTPUT_OWNER_TABLE = Object.freeze([
  Object.freeze({ owner: 'measurement', refuses: 'all', probe: 'measureOwnsOutput',
    title: 'Measurement in progress', text: OUTPUT_REFUSAL,
    notes: Object.freeze({
      midi: 'MIDI noty nehrají, dokud výstup patří měření: nejdřív ho zastavte (Esc).',
      keyboard: 'Noty z klávesnice nehrají, dokud výstup patří měření: nejdřív ho zastavte '
        + '(Esc).' }),
    yields: Object.freeze(['sequencer', 'instrument', 'studio', 'notes']), forced: true }),
  // Only a microphone capture (session.js measureReferenceOwnsOutput): the loopback TEST
  // CONTEXT reference is the instrument's own output, so there nothing is refused.
  Object.freeze({ owner: 'reference', refuses: 'all', probe: 'measureReferenceOwnsOutput',
    title: 'Level reference capture', text: REFERENCE_REFUSAL,
    notes: Object.freeze({
      midi: 'MIDI noty nehrají, dokud se z mikrofonu snímá referenční úroveň.',
      keyboard: 'Noty z klávesnice nehrají, dokud se z mikrofonu snímá referenční úroveň.' }),
    yields: Object.freeze([]) }),
  // A playing Studio stops on its own watch of app.playing (ui/studio/workspace.js).
  Object.freeze({ owner: 'instrument', view: 'instrument',
    yields: Object.freeze(['sequencer', 'notes']) }),
  // The riff audition (studio/riffs/audition.js) plays through the instrument's engine.play path
  // under its own name; its one claim (the engine.play guard) stops every other owner (C037:
  // before, it stopped them itself and claimed again, three claims for one Listen).
  Object.freeze({ owner: 'audition',
    yields: Object.freeze(['sequencer', 'instrument', 'studio', 'notes']), forced: true }),
  // The sequencer's start releases the notes itself (main.js playAfterMidi, before its first
  // claim): its claim repeats before every loop pass (C002), where releasing a note routed to
  // the Synth or the Studio would cut it, so 'notes' is not among its yields.
  Object.freeze({ owner: 'sequencer', view: 'sequencer', refuses: 'notes',
    notes: Object.freeze({
      midi: 'MIDI noty nehrají, dokud hraje sekvencer: nejdřív ho zastavte (Esc).',
      keyboard: 'Noty z klávesnice nehrají, dokud hraje sekvencer: nejdřív ho zastavte (Esc).' }),
    yields: Object.freeze(['instrument', 'studio']) }),
  // Studio PLAY and the Synth arm (the transport's onClaimOutput): every other owner stops and
  // every note is released; the Studio itself is not playing while it claims.
  Object.freeze({ owner: 'studio', view: 'Studio', refuses: 'notes', probe: 'studioOwnsOutput',
    notes: Object.freeze({
      midi: 'MIDI noty nehrají, dokud hraje Studio: nejdřív ho zastavte.',
      keyboard: 'Noty z klávesnice nehrají, dokud hraje Studio: nejdřív ho zastavte.' }),
    yields: Object.freeze(['sequencer', 'instrument', 'notes']), forced: true }),
  Object.freeze({ owner: 'notes', view: 'noty', yields: Object.freeze([]) }),
]);

/**
 * What leaving a workspace does to each owner (C053): one table, applied by the bus on every
 * workspace change (bus.leave, main.js's one watcher) in the same event. A row:
 *   owner     who it concerns (the table's owners, the Synth's Arm, the lab microphone of C040)
 *   effect    'keep' (it sounds on), 'stop' or 'disarm'
 *   applies(from, to)   whether this change concerns it
 *   sounding(cmp, bus)  whether it sounds (or is armed) now
 *   act(cmp, from, to)  what the bus does (none for 'keep')
 *   sentence  what the status bar says when the row met a sounding owner
 * The rows keep what the app did before C053, now stated: a measurement does not run unseen
 * (it stops whenever the workspace is not MEASURE), held keys are released, an armed-only Synth
 * run is disarmed, the instrument, the sequence and a PLAYed Studio run sound on (Esc stops
 * them), and the lab microphone stays on until C040 decides otherwise.
 */
export const LEAVE_POLICY = Object.freeze([
  Object.freeze({ owner: 'measurement', effect: 'stop', applies: (from, to) => to !== 'measure',
    sounding: (cmp) => call(cmp, 'measureOwnsOutput'),
    act: (cmp) => call(cmp, 'measureAbort', 'workspace'),
    sentence: 'Měření se zastavilo: neběží na jiné stránce.' }),
  Object.freeze({ owner: 'reference', effect: 'stop', applies: (from, to) => to !== 'measure',
    sounding: (cmp) => call(cmp, 'measureReferenceOwnsOutput'),
    act: (cmp) => call(cmp, 'measureAbort', 'workspace'),
    sentence: 'Snímání referenční úrovně se zastavilo.' }),
  Object.freeze({ owner: 'instrument', effect: 'keep', applies: () => true,
    sounding: (cmp) => !!cmp.playing, act: null,
    sentence: 'Tón hraje dál; zastavíte ho klávesou Esc.' }),
  Object.freeze({ owner: 'audition', effect: 'keep', applies: () => true,
    sounding: (cmp, bus) => bus.owner() === 'audition', act: null,
    sentence: 'Ukázka riffu dohraje.' }),
  Object.freeze({ owner: 'sequencer', effect: 'keep', applies: () => true,
    sounding: (cmp, bus) => bus.sequencerPlaying(), act: null,
    sentence: 'Sekvence hraje dál; zastavíte ji klávesou Esc.' }),
  // Leaving the Studio: its live notes off and an armed-only run disarmed (the key route's own
  // leave, midi/routes.js KEY_ROUTES, run by midi/ui.js midiRouteLeave; studio-sink.js, K176);
  // a run the user started with PLAY sounds on.
  Object.freeze({ owner: 'studio', effect: 'disarm', applies: (from) => from === 'studio',
    sounding: (cmp) => call(cmp, 'studioOwnsOutput'),
    act: (cmp, from) => call(cmp, 'midiRouteLeave', from),
    sentence: 'Studio: zapnuté klávesy se vypnuly; přehrávání spuštěné tlačítkem hraje dál.' }),
  Object.freeze({ owner: 'synth', effect: 'disarm', applies: (from) => from === 'synth',
    sounding: (cmp) => !!(cmp.synth && cmp.synth.armed),
    act: (cmp) => call(cmp, 'synthLeave'),
    sentence: 'Syntezátor se vypnul: jeho klávesy po odchodu nehrají.' }),
  Object.freeze({ owner: 'notes', effect: 'stop', applies: () => true,
    sounding: (cmp) => !!cmp.notesSounding,
    act: (cmp) => call(cmp, 'kbdReleaseAll'),
    sentence: 'Držené noty se uvolnily.' }),
  Object.freeze({ owner: 'lab-microphone', effect: 'keep', applies: () => true,
    sounding: (cmp) => !!cmp.micActive, act: null,
    sentence: 'Mikrofon laboratoře zůstává zapnutý.' }),
]);

/** cmp[name](...args) when it is a function, else undefined. */
function call(cmp, name, ...args) {
  return cmp && typeof cmp[name] === 'function' ? cmp[name](...args) : undefined;
}

/** The owner ids as constants (OWNER.instrument === 'instrument'), for the sites that name one. */
export const OWNER = Object.freeze(Object.fromEntries(OUTPUT_OWNER_TABLE
  .map((r) => [r.owner, r.owner])));

/** The table's row of `owner`, or null. */
export function ownerRow(owner) {
  return OUTPUT_OWNER_TABLE.find((r) => r.owner === owner) || null;
}

/** The owners the views name, in precedence order, and how they name each. */
export const VIEW_OWNER_ROWS = Object.freeze(OUTPUT_OWNER_TABLE.filter((r) => r.view));

/**
 * Who refuses every claim, in order: a measurement, then a microphone level-reference capture
 * (session.js; the capture stopped the other owners when it started, and the reading must not
 * hear one start). Each row names the component's probe and the notice it raises.
 */
export const OUTPUT_REFUSALS = Object.freeze(OUTPUT_OWNER_TABLE
  .filter((r) => r.refuses === 'all'));

/** The refusal row that holds the output now, or null (pure: it reads the probes only). */
export function outputRefusalOf(cmp) {
  if (!cmp) return null;
  return OUTPUT_REFUSALS.find((r) => typeof cmp[r.probe] === 'function' && cmp[r.probe]())
    || null;
}

/**
 * Who refuses a keyboard or MIDI note now: the row's owner id, or null. The rows that refuse
 * notes, in table order; `sequencerPlaying()` is the sequencer editor's own flag (the
 * component has no probe for it).
 */
export function notesRefusalOf(cmp, { sequencerPlaying = () => false } = {}) {
  if (!cmp) return null;
  const holds = (r) => (r.owner === OWNER.sequencer ? !!sequencerPlaying()
    : typeof cmp[r.probe] === 'function' && !!cmp[r.probe]());
  const row = OUTPUT_OWNER_TABLE.find((r) => r.notes && holds(r));
  return row ? row.owner : null;
}

/** The sentences a refused note says, per player ('midi' | 'keyboard'), keyed by owner id. */
export function notesRefusedSentences(player) {
  return Object.freeze(Object.fromEntries(OUTPUT_OWNER_TABLE.filter((r) => r.notes)
    .map((r) => [r.owner, r.notes[player]])));
}

/**
 * Who yields the output when an owner takes it (`measure`: the measurement row's claim, made by
 * MEASURE and Studio PLAY through stopPlayback).
 */
export const OUTPUT_YIELDS = Object.freeze(Object.fromEntries(OUTPUT_OWNER_TABLE
  .filter((r) => r.yields.length)
  .map((r) => [r.owner === OWNER.measurement ? 'measure' : r.owner, r.yields])));

/**
 * The playback bus of one page.
 * options: { app() → the reactive component or null, sequencer() → the sequencer editor or
 *            null, changed() → called (in a microtask) after the playing state changed,
 *            claimed(owner, reason) → told of every granted claim (optional), trace → the one
 *            operation trace (core/trace.js) every bus event is recorded in (optional),
 *            engine → the live AudioEngine whose master level the bus alone writes (C052) }
 * → { claim(owner, reason), holds(owner), release(owner), owner(), stopAll(reason),
 *      onStop(fn), playback(), subscribe(fn), note(on, { note, input }), armed(owner, on),
 *      setMaster(level, { owner, at }), claimOutput(owner),
 *      stopPlayback(cmp, cause), outputBusy(cmp), sequencerPlaying(), stopSequence(cmp) }
 */
/**
 * The owner whose sound reaches the master chain now (C069), the one source of what the views
 * say sounds: a running measurement (its row's probe; it never claims, it refuses every claim),
 * else the owner the bus published (cmp.playback, C051: the instrument, the sequencer, the
 * Studio, the notes, the audition), else null. A microphone level-reference capture keeps the
 * output silent, so it is no sounding owner. The output-ceiling indicator reads it.
 */
export function soundingOwner(cmp) {
  if (!cmp) return null;
  const probe = ownerRow(OWNER.measurement).probe;
  if (typeof cmp[probe] === 'function' && cmp[probe]()) return OWNER.measurement;
  return (cmp.playback && cmp.playback.owner) || null;
}

export function createOutputBus({ app, sequencer, changed = () => {}, claimed = () => {},
  trace = null, engine = null }) {
  // Every bus event is a step of the one operation trace (C050, core/trace.js, ADR 0042),
  // recorded here and never by a player: owner 'bus', the owner it concerns as the entity.
  const step = (kind, owner, f = {}) => (trace && typeof trace.record === 'function'
    ? trace.record('bus', kind, { ...f, entity: owner ? { kind: 'owner', id: owner } : null })
    : null);
  /** The owner holding the output changed from `from` to `to` (null: nobody). */
  // The one observable playing state (C051): { owner, since }, published on the component as
  // `playback` in the same event as the claim, release or stop that changed it; every mirror
  // (seqPlaying, isSounding, anySounding, outputOwner, the status bar) is a read of it.
  let since = 0;
  const watchers = new Set();
  const publish = (owner) => {
    const state = Object.freeze({ owner: owner || null, since: ++since });
    const cmp = app();
    if (cmp) cmp.playback = state;
    for (const fn of [...watchers]) fn(state);
    later(changed);
  };
  const moved = (from, to) => {
    if (from === to) return;
    step('owner', to || 'none', { detail: { from: from || 'none' } });
    publish(to);
  };
  const later = (fn) => (typeof queueMicrotask === 'function' ? queueMicrotask(fn)
    : Promise.resolve().then(fn));
  /** The sequencer's own transport state. */
  const sequencerPlaying = () => {
    const ed = sequencer();
    return !!(ed && ed.playing);
  };

  /** Stop a playing sequence (click-free fade); the sequencer releases the output at once. */
  function stopSequence() {
    if (!sequencerPlaying()) return false;
    sequencer().stop();
    release(OWNER.sequencer); // also where the editor's own onStopped is not wired
    return true;
  }

  // How each owner a claim stops is read and stopped (C002, C016), for the owners the table's
  // yields name: what yields when an owner takes the output and what the setup check of a
  // measurement reports as other audio read the same rows. The sequencer is read live
  // (editor.playing), never through the 150 ms app.seqPlaying copy; its voices and the Studio's
  // never enter the engine's audibleVoiceCount. A claim releases the notes while a key is lit
  // (C024: an instrument voice also fades their voices, ADR 0002); a `forced` row releases them
  // always: an XY pad's note lights no key, and the release is idempotent (V502).
  const STOPS = {
    [OWNER.sequencer]: { busy: () => sequencerPlaying(), stop: (cmp) => stopSequence(cmp) },
    [OWNER.instrument]: { busy: (cmp) => !!cmp.playing, stop: (cmp) => cmp.stopNow() },
    [OWNER.studio]: {
      busy: (cmp) => typeof cmp.studioOwnsOutput === 'function' && !!cmp.studioOwnsOutput(),
      stop: (cmp, { fast = false } = {}) => (fast ? cmp.studioStop({ fast: true })
        : cmp.studioStop()),
    },
    [OWNER.notes]: { forced: true, busy: (cmp) => !!cmp.notesSounding,
      stop: (cmp) => { if (typeof cmp.midiAllOff === 'function') cmp.midiAllOff(); } },
    // The audition sounds on the instrument's path: its voice is the engine's play() voice.
    [OWNER.audition]: { busy: (cmp) => !!cmp.playing, stop: (cmp) => cmp.stopNow() },
  };

  function yieldOutput(cmp, owners, force = false) {
    for (const owner of owners) {
      const s = STOPS[owner];
      if ((force && s.forced) || s.busy(cmp)) s.stop(cmp);
    }
  }

  /**
   * True while any owner that stopPlayback stops sounds (MEASURE's setup check reports it as
   * other audio, C016); it stops and claims nothing.
   */
  function outputBusy(cmp) {
    return OUTPUT_YIELDS.measure.some((owner) => STOPS[owner].busy(cmp));
  }

  /** The row that refuses `owner` now, or null: the notes also yield to the sequencer and Studio. */
  function refusalFor(cmp, owner) {
    if (owner !== OWNER.notes) return outputRefusalOf(cmp);
    const by = notesRefusalOf(cmp, { sequencerPlaying });
    return by ? ownerRow(by) : null;
  }

  let current = null; // { owner, reason } of the granted claim that still holds the output

  /** A claimable row of the table, or a programming error. */
  function claimable(owner) {
    const row = ownerRow(owner);
    if (!row || row.refuses === 'all') throw new Error(`claim: unknown owner ${owner}`);
    return row;
  }

  /**
   * `owner` takes the output before it sounds (`reason`: what started it, for the trace):
   * { ok: true }, or { ok: false, by, text } when a row of the table refuses it (`by` the
   * refusing owner; `text` its notice, said here once for every owner but the notes, whose
   * player says its own sentence once per run of refused notes). A granted claim stops what
   * the owner's row yields, from the live state of each owner. `notify: false` leaves the
   * notice to the caller (Studio PLAY announces it on its own live region).
   */
  function claim(owner, reason = '', { notify = true } = {}) {
    const row = claimable(owner);
    const cmp = app();
    if (cmp) {
      const refusal = refusalFor(cmp, owner);
      if (refusal) {
        const text = refusal.text || null;
        if (notify && owner !== OWNER.notes && text) cmp.notify('info', refusal.title, text);
        step('claim', owner, { outcome: 'refused', detail: { reason: String(reason || ''),
          by: refusal.owner } });
        return Object.freeze({ ok: false, by: refusal.owner, text });
      }
      yieldOutput(cmp, row.yields, !!row.forced);
    }
    const from = current ? current.owner : null;
    current = { owner, reason: String(reason || '') };
    step('claim', owner, { outcome: 'granted', detail: { reason: current.reason } });
    moved(from, owner);
    claimed(owner, current.reason);
    return GRANTED;
  }

  /**
   * Whether `owner` may go on sounding (a loop's next pass, C002): true, or the refusal's text.
   * It stops nothing: the owner claimed when it started.
   */
  function holds(owner) {
    claimable(owner);
    const cmp = app();
    const refusal = cmp ? refusalFor(cmp, owner) : null;
    return refusal ? (refusal.text || refusal.owner) : true;
  }

  const onStops = new Set(); // what a player does itself when everything stops (C050)

  /** fn(reason) is called first by every stopAll (a player's own stop reaction) -> off(). */
  function onStop(fn) {
    onStops.add(fn);
    return () => onStops.delete(fn);
  }

  /**
   * Everything stops, in this event (C050): Escape ('escape'), the status-bar stop
   * ('status-stop') and a page hide ('pagehide', 'hidden') call it and nothing else. The
   * players' own reactions first (onStop), then every owner from its live state: the sequence,
   * the instrument's voice (a riff audition's too: the same play() voice), the Studio (fast
   * but for the status-bar stop), every note (forced: a pad's note lights no key) and a
   * measurement (measureAbort with the reason). Nothing holds the output afterwards.
   */
  function stopAll(reason = 'stop') {
    const cmp = app();
    let failure = null;
    const guard = (fn) => {
      try { fn(); } catch (e) { failure = failure || e; } // the other owners still stop
    };
    for (const fn of [...onStops]) guard(() => fn(reason));
    if (cmp) {
      const fast = reason !== 'status-stop';
      for (const owner of [OWNER.sequencer, OWNER.instrument, OWNER.studio]) {
        const s = STOPS[owner];
        guard(() => { if (s.busy(cmp)) s.stop(cmp, { fast }); });
      }
      guard(() => STOPS[OWNER.notes].stop(cmp));
      if (typeof cmp.measureAbort === 'function') guard(() => cmp.measureAbort(reason));
    }
    const was = current ? current.owner : null; // an owner that released itself is gone
    current = null;
    step('stopAll', null, { outcome: 'stopped', detail: { cause: String(reason) } });
    moved(was, null);
    if (failure) throw failure;
  }

  /** `owner` stopped sounding: it no longer holds the output (a no-op for any other owner). */
  function release(owner) {
    if (!current || current.owner !== owner) return;
    current = null;
    step('release', owner, { outcome: 'released' });
    moved(owner, null);
  }

  /** fn({ owner, since }) on every change of the playing state (C051) -> off(). */
  function subscribe(fn) {
    watchers.add(fn);
    return () => watchers.delete(fn);
  }

  /** The playing state now: { owner, since } (owner null: nothing holds the output). */
  function playback() {
    return Object.freeze({ owner: current ? current.owner : null, since });
  }

  /** A note started or ended (the note layer tells, C050): a step of the trace. */
  function note(on, { note: n = null, input = null } = {}) {
    step(on ? 'note-on' : 'note-off', OWNER.notes, { detail: { note: n, input } });
  }

  /** A player was armed or disarmed (the Synth's Arm, the computer keys): a step of the trace. */
  function armed(owner, on) {
    step(on ? 'arm' : 'disarm', owner);
  }

  /** The owner of the last granted claim while it still sounds, else null. */
  function owner() {
    if (!current) return null;
    const cmp = app();
    const s = STOPS[current.owner];
    if (cmp && s && !s.busy(cmp)) return null;
    return current.owner;
  }

  /**
   * The claim as C002 answered it: true, or the reason it is refused. `owner` is
   * 'instrument', 'audition', 'sequencer' or 'studio'. The reference row refuses only a
   * microphone capture (measureReferenceOwnsOutput, as calibration.js stops playback only for
   * the microphone; the loopback TEST CONTEXT reference is the instrument's own output). The
   * notes read the same row (notesRefusalOf, C036).
   */
  function claimOutput(owner) {
    if (!OUTPUT_YIELDS[owner]) throw new Error(`claimOutput: unknown owner ${owner}`);
    const r = claim(owner, 'claimOutput');
    return r.ok ? true : r.text;
  }

  /**
   * MEASURE (and the status-bar stop key) takes the output: stop the instrument and the
   * sequencer (their voices fade), a playing Studio (V3.1) and the MIDI and keyboard notes
   * (V502): the measurement row's yields, forced. It is no player's claim: nothing holds the
   * output afterwards.
   */
  function stopPlayback(cmp, cause = 'measure') {
    yieldOutput(cmp, OUTPUT_YIELDS.measure, true);
    const was = current ? current.owner : null;
    current = null;
    step('stopAll', null, { outcome: 'stopped', detail: { cause } });
    moved(was, null);
  }

  /**
   * The live engine's master level (C052): the bus is its one writer. `owner` asks for level
   * `g` (the status-bar level for the instrument and the sequencer, the Studio's Output
   * level); `at` starts the glide at that audio time (a level given back after a fade, the
   * Studio's STOP). Newest wins, as C012 shipped it: the write applies at once.
   */
  function setMaster(g, { owner: who = null, at = null } = {}) {
    step('master', who, { detail: { level: g, held: at !== null && at !== undefined } });
    writeMaster(engine, g, at);
  }

  /**
   * The user left workspace `from` for `to` (C053): every row of LEAVE_POLICY that applies acts
   * now, and the rows that met a sounding owner say their sentence in the status bar's live
   * region (cmp.announceText). -> the owners the rows met.
   */
  function leave(from, to) {
    const cmp = app();
    if (!cmp || from === to) return [];
    const met = LEAVE_POLICY.filter((r) => r.applies(from, to) && r.sounding(cmp, api));
    for (const r of LEAVE_POLICY) if (r.act && r.applies(from, to)) r.act(cmp, from, to);
    step('leave', null, { detail: { from: String(from), to: String(to),
      met: met.map((r) => `${r.owner}:${r.effect}`).join(' ') } });
    if (met.length) cmp.announceText = met.map((r) => r.sentence).join(' ');
    return met.map((r) => r.owner);
  }

  const api = { claim, holds, release, owner, playback, subscribe, stopAll, onStop, note, armed,
    setMaster, leave, sequencerPlaying, stopSequence, claimOutput, stopPlayback, outputBusy };
  if (engine && typeof engine === 'object') masterBuses.set(engine, api);
  return api;
}

// ------------------------------------------------------------ the master level (C052)

const masterBuses = new WeakMap(); // the live engine -> the bus that writes its master level

/** The one place a master level reaches an engine: a held glide when `at` is given. */
function writeMaster(engine, g, at = null) {
  if (!engine) return;
  if (at !== null && at !== undefined && typeof engine.holdMasterGain === 'function') {
    engine.holdMasterGain(g, at);
  } else if (typeof engine.setMasterGain === 'function') {
    engine.setMasterGain(g);
  }
}

/**
 * Ask for `engine`'s master level `g` (C052): through the engine's bus when main.js composed
 * one (it records and writes it), else written here (an offline render's engine, a test's).
 * Every other module asks this; none writes the engine's master level itself.
 *   opts: { owner, at } as bus.setMaster
 */
export function requestMasterLevel(engine, g, opts = {}) {
  const bus = engine && typeof engine === 'object' ? masterBuses.get(engine) : null;
  if (bus) bus.setMaster(g, opts);
  else writeMaster(engine, g, opts.at);
}

/** The answer of a granted claim. */
const GRANTED = Object.freeze({ ok: true });

/** C002's name for the bus (main.js and the tests built it as the output owner). */
export const createOutputOwner = createOutputBus;

/**
 * The owner an engine.play claims the output as (the guard in main.js): the riff audition's
 * voices carry its owner mark (AUDITION_OPTIONS.owner); every other voice is the instrument's.
 */
export function playOwnerOf(opts) {
  return opts && opts.owner === OWNER.audition ? OWNER.audition : OWNER.instrument;
}
