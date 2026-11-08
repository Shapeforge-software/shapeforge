import assert from 'node:assert/strict';
import { test } from 'node:test';
import { patternAt } from '../src/core/patterns';
import { createShape } from '../src/core/scene';
import { DEFAULT_MARK_MATERIAL, DEFAULT_PATTERN_MATERIAL } from '../src/core/shapes';
import type { Shape } from '../src/core/types';
import { voxelizeScene } from '../src/core/voxelize';

const floor = (pattern: number, extra: Record<string, number> = {}): Shape => {
  const s = createShape('box');
  return { ...s, position: [0, 0.25, 0], fill: 'filled', params: { ...s.params, width: 20, height: 0.5, depth: 20, pattern, ...extra } };
};
const share = (s: Shape) => { const v = voxelizeScene([s]); return v.filter((x) => x.materialItem === DEFAULT_PATTERN_MATERIAL).length / v.length; };

test('a pattern only recolours: the same blocks, some in the pattern material; None changes nothing', () => {
  const plain = voxelizeScene([floor(0)]);
  for (let k = 1; k <= 9; k++) {
    const v = voxelizeScene([floor(k)]);
    assert.equal(v.length, plain.length, `pattern ${k}`);
    const f = share(floor(k));
    assert.ok(f > 0.05 && f < 0.95, `pattern ${k}: ${f}`);
  }
  assert.equal(share(floor(0)), 0);
});

test('checkerboard and stripes split evenly; herringbone two-tone is half each way', () => {
  assert.ok(Math.abs(share(floor(1)) - 0.5) < 0.01);
  assert.ok(Math.abs(share(floor(2)) - 0.5) < 0.06);
  assert.ok(Math.abs(share(floor(8, { brickStyle: 0 })) - 0.5) < 0.06);
  // Squares of the asked size: a 4-block checker has runs of 4.
  const row = Array.from({ length: 16 }, (_, i) => patternAt({ pattern: 1, checkSize: 4 }, [i + 0.5, 0, 0.5], [10, 1, 10]));
  assert.deepEqual(row.map(Number).join(''), '0000111100001111');
});

test('herringbone bricks: each grid cell belongs to exactly one brick of the zigzag tiling', () => {
  // Lengthwise bricks cover (x0..x0+n-1, y0), upright ones (x0, y0+1..y0+n), from the lattice (1,1) and (n,-n).
  for (const n of [2, 3, 4]) {
    const owner = new Map<string, number>();
    let id = 0;
    for (let a = -20; a <= 20; a++) for (let b = -20; b <= 20; b++) {
      const x0 = a + n * b, y0 = a - n * b;
      id++;
      for (let i = 0; i < n; i++) { const k = `${x0 + i},${y0}`; assert.ok(!owner.has(k)); owner.set(k, id); }
      for (let j = 1; j <= n; j++) { const k = `${x0},${y0 + j}`; assert.ok(!owner.has(k)); owner.set(k, id); }
    }
    // And the rule the pattern uses agrees: lengthwise exactly where (x - y) mod 2n < n.
    for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) {
      assert.ok(owner.has(`${x},${y}`), 'covered');
      const two = patternAt({ pattern: 8, brickWidth: 1, brickRatio: n, brickStyle: 0 }, [x + 0.5, 0, y + 0.5], [50, 1, 50]);
      const lengthwise = owner.get(`${x},${y}`) === owner.get(`${x + 1},${y}`) || owner.get(`${x},${y}`) === owner.get(`${x - 1},${y}`);
      assert.equal(two, !lengthwise, `n ${n} at ${x},${y}`);
    }
  }
});

test('the maze is a real maze: every path cell reaches every other, with no loops', () => {
  const s = floor(6, { mazePath: 1 });
  const v = voxelizeScene([s]).filter((x) => x.materialItem !== DEFAULT_PATTERN_MATERIAL);
  const open = new Set(v.map((x) => `${x.i},${x.k}`));
  const start = [...open][0];
  const seen = new Set([start]), stack = [start];
  let edges = 0;
  while (stack.length) {
    const [i, k] = stack.pop()!.split(',').map(Number);
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = `${i + di},${k + dk}`;
      if (!open.has(n)) continue;
      edges++;
      if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  assert.equal(seen.size, open.size, 'all connected');
  assert.equal(edges / 2, open.size - 1, 'a tree: no loops');
  // Another variation, another maze.
  const other = voxelizeScene([floor(6, { mazePath: 1, mazeSeed: 2 })]).filter((x) => x.materialItem !== DEFAULT_PATTERN_MATERIAL);
  assert.notDeepEqual(new Set(other.map((x) => `${x.i},${x.k}`)), open);
});

test('flagstones: stones with joints between; bigger stones, fewer joints', () => {
  const small = share(floor(7, { stoneSize: 4 })), big = share(floor(7, { stoneSize: 12 }));
  assert.ok(small > big && big > 0.05, `${small} > ${big}`);
});

test('patterns go on any block shape, in its own plane; a die keeps its numbers over a pattern', () => {
  // A standing 2D disc: Auto lays the pattern on its face.
  const disc = createShape('ellipse');
  const d = { ...disc, position: [0, 6, 0] as [number, number, number], fill: 'filled' as const, params: { ...disc.params, orient: 1, pattern: 3 } };
  assert.ok(share(d) > 0.2 && share(d) < 0.8);
  // A polyhedron with numbers and a checkerboard: the numbers stay in their own material.
  const die = createShape('polyhedron');
  const both = { ...die, position: [0, 6, 0] as [number, number, number], fill: 'filled' as const, params: { ...die.params, solid: 1, height: 12, marks: 1, pattern: 1, checkSize: 4 } };
  const numbersOnly = { ...both, params: { ...both.params, pattern: 0 } };
  const marks = (s: Shape) => voxelizeScene([s]).filter((x) => x.materialItem === DEFAULT_MARK_MATERIAL).length;
  assert.equal(marks(both), marks(numbersOnly));
  assert.ok(share(both) > 0.05);
});

test('on a 3D shape the pattern is a skin: every face shows it, the inside stays plain; Top runs straight through', () => {
  const cube = (extra: Record<string, number>): Shape => {
    const s = createShape('box');
    return { ...s, position: [0, 3, 0], fill: 'filled', params: { ...s.params, width: 6, height: 6, depth: 6, pattern: 1, ...extra } };
  };
  const v = voxelizeScene([cube({})]);
  const lo = (a: 'i' | 'j' | 'k') => Math.min(...v.map((x) => x[a])), hi = (a: 'i' | 'j' | 'k') => Math.max(...v.map((x) => x[a]));
  const patterned = (x: { materialItem: number }) => x.materialItem === DEFAULT_PATTERN_MATERIAL;
  const inside = v.filter((x) => x.i > lo('i') && x.i < hi('i') && x.j > lo('j') && x.j < hi('j') && x.k > lo('k') && x.k < hi('k'));
  assert.equal(inside.filter(patterned).length, 0, 'the inside is plain');
  // Each face, away from its edges: half its blocks patterned, in a checkerboard on that face.
  for (const [a, at] of [['i', lo('i')], ['i', hi('i')], ['j', lo('j')], ['j', hi('j')], ['k', lo('k')], ['k', hi('k')]] as const) {
    const others = (['i', 'j', 'k'] as const).filter((b) => b !== a);
    const face = v.filter((x) => x[a] === at && others.every((b) => x[b] > lo(b) && x[b] < hi(b)));
    assert.ok(Math.abs(face.filter(patterned).length / face.length - 0.5) < 0.15, `face ${a}=${at}`);
  }
  // Depth 2: more patterned blocks, still a plain core.
  const deeper = voxelizeScene([cube({ patternDepth: 2 })]).filter(patterned).length;
  assert.ok(deeper > v.filter(patterned).length);
  // Top: runs down through the whole cube (the inside patterned too).
  const top = voxelizeScene([cube({ patternPlane: 1 })]);
  assert.ok(Math.abs(top.filter(patterned).length / top.length - 0.5) < 0.02);
});

test('swirl stripes run pole to pole round the shape, turning as they climb, covering their share of the surface', () => {
  const p = { pattern: 2, stripeDir: 4, swirlCount: 4, swirlTwist: 0.5, swirlShare: 25, swirlDir: 1 };
  const half: [number, number, number] = [10, 10, 10];
  // Round the middle at one height: a quarter of the way round in stripes (4 stripes of 25% of 1/4 turn).
  const ring = (y: number) => Array.from({ length: 720 }, (_, i) => { const a = (i / 720) * 2 * Math.PI; return patternAt(p, [8 * Math.cos(a), y, 8 * Math.sin(a)], half); });
  const share = ring(0).filter(Boolean).length / 720;
  assert.ok(Math.abs(share - 0.25) < 0.02, `${share}`);
  // Half a turn from bottom to top: the stripes at the top are where they were at the bottom, turned by half a turn.
  const bottom = ring(-10), top = ring(10);
  const turned = bottom.map((_, i) => bottom[(i + 360) % 720]);
  assert.ok(top.filter((x, i) => x === turned[i]).length / 720 > 0.97);
  // On a 3D shape it follows the skin: the same blocks, only the outside recoloured.
  const s = createShape('teardrop3d');
  const drop = { ...s, position: [0, 6, 0] as [number, number, number], fill: 'filled' as const, params: { ...s.params, width: 12, height: 12, pattern: 2, stripeDir: 4 } };
  const v = voxelizeScene([drop]);
  const plain = voxelizeScene([{ ...drop, params: { ...drop.params, pattern: 0 } }]);
  assert.equal(v.length, plain.length);
  const f = v.filter((x) => x.materialItem === DEFAULT_PATTERN_MATERIAL).length / v.length;
  assert.ok(f > 0.02 && f < 0.3, `${f}`);
});
