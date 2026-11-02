// The one keyboard component (src/js/ui/keys/): a registry where every chord has exactly one
// owner per scope (a second owner throws at bind), the most specific scope wins, and a single
// dispatcher that passes through what it does not own (IME, text fields, a focused control's
// own keys, unowned chords) and pairs every press with one up(), auto-repeat swallowed, every
// hold released on blur. The ratchet: key listeners outside src/js/ui/keys/ only shrink
// (tests/unit/key-listener-baseline.json).
//
//   node --test tests/unit/keys-registry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const reg = await import('../../src/js/ui/keys/registry.js').catch(() => ({}));
const dis = await import('../../src/js/ui/keys/dispatcher.js').catch(() => ({}));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const noop = () => {};
const ev = (code, o = {}) => ({ code, key: o.key || code, repeat: false, isComposing: false,
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: o.target || null,
  defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...o });

test('chords are codes with modifiers in one order, labelled for the help', () => {
  assert.equal(reg.normalizeChord('Shift+Ctrl+KeyZ'), 'Ctrl+Shift+KeyZ');
  assert.equal(reg.chordOf(ev('KeyR', { shiftKey: true })), 'Shift+KeyR');
  assert.throws(() => reg.normalizeChord('Hyper+KeyA'), /unknown modifier/);
  assert.throws(() => reg.normalizeChord('Shift'), /names no key/);
  assert.equal(reg.keyLabel('Shift+KeyR'), 'Shift+R');
  assert.equal(reg.keyLabel('BracketLeft'), '[');
  assert.equal(reg.keyLabel('Shift+BracketRight'), 'Shift+]');
  assert.equal(reg.keyLabel('ArrowLeft'), '←');
  assert.equal(reg.keyLabel('Digit3'), '3');
});

test('a chord has one owner per scope: a second throws, a nested view overrides', () => {
  const keys = reg.createKeyRegistry();
  keys.bind({ id: 'play.hold', keys: ['Space'], scope: { workspace: 'playground' }, run: noop,
    label: 'Hold to play' });
  assert.throws(() => keys.bind({ id: 'other', keys: ['Space'],
    scope: { workspace: 'playground' }, run: noop, label: 'x' }), /owned by "play.hold"/);
  assert.throws(() => keys.bind({ id: 'play.hold', keys: ['KeyQ'], scope: { workspace: 'synth' },
    run: noop, label: 'x' }), /already bound/);
  keys.bind({ id: 'help', keys: ['Shift+Slash'], scope: { workspace: '*' }, run: noop,
    label: 'Keyboard shortcuts' });
  keys.bind({ id: 'synth.none', keys: ['KeyR'], scope: { workspace: 'synth' }, run: noop,
    label: 'Record' });
  keys.bind({ id: 'xy.rec', keys: ['KeyR'], scope: { workspace: 'synth', view: 'xy' }, run: noop,
    label: 'Record or overdub the loop' });
  keys.bind({ id: 'xy.hold', keys: ['Space'], scope: { workspace: 'synth', view: 'xy' },
    run: noop, label: 'Hold the point' });
  assert.equal(keys.resolve('KeyR', { workspace: 'synth', view: 'xy' }).id, 'xy.rec');
  assert.equal(keys.resolve('KeyR', { workspace: 'synth', view: 'panel' }).id, 'synth.none');
  assert.equal(keys.resolve('Space', { workspace: 'synth', view: 'xy' }).id, 'xy.hold');
  assert.equal(keys.resolve('Space', { workspace: 'synth' }), null, 'no Space in the panel');
  assert.equal(keys.resolve('Shift+Slash', { workspace: 'studio' }).id, 'help');
  assert.equal(keys.resolve('Space', { workspace: 'playground', focus: 'dialog' }), null);
  let gate = false;
  const off = keys.bind({ id: 'gated', keys: ['KeyG'], scope: { workspace: 'synth' },
    when: () => gate, run: noop, label: 'Gated' });
  assert.equal(keys.resolve('KeyG', { workspace: 'synth' }), null);
  gate = true;
  assert.equal(keys.resolve('KeyG', { workspace: 'synth' }).id, 'gated');
  off();
  assert.equal(keys.resolve('KeyG', { workspace: 'synth' }), null, 'unbind frees the chord');
  for (const bad of [{}, { id: 'a' }, { id: 'a', keys: ['KeyA'] },
    { id: 'a', keys: ['KeyA'], run: noop }, { id: 'a', keys: ['KeyA'], run: noop,
      scope: { workspace: 'x', focus: 'nowhere' }, label: 'A' }]) {
    assert.throws(() => keys.bind(bad), TypeError);
  }
  const help = reg.helpRows(keys, (w) => w.toUpperCase());
  const rows = help.flatMap((g) => g.rows);
  assert.deepEqual(rows.find((r) => r.id === 'xy.rec'),
    { id: 'xy.rec', keys: ['R'], label: 'Record or overdub the loop', where: 'SYNTH (xy)' });
  assert.equal(rows.find((r) => r.id === 'help').where, 'Everywhere');
});

test('the dispatcher runs the owner once per press and pairs it with one up()', () => {
  const keys = reg.createKeyRegistry();
  const log = [];
  keys.bind({ id: 'hold', keys: ['Space'], scope: { workspace: 'synth', view: 'xy' },
    run: (e) => log.push(`run ${e.code}`), up: (e) => log.push(`up ${e.code}`), label: 'Hold' });
  keys.bind({ id: 'nudge', keys: ['ArrowLeft'], scope: { workspace: 'synth', view: 'xy' },
    repeat: true, run: () => log.push('nudge'), label: 'Nudge' });
  const d = dis.createKeyDispatcher({ registry: keys,
    context: () => ({ workspace: 'synth', view: 'xy' }) });
  const down = ev('Space');
  assert.equal(d.keydown(down), true);
  assert.equal(down.defaultPrevented, true);
  assert.equal(d.keydown(ev('Space', { repeat: true })), true, 'a repeat is swallowed');
  assert.equal(d.keyup(ev('Space')), true);
  assert.equal(d.keyup(ev('Space')), false, 'one up per press');
  d.keydown(ev('ArrowLeft'));
  d.keydown(ev('ArrowLeft', { repeat: true }));
  d.keyup(ev('ArrowLeft'));
  assert.deepEqual(log, ['run Space', 'up Space', 'nudge', 'nudge']);
  log.length = 0;
  d.keydown(ev('Space'));
  d.releaseAll('blur');
  assert.deepEqual(log, ['run Space', 'up Space'], 'blur releases a held key');
  assert.deepEqual(d.held, []);
});

test('the dispatcher passes through IME, text fields, a control\'s own keys and unowned chords', () => {
  const keys = reg.createKeyRegistry();
  let ran = 0;
  keys.bind({ id: 'q', keys: ['KeyQ', 'Space'], scope: { workspace: '*' }, run: () => { ran++; },
    label: 'Q' });
  const el = (tagName, attrs = {}) => ({ tagName, isContentEditable: false,
    getAttribute: (k) => attrs[k] ?? null, closest: () => null });
  const docWith = (active, modal = false) => ({ activeElement: active, body: {},
    querySelector: () => (modal ? {} : null) });
  const run = (e, doc) => dis.createKeyDispatcher({ registry: keys, doc,
    context: () => ({ workspace: 'playground' }) }).keydown(e);
  assert.equal(run(ev('KeyQ', { isComposing: true }), docWith(null)), false, 'IME');
  assert.equal(run(ev('KeyQ'), docWith(el('INPUT'))), false, 'typing in a text field');
  assert.equal(run(ev('KeyQ'), docWith(el('TEXTAREA'))), false);
  assert.equal(run(ev('Space'), docWith(el('BUTTON'))), false, 'Space presses the button');
  assert.equal(run(ev('Space'), docWith(el('DIV', { role: 'slider' }))), false);
  assert.equal(run(ev('KeyQ'), docWith(el('BUTTON'))), true, 'a letter still reaches its owner');
  assert.equal(run(ev('KeyQ'), docWith(null, true)), false, 'an open modal owns the keys');
  assert.equal(run(ev('KeyW'), docWith(null)), false, 'nobody owns W');
  assert.equal(run(ev('KeyQ', { ctrlKey: true }), docWith(null)), false, 'Ctrl+Q is not Q');
  assert.equal(dis.focusOf(el('INPUT', { type: 'range' }), docWith(null)), 'control');
  assert.equal(dis.focusOf(el('INPUT', { type: 'search' }), docWith(null)), 'text');
  assert.equal(ran, 1);
});

function files(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? files(p) : (p.endsWith('.js') ? [p] : []);
  });
}

test('key listeners outside src/js/ui/keys/ only shrink (the ratchet)', () => {
  const base = JSON.parse(readFileSync(join(ROOT, 'tests/unit/key-listener-baseline.json'),
    'utf8')).counts;
  const js = /addEventListener\(\s*'key(?:down|up)'|\bonkey(?:down|up)\s*=/g;
  const now = {};
  for (const p of files('src/js')) {
    if (p.startsWith('src/js/ui/keys/')) continue;
    const n = (readFileSync(join(ROOT, p), 'utf8').match(js) || []).length;
    if (n) now[p] = n;
  }
  const html = (readFileSync(join(ROOT, 'src/index.html'), 'utf8')
    .match(/(?:@|x-on:)key(?:down|up)\b/g) || []).length;
  if (html) now['src/index.html'] = html;
  const grown = Object.entries(now).filter(([p, n]) => n > (base[p] || 0))
    .map(([p, n]) => `${p}: ${n} > ${base[p] || 0}`);
  assert.deepEqual(grown, [], 'a new key listener: bind it through src/js/ui/keys/ instead');
  const stale = Object.entries(base).filter(([p, n]) => (now[p] || 0) < n)
    .map(([p, n]) => `${p}: ${now[p] || 0} < ${n} (lower the baseline)`);
  assert.deepEqual(stale, [], 'a count fell: lower its entry in the same change');
});

test('the page keys bind through the registry: Escape everywhere, Space where the instrument owns it', async () => {
  const { bindPageKeys, pageKeyContext } = await import('../../src/js/ui/keys/clients.js')
    .catch(() => ({}));
  assert.equal(typeof bindPageKeys, 'function');
  const log = [];
  const cmp = { workspace: 'playground', synth: { tab: 'xy' },
    measureAbort: (why) => log.push(`abort ${why}`), onKeyDown: (e) => log.push(`down ${e.code}`),
    onKeyUp: (e) => log.push(`up ${e.code}`) };
  const keys = reg.createKeyRegistry();
  bindPageKeys({ keys, cmp, stopSequencer: () => log.push('stop sequencer') });
  const d = dis.createKeyDispatcher({ registry: keys, context: () => pageKeyContext(cmp) });
  const esc = ev('Escape');
  assert.equal(d.keydown(esc), true);
  assert.equal(esc.defaultPrevented, false, 'Escape keeps its default: a dialog still closes');
  d.keyup(ev('Escape'));
  assert.deepEqual(log.splice(0), ['stop sequencer', 'abort escape', 'down Escape']);
  const text = { tagName: 'INPUT', isContentEditable: false, getAttribute: () => 'text',
    closest: () => null };
  const inText = dis.createKeyDispatcher({ registry: keys, context: () => pageKeyContext(cmp),
    doc: { activeElement: text, body: {}, querySelector: () => null } });
  assert.equal(inText.keydown(ev('Escape')), true, 'Escape stops even from a text field');
  assert.equal(inText.keydown(ev('Space')), false, 'Space types into the text field');
  log.length = 0;
  const sp = ev('Space');
  assert.equal(d.keydown(sp), true);
  assert.equal(sp.defaultPrevented, true);
  d.keydown(ev('Space', { repeat: true }));
  d.keyup(ev('Space'));
  assert.deepEqual(log.splice(0), ['down Space', 'up Space'], 'one press, one release');
  for (const w of ['measure', 'studio', 'synth', 'about']) {
    cmp.workspace = w;
    assert.equal(d.keydown(ev('Space')), false, `${w}: Space is not the instrument's`);
  }
  assert.deepEqual(pageKeyContext(cmp), { workspace: 'about', view: null });
  cmp.workspace = 'synth';
  assert.deepEqual(pageKeyContext(cmp), { workspace: 'synth', view: 'xy' });
  assert.deepEqual(log, []);
});

test('focus "*" and prevent: false: a page-wide stop acts in any focus and keeps the default', () => {
  const keys = reg.createKeyRegistry();
  keys.bind({ id: 'stop', keys: ['Escape'], scope: { workspace: '*', focus: '*' },
    prevent: false, run: noop, label: 'Stop' });
  keys.bind({ id: 'dialog.esc', keys: ['Escape'], scope: { workspace: '*', focus: 'dialog' },
    run: noop, label: 'Close' });
  assert.equal(keys.resolve('Escape', { workspace: 'x', focus: 'text' }).id, 'stop');
  assert.equal(keys.resolve('Escape', { workspace: 'x', focus: 'dialog' }).id, 'dialog.esc',
    'an exact focus beats focus *');
  assert.equal(keys.list().find((b) => b.id === 'stop').prevent, false);
});
