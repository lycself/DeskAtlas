import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snappedDelta } from '../app/lib/seat-layout.ts';
const seat = { id: 'seat', type: 'seat', label: '1', x: 48, y: 48, width: 72, height: 48, rotation: 0 };
test('small drags return to the original grid coordinate', () => {
  assert.deepEqual(snappedDelta(seat, [seat], 53, 50, 960, 620), { x: 0, y: 0 });
});
test('group movement preserves imported offsets and snaps the anchor', () => {
  const imported = { ...seat, id: 'other', x: 153, y: 50 };
  const delta = snappedDelta(seat, [seat, imported], 73, 71, 960, 620);
  assert.deepEqual(delta, { x: 24, y: 24 });
  assert.equal((imported.x + delta.x) - (seat.x + delta.x), 105);
});
test('dragging beyond the room keeps the entire group inside', () => {
  const other = { ...seat, id: 'other', x: 156 };
  const delta = snappedDelta(seat, [seat, other], 2000, -20, 480, 320);
  assert.equal((seat.x + delta.x) % 12, 0);
  assert.ok(other.x + delta.x + other.width <= 480);
  assert.ok(seat.y + delta.y >= 0);
});
test('rotated seats respect their visible bounds', () => {
  const rotated = { ...seat, rotation: 90 };
  const delta = snappedDelta(rotated, [rotated], 0, 1000, 480, 320);
  assert.ok(rotated.x + delta.x - rotated.height >= 0);
  assert.ok(rotated.y + delta.y + rotated.width <= 320);
});
