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
// playing step follows its playhead through the step grid's one frame-loop subscriber. Open in Studio selects the clip in the timeline.
// Every edit is one dispatch through the one store; the row order is view state of this page.
//
//   createDrumsTab({ nodes, model, dispatch, say, transport, playhead, sink, openStudio, tab })
//     -> { html(), mount(), update() -> updated in place, destroy() }

import { DRUM_ROWS, DRUM_VOICES, drumClipOf, lanesOf, namesOf, newDrumClip, rowsOf,
  voiceChange } from '../drums.js';
import { NEW_STEP_GRID } from '../../studio/notes-grid.js';
import { mountStepGrid } from '../../ui/kinds/step-grid.js';
import { clipStepsView, playingStep } from '../../ui/studio/inspector-steps.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const BUTTON = 'inline-flex h-11 items-center gap-1 rounded-lg border border-solid border-gray-300 '
  + 'bg-white px-3 text-sm font-medium text-gray-900 hover:bg-gray-100 focus:outline-none '
  + 'focus-visible:ring-2 focus-visible:ring-primary-300 disabled:opacity-50 '
  + 'dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700';
const PRIMARY = 'inline-flex h-11 items-center rounded-lg bg-primary-600 px-4 text-sm '
  + 'font-medium text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 '
  + 'focus-visible:ring-primary-300';
const PAD = 'h-11 w-full rounded-lg border border-solid border-gray-300 bg-gray-50 px-3 '
  + 'text-sm font-medium text-gray-900 active:bg-primary-600 active:text-white '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 touch-none '
  + 'select-none dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const SELECT = 'h-11 w-full rounded-lg border border-solid border-gray-300 bg-gray-50 px-2 '
  + 'text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 '
  + 'dark:border-gray-600 dark:bg-gray-700 dark:text-white';
const TEXT = Object.freeze({
  title: 'BICÍ', grid: 'Bicí kroky', play: 'Přehrát', stop: 'Zastavit', open: 'Otevřít ve Studiu',
  pads: 'Pady', voice: (name) => `Zvuk řady ${name}`, noKit: 'Tento dokument Studia nemá '
    + 'perkusní engine panelu.', empty: 'Bicí ještě nemají klip: vytvořte jeden takt kroků na '
    + 'stopě perkusního enginu.', make: 'Vytvořit bicí klip',
});
const PAD_VELOCITY = 100;

export function createDrumsTab({ nodes, model, dispatch, say, transport, playhead, sink,
  openStudio, tab }) {
  let m = null; // { root, grid, clipId, view } while the grid is mounted
  let rows = null; // the row order of this page (view state)
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
      + `<button type="button" class="${PRIMARY}" data-drums-play="" aria-pressed="${playing}">`
      + `${playing ? TEXT.stop : TEXT.play}</button>`
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
      + `<div class="px-2 sm:px-0" data-drums-pads="">${padsHtml()}</div>`;
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
    listen(body);
  }

  function listen(body) {
    body.addEventListener('click', (e) => {
      const t = transport();
      if (e.target.closest('[data-drums-play]') && t) {
        const r = t.playing ? t.stop() : t.start();
        if (r && r.ok === false && r.reason) say(r.reason, true);
        syncBar();
      } else if (e.target.closest('[data-drums-open]') && m) {
        openStudio(m.clipId);
      }
    });
    body.addEventListener('change', (e) => {
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
      if (pads) pads.innerHTML = padsHtml();
    });
    const press = (i) => {
      const note = lanesOf(rows)[i];
      if (note == null || held.has(i)) return;
      held.set(i, note);
      sink().noteOn(note, PAD_VELOCITY);
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
    const playing = isPlaying();
    m.playing = playing;
    const btn = m.root.querySelector('[data-drums-play]');
    if (!btn) return;
    btn.textContent = playing ? TEXT.stop : TEXT.play;
    btn.setAttribute('aria-pressed', String(playing));
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
    return true;
  }

  function destroy() {
    for (const i of [...held.keys()]) {
      sink().noteOff(held.get(i));
      held.delete(i);
    }
    if (m) m.grid.destroy();
    m = null;
  }

  return { html, mount, update, destroy };
}
