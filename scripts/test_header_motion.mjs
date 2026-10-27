import assert from 'node:assert/strict';
import test from 'node:test';
import { HEADER_MOTION_MS, headerMotionFrames, headerShouldCompact } from '../app/lib/header-motion.ts';

const wide = { left: 40, top: 8, width: 1440, height: 72 };
const compact = { left: 150, top: 12, width: 1220, height: 60 };
const numbers = (frame) => frame.transform.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < .00001, `${actual} != ${expected}`);

test('trackpad movement around the old threshold does not repeatedly reverse the header', () => {
  let state = false, transitions = 0;
  for (const y of [0, 20, 25, 28, 25, 24, 23, 27, 18, 13, 12, 19, 25, 27]) {
    const next = headerShouldCompact(state, y);
    if (next !== state) transitions++;
    state = next;
  }
  assert.equal(transitions, 2);
  assert.equal(state, false);
  assert.equal(headerShouldCompact(true, -10), false);
});

test('glass starts at its old visual bounds and finishes exactly at the new bounds', () => {
  const frames = headerMotionFrames(wide, compact, true);
  const [x, y, sx, sy] = numbers(frames[0]);
  close(compact.left + x, wide.left); close(compact.top + y, wide.top);
  close(compact.width * sx, wide.width); close(compact.height * sy, wide.height);
  assert.deepEqual(numbers(frames.at(-1)), [0, 0, 1, 1]);
  assert.equal(frames[0].offset, 0); assert.equal(frames.at(-1).offset, 1);
});

test('foreground text moves without scaling, with a short and bounded spring tail', () => {
  const frames = headerMotionFrames(wide, compact);
  assert.ok(HEADER_MOTION_MS <= 500);
  assert.ok(frames.every((frame) => !frame.transform.includes('scale')));
  const progress = frames.map((frame) => 1 - numbers(frame)[0] / (wide.left - compact.left));
  assert.ok(progress.some((value) => value > 1), 'retain the small spring overshoot');
  assert.ok(progress.every((value) => value >= 0 && value < 1.01));
  assert.equal(progress.at(-1), 1);
});

test('reversing mid-transition starts from the current visual position without a jump', () => {
  const current = { left: 110, top: 10, width: 1300, height: 64 };
  const frame = headerMotionFrames(current, wide, true)[0];
  const [x, y, sx, sy] = numbers(frame);
  close(wide.left + x, current.left); close(wide.top + y, current.top);
  close(wide.width * sx, current.width); close(wide.height * sy, current.height);
});
