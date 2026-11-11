// The Synth bay's jack verdicts, moved out of ui.js (train T7b, source-size budget) without a
// change of behaviour: which jacks accept a cable from or to a jack, and why the rest refuse.
import { canConnect } from '../studio/ports.js';
import { jackReason } from './normals.js';
import { splitJack } from './panel.js';

/** A jack by its key ('module.port:in' | ':out'): a port id may name an input and an output. */
export function jackOf(panel, key) {
  const { module } = splitJack(key);
  return panel.jacksOf(module).find((j) => j.key === key) || null;
}

/** The registry port a jack stands for. */
export function portOf(panel, registry, j) {
  return registry.port(panel.module(j.module).node, j.port, j.direction);
}

/**
 * Every other jack's verdict for a cable from or to `id`: { ok, reason } from the typed-port
 * validator, then the panel's own refusals (normals.js patchCable: a jack where the cable
 * would do nothing). A feedback loop is judged by the store at the drop, with its sentence.
 */
export function verdictsFor(model, panel, registry, id) {
  const a = jackOf(panel, id);
  const out = new Map();
  if (!a) return out;
  for (const mod of panel.modules) {
    for (const j of panel.jacksOf(mod.id)) {
      if (j.direction === a.direction) continue;
      if (j.module === a.module) {
        out.set(j.key, { ok: false, reason: 'Modul nelze propojit sám se sebou.' });
        continue;
      }
      const [s, t] = a.direction === 'out'
        ? [portOf(panel, registry, a), portOf(panel, registry, j)]
        : [portOf(panel, registry, j), portOf(panel, registry, a)];
      const v = canConnect(s, t);
      if (!v.allowed) { out.set(j.key, { ok: false, reason: v.reason }); continue; }
      const [from, to] = a.direction === 'out' ? [a.id, j.id] : [j.id, a.id];
      const why = jackReason(model, panel, to, from);
      out.set(j.key, why ? { ok: false, reason: why } : { ok: true, reason: null });
    }
  }
  return out;
}
