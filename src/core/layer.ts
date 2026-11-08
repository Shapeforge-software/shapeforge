import { apply, eulerXYZ } from './math';
import { VOXEL_SIZE, type ImportedLayer, type Shape, type Vec3, type Voxel } from './types';
import { key } from './voxelize-keys';

let layerCounter = 0;

/** Builds a layer from voxels, shifting them so the lowest corner is cell (0, 0, 0). Later duplicates win. */
export function layerFromVoxels(name: string, voxels: Voxel[]): ImportedLayer {
  if (voxels.length === 0) throw new Error('The blueprint has no blocks this app can read.');
  let mi = Infinity, mj = Infinity, mk = Infinity, xi = -Infinity, xj = -Infinity, xk = -Infinity;
  for (const v of voxels) {
    mi = Math.min(mi, v.i); mj = Math.min(mj, v.j); mk = Math.min(mk, v.k);
    xi = Math.max(xi, v.i); xj = Math.max(xj, v.j); xk = Math.max(xk, v.k);
  }
  const unique = new Map<string, Voxel>();
  for (const v of voxels) unique.set(`${v.i},${v.j},${v.k}`, v);
  const cells: number[] = [];
  for (const v of unique.values()) cells.push(v.i - mi, v.j - mj, v.k - mk, v.materialItem);
  layerCounter += 1;
  return {
    id: `layer-${Date.now().toString(36)}-${layerCounter}`,
    name,
    size: [xi - mi + 1, xj - mj + 1, xk - mk + 1],
    cells,
  };
}

export const layerBlockCount = (layer: ImportedLayer) => layer.cells.length / 4;

/** Rotation snapped to whole quarter turns, so rotated blocks stay on the grid. */
export function snapRotation(rotation: Vec3): Vec3 {
  return rotation.map((r) => Math.round(r / 90) * 90) as Vec3;
}

/** Half the layer's size in meters, before rotation. */
export function layerHalfExtents(layer: ImportedLayer): Vec3 {
  return layer.size.map((n) => (n * VOXEL_SIZE) / 2) as Vec3;
}

/**
 * World cells of a placed layer, mapped to each block's own material. The layer is centered on the shape's
 * position and turned in quarter turns around that center.
 */
export function layerCells(shape: Shape): Map<number, number> {
  const layer = shape.layer;
  const out = new Map<number, number>();
  if (!layer) return out;
  const rot = eulerXYZ(snapRotation(shape.rotation));
  const half = layerHalfExtents(layer);
  const [px, py, pz] = shape.position;
  const c = layer.cells;
  for (let n = 0; n < c.length; n += 4) {
    const local: Vec3 = [
      (c[n] + 0.5) * VOXEL_SIZE - half[0],
      (c[n + 1] + 0.5) * VOXEL_SIZE - half[1],
      (c[n + 2] + 0.5) * VOXEL_SIZE - half[2],
    ];
    const [x, y, z] = apply(rot, local);
    // Centers land on cell centers (or exactly between, for odd sizes); the tiny nudge picks one consistently.
    const cell = (v: number) => Math.floor(v / VOXEL_SIZE + 1e-6);
    out.set(key(cell(x + px), cell(y + py), cell(z + pz)), c[n + 3]);
  }
  return out;
}

/** Compact text form of the cells for project files: "i,j,k,m;i,j,k,m;...". */
export function encodeCells(cells: number[]): string {
  const parts: string[] = [];
  for (let n = 0; n < cells.length; n += 4) parts.push(`${cells[n]},${cells[n + 1]},${cells[n + 2]},${cells[n + 3]}`);
  return parts.join(';');
}

export function decodeCells(text: string): number[] {
  if (!text) return [];
  const out: number[] = [];
  for (const part of text.split(';')) {
    const nums = part.split(',').map(Number);
    if (nums.length !== 4 || !nums.every((x) => Number.isInteger(x) && x >= 0)) {
      throw new Error('The imported blocks in this project are damaged.');
    }
    out.push(...nums);
  }
  return out;
}
