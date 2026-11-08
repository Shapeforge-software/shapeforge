import { eulerXYZ, apply } from './math';
import {
  RECEDE_NEGATIVE_END, RECEDE_NO_ENDS, RECEDE_POSITIVE_END, ROOF_ARMS, isJoinedKind, isRoof, pieceTopAt, roofBlocks, roofBounds, roofLocalSize,
  roofPieces, roofYaw, type JoinedKind, type RoofKind, type RoofPiece,
} from './roofs';
import { VOXEL_SIZE, type Shape, type Vec3 } from './types';

/**
 * Gables: the wall that fills the gap under a gable or shed roof at one of its ends, stair-stepping up right under the
 * roof's lowest layer. A gable is worked out from a roof built with its settings (the "roof it fits under"): the
 * blocks under that roof in the last few slices at one end. So it fits every angle, rise / run, saltbox, off-center
 * ridge, double and triple thick roof, drop, recede and edging exactly, and "Match a roof" only has to copy a roof's
 * settings and put the gable at its end.
 *
 * A gable's own frame is the roof's (facing 0): its thickness along x (the ridge), up along y, across along z. Its
 * outer face is at -x (end 0) or +x (end 1).
 */

/** The roof settings a gable copies: everything that shapes the roof's underside at its ends. */
export const GABLE_ROOF_KEYS = [
  'angle', 'customAngle', 'pitchRise', 'pitchRun', 'height', 'pieceSize', 'rows', 'asym', 'extraRows', 'longSide', 'ridgeOffset',
  'edging', 'edgeRidge', 'edgeEaves', 'edgeSides', 'double', 'innerDrop', 'recede',
] as const;

/** The furthest a gable recedes into its roof, in blocks. */
export const MAX_INSET = 32;

export const GABLE_UNDER_GABLE = 0;
export const GABLE_UNDER_SHED = 1;

type P = Record<string, number>;

/** The roof a gable is worked out from: its settings, long enough past the gable's thickness, facing 0, box at 0. */
/** The junction roofs a gable can be worked out from (its `srcKind`), by number. */
export const GABLE_JOINED: JoinedKind[] = ['roofL', 'roofT', 'roofCross'];

/** Whether a gable is worked out from an L, T or cross roof (one arm's end) rather than its own gable / shed settings. */
export const fromJunction = (p: P) => Number(p.source) === 1;

export function gableRoof(p: P): Shape {
  if (fromJunction(p)) {
    // The junction roof itself, as copied (every setting, its layers and edging included), facing 0, box at 0.
    const kind = GABLE_JOINED[Math.round(Number(p.srcKind ?? 1))] ?? 'roofT';
    const params: P = { ...p, facing: 0 };
    const local = roofLocalSize(kind, params);
    return {
      id: 'gable-roof', kind, params, position: [local[0] / 2, local[1] / 2, local[2] / 2], rotation: [0, 0, 0],
      fill: 'filled', wallThickness: 1, lineWeight: 'thick', materialItem: Number(p.roofMaterial ?? 0), op: 'add',
    };
  }
  const kind: RoofKind = Number(p.roofType) === GABLE_UNDER_SHED ? 'roofShed' : 'roofGable';
  const params: P = { units: 0, facing: 0 };
  for (const k of GABLE_ROOF_KEYS) if (p[k] !== undefined) params[k] = p[k];
  const S = params.pieceSize === 4 ? 4 : 2;
  // Long enough that the far end's own treatment (recede, edging) is well away from the gable's slices.
  // (The same length however far the gable recedes, so its slices are counted from the same end.)
  params.length = Math.max(3, Math.ceil((thickness(p) + MAX_INSET * VOXEL_SIZE + 6) / S));
  // A layer recedes at the gable's end only if the gable's settings say so (the far end never matters).
  const end = gableEnd(p) === 0 ? RECEDE_NEGATIVE_END : RECEDE_POSITIVE_END;
  params.recedeEnds = Number(p.recedeHere ?? 1) === 1 ? end : RECEDE_NO_ENDS;
  params.recedeEnds2 = Number(p.recedeHere2 ?? 1) === 1 ? end : RECEDE_NO_ENDS;
  const local = roofLocalSize(kind, params);
  if (p.innerMaterial !== undefined) params.innerMaterial = p.innerMaterial;
  if (p.edgeMaterial !== undefined) params.edgeMaterial = p.edgeMaterial;
  return {
    id: 'gable-roof', kind, params, position: [local[0] / 2, local[1] / 2, local[2] / 2], rotation: [0, 0, 0],
    fill: 'filled', wallThickness: 1, lineWeight: 'thick', materialItem: Number(p.roofMaterial ?? 0), op: 'add',
  };
}

const thickness = (p: P) => Math.max(1, Math.round(Number(p.depth ?? 1))) * VOXEL_SIZE;
const gableEnd = (p: P): 0 | 1 => (Number(p.end) === 1 ? 1 : 0);

/**
 * For a roof in the world: the highest block (exclusive, in blocks) that fits under it in each grid column, or
 * nothing where the column isn't under the roof. A block fits under a roof block, and under a roof piece when its top
 * is nowhere above the piece's top surface (the roof is listed after blocks in a blueprint, so it shows over them).
 * Also which roof piece's material is right above it there (null under a roof block).
 */
export function roofCeiling(roof: Shape): (i: number, k: number) => { top: number; piece: number | null } | null {
  const blocks = roofBlocks(roof);
  const lowest = new Map<string, number>();
  for (const [i, j, k] of [...blocks.cells, ...blocks.inner]) {
    const key = `${i},${k}`;
    const now = lowest.get(key);
    if (now === undefined || j < now) lowest.set(key, j);
  }
  const pieces = roofPieces(roof);
  const near = new Map<string, RoofPiece[]>();
  for (const q of pieces) {
    for (let i = Math.floor(q.min[0] * 2); i < Math.ceil(q.max[0] * 2); i++) for (let k = Math.floor(q.min[2] * 2); k < Math.ceil(q.max[2] * 2); k++) {
      const key = `${i},${k}`; const list = near.get(key); if (list) list.push(q); else near.set(key, [q]);
    }
  }
  const S = [0.001, 0.125, 0.25, 0.375, 0.499].map((t) => t * 2 * VOXEL_SIZE);
  return (i, k) => {
    let ceil = lowest.get(`${i},${k}`) ?? Infinity;
    let by: number | null = null;
    for (const q of near.get(`${i},${k}`) ?? []) {
      if (q.type.form === 'cube') { const b = Math.round(q.min[1] * 2); if (b < ceil) { ceil = b; by = q.materialItem; } continue; }
      for (const dx of S) for (const dz of S) {
        const t = pieceTopAt(q, i * VOXEL_SIZE + dx, k * VOXEL_SIZE + dz);
        if (t === null) continue;
        const top = Math.floor(t / VOXEL_SIZE + 1e-6);
        if (top < ceil) { ceil = top; by = q.materialItem; }
      }
    }
    return Number.isFinite(ceil) ? { top: ceil, piece: by } : null;
  };
}

export interface GableBlocks {
  /** Cells in the gable's own box, as "a,b,c" (blocks from its low corner along its x, y and z). */
  cells: Set<string>;
  /** The box its cells are counted in, in blocks (the unreceded gable's), and that box's low corner in the gable's
   * own frame. */
  size: [number, number, number];
  low: [number, number, number];
  /** Half its box each way from the middle, in blocks (bigger than size / 2 when receded). */
  half: Vec3;
  /** Its box's middle in the roof's own frame (the roof's box at 0), in meters. */
  center: Vec3;
  /** How far the gable is turned from the roof's frame (0, or 90 for an end that faces along z). */
  turn: 0 | 90;
  /** Blocks right under a roof piece, in that piece's material (when the gable takes the roof's material there). */
  edges: Map<string, number>;
}

const memo = new Map<string, GableBlocks>();

/** Which way, in the roof's own frame, the gable's end faces out. */
function gableFacing(p: P): '-x' | '+x' | '-z' | '+z' {
  if (!fromJunction(p)) return gableEnd(p) === 0 ? '-x' : '+x';
  const kind = GABLE_JOINED[Math.round(Number(p.srcKind ?? 1))] ?? 'roofT';
  const along = ROOF_ARMS[kind][Math.round(Number(p.arm ?? 0))]?.along ?? '-x';
  // At the junction: the arm's inner end, facing back the other way.
  return atJunction(p) ? OPPOSITE[along] : along;
}

const OPPOSITE = { '-x': '+x', '+x': '-x', '-z': '+z', '+z': '-z' } as const;
type Dir = keyof typeof OPPOSITE;

/** Whether a junction gable is at its arm's inner end (where it stands taller than the arm across from it). */
const atJunction = (p: P) => fromJunction(p) && Number(p.cut) === 1;

/** For a roof: the lowest block (in blocks) that clears its top in each column, or null where there is no roof. */
function roofFloor(roof: Shape): (i: number, k: number) => number | null {
  const blocks = roofBlocks(roof);
  const highest = new Map<string, number>();
  for (const [i, j, k] of [...blocks.cells, ...blocks.inner]) {
    const key = `${i},${k}`;
    highest.set(key, Math.max(highest.get(key) ?? -Infinity, j + 1));
  }
  for (const q of roofPieces(roof)) {
    for (let i = Math.floor(q.min[0] * 2); i < Math.ceil(q.max[0] * 2); i++) for (let k = Math.floor(q.min[2] * 2); k < Math.ceil(q.max[2] * 2); k++) {
      let top = -Infinity;
      if (q.type.form === 'cube') top = Math.round(q.max[1] * 2);
      else for (const dx of [0.001, 0.25, 0.499]) for (const dz of [0.001, 0.25, 0.499]) {
        const t = pieceTopAt(q, (i + dx * 2) * VOXEL_SIZE, (k + dz * 2) * VOXEL_SIZE);
        if (t !== null) top = Math.max(top, Math.ceil(t / VOXEL_SIZE - 1e-6));
      }
      if (top === -Infinity) continue;
      const key = `${i},${k}`;
      highest.set(key, Math.max(highest.get(key) ?? -Infinity, top));
    }
  }
  return (i, k) => highest.get(`${i},${k}`) ?? null;
}

/**
 * Where an arm of a junction roof (its own frame, box at 0) stands taller than the roof next to it along its length
 * (an arm ending at the junction's center line beside a lower arm across from it): the column slice of that inner
 * end, facing out toward the lower roof. Found from the roof itself: columns whose underside is above the top of the
 * next column along the arm.
 */
export function junctionOpenings(roof: Shape): { facing: Dir; plane: number }[] {
  const { min, max } = roofBounds(roof);
  const lo = min.map((v) => Math.round(v * 2)), hi = max.map((v) => Math.round(v * 2));
  const ceiling = roofCeiling(roof), floor = roofFloor(roof);
  const out = new Map<string, { facing: Dir; plane: number }>();
  for (let i = lo[0]; i < hi[0]; i++) for (let k = lo[2]; k < hi[2]; k++) {
    const c = ceiling(i, k);
    if (c === null) continue;
    for (const facing of ['-x', '+x', '-z', '+z'] as Dir[]) {
      const [ni, nk] = facing === '-x' ? [i - 1, k] : facing === '+x' ? [i + 1, k] : facing === '-z' ? [i, k - 1] : [i, k + 1];
      const f = floor(ni, nk);
      if (f === null || c.top <= f) continue;
      const plane = facing[1] === 'x' ? i : k;
      out.set(`${facing}${plane}`, { facing, plane });
    }
  }
  return [...out.values()];
}

/** A gable's blocks, from its settings: those under the roof in the last slices at its end. */
export function gableBlocks(p: P): GableBlocks {
  const key = JSON.stringify(p);
  const hit = memo.get(key);
  if (hit) return hit;
  const roof = gableRoof(p);
  const { min, max } = roofBounds(roof);
  const ceiling = roofCeiling(roof);
  const n = Math.round(thickness(p) / VOXEL_SIZE);
  const facing = gableFacing(p);
  const ax = facing === '-x' || facing === '+x' ? 0 : 2;
  const lo = min.map((v) => Math.round(v * 2)), hi = max.map((v) => Math.round(v * 2));
  // The slab: the last n slices at the arm's tip, or for an arm's inner end the n slices from its opening inward.
  // (The one nearest the roof's middle, should there be more than one facing this way.)
  const mid = (lo[ax] + hi[ax]) / 2;
  const opening = atJunction(p) ? junctionOpenings(roof).filter((o) => o.facing === facing).sort((a, b) => Math.abs(a.plane - mid) - Math.abs(b.plane - mid))[0] : undefined;
  // Recede: the slab pushed that many blocks further into the roof along its ridge.
  const inset = Math.max(0, Math.round(Number(p.inset ?? 0)));
  const outer = opening ? (facing[0] === '-' ? opening.plane : opening.plane - n + 1) : facing[0] === '-' ? lo[ax] : hi[ax] - n;
  const s0 = facing[0] === '-' ? outer + inset : outer - inset;
  const base = lo[1];
  const floor = opening ? roofFloor(roof) : null;
  // At an inner end the gable stands on the lower roof beside it (where there is one), across from each column.
  // Across the inner end, the columns that are open: taller than the roof beside them, or with no roof beside them.
  const inOpening = (i: number, k: number) => {
    if (!opening || !floor) return true;
    const out = facing[0] === '-' ? -1 : 1;
    const [ci, ck] = ax === 0 ? [opening.plane, k] : [i, opening.plane];
    const c = ceiling(ci, ck);
    if (c === null) return false;
    const f = ax === 0 ? floor(opening.plane + out, k) : floor(i, opening.plane + out);
    return f === null || c.top > f;
  };
  const bottomAt = (i: number, k: number) => {
    if (!opening || !floor) return base;
    const [ni, nk] = ax === 0 ? [opening.plane + (facing[0] === '-' ? -1 : 1), k] : [i, opening.plane + (facing[0] === '-' ? -1 : 1)];
    return floor(ni, nk) ?? base;
  };
  const found: [number, number, number][] = [];
  const edge = new Map<string, number>();
  const roofEdge = Number(p.roofEdge ?? 1) === 1;
  for (let i = lo[0]; i < hi[0]; i++) for (let k = lo[2]; k < hi[2]; k++) {
    const along = ax === 0 ? i : k;
    if (along < s0 || along >= s0 + n) continue;
    const c = ceiling(i, k);
    if (c === null) continue;
    if (atJunction(p) && (!opening || !inOpening(i, k))) continue;
    for (let j = bottomAt(i, k); j < c.top; j++) found.push([i, j, k]);
    // The block touching a roof piece takes the piece's material: a different material right under the tiles shows
    // through them, the roof's own does not (what builders do in game).
    if (roofEdge && c.piece !== null && c.top > base) edge.set(`${i},${c.top - 1},${k}`, c.piece);
  }
  const turn: 0 | 90 = ax === 0 ? 0 : 90;
  // The gable's own frame is the roof's turned by `turn` (a quarter turn takes its +x to the roof's -z): its x runs
  // along the end's direction, its z across.
  const toOwn = ([i, j, k]: [number, number, number]): [number, number, number] => (turn === 0 ? [i, j, k] : [-k - 1, j, i]);
  // Receded, the gable keeps its place: its frame stays that of the gable at the roof's end (so moving it in along
  // the ridge moves its blocks, not the shape), and its box grows to take them in.
  const anchor = inset > 0 ? gableBlocks({ ...p, inset: 0 }) : null;
  let out: GableBlocks;
  if (!found.length) out = { cells: new Set(), size: anchor?.size ?? [n, 1, 1], half: anchor?.half ?? [n / 2, 0.5, 0.5], low: anchor?.low ?? [0, 0, 0], center: anchor?.center ?? [0, 0, 0], turn, edges: new Map() };
  else {
    const own = found.map(toOwn);
    const m0 = [0, 1, 2].map((a) => Math.min(...own.map((c) => c[a])));
    const m1 = [0, 1, 2].map((a) => Math.max(...own.map((c) => c[a])));
    const low = anchor && anchor.cells.size ? anchor.low : (m0 as [number, number, number]);
    const size = anchor && anchor.cells.size ? anchor.size : ([m1[0] - m0[0] + 1, m1[1] - m0[1] + 1, m1[2] - m0[2] + 1] as [number, number, number]);
    const id = (c: [number, number, number]) => { const o = toOwn(c); return `${o[0] - low[0]},${o[1] - low[1]},${o[2] - low[2]}`; };
    const rx0 = Math.min(...found.map((c) => c[0])), rx1 = Math.max(...found.map((c) => c[0])) + 1;
    const rz0 = Math.min(...found.map((c) => c[2])), rz1 = Math.max(...found.map((c) => c[2])) + 1;
    // Half the box each way from its middle, in blocks: wide enough for every block.
    const half = [0, 1, 2].map((a) => Math.max(size[a] / 2 - (m0[a] - low[a]), m1[a] - low[a] + 1 - size[a] / 2, size[a] / 2)) as Vec3;
    out = {
      cells: new Set(found.map(id)),
      size, half, low,
      // The box's middle in the roof's frame.
      center: anchor && anchor.cells.size ? anchor.center : [(rx0 + rx1) / 4, (m0[1] + m1[1] + 1) / 4, (rz0 + rz1) / 4],
      turn,
      edges: new Map([...edge].map(([key, m]) => [id(key.split(',').map(Number) as [number, number, number]), m])),
    };
  }
  if (memo.size > 64) memo.clear();
  memo.set(key, out);
  return out;
}

export function gableHalfExtents(p: P): Vec3 {
  const { half } = gableBlocks(p);
  return [half[0] * VOXEL_SIZE, half[1] * VOXEL_SIZE, half[2] * VOXEL_SIZE];
}

/** The gable's own cell at a point in its frame, as "a,b,c". */
function gableCellAt(g: GableBlocks, [x, y, z]: Vec3): string {
  const cell = (v: number, n: number) => Math.floor((v + (n * VOXEL_SIZE) / 2) / VOXEL_SIZE);
  return `${cell(x, g.size[0])},${cell(y, g.size[1])},${cell(z, g.size[2])}`;
}

export function gableInside(p: P, pt: Vec3): boolean {
  const g = gableBlocks(p);
  return g.cells.has(gableCellAt(g, pt));
}

/** The roof material of the gable's block at a point in its frame, if it is one of those touching a roof piece. */
export function gableEdgeMaterial(p: P, pt: Vec3): number | undefined {
  const g = gableBlocks(p);
  return g.edges.size ? g.edges.get(gableCellAt(g, pt)) : undefined;
}

/** World direction of a direction in a roof's own frame, turned by its facing. */
function worldDir(roof: Shape, d: '-x' | '+x' | '-z' | '+z'): string {
  const v: Vec3 = d === '-x' ? [-1, 0, 0] : d === '+x' ? [1, 0, 0] : d === '-z' ? [0, 0, -1] : [0, 0, 1];
  const w = apply(eulerXYZ([0, roofYaw(roof.params), 0]), v);
  return Math.abs(w[0]) > 0.5 ? (w[0] > 0 ? '+x' : '-x') : w[2] > 0 ? '+z' : '-z';
}

/**
 * The ends of a roof a gable can be matched to: a gable or shed roof's two ends along its ridge ("end0", "end1"), and
 * each L, T or cross arm that ends in a gable ("arm0", "arm1", …), named by the way they face in the world.
 */
export function gableEnds(roof: Shape): { which: string; label: string }[] {
  if (roof.kind === 'roofGable' || roof.kind === 'roofShed') {
    return [{ which: 'end0', label: `end toward ${worldDir(roof, '-x')}` }, { which: 'end1', label: `end toward ${worldDir(roof, '+x')}` }];
  }
  if (!isJoinedKind(roof.kind)) return [];
  const kind = roof.kind;
  const tips = ROOF_ARMS[kind].flatMap((arm, i) => {
    const end = roof.params[`${arm.key}End`] ?? roof.params[arm.legacyEnd] ?? 0;
    return Math.round(Number(end)) === 1 ? [] : [{ which: `arm${i}`, label: `${arm.label}, end toward ${worldDir(roof, arm.along)}` }];
  });
  // An arm taller than the arm across from it (a T's bar, a cross's pairs) ends at the junction in an open gable too.
  const inner = ROOF_ARMS[kind].flatMap((arm, i) => {
    const across = ROOF_ARMS[kind].find((b) => b.along === OPPOSITE[arm.along]);
    if (!across) return [];
    const params = { ...roof.params, source: 1, srcKind: GABLE_JOINED.indexOf(kind), arm: i, cut: 1, depth: 1 };
    if (gableBlocks(params).cells.size === 0) return [];
    return [{ which: `cut${i}`, label: `${arm.label}, inner end above the ${across.label.replace(/^Bar, /, '')} (toward ${worldDir(roof, OPPOSITE[arm.along])})` }];
  });
  return [...tips, ...inner];
}

/** The settings of a gable worked out from a junction roof: everything but the gable's own. */
const GABLE_OWN = new Set(['depth', 'end', 'inset', 'roofEdge']);

/**
 * A gable fitted under one end of a roof: the roof's settings copied, and the gable put at that end, turned with the
 * roof. The gable's own settings (thickness, recede, the roof material along its top) are kept.
 */
export function matchGable(gable: Shape, roof: Shape, which: string): Shape {
  if (!isRoof(roof.kind)) return gable;
  const own = Object.fromEntries(Object.entries(gable.params).filter(([k]) => GABLE_OWN.has(k)));
  let params: P;
  let along: (g: GableBlocks) => number;
  if (isJoinedKind(roof.kind)) {
    // The junction roof itself, every setting: the gable is worked out from the very same roof, so it lines up.
    params = { ...roof.params, ...own, source: 1, srcKind: GABLE_JOINED.indexOf(roof.kind), arm: Number(which.slice(3)) || 0, cut: which.startsWith('cut') ? 1 : 0 };
    along = (g) => g.center[0];
  } else {
    const end: 0 | 1 = which === 'end1' ? 1 : 0;
    params = { ...gable.params, source: 0, roofType: roof.kind === 'roofShed' ? GABLE_UNDER_SHED : GABLE_UNDER_GABLE, end };
    for (const k of GABLE_ROOF_KEYS) if (roof.params[k] !== undefined) params[k] = roof.params[k];
    for (const k of ['innerMaterial', 'edgeMaterial']) if (roof.params[k] !== undefined) params[k] = roof.params[k];
    // Which gable ends the roof's layers recede at: whether this end is one of them.
    const here = (choice: number) => (choice === 0 || choice === (end === 0 ? RECEDE_NEGATIVE_END : RECEDE_POSITIVE_END) ? 1 : 0);
    params.recedeHere = here(Math.round(Number(roof.params.recedeEnds ?? 0)));
    params.recedeHere2 = here(Math.round(Number(roof.params.recedeEnds2 ?? 0)));
    // The gable's roof is the real one but for its length, so the slices are measured from the end it is at.
    const virtual = roofLocalSize(gableRoof(params).kind as RoofKind, gableRoof(params).params);
    const local = roofLocalSize(roof.kind as RoofKind, roof.params);
    along = (g) => (end === 0 ? g.center[0] : local[0] - (virtual[0] - g.center[0]));
  }
  params.roofMaterial = roof.materialItem;
  const g = gableBlocks(params);
  const local = roofLocalSize(roof.kind as RoofKind, roof.params);
  const center: Vec3 = [along(g), g.center[1], g.center[2]];
  // Turned with the roof about its box's middle (as its pieces are), and put in its box.
  const yaw = roofYaw(roof.params);
  const { min, max } = roofBounds(roof);
  const r = apply(eulerXYZ([0, yaw, 0]), [center[0] - local[0] / 2, 0, center[2] - local[2] / 2]);
  const position: Vec3 = [(min[0] + max[0]) / 2 + r[0], min[1] + center[1], (min[2] + max[2]) / 2 + r[2]].map((v) => Math.round(v * 1e6) / 1e6) as Vec3;
  return { ...gable, params, position, rotation: [0, (yaw + g.turn) % 360, 0] };
}
