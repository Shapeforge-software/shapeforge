import { PIECES, type PieceType } from './pieces';
import { type Voxel } from './types';
import { key } from './voxelize-keys';

/**
 * Merging replaces groups of small cubes with larger Enshrouded pieces, without changing a single block.
 *
 * Only orientations confirmed in game are used: unrotated, and turned 90 degrees around the vertical axis.
 * (The game drops large pieces whose length is turned to point upward.) Floors use Ceiling pieces and upright
 * runs use Columns, so nothing else is needed. Door Frames (own notched profile) and roof pieces (not verified to
 * match their twins) are never used.
 */

export type PieceRotation = 'none' | 'y90';

/** Quaternions as Embervale writes them. */
export const ROTATION_TEXT: Record<PieceRotation, string> = {
  none: '0,0,0,1',
  y90: '0,0.707106769,0,0.707106769',
};

export interface PlacedPiece {
  type: PieceType;
  rotation: PieceRotation;
  /** Lowest cell the piece covers. */
  min: [number, number, number];
  /** Cells covered along x, y, z after rotation. */
  footprint: [number, number, number];
  materialItem: number;
}

const MERGE_SET = [
  '4m Foundation', 'Wide Wall', '4m Ceiling', 'Foundation', 'Narrow Wall', '4m Column',
  'Wall', '2m Ceiling', '1m Wall Block', '2m Column', 'Single Wall Block',
];

interface Candidate {
  type: PieceType;
  rotation: PieceRotation;
  footprint: [number, number, number];
}

/** Every allowed piece in every allowed orientation, biggest first. */
const CANDIDATES: Candidate[] = (() => {
  const out: Candidate[] = [];
  for (const name of MERGE_SET) {
    const type = PIECES.find((p) => p.name === name);
    if (!type) throw new Error(`Unknown piece ${name}`);
    const [sx, sy, sz] = type.size;
    out.push({ type, rotation: 'none', footprint: [sx, sy, sz] });
    // A quarter turn around y swaps the x and z extents; skip it when that changes nothing.
    if (sx !== sz) out.push({ type, rotation: 'y90', footprint: [sz, sy, sx] });
  }
  const volume = (c: Candidate) => c.footprint[0] * c.footprint[1] * c.footprint[2];
  return out.sort((a, b) => volume(b) - volume(a));
})();

/** The cube piece, used for any block nothing larger fits. */
const CUBE = CANDIDATES[CANDIDATES.length - 1];

/**
 * Packs voxels into pieces, largest first. A piece is placed only where every cell it covers is still unclaimed
 * and the same material, so the pieces cover exactly the input blocks.
 */
export function mergeVoxels(voxels: Voxel[]): PlacedPiece[] {
  const remaining = new Map<number, number>();
  for (const v of voxels) remaining.set(key(v.i, v.j, v.k), v.materialItem);
  // Scan in a fixed order (bottom up, then z, then x) so results are stable and pieces stack neatly.
  const order = [...voxels].sort((a, b) => a.j - b.j || a.k - b.k || a.i - b.i);
  const placed: PlacedPiece[] = [];

  for (const cand of CANDIDATES) {
    if (cand === CUBE) break;
    const [fx, fy, fz] = cand.footprint;
    for (const v of order) {
      const material = remaining.get(key(v.i, v.j, v.k));
      if (material === undefined) continue;
      // Cheap rejection: the far corner first.
      if (remaining.get(key(v.i + fx - 1, v.j + fy - 1, v.k + fz - 1)) !== material) continue;
      let fits = true;
      for (let a = 0; a < fx && fits; a++)
        for (let b = 0; b < fy && fits; b++)
          for (let c = 0; c < fz; c++) {
            if (remaining.get(key(v.i + a, v.j + b, v.k + c)) !== material) { fits = false; break; }
          }
      if (!fits) continue;
      for (let a = 0; a < fx; a++)
        for (let b = 0; b < fy; b++)
          for (let c = 0; c < fz; c++) remaining.delete(key(v.i + a, v.j + b, v.k + c));
      placed.push({ type: cand.type, rotation: cand.rotation, min: [v.i, v.j, v.k], footprint: cand.footprint, materialItem: material });
    }
  }
  for (const v of order) {
    const material = remaining.get(key(v.i, v.j, v.k));
    if (material === undefined) continue;
    remaining.delete(key(v.i, v.j, v.k));
    placed.push({ type: CUBE.type, rotation: 'none', min: [v.i, v.j, v.k], footprint: [1, 1, 1], materialItem: material });
  }
  return placed;
}

/** Number of pieces an export would contain. */
export function pieceCount(voxels: Voxel[], merge: boolean): number {
  return merge ? mergeVoxels(voxels).length : voxels.length;
}
