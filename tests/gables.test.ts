import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gableEnds, matchGable, roofCeiling } from '../src/core/gables';
import { ROOF_ARMS, roofBlocks, roofBounds, type JoinedKind } from '../src/core/roofs';
import { eulerXYZ, apply } from '../src/core/math';
import { createShape } from '../src/core/scene';
import { cleanParams, SHAPES } from '../src/core/shapes';
import type { Shape, ShapeKind } from '../src/core/types';
import { voxelizeScene } from '../src/core/voxelize';

const make = (kind: ShapeKind, params: Record<string, number> = {}, over: Partial<Shape> = {}): Shape => {
  const s = createShape(kind);
  return { ...s, ...over, params: cleanParams(kind, { ...s.params, ...params }) };
};

/** The blocks that fit under a roof in the last `depth` slices at one end of its ridge, worked out from the roof itself. */
function underEnd(roof: Shape, end: 0 | 1, depth: number): Set<string> {
  const b = roofBounds(roof), ceil = roofCeiling(roof);
  const lo = b.min.map((v) => Math.round(v * 2)), hi = b.max.map((v) => Math.round(v * 2));
  const yaw = roof.params.facing;
  // The ridge's -x end in the world, as the roof's facing turns it (90 takes +x to -z).
  const sign = (end === 0 ? -1 : 1) * ({ 0: 1, 90: -1, 180: -1, 270: 1 } as Record<number, number>)[yaw];
  const ax = yaw % 180 === 0 ? 0 : 2;
  const out = new Set<string>();
  for (let i = lo[0]; i < hi[0]; i++) for (let k = lo[2]; k < hi[2]; k++) {
    const a = ax === 0 ? i : k;
    if (sign < 0 ? a >= lo[ax] + depth : a < hi[ax] - depth) continue;
    const t = ceil(i, k);
    if (t !== null) for (let j = lo[1]; j < t.top; j++) out.add(`${i},${j},${k}`);
  }
  return out;
}

const ROOFS: [ShapeKind, Record<string, number>][] = [
  ['roofGable', {}], ['roofGable', { facing: 90, pieceSize: 4 }], ['roofGable', { angle: 22.5, rows: 2 }], ['roofGable', { angle: 67.5 }],
  ['roofGable', { angle: -1, customAngle: 30, rows: 3 }], ['roofGable', { angle: -2, pitchRise: 7, pitchRun: 12, rows: 2 }],
  ['roofGable', { asym: 1, longSide: 1 }], ['roofGable', { asym: 2, ridgeOffset: 1.5, angle: 33.3, rows: 2 }],
  ['roofGable', { double: 1 }], ['roofGable', { double: 2, recede: 1, recedeEnds: 2, recedeEnds2: 3 }], ['roofGable', { facing: 180, double: 1, recede: 1, innerDrop: 3 }],
  ['roofGable', { edging: 1, edgeSides: 1 }], ['roofGable', { angle: 22.5, double: 2, recede: 1, rows: 2, facing: 90 }],
  ['roofShed', {}], ['roofShed', { facing: 270, double: 1, recede: 1 }], ['roofShed', { angle: -2, pitchRise: 5, pitchRun: 12, facing: 180, rows: 2 }],
  ['roofShed', { angle: 67.5, facing: 90, double: 2 }],
];

test('a gable matched to a roof end fills exactly the space under that end, at every angle, side, layer count and facing', () => {
  for (const [kind, p] of ROOFS) for (const end of [0, 1] as const) for (const depth of [1, 3]) {
    const roof = make(kind, p, { position: [1.5, 3, -2] });
    const gable = matchGable(make('gable', { depth }), roof, `end${end}`);
    const got = new Set(voxelizeScene([{ ...gable, params: cleanParams('gable', gable.params) }]).map((c) => `${c.i},${c.j},${c.k}`));
    const want = underEnd(roof, end, depth);
    const label = `${kind} ${JSON.stringify(p)} end ${end} depth ${depth}`;
    assert.ok(want.size > 0, label);
    assert.equal([...want].filter((c) => !got.has(c)).length, 0, `${label}: missing`);
    assert.equal([...got].filter((c) => !want.has(c)).length, 0, `${label}: extra`);
    // Never inside the roof's own blocks.
    const roofCells = new Set(Object.values(roofBlocks(roof)).flat().map(([i, j, k]) => `${i},${j},${k}`));
    assert.ok([...got].every((c) => !roofCells.has(c)), `${label}: clear of the roof's blocks`);
  }
});

test('a gable on its own: a stair-stepped triangle (or half triangle under a shed)', () => {
  const cells = voxelizeScene([make('gable')]);
  const cols = new Map<number, number>();
  for (const c of cells) cols.set(c.k, (cols.get(c.k) ?? 0) + 1);
  const heights = [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, h]) => h);
  assert.deepEqual(heights, [...heights].reverse(), 'symmetric');
  assert.ok(Math.max(...heights) > 2 && new Set(cells.map((c) => c.i)).size === 1, 'one block thick, peaked');
  const shed = voxelizeScene([make('gable', { roofType: 1 })]);
  const sc = new Map<number, number>();
  for (const c of shed) sc.set(c.k, (sc.get(c.k) ?? 0) + 1);
  const sh = [...sc.entries()].sort((a, b) => a[0] - b[0]).map(([, h]) => h);
  assert.ok(sh[0] > sh[sh.length - 1], 'a shed gable is high at -z');
  assert.equal(createShape('gable').fill, 'filled');
  assert.equal(SHAPES.gable.group, 'Roofs');
});

test('gable ends are offered for gable and shed roofs, named by their direction in the world', () => {
  assert.deepEqual(gableEnds(make('roofGable')).map((e) => e.label), ['end toward -x', 'end toward +x']);
  assert.deepEqual(gableEnds(make('roofGable', { facing: 90 })).map((e) => e.label), ['end toward +z', 'end toward -z']);
  assert.deepEqual(gableEnds(make('roofHip')), []);
  assert.deepEqual(gableEnds(make('roofT')).map((e) => e.label), ['Bar, -x arm, end toward -x', 'Bar, +x arm, end toward +x', 'Stem (along +z), end toward +z']);
  // A roof that recedes at one end only: the gable copies whether its own end recedes.
  const roof = make('roofGable', { double: 1, recede: 1, recedeEnds: 2 });
  assert.equal(matchGable(make('gable'), roof, 'end0').params.recedeHere, 1);
  assert.equal(matchGable(make('gable'), roof, 'end1').params.recedeHere, 0);
});

test('blocks touching roof pieces take the roof material (no bleed-through); none under block roofs or when turned off', () => {
  const RED = 196827131;
  const roof = make('roofGable', { double: 0 }, { position: [0, 3, 0] });
  const g = matchGable(make('gable', {}, { materialItem: 1 }), roof, 'end0');
  const cells = voxelizeScene([g]);
  const tops = new Map<string, number>();
  for (const c of cells) { const key = `${c.i},${c.k}`; tops.set(key, Math.max(tops.get(key) ?? -Infinity, c.j)); }
  for (const c of cells) assert.equal(c.materialItem, c.j === tops.get(`${c.i},${c.k}`) ? roof.materialItem : 1);
  assert.equal(roof.materialItem, RED);
  // Double thick: under the inside layer's blocks a gable keeps its own material (blocks against blocks don't bleed).
  const dbl = make('roofGable', { double: 1, innerMaterial: 777 }, { position: [0, 3, 0] });
  const inner = new Set(roofBlocks(dbl).inner.map(([i, j, k]) => `${i},${j - 1},${k}`));
  const gd = voxelizeScene([matchGable(make('gable', {}, { materialItem: 1 }), dbl, 'end1')]);
  assert.ok(gd.filter((c) => inner.has(`${c.i},${c.j},${c.k}`)).every((c) => c.materialItem === 1));
  // Off, or under a block roof: all the gable's material.
  for (const [r, over] of [[roof, { roofEdge: 0 }], [make('roofGable', { angle: 22.5, rows: 2 }), {}]] as [Shape, Record<string, number>][]) {
    const m = matchGable(make('gable', {}, { materialItem: 1 }), r, 'end0');
    assert.ok(voxelizeScene([{ ...m, params: { ...m.params, ...over } }]).every((c) => c.materialItem === 1));
  }
});

/** The blocks under a roof in the last `depth` slices toward a world direction (its extreme that way). */
function underToward(roof: Shape, dir: string, depth: number): Set<string> {
  const b = roofBounds(roof), ceil = roofCeiling(roof);
  const lo = b.min.map((v) => Math.round(v * 2)), hi = b.max.map((v) => Math.round(v * 2));
  const ax = dir[1] === 'x' ? 0 : 2, neg = dir[0] === '-';
  const out = new Set<string>();
  for (let i = lo[0]; i < hi[0]; i++) for (let k = lo[2]; k < hi[2]; k++) {
    const a = ax === 0 ? i : k;
    if (neg ? a >= lo[ax] + depth : a < hi[ax] - depth) continue;
    const t = ceil(i, k);
    if (t !== null) for (let j = lo[1]; j < t.top; j++) out.add(`${i},${j},${k}`);
  }
  return out;
}

test('a gable matched to an L, T or cross arm end fills exactly the space under it: pieces or blocks, layers, edging, any turn', () => {
  const cases: [JoinedKind, Record<string, number>][] = [
    ['roofL', {}], ['roofL', { facing: 90, double: 1 }], ['roofT', {}], ['roofT', { facing: 180, edging: 1, edgeSides: 1 }],
    ['roofT', { units: 1, lHeight: 2.5, rWidth: 15, rHeight: 7.5, rShift: 5, rLen: 2, sWidth: 5, sLen: 3 }],
    ['roofT', { units: 1, sAngle: 22.5, lWidth: 7, rWidth: 7, sWidth: 6, double: 2, recede: 1, facing: 270 }],
    ['roofCross', {}], ['roofCross', { pieceSize: 4, double: 1, recede: 1 }], ['roofCross', { units: 1, nxAngle: 67.5, pxWidth: 8, nzLen: 5, facing: 90 }],
  ];
  for (const [kind, p] of cases) {
    const roof = make(kind, p, { position: [2, 4, -1.5] });
    const ends = gableEnds(roof).filter((e) => e.which.startsWith('arm'));
    assert.equal(ends.length, ROOF_ARMS[kind].length, `${kind}: every arm ends in a gable by default`);
    for (const { which } of ends) for (const depth of [1, 2]) {
      const arm = ROOF_ARMS[kind][Number(which.slice(3))];
      const v = arm.along === '-x' ? [-1, 0, 0] : arm.along === '+x' ? [1, 0, 0] : arm.along === '-z' ? [0, 0, -1] : [0, 0, 1];
      const w = apply(eulerXYZ([0, roof.params.facing ?? 0, 0]), v as [number, number, number]);
      const dir = Math.abs(w[0]) > 0.5 ? (w[0] > 0 ? '+x' : '-x') : w[2] > 0 ? '+z' : '-z';
      const gable = matchGable(make('gable', { depth }), roof, which);
      const got = new Set(voxelizeScene([{ ...gable, params: cleanParams('gable', gable.params) }]).map((c) => `${c.i},${c.j},${c.k}`));
      const want = underToward(roof, dir, depth);
      const label = `${kind} ${JSON.stringify(p)} ${which} depth ${depth}`;
      assert.ok(want.size > 0, label);
      assert.equal([...want].filter((c) => !got.has(c)).length, 0, `${label}: missing`);
      assert.equal([...got].filter((c) => !want.has(c)).length, 0, `${label}: extra`);
    }
  }
  // A hip end has no gable to fill.
  assert.deepEqual(gableEnds(make('roofT', { sEnd: 1 })).map((e) => e.which).filter((w) => w.startsWith('arm')), ['arm0', 'arm1']);
});

test("an arm taller than the arm across from it offers its inner end too: a gable standing on the lower roof, under the taller one", () => {
  const cases: [JoinedKind, Record<string, number>, string][] = [
    ['roofT', { units: 1, lHeight: 2.5, rWidth: 15, rHeight: 7.5, rShift: 5, rLen: 2, sWidth: 5, sLen: 3 }, 'cut1'],
    ['roofT', { rRows: 2, facing: 90 }, 'cut1'], ['roofT', { lRows: 2 }, 'cut0'], ['roofCross', { pzRows: 2, facing: 180 }, 'cut3'],
  ];
  for (const [kind, p, which] of cases) {
    const roof = make(kind, p, { position: [1, 3, 0.5] });
    const ends = gableEnds(roof).map((e) => e.which);
    assert.ok(ends.includes(which), `${kind} ${JSON.stringify(p)}: ${ends}`);
    assert.equal(ends.filter((w) => w.startsWith('cut')).length, 1, 'only the taller arm');
    const gable = matchGable(make('gable', {}, { materialItem: 1 }), roof, which);
    const cells = voxelizeScene([{ ...gable, params: cleanParams('gable', gable.params) }]);
    assert.ok(cells.length > 0);
    // Clear of the roof's blocks, and every block under the roof (something of the roof above it).
    const roofCells = new Set(voxelizeScene([roof]).map((c) => `${c.i},${c.j},${c.k}`));
    assert.ok(cells.every((c) => !roofCells.has(`${c.i},${c.j},${c.k}`)), `${kind}: clear of the roof`);
    const ceil = roofCeiling(roof);
    assert.ok(cells.every((c) => { const t = ceil(c.i, c.k); return t !== null && c.j < t.top; }), `${kind}: under the roof`);
    // It stands on the lower roof: not down to the eaves' level everywhere.
    assert.ok(Math.min(...cells.map((c) => c.j)) >= Math.round(roofBounds(roof).min[1] * 2), kind);
  }
  // Arms of the same size: nothing at the junction.
  for (const kind of ['roofT', 'roofCross'] as const) assert.ok(!gableEnds(make(kind)).some((e) => e.which.startsWith('cut')), kind);
});

test('recede pushes a gable further into the roof along its ridge, full height there, at either end and under any arm', () => {
  const minus = (a: Set<string>, b: Set<string>) => new Set([...a].filter((c) => !b.has(c)));
  const cells = (g: Shape) => new Set(voxelizeScene([{ ...g, params: cleanParams('gable', g.params) }]).map((c) => `${c.i},${c.j},${c.k}`));
  for (const [kind, p] of [['roofGable', {}], ['roofGable', { facing: 90, double: 1, recede: 1 }], ['roofShed', { facing: 270 }]] as [ShapeKind, Record<string, number>][]) {
    const roof = make(kind, p, { position: [1.5, 3, -2] });
    for (const end of [0, 1] as const) for (const [inset, depth] of [[1, 1], [2, 3]]) {
      const got = cells(matchGable(make('gable', { depth, inset }), roof, `end${end}`));
      const want = minus(underEnd(roof, end, inset + depth), underEnd(roof, end, inset));
      assert.deepEqual([...got].sort(), [...want].sort(), `${kind} ${JSON.stringify(p)} end ${end} recede ${inset}`);
    }
  }
  const t = make('roofT', { rRows: 2 }, { position: [0, 2, 0] });
  for (const which of ['arm2', 'cut1']) {
    const a = cells(matchGable(make('gable'), t, which)), b = cells(matchGable(make('gable', { inset: 2 }), t, which));
    assert.ok(b.size > 0 && [...b].every((c) => !a.has(c)), `${which}: moved, not shrunk to nothing`);
  }
});

test('changing recede after matching moves the blocks in along the ridge, full height down to the eaves, at any depth', () => {
  const minus = (a: Set<string>, b: Set<string>) => new Set([...a].filter((c) => !b.has(c)));
  const cells = (g: Shape) => new Set(voxelizeScene([{ ...g, params: cleanParams('gable', g.params) }]).map((c) => `${c.i},${c.j},${c.k}`));
  const cases: [Shape, string, (d: number) => Set<string>][] = [];
  const gableRoof = make('roofGable', { facing: 90, double: 2, recede: 1 }, { position: [1, 3, -2] });
  cases.push([gableRoof, 'end1', (d) => underEnd(gableRoof, 1, d)]);
  const cross = make('roofCross', { pieceSize: 4, double: 2, nzRows: 2 }, { position: [0, 2, 0] });
  cases.push([cross, 'arm2', (d) => underToward(cross, '-z', d)]);
  for (const [roof, which, under] of cases) {
    const matched = matchGable(make('gable'), roof, which);
    for (const inset of [1, 2, 3, 5]) {
      // Edited afterward, as in the editor: the shape keeps its place, only the setting changes.
      const g = { ...matched, params: { ...matched.params, inset } };
      const want = minus(under(inset + 1), under(inset));
      assert.deepEqual([...cells(g)].sort(), [...want].sort(), `${roof.kind} ${which} recede ${inset}`);
    }
  }
});
