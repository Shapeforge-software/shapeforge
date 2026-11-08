import { apply, fromQuaternion } from './math';
import { YAW_QUATERNION, rotatedBox, type RoofPiece, type Yaw } from './roofs';
import type { Vec3, Voxel } from './types';

/**
 * The game's world is the mirror image of ShapeForge's (seen with numbers and text, 2026-11-07: a "7" written on a
 * die came out back to front in Embervale Toolkit and in game). ShapeForge works in a right-handed world, x right, y
 * up, z toward you; the game's z runs the other way. So everything written to a blueprint is flipped along z, and
 * everything read from one flipped back: what you see in ShapeForge is what you get in game, text and turns included.
 *
 * Blocks flip cell by cell. A roof piece flips into the same piece turned another way: a Roof Side is the same either
 * side of its middle along the ridge, and both corners are the same either side of their diagonal, so each flipped
 * piece is the piece at the quarter turn that points its slope (or high corner) the flipped way, moved onto the
 * flipped box.
 */

/** A block's cell flipped along z. */
export const flipCell = ([i, j, k]: [number, number, number]): [number, number, number] => [i, j, -1 - k];

export function flipVoxels(voxels: Voxel[]): Voxel[] {
  return voxels.map((v) => ({ ...v, k: -1 - v.k }));
}

/** Which way each piece points, unturned, in x and z: a side's downslope (high at -x), a corner's high corner. */
const POINTS: Record<RoofPiece['type']['form'], Vec3> = {
  // A cube is the same any way round: it keeps its turn (x doesn't flip).
  cube: [1, 0, 0],
  side: [-1, 0, 0],
  outer: [-1, 0, 1],
  inner: [-1, 0, -1],
};

const YAWS: Yaw[] = [0, 90, 180, 270];

/** A roof piece flipped along z: the same piece, turned to point the flipped way, on the flipped box. */
export function flipRoofPiece(p: RoofPiece): RoofPiece {
  const d = apply(fromQuaternion(YAW_QUATERNION[p.yaw]), POINTS[p.type.form]);
  const want: Vec3 = [d[0], d[1], -d[2]];
  const yaw = YAWS.find((y) => {
    const e = apply(fromQuaternion(YAW_QUATERNION[y]), POINTS[p.type.form]);
    return Math.abs(e[0] - want[0]) < 1e-3 && Math.abs(e[2] - want[2]) < 1e-3;
  });
  if (yaw === undefined) throw new Error(`No turn flips a ${p.type.name}.`);
  const min: Vec3 = [p.min[0], p.min[1], -p.max[2]];
  const max: Vec3 = [p.max[0], p.max[1], -p.min[2]];
  const { lo } = rotatedBox(p.type, yaw);
  const pos: Vec3 = [min[0] - lo[0], min[1] - lo[1], min[2] - lo[2]];
  return { ...p, yaw, pos, min, max };
}

/** An imported layer's cells (x, y, z, material, from 0) flipped along z in its own box. */
export function flipLayerCells(cells: number[], depth: number): number[] {
  const out = [...cells];
  for (let n = 0; n < out.length; n += 4) out[n + 2] = depth - 1 - out[n + 2];
  return out;
}
