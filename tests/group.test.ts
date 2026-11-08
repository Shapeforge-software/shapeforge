import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupBounds, moveGroup, turnGroup } from '../src/core/group';
import { createShape } from '../src/core/scene';
import type { Shape, Vec3 } from '../src/core/types';
import { shapeCells } from '../src/core/voxelize';
import { unkey } from '../src/core/voxelize-keys';

const at = (kind: Parameters<typeof createShape>[0], position: Vec3, rotation: Vec3 = [0, 0, 0]): Shape => ({ ...createShape(kind), position, rotation });
/** All the blocks of several shapes, as sorted strings. */
const blocks = (shapes: Shape[]) => shapes.flatMap((s) => [...shapeCells(s)].map((n) => unkey(n).join(','))).sort();

test('moving a group moves every shape by the same amount', () => {
  const g = [at('box', [0, 3, 0]), at('cylinder', [10, 3, 4], [0, 30, 0])];
  const moved = moveGroup(g, [1.5, 0, -2]);
  assert.deepEqual(moved.map((s) => s.position), [[1.5, 3, -2], [11.5, 3, 2]]);
  assert.deepEqual(moved[1].rotation, [0, 30, 0]);
  const c0 = groupBounds(g).center, c1 = groupBounds(moved).center;
  assert.deepEqual(c1.map((v, a) => v - c0[a]), [1.5, 0, -2]);
});

test('turning a group a quarter turn turns its blocks as one piece', () => {
  const g = [at('box', [0, 3, 0]), at('cylinder', [8, 3, 2]), at('cone', [3, 3, -6], [0, 0, 20])];
  const pivot: Vec3 = [4, 3, -2];
  const turned = turnGroup(g, [0, 90, 0], pivot);
  // Each block of the group, turned 90° about y round the pivot (x, z) -> (z, -x) relative to it, lands on a block
  // of the turned group (on the 0.5 m grid with the pivot on a block corner, exactly).
  const before = new Set(blocks(g));
  const after = blocks(turned);
  const back = after.map((b) => {
    const [i, j, k] = b.split(',').map(Number);
    const c = [(i + 0.5) * 0.5 - pivot[0], (k + 0.5) * 0.5 - pivot[2]];
    // Undo the quarter turn: (x, z) -> (-z, x).
    const x = -c[1] + pivot[0], z = c[0] + pivot[2];
    return [Math.floor(x / 0.5), j, Math.floor(z / 0.5)].join(',');
  });
  const missing = back.filter((b) => !before.has(b)).length;
  assert.ok(missing <= after.length * 0.02, `${missing} of ${after.length} blocks don't line up`);
  assert.deepEqual(turned[0].rotation, [0, 90, 0]);
});

test('a turn and its reverse put a group back', () => {
  const g = [at('box', [1, 3, 2], [10, 20, 30]), at('cylinder', [-4, 5, 7], [0, 45, 0])];
  const pivot = groupBounds(g).center;
  const there = turnGroup(g, [0, 0, 35], pivot);
  const back = turnGroup(there, [0, 0, -35], pivot);
  back.forEach((s, i) => {
    s.position.forEach((v, a) => assert.ok(Math.abs(v - g[i].position[a]) < 1e-5));
    s.rotation.forEach((v, a) => assert.ok(Math.abs(v - g[i].rotation[a]) < 1e-4, `${s.rotation} vs ${g[i].rotation}`));
  });
});
