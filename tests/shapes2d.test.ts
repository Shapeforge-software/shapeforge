import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShape } from '../src/core/scene';
import { SHAPES, SHAPE_LIST, UNCAP, cleanParams } from '../src/core/shapes';
import type { Shape, ShapeKind } from '../src/core/types';
import { voxelizeScene } from '../src/core/voxelize';

const make = (kind: ShapeKind, params: Record<string, number> = {}, over: Partial<Shape> = {}): Shape => {
  const s = createShape(kind);
  return { ...s, position: [0.25, 0.25, 0.25], fill: 'filled', ...over, params: { ...s.params, ...params } };
};
const spread = (v: ReturnType<typeof voxelizeScene>, a: 'i' | 'j' | 'k') => new Set(v.map((c) => c[a])).size;

const NEW_2D: ShapeKind[] = ['ellipse', 'ring', 'arc', 'pill', 'roundedRect', 'superellipse', 'crescent', 'lens', 'heart', 'teardrop', 'shield', 'rose', 'leaf', 'arch', 'grid', 'gear'];
const PROFILES = SHAPE_LIST.filter((d) => d.flat);

test('the 2D shapes come first in the list, under their own heading, old ones included', () => {
  const twoD = SHAPE_LIST.filter((d) => d.group === '2D shapes').map((d) => d.kind);
  for (const k of [...NEW_2D, 'polygon', 'starExtruded', 'vortex'] as ShapeKind[]) assert.ok(twoD.includes(k), k);
  // The extruded trapezoid is a 3D shape again (0.22.3).
  assert.equal(SHAPES.trapezoidPrism.group, '3D shapes');
  assert.ok(!SHAPES.trapezoidPrism.params.some((p) => p.key === 'orient'));
  assert.deepEqual(SHAPE_LIST.slice(0, twoD.length).map((d) => d.kind), twoD, '2D shapes lead the list');
  assert.equal(PROFILES.length, 18);
  const groups = [...new Set(SHAPE_LIST.map((d) => d.group))];
  assert.deepEqual(groups, ['2D shapes', 'Text', '3D shapes', 'Roofs', 'Pipes']);
});

for (const def of PROFILES) {
  test(`${def.kind}: one block thick lying or standing, its thickness when cylinderized, an outline when hollow`, () => {
    const k = def.kind;
    const lying = voxelizeScene([make(k, { orient: 0 })]);
    const standing = voxelizeScene([make(k, { orient: 1 })]);
    assert.ok(lying.length > 4, `${k} has blocks`);
    assert.equal(spread(lying, 'j'), 1, `${k} lying is one layer`);
    assert.equal(spread(standing, 'k'), 1, `${k} standing is one layer deep`);
    // Text lying is flipped to read from above, so a letter edge exactly on a block's middle can tip the other way.
    if (k === 'text') assert.ok(Math.abs(standing.length - lying.length) <= lying.length * 0.02, `${k} about the same blocks either way`);
    else assert.equal(standing.length, lying.length, `${k} same blocks either way`);
    // Cylinderized: 3 m thick is 6 layers, each the flat outline.
    const thick = voxelizeScene([make(k, { orient: 0, prism: 1, height: 3 })]);
    assert.equal(spread(thick, 'j'), 6, `${k} cylinderized`);
    assert.equal(thick.length, 6 * lying.length, `${k} every layer is the shape`);
    const standThick = voxelizeScene([make(k, { orient: 1, prism: 1, height: 3 })]);
    assert.equal(spread(standThick, 'k'), 6, `${k} cylinderized standing`);
    // Hollow and flat: the outline, still one layer. (A flat arch frame is a band already; a grid's bars are thin.)
    const hollow = voxelizeScene([make(k, { orient: 0 }, { fill: 'hollow', wallThickness: 0.5 })]);
    assert.equal(spread(hollow, 'j'), 1, `${k} hollow is one layer`);
    if (k === 'grid' || def.solidOnly?.(cleanParams(k, createShape(k).params))) assert.equal(hollow.length, lying.length, `${k} nothing to hollow`);
    else assert.ok(hollow.length < lying.length, `${k} hollow is an outline`);
  });
}

test('which shapes stand by default, and which ends of each can be uncapped', () => {
  const standing = SHAPE_LIST.filter((d) => d.params.some((p) => p.key === 'orient' && p.default === 1)).map((d) => d.kind).sort();
  assert.deepEqual(standing, ['arch', 'gear', 'grid', 'heart', 'shield', 'starExtruded', 'teardrop', 'text']);
  const ends = (k: ShapeKind) => (UNCAP[k]?.ends ?? []).map((e) => e.key);
  assert.deepEqual(ends('crescent'), []);
  assert.deepEqual(ends('grid'), []);
  assert.deepEqual(ends('arc'), ['uncapBottom', 'uncapTop', 'uncapStart', 'uncapEnd']);
  assert.deepEqual(ends('arch'), ['uncapBottom', 'uncapTop', 'uncapBase']);
  for (const k of ['ellipse', 'ring', 'pill', 'roundedRect', 'superellipse', 'lens', 'heart', 'teardrop', 'shield', 'rose', 'leaf', 'gear', 'polygon'] as ShapeKind[]) assert.deepEqual(ends(k), ['uncapBottom', 'uncapTop'], k);
  // The faces are only offered on a cylinderized shape thicker than one block.
  const face = UNCAP.ellipse!.ends[0];
  assert.equal(face.when!(cleanParams('ellipse', { prism: 0 })), false);
  assert.equal(face.when!(cleanParams('ellipse', { prism: 1, height: 2 })), true);
  assert.deepEqual(['Bottom', 'Back'], [face.short(cleanParams('ellipse', { orient: 0 })), face.short(cleanParams('ellipse', { orient: 1 }))]);
});

test('a cylinderized ring uncapped top and bottom is an open tube with both walls', () => {
  const P = { orient: 0, prism: 1, height: 2, outerRadius: 4, innerRadius: 2 };
  const H: Partial<Shape> = { fill: 'hollow', wallThickness: 0.5 };
  const closed = voxelizeScene([make('ring', P, H)]);
  const open = voxelizeScene([make('ring', { ...P, uncapTop: 1, uncapBottom: 1 }, H)]);
  const layer = (v: typeof open, n: number) => { const js = [...new Set(v.map((c) => c.j))].sort((a, b) => a - b); return v.filter((c) => c.j === js[n]).length; };
  assert.equal(spread(open, 'j'), 4);
  assert.equal(layer(open, 0), layer(open, 1), 'the end layer is just the two walls');
  assert.ok(layer(closed, 0) > layer(open, 0));
  // Saved before 0.22, a polygon's "remove top" still opens its top.
  assert.equal(cleanParams('polygon', { removeTop: 1 }).uncapTop, 1);
});

test('the arch: a frame open at the bottom by default, or its silhouette; a flat frame has no hollow / filled', () => {
  const frame = voxelizeScene([make('arch')]);
  const sil = voxelizeScene([make('arch', { archMode: 1 })]);
  assert.ok(frame.length < sil.length);
  const bottom = Math.min(...frame.map((c) => c.j));
  const xs = frame.filter((c) => c.j === bottom).map((c) => c.i);
  // Two posts at the bottom, nothing between them.
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  assert.ok(!xs.some((i) => Math.abs(i + 0.5 - (mid + 0.5)) < 1), 'open at the bottom');
  const p = (x: Record<string, number>) => cleanParams('arch', { ...createShape('arch').params, ...x });
  assert.equal(SHAPES.arch.solidOnly!(p({})), true);
  assert.equal(SHAPES.arch.solidOnly!(p({ prism: 1 })), false);
  assert.equal(SHAPES.arch.solidOnly!(p({ archMode: 1 })), false);
  // Every style builds.
  for (const style of [0, 1, 2, 3]) assert.ok(voxelizeScene([make('arch', { style })]).length > 0, `style ${style}`);
});

test('star and vortex can lie or stand; saved builds without the setting look as before', () => {
  for (const [k, native] of [['starExtruded', 0], ['vortex', 0]] as [ShapeKind, number][]) {
    const { orient: _drop, ...old } = createShape(k).params;
    const as = (params: Record<string, number>): Shape => ({ ...make(k), params });
    const before = voxelizeScene([as(old)]);
    assert.deepEqual(voxelizeScene([as({ ...old, orient: native })]), before, `${k}: saved without the setting, as drawn`);
    const other = voxelizeScene([as({ ...old, orient: 1 - native })]);
    assert.equal(other.length, before.length, `${k} same block count turned`);
    // Turned a quarter turn about x: the y and z sizes trade places.
    assert.deepEqual([spread(other, 'j'), spread(other, 'k')], [spread(before, 'k'), spread(before, 'j')], k);
  }
  // A new extruded star starts standing; the vortex lying.
  assert.equal(createShape('starExtruded').params.orient, 1);
  assert.equal(createShape('vortex').params.orient, 0);
});

test('every 2D shape builds at its extremes without errors', () => {
  for (const def of PROFILES) {
    for (const pick of ['min', 'max'] as const) {
      const params: Record<string, number> = {};
      for (const p of def.params) if (!p.choices && p.key !== 'height') params[p.key] = pick === 'min' ? p.min : Math.min(p.max, p.min + (p.max - p.min) / 4);
      const cells = voxelizeScene([make(def.kind, params)]);
      assert.ok(Array.isArray(cells), `${def.kind} ${pick}`);
    }
  }
});

test('uncapping works at any rotation: a tilted hollow prism or cylinder opens fully, keeping its side wall', async () => {
  const { eulerXYZ, transpose, apply } = await import('../src/core/math');
  const cases: { kind: ShapeKind; params: Record<string, number>; rotation: [number, number, number]; core: (l: number[]) => boolean; rim: (l: number[]) => boolean; axis: number; half: number }[] = [
    // The reported case: a standing rounded rectangle turned 40° about x.
    { kind: 'roundedRect', params: { width: 18.5, length: 16, corner: 5, orient: 1, prism: 1, height: 4.5 }, rotation: [40, 0, 0],
      core: ([x, y]) => SHAPES.roundedRect.inside(cleanParams('roundedRect', { width: 15.9, length: 13.4, corner: 3.7, orient: 1, prism: 1, height: 10 }), [x, y, 0]),
      rim: ([x, y]) => !SHAPES.roundedRect.inside(cleanParams('roundedRect', { width: 17, length: 14.5, corner: 4.3, orient: 1, prism: 1, height: 10 }), [x, y, 0]), axis: 2, half: 2.25 },
    { kind: 'cylinder', params: { radius: 6, height: 5 }, rotation: [25, 30, 0],
      core: ([x, , z]) => Math.hypot(x, z) < 4.6, rim: ([x, , z]) => Math.hypot(x, z) > 5.2, axis: 1, half: 2.5 },
    { kind: 'ellipse', params: { width: 12, length: 9, orient: 0, prism: 1, height: 3 }, rotation: [0, 0, 35],
      core: ([x, , z]) => (x / 4.7) ** 2 + (z / 3.2) ** 2 < 1, rim: ([x, , z]) => (x / 5.3) ** 2 + (z / 3.8) ** 2 > 1, axis: 1, half: 1.5 },
  ];
  for (const c of cases) {
    const ends: Record<string, number> = c.kind === 'cylinder' ? { uncapNY: 1, uncapPY: 1 } : { uncapBottom: 1, uncapTop: 1 };
    const shape = make(c.kind, { ...c.params, ...ends }, { fill: 'hollow', wallThickness: 1, rotation: c.rotation, position: [0, 8, 0] });
    const inv = transpose(eulerXYZ(c.rotation));
    const local = (v: { i: number; j: number; k: number }) => apply(inv, [(v.i + 0.5) * 0.5, (v.j + 0.5) * 0.5 - 8, (v.k + 0.5) * 0.5]);
    const open = voxelizeScene([shape]).map(local);
    const closed = voxelizeScene([{ ...shape, params: { ...shape.params, uncapBottom: 0, uncapTop: 0, uncapNY: 0, uncapPY: 0 } }]).map(local);
    assert.equal(open.filter(c.core).length, 0, `${c.kind}: nothing left of its faces`);
    assert.ok(closed.filter(c.core).length > 100, `${c.kind}: closed, it has faces`);
    // The side wall is untouched: every block it keeps is still there, and away from the ends nothing changed.
    assert.ok(closed.filter(c.rim).length > 100);
    const key = (l: number[]) => l.map((x) => x.toFixed(3)).join();
    const kept = new Set(open.map(key));
    const lost = closed.filter((l) => !kept.has(key(l)));
    assert.ok(lost.every((l) => Math.abs(l[c.axis]) > c.half - 1.3), `${c.kind}: only the ends lost blocks`);
    assert.ok(open.filter(c.rim).length >= 0.9 * closed.filter(c.rim).length, `${c.kind}: the outer wall stays`);
  }
});
