import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snappedDelta, alignItems, itemBounds, moveItems, guidedDelta } from '../app/lib/seat-layout.ts';
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

test('alignment uses visible edges for rotated imported desks and preserves unselected fixtures', () => {
  const rotated = { ...seat, id: 'rotated', x: 180, y: 84, rotation: 90 };
  const wall = { ...seat, id: 'wall', type: 'wall', x: 30 };
  const result = alignItems([seat, rotated, wall], ['seat', 'rotated'], 'left');
  assert.equal(itemBounds(result[0]).left, itemBounds(result[1]).left);
  assert.equal(result[1].rotation, 90);
  assert.equal(result[2], wall);
  assert.equal(rotated.x, 180);
});

test('distribution creates equal free gaps for different sized desks while preserving endpoints', () => {
  const middle = { ...seat, id: 'middle', x: 210, width: 90 };
  const last = { ...seat, id: 'last', x: 480, width: 120 };
  const result = alignItems([seat, middle, last], ['seat', 'middle', 'last'], 'horizontal');
  const [a, b, c] = result.map(itemBounds);
  assert.equal(b.left - a.right, c.left - b.right);
  assert.equal(result[0].x, seat.x);
  assert.equal(result[2].x, last.x);
  assert.throws(() => alignItems([seat, { ...middle, x: 50 }, { ...last, x: 60 }], ['seat', 'middle', 'last'], 'horizontal'), /空间不足/);
});

test('keyboard movement clamps the entire selection without distorting imported offsets', () => {
  const other = { ...seat, id: 'other', x: 153, y: 50 };
  const result = moveItems([seat, other], ['seat', 'other'], -200, 1000, 480, 320);
  assert.equal(result[0].x, 0);
  assert.equal(result[1].x - result[0].x, 105);
  assert.equal(itemBounds(result[1]).bottom, 320);
});

test('dragging snaps to another desk off the grid and exposes a guide', () => {
  const reference = { ...seat, id: 'reference', x: 153, y: 180 };
  const result = guidedDelta(seat, [seat], [seat, reference], 149, 50, 960, 620, true, 7);
  assert.equal(seat.x + result.x, 153);
  assert.equal(result.guides.x, 153);
  const free = guidedDelta(seat, [seat], [reference], 149, 50, 960, 620, false, 0);
  assert.equal(seat.x + free.x, 149);
});
