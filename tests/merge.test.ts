import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBlueprint, writeBlueprint } from '../src/core/blueprint';
import { mergeVoxels } from '../src/core/merge';
import { PIECE_BY_ID } from '../src/core/pieces';
import { createImportedShape, createShape } from '../src/core/scene';
import { SHAPE_LIST } from '../src/core/shapes';
import type { Shape, Voxel } from '../src/core/types';
import { voxelizeScene } from '../src/core/voxelize';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const meta = { name: 'merge test', created: '2026-11-02T00:00:00Z', id: 'a'.repeat(32) };
const STONE = 1406367026, WELL = 310129061, SNOW = 2541805223;

function normalized(vs: Voxel[]): string[] {
  const m = [Math.min(...vs.map((v) => v.i)), Math.min(...vs.map((v) => v.j)), Math.min(...vs.map((v) => v.k))];
  return vs.map((v) => `${v.i - m[0]},${v.j - m[1]},${v.k - m[2]},${v.materialItem}`).sort();
}

/** Exported with merging and no anchor block (see anchor.test.ts), so the pieces are only what merging makes. */
function exportAndRead(voxels: Voxel[]) {
  const text = writeBlueprint(voxels, meta, sha, { merge: true, anchor: null });
  const data = JSON.parse(text);
  const read = readBlueprint(text);
  return { data, read };
}

function assertExact(voxels: Voxel[], what: string) {
  const { read } = exportAndRead(voxels);
  assert.equal(read.skipped, 0, `${what}: unknown pieces`);
  assert.equal(read.voxels.length, voxels.length, `${what}: pieces overlap or leave gaps`);
  assert.deepEqual(normalized(read.voxels), normalized(voxels), `${what}: blocks differ after merging`);
}

const shape = (kind: Shape['kind'], over: Partial<Shape> = {}, params: Record<string, number> = {}): Shape => {
  const s = createShape(kind as never);
  return { ...s, ...over, params: { ...s.params, ...params } };
};

test('a solid 4 m cube becomes two 4m Foundations', () => {
  const voxels = voxelizeScene([shape('box', { fill: 'filled' }, { width: 4, height: 4, depth: 4 })]);
  const { data } = exportAndRead(voxels);
  assert.equal(data.pieces.length, 2);
  assert.ok(data.pieces.every((p: { blueprintId: number }) => PIECE_BY_ID.get(p.blueprintId)?.name === '4m Foundation'));
  assertExact(voxels, '4 m cube');
});

test('a flat 4 x 4 m slab is one 4m Ceiling, and a wall along z uses a turned Wide Wall', () => {
  const slab = voxelizeScene([shape('box', { fill: 'filled' }, { width: 4, height: 0.5, depth: 4 })]);
  assert.deepEqual(exportAndRead(slab).data.pieces.map((p: { blueprintId: number }) => PIECE_BY_ID.get(p.blueprintId)?.name), ['4m Ceiling']);
  const wall = voxelizeScene([shape('box', { fill: 'filled' }, { width: 0.5, height: 4, depth: 4 })]);
  const pieces = exportAndRead(wall).data.pieces;
  assert.equal(pieces.length, 1);
  assert.equal(PIECE_BY_ID.get(pieces[0].blueprintId)?.name, 'Wide Wall');
  assert.deepEqual(pieces[0].rot, [0, 0.707106769, 0, 0.707106769]);
  assertExact(wall, 'wall along z');
});

for (const def of SHAPE_LIST.filter((d) => !d.pieces)) {
  test(`${def.label}: merged export is block-for-block identical (filled, hollow, rotated)`, () => {
    for (const over of [{ fill: 'filled' }, { fill: 'hollow' }, { fill: 'filled', rotation: [20, 35, 10] }] as Partial<Shape>[]) {
      assertExact(voxelizeScene([shape(def.kind, over)]), `${def.kind} ${JSON.stringify(over)}`);
    }
  });
}

test('mixed materials never share a piece, and composites stay exact', () => {
  const scene: Shape[] = [
    shape('box', { fill: 'filled', materialItem: STONE }, { width: 8, height: 4, depth: 8 }),
    shape('box', { fill: 'filled', materialItem: WELL, position: [2, 2, 2] }, { width: 4, height: 4, depth: 4 }),
    shape('cylinder', { fill: 'hollow', materialItem: SNOW, position: [0, 6, 0] }),
    shape('box', { op: 'subtract', fill: 'filled', position: [0, 1, 3] }, { width: 2, height: 2, depth: 4 }),
  ];
  const voxels = voxelizeScene(scene);
  assertExact(voxels, 'composite');
  const pieces = mergeVoxels(voxels);
  const byCell = new Map(voxels.map((v) => [`${v.i},${v.j},${v.k}`, v.materialItem]));
  for (const p of pieces) {
    for (let a = 0; a < p.footprint[0]; a++) for (let b = 0; b < p.footprint[1]; b++) for (let c = 0; c < p.footprint[2]; c++) {
      assert.equal(byCell.get(`${p.min[0] + a},${p.min[1] + b},${p.min[2] + c}`), p.materialItem);
    }
  }
});

test('only safe pieces and orientations are ever written, with the right flags', () => {
  const big = voxelizeScene([
    shape('box', { fill: 'hollow' }, { width: 16, height: 10, depth: 12 }),
    shape('cylinder', { fill: 'filled', position: [10, 3, 0] }, { radius: 5, height: 6 }),
    shape('spheroid', { fill: 'hollow', position: [-10, 6, 0] }),
  ]);
  const { data } = exportAndRead(big);
  const allowed = new Set(['4m Foundation', 'Wide Wall', '4m Ceiling', 'Foundation', 'Narrow Wall', '4m Column', 'Wall', '2m Ceiling', '1m Wall Block', '2m Column', 'Single Wall Block']);
  const used = new Set<string>();
  for (const p of data.pieces) {
    const type = PIECE_BY_ID.get(p.blueprintId)!;
    used.add(type.name);
    assert.ok(allowed.has(type.name), `${type.name} is not in the merge set`);
    assert.equal(p.flag, type.flag);
    assert.ok(JSON.stringify(p.rot) === '[0,0,0,1]' || JSON.stringify(p.rot) === '[0,0.707106769,0,0.707106769]', 'rotation');
    assert.ok(p.pos.every((v: number) => v >= 0 && Number.isInteger(v * 2)));
  }
  assert.ok(used.size >= 5, `a varied build uses several piece types (${[...used].join(', ')})`);
  assert.ok(data.pieces.length < big.length / 3, `${big.length} blocks became ${data.pieces.length} pieces`);
  assertExact(big, 'big composite');
});

test('an imported blueprint (the circle, with its Door Frames) re-exports exactly without Door Frames', () => {
  const text = readFileSync(join(__dirname, 'fixtures', 'circle_thick.ebblueprint'), 'utf8');
  const voxels = voxelizeScene([createImportedShape('circle', readBlueprint(text).voxels)]);
  assertExact(voxels, 'circle');
  const { data } = exportAndRead(voxels);
  assert.ok(!data.pieces.some((p: { blueprintId: number }) => PIECE_BY_ID.get(p.blueprintId)?.name === 'Door Frame'));
});

test('merging off still writes plain cubes', () => {
  const voxels = voxelizeScene([shape('box', { fill: 'filled' }, { width: 4, height: 4, depth: 4 })]);
  const data = JSON.parse(writeBlueprint(voxels, meta, sha));
  assert.equal(data.pieces.length, 512);
});
