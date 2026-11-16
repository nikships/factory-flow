import test from 'node:test';
import assert from 'node:assert/strict';
import { DESKS, BEANBAGS, SEATS, DESK_BY_ID, nextFreeSeat, nearestFreeSeat } from '../src/shared/layout.js';
test('worker slots keep persisted desk and overflow ids without geometry', () => {
  assert.equal(DESKS.length, 16);
  assert.equal(BEANBAGS.length, 12);
  assert.equal(SEATS.length, 28);
  assert.equal(DESK_BY_ID.size, 28);
  assert.equal(SEATS[0].id, 'desk-1');
  assert.equal(SEATS[27].id, 'beanbag-12');
  for (const seat of SEATS) assert.deepEqual(Object.keys(seat).sort(), ['id', 'label']);
});
test('allocation respects occupied slots and prefers numbered desks before overflow', () => {
  const taken = new Set(['desk-1']);
  assert.equal(nextFreeSeat((id) => taken.has(id))?.id, 'desk-2');
  assert.equal(nearestFreeSeat('desk-9', (id) => id === 'desk-9')?.id, 'desk-8');
  for (const seat of DESKS) taken.add(seat.id);
  assert.equal(nextFreeSeat((id) => taken.has(id))?.id, 'beanbag-1');
  assert.equal(nearestFreeSeat('desk-9', (id) => taken.has(id))?.id, 'beanbag-1');
  assert.equal(
    nextFreeSeat(() => true),
    undefined,
  );
  assert.equal(
    nearestFreeSeat('desk-1', () => true),
    undefined,
  );
});
