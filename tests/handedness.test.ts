import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readBlueprint, writeBlueprint } from '../src/core/blueprint';
import { flipRoofPiece, flipVoxels } from '../src/core/handedness';
import { PROJECT_FORMAT, parseProject, serializeProject } from '../src/core/project';
import { createImportedShape, createShape } from '../src/core/scene';
import { fromQuaternion, apply } from '../src/core/math';
import { YAW_QUATERNION, roofPieces } from '../src/core/roofs';
import type { Shape, Vec3, Voxel } from '../src/core/types';
import { voxelizeScene } from '../src/core/voxelize';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const meta = { name: 'flip', created: '2026-11-07T00:00:00Z', id: 'c'.repeat(32) };
const norm = (vs: Voxel[]) => {
  const m = [Math.min(...vs.map((v) => v.i)), Math.min(...vs.map((v) => v.j)), Math.min(...vs.map((v) => v.k))];
  return new Set(vs.map((v) => `${v.i - m[0]},${v.j - m[1]},${v.k - m[2]},${v.materialItem}`));
};

test('blocks: exported flipped along z, and read back flipped, give what ShapeForge showed', () => {
  // An L of blocks: lopsided, so a flip shows.
  const voxels: Voxel[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 1], [0, 0, 2], [0, 1, 2]].map(([i, j, k]) => ({ i, j, k, materialItem: 7 }));
  const text = writeBlueprint(voxels, meta, sha, { mirror: true });
  const raw = readBlueprint(text).voxels;
  assert.notDeepEqual(norm(raw), norm(voxels), 'the file holds the mirror image');
  assert.deepEqual(norm(raw), norm(flipVoxels(voxels)));
  assert.deepEqual(norm(readBlueprint(text, { mirror: true }).voxels), norm(voxels), 'read back as it was');
});

test('roof pieces flip into the same piece turned the flipped way, on the flipped box; twice is where they began', () => {
  const lopsided: Shape = { ...createShape('roofL'), position: [3, 2, -5] };
  const pieces = roofPieces(lopsided);
  assert.ok(pieces.length > 4 && new Set(pieces.map((p) => p.type.form)).size === 3, 'sides and both corners');
  for (const p of pieces) {
    const f = flipRoofPiece(p);
    assert.equal(f.type, p.type);
    assert.deepEqual([f.min[2], f.max[2]], [-p.max[2], -p.min[2]]);
    // The box from its pivot and turn is the flipped box.
    const m = fromQuaternion(YAW_QUATERNION[f.yaw]);
    const corners = [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].map((c) => apply(m, [a * f.type.size[0], b * f.type.size[1], c * f.type.size[2]]))));
    for (let ax = 0; ax < 3; ax++) {
      assert.ok(Math.abs(Math.min(...corners.map((c) => c[ax])) + f.pos[ax] - f.min[ax]) < 1e-6);
      assert.ok(Math.abs(Math.max(...corners.map((c) => c[ax])) + f.pos[ax] - f.max[ax]) < 1e-6);
    }
    const back = flipRoofPiece(f);
    assert.equal(back.yaw, p.yaw);
    for (let ax = 0; ax < 3; ax++) assert.ok(Math.abs(back.pos[ax] - p.pos[ax]) < 1e-6);
  }
});

test('the anchor block is flipped with the build, so it is still the block written first', () => {
  const voxels = voxelizeScene([{ ...createShape('box'), fill: 'filled', position: [0, 3, 0] }]);
  const v = voxels[3];
  const data = JSON.parse(writeBlueprint(voxels, meta, sha, { mirror: true, anchor: [v.i, v.j, v.k] }));
  const flipped = flipVoxels(voxels);
  const m = [Math.min(...flipped.map((x) => x.i)), Math.min(...flipped.map((x) => x.j)), Math.min(...flipped.map((x) => x.k))];
  assert.deepEqual(data.pieces[0].pos, [(v.i - m[0]) * 0.5, (v.j - m[1]) * 0.5, (-1 - v.k - m[2]) * 0.5]);
});

test('a project saved before the flip keeps its imported layers coming out in game as before', () => {
  const voxels: Voxel[] = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 0, 2]].map(([i, j, k]) => ({ i, j, k, materialItem: 9 }));
  const shape = createImportedShape('old', voxels);
  const text = serializeProject({ name: 'p', shapes: [shape] });
  const now = parseProject(text).shapes[0];
  const old = parseProject(text.replace('"version": 2', '"version": 1')).shapes[0];
  const cells = (s: Shape) => voxelizeScene([s]);
  assert.deepEqual(norm(cells(now)), norm(voxels));
  assert.deepEqual(norm(cells(old)), norm(flipVoxels(voxels)), 'old project: flipped once, so the flipped export matches the old one');
  assert.ok(PROJECT_FORMAT);
});
