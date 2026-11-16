// E074 (oscilla-c3's pinned race on #558): a Learn demo's deferred focus to Podržet a hrát
// applies only while nothing has moved since the demo ran. The race, step by step on a fake
// document: the demo runs, the notice is followed back to Learn, Back focuses the Playground
// heading, and only then the tick fires; the heading keeps the focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deferDemoFocus, demoFocusStillWanted } from '../../src/js/ui/learn-focus.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A node that may contain others. */
const node = (id, kids = []) => ({ id, kids, contains(x) {
  return x === this || this.kids.some((k) => k.contains(x));
} });

function fixture() {
  const demoButton = node('learn.demo');
  const learnView = node('osc-view-learn', [demoButton]);
  const hold = node('osc-hold-play');
  const heading = node('playground-h1');
  const notice = node('alert.action');
  const body = node('body', [learnView, hold, heading, notice]);
  const byId = { 'osc-view-learn': learnView, 'osc-hold-play': hold };
  const doc = { activeElement: demoButton, body, getElementById: (id) => byId[id] || null };
  const ticks = [];
  const app = { workspace: 'playground', $nextTick: (fn) => ticks.push(fn) };
  const focused = [];
  const focus = (el) => { focused.push(el); doc.activeElement = el; };
  return { demoButton, learnView, hold, heading, notice, body, doc, ticks, app, focused, focus };
}

test('nothing moved: the tick focuses Podržet a hrát', () => {
  const f = fixture();
  deferDemoFocus(f.app, f.focus, f.doc);
  f.ticks.forEach((t) => t());
  assert.deepEqual(f.focused, [f.hold]);
});

test('focus on the body or still inside the hidden Learn view: the tick still focuses it', () => {
  for (const where of ['body', 'learnView']) {
    const f = fixture();
    deferDemoFocus(f.app, f.focus, f.doc);
    f.doc.activeElement = f[where];
    f.ticks.forEach((t) => t());
    assert.deepEqual(f.focused, [f.hold], where);
  }
});

test('the race: notice followed to Learn, Back to the Playground heading, then the tick', () => {
  const f = fixture();
  deferDemoFocus(f.app, f.focus, f.doc);
  f.doc.activeElement = f.notice;
  f.app.workspace = 'learn';
  f.app.workspace = 'playground';
  f.doc.activeElement = f.heading;
  f.ticks.forEach((t) => t());
  assert.deepEqual(f.focused, [], 'the heading the router focused keeps the focus');
  assert.equal(f.doc.activeElement, f.heading);
});

test('another workspace when the tick fires: no focus', () => {
  const f = fixture();
  deferDemoFocus(f.app, f.focus, f.doc);
  f.app.workspace = 'learn';
  f.ticks.forEach((t) => t());
  assert.deepEqual(f.focused, []);
});

test('demoFocusStillWanted on its own', () => {
  const learnView = node('l', [node('b')]);
  const base = { workspaceThen: 'playground', workspaceNow: 'playground', before: null,
    body: null, learnView };
  assert.equal(demoFocusStillWanted({ ...base, active: null }), true);
  assert.equal(demoFocusStillWanted({ ...base, active: node('elsewhere') }), false);
  assert.equal(demoFocusStillWanted({ ...base, workspaceNow: 'learn', active: null }), false);
});

test('runLearnDemo defers its transport focus through deferDemoFocus, not a bare $nextTick', () => {
  const wb = readFileSync(`${ROOT}src/js/ui/workbench.js`, 'utf8');
  const body = wb.slice(wb.indexOf('runLearnDemo(topic) {'), wb.indexOf('learnToolFollowed('));
  assert.match(body, /if \(fromKeyboard\) deferDemoFocus\(this, focusSafely\);/);
  assert.doesNotMatch(body, /\$nextTick\(\(\) => focusSafely/);
});
