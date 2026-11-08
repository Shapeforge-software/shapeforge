import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBlueprint, writeBlueprint } from '../src/core/blueprint';
import { key, shapeCells, solidCells, unkey, voxelizeScene } from '../src/core/voxelize';
import type { Shape, Vec3 } from '../src/core/types';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function spheroid(over: Partial<Shape> & { radii?: Vec3 } = {}): Shape {
  const { radii = [3, 3, 3], ...rest } = over;
  return {
    id: 's', kind: 'spheroid', params: { rx: radii[0], ry: radii[1], rz: radii[2] }, position: [0, 0, 0], rotation: [0, 0, 0],
    fill: 'filled', wallThickness: 1, lineWeight: 'thick', materialItem: 1406367026, op: 'add', ...rest,
  };
}

const cellSet = (vs: { i: number; j: number; k: number }[]) => new Set(vs.map((v) => `${v.i},${v.j},${v.k}`));

test('reads test2 exactly as Embervale shows it (pos is the cube corner, rotation pivots there)', () => {
  const { voxels, skipped } = readBlueprint(fixture('test2.ebblueprint'));
  assert.equal(skipped, 0);
  assert.deepEqual(
    cellSet(voxels),
    new Set(['0,0,0', '0,0,-1', '0,0,-2', '0,0,-3', '1,0,1', '1,0,-1', '1,0,-3']),
  );
});

test('reads the circle file on one layer, Door Frames included (more detail in import.test.ts)', () => {
  const { voxels, skipped } = readBlueprint(fixture('circle_thick.ebblueprint'));
  assert.equal(skipped, 0);
  assert.equal(voxels.length, 188 + 4 * 8);
  assert.ok(voxels.every((v) => v.j === 0));
});

test('key and unkey round-trip, including negatives', () => {
  for (const c of [[0, 0, 0], [-5, 7, -1000], [1000, -1000, 3]] as Vec3[]) {
    assert.deepEqual(unkey(key(...c)), c);
  }
});

test('filled sphere has about the right volume and is symmetric', () => {
  const cells = [...solidCells(spheroid({ radii: [3, 3, 3] }))].map(unkey);
  const expected = (4 / 3) * Math.PI * 27 / 0.125;
  assert.ok(Math.abs(cells.length - expected) / expected < 0.05, `got ${cells.length}, expected about ${expected}`);
  const set = new Set(cells.map((c) => c.join(',')));
  for (const [i, j, k] of cells) assert.ok(set.has(`${-i - 1},${j},${k}`), 'mirror in x');
});

test('rotation turns a long spheroid from the x axis to the z axis', () => {
  const along = (rot: Vec3) => {
    const cs = [...solidCells(spheroid({ radii: [6, 1, 1], rotation: rot }))].map(unkey);
    const span = (a: number) => Math.max(...cs.map((c) => c[a])) - Math.min(...cs.map((c) => c[a]));
    return [span(0), span(2)];
  };
  const [x0, z0] = along([0, 0, 0]);
  const [x1, z1] = along([0, 90, 0]);
  assert.ok(x0 > z0 * 3 && z1 > x1 * 3);
});

/** Flood from outside the bounding box; returns true if it reaches the center cell. */
function leaks(shellCells: Set<number>, r: number, diagonal: boolean): boolean {
  const n = Math.ceil(r / 0.5) + 2;
  const steps: Vec3[] = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const d = Math.abs(a) + Math.abs(b) + Math.abs(c);
    if (d === 1 || (diagonal && d > 1)) steps.push([a, b, c]);
  }
  const seen = new Set<number>([key(-n, -n, -n)]);
  const queue: Vec3[] = [[-n, -n, -n]];
  const target = key(0, 0, 0);
  while (queue.length) {
    const [i, j, k] = queue.pop()!;
    for (const [a, b, c] of steps) {
      const p: Vec3 = [i + a, j + b, k + c];
      if (p.some((v) => v < -n || v > n)) continue;
      const kk = key(...p);
      if (seen.has(kk) || shellCells.has(kk)) continue;
      if (kk === target) return true;
      seen.add(kk);
      queue.push(p);
    }
  }
  return false;
}

test('thick walls are sealed even against diagonal moves; thin walls use fewer voxels', () => {
  const thick = shapeCells(spheroid({ radii: [4, 4, 4], fill: 'hollow', lineWeight: 'thick' }));
  const thin = shapeCells(spheroid({ radii: [4, 4, 4], fill: 'hollow', lineWeight: 'thin' }));
  assert.equal(leaks(thick, 4, true), false, 'thick shell must block diagonal leaks');
  assert.equal(leaks(thin, 4, false), false, 'thin shell must still block face-to-face leaks');
  assert.equal(leaks(thin, 4, true), true, 'thin shell has diagonal pinholes');
  assert.ok(thin.size < thick.size);
});

test('wall thickness adds layers', () => {
  const t1 = shapeCells(spheroid({ radii: [5, 5, 5], fill: 'hollow', wallThickness: 1 })).size;
  const t2 = shapeCells(spheroid({ radii: [5, 5, 5], fill: 'hollow', wallThickness: 2 })).size;
  // Measured as a straight-line distance: one more block of wall all round (the thick first layer is already a
  // little deeper where the surface is diagonal, since it also seals corners).
  assert.ok(t2 > t1 * 1.3, `${t1} -> ${t2}`);
  const thin = (t: number) => shapeCells(spheroid({ radii: [5, 5, 5], fill: 'hollow', wallThickness: t, lineWeight: 'thin' })).size;
  assert.ok(thin(2) > thin(1) * 1.8);
});

test('a wall is the same thickness whatever its slope: a tilted slab keeps a core as thick as an untilted one', () => {
  // A 4 m (8 block) slab, walls 3 blocks deep each side: a 2 block core, tilted or not (a diagonal step used to count as
  // one block, which made tilted walls about 1.4 times thicker and left no core at all).
  const slab = (rotation: Vec3) => ({ ...spheroid(), kind: 'box' as const, params: { width: 16, height: 16, depth: 4 }, rotation, fill: 'hollow' as const, wallThickness: 3, lineWeight: 'thin' as const });
  const solid = (s: Shape) => solidCells(s).size, wall = (s: Shape) => shapeCells(s).size;
  const coreShare = (r: Vec3) => { const s = slab(r); return (solid(s) - wall(s)) / solid(s); };
  const flatCore = coreShare([0, 0, 0]);
  assert.ok(flatCore > 0.15, `flat ${flatCore}`);
  for (const r of [[40, 0, 0], [30, 30, 0]] as Vec3[]) assert.ok(coreShare(r) > flatCore * 0.6, `${r}: ${coreShare(r)} vs ${flatCore}`);
});

test('subtract and intersect combine shapes', () => {
  const big = spheroid({ radii: [3, 3, 3] });
  const small = spheroid({ id: 'b', radii: [1.5, 1.5, 1.5], position: [3, 0, 0] });
  const add = voxelizeScene([big]).length;
  const sub = voxelizeScene([big, { ...small, op: 'subtract' }]).length;
  const both = voxelizeScene([big, { ...small, op: 'intersect' }]).length;
  assert.ok(sub < add && both > 0 && both + sub === add);
});

test('written blueprint matches Embervale layout and reads back to the same cells', () => {
  const voxels = voxelizeScene([spheroid({ radii: [2, 1.5, 2], fill: 'hollow' })]);
  const text = writeBlueprint(voxels, { name: 'unit "test"', created: '2026-11-02T00:00:00Z', id: 'a'.repeat(32) }, sha);
  const data = JSON.parse(text);
  const test2Keys = Object.keys(JSON.parse(fixture('test2.ebblueprint')));
  assert.deepEqual(Object.keys(data), test2Keys);
  assert.equal(data.name, 'unit "test"');
  assert.equal(data.pieces.length, voxels.length);
  const pieces = text.slice(text.indexOf('"pieces": ') + 10, text.lastIndexOf('\n}'));
  assert.equal(data.contentSha256, sha(pieces));
  for (const p of data.pieces) {
    assert.ok(p.pos.every((v: number) => v >= 0 && Number.isInteger(v * 2)));
    assert.deepEqual(p.rot, [0, 0, 0, 1]);
  }
  assert.ok(data.pieces.some((p: { pos: number[] }) => p.pos[1] === 0), 'lowest layer sits at y = 0');
  const back = readBlueprint(text).voxels;
  const shift = (vs: typeof voxels) => {
    const m = [Math.min(...vs.map((v) => v.i)), Math.min(...vs.map((v) => v.j)), Math.min(...vs.map((v) => v.k))];
    return cellSet(vs.map((v) => ({ i: v.i - m[0], j: v.j - m[1], k: v.k - m[2] })));
  };
  assert.deepEqual(shift(back), shift(voxels));
});

test('writing an empty scene is an error, not an empty file', () => {
  assert.throws(() => writeBlueprint([], { name: 'x', created: '', id: '' }, sha), /Nothing to export/);
});
