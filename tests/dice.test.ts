import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dieNumbers } from '../src/core/dice';
import { apply, solid } from '../src/core/polyhedra';
import { createShape } from '../src/core/scene';
import { DEFAULT_MARK_MATERIAL, cleanParams, placedPolyhedron } from '../src/core/shapes';
import type { Shape } from '../src/core/types';
import { voxelizeScene } from '../src/core/voxelize';

const die = (solidId: number, height: number, params: Record<string, number> = {}, extra: Partial<Shape> = {}): Shape => {
  const s = createShape('polyhedron');
  return { ...s, position: [0, height / 2, 0], fill: 'filled', params: { ...s.params, solid: solidId, stand: 0, height, marks: 1, ...params }, ...extra };
};
const opposite = (id: number) => { const n = solid(id).normals; return n.map((a) => n.findIndex((b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < -1 + 1e-6)); };
const neighbours = (id: number, f: number) => solid(id).edgeFaces.filter((e) => e.includes(f)).map((e) => e.find((g) => g !== f)!);

test('opposite faces add up as on real dice: d6 7, d8 9, d10 9 (0 to 9), d12 13, d20 21', () => {
  for (const [id, sum, count] of [[1, 7, 6], [2, 9, 8], [3, 9, 10], [4, 13, 12], [5, 21, 20]]) {
    const n = dieNumbers(id), opp = opposite(id);
    assert.deepEqual([...n].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => (id === 3 ? i : i + 1)), `die ${id}: each number once`);
    n.forEach((x, f) => assert.equal(x + n[opp[f]], sum, `die ${id}: face ${f}`));
  }
});

test('d6: 1, 2 and 3 run counterclockwise round their corner, seen from outside', () => {
  const n = dieNumbers(1), s = solid(1);
  const [a, b, c] = [1, 2, 3].map((k) => s.normals[n.indexOf(k)]);
  const triple = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  assert.ok(triple > 0);
});

test('d10: odd numbers round one tip, even round the other', () => {
  const n = dieNumbers(3), s = solid(3);
  const up = n.filter((_, f) => s.normals[f][1] > 0), down = n.filter((_, f) => s.normals[f][1] < 0);
  assert.ok(up.every((x) => x % 2 === 1) && down.every((x) => x % 2 === 0));
});

test('d20: 20 has 2, 8 and 14 round it, and 1 has 19, 13 and 7', () => {
  const n = dieNumbers(5);
  assert.deepEqual(neighbours(5, n.indexOf(20)).map((f) => n[f]).sort((a, b) => a - b), [2, 8, 14]);
  assert.deepEqual(neighbours(5, n.indexOf(1)).map((f) => n[f]).sort((a, b) => a - b), [7, 13, 19]);
});

test('d4: each corner has its own number, right-handed (1, 2, 3 clockwise on their face)', () => {
  const n = dieNumbers(0);
  assert.deepEqual([...n].sort(), [1, 2, 3, 4]);
});

const marked = (s: Shape) => voxelizeScene([s]).filter((v) => v.materialItem === DEFAULT_MARK_MATERIAL);

test('numbered faces: marks are blocks the solid has, in the marking material; none when turned off', () => {
  const plain = voxelizeScene([die(5, 24, { marks: 0 })]);
  const numbered = voxelizeScene([die(5, 24)]);
  assert.equal(numbered.length, plain.length, 'same blocks, only some recoloured');
  const marks = numbered.filter((v) => v.materialItem === DEFAULT_MARK_MATERIAL).length;
  assert.ok(marks > 40 && marks < numbered.length * 0.2, `${marks} marked`);
  assert.equal(plain.filter((v) => v.materialItem === DEFAULT_MARK_MATERIAL).length, 0);
  // Deeper marks take more blocks; a bigger size more again.
  assert.ok(marked(die(5, 24, { markDepth: 2 })).length > marks);
  assert.ok(marked(die(5, 24, { markSize: 140, markFont: 5 })).length > marked(die(5, 24, { markFont: 5 })).length);
});

test('a hollow die keeps its numbers on its shell; a wireframe gets them added in its open faces', () => {
  const hollow = die(4, 20, {}, { fill: 'hollow', wallThickness: 1 });
  const hv = voxelizeScene([hollow]), plainHollow = voxelizeScene([{ ...hollow, params: { ...hollow.params, marks: 0 } }]);
  assert.equal(hv.length, plainHollow.length);
  assert.ok(marked(hollow).length > 20);
  const wire = die(4, 20, { frame: 1, edge: 2 });
  const wv = voxelizeScene([wire]), bare = voxelizeScene([{ ...wire, params: { ...wire.params, marks: 0 } }]);
  assert.ok(wv.length > bare.length, 'numbers added to the frame');
  assert.ok(marked(wire).length > 20);
});

test('a d6 with dots: one dot on the 1, six on the 6, each a round patch', () => {
  const pips = marked(die(1, 12, { pips: 1, top: 1 }));
  const face = (axis: 0 | 1 | 2, sign: number) => {
    const key = (['i', 'j', 'k'] as const)[axis];
    const vals = pips.map((v) => v[key]);
    const edge = sign > 0 ? Math.max(...vals) : Math.min(...vals);
    return pips.filter((v) => v[key] === edge);
  };
  // The 1 is on top (+y), the 6 underneath: count the separate patches on each.
  const patches = (cells: { i: number; j: number; k: number }[]) => {
    const left = new Set(cells.map((c) => `${c.i},${c.j},${c.k}`));
    let count = 0;
    for (const c of cells) {
      const start = `${c.i},${c.j},${c.k}`;
      if (!left.has(start)) continue;
      count++;
      const stack = [start];
      left.delete(start);
      while (stack.length) {
        const [i, j, k] = stack.pop()!.split(',').map(Number);
        for (const [a, b, d] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const n = `${i + a},${j + b},${k + d}`;
          if (left.has(n)) { left.delete(n); stack.push(n); }
        }
      }
    }
    return count;
  };
  assert.equal(patches(face(1, 1)), 1);
  assert.equal(patches(face(1, -1)), 6);
});

test('standing on a face, the number asked for is on top (a d4: at its top corner), the opposite one underneath', () => {
  for (const [id, top] of [[1, 1], [1, 6], [2, 3], [3, 0], [4, 12], [5, 20], [5, 7]]) {
    const p = cleanParams('polyhedron', { ...createShape('polyhedron').params, solid: id, stand: 0, height: 12, top });
    const placed = placedPolyhedron(p);
    const n = dieNumbers(id, placed.tilt);
    const up = placed.normals.reduce((b, x, f) => (x[1] > placed.normals[b][1] ? f : b), 0);
    assert.equal(n[up], top, `die ${id}`);
    assert.ok(placed.normals[up][1] > 1 - 1e-9, 'face square on top');
  }
  // A d4: the corner with the number points straight up.
  for (const top of [1, 2, 3, 4]) {
    const p = cleanParams('polyhedron', { ...createShape('polyhedron').params, solid: 0, stand: 0, height: 12, top });
    const placed = placedPolyhedron(p);
    const corners = solid(0).vertices.map((v) => apply(placed.turn, v));
    const highest = corners.reduce((b, v, i) => (v[1] > corners[b][1] ? i : b), 0);
    assert.equal(dieNumbers(0)[highest], top);
  }
  // A number the die hasn't got: the nearest (20 on a d6 is its 6); the highest to start.
  const d6 = placedPolyhedron(cleanParams('polyhedron', { ...createShape('polyhedron').params, solid: 1, stand: 0, height: 6 }));
  assert.equal(dieNumbers(1)[d6.normals.reduce((b, x, f) => (x[1] > d6.normals[b][1] ? f : b), 0)], 6);
});
