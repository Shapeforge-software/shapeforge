import { eulerXYZ, type Mat3 } from './math';
import { isRoof } from './roofs';
import { toEulerXYZ, turnShape } from './rotate';
import type { Shape, Vec3 } from './types';
import { worldBounds } from './voxelize';

/** Several shapes edited together: moved, or turned round their middle. */

/** The box round all of them, and its middle. */
export function groupBounds(shapes: Shape[]): { min: Vec3; max: Vec3; center: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) {
    const b = worldBounds(s);
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], b.min[a]); max[a] = Math.max(max[a], b.max[a]); }
  }
  if (!shapes.length) return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0] };
  return { min, max, center: min.map((v, a) => (v + max[a]) / 2) as Vec3 };
}

const tidy = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

/** Every shape moved by the same amount, so they keep their places to each other. */
export function moveGroup(shapes: Shape[], by: Vec3): Shape[] {
  return shapes.map((s) => ({ ...s, position: s.position.map((v, a) => tidy(v + by[a])) as Vec3 }));
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out as unknown as Mat3;
}

/**
 * Every shape turned by `turn` (degrees, X then Y then Z, as a shape's own rotation) round `pivot`, as if they were
 * one piece: each one's middle swings round the pivot and its own rotation turns with it. Imported layers keep to
 * quarter turns, so a turn that isn't one leaves their rotation at the nearest quarter turn.
 */
export function turnGroup(shapes: Shape[], turn: Vec3, pivot: Vec3): Shape[] {
  const d = eulerXYZ(turn);
  return shapes.map((s) => {
    const rel = s.position.map((v, a) => v - pivot[a]);
    const moved = [0, 1, 2].map((r) => tidy(pivot[r] + d[r * 3] * rel[0] + d[r * 3 + 1] * rel[1] + d[r * 3 + 2] * rel[2])) as Vec3;
    let rotation = toEulerXYZ(mul(d, eulerXYZ(s.rotation)));
    if (s.kind === 'imported') rotation = rotation.map((v) => tidy(Math.round(v / 90) * 90)) as Vec3;
    return { ...s, position: moved, rotation };
  });
}

/**
 * How the Rotation tool may turn a set of shapes. Roofs only face the four directions, so with a roof among them
 * only quarter turns about the vertical axis; imported layers keep to quarter turns (about any axis); anything else
 * turns in 5° steps about any axis.
 */
export function turnRules(shapes: Shape[]): { axes: [boolean, boolean, boolean]; step: number; why?: string } {
  if (shapes.some((s) => isRoof(s.kind))) return { axes: [false, true, false], step: 90, why: 'Roofs only face the four directions: quarter turns about the vertical axis.' };
  if (shapes.some((s) => s.kind === 'imported')) return { axes: [true, true, true], step: 90, why: 'Imported layers keep to quarter turns.' };
  return { axes: [true, true, true], step: 5 };
}

/** The middle a set of shapes turns round: their box's middle, on the 0.5 m grid (so quarter turns keep blocks on it). */
export const turnPivot = (shapes: Shape[]): Vec3 => groupBounds(shapes).center.map((v) => Math.round(v * 2) / 2) as Vec3;

/**
 * The Rotation tool's turn: `degrees` about axis 0 (x), 1 (y, vertical) or 2 (z), snapped to the shapes' step, from
 * the shapes as they were when the drag began. An axis they can't turn about leaves them as they were. Returns the
 * turn actually made.
 */
export function toolTurn(base: Shape[], axis: 0 | 1 | 2, degrees: number, pivot: Vec3): { shapes: Shape[]; degrees: number } {
  const rules = turnRules(base);
  if (!rules.axes[axis]) return { shapes: base, degrees: 0 };
  const turn = Math.round(degrees / rules.step) * rules.step;
  if (turn === 0) return { shapes: base, degrees: 0 };
  if (rules.step === 90 && axis === 1) {
    // Quarter turns about the vertical: the same turn as Turn all 90° (roofs change their facing).
    const n = Math.round(turn / 90);
    let out = base;
    for (let k = 0; k < Math.abs(n); k++) out = out.map((s) => turnShape(s, n > 0 ? 1 : -1, pivot));
    return { shapes: out, degrees: turn };
  }
  const t: Vec3 = [0, 0, 0];
  t[axis] = turn;
  return { shapes: turnGroup(base, t, pivot), degrees: turn };
}
