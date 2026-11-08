import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POLYHEDRA, placeSolid, solidCounts } from '../src/core/polyhedra';
import { createShape } from '../src/core/scene';
import type { Shape } from '../src/core/types';
import { shapeCells } from '../src/core/voxelize';
import { unkey } from '../src/core/voxelize-keys';

const poly = (solid: number, stand: number, height: number, extra: Partial<Shape> = {}): Shape => {
  const s = createShape('polyhedron');
  return { ...s, position: [0, height / 2, 0], fill: 'filled', params: { ...s.params, solid, stand, height }, ...extra };
};
const blocks = (s: Shape) => [...shapeCells(s)].map(unkey);
const PHI = (1 + Math.sqrt(5)) / 2;

test('the six solids have the right faces, corners and edges', () => {
  const want = [[4, 4, 6], [6, 8, 12], [8, 6, 12], [10, 12, 20], [12, 20, 30], [20, 12, 30]];
  assert.deepEqual(POLYHEDRA.map((p) => p.die), ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']);
  POLYHEDRA.forEach((p, i) => {
    const c = solidCounts(p.id);
    assert.deepEqual([c.faces, c.vertices, c.edges], want[i], p.name);
  });
});

test('standing on a face, each is as tall as asked and about as big as the formula says', () => {
  const H = 16;
  // Volume for a height between the bottom face and the top (face to face, or face to tip for the tetrahedron).
  const volume: Record<number, number> = {
    0: ((a) => a ** 3 / (6 * Math.SQRT2))(H / Math.sqrt(2 / 3)),
    1: H ** 3,
    2: ((a) => (Math.SQRT2 / 3) * a ** 3)(H / Math.sqrt(2 / 3)),
    4: ((a) => ((15 + 7 * Math.sqrt(5)) / 4) * a ** 3)(H / Math.sqrt((25 + 11 * Math.sqrt(5)) / 10)),
    5: ((a) => (5 / 12) * (3 + Math.sqrt(5)) * a ** 3)(H / (PHI ** 2 / Math.sqrt(3))),
  };
  for (const id of [0, 1, 2, 4, 5]) {
    const b = blocks(poly(id, 0, H));
    const ys = b.map((c) => c[1]);
    // A pointed top (the tetrahedron's) loses its last half block: blocks are set where their middles are inside.
    const tall = (Math.max(...ys) - Math.min(...ys) + 1) * 0.5;
    assert.ok(tall <= H && tall >= H - (id === 0 ? 0.5 : 0), `${POLYHEDRA[id].name} height ${tall}`);
    const v = b.length * 0.125;
    assert.ok(Math.abs(v - volume[id]) / volume[id] < 0.06, `${POLYHEDRA[id].name}: ${v} vs ${volume[id].toFixed(1)}`);
  }
  // Standing on a face, the cube is just a box; on a point, it is as tall as asked too.
  assert.equal(blocks(poly(1, 0, 4)).length, 512);
  const corner = blocks(poly(1, 2, 8)).map((c) => c[1]);
  assert.equal((Math.max(...corner) - Math.min(...corner) + 1) * 0.5, 8);
});

test('the bottom is flat on a face, a single edge on an edge, one tip on a point', () => {
  const bottom = (s: Shape) => { const b = blocks(s); const lo = Math.min(...b.map((c) => c[1])); return b.filter((c) => c[1] === lo).length; };
  assert.ok(bottom(poly(5, 0, 16)) > 20, 'a d20 rests on a whole face');
  assert.ok(bottom(poly(5, 2, 16)) <= 4, 'on a point it touches down at a tip');
  const edge = blocks(poly(1, 1, 16));
  const lo = Math.min(...edge.map((c) => c[1]));
  const row = edge.filter((c) => c[1] === lo);
  // A cube on an edge: its bottom is a line of blocks along one axis.
  const spanX = Math.max(...row.map((c) => c[0])) - Math.min(...row.map((c) => c[0]));
  const spanZ = Math.max(...row.map((c) => c[2])) - Math.min(...row.map((c) => c[2]));
  assert.ok(Math.min(spanX, spanZ) <= 1 && Math.max(spanX, spanZ) > 10, `${spanX} by ${spanZ}`);
});

test('the d10 has ten kite faces round a pole at each end, and its box is centred on its position', () => {
  const s = placeSolid(3, 2, 10);
  assert.ok(Math.abs(s.half[1] - 5) < 1e-9);
  assert.ok(s.half[0] > 1 && s.half[0] < 5);
  const b = blocks(poly(3, 2, 10));
  const ys = b.map((c) => c[1]);
  // Both tips lose up to a block (pointed ends, as on a cone).
  assert.ok(Math.max(...ys) - Math.min(...ys) + 1 >= 18);
  // A tetrahedron's middle is low in its box (wide at the bottom), but the box itself sits round the position.
  const t = placeSolid(0, 0, 8);
  assert.ok(t.offset[1] < 0);
  assert.ok(Math.abs(t.half[1] - 4) < 1e-9);
});

test('a hollow polyhedron is a shell', () => {
  const full = blocks(poly(4, 0, 12)).length;
  const shell = blocks(poly(4, 0, 12, { fill: 'hollow', wallThickness: 1 })).length;
  assert.ok(shell < full * 0.6 && shell > full * 0.15, `${shell} of ${full}`);
});

test('a wireframe keeps only the edges, inside the solid\'s outline, as thick as asked; filled or hollow doesn\'t change it', () => {
  const H = 16;
  for (const id of [0, 1, 2, 3, 4, 5]) {
    const solidCells = new Set(blocks(poly(id, 0, H)).map((c) => c.join(',')));
    const wire = blocks(poly(id, 0, H, { params: { ...createShape('polyhedron').params, solid: id, stand: 0, height: H, frame: 1, edge: 2 } }));
    assert.ok(wire.length > 0 && wire.length < solidCells.size * 0.45, `${POLYHEDRA[id].name}: ${wire.length} of ${solidCells.size}`);
    // Every frame block is a block of the solid, and the frame is as tall as the solid.
    assert.ok(wire.every((c) => solidCells.has(c.join(','))), `${POLYHEDRA[id].name} inside its outline`);
    const ys = wire.map((c) => c[1]), sy = [...solidCells].map((k) => Number(k.split(',')[1]));
    assert.equal(Math.max(...ys) - Math.min(...ys), Math.max(...sy) - Math.min(...sy));
  }
  // A cube's frame: twelve square bars, 2 by 2 blocks each (corners shared), nothing in the middle of a face.
  const cube = new Set(blocks(poly(1, 0, 8, { params: { ...createShape('polyhedron').params, solid: 1, stand: 0, height: 8, frame: 1, edge: 2 } })).map((c) => c.join(',')));
  // 12 bars of 2 x 2 x 16 blocks; at each of the 8 corners three bars share a 2 x 2 x 2 block, counted twice too many.
  assert.equal(cube.size, 12 * 4 * 16 - 8 * 8 * 2);
  const hollowWire = blocks(poly(4, 0, H, { fill: 'hollow', wallThickness: 1, params: { ...createShape('polyhedron').params, solid: 4, stand: 0, height: H, frame: 1, edge: 2 } }));
  const filledWire = blocks(poly(4, 0, H, { params: { ...createShape('polyhedron').params, solid: 4, stand: 0, height: H, frame: 1, edge: 2 } }));
  assert.equal(hollowWire.length, filledWire.length);
});

test('a d10 can be given its own width across the middle; its height stays as asked and its ten faces stay alike', () => {
  const d10 = (stand: number, height: number, width?: number) => {
    const s = createShape('polyhedron');
    return { ...s, position: [0, height / 2, 0] as [number, number, number], fill: 'filled' as const, params: { ...s.params, solid: 3, stand, height, widthMode: width ? 1 : 0, width: width ?? 6 } };
  };
  const across = (b: number[][]) => {
    const xs = b.map((c) => c[0]), zs = b.map((c) => c[2]);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.5 + 0.5;
  };
  // On its point, 12 m tall: natural, then 10 m and 4 m across.
  const natural = across(blocks(d10(2, 12)));
  const wide = blocks(d10(2, 12, 10)), thin = blocks(d10(2, 12, 4));
  assert.ok(Math.abs(across(wide) - 10) <= 1, `wide: ${across(wide)}`);
  assert.ok(Math.abs(across(thin) - 4) <= 1, `thin: ${across(thin)}`);
  assert.ok(across(thin) < natural && natural < across(wide));
  // Still about 12 m tall: sharp tips lose up to a meter at each end (narrower than a block's middle there).
  for (const [b, least] of [[wide, 11], [thin, 10]] as const) {
    const ys = b.map((c) => c[1]);
    assert.ok((Math.max(...ys) - Math.min(...ys) + 1) * 0.5 >= least, 'about 12 m tall');
  }
  // Natural is the same as before; Custom only matters for the d10.
  assert.equal(blocks(d10(2, 12)).length, blocks(poly(3, 2, 12)).length);
  const cube = createShape('polyhedron');
  const withWidth = { ...cube, position: [0, 4, 0] as [number, number, number], fill: 'filled' as const, params: { ...cube.params, solid: 1, stand: 0, height: 8, widthMode: 1, width: 3 } };
  assert.equal(blocks(withWidth).length, 4096);
});
