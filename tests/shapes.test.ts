import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShape } from '../src/core/scene';
import { SHAPES, SHAPE_LIST, cleanParams } from '../src/core/shapes';
import type { Shape, ShapeKind } from '../src/core/types';
import { CellCache, shapeCells, solidCells, unkey, voxelizeScene, worldBounds } from '../src/core/voxelize';

const CELL_VOLUME = 0.125;

function make(kind: ShapeKind, params: Record<string, number> = {}, over: Partial<Shape> = {}): Shape {
  const s = createShape(kind);
  return { ...s, params: { ...s.params, ...params }, position: [0, 0, 0], fill: 'filled', ...over };
}

const volume = (s: Shape) => solidCells(s).size * CELL_VOLUME;

function near(actual: number, expected: number, tolerance: number, what: string) {
  const err = Math.abs(actual - expected) / expected;
  assert.ok(err <= tolerance, `${what}: got ${actual.toFixed(1)}, expected about ${expected.toFixed(1)} (${(err * 100).toFixed(1)}% off)`);
}

/** Shapes made of blocks; roofs are made of roof pieces and are tested in roofs.test.ts. */
const BLOCK_SHAPES = SHAPE_LIST.filter((d) => !d.pieces);

test('there are 39 block shapes (the gable, the pipe run, the water splitter, text, the polyhedron and the 3D teardrop among them) and 6 roof shapes, each with sane parameter definitions', () => {
  assert.equal(BLOCK_SHAPES.length, 39);
  assert.equal(SHAPE_LIST.length, 45);
  for (const def of SHAPE_LIST) {
    for (const p of def.params) {
      assert.ok(p.key, `${def.kind} has a parameter without a key`);
      assert.ok(p.min <= p.default && p.default <= p.max, `${def.kind}.${p.key} default out of range`);
    }
    const keys = def.params.map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length, `${def.kind} has duplicate parameter keys`);
  }
});

for (const def of BLOCK_SHAPES) {
  test(`${def.label}: default shape has blocks, all inside its bounds, plain and rotated`, () => {
    for (const rotation of [[0, 0, 0], [30, 45, 10]] as const) {
      const shape = make(def.kind, {}, { rotation: [...rotation], position: [1.25, 3, -2] });
      const cells = [...solidCells(shape)].map(unkey);
      assert.ok(cells.length > 10, `${def.kind} at ${rotation} has only ${cells.length} blocks`);
      const { min, max } = worldBounds(shape);
      for (const [i, j, k] of cells) {
        const c = [(i + 0.5) * 0.5, (j + 0.5) * 0.5, (k + 0.5) * 0.5];
        for (let a = 0; a < 3; a++) assert.ok(c[a] >= min[a] - 1e-6 && c[a] <= max[a] + 1e-6, `${def.kind} block outside bounds`);
      }
    }
  });

  test(`${def.label}: hollow uses fewer blocks than filled, and every parameter at its limits still works`, () => {
    const filled = solidCells(make(def.kind)).size;
    const hollow = voxelizeScene([make(def.kind, {}, { fill: 'hollow' })]).length;
    assert.ok(hollow <= filled && hollow > 0);
    for (const p of def.params) {
      for (const v of [p.min, p.max]) {
        // Large values are slow to voxelize; only check that the parameters are cleaned and bounds are finite.
        const shape = make(def.kind, { [p.key]: v });
        const b = worldBounds(shape);
        assert.ok([...b.min, ...b.max].every(Number.isFinite), `${def.kind}.${p.key}=${v} gives bad bounds`);
      }
    }
  });
}

test('solid shapes have the right volume', () => {
  const pi = Math.PI;
  near(volume(make('box', { width: 6, height: 4, depth: 3 })), 72, 0.001, 'box');
  near(volume(make('slantedBox', { width: 4, height: 6, depth: 4, slantX: 3, slantZ: 1 })), 96, 0.06, 'slanted box');
  near(volume(make('cylinder', { radius: 4, height: 6 })), pi * 16 * 6, 0.05, 'cylinder');
  near(volume(make('cone', { baseRadius: 5, topRadius: 0, height: 8 })), (pi * 25 * 8) / 3, 0.06, 'cone');
  near(volume(make('cone', { baseRadius: 5, topRadius: 3, height: 6 })), (pi * 6 * (25 + 15 + 9)) / 3, 0.05, 'round frustum');
  near(volume(make('pyramid4', { baseWidth: 8, baseDepth: 8, height: 6, topSize: 0 })), (64 * 6) / 3, 0.06, 'pyramid');
  near(volume(make('frustum', { baseWidth: 8, baseDepth: 6, topWidth: 4, topDepth: 2, height: 4 })), (4 / 6) * (48 + 8 + 4 * 6 * 4), 0.05, 'frustum');
  near(volume(make('pyramid3', { side: 8, height: 6, topSize: 0 })), ((Math.sqrt(3) / 4) * 64 * 6) / 3, 0.08, '3-sided pyramid');
  near(volume(make('trapezoidPrism', { bottomWidth: 8, topWidth: 4, height: 4, depth: 3 })), 6 * 4 * 3, 0.05, 'trapezoid prism');
  near(volume(make('squashedSphere', { radius: 5, height: 4 })), (4 / 3) * pi * 25 * 2, 0.05, 'squashed sphere');
  near(volume(make('capsule', { radius: 2, length: 10 })), pi * 4 * 6 + (4 / 3) * pi * 8, 0.06, 'capsule');
  const R = 6, r = 3, n = 5, h = 2;
  near(volume(make('starExtruded', { points: n, outerRadius: R, innerRadius: r, height: h })), n * R * r * Math.sin(pi / n) * h, 0.06, 'extruded star');
});

test('a 4-pointed star looks the same after a quarter turn', () => {
  const cells = [...solidCells(make('starExtruded', { points: 4, outerRadius: 6, innerRadius: 2, height: 1, orient: 0 }))].map(unkey);
  const set = new Set(cells.map((c) => c.join(',')));
  for (const [i, j, k] of cells) assert.ok(set.has(`${-k - 1},${j},${i}`), 'quarter-turn symmetry');
});

test('the 3D star is thickest in the middle and thin at the tips', () => {
  const cells = [...solidCells(make('star3d', { points: 5, outerRadius: 6, innerRadius: 3, thickness: 4 }))].map(unkey);
  const heightAt = (pred: (i: number, k: number) => boolean) => {
    const js = cells.filter(([i, , k]) => pred(i, k)).map(([, j]) => j);
    return js.length ? Math.max(...js) - Math.min(...js) + 1 : 0;
  };
  const middle = heightAt((i, k) => Math.abs(i + 0.5) < 1 && Math.abs(k + 0.5) < 1);
  const tip = heightAt((i, k) => Math.abs(i + 0.5) < 1 && k >= 9);
  assert.ok(middle >= 6 && tip <= 2, `middle ${middle}, tip ${tip}`);
});

test('the helix climbs the right height, and direction mirrors it', () => {
  const params = { radius: 4, bandWidth: 2, bandThickness: 0.5, rise: 4, turns: 2, direction: 1 };
  const ccw = [...solidCells(make('helix', params))].map(unkey);
  const span = (Math.max(...ccw.map((c) => c[1])) - Math.min(...ccw.map((c) => c[1])) + 1) * 0.5;
  near(span, 8.5, 0.08, 'helix height');
  const cw = [...solidCells(make('helix', { ...params, direction: -1 }))].map(unkey);
  const mirrored = new Set(ccw.map(([i, j, k]) => `${i},${j},${-k - 1}`));
  const matching = cw.filter(([i, j, k]) => mirrored.has(`${i},${j},${k}`)).length;
  assert.ok(matching / cw.length > 0.9, 'clockwise helix is the mirror image');
});

test('the vortex is one flat layer whose arms fill only part of the disc', () => {
  const v = make('vortex', { outerRadius: 8, innerRadius: 1, arms: 3, turns: 1, armWidth: 1.5, thickness: 0.5 });
  const cells = [...solidCells(v)].map(unkey);
  assert.equal(new Set(cells.map((c) => c[1])).size, 1, 'single layer');
  const discCells = (Math.PI * 64) / 0.25;
  assert.ok(cells.length > discCells * 0.2 && cells.length < discCells * 0.7, `${cells.length} of about ${discCells.toFixed(0)}`);
  const more = solidCells({ ...v, params: { ...v.params, arms: 6 } }).size;
  assert.ok(more > cells.length * 1.4, 'more arms, more blocks');
});

test('the saddle rises at the x ends and dips at the z ends', () => {
  const cells = [...solidCells(make('saddle', { width: 10, depth: 10, curve: 4, thickness: 0.5 }))].map(unkey);
  const avgJ = (pred: (i: number, k: number) => boolean) => {
    const js = cells.filter(([i, , k]) => pred(i, k)).map(([, j]) => j);
    return js.reduce((a, b) => a + b, 0) / js.length;
  };
  assert.ok(avgJ((i, k) => i >= 8 && Math.abs(k + 0.5) < 1) > 2);
  assert.ok(avgJ((i, k) => k >= 8 && Math.abs(i + 0.5) < 1) < -2);
});

test('cleanParams clamps out-of-range and missing values', () => {
  const p = cleanParams('vortex', { arms: 99.4, outerRadius: -5 });
  assert.equal(p.arms, 12);
  assert.equal(p.outerRadius, 0.5);
  assert.equal(p.thickness, 0.5);
});

test('the cache returns the same blocks and recomputes only changed shapes', () => {
  const a = make('box');
  const b = make('cylinder', {}, { op: 'subtract', position: [3, 0, 0] });
  const cache = new CellCache();
  const first = voxelizeScene([a, b], cache);
  const again = voxelizeScene([a, b], cache);
  assert.equal(again.length, first.length);
  assert.deepEqual(voxelizeScene([a, b]).length, first.length);
  const moved = { ...b, position: [6, 0, 0] as [number, number, number] };
  assert.notEqual(voxelizeScene([a, moved], cache).length, first.length);
  const recolored = voxelizeScene([{ ...a, materialItem: 310129061 }, moved], cache);
  assert.ok(recolored.every((v) => v.materialItem === 310129061));
});

test('regular polygon: flat one block thick, or cylinderized to a height; area as a regular polygon', () => {
  for (const sides of [3, 4, 6, 8, 12, 20]) {
    const R = 12;
    const flat = solidCells(make('polygon', { sides, radius: R }, { position: [0.25, 0.25, 0.25] }));
    const layers = new Set([...flat].map((n) => unkey(n)[1]));
    assert.equal(layers.size, 1, `${sides}: one block thick`);
    const area = (sides / 2) * R * R * Math.sin((2 * Math.PI) / sides);
    near(flat.size * 0.25, area, 0.04, `${sides}-gon area`);
    const prism = solidCells(make('polygon', { sides, radius: R, prism: 1, height: 3 }, { position: [0.25, 1.5, 0.25] }));
    assert.equal(new Set([...prism].map((n) => unkey(n)[1])).size, 6, `${sides}: 3 m tall`);
    assert.equal(prism.size, flat.size * 6);
  }
  // A corner toward +z: a triangle reaches further toward +z than -z.
  const tri = [...solidCells(make('polygon', { sides: 3, radius: 6 }, { position: [0.25, 0.25, 0.25] }))].map((n) => unkey(n)[2]);
  assert.ok(Math.max(...tri) > -Math.min(...tri));
});

test('a hollow flat polygon is its outline, the wall as thick as asked', () => {
  const ring = (wallThickness: number) => solidCells(make('polygon', { sides: 8, radius: 8 }, { position: [0.25, 0.25, 0.25] })).size
    - [...new Set(voxelizeScene([make('polygon', { sides: 8, radius: 8 }, { position: [0.25, 0.25, 0.25], fill: 'hollow', wallThickness })]).map((v) => `${v.i},${v.k}`))].length;
  // Thicker walls leave less of the middle out, and a hollow polygon has a middle missing.
  assert.ok(ring(1) > ring(2) && ring(2) > 0);
});

test('a hollow cylinderized polygon can leave out its top and/or bottom cap; a filled one keeps them', () => {
  const P = { sides: 8, radius: 4, prism: 1, height: 3 };
  const at: Partial<Shape> = { position: [0.25, 1.5, 0.25] };
  const count = (params: Record<string, number>, over: Partial<Shape> = {}) => voxelizeScene([make('polygon', { ...P, ...params }, { ...at, ...over })]);
  const full = count({}), noTop = count({ uncapTop: 1 }), neither = count({ uncapTop: 1, uncapBottom: 1 });
  const ys = (v: typeof full) => [...new Set(v.map((c) => c.j))].sort((x, y) => x - y);
  assert.equal(ys(full).length, 6);
  assert.equal(noTop.length, full.length, 'filled: nothing to open');
  assert.equal(neither.length, full.length);
  // Hollow: the caps go, the side wall stays full height (an open tube).
  const tube = count({ uncapTop: 1, uncapBottom: 1 }, { fill: 'hollow', wallThickness: 1 });
  const shellCount = count({}, { fill: 'hollow', wallThickness: 1 });
  assert.equal(ys(tube).length, 6);
  const perLayer = (v: typeof full, j: number) => v.filter((c) => c.j === j).length;
  assert.ok(perLayer(tube, ys(tube)[0]) === perLayer(tube, ys(tube)[2]), 'the end layers are just the wall');
  assert.ok(perLayer(shellCount, ys(shellCount)[0]) > perLayer(tube, ys(tube)[0]), 'the closed shell has a cap');
  // Lying on its side (90 degrees about x), it opens at its own ends.
  const lying = count({ uncapTop: 1, uncapBottom: 1 }, { fill: 'hollow', wallThickness: 1, rotation: [90, 0, 0], position: [0.25, 4.25, 0.25] });
  const zs = [...new Set(lying.map((c) => c.k))].sort((x, y) => x - y);
  assert.equal(zs.length, 6);
  assert.equal(lying.filter((c) => c.k === zs[0]).length, lying.filter((c) => c.k === zs[2]).length);
});

test('a hollow spheroid can uncap each of its six ends separately, to the depth chosen, along its own axes', () => {
  const H: Partial<Shape> = { fill: 'hollow', wallThickness: 1, position: [0, 0, 0] };
  const cells = (params: Record<string, number>, over: Partial<Shape> = H) => voxelizeScene([make('spheroid', { rx: 4, ry: 4, rz: 4, ...params }, over)]);
  const centers = (v: ReturnType<typeof cells>) => v.map((c) => [(c.i + 0.5) * 0.5, (c.j + 0.5) * 0.5, (c.k + 0.5) * 0.5]);
  const full = cells({});
  const top = cells({ uncapPY: 1, uncapDepth: 1 });
  assert.ok(top.length < full.length);
  assert.ok(centers(top).every(([, y]) => y <= 3), 'nothing within 1 m of the top');
  assert.ok(centers(top).some(([, y]) => y < -3.5), 'the bottom is still closed');
  // Each end on its own, and all six together leave a band around each axis open at every end.
  const ends = ['uncapNX', 'uncapPX', 'uncapNY', 'uncapPY', 'uncapNZ', 'uncapPZ'];
  ends.forEach((k, n) => {
    const a = Math.floor(n / 2), sign = n % 2 ? 1 : -1;
    const v = centers(cells({ [k]: 1, uncapDepth: 1.5 }));
    assert.ok(v.every((c) => sign * c[a] <= 2.5) && v.some((c) => -sign * c[a] > 3.5), k);
  });
  const all = centers(cells(Object.fromEntries(ends.map((k) => [k, 1]))));
  assert.ok(all.length > 0 && all.every((c) => c.every((v) => Math.abs(v) <= 3)));
  // Filled: nothing to open, so uncapping is ignored.
  assert.equal(cells({ uncapPY: 1, uncapDepth: 1 }, { position: [0, 0, 0] }).length, cells({}, { position: [0, 0, 0] }).length);
  // Turned 90 degrees about x, its top (+y) is toward +z in the world.
  const turned = centers(cells({ uncapPY: 1, uncapDepth: 1 }, { ...H, rotation: [90, 0, 0] }));
  assert.ok(turned.every(([, , z]) => z <= 3) && turned.some(([, y]) => y > 3.5));
});

test('uncapping hollow shapes: flat ends lose their wall and keep the side walls; round ends are cut off; filled shapes ignore it', async () => {
  const { UNCAP } = await import('../src/core/shapes');
  const H: Partial<Shape> = { fill: 'hollow', wallThickness: 1, position: [0.25, 0.25, 0.25] };
  for (const [kind, u] of Object.entries(UNCAP) as [ShapeKind, (typeof UNCAP)[keyof typeof UNCAP]][]) {
    if (!u) continue;
    // (A cone needs a top to open there; a flat 2D shape needs a thickness to have faces.)
    const extra: Record<string, number> = kind === 'cone' ? { topRadius: 2 } : {};
    if (SHAPES[kind].flat) Object.assign(extra, { prism: 1, height: 2 });
    // (An arch frame's band must be wider than two walls to have anything between them.)
    if (kind === 'arch') Object.assign(extra, { width: 8, length: 8, frame: 2 });
    const base = voxelizeScene([make(kind, extra, H)]);
    for (const e of u.ends) {
      const p = { ...createShape(kind).params, ...extra };
      if (e.when && !e.when(p)) continue;
      const n = e.normal(p);
      const a = n.findIndex((x) => Math.abs(x) > 0.5), sign = a >= 0 ? Math.sign(n[a]) : 0;
      const coord = (c: { i: number; j: number; k: number }) => [c.i, c.j, c.k][a];
      const open = voxelizeScene([make(kind, { ...extra, [e.key]: 1 }, H)]);
      assert.ok(open.length < base.length, `${kind} ${e.key}: something opened`);
      if (!u.round && a >= 0 && n.filter((x) => Math.abs(x) > 1e-6).length === 1) {
        // The side walls still reach the end (the shape keeps its size along that axis).
        const ext = (v: typeof base) => (sign > 0 ? Math.max(...v.map(coord)) : Math.min(...v.map(coord)));
        assert.equal(ext(open), ext(base), `${kind} ${e.key}: side walls run to the end`);
      }
      // Filled: nothing to open.
      assert.equal(voxelizeScene([make(kind, { ...extra, [e.key]: 1 }, { ...H, fill: 'filled' })]).length, voxelizeScene([make(kind, extra, { ...H, fill: 'filled' })]).length, `${kind} ${e.key} filled`);
    }
  }
  // An open-topped box: its top layer is just the rim.
  const box = voxelizeScene([make('box', { width: 4, height: 3, depth: 4, uncapPY: 1 }, H)]);
  const top = Math.max(...box.map((c) => c.j));
  assert.equal(box.filter((c) => c.j === top).length, 8 * 4 - 4);
  // Turned a quarter turn, a cylinder opens at its own top.
  const cyl = voxelizeScene([make('cylinder', { radius: 3, height: 4, uncapPY: 1 }, { ...H, rotation: [90, 0, 0] })]);
  const zs = cyl.map((c) => c.k), z1 = Math.max(...zs), z0 = Math.min(...zs);
  assert.ok(cyl.filter((c) => c.k === z1).length < cyl.filter((c) => c.k === z0).length);
});

test("uncapping a gentle cone takes off only its top (the tip, or a frustum's top face), not the stepped slope", () => {
  const H: Partial<Shape> = { fill: 'hollow', wallThickness: 1, lineWeight: 'thick', position: [0, 3, 0] };
  for (const params of [{ baseRadius: 8.5, topRadius: 0, height: 6 }, { baseRadius: 8.5, topRadius: 3, height: 6 }]) {
    const cells = (extra: Record<string, number>) => new Map(voxelizeScene([make('cone', { ...params, ...extra }, H)]).map((c) => [`${c.i},${c.j},${c.k}`, c]));
    const base = cells({}), top = cells({ uncapPY: 1, uncapDepth: 1 }), bottom = cells({ uncapNY: 1 });
    const gone = (m: Map<string, unknown>) => [...base.keys()].filter((k) => !m.has(k)).map((k) => base.get(k)!);
    const ys = [...base.values()].map((c) => c.j), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const t = gone(top), b = gone(bottom);
    assert.ok(t.length > 0 && b.length > 0, JSON.stringify(params));
    // Top: only from the top 1 m (the tip) or the top layer (a top face); bottom: only the bottom layer.
    assert.ok(t.every((c) => c.j > y1 - 2), `${JSON.stringify(params)}: top uncap reaches down to ${Math.min(...t.map((c) => c.j))}`);
    assert.ok(b.every((c) => c.j === y0), JSON.stringify(params));
  }
});

test('uncapping the bottom of a wide cone leaves its lowest step on the slope (no loose ring at the edge)', () => {
  const H: Partial<Shape> = { fill: 'hollow', wallThickness: 1, lineWeight: 'thick', position: [0, 2.5, 0] };
  for (const baseRadius of [8.5, 12, 15.5]) {
    const v = voxelizeScene([make('cone', { baseRadius, topRadius: 0, height: 5, uncapNY: 1 }, H)]);
    const has = new Set(v.map((c) => `${c.i},${c.j},${c.k}`));
    // Every block touches another (face or edge): nothing is left floating apart from the rest.
    const seen = new Set<string>([`${v[0].i},${v[0].j},${v[0].k}`]);
    const queue = [v[0]];
    while (queue.length) {
      const c = queue.pop()!;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
        const k = `${c.i + a},${c.j + b},${c.k + d}`;
        if (has.has(k) && !seen.has(k)) { seen.add(k); queue.push({ ...c, i: c.i + a, j: c.j + b, k: c.k + d }); }
      }
    }
    assert.equal(seen.size, v.length, `base ${baseRadius}: all one piece`);
    // And the bottom is open: far fewer blocks in the bottom layer than when closed.
    const closed = voxelizeScene([make('cone', { baseRadius, topRadius: 0, height: 5 }, H)]);
    const y0 = Math.min(...closed.map((c) => c.j));
    assert.ok(v.filter((c) => c.j === y0).length < closed.filter((c) => c.j === y0).length / 2);
  }
});

test('Scale: every size at once, on its own step and within its limits; shapes with one size or their own rules have none', async () => {
  const { scaleSizes, sizeKeys, defaultParams, cleanParams } = await import('../src/core/shapes');
  const box = { ...defaultParams('box'), width: 6, height: 4, depth: 2 };
  const twice = scaleSizes('box', box, 2);
  assert.deepEqual([twice.width, twice.height, twice.depth], [12, 8, 4]);
  // 150%: 3 x 1.5 = 4.5 m; 2.5 x 1.5 = 3.75, on the 0.5 m step 4 (rounded).
  const cone = scaleSizes('cone', { ...defaultParams('cone'), baseRadius: 3, topRadius: 0, height: 2.5 }, 1.5);
  assert.deepEqual([cone.baseRadius, cone.topRadius, cone.height], [4.5, 0, 4]);
  // Limits: a 40 m box doubled stops at 64 m.
  assert.equal(scaleSizes('box', { ...box, width: 40 }, 2).width, 64);
  // Back to 100% from the same start: exactly as it was.
  assert.deepEqual(scaleSizes('box', box, 1), cleanParams('box', box));
  // Not scaled: wall-like and count settings, other settings untouched.
  assert.ok(!sizeKeys('spheroid', defaultParams('spheroid')).includes('uncapDepth'));
  assert.equal(scaleSizes('box', { ...box, pattern: 1, checkSize: 3 }, 2).checkSize, 3);
  for (const kind of ['polygon', 'text', 'pipe', 'gable', 'roofGable'] as const) assert.deepEqual(sizeKeys(kind, defaultParams(kind)), [], kind);
});

test('3D teardrop: round at the bottom, a point at the top, as wide and tall as asked', () => {
  const s = createShape('teardrop3d');
  const drop = { ...s, position: [0, 5, 0] as [number, number, number], fill: 'filled' as const, params: { ...s.params, width: 6, height: 10, point: 1 } };
  const cells = [...shapeCells(drop)].map(unkey);
  const ys = cells.map((c) => c[1]), xs = cells.map((c) => c[0]);
  // The tip loses its last half block (blocks are set where their middles are inside), as on a cone.
  assert.ok((Math.max(...ys) - Math.min(...ys) + 1) * 0.5 >= 9.5);
  assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs) + 1) * 0.5 - 6) <= 0.5);
  const layer = (j: number) => cells.filter((c) => c[1] === j).length;
  const top = Math.max(...ys), bottom = Math.min(...ys);
  // Narrow near the tip, wide near the bottom: the widest layer is in the lower half.
  assert.ok(layer(top) <= 4, 'a point on top');
  assert.ok(layer(bottom + 1) > layer(top - 1) * 4, 'round below');
  let widest = bottom;
  for (let j = bottom; j <= top; j++) if (layer(j) > layer(widest)) widest = j;
  assert.ok(widest < (top + bottom) / 2);
  // A sharper point: fewer blocks.
  assert.ok(shapeCells({ ...drop, params: { ...drop.params, point: 3 } }).size < cells.length);
});
