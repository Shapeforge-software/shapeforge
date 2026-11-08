import { layerCells, layerHalfExtents, snapRotation } from './layer';
import { edgeMaterial, innerMaterial, isRoof, roofBlocks, roofBounds } from './roofs';
import { gableEdgeMaterial } from './gables';
import { pipeWorldCells, splitterPipe } from './pipes';
import { apply, eulerXYZ, transpose, type Mat3 } from './math';
import { SHAPES, UNCAP, cleanParams, placedPolyhedron } from './shapes';
import { dieMarks, markDepthAt } from './dice';
import { onSkin, patternAt } from './patterns';
import { KEEP_MATERIALS, VOXEL_SIZE, type LineWeight, type Shape, type ShapeKind, type Vec3, type Voxel } from './types';
import { key, unkey } from './voxelize-keys';

export { key, unkey } from './voxelize-keys';

/** World-space box around a placed, rotated shape: { min, max } in meters. */
export function worldBounds(shape: Shape): { min: Vec3; max: Vec3 } {
  if (isRoof(shape.kind)) return roofBounds(shape);
  const imported = shape.kind === 'imported';
  const [hx, hy, hz] = imported
    ? (shape.layer ? layerHalfExtents(shape.layer) : [0, 0, 0])
    : SHAPES[shape.kind as ShapeKind].halfExtents(cleanParams(shape.kind as ShapeKind, shape.params));
  const rot = eulerXYZ(imported ? snapRotation(shape.rotation) : shape.rotation);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const c = apply(rot, [sx * hx, sy * hy, sz * hz]);
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], c[a] + shape.position[a]);
          max[a] = Math.max(max[a], c[a] + shape.position[a]);
        }
      }
  return { min, max };
}

/**
 * Cell centers are nudged by this tiny amount before testing. Without it, a surface that lies exactly on a row of
 * cell centers (e.g. a 0.5 m sheet centered on a grid line) would count both rows; the nudge picks one consistently.
 */
const TIE_BREAK = 1e-6;

/** Cells whose centers are inside the solid shape. */
export function solidCells(shape: Shape): Set<number> {
  if (shape.kind === 'imported') return new Set(layerCells(shape).keys());
  // A pipe run is its walls (see pipes.ts).
  if (shape.kind === 'pipe') return pipeWorldCells(shape, cleanParams('pipe', shape.params));
  if (shape.kind === 'pipeSplitter') return pipeWorldCells(shape, splitterPipe(cleanParams('pipeSplitter', shape.params)));
  // 45-degree roofs are made of roof pieces, other angles of blocks (see roofs.ts).
  if (isRoof(shape.kind)) { const r = roofBlocks(shape); return new Set([...r.cells, ...r.inner].map(([i, j, k]) => key(i, j, k))); }
  const def = SHAPES[shape.kind];
  const params = cleanParams(shape.kind, shape.params);
  const inv = transpose(eulerXYZ(shape.rotation));
  const [px, py, pz] = shape.position;
  const { min, max } = worldBounds(shape);
  const lo = (a: number) => Math.floor(min[a] / VOXEL_SIZE) - 1;
  const hi = (a: number) => Math.ceil(max[a] / VOXEL_SIZE) + 1;
  const cells = new Set<number>();
  for (let i = lo(0); i <= hi(0); i++) {
    const x = (i + 0.5) * VOXEL_SIZE + TIE_BREAK - px;
    for (let j = lo(1); j <= hi(1); j++) {
      const y = (j + 0.5) * VOXEL_SIZE + TIE_BREAK - py;
      for (let k = lo(2); k <= hi(2); k++) {
        const z = (k + 0.5) * VOXEL_SIZE + TIE_BREAK - pz;
        if (def.inside(params, apply(inv, [x, y, z]))) cells.add(key(i, j, k));
      }
    }
  }
  return cells;
}

/**
 * The wall of a set of cells: those within `thickness` blocks of the outside, measured as a straight-line distance
 * between block centers, so a tilted, curved or flat wall is the same thickness. A thick line weight also keeps every
 * block that touches the outside even at a corner (so the wall is sealed); a thin one only those sharing a face with
 * it. Flat: the distance is measured across the layers of axis `flat` only (a flat shape's outline).
 */
export function shell(cells: Set<number>, thickness: number, lineWeight: LineWeight, flat?: 0 | 1 | 2): Set<number> {
  if (cells.size === 0) return new Set();
  const t = Math.max(1, Math.floor(thickness));
  const axes = [0, 1, 2].filter((a) => a !== flat);
  // The outermost layer reaches a block touching the outside at a face (1 away), or for a thick line weight even one
  // touching it only at a corner (the square root of the axes counted away); each further layer is one block deeper.
  const limit = t - 1 + (lineWeight === 'thick' ? Math.sqrt(axes.length) : 1);
  const d2 = distanceToOutside(cells, axes, Math.ceil(limit) + 1);
  const out = new Set<number>();
  for (const [n, d] of d2) if (d <= limit * limit + 1e-9) out.add(n);
  return out;
}

/**
 * Squared straight-line distance (in blocks, center to center) from each cell to the nearest cell not in the set,
 * along the given axes only; anything farther than `cap` blocks is left at more than cap². An exact distance
 * transform (one pass per axis, lower envelope of parabolas) over the set's box.
 */
function distanceToOutside(cells: Set<number>, axes: number[], cap: number): Map<number, number> {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const list = [...cells].map((n) => { const c = unkey(n); for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], c[a]); hi[a] = Math.max(hi[a], c[a]); } return c; });
  // One cell of outside all round.
  const o = lo.map((v) => v - 1), size = lo.map((v, a) => hi[a] - v + 3);
  const at = (i: number, j: number, k: number) => (i * size[1] + j) * size[2] + k;
  const BIG = (cap + 1) * (cap + 1) * 4;
  const g = new Float64Array(size[0] * size[1] * size[2]);
  for (const [i, j, k] of list) g[at(i - o[0], j - o[1], k - o[2])] = BIG;
  const n = Math.max(...size);
  const f = new Float64Array(n), dOut = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const stride = [size[1] * size[2], size[2], 1];
  for (const axis of axes) {
    const others = [0, 1, 2].filter((a) => a !== axis);
    const len = size[axis];
    for (let p = 0; p < size[others[0]]; p++) for (let q = 0; q < size[others[1]]; q++) {
      const base = p * stride[others[0]] + q * stride[others[1]];
      let any = false;
      for (let x = 0; x < len; x++) { f[x] = g[base + x * stride[axis]]; if (f[x] > 0) any = true; }
      if (!any) continue;
      // Felzenszwalb and Huttenlocher's 1D squared distance transform.
      let kk = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
      for (let x = 1; x < len; x++) {
        let s = ((f[x] + x * x) - (f[v[kk]] + v[kk] * v[kk])) / (2 * x - 2 * v[kk]);
        while (s <= z[kk]) { kk--; s = ((f[x] + x * x) - (f[v[kk]] + v[kk] * v[kk])) / (2 * x - 2 * v[kk]); }
        kk++; v[kk] = x; z[kk] = s; z[kk + 1] = Infinity;
      }
      kk = 0;
      for (let x = 0; x < len; x++) { while (z[kk + 1] < x) kk++; dOut[x] = (x - v[kk]) * (x - v[kk]) + f[v[kk]]; }
      for (let x = 0; x < len; x++) g[base + x * stride[axis]] = dOut[x];
    }
  }
  const out = new Map<number, number>();
  for (const [i, j, k] of list) out.set(key(i, j, k), g[at(i - o[0], j - o[1], k - o[2])]);
  return out;
}

export function shapeCells(shape: Shape): Set<number> {
  // A pipe run is built on the world grid in one go (see pipes.ts).
  if (shape.kind === 'pipe') return pipeWorldCells(shape, cleanParams('pipe', shape.params));
  if (shape.kind === 'pipeSplitter') return pipeWorldCells(shape, splitterPipe(cleanParams('pipeSplitter', shape.params)));
  const solid = solidCells(shape);
  // A block roof is already a shell one slope thick.
  if (isRoof(shape.kind)) return solid;
  const def = SHAPES[shape.kind as ShapeKind];
  if (!def) return shape.fill === 'hollow' ? shell(solid, shape.wallThickness, shape.lineWeight) : solid;
  const p = cleanParams(shape.kind as ShapeKind, shape.params);
  // Hollow, unless the shape's settings make it a band already (an arch frame).
  if (shape.fill !== 'hollow' || def.solidOnly?.(p)) return solid;
  const flat = def.flat?.(p);
  // A flat 2D shape is one block thick, so hollow means its outline: the wall is measured across its own plane.
  if (flat && !flat.prism) { const g = gridAxis(shape, flat.axis); return uncapped(shape, solid, shell(solid, shape.wallThickness, shape.lineWeight, g), g); }
  // Uncapping opens a hollow shape's ends.
  const cells = shell(solid, shape.wallThickness, shape.lineWeight);
  return UNCAP[shape.kind as ShapeKind] ? uncapped(shape, solid, cells) : cells;
}

/** The grid axis nearest a direction in a shape's own frame, turned with the shape. */
function gridAxis(shape: Shape, dir: Vec3): 0 | 1 | 2 {
  const w = apply(eulerXYZ(shape.rotation), dir);
  return [0, 1, 2].reduce((m, c) => (Math.abs(w[c]) > Math.abs(w[m]) ? c : m), 0) as 0 | 1 | 2;
}

/** How far a point (in the shape's own frame) is inside a flat end's face plane, the end facing `n`. */
function faceDepth(kind: ShapeKind, p: Record<string, number>, n: Vec3, [x, y, z]: Vec3): number {
  const a = [0, 1, 2].find((c) => Math.abs(n[c]) > 0.5) ?? 1, sign = Math.sign(n[a]);
  const half = SHAPES[kind].halfExtents(p);
  if (kind === 'slantedBox' && a !== 1) {
    // Its x and z faces lean with the slant.
    const t = y / p.height;
    return a === 0 ? p.width / 2 - sign * (x - p.slantX * t) : p.depth / 2 - sign * (z - p.slantZ * t);
  }
  return half[a] - sign * [x, y, z][a];
}

/** Whether a shape's end comes to a point (or an edge) rather than a face: a cone or frustum top of no size. */
export function pointedEnd(kind: ShapeKind, p: Record<string, number>, key: string): boolean {
  if (key !== 'uncapPY') return false;
  if (kind === 'cone') return !(p.topRadius > 0);
  if (kind === 'frustum') return !(p.topWidth > 0 && p.topDepth > 0);
  return false;
}

/**
 * A hollow shape without its uncapped ends (see UNCAP), each in the shape's own frame so a turned one opens at its own
 * ends. A round end (a sphere's, a capsule's) or a pointed one (a cone's tip) is cut off: the cells within the uncap
 * depth of that end go. A flat end loses its wall: the cells within the wall thickness of its face, except those that
 * are the side wall (the outline of their own layer across that direction) or part of another surface, so the side
 * walls run on to the edge.
 */
function uncapped(shape: Shape, solid: Set<number>, cells: Set<number>, flatAxis?: 0 | 1 | 2): Set<number> {
  const kind = shape.kind as ShapeKind;
  const u = UNCAP[kind];
  if (!u) return cells;
  const p = cleanParams(kind, shape.params);
  const open = u.ends.filter((e) => p[e.key] === 1 && (!e.when || e.when(p)));
  if (!open.length) return cells;
  const def = SHAPES[kind];
  const rot = eulerXYZ(shape.rotation), inv = transpose(rot);
  const [px, py, pz] = shape.position;
  const local = (i: number, j: number, k: number) => apply(inv, [(i + 0.5) * VOXEL_SIZE + TIE_BREAK - px, (j + 0.5) * VOXEL_SIZE + TIE_BREAK - py, (k + 0.5) * VOXEL_SIZE + TIE_BREAK - pz]);
  const half = def.halfExtents(p);
  let out = new Set(cells);
  // Flat ends open by carrying the shape on past them before hollowing: the blocks of an end's wall then have shape
  // beyond them and are no longer surface, while the side walls, open to the air beside them, still are. This works
  // at any rotation (a face at 40° is a staircase of blocks, which no plane-depth test can pick out).
  const flats: { n: Vec3; depth: (pt: Vec3) => number }[] = [];
  for (const e of open) {
    const n = e.normal(p);
    if (u.round || pointedEnd(kind, p, e.key)) {
      // Cut off to the uncap depth, along a square axis.
      const a = [0, 1, 2].find((c) => Math.abs(n[c]) > 0.5) ?? 1, sign = Math.sign(n[a]);
      for (const c of out) { const [i, j, k] = unkey(c); if (sign * local(i, j, k)[a] > half[a] - p.uncapDepth) out.delete(c); }
      continue;
    }
    flats.push({ n, depth: (pt: Vec3) => (e.face ? e.face(p, pt) : faceDepth(kind, p, n, pt)) });
  }
  if (!flats.length) return out;
  const margin = Math.max(1, Math.floor(shape.wallThickness)) + 2;
  const { min, max } = worldBounds(shape);
  const lo = (a: number) => Math.floor(min[a] / VOXEL_SIZE) - margin;
  const hi = (a: number) => Math.ceil(max[a] / VOXEL_SIZE) + margin;
  const reach = margin * VOXEL_SIZE * 1.8;
  const grown = new Set(solid);
  for (let i = lo(0); i <= hi(0); i++) for (let j = lo(1); j <= hi(1); j++) for (let k = lo(2); k <= hi(2); k++) {
    const c = key(i, j, k);
    if (grown.has(c)) continue;
    const pt = local(i, j, k);
    for (const f of flats) {
      const d = f.depth(pt);
      if (d >= VOXEL_SIZE / 2 || d < -reach) continue;
      // Carried on past the end: inside the shape where this point's line along the end's direction meets the face.
      const back = d - 1e-6;
      if (def.inside(p, [pt[0] + f.n[0] * back, pt[1] + f.n[1] * back, pt[2] + f.n[2] * back])) { grown.add(c); break; }
    }
  }
  const wall = shell(grown, shape.wallThickness, shape.lineWeight, flatAxis);
  out = new Set([...out].filter((c) => wall.has(c)));
  return out;
}

/** Everything that changes a shape's cells; material and combine op are applied later, so they are left out. */
function cellKey(shape: Shape): string {
  const form = shape.kind === 'imported'
    ? [shape.layer?.id, snapRotation(shape.rotation)]
    : [shape.kind, cleanParams(shape.kind, shape.params), shape.rotation];
  return JSON.stringify([form, shape.position, shape.fill, shape.fill === 'hollow' ? [shape.wallThickness, shape.lineWeight] : null]);
}

/** Cells of a shape, plus each block's own material for imported layers that keep their materials. */
interface ShapeBlocks {
  cells: Set<number>;
  materials?: Map<number, number>;
}

function shapeBlocks(shape: Shape): ShapeBlocks {
  return withPattern(shape, ownBlocks(shape));
}

/**
 * A shape's pattern (see patterns.ts): its blocks that fall on the pattern take the pattern's material. Blocks with a
 * material of their own already (a die's numbers, a gable's blocks against roof pieces) keep it.
 */
function withPattern(shape: Shape, blocks: ShapeBlocks): ShapeBlocks {
  const def = shape.kind === 'imported' ? undefined : SHAPES[shape.kind as ShapeKind];
  if (!def || def.pieces) return blocks;
  const p = cleanParams(shape.kind as ShapeKind, shape.params);
  if (!(p.pattern > 0)) return blocks;
  const inv = transpose(eulerXYZ(shape.rotation));
  const [px, py, pz] = shape.position;
  const half = def.halfExtents(p).map((h) => h / VOXEL_SIZE) as Vec3;
  const flat = def.flat?.(p);
  const normal = flat?.axis;
  // On the skin: each block on the surface takes the face it shows on (the shape's own axis nearest that face's
  // direction); blocks further in, up to Depth, the face of the surface block they lie under; the rest stays plain.
  const faces = onSkin(p, !!flat && !flat.prism) ? skinFaces(blocks.cells, inv, Math.max(1, Math.round(p.patternDepth ?? 1))) : null;
  const materials = new Map(blocks.materials ?? []);
  for (const n of blocks.cells) {
    if (materials.has(n)) continue;
    const face = faces?.get(n);
    if (faces && face === undefined) continue;
    const [i, j, k] = unkey(n);
    const local = apply(inv, [(i + 0.5) * VOXEL_SIZE + TIE_BREAK - px, (j + 0.5) * VOXEL_SIZE + TIE_BREAK - py, (k + 0.5) * VOXEL_SIZE + TIE_BREAK - pz]);
    if (patternAt(p, [local[0] / VOXEL_SIZE, local[1] / VOXEL_SIZE, local[2] / VOXEL_SIZE], half, normal, face)) materials.set(n, p.patternMaterial);
  }
  return materials.size ? { cells: blocks.cells, materials } : blocks;
}

/**
 * The skin of a set of blocks, `depth` deep: for each block in it, the shape's own axis (0 x, 1 y, 2 z) its face
 * runs square to. A surface block (with an open side) takes the open side it shows on, the top first, then the
 * bottom, front, back and sides, so edges stay tidy; blocks within `depth` of the surface take the face of the
 * surface block they're nearest, layer by layer.
 */
function skinFaces(cells: Set<number>, inv: Mat3, depth: number): Map<number, number> {
  const dirs: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
  // The shape's own axis for each world direction (it may be turned).
  const axisOf = dirs.map((d) => { const l = apply(inv, d); return [0, 1, 2].reduce((m, a) => (Math.abs(l[a]) > Math.abs(l[m]) ? a : m), 0); });
  const out = new Map<number, number>();
  let layer: number[] = [];
  for (const n of cells) {
    const [i, j, k] = unkey(n);
    const open = dirs.findIndex(([a, b, c]) => !cells.has(key(i + a, j + b, k + c)));
    if (open >= 0) { out.set(n, axisOf[open]); layer.push(n); }
  }
  for (let d = 1; d < depth && layer.length; d++) {
    const next: number[] = [];
    for (const n of layer) {
      const [i, j, k] = unkey(n);
      for (const [a, b, c] of dirs) {
        const m = key(i + a, j + b, k + c);
        if (cells.has(m) && !out.has(m)) { out.set(m, out.get(n)!); next.push(m); }
      }
    }
    layer = next;
  }
  return out;
}

function ownBlocks(shape: Shape): ShapeBlocks {
  if (isRoof(shape.kind)) {
    // A roof's cells; a double-thick roof's inside layer has its own material.
    const r = roofBlocks(shape);
    const cells = new Set([...r.cells, ...r.inner].map(([i, j, k]) => key(i, j, k)));
    if (!r.inner.length && !r.edge.length) return { cells };
    const own = new Set(r.cells.map(([i, j, k]) => key(i, j, k)));
    const m = innerMaterial(shape.params), e = edgeMaterial(shape.params);
    const materials = new Map<number, number>(r.inner.map(([i, j, k]) => key(i, j, k)).filter((n) => !own.has(n)).map((n) => [n, m]));
    // Roof edging: the roof's own blocks along its edges.
    for (const [i, j, k] of r.edge) materials.set(key(i, j, k), e);
    return { cells, materials };
  }
  const cells = shapeCells(shape);
  if (shape.kind === 'gable') {
    // The blocks touching roof pieces, in the roof's material.
    const p = cleanParams('gable', shape.params);
    const inv = transpose(eulerXYZ(shape.rotation));
    const [px, py, pz] = shape.position;
    const materials = new Map<number, number>();
    for (const n of cells) {
      const [i, j, k] = unkey(n);
      const m = gableEdgeMaterial(p, apply(inv, [(i + 0.5) * VOXEL_SIZE + TIE_BREAK - px, (j + 0.5) * VOXEL_SIZE + TIE_BREAK - py, (k + 0.5) * VOXEL_SIZE + TIE_BREAK - pz]));
      if (m !== undefined) materials.set(n, m);
    }
    return materials.size ? { cells, materials } : { cells };
  }
  if (shape.kind === 'polyhedron') {
    const p = cleanParams('polyhedron', shape.params);
    if (p.marks === 1) return polyhedronMarks(shape, p, cells);
  }
  if (shape.kind !== 'imported') return { cells };
  return { cells, materials: layerCells(shape) };
}

/**
 * A numbered polyhedron (see dice.ts): blocks of the solid's outer layer (and as many layers in as Depth says) whose
 * spot on the nearest face is inside a number or dot take the marking material. Filled or hollow, those are blocks
 * it has already; a wireframe gets them added, so its numbers show in the open faces.
 */
function polyhedronMarks(shape: Shape, p: Record<string, number>, cells: Set<number>): ShapeBlocks {
  const placed = placedPolyhedron(p);
  const marks = dieMarks(placed, { pips: p.solid === 1 && p.pips === 1, font: p.markFont, size: p.markSize, tenAsTen: p.tenAs === 1 });
  // The whole solid (closed, filled), to find its outer layer.
  const full = solidCells({ ...shape, params: { ...shape.params, frame: 0 } });
  const inv = transpose(eulerXYZ(shape.rotation));
  const [px, py, pz] = shape.position;
  const deep = (p.markDepth - 1) * VOXEL_SIZE + VOXEL_SIZE / 2;
  const materials = new Map<number, number>();
  const out = new Set(cells);
  for (const n of full) {
    const [i, j, k] = unkey(n);
    const local = apply(inv, [(i + 0.5) * VOXEL_SIZE + TIE_BREAK - px, (j + 0.5) * VOXEL_SIZE + TIE_BREAK - py, (k + 0.5) * VOXEL_SIZE + TIE_BREAK - pz]);
    const gap = markDepthAt(marks, [local[0] - placed.offset[0], local[1] - placed.offset[1], local[2] - placed.offset[2]]);
    if (gap === null) continue;
    const outer = !full.has(key(i + 1, j, k)) || !full.has(key(i - 1, j, k)) || !full.has(key(i, j + 1, k)) || !full.has(key(i, j - 1, k)) || !full.has(key(i, j, k + 1)) || !full.has(key(i, j, k - 1));
    if (!outer && gap > deep) continue;
    if (p.frame === 1) out.add(n);
    else if (!cells.has(n)) continue;
    materials.set(n, p.markMaterial);
  }
  return materials.size ? { cells: out, materials } : { cells };
}

/** Remembers each shape's cells so editing one shape does not recompute the others. */
export class CellCache {
  private readonly entries = new Map<string, { key: string; blocks: ShapeBlocks }>();

  get(shape: Shape): ShapeBlocks {
    const k = cellKey(shape);
    const hit = this.entries.get(shape.id);
    if (hit && hit.key === k) return hit.blocks;
    const blocks = shapeBlocks(shape);
    this.entries.set(shape.id, { key: k, blocks });
    return blocks;
  }

  /** Drops entries for shapes no longer in the scene. */
  prune(ids: Set<string>): void {
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
  }
}

/** Combines shapes in order: add sets cells (later shapes win the material), subtract removes, intersect keeps the overlap. */
export function voxelizeScene(shapes: Shape[], cache?: CellCache): Voxel[] {
  const grid = new Map<number, number>();
  for (const shape of shapes) {
    const { cells, materials } = cache ? cache.get(shape) : shapeBlocks(shape);
    if (shape.op === 'add') {
      const keep = materials && shape.materialItem === KEEP_MATERIALS;
      // A roof's own materials (a double-thick roof's inside layer) always apply; the rest of it is in its material.
      // A shape's own materials (a roof's inside layer, a die's numbers, a pattern) apply; the rest is in its material.
      const own = materials && shape.kind !== 'imported';
      for (const n of cells) grid.set(n, keep ? materials.get(n)! : own ? materials.get(n) ?? shape.materialItem : shape.materialItem);
    } else if (shape.op === 'subtract') {
      for (const n of cells) grid.delete(n);
    } else {
      for (const n of [...grid.keys()]) if (!cells.has(n)) grid.delete(n);
    }
  }
  if (cache) cache.prune(new Set(shapes.map((s) => s.id)));
  const voxels: Voxel[] = [];
  for (const [n, materialItem] of grid) {
    const [i, j, k] = unkey(n);
    voxels.push({ i, j, k, materialItem });
  }
  return voxels;
}
