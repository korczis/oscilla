// The peeper's Alpine part (composed into the ONE component by main.js): the page-header action
// (peeper.toggle) and the keyboard shortcut (Backquote, bound in the key registry of
// src/js/ui/keys and listed in ui/shortcuts.js GLOBAL_SHORTCUTS) open it on every page; it docks below the workspace, in the flow of the
// content column, so it covers nothing at any width (a bottom sheet on a phone that collapses to
// its header). It is a visual component of the catalogue ('peeper', decl/visual.js), so the one
// frame gives it full screen. It never starts audio: it reads only while the output plays.
//
//   createPeeperUi({ probe, storage }) -> the Alpine part
//   peep(target) -> boolean   the ONE way the patch bay and the Studio graph open the peeper on
//                             a port, node or edge: { id } | { nodeId } | { edgeId } | 'id'
//
// The model (model.js) owns the lease; this part mirrors its state into `peeper` for the
// markup, runs the draw loop while a frame can be read and calls the view (view.js) once per
// frame: the placeholder line now, W004's scope later.

import { createPeeper, PEEPER_KEY } from './model.js';
import { peeperView } from './view.js';

const REASONS = Object.freeze({
  stopped: 'Nothing plays: press Play to watch the signal. The peeper never starts audio.',
  hidden: 'The page is hidden; the peeper reads again when it is in sight.',
  budget: 'Too many signals are watched at once; close another view to watch this one.',
  unsupported: 'This browser cannot tap the signal here.',
  collapsed: '',
  closed: '',
});

let current = null;

/** Open the peeper on `target` (a tap point, node or edge). False before the page is up. */
export function peep(target) {
  return current ? current.peep(target) : false;
}

function storageOf(storage) {
  return {
    load() {
      try { return storage ? storage.getItem(PEEPER_KEY) : null; } catch (e) { return null; }
    },
    save(v) {
      try { if (storage) storage.setItem(PEEPER_KEY, v); } catch (e) { /* view state only */ }
    },
  };
}

export function createPeeperUi({ probe, storage = null } = {}) {
  const store = storageOf(storage);
  const model = createPeeper({ probe, load: store.load, save: store.save });
  let raf = 0;
  return {
    peeper: { ...model.state(), points: model.points(), stub: !!probe.stub, live: false,
      liveReason: '', windowText: '' },

    peeperSync(reading) {
      const s = model.state();
      const p = this.peeper;
      for (const k of ['open', 'pinned', 'tap', 'windowMs', 'collapsed', 'reason']) p[k] = s[k];
      if (reading) {
        p.live = !!reading.live;
        p.liveReason = reading.live ? '' : (reading.reason || s.reason || 'stopped');
        if (reading.live) {
          p.windowText = `${reading.windowMs.toFixed(1)} ms · ${reading.window} samples at `
            + `${(reading.sampleRate / 1000).toFixed(1)} kHz`;
        }
      } else if (!model.leased()) {
        p.live = false;
        p.liveReason = s.reason;
      }
    },
    get peeperReasonText() {
      return this.peeper.live ? '' : (REASONS[this.peeper.liveReason] || '');
    },
    get peeperLabel() {
      const pt = this.peeper.points.find((x) => x.id === this.peeper.tap);
      return `Peeper: ${pt ? pt.label : 'no tap point'}${this.peeper.stub ? ' (stub signal)' : ''}`;
    },

    peeperInit() {
      const cmp = this;
      current = { peep: (t) => cmp.peeperOpen(t) };
      // The shortcut, through the page's one key registry (K153, src/js/ui/keys; the instance
      // is `keys`, made in main.js): Backquote in every workspace. Its default focus 'none'
      // never fires inside a text field or a modal dialog.
      if (this.keys && typeof this.keys.bind === 'function') {
        this.keys.bind({ id: 'peeper.toggle', keys: ['Backquote'], scope: { workspace: '*' },
          run: () => cmp.peeperToggle(), label: 'Show or hide the scope peeper', group: 'View' });
      }
      document.addEventListener('visibilitychange', () => {
        model.visibility(document.hidden);
        cmp.peeperTick();
      });
      this.$watch('workspace', () => { model.route(); cmp.peeperTick(); });
      this.$watch('outputOwner', (owner) => { model.transport(!!owner); cmp.peeperTick(); });
      model.transport(!!this.outputOwner);
      this.peeperTick();
    },
    /** Mirror the state, and run the draw loop while a lease is held. */
    peeperTick() {
      if (this.peeper.open) this.peeper.points = model.points();
      this.peeperSync(null);
      if (raf || !model.leased()) return;
      const canvas = () => this.$root.querySelector('[data-osc="peeper.canvas"]');
      const loop = () => {
        raf = 0;
        if (!model.leased()) { this.peeperSync(null); this.peeperDraw(canvas(), null); return; }
        const r = model.read();
        this.peeperSync(r);
        this.peeperDraw(canvas(), r);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    },
    peeperDraw(canvas, reading) {
      if (canvas && canvas.clientWidth) peeperView()(canvas, reading);
    },
    peeperOpen(target) {
      model.open(target);
      this.peeperTick();
      return true;
    },
    peeperToggle() {
      model.toggle();
      this.peeperTick();
      if (this.peeper.open) {
        this.$nextTick(() => {
          const sel = this.$root.querySelector('[data-osc="peeper.tap"]');
          if (sel) sel.focus();
        });
      }
    },
    peeperClose() {
      model.close();
      this.peeperTick();
      const btn = this.$root.querySelector('[data-osc="peeper.toggle"]');
      if (btn) btn.focus();
    },
    peeperPin() { model.pin(); this.peeperTick(); },
    peeperCollapse() { model.collapse(); this.peeperTick(); },
    peeperSwitch(id) { model.switchTap(id); this.peeperTick(); },
    peeperStepWindow() { model.stepWindow(); this.peeperTick(); },
    /** For the browser test and the debug panel: the probe's counts. */
    peeperActive() { return probe.active(); },
  };
}
