import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { MARKER_MATERIAL, autoAnchor, cleanLift, resolveAnchor } from '../src/core/anchor';
import { readBlueprint, writeBlueprint } from '../src/core/blueprint';
import { pickBlock } from '../src/core/pick';
import { parseProject, serializeProject } from '../src/core/project';
import { createShape } from '../src/core/scene';
import type { Shape, Vec3, Voxel } from '../src/core/types';
import { voxelizeScene } from '../src/core/voxelize';
import { key } from '../src/core/voxelize-keys';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const meta = { name: 'anchor test', created: '2026-11-07T00:00:00Z', id: 'b'.repeat(32) };
const box = (w: number, h: number, d: number, position: Vec3 = [0, 3, 0]): Shape =>
  ({ ...createShape('box'), position, fill: 'filled', params: { ...createShape('box').params, width: w, height: h, depth: d } });
const cells = (vs: Voxel[]) => new Set(vs.map((v) => `${v.i},${v.j},${v.k},${v.materialItem}`));
const shifted = (vs: Voxel[]) => {
  const m = [Math.min(...vs.map((v) => v.i)), Math.min(...vs.map((v) => v.j)), Math.min(...vs.map((v) => v.k))];
  return cells(vs.map((v) => ({ ...v, i: v.i - m[0], j: v.j - m[1], k: v.k - m[2] })));
};

test('by default the anchor is the lowest block nearest the middle of the footprint, written first on its own', () => {
  // A 4 m cube with a post hanging under one side: the lowest block is the post's foot.
  const voxels = voxelizeScene([box(4, 4, 4), box(0.5, 1, 0.5, [1.75, 0.5, 0.25])]);
  const a = autoAnchor(voxels)!;
  assert.equal(a.j, Math.min(...voxels.map((v) => v.j)));
  // Without the post: a block in the middle of the cube's bottom layer.
  const cube = voxelizeScene([box(4, 4, 4)]);
  const c = autoAnchor(cube)!;
  const lo = (f: (v: Voxel) => number) => Math.min(...cube.map(f)), hi = (f: (v: Voxel) => number) => Math.max(...cube.map(f));
  assert.equal(c.j, lo((v) => v.j));
  assert.ok(Math.abs(c.i - (lo((v) => v.i) + hi((v) => v.i)) / 2) <= 0.5 && Math.abs(c.k - (lo((v) => v.k) + hi((v) => v.k)) / 2) <= 0.5);
  // Exported with larger pieces, the first piece is that one block, and the blocks built are the same as before.
  const text = writeBlueprint(cube, meta, sha, { merge: true });
  const first = JSON.parse(text).pieces[0];
  assert.equal(first.blueprintId, 1986896347);
  const m = [lo((v) => v.i), lo((v) => v.j), lo((v) => v.k)];
  assert.deepEqual(first.pos, [(c.i - m[0]) * 0.5, (c.j - m[1]) * 0.5, (c.k - m[2]) * 0.5]);
  assert.deepEqual(shifted(readBlueprint(text).voxels), shifted(cube));
  // anchor null: no anchor block, merging alone.
  assert.equal(JSON.parse(writeBlueprint(cube, meta, sha, { merge: true, anchor: null })).pieces.length, 2);
});

test('a picked block of the build goes first; a picked empty cell gets a marker block, to delete after placing', () => {
  const voxels = voxelizeScene([box(2, 1, 2)]);
  const v = voxels[5];
  const own = resolveAnchor(voxels, [v.i, v.j, v.k])!;
  assert.deepEqual([own.marker, own.auto, own.materialItem], [false, false, v.materialItem]);
  const data = JSON.parse(writeBlueprint(voxels, meta, sha, { anchor: [v.i, v.j, v.k] }));
  assert.equal(data.pieces.length, voxels.length);
  assert.equal(data.pieces[0].materialItem, v.materialItem);
  // 2 m in front of the build, two blocks below it: one more block, first, in the marker material; everything
  // shifted so the marker is the lowest corner.
  const lowJ = Math.min(...voxels.map((x) => x.j)), lowK = Math.min(...voxels.map((x) => x.k));
  const cell: Vec3 = [v.i, lowJ - 2, lowK - 4];
  assert.equal(resolveAnchor(voxels, cell)!.marker, true);
  const marked = JSON.parse(writeBlueprint(voxels, meta, sha, { anchor: cell, merge: true }));
  assert.equal(marked.pieces[0].materialItem, MARKER_MATERIAL);
  assert.equal(marked.pieces[0].pos[1], 0);
  assert.equal(marked.pieces[0].pos[2], 0);
  const back = readBlueprint(JSON.stringify(marked)).voxels;
  assert.equal(back.length, voxels.length + 1);
  assert.equal(back.filter((x) => x.materialItem === MARKER_MATERIAL).length, 1);
});

test('lift is written in meters when not 0, and kept within bounds', () => {
  const voxels = voxelizeScene([box(1, 1, 1)]);
  assert.equal(JSON.parse(writeBlueprint(voxels, meta, sha, { lift: 2 })).lift, 2);
  assert.ok(!('lift' in JSON.parse(writeBlueprint(voxels, meta, sha, { lift: 0 }))));
  assert.equal(JSON.parse(writeBlueprint(voxels, meta, sha, { lift: -1.5 })).lift, -1.5);
  assert.equal(cleanLift(1e9), 100);
  assert.equal(cleanLift(0.04), 0);
  assert.equal(cleanLift('x'), 0);
});

test('a project keeps its anchor and lift; older projects have none', () => {
  const back = parseProject(serializeProject({ name: 'p', shapes: [box(1, 1, 1)], anchor: [3, -2, 7], lift: 1.5 }));
  assert.deepEqual(back.anchor, [3, -2, 7]);
  assert.equal(back.lift, 1.5);
  const old = parseProject(serializeProject({ name: 'p', shapes: [box(1, 1, 1)] }));
  assert.equal(old.anchor, null);
  assert.equal(old.lift, 0);
});

test('a click on a block finds it, and the empty cell in front of the face it hit', () => {
  const solid = new Set([key(4, 0, 0)]);
  const hit = pickBlock({ origin: [0.25, 0.25, 0.25], dir: [1, 0, 0] }, solid, [2, 0, 0], [2.5, 0.5, 0.5])!;
  assert.deepEqual(hit.cell, [4, 0, 0]);
  assert.deepEqual(hit.front, [3, 0, 0]);
  const top = pickBlock({ origin: [2.25, 10, 0.25], dir: [0, -1, 0] }, solid, [2, 0, 0], [2.5, 0.5, 0.5])!;
  assert.deepEqual(top.front, [4, 1, 0]);
  assert.equal(pickBlock({ origin: [0, 5, 0], dir: [1, 0, 0] }, solid, [2, 0, 0], [2.5, 0.5, 0.5]), null);
});
