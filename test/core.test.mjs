import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../src/core.js');

function stateFor(type) {
  let s = core.initialState();
  switch (type) {
    case 'headlamp':
      return core.setMain(s, 2);
    case 'high':
      return core.setBeam(core.setMain(s, 2), 'high');
    case 'low':
      return core.setMain(s, 2);
    case 'alternate':
      return core.flash(core.flash(core.setMain(s, 2)));
    case 'fog':
      s = core.setMain(s, 2);
      s = core.toggleFog(s);
      s = core.toggleHazard(s);
      return s;
    case 'stop':
      s = core.setMain(s, 1);
      s = core.toggleHazard(s);
      return s;
    default:
      throw new Error('unknown type ' + type);
  }
}

test('createExam: 5 items by default, headlamp first, no duplicates', () => {
  const exam = core.createExam();
  assert.equal(exam.length, 5);
  assert.equal(exam[0].id, 'headlamp');
  const ids = new Set(exam.map((q) => q.id));
  assert.equal(ids.size, exam.length);
  for (const q of exam) {
    assert.ok(q.text && q.op && q.tip);
    assert.ok(['headlamp', 'high', 'low', 'alternate', 'fog', 'stop'].includes(q.type));
  }
});

test('createExam: respects sceneCount and full bank', () => {
  assert.equal(core.createExam({ sceneCount: 12 }).length, 13);
  assert.equal(core.createExam({ sceneCount: 1 }).length, 2);
  assert.equal(core.createExam({ sceneCount: 99 }).length, 13);
});

test('createExam: deterministic with seeded rng', () => {
  let seed = 42;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const a = core.createExam({ sceneCount: 8, rng }).map((q) => q.id);
  seed = 42;
  const b = core.createExam({ sceneCount: 8, rng }).map((q) => q.id);
  assert.deepEqual(a, b);
});

test('every scene passes with its standard operation', () => {
  for (const q of [core.HEADLAMP, ...core.SCENES]) {
    const s = stateFor(q.type);
    const r = core.judge(q, s);
    assert.equal(r.pass, true, `${q.id} (${q.type}) should pass, got ${r.reason}`);
  }
});

test('fails when lights are off', () => {
  const off = core.initialState();
  for (const q of [core.HEADLAMP, ...core.SCENES]) {
    assert.equal(core.judge(q, off).pass, false, q.id + ' should fail with lights off');
  }
});

test('high beam question fails on low beam and vice versa', () => {
  const highQ = core.SCENES.find((q) => q.type === 'high');
  const lowQ = core.SCENES.find((q) => q.type === 'low');
  const low = core.setMain(core.initialState(), 2);
  const high = core.setBeam(core.setMain(core.initialState(), 2), 'high');
  assert.equal(core.judge(highQ, low).pass, false);
  assert.equal(core.judge(lowQ, high).pass, false);
});

test('alternate needs two flashes and final low beam', () => {
  const q = core.SCENES.find((q) => q.type === 'alternate');
  let s = core.setMain(core.initialState(), 2);
  assert.equal(core.judge(q, s).pass, false);
  s = core.flash(s);
  assert.equal(core.judge(q, s).pass, false);
  s = core.flash(s);
  assert.equal(core.judge(q, s).pass, true);

  let s2 = core.setMain(core.initialState(), 2);
  s2 = core.setBeam(s2, 'high');
  s2 = core.setBeam(s2, 'low');
  s2 = core.setBeam(s2, 'high');
  assert.equal(s2.flashes, 3);
  assert.equal(core.judge(q, s2).pass, false, 'ends on high beam should fail');
});

test('two manual beam switches also count as alternate', () => {
  const q = core.SCENES.find((q) => q.type === 'alternate');
  let s = core.setMain(core.initialState(), 2);
  s = core.setBeam(s, 'high');
  s = core.setBeam(s, 'low');
  assert.equal(s.flashes, 2);
  assert.equal(core.judge(q, s).pass, true);
});

test('fog requires fog + hazard + position/head lamp, and no high beam', () => {
  const q = core.SCENES.find((q) => q.type === 'fog');
  let s = core.setMain(core.initialState(), 2);
  s = core.toggleFog(s);
  assert.equal(core.judge(q, s).pass, false);
  s = core.toggleHazard(s);
  assert.equal(core.judge(q, s).pass, true);
  s = core.setBeam(s, 'high');
  assert.equal(core.judge(q, s).pass, false);
  s = core.setBeam(s, 'low');
  s = core.setMain(s, 0);
  assert.equal(core.judge(q, s).pass, false, 'should fail with lights off');
});

test('stop requires position lamps, not headlamps', () => {
  const q = core.SCENES.find((q) => q.type === 'stop');
  let s = core.setMain(core.initialState(), 1);
  assert.equal(core.judge(q, s).pass, false);
  s = core.toggleHazard(s);
  assert.equal(core.judge(q, s).pass, true);
  s = core.setMain(s, 2);
  assert.equal(core.judge(q, s).pass, false, 'headlamp instead of position lamp should fail');
});

test('setMain turns off fog and resets high beam', () => {
  let s = core.setBeam(core.setMain(core.initialState(), 2), 'high');
  s = core.toggleFog(s);
  s = core.setMain(s, 0);
  assert.equal(s.beam, 'low');
  assert.equal(s.fog, false);
});

test('fog cannot be enabled with lights off', () => {
  const s = core.toggleFog(core.initialState());
  assert.equal(s.fog, false);
});

test('stateText describes combinations', () => {
  let s = core.setBeam(core.setMain(core.initialState(), 2), 'high');
  s = core.toggleHazard(s);
  assert.equal(core.stateText(s), '远光灯 · 双闪');
  assert.equal(core.stateText(core.initialState()), '灯光关闭');
});

test('score computes points, pass and average time', () => {
  const r = core.score([
    { pass: true, elapsed: 1 },
    { pass: true, elapsed: 3 },
    { pass: false, elapsed: 5 },
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.correct, 2);
  assert.equal(r.points, 67);
  assert.equal(r.passed, false);
  assert.equal(r.avgTime, 3);
  const all = core.score([{ pass: true, elapsed: 2 }]);
  assert.equal(all.points, 100);
  assert.equal(all.passed, true);
});
