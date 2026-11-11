// The Synth workspace's Drums tab (plan K222, ADR 0086, Q019): a Flowbite Pro card over the
// panel's percussion engine (panels/engines.js `perc`) and one notes clip on its track, drawn by
// the step-grid kind (ui/kinds/step-grid.js) and its pure half synth/drums.js. Composed by
// synth/ui.js, which renders the card with the panel view and mounts the grid after it.
//
// The rows are note numbers of the engine's key map with Czech names; a row's voice picker
// rewrites that lane in one CLIP_UPDATE (refused, with its sentence, for a voice another row
// holds). Below the grid one pad per row plays its note live through the Synth's one note path
// (notes-sink.js: the Drums tab routes the keys to the percussion engine), by pointer, touch and
// Enter or Space on a focused pad (its click; no key listener of its own: the key dispatcher
// leaves Space on a focused native control to that control, so Space there strikes the pad and
// never starts the timeline). A strike's note arms the Studio transport (K104), which is why
// transport.playing reads true after it while playhead().playing stays false (review R2-K222-3,
// measured in chromium, firefox and webkit). Play and Stop are the Studio transport's; the
// playing step follows its playhead through the step grid's one frame-loop subscriber; Record
// beside Play writes the live hits of a take into the clip (K223, ui/kinds/record-switch.js).
// Open in Studio selects the clip in the timeline.
// Every edit is one dispatch through the one store; the row order is view state of this page.
//
// Below the pads, the row's sound editor (K071): the voice of one row (the last pad struck, or
// the one picked) with its own decay, tune, level and choke group as the Synth's knobs (`knob`,
// view/face.js knobHtml through ui.js), driven by the panel's one knob gesture path, so a drag is
// one history entry. It is drawn again on every store update; a drag redraws only its knob.
//
//   createDrumsTab({ nodes, model, dispatch, say, transport, playhead, sink, openStudio, tab,
//     knob(cid) -> html }) -> { html(), mount(), update() -> updated in place, destroy() }

import { DRUM_ROWS, DRUM_VOICES, drumClipOf, lanesOf, namesOf, newDrumClip, rowsOf,
  voiceChange } from '../drums.js';
import { NEW_STEP_GRID } from '../../studio/notes-grid.js';
import { PERC_VOICE_PARAMS, percParamKey } from '../perc-recipes.js';
import { mountStepGrid } from '../../ui/kinds/step-grid.js';
import { bindRecordSwitch, recordSwitchHtml } from '../../ui/kinds/record-switch.js';
import {
  PLAY_BUTTON, RECORD_BUTTON, bindTimelinePlay, timelinePlayHtml,
} from './timeline-play.js';
import { clipStepsView, playingStep } from '../../ui/studio/inspector-steps.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const BUTTON = 'inline-flex h-11 items-center gap-1 rounded-lg border border-solid border-gray-300 '
  + 'bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-100 focus:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-primary-300 disabled:opacity-50 '
  + 'dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700';
const PRIMARY = PLAY_BUTTON;
const PAD = 'h-11 w-full rounded-lg border border-solid border-gray-300 bg-gray-50 px-3 '
  + 'text-sm font-medium text-gray-900 active:bg-primary-600 active:text-white '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 touch-none '
  + 'select-none dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const SELECT = 'h-11 w-full rounded-lg border border-solid border-gray-300 bg-gray-50 px-2 '
  + 'text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 '
  + 'dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const TEXT = Object.freeze({
  title: 'BICÍ', grid: 'Bicí kroky', open: 'Otevřít ve Studiu',
  pads: 'Pady', voice: (name) => `Zvuk řady ${name}`, sound: 'ZVUK ŘADY',
  soundPick: 'Upravit zvuk řady', noKit: 'Tento dokument Studia nemá '
    + 'perkusní engine panelu.', empty: 'Bicí ještě nemají klip: vytvořte jeden takt kroků na '
    + 'stopě perkusního enginu.', make: 'Vytvořit bicí klip',
});
const PAD_VELOCITY = 100;

export function createDrumsTab({ nodes, model, dispatch, say, transport, playhead, sink,
  openStudio, tab, knob = () => '' }) {
  let m = null; // { root, grid, clipId, view } while the grid is mounted
  let rows = null; // the row order of this page (view state)
  let sound = null; // the row voice the sound editor shows (view state)
  const owner = { selection: [], page: 0 };
  const held = new Map(); // pad index -> note sounding

  const perc = () => nodes().get('perc') || null;
  const clipNow = () => (perc() ? drumClipOf(model(), perc().id) : null);
  const viewOf = (clip) => {
    const v = clipStepsView(model(), clip, true);
    return { ...v, lanes: lanesOf(rows), laneNames: namesOf(rows) };
  };

  function html() {
    if (tab() !== 'drums') return '';
    // At a phone's width the card spans the 16 px gutters with no side padding of its own, so
    // its eight 44 px steps fit (345 px); wider it is padded as every Synth card.
    return '<section class="bg-white rounded-lg shadow dark:bg-gray-800 mb-3 -mx-2 py-2 '
      + 'sm:mx-0 sm:p-3" data-drums="" aria-labelledby="synth-drums-title"><h3 '
      + 'id="synth-drums-title" class="px-2 text-sm font-bold tracking-widest text-gray-900 '
      + `sm:px-0 dark:text-white">${TEXT.title}`
      + '</h3><div data-drums-body="" class="mt-2"></div></section>';
  }

  const isPlaying = () => {
    const ph = playhead();
    return !!(ph && ph.playing);
  };

  function toolbar() {
    const playing = isPlaying();
    return '<div class="mb-2 flex flex-wrap items-center gap-2">'
      + `${timelinePlayHtml({ hook: 'data-drums-play', playing })}`
      + `${recordSwitchHtml(RECORD_BUTTON)}`
      + `<button type="button" class="${BUTTON}" data-drums-open="" `
      + `data-osc="synth.drums.studio" data-osc-link="open-in">${TEXT.open}</button></div>`;
  }

  function padsHtml() {
    return `<h4 class="mt-3 text-xs font-bold tracking-widest text-gray-900 dark:text-white">`
      + `${TEXT.pads}</h4><ul class="mt-1 grid grid-cols-2 gap-2 lg:grid-cols-3">`
      + rows.map((r, i) => {
        const name = namesOf([r])[0];
        return `<li class="flex flex-col gap-1"><button type="button" class="${PAD}" `
          + `data-drum-pad="${i}">${esc(name)}</button><select class="${SELECT}" `
          + `data-drum-voice="${i}" aria-label="${esc(TEXT.voice(name))}">`
          + DRUM_VOICES.map((v) => `<option value="${v.voice}"${v.voice === r ? ' selected'
            : ''}>${esc(v.label)}</option>`).join('') + '</select></li>';
      }).join('') + '</ul>';
  }

  /** The sound editor of one row's voice: its four knobs (the panel's `perc` module keys). */
  function soundHtml() {
    if (!rows.includes(sound)) sound = rows[0];
    const names = namesOf(rows);
    return `<h4 class="mt-3 text-xs font-bold tracking-widest text-gray-900 dark:text-white">`
      + `${TEXT.sound}</h4><select class="${SELECT} mt-1 sm:w-64" data-drums-sound="" `
      + `aria-label="${TEXT.soundPick}">`
      + rows.map((r, i) => `<option value="${r}"${r === sound ? ' selected' : ''}>`
        + `${esc(names[i])}</option>`).join('') + '</select>'
      + '<div class="mt-2 flex flex-wrap gap-3" data-drums-knobs="">'
      + PERC_VOICE_PARAMS.map((name) => knob(`perc.${percParamKey(sound, name)}`)).join('')
      + '</div>';
  }

  /**
   * Replace a container's markup; the control inside it that had focus keeps it (a knob after an
   * arrow key's edit, the row select or a pad's voice select after a pick: R2-T5-2, the redraw
   * used to destroy the select that fired the change and drop focus to the body).
   */
  function redrawKeepingFocus(box, html) {
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    const d = a && box.contains(a) && a.dataset ? a.dataset : null;
    let selector = null;
    if (d && d.knob) selector = `[data-knob="${d.knob}"]`;
    else if (d && 'drumsSound' in d) selector = '[data-drums-sound]';
    else if (d && d.drumVoice != null) selector = `[data-drum-voice="${d.drumVoice}"]`;
    box.innerHTML = html;
    const k = selector && box.querySelector(selector);
    if (k) k.focus({ preventScroll: true });
  }

  /** Redraw the sound editor; the control that had focus keeps it. */
  function syncSound() {
    const box = m && m.root.querySelector('[data-drums-sound-box]');
    if (!box) return;
    redrawKeepingFocus(box, soundHtml());
  }

  function build(body) {
    if (!perc()) {
      body.innerHTML = '<p class="px-2 text-sm text-gray-700 sm:px-0 dark:text-gray-300">'
        + `${TEXT.noKit}</p>`;
      return;
    }
    const clip = clipNow();
    if (!clip) {
      body.innerHTML = '<div class="px-2 sm:px-0"><p class="text-sm text-gray-700 '
        + `dark:text-gray-300">${TEXT.empty}</p><button type="button" class="${PRIMARY} mt-2" `
        + `data-drums-new="">${TEXT.make}</button></div>`;
      return;
    }
    rows = rowsOf(clip, rows || DRUM_ROWS);
    const view = viewOf(clip);
    body.innerHTML = `<div class="px-2 sm:px-0" data-drums-bar="">${toolbar()}</div>`
      + '<div data-drums-grid=""></div>'
      + `<div class="px-2 sm:px-0" data-drums-pads="">${padsHtml()}</div>`
      + `<div class="px-2 sm:px-0" data-drums-sound-box="">${soundHtml()}</div>`;
    let grid = null; // the first fit calls onView while mountStepGrid is still building
    grid = mountStepGrid(body.querySelector('[data-drums-grid]'), {
      mode: 'notes', label: TEXT.grid, clipId: clip.id, payload: clip.payload,
      lanes: view.lanes, laneNames: view.laneNames, steps: view.steps,
      stepBeats: view.stepBeats || NEW_STEP_GRID.stepBeats,
      commit: (action) => {
        const r = dispatch(action);
        return r.ok ? true : { refused: r.reason || '' };
      },
      onView: (v) => {
        if (v.selection) owner.selection = v.selection;
        if (v.page != null) owner.page = v.page;
        if (grid) grid.set({ selection: owner.selection, page: owner.page });
      },
      // Every frame: the playhead only (transport() also sets audio up and follows the flag);
      // the Play button follows a stop the transport made by itself (review R2-K222-2).
      playStep: () => {
        if (!m) return null;
        const ph = playhead();
        if (!!(ph && ph.playing) !== m.playing) syncBar();
        return playingStep(model(), m.view, ph);
      },
    });
    m = { root: body, grid, clipId: clip.id, view, playing: isPlaying() };
    // K223: Record beside Play, the transport's one recorder armed for this clip.
    m.record = bindRecordSwitch(body.querySelector('[data-notes-record]'), { transport,
      store: { getModel: model, dispatch }, clipId: () => (m ? m.clipId : null), say });
    // Play and Stop: the one timeline Play beside a Record switch (timeline-play.js, K231).
    m.play = bindTimelinePlay(body.querySelector('[data-drums-play]'), { transport, say,
      playhead, onChange: () => { if (m) m.playing = isPlaying(); } });
    listen(body);
  }

  function listen(body) {
    body.addEventListener('click', (e) => {
      // Play and Stop are timeline-play.js's (bound in mount).
      if (e.target.closest('[data-drums-open]') && m) openStudio(m.clipId);
    });
    body.addEventListener('change', (e) => {
      const pick = e.target.closest('[data-drums-sound]');
      if (pick) {
        sound = pick.value;
        syncSound();
        return;
      }
      const sel = e.target.closest('[data-drum-voice]');
      const clip = clipNow();
      if (!sel || !clip) return;
      const r = voiceChange(clip, rows, Number(sel.dataset.drumVoice), sel.value);
      if (r.refused) {
        say(r.refused, true);
        sel.value = rows[Number(sel.dataset.drumVoice)];
        return;
      }
      rows = r.rows;
      if (r.action) dispatch(r.action);
      update();
      const pads = body.querySelector('[data-drums-pads]');
      if (pads) redrawKeepingFocus(pads, padsHtml());
      syncSound();
    });
    const press = (i) => {
      const note = lanesOf(rows)[i];
      if (note == null || held.has(i)) return;
      held.set(i, note);
      sink().noteOn(note, PAD_VELOCITY);
      if (rows[i] !== sound) { // the editor follows the pad struck
        sound = rows[i];
        syncSound();
      }
    };
    const lift = (i) => {
      if (!held.has(i)) return;
      sink().noteOff(held.get(i));
      held.delete(i);
    };
    const padOf = (e) => e.target.closest && e.target.closest('[data-drum-pad]');
    body.addEventListener('pointerdown', (e) => {
      const p = padOf(e);
      if (p) press(Number(p.dataset.drumPad));
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      body.addEventListener(type, (e) => {
        const p = padOf(e);
        if (p) lift(Number(p.dataset.drumPad));
      }, true);
    }
    // Keys: Enter (or Space) on a focused pad clicks it, which strikes the row's hit; a hit
    // decays by itself (a release does not shorten it), so the click's note-off follows at once.
    body.addEventListener('click', (e) => {
      const p = padOf(e);
      if (!p || e.detail !== 0) return; // a pointer's click: its pointerdown already struck
      const i = Number(p.dataset.drumPad);
      press(i);
      lift(i);
    });
  }

  /** The Play button says what a press does now, written only when that changes. */
  function syncBar() {
    if (!m) return;
    m.playing = isPlaying();
    m.play.sync();
  }

  function mount() {
    destroy();
    if (tab() !== 'drums') return;
    const body = typeof document !== 'undefined' && document.querySelector('[data-drums-body]');
    if (!body) return;
    body.addEventListener('click', (e) => {
      if (!e.target.closest('[data-drums-new]') || !perc()) return;
      dispatch(newDrumClip(model(), perc().id)); // the store change re-renders the tab
    });
    build(body);
  }

  /** The store changed: the mounted grid takes the clip in place (focus and drags survive). */
  function update() {
    if (!m || !m.root.isConnected || tab() !== 'drums') return false;
    const clip = clipNow();
    if (!clip || clip.id !== m.clipId) return false;
    rows = rowsOf(clip, rows);
    m.view = viewOf(clip);
    m.grid.set({ payload: clip.payload, lanes: m.view.lanes, laneNames: m.view.laneNames,
      steps: m.view.steps, stepBeats: m.view.stepBeats, selection: owner.selection,
      page: owner.page });
    syncBar();
    syncSound(); // undo, redo and the Studio's edits of the row's parameters
    return true;
  }

  function destroy() {
    for (const i of [...held.keys()]) {
      sink().noteOff(held.get(i));
      held.delete(i);
    }
    if (m) {
      m.grid.destroy();
      m.record.destroy();
      m.play.destroy();
    }
    m = null;
  }

  return { html, mount, update, destroy };
}
