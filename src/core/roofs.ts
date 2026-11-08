import { apply, fromQuaternion } from './math';
import type { Shape, Vec3 } from './types';

/**
 * Roof shapes are built from Enshrouded's 45-degree roof pieces instead of blocks.
 *
 * Confirmed in Embervale (2026-11-02, test_roof_direction): unrotated, a Roof Side slopes along x with its high
 * side at -x (x = 0) and a 0.5 m eave hanging past the run at +x; it is `run` wide along z, so pieces sit side by
 * side every 2 m (4 m) along the ridge with no overlap. Turned 90 degrees around y (quaternion 0,0.707,0,0.707) its
 * high side faces +z. The pivot (pos) is the box's lowest corner when unrotated.
 *
 * Rows down a slope step 2 m (4 m) out and down; each row's eave lies over the top of the row below.
 *
 * Corners, from a hip roof built by hand in game (tests/fixtures/rooftest_hip.ebblueprint): both are square boxes,
 * run + 0.5 on each side. Unrotated, an Outer Corner (a hip) peaks at its (x = 0, z = max) corner and slopes down
 * toward +x and -z; an Inner Corner (a valley) is high along its x = 0 and z = 0 edges and slopes down toward +x
 * and +z.
 */

export type RoofKind = 'roofShed' | 'roofGable' | 'roofHip' | 'roofL' | 'roofT' | 'roofCross';
export const ROOF_KINDS: readonly RoofKind[] = ['roofShed', 'roofGable', 'roofHip', 'roofL', 'roofT', 'roofCross'];
export const isRoof = (kind: Shape['kind']): kind is RoofKind => (ROOF_KINDS as readonly string[]).includes(kind);

export type RoofForm = 'side' | 'outer' | 'inner' | 'cube';

export interface RoofPieceType {
  blueprintId: number;
  name: string;
  form: RoofForm;
  /** Grid step along and across the slope, in meters (2 or 4). */
  run: number;
  /** Box size in meters, unrotated. A side: down the slope (run + 0.5 eave), height (run + 0.5), along the ridge (run). */
  size: Vec3;
}
/** Kept for older imports: every roof piece type. */
export type RoofSideType = RoofPieceType;

export const ROOF_SIDES: Record<2 | 4, RoofPieceType> = {
  2: { blueprintId: 2482289794, name: 'Roof Side 2M', form: 'side', run: 2, size: [2.5, 2.5, 2] },
  4: { blueprintId: 1083013738, name: 'Roof Side 4M', form: 'side', run: 4, size: [4.5, 4.5, 4] },
};
export const ROOF_OUTER_CORNERS: Record<2 | 4, RoofPieceType> = {
  2: { blueprintId: 985540864, name: 'Roof Outer Corner 2M', form: 'outer', run: 2, size: [2.5, 2.5, 2.5] },
  4: { blueprintId: 3000989055, name: 'Roof Outer Corner 4M', form: 'outer', run: 4, size: [4.5, 4.5, 4.5] },
};
export const ROOF_INNER_CORNERS: Record<2 | 4, RoofPieceType> = {
  2: { blueprintId: 3722239847, name: 'Roof Inner Corner 2M', form: 'inner', run: 2, size: [2.5, 2.5, 2.5] },
  4: { blueprintId: 2297453360, name: 'Roof Inner Corner 4M', form: 'inner', run: 4, size: [4.5, 4.5, 4.5] },
};

/** Red Tile Roof Block, used for new roofs. */
export const DEFAULT_ROOF_MATERIAL = 196827131;

/** Turns around the vertical axis, as quaternions in the form Embervale writes. */
export type Yaw = 0 | 90 | 180 | 270;
export const YAW_QUATERNION: Record<Yaw, [number, number, number, number]> = {
  0: [0, 0, 0, 1],
  90: [0, 0.707106769, 0, 0.707106769],
  180: [0, 1, 0, 0],
  270: [0, -0.707106769, 0, 0.707106769],
};

/** A downhill direction on the ground. */
export type Downhill = '+x' | '-z' | '-x' | '+z';
/** Where an unrotated piece's +x downhill side ends up after each turn. */
const DOWNHILL: Record<Yaw, Downhill> = { 0: '+x', 90: '-z', 180: '-x', 270: '+z' };
const YAWS: Yaw[] = [0, 90, 180, 270];

function normYaw(deg: number): Yaw {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Yaw;
}

/** The turn that makes a Roof Side slope downhill this way. */
export const sideYaw = (down: Downhill): Yaw => YAWS.find((y) => DOWNHILL[y] === down)!;

function cornerYaw(offset: number, a: Downhill, b: Downhill): Yaw {
  const yaw = YAWS.find((y) => {
    const d = [DOWNHILL[y], DOWNHILL[normYaw(y + offset)]];
    return d.includes(a) && d.includes(b);
  });
  if (yaw === undefined) throw new Error(`A roof corner can't slope down both ${a} and ${b}.`);
  return yaw;
}
/** The turn that makes an Outer Corner slope downhill both ways (two neighboring directions). */
export const outerYaw = (a: Downhill, b: Downhill): Yaw => cornerYaw(90, a, b);
/** The turn that makes an Inner Corner slope downhill both ways (two neighboring directions). */
export const innerYaw = (a: Downhill, b: Downhill): Yaw => cornerYaw(270, a, b);

export interface RoofPiece {
  type: RoofPieceType;
  yaw: Yaw;
  /** Pivot (the blueprint's pos), in world meters. */
  pos: Vec3;
  /** World box the piece occupies. */
  min: Vec3;
  max: Vec3;
  materialItem: number;
}

/** Box of a piece turned by `yaw`, relative to its pivot. */
export function rotatedBox(type: RoofPieceType, yaw: Yaw): { lo: Vec3; hi: Vec3 } {
  const m = fromQuaternion(YAW_QUATERNION[yaw]);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [0, type.size[0]]) for (const y of [0, type.size[1]]) for (const z of [0, type.size[2]]) {
    const r = apply(m, [x, y, z]);
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], r[a]); hi[a] = Math.max(hi[a], r[a]); }
  }
  // Embervale's 0.707106769 is not exactly the square root of 1/2, which leaves tiny errors after a quarter
  // turn. True corners always fall on the half-meter grid, so snap to it.
  const snap = (v: number) => Math.round(v * 2) / 2;
  return { lo: lo.map(snap) as Vec3, hi: hi.map(snap) as Vec3 };
}

/** The eave: how far a piece reaches past its run, down the slope. */
const EAVE = 0.5;

/** Lengths along a ridge can be given in pieces (the default) or in meters, down to half a meter. */
export const LENGTH_IN_METERS = 1;

/** Piece size and rows down each slope, cleaned. */
function layoutParams(p: Record<string, number>) {
  const size: 2 | 4 = p.pieceSize === 4 ? 4 : 2;
  return { size, run: size as number, rows: Math.max(1, Math.round(p.rows ?? 1)) };
}

/** A length parameter in meters, whichever unit it was given in, on the half-meter grid. */
export function lengthMeters(p: Record<string, number>, key: string, fallbackPieces: number): number {
  const S = p.pieceSize === 4 ? 4 : 2;
  const v = Number(p[key]);
  const meters = !Number.isFinite(v) ? fallbackPieces * S : p.units === LENGTH_IN_METERS ? v : v * S;
  return Math.max(0, Math.round(meters * 2) / 2);
}

/** Whether an end is a gable (0) or a hip (1). */
const isHipEnd = (p: Record<string, number>, key: string) => Math.round(p[key] ?? p.ends ?? 0) === 1;

/** Gables and hips can be asymmetric: a saltbox (one side longer, so its eave is lower) or an off-center ridge. */
export const ASYM_SYMMETRIC = 0;
export const ASYM_SALTBOX = 1;
export const ASYM_OFF_CENTER = 2;

/** The asymmetry a roof is built with (only gables and hips have one; an off-center ridge is gables only). */
function asymmetry(kind: RoofKind, p: Record<string, number>): number {
  const a = Math.round(p.asym ?? 0);
  if (kind === 'roofGable' && (a === ASYM_SALTBOX || a === ASYM_OFF_CENTER)) return a;
  if (kind === 'roofHip' && a === ASYM_SALTBOX) return a;
  return ASYM_SYMMETRIC;
}

/** Rows on the -z and +z sides of a gable's or hip's ridge (a saltbox adds rows to its long side). */
function sideRows(kind: RoofKind, p: Record<string, number>, rows: number): { minus: number; plus: number } {
  if (asymmetry(kind, p) !== ASYM_SALTBOX) return { minus: rows, plus: rows };
  const extra = Math.max(1, Math.round(p.extraRows ?? 1));
  // longSide 0: the +z side is the long one; 1: the -z side.
  return Math.round(p.longSide ?? 0) === 1 ? { minus: rows + extra, plus: rows } : { minus: rows, plus: rows + extra };
}

/**
 * Size of the roof's box before its facing is applied, in meters: along the ridge, height, across.
 * The ridge runs along x; a shed rises toward -z, and a gable's or hip's slopes meet in the middle.
 */
export function roofLocalSize(kind: RoofKind, p: Record<string, number>): Vec3 {
  if (isJoinedKind(kind) ? joinedUsesBlocks(kind, p) : roofAngle(p) !== PIECE_ANGLE || asymmetry(kind, p) === ASYM_OFF_CENTER) {
    const b = blockRoof(kind, p);
    return [b.nx / 2, b.height / 2, b.nz / 2];
  }
  return roofLayout(kind, p).size;
}

/** Facing as a turn of the whole roof: shed high side, or ridge direction. */
export function roofYaw(p: Record<string, number>): Yaw {
  return normYaw(p.facing ?? 0);
}

/**
 * The roof's world box. The shape's position is the box center (like other shapes), snapped so pieces land on
 * the half-meter grid.
 */
export function roofBounds(shape: Shape): { min: Vec3; max: Vec3 } {
  const local = roofLocalSize(shape.kind as RoofKind, shape.params);
  const yaw = roofYaw(shape.params);
  const size: Vec3 = yaw % 180 === 0 ? local : [local[2], local[1], local[0]];
  const min = size.map((s, a) => Math.round((shape.position[a] - s / 2) * 2) / 2) as Vec3;
  return { min, max: min.map((v, a) => v + size[a]) as Vec3 };
}

export interface LocalBox { type: RoofPieceType; yaw: Yaw; min: Vec3 }

/**
 * A wing of a roof: a rectangle of whole cells (one cell = one piece, `run` meters square), half-open
 * [x0, x1) x [z0, z1). `open` lists the wing's gable ends (and a shed's high side): the roof carries on past them as
 * if the wing went on, so they get no slope down. `trim` pulls an end of the wing back by that many meters, for
 * lengths that aren't whole pieces: the pieces at that end slide back over their neighbors, which share their slope.
 */
export interface Wing {
  x0: number; x1: number; z0: number; z1: number; open: Downhill[]; trim?: Partial<Record<Downhill, number>>;
  /** Rows up this wing's slopes, when wings differ (how deep its hip ends are). */
  rows?: number;
}

/**
 * Cells and trim for a run of `meters` along a ridge. `minCells` is the shortest run; `endDepth` is how many cells
 * deep the end's pieces are (1 for a gable end, the rows for a hip). The end slides back over the cells before it,
 * so a trim needs at least one plain cell there (`plainBefore` of them already exist before the run); otherwise
 * the length rounds up to whole pieces.
 */
function run(meters: number, S: number, minCells: number, endDepth: number, plainBefore = 0): { cells: number; trim: number } {
  const m = Math.max(meters, minCells * S);
  const cells = Math.ceil(m / S - 1e-9);
  const trim = cells * S - m;
  if (trim > 1e-9 && cells + plainBefore < endDepth + 1) return { cells, trim: 0 };
  return { cells, trim };
}

/** The wings of a roof, in cells, around a center (or corner) square [0, W) x [0, W) for L, T and cross roofs. */
function roofWings(kind: RoofKind, p: Record<string, number>): Wing[] {
  const { run: S, rows } = layoutParams(p);
  const W = 2 * rows;
  const sides = sideRows(kind, p, rows);
  if (kind === 'roofShed' || kind === 'roofGable') {
    const r = run(lengthMeters(p, 'length', 3), S, 1, 1);
    const open: Downhill[] = kind === 'roofShed' ? ['-x', '+x', '-z'] : ['-x', '+x'];
    return [{ x0: 0, x1: r.cells, z0: 0, z1: kind === 'roofShed' ? rows : sides.minus + sides.plus, open, trim: { '+x': r.trim } }];
  }
  if (kind === 'roofHip') {
    // The ridge runs between the two hip ends; the +x end slides back for part pieces (over the ridge's own cells).
    // A hip end is as deep as the shorter side's rows (a saltbox's long side runs on down past it).
    const r = run(lengthMeters(p, 'length', 2), S, 0, 0);
    const end = Math.min(sides.minus, sides.plus);
    return [{ x0: 0, x1: r.cells + 2 * end, z0: 0, z1: sides.minus + sides.plus, open: [], trim: { '+x': r.trim } }];
  }
  // L, T and cross roofs are made of arms (see joinedPieceWings).
  return joinedPieceWings(kind as JoinedKind, p, resolveArms(kind as JoinedKind, p), S);
}

/**
 * Lays out roof pieces over wings of equal width, every slope at 45 degrees: each point of the roof is as high as
 * its distance to the nearest eave (measured square-wise, which gives hips at outside bends and valleys at inside
 * ones). Each cell then gets the piece that matches which of its four corners are high: two neighboring corners
 * make a Roof Side, one an Outer Corner (a hip), three an Inner Corner (a valley).
 * Returns boxes in a frame whose box min is at the origin, and the size of that box.
 */
export function wingLayout(wings: Wing[], rows: number, size: 2 | 4,
  options: { height?: (px: number, pz: number, ci: number, cj: number) => number } = {}): { boxes: LocalBox[]; size: Vec3; origin?: [number, number] } {
  const S = size as number;
  const pieces = { side: ROOF_SIDES[size], outer: ROOF_OUTER_CORNERS[size], inner: ROOF_INNER_CORNERS[size] };
  const inWing = (w: Wing, i: number, j: number) => i >= w.x0 && i < w.x1 && j >= w.z0 && j < w.z1;
  const inRoof = (i: number, j: number) => wings.some((w) => inWing(w, i, j));
  // Gable ends carry the roof on past them, far enough that no slope starts there.
  const far = rows + 2;
  const carried = wings.map((w) => ({
    ...w,
    x0: w.open.includes('-x') ? w.x0 - far : w.x0, x1: w.open.includes('+x') ? w.x1 + far : w.x1,
    z0: w.open.includes('-z') ? w.z0 - far : w.z0, z1: w.open.includes('+z') ? w.z1 + far : w.z1,
  }));
  const under = (i: number, j: number) => carried.some((w) => inWing(w, i, j));
  /** Height, in rows, of the grid point (px, pz): its square distance to the nearest cell outside, up to the ridge. */
  const height = options.height ?? ((px: number, pz: number, _ci?: number, _cj?: number) => {
    let best = rows;
    for (let i = px - rows - 1; i <= px + rows; i++) for (let j = pz - rows - 1; j <= pz + rows; j++) {
      if (under(i, j)) continue;
      best = Math.min(best, Math.max(0, i - px, px - i - 1, j - pz, pz - j - 1));
    }
    return best;
  });
  const lo = [Math.min(...wings.map((w) => w.x0)), Math.min(...wings.map((w) => w.z0))];
  const hi = [Math.max(...wings.map((w) => w.x1)), Math.max(...wings.map((w) => w.z1))];
  const boxes: LocalBox[] = [];
  for (let i = lo[0]; i < hi[0]; i++) for (let j = lo[1]; j < hi[1]; j++) {
    if (!inRoof(i, j)) continue;
    // Corners: [x side, z side, height], x side 0 = -x (i), 1 = +x (i + 1); likewise z.
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => ({ a, b, h: height(i + a, j + b, i, j) }));
    const top = Math.max(...corners.map((c) => c.h));
    const high = corners.filter((c) => c.h === top);
    if (corners.some((c) => c.h < top - 1)) throw new Error('These roof wings are too uneven to cover with 45-degree pieces.');
    const towardX = (a: number): Downhill => (a === 1 ? '+x' : '-x');
    const towardZ = (b: number): Downhill => (b === 1 ? '+z' : '-z');
    let type: RoofPieceType, yaw: Yaw, down: Downhill[];
    if (high.length === 2 && high[0].a === high[1].a) {
      down = [towardX(1 - high[0].a)];
      type = pieces.side; yaw = sideYaw(down[0]);
    } else if (high.length === 2 && high[0].b === high[1].b) {
      down = [towardZ(1 - high[0].b)];
      type = pieces.side; yaw = sideYaw(down[0]);
    } else if (high.length === 1) {
      // A hip: slopes run down away from the one high corner.
      down = [towardX(1 - high[0].a), towardZ(1 - high[0].b)];
      type = pieces.outer; yaw = outerYaw(down[0], down[1]);
    } else if (high.length === 3) {
      // A valley: slopes run down toward the one low corner.
      const low = corners.find((c) => c.h !== top)!;
      down = [towardX(low.a), towardZ(low.b)];
      type = pieces.inner; yaw = innerYaw(down[0], down[1]);
    } else {
      throw new Error('This roof shape needs a roof piece the game does not have.');
    }
    // A piece covers its cell, plus the 0.5 m eave on each downhill side.
    const min: Vec3 = [i * S - (down.includes('-x') ? EAVE : 0), (top - 1) * S, j * S - (down.includes('-z') ? EAVE : 0)];
    // Slide the pieces at a trimmed end back (an end's pieces are one cell deep at a gable, `rows` at a hip).
    for (const w of wings) {
      if (!w.trim || !inWing(w, i, j)) continue;
      const deep = (d: Downhill) => (w.open.includes(d) ? 1 : w.rows ?? rows);
      const t = w.trim;
      if (t['+x'] && i >= w.x1 - deep('+x')) min[0] -= t['+x'];
      if (t['-x'] && i < w.x0 + deep('-x')) min[0] += t['-x'];
      if (t['+z'] && j >= w.z1 - deep('+z')) min[2] -= t['+z'];
      if (t['-z'] && j < w.z0 + deep('-z')) min[2] += t['-z'];
    }
    boxes.push({ type, yaw, min });
  }
  // Move the box min to the origin.
  const ext = boxes.map((b) => { const r = rotatedBox(b.type, b.yaw); return { b, sx: r.hi[0] - r.lo[0], sy: r.hi[1] - r.lo[1], sz: r.hi[2] - r.lo[2] }; });
  const x0 = Math.min(...boxes.map((b) => b.min[0])), z0 = Math.min(...boxes.map((b) => b.min[2]));
  const shifted = boxes.map((b) => ({ ...b, min: [b.min[0] - x0, b.min[1], b.min[2] - z0] as Vec3 }));
  const sizeOut: Vec3 = [
    Math.max(...ext.map((e) => e.b.min[0] + e.sx)) - x0,
    Math.max(...ext.map((e) => e.b.min[1] + e.sy)),
    Math.max(...ext.map((e) => e.b.min[2] + e.sz)) - z0,
  ];
  return { boxes: shifted, size: sizeOut, origin: [x0, z0] };
}

function roofLayout(kind: RoofKind, p: Record<string, number>) {
  const { size, rows } = layoutParams(p);
  if (isJoinedKind(kind)) return joinedPieceLayout(kind, p)!;
  const wings = roofWings(kind, p);
  if (asymmetry(kind, p) !== ASYM_SALTBOX) return wingLayout(wings, rows, size);
  // A saltbox: every slope keeps the same pitch, so a point is as high as its distance to each eave, lifted by how
  // much higher that eave sits (the short side's eave, and a hip's ends, sit level with each other).
  const { minus, plus } = sideRows(kind, p, rows);
  const top = Math.max(minus, plus), short = Math.min(minus, plus);
  const w = wings[0];
  const hip = kind === 'roofHip';
  const height = (px: number, pz: number) => Math.min(top,
    pz - w.z0 + top - minus, w.z1 - pz + top - plus,
    hip ? Math.min(px - w.x0, w.x1 - px) + top - short : Infinity);
  return wingLayout(wings, short, size, { height });
}

/** Lays out the pieces of a roof shape in the world. */
export function roofPieces(shape: Shape): RoofPiece[] {
  if (!isRoof(shape.kind) || isBlockRoof(shape)) return [];
  const local = roofLocalSize(shape.kind, shape.params);
  const roofYawDeg = roofYaw(shape.params);
  const { min: worldMin } = roofBounds(shape);

  // Turn the whole roof around its own center by its facing, then move it into place.
  const center: Vec3 = [local[0] / 2, local[1] / 2, local[2] / 2];
  const m = fromQuaternion(YAW_QUATERNION[roofYawDeg]);
  const turnedSize: Vec3 = roofYawDeg % 180 === 0 ? local : [local[2], local[1], local[0]];
  const pieces: RoofPiece[] = [];
  for (const b of roofLayout(shape.kind, shape.params).boxes) {
    const yaw = normYaw(b.yaw + roofYawDeg);
    const own = rotatedBox(b.type, b.yaw);
    const size = own.hi.map((h, a) => h - own.lo[a]);
    // Rotate the piece box's corners around the roof center to find where the box lands.
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    for (const dx of [0, size[0]]) for (const dz of [0, size[2]]) {
      const p = apply(m, [b.min[0] + dx - center[0], b.min[1] - center[1], b.min[2] + dz - center[2]]);
      lo[0] = Math.min(lo[0], p[0] + turnedSize[0] / 2);
      lo[2] = Math.min(lo[2], p[2] + turnedSize[2] / 2);
    }
    lo[1] = b.min[1];
    const boxMin = lo.map((v, a) => Math.round((v + worldMin[a]) * 2) / 2) as Vec3;
    const pieceBox = rotatedBox(b.type, yaw);
    const extent = pieceBox.hi.map((h, a) => h - pieceBox.lo[a]);
    pieces.push({
      type: b.type,
      yaw,
      pos: boxMin.map((v, a) => v - pieceBox.lo[a]) as Vec3,
      min: boxMin,
      max: boxMin.map((v, a) => v + extent[a]) as Vec3,
      materialItem: shape.materialItem,
    });
  }
  // Roof edging: the roof's own pieces along its ridge, eaves and (optionally) gable ends in the edging material.
  // Edged pieces overlap pieces of the roof's own material where one row's eave lies over the next row down (in the
  // same slope). The game shows both materials there unless the piece on top is listed later, so pieces higher up the
  // roof (whose eaves lie over the rows below) are listed after the lower ones.
  const edged = hasEdging(shape.params) ? [...edgeSwap(shape, pieces).pieces].sort((a, b) => a.max[1] - b.max[1]) : pieces;
  if (!isDoubleRoof(shape.params)) return edged;
  // Double thick: the inside layer's pieces are listed first. Where pieces overlap the game shows both materials
  // unless the later piece is the one on top (seen in game on 2026-11-03).
  // (Its blocks, where a piece would need cutting, are with the roof's other blocks; see roofBlocks.) Triple thick: a
  // second layer of the roof's own material between the inside layer and the roof (see secondLayer).
  const second = isTripleRoof(shape.params) ? innerLayer(secondLayer(shape), pieces).pieces : [];
  return [...innerLayer(shape, pieces).pieces, ...second, ...edged];
}

/**
 * A triple-thick roof's second layer of its own material, as an inside layer of its own: half a meter under the roof
 * (no drop setting; the same material can't bleed through), receded with the inside layer when that is, with its own
 * choice of gable ends (`recedeEnds2`).
 */
function secondLayer(shape: Shape): Shape {
  const p = shape.params;
  return { ...shape, params: { ...p, double: 1, secondLayer: 1, innerDrop: 0, innerMaterial: shape.materialItem, recedeEnds: Number(p.recedeEnds2 ?? RECEDE_BOTH_ENDS) } };
}

/**
 * The inside layer of a double-thick roof of pieces: the same pieces half a meter lower, in the inside material.
 * Receded, the inside layer stops one block short of every eave and gable end (not a shed's high side). At 45
 * degrees, half a meter down is the same slope as half a meter in, so a piece along the eaves moves in by half a meter
 * (uphill, along each way it slopes down) instead of down, which lands it in the same slope one block short of the
 * eave; a piece at a gable end slides half a meter along the slope, away from the end. A piece
 * that reaches the top of the roof (a roof one row deep) can't move in without poking through the ridge, and a
 * blueprint can't record blocks taken out of a piece (confirmed with Embervale on 2026-11-04). So a 4 m roof's
 * inside layer is laid in 2 m pieces instead (see innerLayer); a 2 m piece's part of the layer is built from blocks
 * in the space the piece took (one block under the roof's slope, without the column at the eave).
 */
const innerLayerMemo = new Map<string, { pieces: RoofPiece[]; blocks: [number, number, number][] }>();

function innerLayer(shape: Shape, outer: RoofPiece[]): { pieces: RoofPiece[]; blocks: [number, number, number][] } {
  // Worked out once per roof (roofPieces and roofBlocks both need it).
  const key = JSON.stringify([shape.kind, shape.params, shape.materialItem, shape.position, outer.length]);
  const hit = innerLayerMemo.get(key);
  if (hit) return hit;
  const out = innerLayerUncached(shape, outer);
  if (innerLayerMemo.size > 64) innerLayerMemo.clear();
  innerLayerMemo.set(key, out);
  return out;
}

function innerLayerUncached(shape: Shape, outer: RoofPiece[]): { pieces: RoofPiece[]; blocks: [number, number, number][] } {
  const layer = innerLayerFrom(shape, outer);
  if (layer.blocks.length === 0 || shape.params.pieceSize !== 4) return layer;
  // A 4 m piece that would need cutting: the same roof in 2 m pieces has twice the rows, so its pieces along the
  // eaves have a higher row to move in under, and the inside layer can stay all pieces.
  // (Without edging: the layers lie under the roof as it is shaped, whatever its edges are made of.)
  const small = { ...shape, params: { ...halfSizeParams(shape.params), double: 0, edging: 0 } };
  const outer2 = isBlockRoof(small) ? [] : roofPieces(small);
  if (outer2.length === 0) return layer;
  const layer2 = innerLayerFrom(shape, outer2);
  return layer2.blocks.length < layer.blocks.length ? layer2 : layer;
}

/** A 4 m piece roof's settings for the same roof in 2 m pieces: twice the rows, and twice the length in pieces. */
function halfSizeParams(p: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...p, pieceSize: 2 };
  for (const [k, v] of Object.entries(p)) {
    if (/^(rows|extraRows)$|Rows$/.test(k)) out[k] = v * 2;
    else if (p.units !== LENGTH_IN_METERS && /^length$|Len$/.test(k)) out[k] = v * 2;
  }
  return out;
}

function innerLayerFrom(shape: Shape, outer: RoofPiece[]): { pieces: RoofPiece[]; blocks: [number, number, number][] } {
  const material = innerMaterial(shape.params);
  const move = (q: RoofPiece, d: Vec3): RoofPiece => {
    const add = (v: Vec3): Vec3 => [v[0] + d[0], v[1] + d[1], v[2] + d[2]];
    return { ...q, pos: add(q.pos), min: add(q.min), max: add(q.max), materialItem: material };
  };
  // A little further down than the slope needs, so the inside material doesn't bleed through the roof where the
  // layers' pieces meet (seen in game on 2026-11-04).
  // A triple-thick roof's inside layer goes under its second layer of roof material, a block further down.
  const gap = INNER_GAP, drop = innerDrop(shape.params) + (isTripleRoof(shape.params) ? INNER_DROP : 0);
  const dropped = outer.map((q) => move(q, [0, -drop - gap, 0]));
  const p = shape.params;
  const receding = recedes(p), second = Number(p.secondLayer) === 1;
  // The layer's bottom is always level with the roof's eaves (flush), so its eave pieces move in rather than down.
  // Receded, the inside layer comes in one block further at the eaves, and both it and a triple-thick roof's second
  // layer slide in from the gable ends chosen; the second layer stays level-flush at the eaves.
  const b = blockRoof(shape.kind as RoofKind, layerEdgeParams(p));
  const rim = new Set(placeColumns(shape, b, b.lip).map(([x, , z]) => `${x},${z}`));
  const extra = receding && !second ? INNER_DROP : 0;
  const base = roofBounds(shape).min[1];
  const columns = (q: RoofPiece) => {
    const out: string[] = [];
    for (let x = Math.round(q.min[0] * 2); x < Math.round(q.max[0] * 2); x++) for (let z = Math.round(q.min[2] * 2); z < Math.round(q.max[2] * 2); z++) out.push(`${x},${z}`);
    return out;
  };
  // The rim columns just beyond one side of a piece (dir: the side's outward direction).
  const beyond = (q: RoofPiece, dir: Vec3) => {
    const [x0, x1, z0, z1] = [Math.round(q.min[0] * 2), Math.round(q.max[0] * 2), Math.round(q.min[2] * 2), Math.round(q.max[2] * 2)];
    const out: string[] = [];
    if (dir[0] !== 0) { const x = dir[0] > 0 ? x1 : x0 - 1; for (let z = z0; z < z1; z++) out.push(`${x},${z}`); }
    else { const z = dir[2] > 0 ? z1 : z0 - 1; for (let x = x0; x < x1; x++) out.push(`${x},${z}`); }
    return out.some((c) => rim.has(c));
  };
  // Whether a piece moved in stays under the roof: sampled over its ground, its top is nowhere above the roof's (it is
  // its drop below on its own slopes, and rises toward the roof's surface past a ridge or hip, where it would poke
  // through). Pieces beside a hip come within reach of the hip's other slope; 0.16.8 built those and they looked right.
  // The roof's pieces by 1 m square, for finding the ones over a point quickly.
  const near = new Map<string, RoofPiece[]>();
  for (const u of outer) for (let i = Math.floor(u.min[0]); i < Math.ceil(u.max[0]); i++) for (let j = Math.floor(u.min[2]); j < Math.ceil(u.max[2]); j++) {
    const k = `${i},${j}`; const list = near.get(k); if (list) list.push(u); else near.set(k, [u]);
  }
  const outerTop = (x: number, z: number) => {
    let t = -Infinity;
    for (const u of near.get(`${Math.floor(x)},${Math.floor(z)}`) ?? []) { const v = pieceTopAt(u, x, z); if (v !== null && v > t) t = v; }
    return t;
  };
  const belowRidge = (q: RoofPiece, _downhill: Vec3[]) => {
    for (let x = q.min[0] + 0.125; x < q.max[0]; x += 0.25) for (let z = q.min[2] + 0.125; z < q.max[2]; z += 0.25) {
      const t = pieceTopAt(q, x, z);
      if (t !== null && t > outerTop(x, z) + 1e-6) return false;
    }
    return true;
  };
  // Whether a rim column touches one of the piece's corners from outside.
  const corner = (q: RoofPiece) => {
    const [x0, x1, z0, z1] = [Math.round(q.min[0] * 2), Math.round(q.max[0] * 2), Math.round(q.min[2] * 2), Math.round(q.max[2] * 2)];
    return [[x0 - 1, z0 - 1], [x0 - 1, z1], [x1, z0 - 1], [x1, z1]].some(([x, z]) => rim.has(`${x},${z}`));
  };
  const overlaps = (a: RoofPiece, c: RoofPiece) => a.min[0] < c.max[0] - 1e-9 && c.min[0] < a.max[0] - 1e-9 && a.min[2] < c.max[2] - 1e-9 && c.min[2] < a.max[2] - 1e-9;
  const same = (a: Vec3, c: Vec3) => a[0] === c[0] && a[2] === c[2];
  const pieces: RoofPiece[] = [];
  const replaced = new Set<string>();
  outer.forEach((o, n) => {
    const sides: Vec3[] = ([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]).filter((f) => beyond(o, f));
    // A valley's low corner can meet the rim at a point only (an L's inside corner): it's at the eave all the same.
    const atCorner = sides.length === 0 && o.type.form === 'inner' && corner(o);
    // Downhill in the piece's own frame: +x for every piece, also -z for an Outer Corner and +z for an Inner Corner.
    const m = fromQuaternion(YAW_QUATERNION[o.yaw]);
    const local: Vec3[] = [[1, 0, 0]];
    if (o.type.form === 'outer') local.push([0, 0, -1]);
    if (o.type.form === 'inner') local.push([0, 0, 1]);
    const downhill = local.map((v) => { const w = apply(m, v); return [Math.round(w[0]), 0, Math.round(w[2])] as Vec3; });
    // At 45 degrees, moving uphill (against every way the piece slopes down) is the same slope as moving down. A piece
    // at an eave moves all the way in instead of down, so the layer ends short of the eave and level with it; any
    // other piece moves in just enough to keep its low edge from reaching below the eaves (a deep drop on a small roof).
    const total = drop + gap;
    const atEave = atCorner || sides.some((f) => downhill.some((g) => same(f, g)));
    const inward = atEave ? total + extra : Math.max(0, Math.round((total - (o.min[1] - base)) * 1000) / 1000);
    const d: Vec3 = [0, -(total - inward), 0];
    for (const g of downhill) { d[0] -= g[0] * inward; d[2] -= g[2] * inward; }
    let ok = true;
    for (const f of sides) {
      if (downhill.some((g) => same(f, g))) continue;
      // At a gable end: a Roof Side slides half a meter along its slope's level line, away from the end. Any other
      // side of a piece at the rim (a corner's high side) can't move without leaving the slope.
      const across = o.type.form === 'side' && downhill.every((g) => g[0] * f[0] + g[2] * f[2] === 0);
      if (!across) { ok = false; break; }
      d[0] -= f[0] * INNER_DROP; d[2] -= f[2] * INNER_DROP;
    }
    const moved = move(o, d);
    // Moved in, it must stay on its own slopes (not reach past the ridge and poke through); otherwise its part of the
    // layer is blocks.
    if (ok && (inward === 0 || belowRidge(moved, downhill))) pieces.push(moved);
    else columns(o).forEach((c) => replaced.add(c));
  });
  // Blocks don't move in like pieces do: they sit as low as the pieces would, and lose what would hang below the eaves.
  const shift = Math.round((drop + gap) / INNER_DROP);
  // (Flush: level with the eaves. Receded, the inside layer one block further in, as its pieces are.)
  const rakes = new Set(layerEdges(shape, b, receding, true).map(([x, , z]) => `${x},${z}`));
  const level = replaced.size === 0 ? [] : notHanging(shape, b, columnCells(shape, b).filter(([x, , z]) => replaced.has(`${x},${z}`) && !rakes.has(`${x},${z}`))
    .map(([x, y, z]) => [x, y - shift, z] as [number, number, number]));
  const blocks = receding && !second ? retract(shape, b, level, new Set()) : level;
  return { pieces, blocks };
}

// ---------- Roofs at other angles, built from blocks ----------

/**
 * Roof angles offered. 45 degrees uses the game's roof pieces; the others are built from blocks. SET_BY_HEIGHT
 * builds from blocks too, with the slope following from the roof's height (`height`, in meters) over its width.
 * Gables and sheds also take CUSTOM_ANGLE (any angle, `customAngle` in degrees) and RISE_RUN (a pitch, `pitchRise`
 * over `pitchRun`), both built from blocks as closely as the roof's size allows.
 */
export const SET_BY_HEIGHT = 0;
export const CUSTOM_ANGLE = -1;
export const RISE_RUN = -2;
export const ROOF_ANGLES = [45, 22.5, 33.3, 67.5, SET_BY_HEIGHT, CUSTOM_ANGLE, RISE_RUN] as const;
const PIECE_ANGLE = 45;

/** The roof's angle in degrees, one of ROOF_ANGLES (45 when missing or unknown). */
export function roofAngle(p: Record<string, number>): number {
  const a = Number(p.angle);
  return (ROOF_ANGLES as readonly number[]).includes(a) ? a : PIECE_ANGLE;
}

/** Whether a roof shape is built from blocks: any angle but 45 degrees, or a gable with an off-center ridge. */
export function isBlockRoof(shape: Shape): boolean {
  if (!isRoof(shape.kind)) return false;
  if (isJoinedKind(shape.kind)) return joinedUsesBlocks(shape.kind, shape.params);
  return roofAngle(shape.params) !== PIECE_ANGLE || asymmetry(shape.kind, shape.params) === ASYM_OFF_CENTER;
}

/** The slope as rise over run for an angle choice (a standard angle, a custom angle or a pitch); null for set by height. */
function slopeRatio(angle: number, p: Record<string, number>): number | null {
  if (angle === SET_BY_HEIGHT) return null;
  if (angle === RISE_RUN) {
    const rise = Math.max(0, Number(p.pitchRise ?? 6)), run = Math.max(0.5, Number(p.pitchRun ?? 12));
    return rise / run;
  }
  const deg = angle === CUSTOM_ANGLE ? Math.min(89, Math.max(1, Number(p.customAngle ?? 30))) : angle;
  return Math.tan((deg * Math.PI) / 180);
}

/** Blocks a slope rises over a run of `run` blocks: by the angle, or from the roof's set height. */
function riseFor(p: Record<string, number>, run: number): number {
  const ratio = slopeRatio(roofAngle(p), p);
  // Set by height: the roof is `height` meters tall, so its ridge's top block is that many half meters up, less one.
  if (ratio === null) return Math.max(1, Math.round(Number(p.height ?? 4) * 2) - 1);
  return Math.max(1, Math.round(run * ratio));
}

/** Block columns of a roof in its own frame, before its facing: x by z columns, each filled from bottom to top. */
interface BlockRoof {
  /** Columns along x and z (0.5 m each). */
  nx: number;
  nz: number;
  /** Top and bottom block (in 0.5 m steps above the eave), per column x * nz + z; -1 where there is no roof. */
  top: Int16Array;
  bottom: Int16Array;
  /** Blocks tall. */
  height: number;
  /** The slope as built: rise and run in blocks, from the eave to the ridge. */
  rise: number;
  run: number;
  /** An off-center ridge's other side, when it differs. */
  other?: { rise: number; run: number };
  /** Each arm's slope, for L, T and cross roofs. */
  arms?: { rise: number; run: number }[];
  /**
   * For a roof built from pieces: where the block layout sits in the pieces' box (its column 0 is `dx`, `dz` blocks
   * from the box's corner) and the box's size in blocks, so blocks worked out from it line up with the pieces.
   */
  frame?: { dx: number; dz: number; nx: number; nz: number };
  /** An L, T or cross roof's block layout: where its column 0 is from the junction, in blocks. */
  origin?: [number, number];
  /** Neighboring columns (x, z, x2, z2) left open where an arm ends beside another (an open gable, not a wall). */
  cuts?: [number, number, number, number][];
  /**
   * The rim: the columns just outside each eave and gable end (not a shed's high side or a junction), with the level
   * one block below the lowest column beside it, as (column x, column z, block up) in the same frame as `top`; x and
   * z can be -1 or nx / nz.
   */
  lip: [number, number, number][];
  /** The same for the eaves alone (no gable ends). */
  eaves: [number, number, number][];
}

const blockRoofMemo = new Map<string, BlockRoof>();

/**
 * Lays a roof out in blocks. The plan is the same as at 45 degrees (the same wings, eaves and trimmed ends), and
 * each column's height comes from its distance to the nearest eave, measured square-wise like the piece roofs, so
 * hips and valleys fall out the same way.
 *
 * The slope: a slope's run is the columns from the eave to the ridge, `run` steps; its rise is that run times the
 * tangent of the angle, rounded to whole blocks, so the roof keeps the angle as closely as its size allows. The
 * last step under the ridge is one up and one across; below it the uneven steps are spread evenly along the slope
 * (see heightAt), so a gentle slope's flat stretches and a steep slope's climbs never differ by more than one.
 *
 * Each column is filled down to its lowest neighbor's top, so neighboring columns always share a face and the
 * roof has no see-through gaps however steep it is.
 */
function blockRoof(kind: RoofKind, p: Record<string, number>): BlockRoof {
  const memoKey = JSON.stringify([kind, p]);
  const hit = blockRoofMemo.get(memoKey);
  if (hit) return hit;
  if (isJoinedKind(kind)) {
    // A junction roof built from pieces has its arms' widths from their rows; a width typed in while it was built from
    // blocks (still saved) must not shape the block layout its edging and layers are worked out from.
    const pieces = joinedPieceLayout(kind, p);
    const q = pieces ? Object.fromEntries(Object.entries(p).filter(([k]) => !ROOF_ARMS[kind].some((a) => k === `${a.key}Width`))) : p;
    let joined = joinedBlockRoof(kind, q);
    if (pieces?.origin && joined.origin) {
      // Line the blocks up with the pieces: both are laid out from the junction, but each box starts at its own edge.
      joined = { ...joined, frame: { dx: joined.origin[0] - Math.round(pieces.origin[0] * 2), dz: joined.origin[1] - Math.round(pieces.origin[1] * 2), nx: Math.round(pieces.size[0] * 2), nz: Math.round(pieces.size[2] * 2) } };
    }
    if (blockRoofMemo.size > 64) blockRoofMemo.clear();
    blockRoofMemo.set(memoKey, joined);
    return joined;
  }
  const { run: S, rows } = layoutParams(p);
  const V = 2; // blocks per meter
  // Rectangles in blocks: the roof itself (with eaves), and carried on past its open ends for measuring.
  const far = 4 * rows * S + 8;
  const rects = roofWings(kind, p).map((w) => {
    const t = w.trim ?? {};
    const side = (d: Downhill) => (w.open.includes(d) ? 0 : EAVE);
    const r = {
      x0: (w.x0 * S + (t['-x'] ?? 0) - side('-x')) * V, x1: (w.x1 * S - (t['+x'] ?? 0) + side('+x')) * V,
      z0: (w.z0 * S + (t['-z'] ?? 0) - side('-z')) * V, z1: (w.z1 * S - (t['+z'] ?? 0) + side('+z')) * V,
    };
    const carried = {
      x0: w.open.includes('-x') ? r.x0 - far : r.x0, x1: w.open.includes('+x') ? r.x1 + far : r.x1,
      z0: w.open.includes('-z') ? r.z0 - far : r.z0, z1: w.open.includes('+z') ? r.z1 + far : r.z1,
    };
    return { r, carried };
  });
  const x0 = Math.min(...rects.map((q) => q.r.x0)), x1 = Math.max(...rects.map((q) => q.r.x1));
  const z0 = Math.min(...rects.map((q) => q.r.z0)), z1 = Math.max(...rects.map((q) => q.r.z1));
  const nx = Math.round(x1 - x0), nz = Math.round(z1 - z0);
  // A grid with a border wide enough to measure from: the slope's full run plus one.
  const run = Math.round((rows * S + EAVE) * V) - 1;
  const pad = run + 2;
  const gx = nx + 2 * pad, gz = nz + 2 * pad;
  const inside = (q: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => x >= q.x0 && x < q.x1 && z >= q.z0 && z < q.z1;
  // Chessboard distance to the nearest column outside the (carried) roof, by two sweeps.
  const BIG = 1 << 14;
  const dist = new Int32Array(gx * gz);
  for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) {
    const x = x0 - pad + i, z = z0 - pad + j;
    dist[i * gz + j] = rects.some((q) => inside(q.carried, x, z)) ? BIG : 0;
  }
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= gx || j >= gz ? BIG : dist[i * gz + j]);
  for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) {
    const n = i * gz + j;
    if (dist[n] === 0) continue;
    dist[n] = Math.min(dist[n], at(i - 1, j - 1) + 1, at(i - 1, j) + 1, at(i - 1, j + 1) + 1, at(i, j - 1) + 1);
  }
  for (let i = gx - 1; i >= 0; i--) for (let j = gz - 1; j >= 0; j--) {
    const n = i * gz + j;
    if (dist[n] === 0) continue;
    dist[n] = Math.min(dist[n], at(i + 1, j + 1) + 1, at(i + 1, j) + 1, at(i + 1, j - 1) + 1, at(i, j + 1) + 1);
  }
  let rise = riseFor(p, run);
  let slopeRun = run;
  let other: { rise: number; run: number } | undefined;
  // Columns from each eave, for gables and hips that aren't symmetric.
  const asym = asymmetry(kind, p);
  let columnTop: ((i: number, j: number) => number) | null = null;
  if (asym === ASYM_SALTBOX) {
    // Same pitch on every slope: the long side's slope, entered further up on the short side and the hip ends.
    const { minus, plus } = sideRows(kind, p, rows);
    const runM = 2 * minus * S, runP = 2 * plus * S, long = Math.max(runM, runP), short = Math.min(runM, runP);
    rise = riseFor(p, long);
    slopeRun = long;
    const f = (d: number) => heightAt(d, rise, long);
    columnTop = (i, j) => Math.min(f(j + long - runM), f(nz - 1 - j + long - runP),
      kind === 'roofHip' ? f(Math.min(i, nx - 1 - i) + long - short) : Infinity);
  } else if (asym === ASYM_OFF_CENTER) {
    // Level eaves, the ridge moved toward +z by ridgeOffset meters: each side keeps its own run, both rise the same.
    const half = 2 * rows * S + 1;
    const shift = Math.max(-(half - 3), Math.min(half - 3, Math.round(Number(p.ridgeOffset ?? 0) * 2)));
    const runM = half + shift - 1, runP = half - shift - 1;
    rise = riseFor(p, Math.max(runM, runP));
    slopeRun = Math.max(runM, runP);
    other = { rise, run: Math.min(runM, runP) };
    columnTop = (_i, j) => Math.min(heightAt(j, rise, runM), heightAt(nz - 1 - j, rise, runP));
  }
  const top = new Int16Array(nx * nz).fill(-1);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = x0 + i, z = z0 + j;
    if (!rects.some((q) => inside(q.r, x, z))) continue;
    if (columnTop) {
      top[i * nz + j] = columnTop(i, j);
      continue;
    }
    // Steps from the eave: 0 at the eave, `run` at the ridge.
    const d = Math.min(run, dist[(i + pad) * gz + (j + pad)] - 1);
    top[i * nz + j] = heightAt(d, rise, run);
  }
  const bottom = new Int16Array(nx * nz).fill(-1);
  let height = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const t = top[i * nz + j];
    if (t < 0) continue;
    let b = t;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, c = j + dj;
      if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
      const tn = top[a * nz + c];
      if (tn >= 0) b = Math.min(b, tn);
    }
    bottom[i * nz + j] = b;
    height = Math.max(height, t + 1);
  }
  // The rim takes in gable ends (the ends along the ridge, x here); a shed's high side stays out.
  const wingRects = rects.map(({ r }, n) => ({ x0: r.x0 - x0, x1: r.x1 - x0, z0: r.z0 - z0, z1: r.z1 - z0, open: roofWings(kind, p)[n].open }));
  const ends = recededEnds(p);
  const lip = eaveLip(nx, nz, top, wingRects.map((w) => ({ ...w, open: w.open.filter((d) => !(alongX(d) && ends.includes(d))) })));
  const out: BlockRoof = { nx, nz, top, bottom, height, rise, run: slopeRun, other, lip, eaves: eaveLip(nx, nz, top, wingRects) };
  if (blockRoofMemo.size > 64) blockRoofMemo.clear();
  blockRoofMemo.set(memoKey, out);
  return out;
}

/**
 * The columns just outside a roof's eaves: outside the roof, but within one column of a wing's side that isn't open
 * (a gable's rake, a shed's high side and the cut at a junction are open). Each sits one block below the lowest
 * roof column beside it. Wings are in columns, x1 and z1 exclusive.
 */
function eaveLip(nx: number, nz: number, top: Int16Array, wings: { x0: number; x1: number; z0: number; z1: number; open: Downhill[] }[]): [number, number, number][] {
  const topAt = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz ? -1 : top[i * nz + j]);
  const out: [number, number, number][] = [];
  for (let i = -1; i <= nx; i++) for (let j = -1; j <= nz; j++) {
    if (topAt(i, j) >= 0) continue;
    const near = wings.some((w) => i >= w.x0 - (w.open.includes('-x') ? 0 : 1) && i < w.x1 + (w.open.includes('+x') ? 0 : 1)
      && j >= w.z0 - (w.open.includes('-z') ? 0 : 1) && j < w.z1 + (w.open.includes('+z') ? 0 : 1));
    if (!near) continue;
    let low = Infinity;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const t = topAt(i + a, j + c); if (t >= 0) low = Math.min(low, t); }
    if (low < Infinity) out.push([i, j, low - 1]);
  }
  return out;
}

/**
 * Blocks up at `d` steps from the eave. The game draws its ridge texture only on a peak one column wide on each side
 * that stands one block above the columns next to it (confirmed in game on 2026-11-03: a 4-wide flat top at
 * 22.5 degrees and a 2-block drop at 67.5 degrees both lost the ridge texture). So the last step is always one up
 * over one across, and the rest of the rise is spread evenly over the rest of the run.
 */
function heightAt(d: number, rise: number, run: number): number {
  if (d >= run) return rise;
  // Gentle slopes: the columns below the ridge share the heights 0 to rise - 1 as evenly as they can, so the flat
  // stretches differ by at most one column and sit symmetrically (3, 2, 3 rather than 2, 4, 2).
  if (rise <= run) return Math.floor(((d + 0.5) * rise) / run);
  // Steep slopes: each column climbs the same or one more than the last, from 0 at the eave to rise - 1.
  return Math.floor((d * (rise - 1)) / (run - 1) + 0.5);
}

/** The slope a block roof is built with: rise and run in blocks and the angle that gives. Null for piece roofs. */
export interface Slope { rise: number; run: number; degrees: number }
export function roofSlope(shape: Shape): (Slope & { other?: Slope; arms?: Slope[] }) | null {
  if (!isBlockRoof(shape)) return null;
  const b = blockRoof(shape.kind as RoofKind, shape.params);
  const deg = (rise: number, run: number) => (Math.atan2(rise, run) * 180) / Math.PI;
  return {
    rise: b.rise, run: b.run, degrees: deg(b.rise, b.run),
    other: b.other && { ...b.other, degrees: deg(b.other.rise, b.other.run) },
    arms: b.arms?.map((a) => ({ ...a, degrees: deg(a.rise, a.run) })),
  };
}

/** The same roof's block layout (as if built from blocks), placed: for tests and for comparing with its pieces. */
export const blockLayoutCells = (shape: Shape): [number, number, number][] => columnCells(shape, blockRoof(shape.kind as RoofKind, shape.params));

/** World cells (i, j, k on the 0.5 m grid) of a block roof, turned by its facing and placed in its box. */
export function blockRoofCells(shape: Shape): [number, number, number][] {
  return isBlockRoof(shape) ? columnCells(shape, blockRoof(shape.kind as RoofKind, shape.params)) : [];
}

/** World columns of a block roof left open where an arm ends beside another, as "i,k|i2,k2" (the higher first). */
export function blockRoofOpenCuts(shape: Shape): Set<string> {
  if (!isBlockRoof(shape)) return new Set();
  const b = blockRoof(shape.kind as RoofKind, shape.params);
  return new Set((b.cuts ?? []).map(([i, j, a, c]) => {
    const [p, q] = placeColumns(shape, b, [[i, j, 0], [a, c, 0]]);
    return `${p[0]},${p[2]}|${q[0]},${q[2]}`;
  }));
}

/** Local block-roof cells (column x, column z, block up) turned by the roof's facing and placed in its box. */
function placeColumns(shape: Shape, b: { nx: number; nz: number; frame?: BlockRoof['frame'] }, local: [number, number, number][]): [number, number, number][] {
  const yaw = roofYaw(shape.params);
  const { min } = roofBounds(shape);
  const base = min.map((v) => Math.round(v * 2));
  const f = b.frame ?? { dx: 0, dz: 0, nx: b.nx, nz: b.nz };
  // Quarter turns as the yaw quaternions do them: 90 takes +x to -z.
  return local.map(([i0, j0, y]) => {
    const i = i0 + f.dx, j = j0 + f.dz;
    const [u, w] = yaw === 0 ? [i, j] : yaw === 90 ? [j, f.nx - 1 - i] : yaw === 180 ? [f.nx - 1 - i, f.nz - 1 - j] : [f.nz - 1 - j, i];
    return [base[0] + u, base[1] + y, base[2] + w];
  });
}

/** Whether a roof is double thick: a second layer, in its own material, half a meter under the roof. */
export const isDoubleRoof = (p: Record<string, number>) => Number(p.double) === 1 || Number(p.double) === 2;
/** Whether a roof is triple thick: two layers of its own material over the inside layer. */
export const isTripleRoof = (p: Record<string, number>) => Number(p.double) === 2;
/** How far the inside layer sits under the roof, in meters (0.5 m confirmed in game on 2026-11-03). */
export const INNER_DROP = 0.5;
/**
 * How much further down a pieces roof's inside layer sits, in meters, on top of its drop: keeps its material from
 * bleeding through where the layers' pieces meet (seen in game on 2026-11-04). A whole block: the game appears to
 * put pieces on the 0.5 m grid (rounding down), so a 0.1 m step came out as 0.5 m, and pieces moved sideways off the
 * grid landed 0.5 m apart on the two sides of a roof (one side's eave pieces thinner; seen in game on 2026-11-04).
 * Everything the inside layer does now stays on the grid.
 */
export const INNER_GAP = 0.5;
/**
 * How many blocks further down the inside layer sits (0 to 5). A roof of pieces' layer sits that many blocks under the
 * roof plus the block against bleeding through (INNER_GAP), so 0 is half a meter under it. A block roof's layer
 * touches the roof at 0 and 1 (blocks don't bleed through) and sits one block lower for each block over 1.
 */
export const innerDropBlocks = (p: Record<string, number>) => Math.max(0, Math.min(5, Math.round(Number(p.innerDrop ?? 1))));
/** The same in meters. */
export const innerDrop = (p: Record<string, number>) => innerDropBlocks(p) * INNER_DROP;
/** The inside layer's material when none is set: Refined Wood. */
export const DEFAULT_INNER_MATERIAL = 1358536105;
export const innerMaterial = (p: Record<string, number>) => Number(p.innerMaterial ?? DEFAULT_INNER_MATERIAL);
/** Which gable ends a receded inside layer recedes from (`recedeEnds`): both, neither, or the one toward -x / -z or +x / +z. */
export const RECEDE_BOTH_ENDS = 0;
export const RECEDE_NO_ENDS = 1;
export const RECEDE_NEGATIVE_END = 2;
export const RECEDE_POSITIVE_END = 3;

/**
 * A gable's or shed's receded gable ends, in its own frame (where the ridge runs along x): the ends toward -x / -z
 * and +x / +z in the world, found by turning each end by the roof's facing.
 */
function recededEnds(p: Record<string, number>): Downhill[] {
  const choice = Number(p.recedeEnds ?? RECEDE_BOTH_ENDS);
  if (choice === RECEDE_BOTH_ENDS) return ['-x', '+x'];
  if (choice === RECEDE_NO_ENDS) return [];
  const w = apply(fromQuaternion(YAW_QUATERNION[roofYaw(p)]), [-1, 0, 0]);
  const minusIsNegative = w[0] + w[2] < 0;
  return [(choice === RECEDE_NEGATIVE_END) === minusIsNegative ? '-x' : '+x'];
}

/** Whether a double-thick roof's inside layer recedes one block from the roof's eaves and gable ends. */
export const recedes = (p: Record<string, number>) => isDoubleRoof(p) && Number(p.recede) === 1;

/**
 * A receded inside layer's blocks without the ones hanging below the roof's eaves: a block is kept only as low as the
 * lowest block of the eave nearest it, so the layer's new edge stops level with the roof's eave instead of a block
 * under it (and flat stretches near the eave of a gentle slope don't hang either).
 */
function notHanging(shape: Shape, b: BlockRoof, cells: [number, number, number][], raise = 0): [number, number, number][] {
  // Each column's nearest eave column's lowest block, spread from the eave columns over the roof (breadth first).
  const level = new Int32Array(b.nx * b.nz).fill(-1 << 20);
  const seen = new Uint8Array(b.nx * b.nz);
  let queue: number[] = [];
  for (const [i, j] of b.eaves) for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
    const u = i + a, w = j + c, n = u * b.nz + w;
    if (u < 0 || w < 0 || u >= b.nx || w >= b.nz || b.top[n] < 0 || seen[n]) continue;
    seen[n] = 1; level[n] = b.bottom[n]; queue.push(n);
  }
  while (queue.length) {
    const next: number[] = [];
    for (const n of queue) {
      const i = Math.floor(n / b.nz), j = n % b.nz;
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = i + a, w = j + c, m = u * b.nz + w;
        if (u < 0 || w < 0 || u >= b.nx || w >= b.nz || b.top[m] < 0 || seen[m]) continue;
        seen[m] = 1; level[m] = level[n]; next.push(m);
      }
    }
    queue = next;
  }
  const local: [number, number, number][] = [];
  for (let i = 0; i < b.nx; i++) for (let j = 0; j < b.nz; j++) if (seen[i * b.nz + j]) local.push([i, j, level[i * b.nz + j]]);
  const eave = new Map(placeColumns(shape, b, local).map(([x, y, z]) => [`${x},${z}`, y]));
  return cells.filter(([x, y, z]) => { const v = eave.get(`${x},${z}`); return v === undefined || y >= v + raise; });
}

/**
 * Each roof column's distance from the eaves, in columns (1 next to them), placed in the world: spread from the
 * columns just outside the eaves over the roof.
 */
function eaveDistance(shape: Shape, b: BlockRoof): Map<string, number> {
  const dist = new Int32Array(b.nx * b.nz).fill(-1);
  let queue: number[] = [];
  const inside = (u: number, w: number) => u >= 0 && w >= 0 && u < b.nx && w < b.nz && b.top[u * b.nz + w] >= 0;
  for (const [i, j] of b.eaves) for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const u = i + a, w = j + c;
    if (inside(u, w) && dist[u * b.nz + w] < 0) { dist[u * b.nz + w] = 1; queue.push(u * b.nz + w); }
  }
  while (queue.length) {
    const next: number[] = [];
    for (const n of queue) {
      const i = Math.floor(n / b.nz), j = n % b.nz;
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = i + a, w = j + c;
        if (inside(u, w) && dist[u * b.nz + w] < 0) { dist[u * b.nz + w] = dist[n] + 1; next.push(u * b.nz + w); }
      }
    }
    queue = next;
  }
  const local: [number, number, number][] = [];
  for (let i = 0; i < b.nx; i++) for (let j = 0; j < b.nz; j++) if (dist[i * b.nz + j] > 0) local.push([i, j, dist[i * b.nz + j]]);
  const base = Math.round(roofBounds(shape).min[1] * 2);
  return new Map(placeColumns(shape, b, local).map(([x, y, z]) => [`${x},${z}`, y - base]));
}

/**
 * A receded layer of blocks: the flush layer one block further in. It loses its columns along its edge toward the
 * eaves (where the roof column beyond is nearer the eaves and has none of the layer) and the gable-end columns in
 * `ends`.
 */
function retract(shape: Shape, b: BlockRoof, cells: [number, number, number][], ends: Set<string>): [number, number, number][] {
  const dist = eaveDistance(shape, b);
  const has = new Set(cells.map(([x, , z]) => `${x},${z}`));
  const drop = new Set<string>();
  for (const c of has) {
    const [x, z] = c.split(',').map(Number);
    const d = dist.get(c);
    if (d === undefined) continue;
    for (const [a, e] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = `${x + a},${z + e}`, dn = dist.get(n);
      // A neighbor nearer the eaves without the layer, or the eave edge itself.
      if (!has.has(n) && (dn === undefined ? d === 1 : dn < d)) drop.add(c);
    }
  }
  return cells.filter(([x, , z]) => !drop.has(`${x},${z}`) && !ends.has(`${x},${z}`));
}

/** A layer's settings for finding its edges: the gable ends it recedes from only when it recedes. */
function layerEdgeParams(p: Record<string, number>): Record<string, number> {
  return recedes(p) ? p : { ...p, recedeEnds: RECEDE_NO_ENDS };
}

/**
 * The columns a layer under the roof leaves out: none when flush; receded, the inside layer leaves out its eave and
 * chosen gable-end columns (one more block), a triple-thick roof's second layer only its chosen gable-end columns.
 */
function layerEdges(shape: Shape, b: BlockRoof, receding: boolean, second: boolean): [number, number, number][] {
  if (!receding) return [];
  const all = eaveColumns(shape, b);
  if (!second) return all;
  const eaves = new Set(eaveColumns(shape, b, b.eaves).map(([x, , z]) => `${x},${z}`));
  return all.filter(([x, , z]) => !eaves.has(`${x},${z}`));
}

/** Every column of a block roof's layout, top to bottom, placed in the world. */
function columnCells(shape: Shape, b: BlockRoof): [number, number, number][] {
  const local: [number, number, number][] = [];
  for (let i = 0; i < b.nx; i++) for (let j = 0; j < b.nz; j++) {
    const t = b.top[i * b.nz + j];
    if (t < 0) continue;
    for (let y = b.bottom[i * b.nz + j]; y <= t; y++) local.push([i, j, y]);
  }
  return placeColumns(shape, b, local);
}

/** The roof's columns at its eaves and gable ends (next to the rim just outside them; see eaveLip), placed in the world (y unused). */
function eaveColumns(shape: Shape, b: BlockRoof, from: [number, number, number][] = b.lip): [number, number, number][] {
  const out = new Map<string, [number, number, number]>();
  for (const [i, j] of from) for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
    const u = i + a, w = j + c;
    if (u >= 0 && w >= 0 && u < b.nx && w < b.nz && b.top[u * b.nz + w] >= 0) out.set(`${u},${w}`, [u, w, 0]);
  }
  return placeColumns(shape, b, [...out.values()]);
}

/**
 * A roof's blocks: a block roof's own cells and, on a double-thick roof, the inside layer's blocks (`inner`): one
 * block under each column of a block roof, or the part of a pieces roof's receded inside layer that can't be pieces
 * (see innerLayer). Receded, the inside layer leaves out the columns at the eaves and gable ends.
 */
export function roofBlocks(shape: Shape): { cells: [number, number, number][]; inner: [number, number, number][]; edge: [number, number, number][] } {
  const layers = roofLayerBlocks(shape);
  if (!hasEdging(shape.params)) return { ...layers, edge: [] };
  if (isBlockRoof(shape)) return { ...layers, edge: blockEdging(shape) };
  // A roof of pieces: the pieces that would be edging all over are built from blocks (see edgeSwap).
  const swap = edgeSwap(shape, roofPieces({ ...shape, params: { ...shape.params, edging: 0, double: 0 } }));
  return { cells: [...layers.cells, ...swap.blocks], inner: layers.inner, edge: swap.edge };
}

/**
 * The blocks a roof piece is made of in game: in each column it covers, the one block its top surface passes through
 * at the column's middle, so a 45 degree side is a staircase one block thick (a Roof Side 4M is 9 steps of 8 blocks:
 * recorded by Embervale with blocks deleted from a placed piece, 2026-11-05). Corners follow the same rule.
 */
export function pieceVoxels(q: RoofPiece): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let x = Math.round(q.min[0] * 2); x < Math.round(q.max[0] * 2); x++) for (let z = Math.round(q.min[2] * 2); z < Math.round(q.max[2] * 2); z++) {
    const t = pieceTopAt(q, (x + 0.5) * 0.5, (z + 0.5) * 0.5);
    if (t !== null) out.push([x, Math.floor(t * 2 - 1e-6), z]);
  }
  return out;
}

/** The ways a placed piece slopes down, in the world (+x in its own frame, and -z / +z for an Outer / Inner Corner). */
function downhillOf(q: RoofPiece): Vec3[] {
  const m = fromQuaternion(YAW_QUATERNION[q.yaw]);
  const local: Vec3[] = [[1, 0, 0]];
  if (q.type.form === 'outer') local.push([0, 0, -1]);
  if (q.type.form === 'inner') local.push([0, 0, 1]);
  return local.map((v) => { const w = apply(m, v); return [Math.round(w[0]), 0, Math.round(w[2])] as Vec3; });
}

/**
 * 2 m pieces to fill part of an edged roof that would otherwise be blocks (`area`, columns): the roof's own 2 m
 * pieces (or, on a 4 m roof, those of the same roof in 2 m pieces), as they are or moved half a meter up the slope
 * (and up, staying on it), wherever one lies wholly in the area, clear of the edging strips, exactly on the roof's
 * surface (not poking through past a ridge or hip) and not over ground another one covers.
 */
function edgeFill(shape: Shape, roof: RoofPiece[], area: Set<string>, strips: Set<string>): { pieces: RoofPiece[]; covered: Set<string> } {
  const p = shape.params;
  const small = p.pieceSize === 4 ? { ...shape, params: { ...halfSizeParams(p), double: 0, edging: 0 } } : { ...shape, params: { ...p, double: 0, edging: 0 } };
  const candidates = isBlockRoof(small) ? [] : roofPieces(small);
  const near = new Map<string, RoofPiece[]>();
  for (const u of roof) for (let i = Math.floor(u.min[0]); i < Math.ceil(u.max[0]); i++) for (let j = Math.floor(u.min[2]); j < Math.ceil(u.max[2]); j++) {
    const k = `${i},${j}`; const list = near.get(k); if (list) list.push(u); else near.set(k, [u]);
  }
  const roofTop = (x: number, z: number) => {
    let t = -Infinity;
    for (const u of near.get(`${Math.floor(x)},${Math.floor(z)}`) ?? []) { const v = pieceTopAt(u, x, z); if (v !== null && v > t) t = v; }
    return t;
  };
  const cols = (q: RoofPiece) => {
    const out: string[] = [];
    for (let x = Math.round(q.min[0] * 2); x < Math.round(q.max[0] * 2); x++) for (let z = Math.round(q.min[2] * 2); z < Math.round(q.max[2] * 2); z++) out.push(`${x},${z}`);
    return out;
  };
  // A piece's own ground: its box without the eave it hangs over the next piece down.
  const ground = (q: RoofPiece, downhill: Vec3[]) => cols(q).filter((c) => {
    const [x, z] = c.split(',').map(Number);
    return downhill.every((g) => (g[0] > 0 ? x < Math.round(q.max[0] * 2) - 1 : g[0] < 0 ? x > Math.round(q.min[0] * 2) : true)
      && (g[2] > 0 ? z < Math.round(q.max[2] * 2) - 1 : g[2] < 0 ? z > Math.round(q.min[2] * 2) : true));
  });
  const onRoof = (q: RoofPiece) => {
    for (let x = q.min[0] + 0.125; x < q.max[0]; x += 0.25) for (let z = q.min[2] + 0.125; z < q.max[2]; z += 0.25) {
      const t = pieceTopAt(q, x, z);
      if (t !== null && Math.abs(t - roofTop(x, z)) > 1e-6) return false;
    }
    return true;
  };
  const pieces: RoofPiece[] = [];
  const covered = new Set<string>(), owned = new Set<string>();
  for (const c of candidates) {
    const downhill = downhillOf(c);
    const up: Vec3 = [0, INNER_DROP, 0];
    for (const g of downhill) { up[0] -= g[0] * INNER_DROP; up[2] -= g[2] * INNER_DROP; }
    const shifted = (v: Vec3): Vec3 => [v[0] + up[0], v[1] + up[1], v[2] + up[2]];
    for (const v of [c, { ...c, pos: shifted(c.pos), min: shifted(c.min), max: shifted(c.max) }]) {
      const all = cols(v), own = ground(v, downhill);
      if (!all.every((k) => area.has(k) && !strips.has(k)) || own.some((k) => owned.has(k)) || !onRoof(v)) continue;
      pieces.push({ ...v, materialItem: shape.materialItem });
      all.forEach((k) => covered.add(k));
      own.forEach((k) => owned.add(k));
      break;
    }
  }
  return { pieces, covered };
}

const edgeSwapMemo = new Map<string, { pieces: RoofPiece[]; blocks: [number, number, number][]; edge: [number, number, number][] }>();

/**
 * Roof edging on a roof of pieces. A piece is one material, so edging is whole pieces (see pieceEdging). A piece that
 * runs from an eave to the ridge (a roof one row deep), or with no piece beside it that isn't edging (two rows deep),
 * would turn the roof into edging, so it is built from blocks at the same slope instead, with edging one block wide
 * as on a block roof. Returns the roof's top layer of pieces (edged
 * ones in the edging material, swapped ones left out), the blocks, and which of those are edging.
 */
function edgeSwap(shape: Shape, pieces: RoofPiece[]): { pieces: RoofPiece[]; blocks: [number, number, number][]; edge: [number, number, number][] } {
  const memoKey = JSON.stringify([shape.kind, shape.params, shape.position, shape.materialItem]);
  const hit = edgeSwapMemo.get(memoKey);
  if (hit) return hit;
  const flags = pieceEdging(shape, pieces);
  const material = edgeMaterial(shape.params);
  const swapped = new Set<string>();
  const kept: RoofPiece[] = [];
  // Next to each other: ground boxes touching or overlapping.
  const touch = (a: RoofPiece, c: RoofPiece) => a.min[0] <= c.max[0] + 1e-9 && c.min[0] <= a.max[0] + 1e-9 && a.min[2] <= c.max[2] + 1e-9 && c.min[2] <= a.max[2] + 1e-9;
  // Edging shows as a band only beside pieces that aren't edging; an edged piece with none beside it (a roof one or
  // two rows deep) is built from blocks.
  const swaps = pieces.map((q, n) => flags[n].edged && ((flags[n].eave && flags[n].ridge) || !pieces.some((u, k) => k !== n && !flags[k].edged && touch(q, u))));
  // An L, T or cross roof keeps one style of edging: once any of it has to be blocks (an arm one or two rows deep), all
  // of it is (one-block strips), rather than whole pieces of edging on some arms and strips on others.
  const allBlocks = isJoinedKind(shape.kind) && swaps.some(Boolean);
  const swappedPiece = pieces.map(() => false);
  let n: number;
  pieces.forEach((q, n) => {
    const f = flags[n];
    if (f.edged && (allBlocks || swaps[n])) {
      swappedPiece[n] = true;
      for (let x = Math.round(q.min[0] * 2); x < Math.round(q.max[0] * 2); x++) for (let z = Math.round(q.min[2] * 2); z < Math.round(q.max[2] * 2); z++) swapped.add(`${x},${z}`);
    } else kept.push(f.edged ? { ...q, materialItem: material } : q);
  });
  let blocks: [number, number, number][] = [], edge: [number, number, number][] = [];
  if (swapped.size) {
    const edgeColumns = blockEdgingColumns(shape);
    // Between the strips, 2 m pieces where they fit (those of the same roof in 2 m pieces, as they are or moved half a
    // meter up the slope, clear of the eave strip), so fewer blocks are needed.
    const fill = edgeFill(shape, pieces, swapped, edgeColumns);
    kept.push(...fill.pieces);
    // The swapped pieces as the game builds them from blocks (each piece's own staircase, one block per column; see
    // pieceVoxels), where no 2 m piece fills in.
    const seen = new Set<string>();
    for (n = 0; n < pieces.length; n++) {
      if (!swappedPiece[n]) continue;
      for (const c of pieceVoxels(pieces[n])) {
        const k = c.join();
        if (seen.has(k) || fill.covered.has(`${c[0]},${c[2]}`)) continue;
        seen.add(k);
        blocks.push(c);
      }
    }
    // Steps one block thick touch only at their edges: where two materials meet (the edging strip and the roof's
    // blocks, or blocks and pieces) the game leaves a gap between them (seen in game on 2026-11-05). So every block
    // column is filled down to its lowest neighbor's top, as a block roof's are, and a piece's lowest step beside
    // blocks gets a block under it, so neighbors always share a face.
    const top = new Map<string, number>(), kind = new Map<string, string>();
    const note = (x: number, y: number, z: number, k: string) => {
      const key = `${x},${z}`;
      if (y > (top.get(key) ?? -Infinity)) { top.set(key, y); kind.set(key, k); }
    };
    for (const q of kept) for (const [x, y, z] of pieceVoxels(q)) note(x, y, z, `piece${q.materialItem}`);
    for (const [x, y, z] of blocks) note(x, y, z, edgeColumns.has(`${x},${z}`) ? 'edge' : 'roof');
    const extra: [number, number, number][] = [];
    const extraEdge = new Set<string>();
    for (const [key, y] of top) {
      const [x, z] = key.split(',').map(Number);
      const own = kind.get(key)!;
      // A piece's column is filled under it only beside blocks (a block under a piece is hidden by it), in the piece's
      // material.
      if (own.startsWith('piece') && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => { const k = kind.get(`${x + a},${z + c}`); return k === 'edge' || k === 'roof'; })) continue;
      let low = y;
      let boundary = false;
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = `${x + a},${z + c}`;
        const t = top.get(n);
        if (t === undefined) continue;
        if (kind.get(n) !== own) boundary = true;
        low = Math.min(low, t);
      }
      // Blocks are always filled down to their lowest neighbor, so the underside is an even two blocks everywhere
      // (one block thick in some rows and two in others looked lumpy from below, 2026-11-05).
      if (!boundary && !own.startsWith('piece')) boundary = true;
      if (!boundary) continue;
      const edgeHere = own === 'edge' || own === `piece${material}`;
      for (let j = low; j < y; j++) if (!seen.has(`${x},${j},${z}`)) {
        seen.add(`${x},${j},${z}`);
        extra.push([x, j, z]);
        if (edgeHere) extraEdge.add(`${x},${j},${z}`);
      }
    }
    blocks.push(...extra);
    const added = new Set(extra.map((e) => e.join()));
    edge = blocks.filter(([x, y, z]) => (edgeColumns.has(`${x},${z}`) && !added.has(`${x},${y},${z}`)) || extraEdge.has(`${x},${y},${z}`));
  }
  const out = { pieces: kept, blocks, edge };
  if (edgeSwapMemo.size > 64) edgeSwapMemo.clear();
  edgeSwapMemo.set(memoKey, out);
  return out;
}

/**
 * Roof edging on a block roof: the roof's own blocks (its top layer) in the columns along the ridge, the eaves and,
 * if chosen, the gable ends, one block wide, to be built in the edging material.
 */
function blockEdging(shape: Shape): [number, number, number][] {
  const columns = blockEdgingColumns(shape);
  return blockRoofCells(shape).filter(([x, , z]) => columns.has(`${x},${z}`));
}

/** The columns of a roof's block layout that roof edging covers (see blockEdging). */
function blockEdgingColumns(shape: Shape): Set<string> {
  const p = shape.params;
  const b = blockRoof(shape.kind as RoofKind, { ...p, recedeEnds: RECEDE_BOTH_ENDS });
  const key = ([x, , z]: [number, number, number]) => `${x},${z}`;
  const eaves = new Set(eaveColumns(shape, b, b.eaves).map(key));
  const columns = new Set<string>();
  if (edgeOn(p, 'edgeEaves')) eaves.forEach((c) => columns.add(c));
  if (edgeOn(p, 'edgeSides')) eaveColumns(shape, b).map(key).filter((c) => !eaves.has(c)).forEach((c) => columns.add(c));
  if (edgeOn(p, 'edgeRidge')) {
    // Ridge columns: none beside them higher, and lower on both sides across the ridge (a ridge one or two columns
    // wide; the flat stretches of a gentle slope are lower on one side only).
    const local: [number, number, number][] = [];
    const t = (i: number, j: number) => (i < 0 || j < 0 || i >= b.nx || j >= b.nz ? -1 : b.top[i * b.nz + j]);
    const peak = (i: number, j: number, a: number, c: number) => {
      const h = t(i, j);
      const lower = (u: number, w: number) => t(u, w) < h;
      const side = (sgn: number) => lower(i + sgn * a, j + sgn * c) || (t(i + sgn * a, j + sgn * c) === h && lower(i + 2 * sgn * a, j + 2 * sgn * c));
      return (side(1) && lower(i - a, j - c)) || (side(-1) && lower(i + a, j + c));
    };
    for (let i = 0; i < b.nx; i++) for (let j = 0; j < b.nz; j++) {
      const h = t(i, j);
      if (h < 0 || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => t(i + a, j + c) > h)) continue;
      if (peak(i, j, 1, 0) || peak(i, j, 0, 1)) local.push([i, j, 0]);
    }
    placeColumns(shape, b, local).map(key).forEach((c) => columns.add(c));
  }
  return columns;
}

/** Roof edging: the ridge, eaves and (optionally) gable ends in their own material. */
export const hasEdging = (p: Record<string, number>) => Number(p.edging) === 1;
/** The edging material when none is set: Tarred Shingle. */
export const DEFAULT_EDGE_MATERIAL = 3502973158;
export const edgeMaterial = (p: Record<string, number>) => Number(p.edgeMaterial ?? DEFAULT_EDGE_MATERIAL);
const edgeOn = (p: Record<string, number>, key: 'edgeRidge' | 'edgeEaves' | 'edgeSides') => Number(p[key] ?? (key === 'edgeSides' ? 0 : 1)) === 1;

/**
 * Roof edging on a roof of pieces: which of the roof's own pieces are along its ridge (nothing of the roof higher
 * over them), its eaves (sloping down to the eave) and, if chosen, its gable ends; they are built in the edging
 * material, whole pieces (a piece is one material).
 */
function pieceEdging(shape: Shape, pieces: RoofPiece[]): { edged: boolean; eave: boolean; ridge: boolean }[] {
  const p = shape.params;
  const b = blockRoof(shape.kind as RoofKind, { ...p, recedeEnds: RECEDE_BOTH_ENDS });
  const key = ([x, , z]: [number, number, number]) => `${x},${z}`;
  const eaveRim = new Set(placeColumns(shape, b, b.eaves).map(key));
  const sideRim = new Set(placeColumns(shape, b, b.lip).map(key).filter((c) => !eaveRim.has(c)));
  const beyond = (q: RoofPiece, dir: Vec3, rim: Set<string>) => {
    const [x0, x1, z0, z1] = [Math.round(q.min[0] * 2), Math.round(q.max[0] * 2), Math.round(q.min[2] * 2), Math.round(q.max[2] * 2)];
    if (dir[0] !== 0) { const x = dir[0] > 0 ? x1 : x0 - 1; for (let z = z0; z < z1; z++) if (rim.has(`${x},${z}`)) return true; }
    else { const z = dir[2] > 0 ? z1 : z0 - 1; for (let x = x0; x < x1; x++) if (rim.has(`${x},${z}`)) return true; }
    return false;
  };
  const corner = (q: RoofPiece, rim: Set<string>) => {
    const [x0, x1, z0, z1] = [Math.round(q.min[0] * 2), Math.round(q.max[0] * 2), Math.round(q.min[2] * 2), Math.round(q.max[2] * 2)];
    return [[x0 - 1, z0 - 1], [x0 - 1, z1], [x1, z0 - 1], [x1, z1]].some(([x, z]) => rim.has(`${x},${z}`));
  };
  const overlaps = (a: RoofPiece, c: RoofPiece) => a.min[0] < c.max[0] - 1e-9 && c.min[0] < a.max[0] - 1e-9 && a.min[2] < c.max[2] - 1e-9 && c.min[2] < a.max[2] - 1e-9;
  const dirs: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  return pieces.map((o) => {
    const m = fromQuaternion(YAW_QUATERNION[o.yaw]);
    const local: Vec3[] = [[1, 0, 0]];
    if (o.type.form === 'outer') local.push([0, 0, -1]);
    if (o.type.form === 'inner') local.push([0, 0, 1]);
    const downhill = local.map((v) => { const w = apply(m, v); return [Math.round(w[0]), 0, Math.round(w[2])] as Vec3; });
    const isDown = (f: Vec3) => downhill.some((g) => g[0] === f[0] && g[2] === f[2]);
    const eave = dirs.some((f) => isDown(f) && beyond(o, f, eaveRim)) || (o.type.form === 'inner' && corner(o, eaveRim));
    const side = dirs.some((f) => !isDown(f) && beyond(o, f, sideRim));
    const ridge = !pieces.some((u) => u !== o && u.max[1] > o.max[1] + 1e-9 && overlaps(u, o));
    return { edged: (edgeOn(p, 'edgeEaves') && eave) || (edgeOn(p, 'edgeSides') && side) || (edgeOn(p, 'edgeRidge') && ridge), eave, ridge };
  });
}

function roofLayerBlocks(shape: Shape): { cells: [number, number, number][]; inner: [number, number, number][] } {
  if (!isRoof(shape.kind)) return { cells: [], inner: [] };
  const p = shape.params;
  if (!isBlockRoof(shape)) {
    // A pieces roof's inside blocks: where its inside layer's pieces would need cutting (see innerLayer), and the
    // same for a triple-thick roof's second layer (in the roof's own material).
    if (!isDoubleRoof(p)) return { cells: [], inner: [] };
    // The roof's pieces as laid out, before edging swaps any for blocks (as roofPieces works its layers out).
    const outer = roofPieces({ ...shape, params: { ...p, double: 0, edging: 0 } });
    return { cells: isTripleRoof(p) ? innerLayer(secondLayer(shape), outer).blocks : [], inner: innerLayer(shape, outer).blocks };
  }
  const roof = blockRoofCells(shape);
  if (!isDoubleRoof(p)) return { cells: roof, inner: [] };
  const receding = recedes(p);
  const columnsOf = (list: [number, number, number][]) => new Set(list.map(([x, , z]) => `${x},${z}`));
  // Triple thick: a second layer of the roof's own material right under it, level with the eaves (flush), leaving out
  // its chosen gable ends when receded. The inside layer's drop is from it.
  let cells = roof;
  if (isTripleRoof(p)) {
    const q = secondLayer(shape).params;
    const b2 = blockRoof(shape.kind as RoofKind, layerEdgeParams(q));
    cells = [...roof, ...notHanging(shape, b2, under(roof, columnsOf(layerEdges(shape, b2, receding, true))))];
  }
  // The inside layer: level with the eaves too (flush), and receded one block further in (eaves and chosen gable ends).
  const b = blockRoof(shape.kind as RoofKind, layerEdgeParams(p));
  const inner = under(cells, new Set());
  // Dropped further: the same layer that many blocks lower.
  const extra = Math.max(0, innerDropBlocks(p) - 1);
  const flush = notHanging(shape, b, extra ? inner.map(([i, j, k]) => [i, j - extra, k] as [number, number, number]) : inner);
  return { cells, inner: receding ? retract(shape, b, flush, columnsOf(layerEdges(shape, b, true, true))) : flush };
}

/**
 * Every block under a block roof's layer that touches it: under each column, and beside the columns of a steep slope,
 * whose sides face the space under the roof too (seen in game on 2026-11-04 at 67.5 degrees). Not in the columns of
 * `edge` (a receded layer's edge).
 */
function under(cells: [number, number, number][], edge: Set<string>): [number, number, number][] {
  const own = new Set(cells.map((c) => c.join(',')));
  const lowest = new Map<string, number>();
  for (const [i, j, k] of cells) { const c = `${i},${k}`; lowest.set(c, Math.min(lowest.get(c) ?? Infinity, j)); }
  const out: [number, number, number][] = [];
  const added = new Set<string>();
  const add = (i: number, j: number, k: number) => {
    const c = `${i},${k}`, low = lowest.get(c);
    // Only under the roof: in its plan, below the column's own lowest block, and not at a receded edge.
    if (low === undefined || j >= low || edge.has(c) || added.has(`${i},${j},${k}`)) return;
    added.add(`${i},${j},${k}`); out.push([i, j, k]);
  };
  for (const [i, j, k] of cells) {
    if (!own.has(`${i},${j - 1},${k}`)) add(i, j - 1, k);
    for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!own.has(`${i + a},${j},${k + c}`)) add(i + a, j, k + c);
  }
  return out;
}

// ---------- L, T and cross roofs: arms ----------

export type JoinedKind = 'roofL' | 'roofT' | 'roofCross';
export const isJoinedKind = (kind: Shape['kind']): kind is JoinedKind => kind === 'roofL' || kind === 'roofT' || kind === 'roofCross';

/** One arm of an L, T or cross roof: which way it runs from the junction, and the keys its settings had before 0.14. */
export interface ArmDef {
  key: string;
  label: string;
  along: Downhill;
  fallbackLength: number;
  legacyLength: string;
  legacyEnd: string;
  /** No sideways offset (a T's stem stays centered on the bar). */
  noShift?: boolean;
}

export const ROOF_ARMS: Record<JoinedKind, ArmDef[]> = {
  roofL: [
    { key: 'a', label: 'Arm 1 (along x)', along: '-x', fallbackLength: 3, legacyLength: 'armX', legacyEnd: 'endX' },
    { key: 'b', label: 'Arm 2 (along z)', along: '+z', fallbackLength: 3, legacyLength: 'armZ', legacyEnd: 'endZ' },
  ],
  roofT: [
    { key: 'l', label: 'Bar, -x arm', along: '-x', fallbackLength: 2, legacyLength: 'armX', legacyEnd: 'endXNeg' },
    { key: 'r', label: 'Bar, +x arm', along: '+x', fallbackLength: 2, legacyLength: 'armX', legacyEnd: 'endXPos' },
    { key: 's', label: 'Stem (along +z)', along: '+z', fallbackLength: 3, legacyLength: 'stem', legacyEnd: 'endStem', noShift: true },
  ],
  roofCross: [
    { key: 'nx', label: '-x arm', along: '-x', fallbackLength: 2, legacyLength: 'armX', legacyEnd: 'endXNeg' },
    { key: 'px', label: '+x arm', along: '+x', fallbackLength: 2, legacyLength: 'armX', legacyEnd: 'endXPos' },
    { key: 'nz', label: '-z arm', along: '-z', fallbackLength: 2, legacyLength: 'armZ', legacyEnd: 'endZNeg' },
    { key: 'pz', label: '+z arm', along: '+z', fallbackLength: 2, legacyLength: 'armZ', legacyEnd: 'endZPos' },
  ],
};

/**
 * Per-arm settings, each saved as the arm's key plus one of these (aLen, aRows, aWidth, aHeight, aShift, aEnd).
 * Shift is the sideways offset, always in meters; 0.14.0 to 0.14.5 saved it as Off, in the roof's length unit.
 */
export type ArmField = 'Len' | 'Rows' | 'Width' | 'Height' | 'Shift' | 'Off' | 'End' | 'Angle';

/** Keys a setting falls back to for roofs saved before each arm had its own settings (0.10 to 0.13). */
export function armLegacyKeys(arm: ArmDef, field: ArmField): string[] {
  if (field === 'Len') return [arm.legacyLength];
  if (field === 'Rows') return ['rows'];
  if (field === 'End') return [arm.legacyEnd, 'ends'];
  if (field === 'Height') return ['height'];
  // Before 0.15 one angle applied to every arm.
  if (field === 'Angle') return ['angle'];
  return [];
}

function armValue(p: Record<string, number>, arm: ArmDef, field: ArmField): number | undefined {
  for (const key of [arm.key + field, ...armLegacyKeys(arm, field)]) {
    const v = Number(p[key]);
    if (p[key] !== undefined && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** An arm's settings, in meters. */
interface ArmSpec {
  def: ArmDef;
  /** Length past the junction. */
  len: number;
  /** Rows up each slope (roof pieces). */
  rows: number;
  /** Width across, eaves included (blocks). */
  width: number;
  /** Height when the roof is set by height. */
  height?: number;
  /** Sideways offset of the arm's centerline. */
  off: number;
  hip: boolean;
  /** The arm's angle: a standard angle or SET_BY_HEIGHT. */
  angle: number;
}

const halfGrid = (v: number) => Math.round(v * 2) / 2;

/** The angles an arm can have: the standard ones and set by height (not a custom angle or pitch). */
export const ARM_ANGLES = [45, 22.5, 33.3, 67.5, SET_BY_HEIGHT] as const;

/** An arm's angle, one of ARM_ANGLES (45 when missing or unknown). */
export function armAngle(p: Record<string, number>, def: ArmDef): number {
  const a = armValue(p, def, 'Angle');
  return a !== undefined && (ARM_ANGLES as readonly number[]).includes(a) ? a : PIECE_ANGLE;
}

/** Whether every arm is at 45 degrees (so the roof can use the game's roof pieces). */
function armsAtPieceAngle(kind: JoinedKind, p: Record<string, number>): boolean {
  return ROOF_ARMS[kind].every((def) => armAngle(p, def) === PIECE_ANGLE);
}

/** An arm's length past the junction, in meters. */
function armLength(p: Record<string, number>, def: ArmDef): number {
  const S = p.pieceSize === 4 ? 4 : 2;
  const raw = armValue(p, def, 'Len');
  return Math.max(0.5, halfGrid(raw === undefined ? def.fallbackLength * S : p.units === LENGTH_IN_METERS ? raw : raw * S));
}

/** An arm's sideways offset in meters as saved (before limiting): Shift, or the older Off in the length unit. */
export function armShiftSaved(p: Record<string, number>, def: ArmDef): number {
  const shift = Number(p[`${def.key}Shift`]);
  if (p[`${def.key}Shift`] !== undefined && Number.isFinite(shift)) return halfGrid(shift);
  const old = Number(p[`${def.key}Off`]);
  if (p[`${def.key}Off`] === undefined || !Number.isFinite(old)) return 0;
  return halfGrid(p.units === LENGTH_IN_METERS ? old : old * (p.pieceSize === 4 ? 4 : 2));
}

/** Half an arm's width, eaves included, in meters (from its rows with roof pieces, or its width in blocks). */
function armHalfWidth(p: Record<string, number>, def: ArmDef): number {
  const S = p.pieceSize === 4 ? 4 : 2;
  const rows = Math.max(1, Math.round(armValue(p, def, 'Rows') ?? 1));
  const pieces = 2 * rows * S + 2 * EAVE;
  // At 45 degrees with roof pieces the rows set the width; otherwise the width (when set) does.
  const kind = (Object.keys(ROOF_ARMS) as JoinedKind[]).find((k) => ROOF_ARMS[k].includes(def))!;
  const width = armsAtPieceAngle(kind, p) ? pieces : Math.max(2, halfGrid(armValue(p, def, 'Width') ?? pieces));
  return width / 2;
}

/**
 * How far an arm can be offset sideways, in meters: along the arms it joins, until its outer edge (eave included)
 * is flush with their end. Each way is limited by the arm running that way; where none does (an L's outside
 * corner, the far side of a T's bar), not at all, so an arm never slides off the roof it joins.
 */
export function armShiftLimits(kind: JoinedKind, p: Record<string, number>, index: number): { min: number; max: number } {
  const defs = ROOF_ARMS[kind];
  const a = defs[index];
  if (a.noShift) return { min: 0, max: 0 };
  const sameAxis = defs.filter((b) => alongX(b.along) === alongX(a.along));
  // The junction reaches as far as the widest arm on this arm's own axis (its core, without eaves).
  const junction = Math.max(...sameAxis.map((b) => armHalfWidth(p, b) - EAVE));
  const own = armHalfWidth(p, a);
  const [neg, pos] = alongX(a.along) ? ['-z', '+z'] : ['-x', '+x'];
  const room = (d: string) => {
    const b = defs.find((q) => q.along === d);
    return b ? Math.max(0, halfGrid(junction + armLength(p, b) - own)) : 0;
  };
  const down = room(neg), up = room(pos);
  return { min: down ? -down : 0, max: up };
}

function resolveArms(kind: JoinedKind, p: Record<string, number>): ArmSpec[] {
  const S = p.pieceSize === 4 ? 4 : 2;
  return ROOF_ARMS[kind].map((def, i) => {
    const len = armLength(p, def);
    const rows = Math.max(1, Math.round(armValue(p, def, 'Rows') ?? 1));
    const width = Math.max(2, halfGrid(armValue(p, def, 'Width') ?? 2 * rows * S + 2 * EAVE));
    const h = armValue(p, def, 'Height');
    const { min, max } = armShiftLimits(kind, p, i);
    return {
      def, len, rows, width, height: h === undefined ? undefined : Math.max(1, halfGrid(h)),
      off: Math.min(max, Math.max(min, armShiftSaved(p, def))), hip: Math.round(armValue(p, def, 'End') ?? 0) === 1,
      angle: armAngle(p, def),
    };
  });
}

const alongX = (d: Downhill) => d === '-x' || d === '+x';

const OPPOSITE: Record<Downhill, Downhill> = { '-x': '+x', '+x': '-x', '-z': '+z', '+z': '-z' };

type Rect = { x0: number; x1: number; z0: number; z1: number };

/**
 * One arm's part of the roof: `area` is the ground it covers (with its tip trim, for pieces) and `geom` the wing
 * whose slopes it follows there.
 */
interface ArmPart {
  arm: number; area: Wing; geom: Rect & { open: Downhill[] }; along: Downhill; top: number;
  /** The side cut off at the junction's center line, for arms with an arm across from them. */
  cut?: Downhill;
}

/** Lays arms out as parts, in whatever unit `unit` gives (cells for pieces, blocks for block roofs). */
function armParts(arms: ArmSpec[], u: {
  span: (a: ArmSpec) => [number, number];
  core: (a: ArmSpec) => [number, number];
  length: (a: ArmSpec, n: number) => { cells: number; trim: number };
  eave: number;
  top: (a: ArmSpec, n: number) => number;
}): ArmPart[] {
  // The junction: as wide as the arms crossing it, where they would be without their offsets, so offsetting an
  // arm slides just that arm (lengths are measured past this junction).
  const across = (want: (a: ArmSpec) => boolean, offsets: boolean) => {
    const spans = arms.filter(want).map((a) => u.core(offsets ? a : { ...a, off: 0 }));
    return [Math.min(...spans.map((q) => q[0])), Math.max(...spans.map((q) => q[1]))];
  };
  const [jx0, jx1] = across((a) => !alongX(a.def.along), false);
  const [jz0, jz1] = across((a) => alongX(a.def.along), false);
  // Where the crossing arms actually are. An arm reaching over the junction ends at the far edge of the arms it
  // crosses, where they are now or where they'd be without their offsets, whichever is further: offsetting the
  // crossing arm slides it along this one, and this arm keeps its length (it only grows to reach an arm slid past
  // its end).
  const [ax0, ax1] = across((a) => !alongX(a.def.along), true);
  const [az0, az1] = across((a) => alongX(a.def.along), true);
  const lengths = arms.map((a, n) => u.length(a, n));
  // Along each arm: from its tip to the far side of the junction (plus the junction's eave).
  const ends: number[][] = arms.map((a, n) => {
    const r = lengths[n];
    const tip = a.hip ? u.eave : 0;
    switch (a.def.along) {
      case '-x': return [jx0 - r.cells - tip, Math.max(jx1, ax1) + u.eave];
      case '+x': return [Math.min(jx0, ax0) - u.eave, jx1 + r.cells + tip];
      case '-z': return [jz0 - r.cells - tip, Math.max(jz1, az1) + u.eave];
      default: return [Math.min(jz0, az0) - u.eave, jz1 + r.cells + tip];
    }
  });
  // The junction's center lines: arms with an arm straight across from them stop here.
  const jxMid = Math.floor((jx0 + jx1) / 2), jzMid = Math.floor((jz0 + jz1) / 2);
  // An arm whose end lands inside another arm (two arms slid so that they meet end to end) carries on to that arm's
  // far edge and ends in a hip there, so the outside corner between them is filled like an L's corner.
  const shoulder = arms.map(() => false);
  arms.forEach((a, n) => {
    const [s0, s1] = u.span(a);
    const toLow = a.def.along === '-x' || a.def.along === '-z';
    const tipEave = a.hip ? u.eave : 0;
    const tip = toLow ? ends[n][0] + tipEave : ends[n][1] - tipEave;
    arms.forEach((b, m) => {
      if (m === n || alongX(b.def.along) === alongX(a.def.along)) return;
      const [c0, c1] = u.core(b);
      const [b0, b1] = ends[m];
      // The tip is strictly between b's edges, and b runs across where this arm is.
      if (!(tip > c0 && tip < c1) || b1 <= s0 || b0 >= s1) return;
      if (toLow) ends[n][0] = Math.min(ends[n][0], c0 - u.eave); else ends[n][1] = Math.max(ends[n][1], c1 + u.eave);
      shoulder[n] = true;
    });
  });
  const parts: ArmPart[] = [];
  arms.forEach((a, n) => {
    const r = shoulder[n] ? { ...lengths[n], trim: 0 } : lengths[n];
    const [s0, s1] = u.span(a);
    let [lo, hi] = ends[n];
    const rect = (l: number, h: number, p0: number, p1: number): Rect =>
      (alongX(a.def.along) ? { x0: l, x1: h, z0: p0, z1: p1 } : { x0: p0, x1: p1, z0: l, z1: h });
    const open: Downhill[] = a.hip || shoulder[n] ? [] : [a.def.along];
    // Where the arms it crosses have slid inward along it, this arm carries on past them: its end there is a plain
    // gable instead of the hip that wraps an L's outside corner.
    const reachEnd = a.def.along === '-x' ? ax1 > jx1 || ax1 === jx1 : a.def.along === '+x' ? ax0 <= jx0 : a.def.along === '-z' ? az1 >= jz1 : az0 <= jz0;
    if (!reachEnd) open.push(OPPOSITE[a.def.along]);
    // An arm with another arm straight across from it (a cross's arms, a T's bar) covers only its own half: it
    // stops cleanly at the junction's center line, where the opposite arm takes over (when the two line up, their
    // ridges meet there and run straight through). An arm with nothing across from it (an L's arms, a T's stem)
    // reaches over the junction to its far side and ends in a hip there.
    const cut = arms.some((b) => b.def.along === OPPOSITE[a.def.along]) ? OPPOSITE[a.def.along] : undefined;
    if (cut) {
      switch (a.def.along) {
        case '-x': hi = jxMid; break;
        case '+x': lo = jxMid; break;
        case '-z': hi = jzMid; break;
        default: lo = jzMid;
      }
      open.push(OPPOSITE[a.def.along]);
    }
    const trim = { [a.def.along]: r.trim };
    // An arm reaching over a pair of arms that are across from each other (a T's stem over the bar) does so in two
    // halves, split at the junction's center line: each half reaches the far edge of the arm on its own side, so
    // moving one bar arm never changes the stem's other half.
    const pair = arms.filter((b) => alongX(b.def.along) !== alongX(a.def.along));
    if (!cut && pair.length === 2) {
      const mid = alongX(a.def.along) ? jzMid : jxMid;
      for (const b of pair) {
        const below = b.def.along === '-x' || b.def.along === '-z';
        const [p0, p1] = below ? [s0, Math.min(s1, mid)] : [Math.max(s0, mid), s1];
        if (p1 <= p0) continue;
        // The bar's far edge, across this arm's length: the furthest of the two bar arms where they are now, the same
        // for both halves, so the stem ends in one straight line (a bar arm slid toward the stem, or narrower than
        // the other, leaves the stem running on to the other arm's edge). Each half reaching its own arm's edge
        // without its offset let one half grow past both bar arms as that arm was widened.
        const c0 = Math.min(...pair.map((q) => u.core(q)[0])), c1 = Math.max(...pair.map((q) => u.core(q)[1]));
        // Both halves end in a hip at the bar's far edge, even past a bar arm slid inward along the stem: the stem is
        // one roof, and a gable on one half only would leave a face standing beside the other bar arm. Its last
        // pieces are corners that slope down to meet that arm.
        const halfOpen: Downhill[] = open.filter((d) => d !== OPPOSITE[a.def.along]);
        let l = lo, h = hi;
        switch (a.def.along) {
          case '-x': h = c1 + u.eave; break;
          case '+x': l = c0 - u.eave; break;
          case '-z': h = c1 + u.eave; break;
          default: l = c0 - u.eave;
        }
        parts.push({
          arm: n, area: { ...rect(l, h, p0, p1), open: halfOpen, trim, rows: a.rows }, geom: { ...rect(l, h, s0, s1), open: halfOpen },
          along: a.def.along, top: u.top(a, n), cut: alongX(a.def.along) ? (below ? '+z' : '-z') : (below ? '+x' : '-x'),
        });
      }
      return;
    }
    const area = { ...rect(lo, hi, s0, s1), open, trim, rows: a.rows };
    parts.push({ arm: n, area, geom: { ...rect(lo, hi, s0, s1), open }, along: a.def.along, top: u.top(a, n), cut });
  });
  return parts;
}

/** The arms in whole cells, for roof pieces. */
function joinedPieceParts(arms: ArmSpec[], S: number): ArmPart[] {
  return armParts(arms, {
    span: (a) => { const c = a.off / S; return [c - a.rows, c + a.rows]; },
    core: (a) => { const c = a.off / S; return [c - a.rows, c + a.rows]; },
    length: (a) => run(a.len, S, 1, a.hip ? a.rows : 1),
    eave: 0,
    top: (a) => a.rows,
  });
}

/** Wings of whole cells for roofWings (L, T and cross roofs). */
function joinedPieceWings(kind: JoinedKind, p: Record<string, number>, arms: ArmSpec[], S: number): Wing[] {
  return joinedPieceParts(arms, S).map((q) => q.area);
}

/** How high a wing stands at a point (in its own units): its distance to its eaves and hip ends, up to its ridge. */
function wingHeightAt(w: { x0: number; x1: number; z0: number; z1: number; open: Downhill[] }, along: Downhill, x: number, z: number, top: number): number {
  const d = [top];
  // The long sides are always eaves; the ends are hips unless open (a gable).
  if (alongX(along)) {
    d.push(z - w.z0, w.z1 - z);
    if (!w.open.includes('-x')) d.push(x - w.x0);
    if (!w.open.includes('+x')) d.push(w.x1 - x);
  } else {
    d.push(x - w.x0, w.x1 - x);
    if (!w.open.includes('-z')) d.push(z - w.z0);
    if (!w.open.includes('+z')) d.push(w.z1 - z);
  }
  return Math.min(...d);
}

const joinedPieceMemo = new Map<string, { boxes: LocalBox[]; size: Vec3; origin?: [number, number] } | null>();

/** An L, T or cross roof in roof pieces, or null when its arms can't be built from 45-degree pieces. */
function joinedPieceLayout(kind: JoinedKind, p: Record<string, number>): { boxes: LocalBox[]; size: Vec3; origin?: [number, number] } | null {
  const memoKey = JSON.stringify([kind, p]);
  if (joinedPieceMemo.has(memoKey)) return joinedPieceMemo.get(memoKey)!;
  const { size, run: S } = layoutParams(p);
  const arms = resolveArms(kind, p);
  let out: { boxes: LocalBox[]; size: Vec3; origin?: [number, number] } | null = null;
  // Offsets must land on whole pieces; otherwise the roof is built from blocks.
  if (arms.every((a) => a.angle === PIECE_ANGLE && Number.isInteger(a.off / S))) {
    const parts = joinedPieceParts(arms, S);
    const height = (px: number, pz: number, ci: number, cj: number) => {
      let best = -Infinity;
      for (const q of parts) {
        const w = q.area;
        if (px < w.x0 || px > w.x1 || pz < w.z0 || pz > w.z1) continue;
        // A cut arm shapes only the pieces on its own side of the junction's center line, so it never changes the
        // other half (the corners on the line are shared by pieces on both sides).
        if ((q.cut === '+x' && ci >= w.x1) || (q.cut === '-x' && ci < w.x0) || (q.cut === '+z' && cj >= w.z1) || (q.cut === '-z' && cj < w.z0)) continue;
        best = Math.max(best, wingHeightAt(q.geom, q.along, px, pz, q.top));
      }
      return Math.max(0, best);
    };
    try {
      out = wingLayout(parts.map((q) => q.area), Math.max(...arms.map((a) => a.rows)), size, { height });
      out = withoutPokes(out);
    } catch {
      out = null; // a junction the game's pieces can't make
    }
  }
  if (joinedPieceMemo.size > 64) joinedPieceMemo.clear();
  joinedPieceMemo.set(memoKey, out);
  return out;
}

/** Whether an L, T or cross roof is built from blocks: any angle but 45, off-grid offsets, or a junction pieces can't make. */
export function joinedUsesBlocks(kind: JoinedKind, p: Record<string, number>): boolean {
  return joinedPieceLayout(kind, p) === null;
}

/** Each arm's blocks: its parts in blocks, with the slope (rise over run) it rises at. */
function joinedBlockParts(kind: JoinedKind, p: Record<string, number>) {
  const arms = resolveArms(kind, p);
  // Across each arm: its width in blocks, centered on its offset (on the half-meter grid).
  const span = (a: ArmSpec): [number, number] => { const n = Math.round(a.width * 2); const lo = Math.round(a.off * 2) - Math.floor(n / 2); return [lo, lo + n]; };
  const runOf = (a: ArmSpec) => { const [lo, hi] = span(a); return Math.max(1, Math.floor((hi - lo - 1) / 2)); };
  const slopes = arms.map((a) => {
    const run = runOf(a);
    // Each arm its own angle: set by its height, or rise over its run at its angle.
    const ratio = slopeRatio(a.angle, p);
    const rise = ratio === null ? Math.max(1, Math.round((a.height ?? (run + 1) / 2) * 2) - 1) : Math.max(1, Math.round(run * ratio));
    return { rise, run };
  });
  const parts = armParts(arms, {
    span,
    core: (a) => { const [lo, hi] = span(a); return [lo + 1, hi - 1]; },
    length: (a) => ({ cells: Math.round(a.len * 2), trim: 0 }),
    eave: 1,
    top: (_a, n) => slopes[n].run,
  });
  return { arms, slopes, parts };
}

/** An L, T or cross roof in blocks: each arm its own slope, the roof the highest arm at each column. */
function joinedBlockRoof(kind: JoinedKind, p: Record<string, number>): BlockRoof {
  const { slopes, parts } = joinedBlockParts(kind, p);
  const areas = parts.map((q) => q.area);
  const x0 = Math.min(...areas.map((w) => w.x0)), x1 = Math.max(...areas.map((w) => w.x1));
  const z0 = Math.min(...areas.map((w) => w.z0)), z1 = Math.max(...areas.map((w) => w.z1));
  const nx = x1 - x0, nz = z1 - z0;
  const top = new Int16Array(nx * nz).fill(-1);
  // Which arms make each column's top (a bit per arm): a column is only filled down toward neighbors that one of
  // those arms also covers, so where an arm stops (at the junction's center line, beside a lower arm) its end is
  // an open gable, not a wall down to the lower roof.
  const owners = new Int32Array(nx * nz);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = x0 + i, z = z0 + j;
    let best = -1, by = 0;
    parts.forEach((q) => {
      const w = q.area;
      if (x < w.x0 || x >= w.x1 || z < w.z0 || z >= w.z1) return;
      // Columns from each edge of the arm's wing: 0 for the edge column itself.
      const g = q.geom;
      const { rise, run } = slopes[q.arm];
      const d = wingHeightAt({ x0: g.x0, x1: g.x1 - 1, z0: g.z0, z1: g.z1 - 1, open: g.open }, q.along, x, z, run);
      const h = heightAt(d, rise, run);
      if (h > best) { best = h; by = 1 << q.arm; } else if (h === best) by |= 1 << q.arm;
    });
    top[i * nz + j] = best;
    owners[i * nz + j] = by;
  }
  const covers = (mask: number, x: number, z: number) => parts.some((q) => (mask & (1 << q.arm)) !== 0 && x >= q.area.x0 && x < q.area.x1 && z >= q.area.z0 && z < q.area.z1);
  const bottom = new Int16Array(nx * nz).fill(-1);
  const cuts: [number, number, number, number][] = [];
  let height = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const t = top[i * nz + j];
    if (t < 0) continue;
    let b = t;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, c = j + dj;
      if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
      const tn = top[a * nz + c];
      if (tn < 0) continue;
      if (covers(owners[i * nz + j], x0 + a, z0 + c)) b = Math.min(b, tn);
      else if (tn < t) cuts.push([i, j, a, c]);
    }
    bottom[i * nz + j] = b;
    height = Math.max(height, t + 1);
  }
  // The rim takes in each arm's gable end (its open sides along the arm); cuts at the junction are inside the roof.
  const partRects = parts.map(({ area: w, along }) => ({ x0: w.x0 - x0, x1: w.x1 - x0, z0: w.z0 - z0, z1: w.z1 - z0, open: w.open, along }));
  const armEnds = Number(p.recedeEnds ?? RECEDE_BOTH_ENDS) !== RECEDE_NO_ENDS;
  const lip = eaveLip(nx, nz, top, partRects.map((w) => ({ ...w, open: w.open.filter((d) => !(armEnds && alongX(d) === alongX(w.along))) })));
  return { nx, nz, top, bottom, height, rise: slopes[0].rise, run: slopes[0].run, arms: slopes, lip, eaves: eaveLip(nx, nz, top, partRects), cuts, origin: [x0, z0] };
}

/** Each arm's width and height as the roof is built now, in meters (for showing in the editor). */
export function armSizes(shape: Shape): { width: number; height: number }[] {
  if (!isJoinedKind(shape.kind)) return [];
  const p = shape.params;
  const S = p.pieceSize === 4 ? 4 : 2;
  const arms = resolveArms(shape.kind, p);
  if (!joinedUsesBlocks(shape.kind, p)) return arms.map((a) => ({ width: 2 * a.rows * S + 2 * EAVE, height: a.rows * S + EAVE }));
  const { arms: specs, slopes } = joinedBlockParts(shape.kind, p);
  return specs.map((a, n) => ({ width: Math.round(a.width * 2) / 2, height: (slopes[n].rise + 1) / 2 }));
}

/**
 * Why an L, T or cross roof is built from blocks: its angle (or set height), an offset that isn't a whole number
 * of pieces, or a junction the game's roof pieces can't make. Null when it uses roof pieces.
 */
export function joinedBlockReason(shape: Shape): 'angle' | 'offset' | 'junction' | null {
  if (!isJoinedKind(shape.kind) || !joinedUsesBlocks(shape.kind, shape.params)) return null;
  if (!armsAtPieceAngle(shape.kind, shape.params)) return 'angle';
  const S = shape.params.pieceSize === 4 ? 4 : 2;
  return resolveArms(shape.kind, shape.params).every((a) => Number.isInteger(a.off / S)) ? 'junction' : 'offset';
}

/** A placed piece's top at a world ground point, or null off its ground (as pieceSurface, for RoofPiece). */
export function pieceTopAt(q: RoofPiece, x: number, z: number): number | null {
  if (q.type.form === 'cube') return null;
  const r = YAW_QUATERNION[q.yaw];
  const inv = fromQuaternion([-r[0], -r[1], -r[2], r[3]]);
  const [lx, , lz] = apply(inv, [x - q.pos[0], 0, z - q.pos[2]]);
  const [sx, h, sz] = q.type.size;
  if (lx < -1e-6 || lz < -1e-6 || lx > sx + 1e-6 || lz > sz + 1e-6) return null;
  const top = q.type.form === 'side' ? h - lx : q.type.form === 'outer' ? h - Math.max(lx, sx - lz) : h - Math.min(lx, lz);
  return top + q.pos[1];
}

/**
 * A piece's top surface at a ground point (in the roof's frame), and whether the point is on the piece's own ground
 * or on the 0.5 m eave it hangs over its downhill neighbors. Null outside the piece's box.
 */
function pieceSurface(b: LocalBox, x: number, z: number): { top: number; eave: boolean } | null {
  const box = rotatedBox(b.type, b.yaw);
  const q = YAW_QUATERNION[b.yaw];
  const inv = fromQuaternion([-q[0], -q[1], -q[2], q[3]]);
  // Into the piece's own frame: from its pivot, turned back.
  const [lx, , lz] = apply(inv, [x - (b.min[0] - box.lo[0]), 0, z - (b.min[2] - box.lo[2])]);
  const [sx, h, sz] = b.type.size;
  if (lx < 1e-6 || lz < 1e-6 || lx > sx - 1e-6 || lz > sz - 1e-6) return null;
  const run = b.type.run;
  const top = b.type.form === 'side' ? h - lx : b.type.form === 'outer' ? h - Math.max(lx, sx - lz) : h - Math.min(lx, lz);
  // Downhill: every piece toward +x; an Outer Corner also toward -z, an Inner Corner also toward +z.
  const eave = lx > run || (b.type.form === 'outer' && lz < sz - run) || (b.type.form === 'inner' && lz > run);
  return { top: top + b.min[1], eave };
}

/**
 * Leaves out extra pieces: a piece whose overhanging eave rises above the piece that owns the ground beneath it,
 * and whose own ground is all covered by other pieces anyway. A poking piece that can't be left out stays if its
 * eave stands no more than 0.5 m proud (a valley's lip over a short hip end, which plain L and T roofs have);
 * a bigger one means a junction the game's pieces can't make, so this throws and the roof is built from blocks.
 */
function withoutPokes(layout: { boxes: LocalBox[]; size: Vec3 }): { boxes: LocalBox[]; size: Vec3 } {
  const boxes = layout.boxes;
  // Index pieces by 1 m squares of ground, for finding the ones over a point quickly.
  const near = new Map<string, number[]>();
  const extent = boxes.map((b) => { const r = rotatedBox(b.type, b.yaw); return [b.min[0], b.min[0] + r.hi[0] - r.lo[0], b.min[2], b.min[2] + r.hi[2] - r.lo[2]]; });
  extent.forEach(([x0, x1, z0, z1], n) => {
    for (let i = Math.floor(x0); i < Math.ceil(x1); i++) for (let j = Math.floor(z0); j < Math.ceil(z1); j++) {
      const k = `${i},${j}`;
      const list = near.get(k);
      if (list) list.push(n); else near.set(k, [n]);
    }
  });
  const over = (x: number, z: number, skip = -1) => (near.get(`${Math.floor(x)},${Math.floor(z)}`) ?? [])
    .filter((n) => n !== skip).map((n) => ({ n, s: pieceSurface(boxes[n], x, z) })).filter((v) => v.s !== null) as { n: number; s: { top: number; eave: boolean } }[];
  const step = 0.25, allowed = 0.5 + 1e-9;
  const removed = new Set<number>();
  boxes.forEach((b, n) => {
    const [x0, x1, z0, z1] = extent[n];
    // How far this piece's eave stands above the roof anywhere: sampled along the eave strips only, in the piece's
    // own frame (downhill toward +x for every piece, and also -z for an Outer Corner, +z for an Inner Corner).
    const box = rotatedBox(b.type, b.yaw);
    const q = fromQuaternion(YAW_QUATERNION[b.yaw]);
    const pivot = [b.min[0] - box.lo[0], b.min[2] - box.lo[2]];
    const [sx, , sz] = b.type.size;
    const run = b.type.run;
    const samples: [number, number][] = [];
    for (let lx = step / 2; lx < sx; lx += step) for (let lz = step / 2; lz < sz; lz += step) {
      const eave = lx > run || (b.type.form === 'outer' && lz < sz - run) || (b.type.form === 'inner' && lz > run);
      if (eave) samples.push([lx, lz]);
    }
    let proud = 0;
    for (const [lx, lz] of samples) {
      const w = apply(q, [lx, 0, lz]);
      const x = w[0] + pivot[0], z = w[2] + pivot[1];
      const mine = pieceSurface(b, x, z);
      if (!mine?.eave) continue;
      const owners = over(x, z, n).filter((v) => !v.s.eave);
      if (owners.length) proud = Math.max(proud, mine.top - Math.max(...owners.map((v) => v.s.top)));
    }
    if (proud <= 0.01) return;
    // Extra only if every bit of its own ground is someone else's ground too.
    for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
      const mine = pieceSurface(b, x, z);
      if (mine && !mine.eave && !over(x, z, n).some((v) => !v.s.eave && !removed.has(v.n))) {
        if (proud > allowed) throw new Error('A roof piece would poke out here.');
        return;
      }
    }
    removed.add(n);
  });
  return removed.size ? { boxes: boxes.filter((_, n) => !removed.has(n)), size: layout.size } : layout;
}

