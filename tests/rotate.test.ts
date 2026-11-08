import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roofPieces, type RoofPiece } from '../src/core/roofs';
import { turnPoint, turnScene } from '../src/core/rotate';
import { createImportedShape, createShape } from '../src/core/scene';
import type { Shape, ShapeKind, Vec3 } from '../src/core/types';
import { voxelizeScene, worldBounds } from '../src/core/voxelize';

/** The build's middle on the grid, as turnScene finds it. */
function pivotOf(shapes: Shape[]): Vec3 {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) { const b = worldBounds(s); for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], b.min[a]); hi[a] = Math.max(hi[a], b.max[a]); } }
  return lo.map((v, a) => Math.round(((v + hi[a]) / 2) * 2) / 2) as Vec3;
}

/** Whether the turned build is exactly the build turned: every block and every roof piece. */
function sameTurned(shapes: Shape[], dir: 1 | -1): string {
  const pivot = pivotOf(shapes);
  const turned = turnScene(shapes, dir);
  const before = new Set(voxelizeScene(shapes).map((c) => {
    const p = turnPoint([(c.i + 0.5) * 0.5, 0, (c.k + 0.5) * 0.5], dir, pivot);
    return `${Math.floor(p[0] * 2)},${c.j},${Math.floor(p[2] * 2)},${c.materialItem}`;
  }));
  const after = new Set(voxelizeScene(turned).map((c) => `${c.i},${c.j},${c.k},${c.materialItem}`));
  const box = (q: RoofPiece, turn: boolean) => {
    const a = turn ? turnPoint(q.min, dir, pivot) : q.min, b = turn ? turnPoint(q.max, dir, pivot) : q.max;
    return `${q.type.blueprintId}|${q.materialItem}|${Math.min(a[0], b[0])},${q.min[1]},${Math.min(a[2], b[2])}|${Math.max(a[0], b[0])},${Math.max(a[2], b[2])}`;
  };
  const pb = new Set(shapes.flatMap(roofPieces).map((q) => box(q, true)));
  const pa = new Set(turned.flatMap(roofPieces).map((q) => box(q, false)));
  const diff = (x: Set<string>, y: Set<string>) => [...x].filter((k) => !y.has(k)).length;
  return `blocks ${diff(before, after) + diff(after, before)}, pieces ${diff(pb, pa) + diff(pa, pb)}`;
}

const make = (kind: ShapeKind, params: Record<string, number> = {}, over: Partial<Shape> = {}): Shape => {
  const s = createShape(kind);
  return { ...s, ...over, params: { ...s.params, ...params } };
};

test('turning the build a quarter turn turns every block and roof piece with it', () => {
  const cases: Shape[] = [
    make('box', {}, { rotation: [10, 20, 30], position: [2, 1, -3] }),
    make('cone', {}, { rotation: [30, 0, 45] }),
    make('helix'),
    make('roofShed', { facing: 90, double: 1, recede: 1, recedeEnds: 2 }, { position: [1.5, 3, -2] }),
    make('roofGable', { facing: 90, asym: 1, longSide: 1, recede: 1, double: 2, recedeEnds: 3, recedeEnds2: 2 }),
    make('roofGable', { asym: 2, angle: 33.3, ridgeOffset: 1.5, edging: 1, edgeSides: 1 }),
    make('roofHip', { facing: 90, asym: 1, longSide: 0, rows: 2 }),
    make('roofL', { facing: 270, aShift: 2, units: 1, aLen: 5 }, { position: [0.5, 2, 0.5] }),
    make('roofT', { facing: 180, lShift: 2, units: 1, edging: 1 }),
    make('roofCross', { units: 1, nxShift: 2, pzShift: -1.5, nxLen: 5, pxLen: 3.5, nzLen: 4, pzLen: 6, pzRows: 2, nxEnd: 1, pxAngle: 22.5 }),
    make('roofCross', { units: 1, nxShift: 2, pzShift: -2, nxLen: 5, pxLen: 4, nzLen: 4, pzLen: 6, double: 1, recede: 1 }),
  ];
  for (const dir of [1, -1] as const) for (const s of cases) assert.equal(sameTurned([s], dir), 'blocks 0, pieces 0', `${s.kind} ${JSON.stringify(s.params)} ${dir}`);
  // A whole build at once, imported layer included: turned around its middle.
  const layer = createImportedShape('steps', [{ i: 0, j: 0, k: 0, materialItem: 7 }, { i: 1, j: 0, k: 0, materialItem: 7 }, { i: 1, j: 1, k: 2, materialItem: 9 }]);
  // (A shape at an odd angle can differ by a block or two where a surface passes exactly through cell centers, since
  // ties are broken one fixed way; shapes at quarter turns are exact.)
  const build = [make('box', {}, { rotation: [0, 90, 0], position: [2, 1, -3] }), cases[4], cases[7], { ...layer, position: [5, 0, 5] as Vec3 }, cases[9]];
  for (const dir of [1, -1] as const) assert.equal(sameTurned(build, dir), 'blocks 0, pieces 0', `build ${dir}`);
});

test('four quarter turns bring the build back; turning one way and back undoes it', () => {
  const build = [make('roofGable', { facing: 90, asym: 1, longSide: 1, recedeEnds: 3, recede: 1, double: 1 }), make('roofCross', { units: 1, nxShift: 2, nxLen: 5 }), make('box', {}, { rotation: [10, 20, 30], position: [3, 0, 1] })];
  const key = (s: Shape[]) => JSON.stringify([voxelizeScene(s), s.flatMap(roofPieces).map((q) => [q.type.blueprintId, q.min, q.yaw])]);
  let s = build;
  for (let n = 0; n < 4; n++) s = turnScene(s, 1);
  assert.equal(key(s), key(build));
  assert.equal(key(turnScene(turnScene(build, 1), -1)), key(build));
  // Settings come back the same too (a gable's facing, saltbox side and world-told gable end).
  const back = turnScene(turnScene(build, -1), 1)[0].params;
  assert.deepEqual([back.facing, back.longSide, back.recedeEnds], [90, 1, 3]);
});
