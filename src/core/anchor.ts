import type { Vec3, Voxel } from './types';

/**
 * Where a blueprint lands in game. Embervale Toolkit places a blueprint with its FIRST piece on the block you put
 * down to trigger it (that piece takes the block's place), whatever anchorMode or anchor the file says (tested in
 * game 2026-11-07). So the anchor is chosen by writing that block first:
 *
 * - a block of the build (picked, or by default the lowest block nearest the middle of the footprint), or
 * - a marker block in empty space (a courtyard, in front of a door, under a raised build), in a bright material, to
 *   be deleted in game after placing; it replaces the block you placed, so nothing extra is left behind once it's
 *   gone, and deleting it leaves the rest of the build as it is.
 *
 * The file's `lift` field (meters, up positive) is honoured: the build lands that much higher than your block.
 */

/** The marker block's material: Yellow Luminescent, easy to spot and delete. */
export const MARKER_MATERIAL = 3288587434;

/** Lift kept within this many meters either way. */
export const MAX_LIFT = 100;

export interface ResolvedAnchor {
  /** The block written first: cell indices on the 0.5 m grid. */
  cell: Vec3;
  /** A marker block in empty space (to delete after placing), rather than a block of the build. */
  marker: boolean;
  /** Chosen by default rather than picked. */
  auto: boolean;
  /** The block's material. */
  materialItem: number;
}

/** The default anchor: among the lowest blocks, the one nearest the middle of the whole footprint (ties: lowest x, then z). */
export function autoAnchor(voxels: Voxel[]): Voxel | null {
  if (!voxels.length) return null;
  let i0 = Infinity, i1 = -Infinity, k0 = Infinity, k1 = -Infinity, j0 = Infinity;
  for (const v of voxels) {
    i0 = Math.min(i0, v.i); i1 = Math.max(i1, v.i); k0 = Math.min(k0, v.k); k1 = Math.max(k1, v.k); j0 = Math.min(j0, v.j);
  }
  const ci = (i0 + i1) / 2, ck = (k0 + k1) / 2;
  let best: Voxel | null = null, bestD = Infinity;
  for (const v of voxels) {
    if (v.j !== j0) continue;
    const d = (v.i - ci) ** 2 + (v.k - ck) ** 2;
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best && (v.i < best.i || (v.i === best.i && v.k < best.k)))) { best = v; bestD = d; }
  }
  return best;
}

/** The anchor as it will be written: the picked cell (a block of the build, or a marker when empty), or the default. */
export function resolveAnchor(voxels: Voxel[], picked: Vec3 | null | undefined, markerMaterial = MARKER_MATERIAL): ResolvedAnchor | null {
  if (picked) {
    const cell = picked.map((v) => Math.round(v)) as Vec3;
    const hit = voxels.find((v) => v.i === cell[0] && v.j === cell[1] && v.k === cell[2]);
    return { cell, marker: !hit, auto: false, materialItem: hit ? hit.materialItem : markerMaterial };
  }
  const a = autoAnchor(voxels);
  return a ? { cell: [a.i, a.j, a.k], marker: false, auto: true, materialItem: a.materialItem } : null;
}

/** Lift cleaned: a finite number of meters, to a tenth, within MAX_LIFT. */
export function cleanLift(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const r = Math.round(Math.max(-MAX_LIFT, Math.min(MAX_LIFT, n)) * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

/** A picked anchor cell cleaned: three whole numbers, or null. */
export function cleanAnchorCell(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return v.map((n) => Math.round(n as number)) as Vec3;
}
