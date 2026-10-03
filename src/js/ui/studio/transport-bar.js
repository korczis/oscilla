// Studio transport strip (spec §93-§96, §127, §132; plan V418): RETURN, PLAY, STOP, LOOP, the
// current time, the time mode and the tempo. Built from the existing OSCILLA transport keys
// (.osc-transport-btn, the sequencer's), segmented control and number field. Every command goes
// through transport-commands.js; nothing here touches audio or holds reactive state.
//
//   mountTransportBar(host, ctx, { commands, ownFrame, keys }) -> { element, update(),
//                                                                  tick(now), destroy() }
// The timeline editor calls update() after a model change and tick() on its frame; a shell that
// mounts the strip on its own passes ownFrame: true. keys: false leaves out RETURN, PLAY, STOP,
// LOOP and the clock, for a host whose own header already carries them (the STUDIO workspace):
// one transport on screen, the time mode and tempo kept.

import { onFrame } from '../../charts/frame-loop.js';
import { TEMPO_RANGE } from '../../studio/schema.js';
import { announceAction } from '../../studio/a11y.js';
import { createTransportCommands } from './transport-commands.js';
import { READOUT_INTERVAL_MS, transportStrip } from './transport-view.js';
import { el, pathIcon, setAttr, setText, spriteIcon } from './timeline-dom.js';

export function mountTransportBar(host, ctx,
  { commands = null, ownFrame = false, keys = true } = {}) {
  const { store, transport } = ctx;
  const cmd = commands || createTransportCommands(ctx);
  const say = (t) => { if (t && typeof ctx.announce === 'function') ctx.announce(t); };

  const btn = (key, label, icon, onClick, extra = {}) => el('button', { type: 'button',
    class: 'osc-transport-btn osc-stl-tbtn', 'data-osc': `studio.tl.${key}`, 'aria-label': label,
    title: label, on: { click: onClick }, ...extra }, [icon]);

  const returnBtn = btn('return', 'Return to start', pathIcon('return'),
    () => cmd.returnToStart());
  const playBtn = btn('play', 'Play', spriteIcon('i-play'), () => cmd.play(),
    { 'aria-pressed': 'false' });
  const stopBtn = btn('stop', 'Stop', spriteIcon('i-stop'), () => cmd.stop());
  const loopBtn = btn('loop', 'Loop', pathIcon('loop'), () => cmd.toggleLoop(),
    { 'aria-pressed': 'false' });
  const time = el('output', { class: 'osc-stl-time osc-tabular', 'data-osc': 'studio.tl.time',
    'aria-label': 'Playhead position', 'aria-live': 'off' }, ['00:00.000']);
  const state = el('span', { class: 'osc-stl-state', 'data-osc': 'studio.tl.state' },
    ['STOPPED']);

  const setMode = (mode) => {
    const r = store.dispatch({ type: 'TRANSPORT_SET', timeMode: mode });
    if (r.ok && r.changed) say(mode === 'musical' ? 'Time in bars and beats' : 'Time in seconds');
    else if (!r.ok) say(announceAction(r));
  };
  const secBtn = el('button', { type: 'button', class: 'osc-seg-btn', 'data-osc':
    'studio.tl.mode-seconds', 'aria-pressed': 'true', title: 'Time in seconds',
    on: { click: () => setMode('seconds') } }, ['SEC']);
  const barBtn = el('button', { type: 'button', class: 'osc-seg-btn', 'data-osc':
    'studio.tl.mode-musical', 'aria-pressed': 'false', title: 'Time in bars and beats',
    on: { click: () => setMode('musical') } }, ['BAR']);
  const modeSeg = el('div', { class: 'osc-seg osc-stl-mode', role: 'group',
    'aria-label': 'Time mode' }, [secBtn, barBtn]);

  const tempoId = `osc-stl-tempo-${Math.random().toString(36).slice(2, 8)}`;
  const tempo = el('input', { id: tempoId, class: 'osc-number osc-stl-tempo', type: 'number',
    inputmode: 'decimal', min: TEMPO_RANGE[0], max: TEMPO_RANGE[1], step: '1',
    'data-osc': 'studio.tl.tempo', 'aria-describedby': null,
    on: { change: (e) => {
      const v = Number(e.target.value);
      const r = store.dispatch({ type: 'TRANSPORT_SET', tempo: v });
      if (!r.ok) {
        say(announceAction(r));
        e.target.value = String(store.getModel().transport.tempo);
      } else if (r.changed) {
        say(`Tempo ${v} BPM`);
        if (transport.playing) transport.sync();
      }
    } } });
  const tempoBox = el('label', { class: 'osc-stl-tempo-box', for: tempoId }, [
    el('span', { class: 'osc-label' }, ['Tempo']), tempo,
    el('span', { class: 'osc-stl-unit' }, ['BPM'])]);

  const element = el('div', { class: 'osc-stl-transport', role: 'group',
    'aria-label': keys ? 'Studio transport' : 'Timeline time mode and tempo',
    'data-osc': 'studio.tl.transport' }, [
    ...(keys ? [
      el('div', { class: 'osc-transport osc-stl-keys' }, [returnBtn, playBtn, stopBtn, loopBtn]),
      el('div', { class: 'osc-stl-clock' }, [time, state]),
    ] : []),
    modeSeg, tempoBox,
  ]);
  host.append(element);

  let lastText = '';
  let lastWrite = 0;
  let lastPlaying = null;

  function update() {
    const model = store.getModel();
    const v = transportStrip(model, transport.playhead());
    setAttr(playBtn, 'aria-pressed', v.playing ? 'true' : 'false');
    setAttr(loopBtn, 'aria-pressed', v.loopOn ? 'true' : 'false');
    setAttr(loopBtn, 'title', v.loopLabel);
    setAttr(secBtn, 'aria-pressed', v.mode === 'seconds' ? 'true' : 'false');
    setAttr(barBtn, 'aria-pressed', v.mode === 'musical' ? 'true' : 'false');
    secBtn.classList.toggle('is-active', v.mode === 'seconds');
    barBtn.classList.toggle('is-active', v.mode === 'musical');
    setText(state, v.playing ? 'PLAYING' : 'STOPPED');
    element.dataset.playing = v.playing ? 'true' : 'false';
    if (document.activeElement !== tempo) tempo.value = String(model.transport.tempo);
    setText(time, v.readout);
    lastText = v.readout;
    lastPlaying = v.playing;
  }

  /** Per frame: the readout follows the playhead at READOUT_INTERVAL_MS while playing. */
  function tick(now = 0) {
    const playing = transport.playing;
    if (playing !== lastPlaying) {
      update();
      return;
    }
    if (!playing || now - lastWrite < READOUT_INTERVAL_MS) return;
    lastWrite = now;
    const v = transportStrip(store.getModel(), transport.playhead());
    if (v.readout !== lastText) {
      lastText = v.readout;
      time.textContent = v.readout;
    }
  }

  const offTransport = transport.on((type) => {
    if (type === 'state') update();
    if (type === 'ended') {
      update();
      say('Playback ended');
    }
  });
  const offFrame = ownFrame ? onFrame(tick) : null;
  update();

  return {
    element,
    commands: cmd,
    update,
    tick,
    destroy() {
      offTransport();
      if (offFrame) offFrame();
      element.remove();
    },
  };
}
