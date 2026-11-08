import { eulerXYZ, type Mat3 } from './math';
import { RECEDE_NEGATIVE_END, RECEDE_POSITIVE_END, YAW_QUATERNION, isRoof, roofBounds, roofYaw } from './roofs';
import { layerCells } from './layer';
import { cleanParams } from './shapes';
import { VOXEL_SIZE, type Shape, type ShapeKind, type Vec3 } from './types';
import { worldBounds } from './voxelize';
import { unkey } from './voxelize-keys';

/**
 * Turning the whole build a quarter turn about the vertical axis, around its middle: every shape's position, and
 * each shape's own turn. `dir` 1 turns the way a roof's facing of 90 does (+x toward -z: counterclockwise seen from
 * above), -1 the other way. The middle is on the 0.5 m grid, so shapes, blocks and roof pieces stay on the grid.
 */
export function turnScene(shapes: Shape[], dir: 1 | -1): Shape[] {
  if (shapes.length === 0) return shapes;
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) {
    const b = worldBounds(s);
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], b.min[a]); hi[a] = Math.max(hi[a], b.max[a]); }
  }
  const pivot = lo.map((v, a) => Math.round(((v + hi[a]) / 2) * 2) / 2) as Vec3;
  return shapes.map((s) => turnShape(s, dir, pivot));
}

/** A quarter turn about the vertical axis: (x, z) to (z, -x) for dir 1, (-z, x) for dir -1. */
const turnXZ = (v: Vec3, dir: 1 | -1): Vec3 => (dir === 1 ? [v[2], v[1], -v[0]] : [-v[2], v[1], v[0]]);

/** One shape turned a quarter turn around `pivot`. */
export function turnShape(s: Shape, dir: 1 | -1, pivot: Vec3): Shape {
  const rel: Vec3 = [s.position[0] - pivot[0], s.position[1] - pivot[1], s.position[2] - pivot[2]];
  const r = turnXZ(rel, dir);
  const position: Vec3 = [tidy(pivot[0] + r[0]), s.position[1], tidy(pivot[2] + r[2])];
  if (isRoof(s.kind)) {
    // A roof's box is snapped to the grid from its middle, so place the turned roof by its box: the old box turned.
    const params = turnRoofParams(s.kind as ShapeKind, s.params, dir);
    const b = roofBounds(s);
    const c1 = turnPoint(b.min, dir, pivot), c2 = turnPoint(b.max, dir, pivot);
    const center: Vec3 = [tidy((c1[0] + c2[0]) / 2), s.position[1], tidy((c1[2] + c2[2]) / 2)];
    return { ...s, position: center, params };
  }
  // Other shapes and imported layers: the turn put in front of the shape's own rotation.
  const yaw: Mat3 = dir === 1 ? [0, 0, 1, 0, 1, 0, -1, 0, 0] : [0, 0, -1, 0, 1, 0, 1, 0, 0];
  const m = eulerXYZ(s.rotation);
  const turned = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => yaw[row * 3] * m[col] + yaw[row * 3 + 1] * m[3 + col] + yaw[row * 3 + 2] * m[6 + col])) as Mat3;
  const out: Shape = { ...s, position, rotation: toEulerXYZ(turned) };
  if (s.kind !== 'imported' || !s.layer) return out;
  // An imported layer snaps its blocks to the grid from its middle (half a block either way for odd sizes), so line
  // its blocks up with the old ones turned: move it by however far its lowest block is off.
  const lowest = (cells: number[][]) => [0, 1, 2].map((a) => Math.min(...cells.map((c) => c[a])));
  const target = lowest([...layerCells(s).keys()].map((n) => {
    const [i, j, k] = unkey(n);
    const p = turnPoint([(i + 0.5) * VOXEL_SIZE, 0, (k + 0.5) * VOXEL_SIZE], dir, pivot);
    return [Math.floor(p[0] / VOXEL_SIZE), j, Math.floor(p[2] / VOXEL_SIZE)];
  }));
  const now = lowest([...layerCells(out).keys()].map(unkey));
  return { ...out, position: [tidy(position[0] + (target[0] - now[0]) * VOXEL_SIZE), position[1], tidy(position[2] + (target[2] - now[2]) * VOXEL_SIZE)] };
}

/** Rounds away floating-point noise (to a millionth). */
const tidy = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

/** Euler angles in degrees (order XYZ, as eulerXYZ) for a rotation matrix. */
export function toEulerXYZ(m: Mat3): Vec3 {
  const deg = (r: number) => tidy((r * 180) / Math.PI);
  const sy = Math.max(-1, Math.min(1, m[2]));
  const y = Math.asin(sy);
  if (Math.abs(sy) < 0.999999) return [deg(Math.atan2(-m[5], m[8])), deg(y), deg(Math.atan2(-m[1], m[0]))];
  // Gimbal lock: put it all in x.
  return [deg(Math.atan2(m[7], m[4])), deg(y), 0];
}

/** The cross roof's arms in turn order for dir 1 (+x to -z): px becomes nz, nz becomes nx, nx pz, pz px. */
const CROSS_TURN: Record<string, string> = { px: 'nz', nz: 'nx', nx: 'pz', pz: 'px' };
const ARM_FIELDS = ['Len', 'Rows', 'Width', 'Height', 'Shift', 'End', 'Angle'];

/** A roof's settings turned a quarter turn: its facing, and what is told by world direction. */
function turnRoofParams(kind: ShapeKind, params: Record<string, number>, dir: 1 | -1): Record<string, number> {
  const p: Record<string, number> = { ...params };
  if (kind === 'roofCross') {
    // No facing: the arms trade places. An arm's sideways offset is along +z for arms along x and +x for arms along
    // z; turning (x, z) to (z, -x) keeps it for arms that end up along z and flips it for those that end up along x.
    const c = cleanParams(kind, params);
    const out: Record<string, number> = { ...p };
    for (const [from, to] of Object.entries(CROSS_TURN)) {
      const [a, b] = dir === 1 ? [from, to] : [to, from];
      for (const f of ARM_FIELDS) {
        delete out[`${b}${f}`];
        if (c[`${a}${f}`] === undefined) continue;
        const flip = f === 'Shift' && (dir === 1 ? (b === 'px' || b === 'nx') : (b === 'pz' || b === 'nz'));
        out[`${b}${f}`] = flip ? tidy(-c[`${a}${f}`]) : c[`${a}${f}`];
      }
      delete out[`${b}Off`];
    }
    return out;
  }
  // World-told gable ends (gables and sheds): where the chosen end lies now, worked out before the facing changes.
  const endsBefore = (key: string) => worldEnd(p, key);
  const ends = { recedeEnds: endsBefore('recedeEnds'), recedeEnds2: endsBefore('recedeEnds2') };
  const facing = roofYaw(p) + 90 * dir;
  const turns = ((facing % 360) + 360) % 360;
  if (kind === 'roofGable' || kind === 'roofHip') {
    // Only 0 and 90 are offered (the roof is the same either way round), so a half turn more mirrors what is told by
    // side: the long side of a saltbox and an off-center ridge.
    p.facing = turns % 180;
    if (turns >= 180) {
      if (p.longSide !== undefined) p.longSide = 1 - Math.round(p.longSide);
      if (p.ridgeOffset !== undefined) p.ridgeOffset = tidy(-p.ridgeOffset);
    }
  } else p.facing = turns;
  for (const key of ['recedeEnds', 'recedeEnds2'] as const) {
    const end = ends[key];
    if (end === null) continue;
    const turned = turnXZ(end, dir);
    p[key] = turned[0] + turned[2] < 0 ? RECEDE_NEGATIVE_END : RECEDE_POSITIVE_END;
  }
  return p;
}

/** For a gable or shed set to recede at one gable end only: that end's direction in the world; null otherwise. */
function worldEnd(p: Record<string, number>, key: string): Vec3 | null {
  const choice = Number(p[key]);
  if (choice !== RECEDE_NEGATIVE_END && choice !== RECEDE_POSITIVE_END) return null;
  // The ridge runs along the roof's own x; turned by its facing, that is the world axis the ends lie on.
  const m = YAW_QUATERNION[roofYaw(p)];
  const [x, y, z, w] = m;
  const ax: Vec3 = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)];
  const along: Vec3 = [Math.round(ax[0]), 0, Math.round(ax[2])];
  const positive = along[0] + along[2] > 0 ? along : ([-along[0], 0, -along[2]] as Vec3);
  return choice === RECEDE_POSITIVE_END ? positive : ([-positive[0], 0, -positive[2]] as Vec3);
}

/** A point turned a quarter turn around `pivot`, as turnScene turns shapes. */
export const turnPoint = (v: Vec3, dir: 1 | -1, pivot: Vec3): Vec3 => {
  const r = turnXZ([v[0] - pivot[0], v[1] - pivot[1], v[2] - pivot[2]], dir);
  return [pivot[0] + r[0], v[1], pivot[2] + r[2]];
};
