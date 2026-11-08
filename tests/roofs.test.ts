import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readBlueprint, writeBlueprint } from '../src/core/blueprint';
import { apply, fromQuaternion } from '../src/core/math';
import { parseProject, serializeProject } from '../src/core/project';
import { ROOF_ARMS, ROOF_SIDES, YAW_QUATERNION, armLegacyKeys, blockRoofOpenCuts, isJoinedKind, roofBounds, roofPieces, type RoofPiece } from '../src/core/roofs';
import { createShape } from '../src/core/scene';
import type { Shape, ShapeKind, Vec3 } from '../src/core/types';
import { voxelizeScene, worldBounds } from '../src/core/voxelize';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const meta = { name: 'roof test', created: '2026-11-02T00:00:00Z', id: 'b'.repeat(32) };
const RED_TILE = 196827131;

function roof(kind: import('../src/core/roofs').RoofKind, params: Record<string, number> = {}, over: Partial<Shape> = {}): Shape {
  const s = createShape(kind);
  // `ends` sets every arm end at once; keys for a single end override it.
  const ends = params.ends === undefined ? {} : Object.fromEntries(
    ['endX', 'endZ', 'endXNeg', 'endXPos', 'endZNeg', 'endZPos', 'endStem'].map((k) => [k, params.ends]));
  const all: Record<string, number> = { ...ends, ...params };
  // L, T and cross roofs: older shared keys (armX, rows, endX, height ...) set each arm's own setting, as they do
  // when an older project is opened.
  const arms: Record<string, number> = {};
  if (isJoinedKind(kind)) for (const arm of ROOF_ARMS[kind]) for (const field of ['Len', 'Rows', 'End', 'Height', 'Angle'] as const) {
    const from = armLegacyKeys(arm, field).find((k) => all[k] !== undefined);
    if (from !== undefined && all[arm.key + field] === undefined) arms[arm.key + field] = all[from];
  }
  return { ...s, ...over, params: { ...s.params, ...all, ...arms } };
}

const key = (pos: number[], rot: number[]) => `${pos.join(',')}|${rot.map((v) => Math.round(v * 1e6)).join(',')}`;

test('pieces turn the way Embervale showed (test_roof_direction)', () => {
  // Unrotated, the high side is at -x: a shed facing -x uses unturned pieces.
  assert.ok(roofPieces(roof('roofShed', { facing: 90 })).every((p) => p.yaw === 0));
  // Turned 90 degrees (0, 0.707, 0, 0.707), the high side is at +z: a shed facing +z uses those.
  assert.ok(roofPieces(roof('roofShed', { facing: 180 })).every((p) => p.yaw === 90));
  // The confirmed pivot: a y90 piece at pos (0,0,8) covers x 0..2, z 5.5..8.
  const turned = roofPieces(roof('roofShed', { facing: 180, length: 1 }))[0];
  assert.deepEqual(turned.max.map((v, a) => v - turned.min[a]), [2, 2.5, 2.5]);
  assert.deepEqual([turned.pos[0] - turned.min[0], turned.pos[2] - turned.min[2]], [0, 2.5]);
  const text = writeBlueprint([], meta, sha, { roofs: roofPieces(roof('roofGable', { length: 3 })) });
  assert.ok(JSON.parse(text).pieces.every((p: { flag: number; blueprintId: number }) => p.flag === 1 && p.blueprintId === ROOF_SIDES[2].blueprintId));
});

test('piece counts: a shed has length x rows pieces, a gable twice that', () => {
  assert.equal(roofPieces(roof('roofShed', { length: 4, rows: 2 })).length, 8);
  assert.equal(roofPieces(roof('roofGable', { length: 4, rows: 3 })).length, 24);
  assert.equal(roofPieces(roof('roofGable', { pieceSize: 4, length: 2, rows: 1 })).every((p) => p.type === ROOF_SIDES[4]), true);
});

/** World point at the middle of a piece's high edge (the top of its slope). */
function highEdge(p: RoofPiece): Vec3 {
  const m = fromQuaternion(YAW_QUATERNION[p.yaw]);
  const [, sy, sz] = p.type.size;
  return apply(m, [0, sy, sz / 2]).map((v, a) => v + p.pos[a]) as Vec3;
}
const center = (p: RoofPiece): Vec3 => p.min.map((v, a) => (v + p.max[a]) / 2) as Vec3;

test('shed facing: the high side is where the setting says', () => {
  const dirs: [number, number, number][] = [[0, 2, -1], [90, 0, -1], [180, 2, 1], [270, 0, 1]];
  for (const [facing, axis, sign] of dirs) {
    for (const p of roofPieces(roof('roofShed', { length: 2, rows: 1, facing }))) {
      const d = highEdge(p)[axis] - center(p)[axis];
      assert.ok(Math.sign(d) === sign, `facing ${facing}: high edge should be toward ${sign > 0 ? '+' : '-'}${'xyz'[axis]}`);
    }
  }
});

test('gable: both slopes rise to one ridge line, along x or z', () => {
  for (const [facing, ridgeAxis, crossAxis] of [[0, 0, 2], [90, 2, 0]]) {
    const pieces = roofPieces(roof('roofGable', { length: 3, rows: 2, facing }));
    const b = roofBounds(roof('roofGable', { length: 3, rows: 2, facing }));
    const ridge = (b.min[crossAxis] + b.max[crossAxis]) / 2;
    const top = pieces.filter((p) => p.min[1] === Math.max(...pieces.map((q) => q.min[1])));
    for (const p of top) assert.ok(Math.abs(highEdge(p)[crossAxis] - ridge) < 1e-6, 'top row meets at the ridge');
    const along = pieces.map((p) => p.max[ridgeAxis] - p.min[ridgeAxis]);
    assert.ok(along.every((v) => v === 2), 'pieces sit every 2 m along the ridge, without overlap');
    const steps = [...new Set(pieces.map((p) => p.min[ridgeAxis]))].sort((x, y) => x - y);
    assert.deepEqual(steps.map((v) => v - steps[0]), [0, 2, 4]);
  }
});

test('rows stack up the slope without gaps or overlaps', () => {
  const pieces = roofPieces(roof('roofShed', { length: 1, rows: 3, facing: 0 }));
  const rows = [...pieces].sort((a, b) => a.min[1] - b.min[1]);
  for (let k = 1; k < rows.length; k++) {
    assert.equal(rows[k].min[1], rows[k - 1].min[1] + 2, 'each row is 2 m higher');
    assert.equal(rows[k].min[2], rows[k - 1].min[2] - 2, 'and 2 m further toward the high side');
    assert.equal(rows[k].max[2], rows[k - 1].min[2] + 0.5, 'its 0.5 m eave lying over the row below');
  }
});

test('the roof box contains every piece, and the box is what the shape reports', () => {
  for (const kind of ['roofShed', 'roofGable'] as const) {
    for (const facing of kind === 'roofShed' ? [0, 90, 180, 270] : [0, 90]) {
      const s = roof(kind, { length: 3, rows: 2, facing, pieceSize: 4 }, { position: [1.25, 4, -3] });
      const b = worldBounds(s);
      for (const p of roofPieces(s)) for (let a = 0; a < 3; a++) {
        assert.ok(p.min[a] >= b.min[a] - 1e-9 && p.max[a] <= b.max[a] + 1e-9, `${kind} ${facing}: piece outside the box`);
        assert.ok(Number.isInteger(p.pos[a] * 2), 'pivots on the half-meter grid');
      }
      assert.equal(voxelizeScene([s]).length, 0, 'roofs add no blocks');
    }
  }
});

test('a roof exported with a building sits where it was placed', () => {
  const house = { ...createShape('box'), fill: 'filled' as const, params: { width: 6, height: 3, depth: 4 }, position: [0, 1.5, 0] as Vec3 };
  const top = roof('roofGable', { length: 3, rows: 1, facing: 0 }, { position: [0, 3 + 2.5 / 2, 0] });
  const text = writeBlueprint(voxelizeScene([house]), meta, sha, { roofs: roofPieces(top) });
  const data = JSON.parse(text);
  const roofs = data.pieces.filter((p: { blueprintId: number }) => p.blueprintId === ROOF_SIDES[2].blueprintId);
  assert.equal(roofs.length, 6);
  assert.ok(roofs.every((p: { pos: number[] }) => p.pos[1] === 3), 'roof pieces start on top of the 3 m walls');
  assert.ok(data.pieces.every((p: { pos: number[] }) => p.pos.every((v) => v >= -2.5)), 'nothing far below zero');
  const read = readBlueprint(text);
  assert.equal(read.skipped, 6, 'reading a blueprint back leaves roof pieces out (they are not blocks)');
});

test('roofs save and reopen in projects', () => {
  const s = roof('roofShed', { length: 5, rows: 2, facing: 270, pieceSize: 4 });
  const back = parseProject(serializeProject({ name: 'r', shapes: [s] })).shapes[0];
  assert.equal(back.kind, 'roofShed');
  assert.deepEqual(back.params, s.params);
  assert.deepEqual(roofPieces(back).map((p) => key(p.pos, YAW_QUATERNION[p.yaw])), roofPieces(s).map((p) => key(p.pos, YAW_QUATERNION[p.yaw])));
});

// --- Hip and pyramid roofs, checked against a hip end built by hand in game (rooftest_hip, 4 m pieces). ---
import { readFileSync as readFixture } from 'node:fs';
import { join as joinPath } from 'node:path';
import { ROOF_INNER_CORNERS, ROOF_OUTER_CORNERS, innerYaw, outerYaw, sideYaw } from '../src/core/roofs';

const recorded = JSON.parse(readFixture(joinPath(__dirname, 'fixtures', 'rooftest_hip.ebblueprint'), 'utf8')).pieces as
  { blueprintId: number; pos: number[]; rot: number[] }[];
const shiftKeys = (ps: { blueprintId: number; pos: number[]; rot: number[] }[]) => {
  const m = [0, 1, 2].map((a) => Math.min(...ps.map((p) => p.pos[a])));
  return ps.map((p) => `${p.blueprintId}@${key(p.pos.map((v, a) => v - m[a]), p.rot)}`).sort();
};

test('corner turns match the hand-built roof', () => {
  // Outer corners in the recording: unturned slopes down +x and -z; turned 90 slopes down -x and -z.
  assert.equal(outerYaw('+x', '-z'), 0);
  assert.equal(outerYaw('-z', '-x'), 90);
  // Inner corners: turned 90 slopes down +x and -z; turned 180 slopes down -x and -z.
  assert.equal(innerYaw('+x', '-z'), 90);
  assert.equal(innerYaw('-x', '-z'), 180);
  assert.equal(sideYaw('+x'), 0);
  assert.equal(sideYaw('-z'), 90, 'turned 90 the high side is +z, so it slopes down toward -z');
});

test('a hip roof end exports exactly like the hip end built in game', () => {
  const hip = roof('roofHip', { pieceSize: 4, length: 1, rows: 1, facing: 90 }, { materialItem: RED_TILE });
  const pieces = roofPieces(hip);
  assert.equal(pieces.length, 6, 'two sides and four corners');
  // Keep the sides and the corners at the -z end, like the recording (whose other end has valley corners).
  const sideZ = Math.min(...pieces.filter((p) => p.type.form === 'side').map((p) => p.min[2]));
  const kept = pieces.filter((p) => p.type.form === 'side' || p.max[2] <= sideZ);
  const end = JSON.parse(writeBlueprint([], meta, sha, { roofs: kept })).pieces as { blueprintId: number; pos: number[]; rot: number[] }[];
  const reference = recorded.filter((p) => p.blueprintId !== ROOF_INNER_CORNERS[4].blueprintId);
  assert.deepEqual(shiftKeys(end), shiftKeys(reference));
});

test('hip roofs: piece counts, pyramids, and every piece inside the box', () => {
  const count = (params: Record<string, number>) => {
    const ps = roofPieces(roof('roofHip', params));
    return { sides: ps.filter((p) => p.type.form === 'side').length, corners: ps.filter((p) => p.type.form === 'outer').length };
  };
  assert.deepEqual(count({ length: 0, rows: 1 }), { sides: 0, corners: 4 }, 'a one-row pyramid is four corners');
  assert.deepEqual(count({ length: 0, rows: 2 }), { sides: 8, corners: 8 });
  assert.deepEqual(count({ length: 3, rows: 2 }), { sides: 2 * 3 + 2 * 5 + 2 * 2, corners: 8 });
  assert.ok(roofPieces(roof('roofHip', { pieceSize: 4, length: 0 })).every((p) => p.type === ROOF_OUTER_CORNERS[4]));
  for (const facing of [0, 90]) for (const rows of [1, 3]) {
    const s = roof('roofHip', { length: 2, rows, facing }, { position: [0.5, 3, -1] });
    const b = worldBounds(s);
    const ps = roofPieces(s);
    for (const p of ps) for (let a = 0; a < 3; a++) {
      assert.ok(p.min[a] >= b.min[a] - 1e-9 && p.max[a] <= b.max[a] + 1e-9, 'piece inside the box');
      assert.ok(Number.isInteger(p.pos[a] * 2), 'pivot on the half-meter grid');
    }
    // No two pieces in the same row share ground: boxes only meet at their edges, except eaves over lower rows.
    for (const p of ps) for (const q of ps) if (p !== q && p.min[1] === q.min[1]) {
      const overlap = [0, 2].every((a) => Math.min(p.max[a], q.max[a]) - Math.max(p.min[a], q.min[a]) > 1e-9);
      assert.ok(!overlap, `facing ${facing}, rows ${rows}: pieces in one row overlap`);
    }
  }
});

test('hip slopes: every piece in a row is the same height, and a pyramid peaks in the middle', () => {
  const s = roof('roofHip', { length: 0, rows: 2 }, { position: [0, 2.5, 0] });
  const b = roofBounds(s);
  const top = roofPieces(s).filter((p) => p.min[1] === b.max[1] - 2.5);
  assert.equal(top.length, 4);
  const mid = [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2];
  for (const p of top) assert.ok(
    (p.min[0] === mid[0] || p.max[0] === mid[0]) && (p.min[2] === mid[1] || p.max[2] === mid[1]),
    'each top corner touches the center point');
});

// --- L, T and cross roofs, laid out by distance to the eaves. ---
import { wingLayout, type Wing } from '../src/core/roofs';

const boxKeys = (list: { type: { blueprintId: number }; yaw: number; min: number[] }[]) => {
  const m = [0, 1, 2].map((a) => Math.min(...list.map((b) => b.min[a])));
  return list.map((b) => `${b.type.blueprintId}/${b.yaw}@${b.min.map((v, a) => v - m[a]).join(',')}`).sort();
};

test('one wing laid out by distance matches the gable and hip roofs exactly', () => {
  for (const rows of [1, 2, 3]) for (const length of [1, 3]) for (const size of [2, 4] as const) {
    const gable: Wing = { x0: 0, x1: length, z0: 0, z1: 2 * rows, open: ['-x', '+x'] };
    assert.deepEqual(boxKeys(wingLayout([gable], rows, size).boxes),
      boxKeys(roofPieces(roof('roofGable', { rows, length, pieceSize: size }))), `gable rows ${rows} length ${length}`);
    const hip: Wing = { x0: 0, x1: length + 2 * rows, z0: 0, z1: 2 * rows, open: [] };
    assert.deepEqual(boxKeys(wingLayout([hip], rows, size).boxes),
      boxKeys(roofPieces(roof('roofHip', { rows, length, pieceSize: size }))), `hip rows ${rows} length ${length}`);
  }
});

test('a T roof with hip ends contains the hand-built roof: its stem, hip and two valley corners', () => {
  // The recording is the stem of a T (ridge along z, hip at its tip) running into a crossing ridge along x.
  const t = roof('roofT', { pieceSize: 4, rows: 1, armX: 2, stem: 2, ends: 1, facing: 180 }, { materialItem: RED_TILE });
  const pieces = roofPieces(t);
  const inner = pieces.filter((p) => p.type.form === 'inner');
  assert.equal(inner.length, 2, 'two valley corners where the stem meets the bar');
  const tipZ = Math.min(...pieces.map((p) => p.min[2]));
  const tip = pieces.filter((p) => p.min[2] === tipZ);
  const [x0, x1] = [Math.min(...tip.map((p) => p.min[0])), Math.max(...tip.map((p) => p.max[0]))];
  const ridgeZ = Math.max(...inner.map((p) => p.max[2]));
  const stem = pieces.filter((p) => p.min[0] >= x0 && p.max[0] <= x1 && p.max[2] <= ridgeZ);
  const written = JSON.parse(writeBlueprint([], meta, sha, { roofs: stem })).pieces;
  assert.deepEqual(shiftKeys(written), shiftKeys(recorded));
});

test('L, T and cross roofs: valleys and hips where expected, and every piece inside the box', () => {
  const forms = (kind: 'roofL' | 'roofT' | 'roofCross', params: Record<string, number>) => {
    const ps = roofPieces(roof(kind, params));
    return { side: ps.filter((p) => p.type.form === 'side').length, outer: ps.filter((p) => p.type.form === 'outer').length, inner: ps.filter((p) => p.type.form === 'inner').length };
  };
  // One row, gable ends: an L has one valley piece inside the bend and one hip piece outside it.
  assert.deepEqual(forms('roofL', { rows: 1, armX: 3, armZ: 3 }), { side: 14, outer: 1, inner: 1 });
  // A T has two valleys; a cross has four, meeting in the middle.
  assert.deepEqual(forms('roofT', { rows: 1, armX: 2, stem: 3 }), { side: 16, outer: 0, inner: 2 });
  assert.deepEqual(forms('roofCross', { rows: 1, armX: 2, armZ: 2 }), { side: 16, outer: 0, inner: 4 });
  // Hip ends add two Outer Corners per arm end (per row).
  assert.equal(forms('roofL', { rows: 1, armX: 3, armZ: 3, ends: 1 }).outer, 1 + 4);
  for (const kind of ['roofL', 'roofT', 'roofCross'] as const) for (const rows of [1, 2, 3]) for (const ends of [0, 1]) for (const facing of [0, 90, 180, 270]) {
    const s = roof(kind, { rows, ends, facing, armX: 3, armZ: 2, stem: 4 }, { position: [0.5, 5, -2] });
    const b = worldBounds(s);
    const ps = roofPieces(s);
    for (const p of ps) for (let a = 0; a < 3; a++) {
      assert.ok(p.min[a] >= b.min[a] - 1e-9 && p.max[a] <= b.max[a] + 1e-9, `${kind}: piece inside the box`);
      assert.ok(Number.isInteger(p.pos[a] * 2), 'pivot on the half-meter grid');
    }
    const heights = new Set(ps.map((p) => p.min[1]));
    assert.equal(heights.size, rows, `${kind} rows ${rows}: one height per row`);
  }
});

// --- Lengths in meters, and a gable or hip choice for each arm end. ---
import { cleanParams } from '../src/core/shapes';

const sizeOf = (s: Shape) => { const b = worldBounds(s); return b.max.map((v, a) => v - b.min[a]); };
const M = { units: 1 };

test('lengths in meters: whole pieces give the same roof as counting pieces', () => {
  for (const kind of ['roofShed', 'roofGable', 'roofHip'] as const) {
    const pieces = roof(kind, { length: 3, rows: 2 });
    const meters = roof(kind, { ...M, length: 6, rows: 2 });
    assert.deepEqual(boxKeys(roofPieces(meters)), boxKeys(roofPieces(pieces)), kind);
  }
  assert.deepEqual(boxKeys(roofPieces(roof('roofL', { ...M, armX: 8, armZ: 4, pieceSize: 4 }))),
    boxKeys(roofPieces(roof('roofL', { armX: 2, armZ: 1, pieceSize: 4 }))));
});

test('a 5 m gable: three pieces a side, the last slid back 1 m over its neighbor', () => {
  const s = roof('roofGable', { ...M, length: 5, rows: 1, facing: 0 });
  const ps = roofPieces(s);
  assert.equal(ps.length, 6);
  assert.equal(sizeOf(s)[0], 5, 'the roof is 5 m long');
  const xs = [...new Set(ps.map((p) => p.min[0] - worldBounds(s).min[0]))].sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 2, 3]);
});

test('part-piece lengths on every roof change the size by exactly the half meters given', () => {
  const cases: [import('../src/core/roofs').RoofKind, string, number][] = [
    ['roofShed', 'length', 0], ['roofGable', 'length', 0], ['roofHip', 'length', 0],
    ['roofL', 'armX', 0], ['roofL', 'armZ', 2], ['roofT', 'stem', 2], ['roofCross', 'armZ', 2], ['roofCross', 'armX', 0],
  ];
  for (const [kind, key, axis] of cases) for (const ends of [0, 1]) for (const rows of [1, 2]) {
    const base = { ...M, rows, ends, armX: 6, armZ: 6, stem: 6, length: 6, endX: ends, endZ: ends, endXNeg: ends, endXPos: ends, endZNeg: ends, endZPos: ends, endStem: ends };
    const whole = sizeOf(roof(kind, base))[axis];
    for (const less of [0.5, 1, 1.5]) {
      const s = roof(kind, { ...base, [key]: 6 - less });
      // The cross and T arms on both sides share one length, so they shrink twice.
      const twice = (kind === 'roofCross') || (kind === 'roofT' && key === 'armX') ? 2 : 1;
      assert.equal(sizeOf(s)[axis], whole - less * twice, `${kind} ${key} ${6 - less} m, ends ${ends}, rows ${rows}`);
      for (const p of roofPieces(s)) assert.ok(p.pos.every((v) => Number.isInteger(v * 2)), 'on the half-meter grid');
    }
  }
});

test('an end too short to slide back rounds up to whole pieces instead of reaching into the bend', () => {
  // Hip ends two rows deep need three cells to slide back; a 2.5 m arm of 2 m pieces has only two.
  const short = roof('roofL', { ...M, rows: 2, armX: 2.5, endX: 1, armZ: 4 });
  const whole = roof('roofL', { ...M, rows: 2, armX: 4, endX: 1, armZ: 4 });
  assert.deepEqual(sizeOf(short), sizeOf(whole));
});

test('each arm end can be a gable or a hip', () => {
  const outer = (s: Shape) => roofPieces(s).filter((p) => p.type.form === 'outer').length;
  // One row: a hip end adds two Outer Corners.
  assert.equal(outer(roof('roofT', { rows: 1, endXNeg: 1 })), 2);
  assert.equal(outer(roof('roofT', { rows: 1, endXNeg: 1, endStem: 1 })), 4);
  assert.equal(outer(roof('roofCross', { rows: 1, endZPos: 1 })), 2);
  assert.equal(outer(roof('roofL', { rows: 1, endZ: 1 })), 1 + 2, 'plus the hip outside the bend');
});

test('parameters: meters snap to half meters; a 0.10 roof\'s single ends choice seeds every end', () => {
  assert.equal(cleanParams('roofGable', { units: 1, length: 5.3 }).length, 5.5);
  assert.equal(cleanParams('roofGable', { units: 0, length: 5.3 }).length, 5);
  const old = cleanParams('roofT', { ends: 1 });
  assert.deepEqual([old.lEnd, old.rEnd, old.sEnd], [1, 1, 1]);
});

// --- Other roof angles, built from blocks. ---
import { blockRoofCells, roofSlope } from '../src/core/roofs';
import { mergeVoxels } from '../src/core/merge';

const KINDS = ['roofShed', 'roofGable', 'roofHip', 'roofL', 'roofT', 'roofCross'] as const;

/** A placed piece's top at a world ground point, or null off its ground. */
function topAt(q: RoofPiece, x: number, z: number): number | null {
  const r = YAW_QUATERNION[q.yaw];
  const inv = fromQuaternion([-r[0], -r[1], -r[2], r[3]]);
  const [lx, , lz] = apply(inv, [x - q.pos[0], 0, z - q.pos[2]]);
  const [sx, h, sz] = q.type.size;
  if (lx < -1e-6 || lz < -1e-6 || lx > sx + 1e-6 || lz > sz + 1e-6) return null;
  return q.pos[1] + (q.type.form === 'side' ? h - lx : q.type.form === 'outer' ? h - Math.max(lx, sx - lz) : h - Math.min(lx, lz));
}

/** How far each layer's pieces sit under the roof's top layer: the distances sampled (most common first). */
function layerOffsets(top: RoofPiece[], layer: RoofPiece[]): number[] {
  const count = new Map<number, number>();
  for (const q of layer) for (let x = q.min[0] + 0.125; x < q.max[0]; x += 0.25) for (let z = q.min[2] + 0.125; z < q.max[2]; z += 0.25) {
    const t = topAt(q, x, z);
    if (t === null) continue;
    const o = Math.max(...top.map((u) => topAt(u, x, z) ?? -Infinity));
    const d = Math.round((o - t) * 1000) / 1000;
    count.set(d, (count.get(d) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
}
const ANGLES = [22.5, 33.3, 67.5];

test('45 degrees uses roof pieces; other angles build blocks instead', () => {
  for (const kind of KINDS) {
    const pieces = roof(kind, { rows: 2 });
    assert.ok(roofPieces(pieces).length > 0 && voxelizeScene([pieces]).length === 0, `${kind} at 45`);
    for (const angle of ANGLES) {
      const blocks = roof(kind, { rows: 2, angle });
      const v = voxelizeScene([blocks]);
      assert.equal(roofPieces(blocks).length, 0, `${kind} at ${angle}: no roof pieces`);
      assert.ok(v.length > 0 && v.every((b) => b.materialItem === blocks.materialItem), `${kind} at ${angle}: blocks in the roof's material`);
    }
  }
});

test('the slope is the run times the angle\'s tangent, rounded to whole blocks', () => {
  for (const [rows, size, run] of [[1, 2, 4], [2, 2, 8], [3, 4, 24], [8, 4, 64]] as const) for (const angle of ANGLES) {
    const s = roofSlope(roof('roofGable', { rows, pieceSize: size, angle }))!;
    assert.equal(s.run, run, 'the run is the columns from the eave to the ridge');
    assert.equal(s.rise, Math.round(run * Math.tan((angle * Math.PI) / 180)));
    // A run of 64 blocks gets within half a degree.
    if (run === 64) assert.ok(Math.abs(s.degrees - angle) < 0.5, `${angle}: built at ${s.degrees}`);
  }
  assert.equal(roofSlope(roof('roofGable', {})), null, '45 degrees has no block slope');
});

/** Tops of the blocks along a gable's cross-section, eave to eave. */
function sectionTops(params: Record<string, number>): number[] {
  const cells = blockRoofCells(roof('roofGable', { length: 2, facing: 0, ...params }));
  const x = Math.min(...cells.map((c) => c[0]));
  const tops = new Map<number, number>();
  for (const [i, j, k] of cells) if (i === x) tops.set(k, Math.max(tops.get(k) ?? -Infinity, j));
  return [...tops.keys()].sort((a, b) => a - b).map((k) => tops.get(k)!);
}

test('steps are spread evenly up the slope, and both sides of a gable match', () => {
  for (const rows of [2, 3, 5]) for (const angle of ANGLES) {
    const tops = sectionTops({ rows, angle });
    assert.deepEqual(tops, [...tops].reverse(), `${angle}: symmetric`);
    const full = tops.slice(0, tops.length / 2);
    // The ridge: one column on each side, one block above the columns beside it (the game's ridge texture needs this).
    assert.equal(full[full.length - 1] - full[full.length - 2], 1, `${angle}, rows ${rows}: one-block step under the ridge`);
    assert.equal(tops[tops.length / 2], full[full.length - 1], 'the two ridge columns are level');
    // Below the ridge step, the rise of each column over the one before is always the same or one more (no bunching).
    const half = full.slice(0, -1);
    const base = half[0];
    const steps = half.slice(1).map((t, n) => t - half[n]);
    assert.ok(Math.max(...steps) - Math.min(...steps) <= 1, `${angle}, rows ${rows}: steps ${steps}`);
    // Flat runs (gentle slopes): the lengths of the stretches at each height differ by at most one, except the ridge's.
    if (angle < 45) {
      const runs: number[] = [];
      let count = 1;
      for (let n = 1; n < half.length; n++) if (half[n] === half[n - 1]) count++; else { runs.push(count); count = 1; }
      assert.ok(Math.max(...runs) - Math.min(...runs) <= 1, `${angle}, rows ${rows}: flat runs ${runs}`);
    }
    assert.equal(base, Math.min(...tops));
  }
});

test('block roofs have no see-through gaps: neighboring columns always share a face', () => {
  for (const kind of KINDS) for (const angle of ANGLES) {
    const cells = blockRoofCells(roof(kind, { rows: 2, angle, endZ: 1, endStem: 1 }));
    const range = new Map<string, [number, number]>();
    for (const [i, j, k] of cells) {
      const r = range.get(`${i},${k}`) ?? [Infinity, -Infinity];
      range.set(`${i},${k}`, [Math.min(r[0], j), Math.max(r[1], j)]);
    }
    for (const [col, [lo, hi]] of range) {
      const [i, k] = col.split(',').map(Number);
      for (const [di, dk] of [[1, 0], [0, 1]]) {
        const n = range.get(`${i + di},${k + dk}`);
        if (n) assert.ok(n[0] <= hi && lo <= n[1], `${kind} at ${angle}: columns ${col} and its neighbor don't touch`);
      }
    }
  }
});

test('a block roof covers the same plan as the same roof at 45 degrees, at every turn', () => {
  for (const kind of KINDS) for (const facing of [0, 90, 180, 270]) for (const angle of ANGLES) {
    const params = { rows: 2, facing, units: 1, length: 5.5, armX: 5.5, armZ: 4, stem: 4.5, endX: 1, endXPos: 1 };
    const at45 = roofPieces(roof(kind, params, { position: [0.5, 3, 1] }));
    const cells = blockRoofCells(roof(kind, { ...params, angle }, { position: [0.5, 3, 1] }));
    const span = (lo: number[], hi: number[]) => [lo[0], hi[0], lo[2], hi[2]];
    const plan45 = span([0, 2].map((a) => Math.min(...at45.map((p) => p.min[a]))).flatMap((v, n) => (n === 0 ? [v, 0] : [v])),
      [0, 2].map((a) => Math.max(...at45.map((p) => p.max[a]))).flatMap((v, n) => (n === 0 ? [v, 0] : [v])));
    const planBlocks = [
      Math.min(...cells.map((c) => c[0])) / 2, (Math.max(...cells.map((c) => c[0])) + 1) / 2,
      Math.min(...cells.map((c) => c[2])) / 2, (Math.max(...cells.map((c) => c[2])) + 1) / 2,
    ];
    assert.deepEqual(planBlocks, plan45, `${kind} turned ${facing} at ${angle}`);
  }
});

test('block roofs export and merge like any other blocks', () => {
  const s = roof('roofL', { rows: 2, angle: 33.3 });
  const voxels = voxelizeScene([s]);
  const merged = mergeVoxels(voxels);
  const covered = merged.reduce((n, p) => n + p.footprint[0] * p.footprint[1] * p.footprint[2], 0);
  assert.equal(covered, voxels.length);
  assert.ok(merged.length < voxels.length);
  const text = writeBlueprint(voxels, meta, sha, { merge: true, roofs: roofPieces(s) });
  assert.equal(readBlueprint(text).voxels.length, voxels.length);
});

// --- Set by height, saltbox and off-center ridges. ---
import { SHAPES } from '../src/core/shapes';

/** Highest block per column along a block gable's cross-section (z), relative to the lowest. */
function blockSection(params: Record<string, number>): number[] {
  const cells = blockRoofCells(roof('roofGable', { length: 1, facing: 0, ...params }));
  const x = Math.min(...cells.map((c) => c[0]));
  const tops = new Map<number, number>();
  for (const [i, j, k] of cells) if (i === x) tops.set(k, Math.max(tops.get(k) ?? -Infinity, j));
  const ks = [...tops.keys()].sort((a, b) => a - b);
  const lo = Math.min(...tops.values());
  return ks.map((k) => tops.get(k)! - lo);
}

test('set by height: the roof is exactly as tall as asked, on every roof shape', () => {
  for (const kind of KINDS) for (const height of [1, 2.5, 4, 7.5]) {
    const s = roof(kind, { rows: 2, angle: 0, height });
    assert.equal(sizeOf(s)[1], height, `${kind} at ${height} m`);
    assert.equal(roofPieces(s).length, 0);
  }
  const slope = roofSlope(roof('roofGable', { rows: 2, angle: 0, height: 3 }))!;
  assert.deepEqual([slope.rise, slope.run], [5, 8]);
});

test('saltbox gable with roof pieces: both slopes at 45 degrees, the long side extra rows lower', () => {
  for (const [rows, extra, longSide] of [[1, 1, 0], [2, 2, 1], [3, 1, 1]]) {
    const s = roof('roofGable', { rows, asym: 1, extraRows: extra, longSide, length: 2, facing: 0 });
    const ps = roofPieces(s);
    assert.ok(ps.every((p) => p.type.form === 'side'));
    const b = worldBounds(s);
    assert.equal(b.max[2] - b.min[2], (2 * rows + extra) * 2 + 1, 'wider by the extra rows');
    assert.equal(b.max[1] - b.min[1], (rows + extra) * 2 + 0.5, 'as tall as the long side');
    // Eaves: the lowest piece on each side.
    const towardPlus = ps.filter((p) => p.yaw === sideYaw('+z')), towardMinus = ps.filter((p) => p.yaw === sideYaw('-z'));
    const eave = (list: RoofPiece[]) => Math.min(...list.map((p) => p.min[1]));
    const [long, short] = longSide === 0 ? [towardPlus, towardMinus] : [towardMinus, towardPlus];
    assert.equal(eave(short) - eave(long), extra * 2, 'the long side\'s eave is the extra rows lower');
    assert.equal(long.length, (rows + extra) * 2);
  }
});

test('saltbox at block angles: same steps on both sides, entered higher on the short side', () => {
  for (const angle of ANGLES) {
    const tops = blockSection({ rows: 2, asym: 1, extraRows: 1, longSide: 1, angle });
    // -z (the start of the section) is the long side; its eave is the lowest point, the short side's is higher.
    assert.equal(tops[0], 0);
    assert.ok(tops[tops.length - 1] > 0, `${angle}: short side's eave is higher`);
    const ridge = tops.indexOf(Math.max(...tops));
    // The short side, read from the ridge down, matches the long side read from the ridge down.
    const down = (from: number, step: number, n: number) => Array.from({ length: n }, (_, m) => tops[from + step * m]);
    const shortLen = tops.length - ridge - 1;
    assert.deepEqual(down(ridge + 1, 1, shortLen), down(ridge, -1, shortLen), `${angle}: same steps`);
  }
});

test('off-center ridge: level eaves, the ridge moved by the offset, each side its own slope', () => {
  for (const offset of [-2, -0.5, 1, 3]) for (const angle of [45, 22.5, 0]) {
    const params = { rows: 2, asym: 2, ridgeOffset: offset, angle, height: 4 };
    const s = roof('roofGable', params);
    assert.equal(roofPieces(s).length, 0, 'built from blocks even at 45');
    const tops = blockSection(params);
    assert.equal(tops[0], 0); assert.equal(tops[tops.length - 1], 0, 'level eaves');
    const peak = Math.max(...tops);
    const first = tops.indexOf(peak);
    // Symmetric, the two ridge columns sit at the middle; the offset moves them 2 columns per meter toward +z.
    assert.equal(first, tops.length / 2 - 1 + offset * 2, `offset ${offset}`);
    assert.equal(tops[first + 1], peak, 'two ridge columns');
    assert.equal(peak - tops[first - 1], 1); assert.equal(peak - tops[first + 2], 1, 'one-block steps under the ridge');
    const sl = roofSlope(s)!;
    assert.ok(sl.other && sl.other.run < sl.run, 'the short side is reported too');
  }
});

test('saltbox hips build cleanly with pieces and blocks', () => {
  for (const angle of [45, 33.3, 67.5]) for (const longSide of [0, 1]) for (const facing of [0, 90]) {
    const s = roof('roofHip', { rows: 2, length: 2, asym: 1, extraRows: 2, longSide, angle, facing }, { position: [0.5, 4, 0] });
    const b = worldBounds(s);
    if (angle === 45) {
      const ps = roofPieces(s);
      assert.ok(ps.length > 0);
      for (const p of ps) for (let a = 0; a < 3; a++) assert.ok(p.min[a] >= b.min[a] - 1e-9 && p.max[a] <= b.max[a] + 1e-9);
      assert.ok(ps.filter((p) => p.type.form === 'outer').length >= 4, 'hips on the corners');
    } else {
      const cells = blockRoofCells(s);
      assert.ok(cells.length > 0);
      assert.equal((Math.max(...cells.map((c) => c[1])) + 1) / 2 - b.min[1], b.max[1] - b.min[1]);
    }
  }
  // Off-center ridges are gables only: a hip ignores the setting.
  assert.deepEqual(boxKeys(roofPieces(roof('roofHip', { asym: 2 }))), boxKeys(roofPieces(roof('roofHip', {}))));
});

test('the editor always shows roof height, and saltbox and offset fields only when they apply', () => {
  const visible = (kind: 'roofGable' | 'roofHip' | 'roofL', params: Record<string, number>) =>
    SHAPES[kind].params.filter((p) => !p.showIf || p.showIf(params)).map((p) => p.key);
  assert.ok(!visible('roofGable', { angle: 45, asym: 0 }).some((k) => ['extraRows', 'longSide', 'ridgeOffset'].includes(k)));
  // Roof height is always shown (typing one switches the roof to "set by height").
  for (const kind of KINDS) {
    const keys = visible(kind as 'roofGable', { angle: 45 });
    assert.ok(isJoinedKind(kind) ? ROOF_ARMS[kind].every((a) => keys.includes(`${a.key}Height`)) : keys.includes('height'), kind);
  }
  assert.deepEqual(visible('roofGable', { asym: 1 }).filter((k) => ['extraRows', 'longSide', 'ridgeOffset'].includes(k)), ['extraRows', 'longSide']);
  assert.deepEqual(visible('roofGable', { asym: 2 }).filter((k) => ['extraRows', 'longSide', 'ridgeOffset'].includes(k)), ['ridgeOffset']);
  assert.ok(!SHAPES.roofHip.params.find((p) => p.key === 'asym')!.choices!.some((c) => c.value === 2), 'no off-center hips');
  assert.ok(!SHAPES.roofL.params.some((p) => p.key === 'asym'), 'L, T and cross roofs set each arm instead');
});

test('asymmetric and set-by-height block roofs have no see-through gaps either', () => {
  const configs: [import('../src/core/roofs').RoofKind, Record<string, number>][] = [
    ['roofGable', { asym: 2, ridgeOffset: 3, angle: 67.5 }], ['roofGable', { asym: 2, ridgeOffset: -2.5, angle: 0, height: 9 }],
    ['roofGable', { asym: 1, extraRows: 2, angle: 22.5 }], ['roofHip', { asym: 1, extraRows: 3, angle: 67.5 }],
    ['roofCross', { angle: 0, height: 12 }], ['roofL', { angle: 0, height: 1.5, rows: 3 }],
  ];
  for (const [kind, params] of configs) {
    const cells = blockRoofCells(roof(kind, { rows: 2, ...params }));
    const range = new Map<string, [number, number]>();
    for (const [i, j, k] of cells) {
      const r = range.get(`${i},${k}`) ?? [Infinity, -Infinity];
      range.set(`${i},${k}`, [Math.min(r[0], j), Math.max(r[1], j)]);
    }
    for (const [col, [lo, hi]] of range) {
      const [i, k] = col.split(',').map(Number);
      for (const [di, dk] of [[1, 0], [0, 1]]) {
        const n = range.get(`${i + di},${k + dk}`);
        if (n) assert.ok(n[0] <= hi && lo <= n[1], `${kind} ${JSON.stringify(params)}: gap at ${col}`);
      }
    }
  }
});

// --- L, T and cross roofs: each arm its own length, width, height, offset and end (0.14). ---
import { armSizes, isBlockRoof } from '../src/core/roofs';

const span = (ps: RoofPiece[], a: number) => [Math.min(...ps.map((p) => p.min[a])), Math.max(...ps.map((p) => p.max[a]))];

test('each arm has its own length', () => {
  const short = roofPieces(roof('roofT', { lLen: 1, rLen: 1, sLen: 3, facing: 0 }));
  const long = roofPieces(roof('roofT', { lLen: 1, rLen: 4, sLen: 3, facing: 0 }));
  const width = (ps: RoofPiece[]) => span(ps, 0)[1] - span(ps, 0)[0];
  assert.equal(width(long) - width(short), 3 * 2, 'only the +x arm grew, by 3 pieces');
  const cross = roofPieces(roof('roofCross', { nxLen: 1, pxLen: 2, nzLen: 3, pzLen: 4 }));
  assert.equal(span(cross, 2)[1] - span(cross, 2)[0], (3 + 4) * 2 + 4, 'z arms 3 and 4 pieces past a 4 m junction');
});

test('arms of different widths at 45 degrees stay roof pieces, each ridge as high as its own width', () => {
  const s = roof('roofT', { lRows: 2, rRows: 2, sRows: 1, lLen: 2, rLen: 2, sLen: 3, facing: 0 }, { position: [0, 10, 0] });
  assert.ok(!isBlockRoof(s));
  const ps = roofPieces(s);
  assert.ok(ps.some((p) => p.type.form === 'inner'), 'valleys where the narrow stem meets the bar');
  // The stem's tip: the pieces furthest along +z, which belong to the stem alone.
  const tipZ = span(ps, 2)[1];
  const stemTop = Math.max(...ps.filter((p) => p.max[2] === tipZ).map((p) => p.max[1]));
  const barTop = Math.max(...ps.map((p) => p.max[1]));
  assert.equal(barTop - stemTop, 2, 'the 1-row stem\'s ridge is a row (2 m) below the 2-row bar\'s');
  assert.deepEqual(armSizes(s).map((a) => a.height), [4.5, 4.5, 2.5]);
});

test('offsets slide an arm sideways; off the piece grid, the roof is built from blocks', () => {
  // The cross's +z arm slides along the x arms (a T's stem has no offset).
  const centered = roofPieces(roof('roofCross', { pzLen: 3, nxLen: 3, pxLen: 3, facing: 0 }));
  const moved = roofPieces(roof('roofCross', { pzLen: 3, nxLen: 3, pxLen: 3, pzOff: 1, facing: 0 }));
  const tipCenter = (ps: RoofPiece[]) => { const z = span(ps, 2)[1]; const tip = ps.filter((p) => p.max[2] === z); return (span(tip, 0)[0] + span(tip, 0)[1]) / 2 - span(ps, 0)[0]; };
  assert.equal(tipCenter(moved) - tipCenter(centered), 2, 'one piece (2 m) toward +x');
  const room = { units: 1, nxLen: 6, pxLen: 6 };
  assert.ok(!isBlockRoof(roof('roofCross', { ...room, pzShift: 2 })), '2 m is a whole 2 m piece');
  assert.ok(isBlockRoof(roof('roofCross', { ...room, pzShift: 1.5 })), '1.5 m is not');
  assert.ok(isBlockRoof(roof('roofCross', { ...room, pzShift: 2, pieceSize: 4 })), '2 m is not a whole 4 m piece');
});

test('set by height: each arm rises to its own height', () => {
  const s = roof('roofL', { angle: 0, units: 1, aHeight: 3, bHeight: 6, aWidth: 6, bWidth: 9, aLen: 4, bLen: 4, facing: 0 }, { position: [0, 10, 0] });
  const cells = blockRoofCells(s);
  const base = Math.min(...cells.map((c) => c[1]));
  const top = (filter: (c: number[]) => boolean) => (Math.max(...cells.filter(filter).map((c) => c[1])) - base + 1) / 2;
  assert.equal(top(() => true), 6, 'the roof is as tall as its taller arm');
  // Arm 1 runs toward -x: its tip, the westmost columns, belongs to it alone.
  const x0 = Math.min(...cells.map((c) => c[0]));
  assert.equal(top((c) => c[0] <= x0 + 3), 3, 'arm 1 rises to its own 3 m');
  assert.deepEqual(armSizes(s).map((a) => [a.width, a.height]), [[6, 3], [9, 6]]);
});

test('arms of every kind, size and offset build without errors, inside the box, with no gaps in blocks', () => {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  for (let t = 0; t < 120; t++) {
    const kind = (['roofL', 'roofT', 'roofCross'] as const)[rnd(3)];
    const params: Record<string, number> = { facing: [0, 90, 180, 270][rnd(4)], pieceSize: rnd(4) === 0 ? 4 : 2 };
    const block = rnd(3) === 0;
    if (block) Object.assign(params, { angle: [22.5, 33.3, 67.5, 0][rnd(4)], units: 1 });
    for (const arm of ROOF_ARMS[kind]) {
      params[`${arm.key}Len`] = block ? 1 + rnd(12) / 2 : 1 + rnd(4);
      params[`${arm.key}Rows`] = 1 + rnd(3);
      params[`${arm.key}Off`] = block ? (rnd(9) - 4) / 2 : rnd(5) - 2;
      params[`${arm.key}End`] = rnd(2);
      if (block) { params[`${arm.key}Width`] = 3 + rnd(14) / 2; params[`${arm.key}Height`] = 1 + rnd(16) / 2; }
    }
    const s = roof(kind, params, { position: [0.5, 6, -1] });
    const b = worldBounds(s);
    if (!isBlockRoof(s)) {
      for (const p of roofPieces(s)) for (let a = 0; a < 3; a++) assert.ok(p.min[a] >= b.min[a] - 1e-9 && p.max[a] <= b.max[a] + 1e-9, `${kind} ${JSON.stringify(params)}`);
      continue;
    }
    const cells = blockRoofCells(s);
    assert.ok(cells.length > 0);
    const range = new Map<string, [number, number]>();
    for (const [i, j, k] of cells) {
      assert.ok(i / 2 >= b.min[0] - 1e-9 && (i + 1) / 2 <= b.max[0] + 1e-9 && k / 2 >= b.min[2] - 1e-9 && (k + 1) / 2 <= b.max[2] + 1e-9, 'inside the box');
      const r = range.get(`${i},${k}`) ?? [Infinity, -Infinity];
      range.set(`${i},${k}`, [Math.min(r[0], j), Math.max(r[1], j)]);
    }
    // Where an arm ends beside a lower one its end is left open (a gable to fill), not a gap.
    const cuts = blockRoofOpenCuts(s);
    for (const [col, [lo, hi]] of range) {
      const [i, k] = col.split(',').map(Number);
      for (const [di, dk] of [[1, 0], [0, 1]]) {
        const other = `${i + di},${k + dk}`;
        if (cuts.has(`${col}|${other}`) || cuts.has(`${other}|${col}`)) continue;
        const n = range.get(other);
        if (n) assert.ok(n[0] <= hi && lo <= n[1], `${kind} ${JSON.stringify(params)}: gap at ${col}`);
      }
    }
  }
});

test('the editor groups settings by arm, with width in rows for roof pieces and meters for blocks', () => {
  const keys = (params: Record<string, number>) => SHAPES.roofT.params.filter((p) => !p.showIf || p.showIf(params)).map((p) => p.key);
  const pieces = keys(roof('roofT').params);
  for (const a of ['l', 'r', 's']) for (const f of ['Angle', 'Len', 'Rows', 'Height', 'Shift', 'End']) {
    if (a === 's' && f === 'Shift') continue; // the stem has no offset
    assert.ok(pieces.includes(a + f), a + f);
  }
  assert.ok(!pieces.some((k) => k.endsWith('Width')));
  const blocks = keys(roof('roofT', { angle: 22.5 }).params);
  assert.ok(blocks.includes('sWidth') && !blocks.includes('sRows'));
  assert.deepEqual([...new Set(SHAPES.roofCross.params.map((p) => p.group).filter(Boolean))], ['-x arm', '+x arm', '-z arm', '+z arm']);
  // Projects saved before 0.14 open with their shared settings copied to every arm.
  const old = cleanParams('roofT', { rows: 2, armX: 3, stem: 5, endXNeg: 1, angle: 0, height: 6 });
  assert.deepEqual([old.lRows, old.rRows, old.sRows, old.lLen, old.rLen, old.sLen, old.lEnd, old.rEnd, old.sEnd, old.lHeight], [2, 2, 2, 3, 3, 5, 1, 0, 0, 6]);
  assert.equal(old.lWidth, undefined, 'width is left to the rows until edited');
});

test('the editor can say why an L, T or cross roof is built from blocks', async () => {
  const { joinedBlockReason } = await import('../src/core/roofs');
  assert.equal(joinedBlockReason(roof('roofT', {})), null);
  assert.equal(joinedBlockReason(roof('roofT', { angle: 22.5 })), 'angle');
  assert.equal(joinedBlockReason(roof('roofT', { units: 1, sLen: 6, lShift: 1 })), 'offset');
  // Arms of 1 to 3 rows, two of them offset, meeting where the pieces can't make the junction.
  assert.equal(joinedBlockReason(roof('roofCross', { nxLen: 2, nxRows: 1, nxEnd: 1, pxLen: 2, pxRows: 3, nzLen: 2, nzRows: 2, nzEnd: 1, pzLen: 1, pzRows: 2, pzShift: 2 })), 'junction');
});

test('an arm only changes its own half of the roof: offsetting one leaves the far side as it was', () => {
  // Roof pieces and blocks; the far half is everything past the junction's center, away from the moved arm.
  const farHalf = (params: Record<string, number>, kind: 'roofCross' | 'roofT') => {
    const s = roof(kind, { facing: 0, ...params }, { position: [0, 10, 0] });
    // The junction's center: the middle of the +z arm (or the T's stem) at its tip, which nothing here moves.
    if (!isBlockRoof(s)) {
      const ps = roofPieces(s);
      const tipZ = span(ps, 2)[1];
      const tip = ps.filter((p) => p.max[2] === tipZ);
      const mid = (span(tip, 0)[0] + span(tip, 0)[1]) / 2;
      const far = ps.filter((p) => p.min[0] >= mid);
      const m = [mid, Math.min(...far.map((p) => p.min[1])), Math.min(...far.map((p) => p.min[2]))];
      return far.map((p) => `${p.type.blueprintId}/${p.yaw}@${p.pos.map((v, a) => v - m[a]).join(',')}`).sort();
    }
    const cells = blockRoofCells(s);
    const tipK = Math.max(...cells.map((c) => c[2]));
    const tipXs = cells.filter((c) => c[2] === tipK).map((c) => c[0]);
    const mid = (Math.min(...tipXs) + Math.max(...tipXs) + 1) / 2;
    // The far half's surface (each column's top block), wherever the roof's box puts it. (How far down a column
    // is filled can follow its neighbor across the line, to keep the roof free of gaps; that isn't seen from above.)
    const tops = new Map<string, number[]>();
    for (const c of cells) if (c[0] >= mid) { const k = `${c[0]},${c[2]}`; const t = tops.get(k); if (!t || c[1] > t[1]) tops.set(k, c); }
    const far = [...tops.values()];
    const m = [0, 1, 2].map((a) => Math.min(...far.map((c) => c[a])));
    return far.map((c) => c.map((v, a) => v - m[a]).join(',')).sort();
  };
  for (const kind of ['roofCross', 'roofT'] as const) {
    const key = kind === 'roofCross' ? 'nxOff' : 'lOff';
    const lenKey = kind === 'roofCross' ? 'nxLen' : 'lLen';
    // Keep the overall box the same width so "the far half" is the same ground in both: the -x arm is long enough.
    for (const extra of [{}, { angle: 33.3 }] as Record<string, number>[]) {
      const base = farHalf({ [lenKey]: 3, ...extra }, kind);
      for (const off of [1, -1]) assert.deepEqual(farHalf({ [lenKey]: 3, [key]: off, ...extra }, kind), base, `${kind} ${JSON.stringify(extra)} offset ${off}`);
    }
  }
});

test('offsets are always in meters, and an arm slides no further than the arms it joins are long', async () => {
  const { armShiftLimits } = await import('../src/core/roofs');
  const shift = SHAPES.roofCross.params.find((p) => p.key === 'nxShift')!;
  assert.equal(shift.unit, 'm');
  assert.ok(!shift.length, 'not converted with "Lengths in"');
  // Cross: the -x arm slides along the z arms until its outer edge (eave included, 2.5 m from its center) is flush
  // with their ends, which lie 2 m (the junction) plus their length out (2 m pieces).
  assert.deepEqual(armShiftLimits('roofCross', { nzLen: 2, pzLen: 3 }, 0), { min: -3.5, max: 5.5 });
  assert.deepEqual(armShiftLimits('roofCross', { units: 1, nzLen: 2.5, pzLen: 7 }, 0), { min: -2, max: 6.5 });
  // L: arm 1 slides along arm 2 (which runs +z), never past the outside corner.
  assert.deepEqual(armShiftLimits('roofL', { bLen: 3 }, 0), { min: 0, max: 5.5 });
  // T: a bar arm slides along the stem, never past the bar's far side (the case that showed it: -5 m).
  assert.deepEqual(armShiftLimits('roofT', { sLen: 3 }, 0), { min: 0, max: 5.5 }, 'flush with the stem\'s end (the case that showed it: 6 went 0.5 m past)');
  assert.deepEqual(armShiftLimits('roofT', { sLen: 3, lRows: 2 }, 0), { min: 0, max: 5.5 }, 'a wider arm, a wider junction');
  assert.equal(cleanParams('roofT', { sLen: 3, lShift: -5 }).lShift, 0);
  // L arm 2 slides along arm 1, which runs toward -x: negative offsets only.
  assert.deepEqual(armShiftLimits('roofL', { aLen: 2 }, 1), { min: -3.5, max: 0 });
  // T: the stem doesn't slide.
  assert.deepEqual(armShiftLimits('roofT', { lLen: 1, rLen: 4 }, 2), { min: 0, max: 0 });
  // Saved values are limited, and negative offsets are fine.
  assert.equal(cleanParams('roofCross', { nzLen: 2, nxShift: -2.5 }).nxShift, -2.5);
  assert.equal(cleanParams('roofCross', { nzLen: 2, nxShift: -9 }).nxShift, -3.5);
  // Projects saved by 0.14.0 to 0.14.5 kept offsets (Off) in the length unit: pieces convert to meters.
  assert.equal(cleanParams('roofCross', { units: 0, pieceSize: 2, nzLen: 3, nxOff: -2 }).nxShift, -4);
  assert.equal(cleanParams('roofCross', { units: 1, nxOff: 1.5 }).nxShift, 1.5);
  assert.equal(cleanParams('roofCross', {}).nxShift, undefined, 'unset until edited');
});

test('no roof piece pokes out above the pieces it overlaps, however the arms are offset', () => {
  // A piece's top surface at a point of its box (in its own frame: side, hip or valley), and whether the point is
  // on the piece's own ground or on the 0.5 m eave it hangs over its downhill neighbors; null outside it.
  const surface = (p: RoofPiece, wx: number, wz: number): { top: number; eave: boolean } | null => {
    const q = YAW_QUATERNION[p.yaw];
    const inv = fromQuaternion([-q[0], -q[1], -q[2], q[3]]);
    const [x, , z] = apply(inv, [wx - p.pos[0], 0, wz - p.pos[2]]);
    const [sx, h, sz] = p.type.size;
    if (x < 1e-6 || z < 1e-6 || x > sx - 1e-6 || z > sz - 1e-6) return null;
    const run = p.type.run;
    const t = p.type.form === 'side' ? h - x : p.type.form === 'outer' ? h - Math.max(x, sx - z) : h - Math.min(x, z);
    // Downhill: a side and both corners toward +x; an Outer Corner also toward -z, an Inner Corner toward +z.
    const eave = x > run || (p.type.form === 'outer' && z < sz - run) || (p.type.form === 'inner' && z > run);
    return { top: t + p.min[1], eave };
  };
  let seed = 11;
  const rnd = (n: number) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  let checked = 0;
  for (let t = 0; t < 60; t++) {
    const kind = (['roofL', 'roofT', 'roofCross'] as const)[t % 3];
    const params: Record<string, number> = {};
    for (const arm of ROOF_ARMS[kind]) {
      params[`${arm.key}Off`] = rnd(5) - 2;
      params[`${arm.key}Len`] = 1 + rnd(3);
      params[`${arm.key}Rows`] = 1 + rnd(2);
      params[`${arm.key}End`] = rnd(2);
    }
    const s = roof(kind, params, { position: [0, 8, 0] });
    if (isBlockRoof(s)) continue;
    checked++;
    const ps = roofPieces(s);
    const [x0, x1] = span(ps, 0), [z0, z1] = span(ps, 2);
    for (let x = x0 + 0.125; x < x1; x += 0.25) for (let z = z0 + 0.125; z < z1; z += 0.25) {
      const here = ps.map((p) => surface(p, x, z)).filter((v): v is { top: number; eave: boolean } => v !== null);
      // The roof here is the highest piece standing on this ground; no piece's overhanging eave may rise above it.
      const own = here.filter((v) => !v.eave);
      if (own.length === 0) continue;
      const roofTop = Math.max(...own.map((v) => v.top));
      // A valley's lip over a short hip end can stand up to 0.5 m proud (as on plain L and T roofs); anything more
      // is a junction the game's pieces can't make, which is built from blocks instead.
      for (const v of here) if (v.eave) assert.ok(v.top - roofTop <= 0.5 + 1e-9, `${kind} ${JSON.stringify(params)}: an eave stands ${(v.top - roofTop).toFixed(2)} m proud at ${x}, ${z}`);
    }
  }
  // (Offsets held at a limit often land between pieces, which builds from blocks, so fewer of these use pieces.)
  assert.ok(checked > 10, `checked ${checked} piece roofs`);
  // The case that showed it: an L with arm 1 offset by a piece has no proud eave at all.
  const l = roofPieces(roof('roofL', { aOff: 1 }, { position: [0, 8, 0] }));
  const [lx0, lx1] = span(l, 0), [lz0, lz1] = span(l, 2);
  for (let x = lx0 + 0.125; x < lx1; x += 0.25) for (let z = lz0 + 0.125; z < lz1; z += 0.25) {
    const here = l.map((p) => surface(p, x, z)).filter((v): v is { top: number; eave: boolean } => v !== null);
    const own = here.filter((v) => !v.eave);
    if (own.length) for (const v of here) if (v.eave) assert.ok(v.top <= Math.max(...own.map((o) => o.top)) + 1e-6, `proud by ${v.top - Math.max(...own.map((o) => o.top))} at ${x}, ${z}`);
  }
});

test('offsetting an L arm slides it along the other arm, which keeps its length', () => {
  const at = (params: Record<string, number>) => roofPieces(roof('roofL', { facing: 0, ...params }, { position: [0, 8, 0] }));
  // Arm 2 runs toward +z; its tip (the +z end) stays where it is, and arm 1's ridge moves 2 m along it.
  const tip = (ps: RoofPiece[]) => span(ps, 2)[1];
  const armOneRidgeZ = (ps: RoofPiece[]) => {
    const x0 = span(ps, 0)[0];
    const west = ps.filter((p) => p.min[0] === x0);
    return (span(west, 2)[0] + span(west, 2)[1]) / 2;
  };
  const base = at({});
  for (const off of [1, 2]) {
    const slid = at({ aOff: off });
    assert.equal(tip(slid) - span(slid, 2)[0], tip(base) - span(base, 2)[0] - 0.5, `arm 2 keeps its length (its far end becomes a gable, without the 0.5 m eave)`);
    assert.equal((armOneRidgeZ(slid) - span(slid, 2)[0]) - (armOneRidgeZ(base) - span(base, 2)[0]), off * 2 - 0.5, `arm 1 slid ${off * 2} m along arm 2`);
  }
  // It can't slide past arm 2's end: a negative offset stays at 0.
  assert.deepEqual(boxKeys(at({ aOff: -1 })), boxKeys(base));
});

test('arms slid as far as they go along each other still close the outside corner', () => {
  // Arm 1 slid to the end of arm 2, arm 2 slid to the end of arm 1 (the limits): the corner has no gap.
  for (const [aLen, bLen] of [[3, 7], [2, 4], [4, 4]]) {
    // (Asking for more than the limit holds each offset at it, which lands between pieces: built from blocks.)
    const s = roof('roofL', { aLen, bLen, aShift: bLen * 2, bShift: -aLen * 2, facing: 0 }, { position: [0, 8, 0] });
    const cells = blockRoofCells(s);
    assert.ok(cells.length > 0);
    const x0 = Math.min(...cells.map((c) => c[0])), z1 = Math.max(...cells.map((c) => c[2]));
    // The outside corner's column (one in from the corner of the roof's box) has roof on it.
    assert.ok(cells.some((c) => c[0] === x0 + 1 && c[2] === z1 - 1), `corner covered (${aLen}, ${bLen})`);
  }
  // At the limits, each arm's end lies exactly on the other's edge (never inside it), so no shoulder is needed.
});

test('a T bar arm slid along the stem: the stem\'s end slopes down to meet the other bar arm, with no face between', () => {
  const surface = (p: RoofPiece, wx: number, wz: number): number | null => {
    const q = YAW_QUATERNION[p.yaw];
    const inv = fromQuaternion([-q[0], -q[1], -q[2], q[3]]);
    const [x, , z] = apply(inv, [wx - p.pos[0], 0, wz - p.pos[2]]);
    const [sx, h, sz] = p.type.size;
    if (x < 1e-6 || z < 1e-6 || x > sx - 1e-6 || z > sz - 1e-6) return null;
    return (p.type.form === 'side' ? h - x : p.type.form === 'outer' ? h - Math.max(x, sx - z) : h - Math.min(x, z)) + p.min[1];
  };
  for (const lShift of [2, 4]) {
    const ps = roofPieces(roof('roofT', { lShift, facing: 0 }, { position: [0, 0, 0] }));
    const top = (x: number, z: number) => Math.max(...ps.map((p) => surface(p, x, z)).filter((v): v is number => v !== null));
    // Across the junction's center line (the middle of the stem), along the bar's far side.
    const tipZ = span(ps, 2)[1];
    const tip = ps.filter((p) => p.max[2] === tipZ);
    const mid = (span(tip, 0)[0] + span(tip, 0)[1]) / 2;
    const z0 = span(ps, 2)[0];
    for (let dz = 0.25; dz < 2; dz += 0.5) {
      const step = Math.abs(top(mid - 0.125, z0 + dz) - top(mid + 0.125, z0 + dz));
      assert.ok(step <= 0.25 + 1e-9, `shift ${lShift}: a ${step} m step across the center at ${dz} m in`);
    }
  }
});

test('a T\'s stem has no sideways offset: it stays centered on the bar', () => {
  assert.ok(!SHAPES.roofT.params.some((p) => p.key === 'sShift'), 'no stem offset field');
  assert.ok(SHAPES.roofT.params.some((p) => p.key === 'lShift') && SHAPES.roofT.params.some((p) => p.key === 'rShift'), 'the bar arms keep theirs');
  // A stem offset saved by an earlier version is ignored.
  assert.deepEqual(boxKeys(roofPieces(roof('roofT', { sShift: 2 }))), boxKeys(roofPieces(roof('roofT', {}))));
  assert.deepEqual(boxKeys(roofPieces(roof('roofT', { sOff: 1 }))), boxKeys(roofPieces(roof('roofT', {}))));
});

test('each arm of an L, T or cross roof has its own angle', async () => {
  const { roofSlope, joinedBlockReason, blockRoofCells } = await import('../src/core/roofs');
  const { cleanParams, SHAPES } = await import('../src/core/shapes');
  // Every arm at 45 keeps roof pieces; one arm at another angle builds the whole roof from blocks.
  assert.ok(roofPieces(roof('roofT', { units: 1, lAngle: 45, rAngle: 45, sAngle: 45 })).length > 0);
  const mixed = roof('roofT', { units: 1, lAngle: 45, rAngle: 45, sAngle: 22.5, lWidth: 5, rWidth: 5, sWidth: 5, lLen: 6, rLen: 6, sLen: 6 });
  assert.equal(roofPieces(mixed).length, 0);
  assert.ok(blockRoofCells(mixed).length > 0);
  assert.equal(joinedBlockReason(mixed), 'angle');
  const arms = roofSlope(mixed)!.arms!;
  assert.ok(Math.abs(arms[0].degrees - 45) < 8 && Math.abs(arms[2].degrees - 22.5) < 8, arms.map((a) => a.degrees).join());
  assert.ok(arms[2].rise < arms[0].rise, 'the 22.5 degree stem rises less than the 45 degree arms');
  // One arm at 67.5, another set by its own height.
  const L = roof('roofL', { units: 1, aAngle: 67.5, bAngle: 0, bHeight: 2, aWidth: 6, bWidth: 6, aLen: 4, bLen: 4 });
  const [a, b] = roofSlope(L)!.arms!;
  assert.ok(a.degrees > 55 && b.rise === 3, `${a.degrees} ${b.rise}`);
  // The angle is the first setting of each arm, and the roof has no shared angle any more.
  assert.equal(SHAPES.roofCross.params.find((p) => p.group === '+z arm')!.key, 'pzAngle');
  assert.ok(!SHAPES.roofL.params.some((p) => p.key === 'angle'));
  // Projects saved before 0.15 open with their one angle on every arm.
  const old = cleanParams('roofCross', { angle: 67.5 });
  assert.deepEqual([old.nxAngle, old.pxAngle, old.nzAngle, old.pzAngle], [67.5, 67.5, 67.5, 67.5]);
});

test('gables and sheds take a custom angle or a rise over run, as close as the roof\'s size allows', async () => {
  const { roofSlope, CUSTOM_ANGLE, RISE_RUN } = await import('../src/core/roofs');
  const { SHAPES } = await import('../src/core/shapes');
  for (const kind of ['roofGable', 'roofShed'] as const) {
    for (const deg of [10, 30, 40, 52.5, 75]) {
      const s = roofSlope(roof(kind, { rows: 8, pieceSize: 4, angle: CUSTOM_ANGLE, customAngle: deg }))!;
      assert.ok(Math.abs(s.degrees - deg) < 0.6, `${kind} ${deg}: built at ${s.degrees}`);
      assert.ok(roofPieces(roof(kind, { angle: CUSTOM_ANGLE, customAngle: deg })).length === 0, 'built from blocks');
    }
    // A 6 in 12 pitch: the rise is half the run.
    const p = roofSlope(roof(kind, { rows: 4, pieceSize: 4, angle: RISE_RUN, pitchRise: 6, pitchRun: 12 }))!;
    assert.equal(p.rise * 2, p.run);
    const q = roofSlope(roof(kind, { rows: 2, angle: RISE_RUN, pitchRise: 7, pitchRun: 4 }))!;
    assert.equal(q.rise, Math.round((q.run * 7) / 4));
    // Small roofs still slope (at least one block).
    assert.ok(roofSlope(roof(kind, { angle: CUSTOM_ANGLE, customAngle: 1 }))!.rise >= 1);
    // The extra fields show only for their choice; hip roofs don't offer them.
    const keys = (params: Record<string, number>) => SHAPES[kind].params.filter((f) => !f.showIf || f.showIf(params)).map((f) => f.key);
    assert.ok(keys({ angle: CUSTOM_ANGLE }).includes('customAngle') && !keys({ angle: CUSTOM_ANGLE }).includes('pitchRise'));
    assert.ok(keys({ angle: RISE_RUN }).includes('pitchRun') && !keys({ angle: 45 }).includes('customAngle'));
  }
  assert.ok(!SHAPES.roofHip.params.find((f) => f.key === 'angle')!.choices!.some((c) => c.value === CUSTOM_ANGLE));
});

test('double-thick roofs: a second layer half a meter under, in its own material', async () => {
  const { roofBlocks, INNER_DROP, INNER_GAP } = await import('../src/core/roofs');
  const WOOD = 1358536105;
  for (const kind of KINDS) {
    // Roof pieces: the same pieces in the inside material, listed before the roof's own, on the same slopes 1 m under
    // the roof (a block, and a block against bleeding through), never above it, with their bottom level with the eaves.
    const single = roofPieces(roof(kind, { rows: 2 }));
    const flush = roof(kind, { rows: 2, double: 1, innerMaterial: WOOD });
    const double = roofPieces(flush);
    assert.equal(double.length, 2 * single.length, kind);
    const inner = double.slice(0, single.length);
    assert.ok(inner.every((q) => q.materialItem === WOOD) && double.slice(single.length).every((q) => q.materialItem === RED_TILE));
    const offsets = layerOffsets(single, inner);
    assert.ok(offsets[0] === INNER_DROP + INNER_GAP && offsets.every((d) => d >= 0), `${kind}: ${offsets}`);
    const base = worldBounds(flush).min[1];
    assert.ok(inner.every((q) => q.min[1] >= base - 1e-9), `${kind}: flush with the eaves`);
    assert.equal(voxelizeScene([flush]).length, 0);
    // Receded: one block further in, still all pieces, still within the roof's plan.
    // (Where a piece can't move that far without poking through the far slope, such as beside a hip, blocks.)
    const lap = roof(kind, { rows: 3, double: 1, recede: 1, innerMaterial: WOOD });
    assert.ok(voxelizeScene([lap]).every((v) => v.materialItem === WOOD), kind);
    const lapPieces = roofPieces(lap);
    const single3 = roofPieces(roof(kind, { rows: 3 }));
    assert.equal(lapPieces.slice(-single3.length).filter((q) => q.materialItem === RED_TILE).length, single3.length, kind);
    const plan = (qs: RoofPiece[]) => { const f = new Set<string>(); for (const q of qs) for (let x = Math.floor(q.min[0] * 2 + 1e-9); x < Math.ceil(q.max[0] * 2 - 1e-9); x++) for (let z = Math.floor(q.min[2] * 2 + 1e-9); z < Math.ceil(q.max[2] * 2 - 1e-9); z++) f.add(`${x},${z}`); return f; };
    const flushPlan = plan(roofPieces(roof(kind, { rows: 3, double: 1, innerMaterial: WOOD })).filter((q) => q.materialItem === WOOD));
    const top = plan(single3), under = plan(lapPieces.filter((q) => q.materialItem === WOOD));
    assert.ok([...under].every((c) => flushPlan.has(c)) && under.size < flushPlan.size && [...flushPlan].every((c) => top.has(c)), `${kind}: receded inside flush inside the roof`);
    // One row deep, the pieces along the eaves reach the ridge and can't move in: that part is blocks in the inside
    // material, on the grid like everything else.
    const oneRow = voxelizeScene([roof(kind, { rows: 1, double: 1, recede: 1, innerMaterial: WOOD })]);
    assert.ok(oneRow.length > 0 && oneRow.every((v) => v.materialItem === WOOD), kind);
    // Every inside piece stays on the 0.5 m grid (the game appears to round other positions down).
    for (const rows of [1, 2, 3]) for (const recede of [0, 1]) for (const innerDrop of [1, 2, 4]) {
      const q = roofPieces(roof(kind, { rows, double: 1, recede, innerDrop, innerMaterial: WOOD }));
      assert.ok(q.every((r) => r.pos.every((v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9)), `${kind} ${rows} ${recede} ${innerDrop}`);
    }
    // Blocks: every column gets one more block under it, in the inside material.
    const b = roof(kind, { rows: 2, angle: 33.3 });
    const one = voxelizeScene([b]);
    const two = voxelizeScene([{ ...b, params: { ...b.params, double: 1, innerMaterial: WOOD } }]);
    const wood = two.filter((v) => v.materialItem === WOOD);
    assert.ok(wood.length > 0 && two.length - wood.length === one.length, kind);
    const own = new Set(one.map((v) => `${v.i},${v.j},${v.k}`));
    assert.ok(wood.every((v) => own.has(`${v.i},${v.j + 1},${v.k}`)), `${kind}: the inside layer is right under the roof`);
    assert.equal(roofBlocks(b).inner.length, 0, 'single roofs have no inside layer');
  }
});

test("receding the bottom layer pulls it one block in from the eaves and gable ends, not a shed's high side", () => {
  const WOOD = 1358536105;
  const layers = (kind: import('../src/core/roofs').RoofKind, params: Record<string, number>) => {
    const s = roof(kind, { ...params, double: 1, innerMaterial: WOOD }, { position: [0, 0, 0] });
    const inside = (sh: Shape) => {
      const f = new Set<string>();
      for (const v of voxelizeScene([sh])) if (v.materialItem === WOOD) f.add(`${v.i},${v.k}`);
      for (const q of roofPieces(sh)) if (q.materialItem === WOOD) for (let x = q.min[0]; x < q.max[0] - 1e-9; x += 0.5) for (let z = q.min[2]; z < q.max[2] - 1e-9; z += 0.5) f.add(`${Math.round(x * 2)},${Math.round(z * 2)}`);
      return f;
    };
    const flush = inside(s), receded = inside({ ...s, params: { ...s.params, recede: 1 } });
    const xs = [...flush].map((c) => Number(c.split(',')[0])), zs = [...flush].map((c) => Number(c.split(',')[1]));
    return { flush, receded, x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)] };
  };
  const has = (set: Set<string>, x: number, z: number) => set.has(`${x},${z}`);
  for (const params of [{ rows: 2, length: 3 }, { rows: 2, length: 3, angle: 33.3 }, { rows: 1, length: 3 }] as Record<string, number>[]) {
    // A gable along x: one column in from both eaves (z) and both gable ends (x).
    const g = layers('roofGable', params);
    const midX = Math.round((g.x[0] + g.x[1]) / 2), midZ = Math.round((g.z[0] + g.z[1]) / 2);
    assert.ok(has(g.flush, midX, g.z[0]) && has(g.flush, g.x[0], midZ), JSON.stringify(params));
    for (const [x, z] of [[midX, g.z[0]], [midX, g.z[1]], [g.x[0], midZ], [g.x[1], midZ]]) assert.ok(!has(g.receded, x, z), `${JSON.stringify(params)} ${x},${z}`);
    // It starts one column in, or further on a gentle block slope, where the columns by the eave are level with it
    // and the inside layer's blocks under them would hang below the eave (those are left out).
    assert.ok([1, 2, 3, 4].some((n) => has(g.receded, midX, g.z[0] + n)) && has(g.receded, g.x[0] + 1, midZ), JSON.stringify(params));
    // At 45 degrees (pieces) a receded layer starts one column further in than the flush one.
    if (!params.angle && params.rows > 1) assert.ok(has(g.receded, midX, g.z[0] + 1), 'at 45 degrees, one column further in');
  }
  // Nothing of a receded layer hangs below the roof's eaves.
  for (const kind of KINDS) for (const params of [{ rows: 1 }, { rows: 2, angle: 22.5 }, { rows: 2, angle: 67.5 }] as Record<string, number>[]) {
    const s = roof(kind, { ...params, double: 1, recede: 1, innerMaterial: WOOD });
    const base = Math.round(worldBounds(s).min[1] * 2);
    assert.ok(voxelizeScene([s]).every((v) => v.j >= base), `${kind} ${JSON.stringify(params)}`);
  }
  // A shed (high side toward -z): receded at the low side and both ends, flush along the high side.
  const sh = layers('roofShed', { rows: 2, length: 3 });
  const midX = Math.round((sh.x[0] + sh.x[1]) / 2);
  assert.ok(has(sh.receded, midX, sh.z[0]) && !has(sh.receded, midX, sh.z[1]) && !has(sh.receded, sh.x[0], sh.z[0] + 2));
});

test('a blueprint cannot cut a piece, so 4 m inside layers that would need it are laid in 2 m pieces, and 2 m ones in blocks', () => {
  const WOOD = 1358536105;
  for (const kind of KINDS) {
    const s = roof(kind, { rows: 1, pieceSize: 4, double: 1, innerMaterial: WOOD });
    const all = roofPieces(s);
    const inner = all.filter((q) => q.materialItem === WOOD), outer = all.filter((q) => q.materialItem !== WOOD);
    assert.ok(outer.every((q) => q.type.run === 4) && inner.length > 0 && inner.every((q) => q.type.run === 2), kind);
    assert.equal(voxelizeScene([s]).length, 0, `${kind}: no blocks needed`);
    const plan = (qs: RoofPiece[]) => { const f = new Set<string>(); for (const q of qs) for (let x = Math.floor(q.min[0] * 2 + 1e-9); x < Math.ceil(q.max[0] * 2 - 1e-9); x++) for (let z = Math.floor(q.min[2] * 2 + 1e-9); z < Math.ceil(q.max[2] * 2 - 1e-9); z++) f.add(`${x},${z}`); return f; };
    const top = plan(outer), under = plan(inner);
    assert.ok([...under].every((c) => top.has(c)) && under.size < top.size, kind);
    // Two rows of 4 m pieces don't need it: the 4 m pieces along the eaves move in.
    assert.ok(roofPieces(roof(kind, { rows: 2, pieceSize: 4, double: 1, innerMaterial: WOOD })).every((q) => q.type.run === 4), kind);
  }
});

test('a double-thick block roof covers every face of the roof seen from under it, sides of steep steps included', () => {
  const WOOD = 1358536105;
  for (const kind of KINDS) for (const angle of [22.5, 33.3, 67.5]) {
    const s = roof(kind, { rows: 2, angle, double: 1, innerMaterial: WOOD });
    const v = voxelizeScene([s]);
    const base = Math.min(...v.filter((c) => c.materialItem !== WOOD).map((c) => c.j));
    const mat = new Map(v.map((c) => [`${c.i},${c.j},${c.k}`, c.materialItem]));
    const lowest = new Map<string, number>();
    for (const c of v) if (c.materialItem !== WOOD) lowest.set(`${c.i},${c.k}`, Math.min(lowest.get(`${c.i},${c.k}`) ?? Infinity, c.j));
    for (const c of v) {
      if (c.materialItem === WOOD) continue;
      for (const [a, b, d] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = `${c.i + a},${c.j + b},${c.k + d}`, low = lowest.get(`${c.i + a},${c.k + d}`);
        if (low === undefined || c.j + b >= low) continue; // outside the roof, or roof
        if (c.j + b < base) continue; // below the eaves: the layer stops level with them
        assert.equal(mat.get(n), WOOD, `${kind} ${angle}: the face toward ${n} is covered`);
      }
    }
  }
});

test('the inside layer drops 1 to 5 blocks; receded eave pieces move in that much instead, and nothing hangs below the eaves', () => {
  for (const recede of [0, 1]) {
    const at = (innerDrop: number) => roofPieces(roof('roofGable', { rows: 3, double: 1, recede, innerDrop, innerMaterial: 1 })).filter((q) => q.materialItem === 1 && q.type.form !== 'cube');
    const a = at(1), b = at(2);
    assert.equal(a.length, b.length);
    a.forEach((q, n) => {
      const d = q.pos.map((v, k) => Math.round((v - b[n].pos[k]) * 1000) / 1000);
      // Down one more block, or (an eave piece, receded) one block further in at the same height: the same slope.
      assert.ok((d[1] === 0.5 && d[0] === 0 && d[2] === 0) || (d[1] === 0 && Math.abs(d[0]) + Math.abs(d[2]) === 0.5), JSON.stringify(d));
    });
  }
  // A receded layer's lowest point stays level with the roof's eave whatever the drop: pieces and loose blocks.
  for (const kind of KINDS) for (const rows of [1, 2, 3]) for (const innerDrop of [1, 3, 5]) {
    const s = roof(kind, { rows, double: 1, recede: 1, innerDrop, innerMaterial: 1 });
    const base = worldBounds(s).min[1];
    assert.ok(roofPieces(s).every((q) => q.min[1] >= base - 1e-9), `${kind} ${rows} ${innerDrop}`);
  }
  // Block roofs: the layer sits that many blocks under the roof.
  const blockRoofAt = (innerDrop: number) => voxelizeScene([roof('roofGable', { rows: 2, angle: 33.3, double: 1, innerDrop, innerMaterial: 1 })]).filter((v) => v.materialItem === 1);
  const one = blockRoofAt(1), three = blockRoofAt(3);
  // (two blocks lower; what would then reach below the eaves is left out)
  const higher = new Set(one.map((v) => `${v.i},${v.j - 2},${v.k}`));
  assert.ok(three.length > 0 && three.length < one.length && three.every((v) => higher.has(`${v.i},${v.j},${v.k}`)));
});

test('a receded layer can keep either gable end, or both, flush; and the drop can be 0', () => {
  const W = 1358536105;
  // The inside layer's reach along the ridge, in world x or z, for each choice.
  const reach = (kind: 'roofGable' | 'roofShed', facing: number, recedeEnds: number, angle = 45) => {
    const s = roof(kind, { rows: 3, length: 3, double: 1, recede: 1, recedeEnds, facing, angle, innerMaterial: W }, { position: [0, 0, 0] });
    const ax = facing % 180 === 0 ? 0 : 2;
    const inner = [...roofPieces(s).filter((q) => q.materialItem === W).flatMap((q) => [q.min[ax], q.max[ax]]),
      ...voxelizeScene([s]).filter((v) => v.materialItem === W).flatMap((v) => [(ax === 0 ? v.i : v.k) * 0.5, (ax === 0 ? v.i : v.k) * 0.5 + 0.5])];
    const b = worldBounds(s);
    return [Math.round((Math.min(...inner) - b.min[ax]) * 2) / 2, Math.round((b.max[ax] - Math.max(...inner)) * 2) / 2];
  };
  for (const kind of ['roofGable', 'roofShed'] as const) for (const facing of kind === 'roofGable' ? [0, 90] : [0, 90, 180, 270]) for (const angle of [45, 33.3]) {
    assert.deepEqual(reach(kind, facing, 0, angle), [0.5, 0.5], `${kind} ${facing} ${angle} both`);
    assert.deepEqual(reach(kind, facing, 1, angle), [0, 0], `${kind} ${facing} ${angle} neither`);
    assert.deepEqual(reach(kind, facing, 2, angle), [0.5, 0], `${kind} ${facing} ${angle} -x / -z end`);
    assert.deepEqual(reach(kind, facing, 3, angle), [0, 0.5], `${kind} ${facing} ${angle} +x / +z end`);
  }
  // L, T and cross roofs: all the arms' gable ends or none.
  const tips = (recedeEnds: number) => roofPieces(roof('roofT', { lRows: 2, rRows: 2, sRows: 2, double: 1, recede: 1, recedeEnds, innerMaterial: W }, { position: [0, 0, 0] })).filter((q) => q.materialItem === W);
  const span = (qs: RoofPiece[]) => Math.max(...qs.map((q) => q.max[0])) - Math.min(...qs.map((q) => q.min[0]));
  assert.equal(span(tips(1)) - span(tips(0)), 1);
  // Drop 0: the inside pieces half a meter under the roof.
  const s = roof('roofGable', { rows: 2, double: 1, innerDrop: 0, innerMaterial: W });
  const all = roofPieces(s), n = all.length / 2;
  assert.equal(layerOffsets(all.slice(n), all.slice(0, n))[0], 0.5);
});

test('triple thick: two layers of the roof material over one inside layer', () => {
  const W = 1358536105;
  for (const kind of KINDS) {
    const single = roofPieces(roof(kind, { rows: 2 }));
    const dbl = roofPieces(roof(kind, { rows: 2, double: 1, innerMaterial: W }));
    const tri = roofPieces(roof(kind, { rows: 2, double: 2, innerMaterial: W }));
    const n = single.length;
    assert.equal(tri.length, 3 * n, kind);
    // Inside layer first, a block lower than double thick's; then the roof again half a meter down; then the roof.
    assert.ok(tri.slice(0, n).every((q) => q.materialItem === W) && tri.slice(n, 2 * n).every((q) => q.materialItem === RED_TILE));
    assert.equal(layerOffsets(single, tri.slice(n, 2 * n))[0], 0.5, `${kind}: the second layer half a meter under the roof`);
    assert.equal(layerOffsets(single, tri.slice(0, n))[0], layerOffsets(single, dbl.slice(0, n))[0] + 0.5, `${kind}: the inside layer a block lower than double thick's`);
    assert.deepEqual(tri.slice(2 * n), single);
    // Blocks: a second roof-material layer right under the roof, and the inside layer under that.
    const b = (double: number) => voxelizeScene([roof(kind, { rows: 2, angle: 33.3, double, innerMaterial: W })]);
    const one = b(0), two = b(1), three = b(2);
    const roofMat = (v: typeof one) => v.filter((c) => c.materialItem !== W).length;
    const inside = (v: typeof one) => v.filter((c) => c.materialItem === W).length;
    assert.equal(roofMat(three), roofMat(one) + inside(two), kind);
    assert.ok(inside(three) > 0 && roofMat(two) === roofMat(one), kind);
  }
});

test('triple thick, receded: the second roof layer recedes too, with its own gable ends; the inside drop is from it', () => {
  const W = 1358536105;
  const layers = (params: Record<string, number>) => {
    const all = roofPieces(roof('roofGable', { rows: 3, length: 3, double: 2, recede: 1, innerMaterial: W, ...params }, { position: [0, 0, 0] }));
    const n = all.length / 3;
    return { inside: all.slice(0, n), second: all.slice(n, 2 * n), top: all.slice(2 * n) };
  };
  const span = (qs: RoofPiece[], a: number) => [Math.min(...qs.map((q) => q.min[a])), Math.max(...qs.map((q) => q.max[a]))];
  const l = layers({});
  // Along the ridge (x) and across it (z): the second layer half a meter in from the roof at each gable end and eave.
  assert.deepEqual(span(l.second, 0).map((v, k) => Math.abs(v - span(l.top, 0)[k])), [0.5, 0.5]);
  assert.deepEqual(span(l.second, 2).map((v, k) => Math.abs(v - span(l.top, 2)[k])), [0.5, 0.5]);
  assert.ok(l.second.every((q) => q.materialItem === RED_TILE) && l.inside.every((q) => q.materialItem === W));
  // Its own gable ends: kept flush at both while the inside layer still recedes there.
  const kept = layers({ recedeEnds2: 1 });
  assert.deepEqual(span(kept.second, 0), span(kept.top, 0));
  assert.deepEqual(span(kept.inside, 0), span(l.inside, 0));
  // The inside drop counts from the second layer: one more block of drop moves the inside layer only.
  const deeper = layers({ innerDrop: 2 });
  assert.deepEqual(deeper.second, l.second);
  assert.ok(deeper.inside.some((q, k) => q.pos[1] !== l.inside[k].pos[1] || q.pos[0] !== l.inside[k].pos[0] || q.pos[2] !== l.inside[k].pos[2]));
  // Block roofs: the second layer leaves out its edge columns too.
  const b = (recede: number) => voxelizeScene([roof('roofGable', { rows: 2, angle: 33.3, double: 2, recede, innerMaterial: W })]).filter((v) => v.materialItem !== W).length;
  assert.ok(b(1) < b(0));
});

test('roof edging: whole pieces along the ridge, eaves and (optionally) gable ends; one block wide on block roofs', () => {
  const E = 3502973158;
  // A gable three rows deep: the eave rows and the ridge row edged, the middle row not; gable ends only when asked.
  const g = (params: Record<string, number>) => roofPieces(roof('roofGable', { rows: 3, length: 3, edging: 1, edgeMaterial: E, ...params }));
  const plain = roofPieces(roof('roofGable', { rows: 3, length: 3 }));
  const rowOf = (q: RoofPiece) => Math.round(q.min[1] - Math.min(...plain.map((u) => u.min[1])));
  const edged = g({});
  assert.equal(edged.length, plain.length);
  edged.forEach((q) => assert.equal(q.materialItem === E, rowOf(q) !== 2, `row ${rowOf(q)}`));
  assert.ok(g({ edgeSides: 1 }).filter((q) => q.materialItem === E).length > edged.filter((q) => q.materialItem === E).length);
  assert.ok(g({ edgeRidge: 0 }).every((q) => (q.materialItem === E) === (rowOf(q) === 0)), 'eaves only');
  assert.ok(g({ edgeRidge: 0, edgeEaves: 0 }).every((q) => q.materialItem !== E), 'nothing chosen');
  // The inside layer of a double-thick roof is not edged.
  const d = roofPieces(roof('roofGable', { rows: 3, length: 3, edging: 1, edgeMaterial: E, double: 1, innerMaterial: 1 }));
  assert.ok(d.slice(0, plain.length).every((q) => q.materialItem === 1));
  // Block roofs: the eave columns, the ridge column(s) and, if chosen, the gable-end columns.
  const v = (params: Record<string, number>) => voxelizeScene([roof('roofGable', { rows: 2, length: 3, angle: 33.3, edging: 1, edgeMaterial: E, ...params })]);
  const all = v({ edgeRidge: 0, edgeEaves: 0 });
  assert.ok(all.every((c) => c.materialItem !== E));
  const zs = all.map((c) => c.k), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const top = Math.max(...all.map((c) => c.j));
  const e = v({});
  assert.ok(e.filter((c) => c.materialItem === E).every((c) => c.k === z0 || c.k === z1 || c.j >= top - 1), 'eaves and ridge only');
  assert.ok(e.some((c) => c.materialItem === E && c.j === top) && e.some((c) => c.materialItem === E && c.k === z0));
  assert.ok(v({ edgeSides: 1 }).filter((c) => c.materialItem === E).length > e.filter((c) => c.materialItem === E).length);
});

test('edging on a roof one or two rows deep: the pieces that would be edging all over become blocks with a one-block strip', () => {
  const E = 3502973158;
  for (const [kind, params] of [['roofT', {}], ['roofGable', { rows: 1 }], ['roofGable', { rows: 2 }], ['roofHip', { rows: 2 }], ['roofL', {}], ['roofCross', {}]] as const) {
    const s = roof(kind, { ...params, edging: 1, edgeMaterial: E });
    const v = voxelizeScene([s]);
    const plain = voxelizeScene([roof(kind, { ...params, angle: 22.5 })]);
    assert.ok(v.length > 0 && v.some((c) => c.materialItem === E) && v.some((c) => c.materialItem !== E), `${kind} ${JSON.stringify(params)}: a strip, not the whole roof`);
    // (A strip: on a roof one row deep, one block per column, the eave and ridge columns are close to half of it.)
    assert.ok(v.filter((c) => c.materialItem === E).length < v.length * 0.7, kind);
    assert.ok(plain.length > 0);
    // Whatever stays pieces is next to a piece that isn't edging.
    const pcs = roofPieces(s);
    assert.ok(pcs.every((q) => q.materialItem !== E || pcs.some((u) => u.materialItem !== E)), kind);
  }
  // Three rows deep stays all pieces.
  assert.equal(voxelizeScene([roof('roofGable', { rows: 3, edging: 1, edgeMaterial: E })]).length, 0);
});

test('edging that needs blocks fills what it can with 2 m pieces, on the roof surface and clear of the strips', () => {
  const E = 3502973158;
  for (const [kind, params] of [['roofL', { pieceSize: 4 }], ['roofT', { pieceSize: 4 }], ['roofGable', { rows: 2 }], ['roofGable', { rows: 1, pieceSize: 4 }], ['roofHip', { rows: 1, pieceSize: 4 }]] as const) {
    const s = roof(kind, { ...params, edging: 1, edgeMaterial: E });
    const pcs = roofPieces(s);
    const blocks = voxelizeScene([s]);
    const allBlocks = voxelizeScene([roof(kind, { ...params, angle: 22.5 })]);
    assert.ok(pcs.length > 0 && pcs.every((q) => q.type.run === 2 && q.materialItem !== E), `${kind} ${JSON.stringify(params)}: 2 m pieces in the roof's material`);
    assert.ok(blocks.length > 0 && allBlocks.length > 0);
    // Where a piece stands, there are no blocks on its own ground, and the strip is all blocks.
    const strip = blocks.filter((c) => c.materialItem === E);
    assert.ok(strip.length > 0, kind);
    for (const q of pcs) assert.ok(!strip.some((c) => c.i * 0.5 >= q.min[0] && (c.i + 1) * 0.5 <= q.max[0] && c.k * 0.5 >= q.min[2] && (c.k + 1) * 0.5 <= q.max[2]), `${kind}: a piece over the strip`);
  }
});

test("a T's stem ends in one straight line at the bar's far edge, however wide or slid each bar arm is", async () => {
  const { roofBlocks } = await import('../src/core/roofs');
  // Block roofs (an arm offset in meters), one bar arm wider and slid toward the stem.
  for (const p of [{ rWidth: 11.5, rShift: 2.5 }, { rWidth: 11.5 }, { lWidth: 7, rWidth: 11.5, lShift: 1 }] as Record<string, number>[]) {
    const r = roof('roofT', { units: 1, lWidth: 9, lHeight: 4.5, rHeight: 6, rLen: 2, sLen: 3, ...p }, { position: [0, 0, 0] });
    const cells = roofBlocks(r).cells;
    // The stem runs along +z over x in [-2.5, 2.5]; its far end is at the bar's -z side.
    const far = (x0: number, x1: number) => Math.min(...cells.filter(([i]) => i >= x0 * 2 && i < x1 * 2).map(([, , k]) => k));
    assert.equal(far(-2.5, 0), far(0, 2.5), JSON.stringify(p));
    // And no further than the furthest bar arm.
    assert.equal(far(0, 2.5), Math.min(...cells.map(([, , k]) => k)), JSON.stringify(p));
  }
});

test('junction roofs of pieces: edging keeps the roof surface and double-thick layers stay under it, stale widths or not', async () => {
  const { readFileSync } = await import('node:fs');
  const { roofBlocks, pieceTopAt } = await import('../src/core/roofs');
  const { cleanParams } = await import('../src/core/shapes');
  const surface = (s: Shape, which: 'all' | 'roof' = 'all') => {
    const top = new Map<string, number>();
    if (which === 'all') for (const [i, j, k] of roofBlocks(s).cells) top.set(`${i},${k}`, Math.max(top.get(`${i},${k}`) ?? -99, (j + 1) / 2));
    for (const q of roofPieces(s)) {
      if (which === 'roof' && q.materialItem !== s.materialItem) continue;
      for (let i = Math.floor(q.min[0] * 2); i < Math.ceil(q.max[0] * 2); i++) for (let k = Math.floor(q.min[2] * 2); k < Math.ceil(q.max[2] * 2); k++) {
        const t = pieceTopAt(q, (i + 0.5) / 2, (k + 0.5) / 2);
        if (t !== null) top.set(`${i},${k}`, Math.max(top.get(`${i},${k}`) ?? -99, t));
      }
    }
    return top;
  };
  const differ = (a: Map<string, number>, b: Map<string, number>) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => Math.abs((a.get(k) ?? -10) - (b.get(k) ?? -10)) > 0.51).length;
  // The cross from the report (2026-11-05): 4 m pieces, arms of 3, 2 and 1 rows, one offset, widths saved from when it
  // was built from blocks.
  const saved = JSON.parse(readFileSync(new URL('./fixtures/cross_edging.shapeforge', import.meta.url), 'utf8')).shapes[0];
  const cases: Shape[] = [{ ...saved, id: 'r' }];
  let seed = 5;
  const rnd = (n: number) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  for (let t = 0; t < 40; t++) {
    const kind = (['roofL', 'roofT', 'roofCross'] as const)[rnd(3)];
    const p: Record<string, number> = { pieceSize: rnd(2) ? 4 : 2 };
    for (const a of ROOF_ARMS[kind]) {
      p[`${a.key}Len`] = 1 + rnd(3); p[`${a.key}Rows`] = 1 + rnd(3); p[`${a.key}Width`] = 3 + rnd(10);
      if (!a.noShift && rnd(3) === 0) p[`${a.key}Shift`] = (rnd(3) - 1) * p.pieceSize;
    }
    cases.push(roof(kind, p, { position: [0.5, 2, -1] }));
  }
  for (const s of cases) {
    const p = cleanParams(s.kind as ShapeKind, s.params);
    const plain = { ...s, params: { ...p, edging: 0, double: 0 } };
    if (isBlockRoof(plain)) continue;
    const label = `${s.kind} ${JSON.stringify(p)}`;
    for (const edge of [{ edgeSides: 0 }, { edgeSides: 1 }]) assert.equal(differ(surface(plain), surface({ ...s, params: { ...p, ...edge, edging: 1, double: 0 } })), 0, `${label} edging ${JSON.stringify(edge)}`);
    // Double thick: every inside-layer piece under the roof (clear of it by more than a fifth of a meter everywhere).
    const dbl = { ...s, params: { ...p, edging: 0, double: 1 } };
    const outer = surface(plain, 'roof');
    for (const q of roofPieces(dbl).filter((q) => q.materialItem !== s.materialItem)) {
      for (let x = q.min[0] + 0.125; x < q.max[0]; x += 0.25) for (let z = q.min[2] + 0.125; z < q.max[2]; z += 0.25) {
        const t = pieceTopAt(q, x, z), o = outer.get(`${Math.floor(x * 2)},${Math.floor(z * 2)}`);
        if (t !== null && o !== undefined) assert.ok(t <= o - 0.2, `${label}: inside layer under the roof at ${x},${z}`);
      }
    }
  }
});

test('an L, T or cross roof keeps one style of edging: strips of blocks everywhere once any arm needs them', async () => {
  const { readFileSync } = await import('node:fs');
  const { roofBlocks } = await import('../src/core/roofs');
  // The cross from the report (2026-11-05): arms of 1, 1, 3 and 2 rows, one offset.
  const saved = JSON.parse(readFileSync(new URL('./fixtures/cross_edging2.shapeforge', import.meta.url), 'utf8')).shapes[0];
  for (const s of [{ ...saved, id: 'r' } as Shape, roof('roofT', { sRows: 3, edging: 1 }), roof('roofL', { aRows: 3, edging: 1 })]) {
    const b = roofBlocks(s);
    assert.ok(b.edge.length > 0, `${s.kind}: edging strips`);
    const edgedPieces = roofPieces(s).filter((q) => q.materialItem !== s.materialItem);
    assert.equal(edgedPieces.length, 0, `${s.kind}: no whole pieces of edging beside the strips`);
  }
  // A gable keeps whole pieces of edging on a roof deep enough for them.
  const g = roof('roofGable', { rows: 3, edging: 1 });
  assert.ok(roofPieces(g).some((q) => q.materialItem !== g.materialItem));
});

test('edging never changes a roof\'s layers: double and triple thick lie the same with edging on or off', async () => {
  const { roofBlocks } = await import('../src/core/roofs');
  const layers = (s: Shape) => {
    const all = roofPieces(s), outer = roofPieces({ ...s, params: { ...s.params, double: 0 } }).length;
    return JSON.stringify([all.slice(0, all.length - outer).map((q) => `${q.type.blueprintId}|${q.yaw}|${q.min}|${q.materialItem}`).sort(), roofBlocks(s).inner.map((c) => c.join()).sort()]);
  };
  for (const kind of ['roofGable', 'roofHip', 'roofShed', 'roofL', 'roofT', 'roofCross'] as const) for (const pieceSize of [2, 4]) for (const double of [1, 2]) for (const recede of [0, 1]) {
    const p = { pieceSize, double, recede };
    assert.equal(layers(roof(kind, { ...p, edging: 1, edgeSides: 1 })), layers(roof(kind, p)), `${kind} ${JSON.stringify(p)}`);
  }
});

test('edged roofs list each piece after the ones its eave lies over, so the game shows the top one where they overlap', () => {
  for (const [kind, p] of [['roofGable', { rows: 3 }], ['roofHip', { rows: 3 }], ['roofL', { aRows: 3, bRows: 3, aLen: 3, bLen: 3 }], ['roofT', { lRows: 3, rRows: 3, sRows: 3 }], ['roofCross', { nxRows: 3, pxRows: 3, nzRows: 3, pzRows: 3 }]] as const) {
    const ps = roofPieces(roof(kind, { ...p, edging: 1 }));
    ps.forEach((a, n) => ps.forEach((b, m) => {
      if (m <= n || a.materialItem === b.materialItem) return;
      const overlap = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]) > 0.01 && Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]) > 0.01;
      if (overlap) assert.ok(a.max[1] <= b.max[1] + 1e-9, `${kind}: piece ${m} (higher) listed after piece ${n}`);
    }));
  }
});

test("a roof piece built from blocks is the game's own staircase: a Roof Side 4M as Embervale recorded it", async () => {
  const { readFileSync } = await import('node:fs');
  const { pieceVoxels } = await import('../src/core/roofs');
  // Recorded 2026-11-05: a Red Tile Roof Side 4M with two blocks deleted, written out by EVT 3.5 as its other blocks.
  const rec = JSON.parse(readFileSync(new URL('./fixtures/roof_side_4m_deleted.ebblueprint', import.meta.url), 'utf8'));
  const norm = (cs: number[][]) => { const m = [0, 1, 2].map((a) => Math.min(...cs.map((c) => c[a]))); return new Set(cs.map((c) => c.map((v, a) => v - m[a]).join())); };
  const recorded = norm(rec.pieces.map((p: { pos: number[] }) => p.pos.map((v) => Math.round(v * 2))));
  const s = roof('roofShed', { pieceSize: 4, rows: 1, length: 1, facing: 90 }, { position: [0, 0, 0] });
  const ours = norm(pieceVoxels(roofPieces(s)[0]));
  assert.equal(ours.size, 72, '9 steps of 8');
  assert.equal([...recorded].filter((c) => !ours.has(c)).length, 0, 'every recorded block');
  assert.deepEqual([...ours].filter((c) => !recorded.has(c)).sort(), ['5,3,2', '5,3,6'], 'and only the two deleted ones besides');
});

test('edging built from blocks leaves no open seam where two materials meet (strip and roof, blocks and pieces)', async () => {
  const { roofBlocks, pieceVoxels } = await import('../src/core/roofs');
  for (const [kind, p] of [['roofGable', { rows: 1, length: 3 }], ['roofGable', { rows: 2, length: 3 }], ['roofHip', { rows: 2 }], ['roofT', {}], ['roofL', { pieceSize: 4 }], ['roofCross', { nzRows: 3, pzRows: 2, pzShift: -2 }]] as const) {
    const s = roof(kind, { ...p, edging: 1 });
    const col = new Map<string, { y: number; m: string }[]>();
    const add = ([x, y, z]: [number, number, number], m: string) => { const k = `${x},${z}`; col.set(k, [...(col.get(k) ?? []), { y, m }]); };
    const b = roofBlocks(s), edge = new Set(b.edge.map((c) => c.join()));
    for (const c of b.cells) add(c, edge.has(c.join()) ? 'E' : 'R');
    for (const q of roofPieces(s)) for (const c of pieceVoxels(q)) add(c, q.materialItem === s.materialItem ? 'R' : 'E');
    // The top material of each column, and how far down that material reaches there.
    const topOf = (l: { y: number; m: string }[]) => { const t = Math.max(...l.map((e) => e.y)); const m = l.find((e) => e.y === t)!.m; return { m, hi: t, lo: Math.min(...l.filter((e) => e.m === m).map((e) => e.y)) }; };
    for (const [k, l] of col) {
      const [x, z] = k.split(',').map(Number), a = topOf(l);
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const n = col.get(`${x + dx},${z + dz}`);
        if (!n) continue;
        const c = topOf(n);
        if (a.m !== c.m) assert.ok(a.hi >= c.lo && c.hi >= a.lo, `${kind} ${JSON.stringify(p)}: open seam at ${k}`);
      }
    }
  }
});
