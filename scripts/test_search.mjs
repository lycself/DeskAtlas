import assert from 'node:assert/strict';
import test from 'node:test';
import { fuzzyMatch, searchPublic, seatCodeQuery } from '../app/lib/search.ts';

const seat = (id, label, occupant, state = occupant ? 'occupied' : 'available') => ({
  id, type: 'seat', label, x: 0, y: 0, width: 72, height: 48, rotation: 0,
  seat: { id, code: label, admin_status: 'active', display_state: state, occupant },
});
const room = (id, name, majors, items, extra = {}) => ({
  id, name, major_names: majors, canvas_width: 960, canvas_height: 620, is_published: true, is_archived: false,
  items, seat_counts: { available: items.filter((item) => item.seat.display_state === 'available').length }, ...extra,
});
const rooms = [
  room(3, '301', ['软物质物理'], [seat('a1', '1', { name: '李晓明', adviser: '王强', major: '软物质物理' }), seat('a12', '12'), seat('a2', '2')]),
  room(4, '302', ['光学'], [seat('b1', '1', { name: '张三', adviser: '李明', major: '光学' })]),
  room(40, '翔安', [], [seat('v1', '翔安-1', { name: '陈一', adviser: '王强', major: '光学' })], { is_virtual: true }),
];

test('exact beats prefix beats contains beats gapped characters', () => {
  assert.equal(fuzzyMatch('301', '301').score, 0);
  assert.equal(fuzzyMatch('3011', '301').score < 2, true);
  assert.equal(Math.floor(fuzzyMatch('A301', '301').score), 2);
  const gapped = fuzzyMatch('软物质物理', '软理');
  assert.equal(Math.floor(gapped.score), 3);
  assert.deepEqual(gapped.ranges, [[0, 1], [4, 5]]);
});

test('full-width digits and letters match, and scattered characters do not', () => {
  assert.equal(fuzzyMatch('301', '３０１').score, 0);
  assert.equal(fuzzyMatch('ABC', 'abc').score, 0);
  assert.equal(fuzzyMatch('一二三四五六七八九十', '一十'), null);
  assert.deepEqual(fuzzyMatch('李晓明', '明').ranges, [[2, 3]]);
  assert.equal(fuzzyMatch('李晓明', '李明').score > 3, true);
  assert.equal(fuzzyMatch('李晓明', '张'), null);
  assert.equal(fuzzyMatch('442-1', '441'), null);
});

test('"room seat" queries name a seat the way the admin search does', () => {
  assert.equal(seatCodeQuery('301', '301 12'), '12');
  assert.equal(seatCodeQuery('301', '301-12'), '12');
  assert.equal(seatCodeQuery('301', '301号12号'), '12');
  assert.equal(seatCodeQuery('301', '302 12'), null);
  assert.equal(seatCodeQuery('301', '301'), null);
  const found = searchPublic(rooms, '301 1');
  assert.deepEqual(found.seats.map((hit) => hit.item.id), ['a1', 'a12']);
});

test('people are found by name, adviser and research centre, names first', () => {
  assert.deepEqual(searchPublic(rooms, '李明').people.map((hit) => [hit.item.id, hit.field]), [['b1', 'adviser'], ['a1', 'name']]);
  assert.deepEqual(searchPublic(rooms, '王强').people.map((hit) => hit.item.id), ['a1', 'v1']);
  const byCentre = searchPublic(rooms, '光学');
  assert.deepEqual(byCentre.majors.map((hit) => hit.name), ['光学']);
  assert.deepEqual(byCentre.rooms.map((hit) => [hit.room.name, hit.field]), [['302', 'detail']]);
});

test('rooms are found by name, gapped centre names find the centre, empty queries find nothing', () => {
  assert.deepEqual(searchPublic(rooms, '30').rooms.map((hit) => hit.room.name), ['301', '302']);
  assert.deepEqual(searchPublic(rooms, '软理').majors.map((hit) => hit.name), ['软物质物理']);
  assert.deepEqual(searchPublic(rooms, '  '), { seats: [], rooms: [], people: [], majors: [], peopleTotal: 0 });
});
