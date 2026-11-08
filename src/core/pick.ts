import { isRoof } from './roofs';
import { VOXEL_SIZE, type Shape, type Vec3 } from './types';
import { CellCache, worldBounds } from './voxelize';
import { key, unkey } from './voxelize-keys';

/**
 * Picking shapes in the 3D view: which shape a click lands on, and which shapes a dragged box takes in. The view
 * hands over its camera as a ray (for a click) or its view-projection matrix (for a box); everything here is plain
 * math on the block grid, so it is tested without a screen.
 */

export interface Ray { origin: Vec3; dir: Vec3 }

/** Where a ray enters and leaves a box (distances along it), or null when it misses. */
export function rayBox(ray: Ray, min: Vec3, max: Vec3): [number, number] | null {
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    const o = ray.origin[a], d = ray.dir[a];
    if (Math.abs(d) < 1e-12) { if (o < min[a] || o > max[a]) return null; continue; }
    let ta = (min[a] - o) / d, tb = (max[a] - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/**
 * The first block a ray reaches among `solid` (cell keys), walking the 0.5 m grid between `from` and `to` along it;
 * with the distance it is reached at. Null when none.
 */
export function castGrid(ray: Ray, solid: (n: number) => boolean, from: number, to: number): { cell: number; t: number; prev?: number } | null {
  const S = VOXEL_SIZE;
  const p = ray.origin.map((o, a) => o + ray.dir[a] * (from + 1e-9));
  const c = p.map((v) => Math.floor(v / S));
  const step = ray.dir.map((d) => (d > 0 ? 1 : d < 0 ? -1 : 0));
  const tMax = ray.dir.map((d, a) => (d === 0 ? Infinity : from + ((c[a] + (d > 0 ? 1 : 0)) * S - p[a]) / d));
  const tDelta = ray.dir.map((d) => (d === 0 ? Infinity : S / Math.abs(d)));
  let t = from;
  let prev: number | undefined;
  for (let guard = 0; guard < 100000 && t <= to; guard++) {
    const n = key(c[0], c[1], c[2]);
    // With the empty cell the ray came through just before, the one in front of the face it hit.
    if (solid(n)) return { cell: n, t, prev };
    prev = n;
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    t = tMax[a];
    c[a] += step[a];
    tMax[a] += tDelta[a];
  }
  return null;
}

/**
 * Which shape owns each visible block: shapes apply in order, so the last add that sets a block owns it, a later
 * subtract clears it and an intersect keeps only what it overlaps. Roofs built from pieces own no blocks here.
 */
export function blockOwners(shapes: Shape[], cache: CellCache): Map<number, string> {
  const owner = new Map<number, string>();
  for (const s of shapes) {
    const { cells } = cache.get(s);
    if (s.op === 'add') for (const n of cells) owner.set(n, s.id);
    else if (s.op === 'subtract') for (const n of cells) owner.delete(n);
    else for (const n of [...owner.keys()]) if (!cells.has(n)) owner.delete(n);
  }
  return owner;
}

/**
 * The shape a click lands on: the nearest of the first visible block along the ray and any roof's box it passes
 * through (roof pieces aren't blocks). Null when it hits nothing.
 */
export function pickShape(ray: Ray, shapes: Shape[], owners: Map<number, string>): string | null {
  let best: { id: string; t: number } | null = null;
  // The blocks: walk only through the box round all of them.
  if (owners.size) {
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const s of shapes) {
      const b = worldBounds(s);
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], b.min[a] - 1); max[a] = Math.max(max[a], b.max[a] + 1); }
    }
    const span = rayBox(ray, min, max);
    if (span) {
      const hit = castGrid(ray, (n) => owners.has(n), span[0], span[1]);
      if (hit) best = { id: owners.get(hit.cell)!, t: hit.t };
    }
  }
  for (const s of shapes) {
    if (!isRoof(s.kind)) continue;
    const b = worldBounds(s);
    const span = rayBox(ray, b.min, b.max);
    // A roof's box is mostly air under its slopes: count it a little behind blocks it shares space with.
    if (span && (!best || span[0] + 0.25 < best.t)) best = { id: s.id, t: span[0] + 0.25 };
  }
  return best?.id ?? null;
}

/**
 * The block a click lands on among `solid` (cell keys, within the box `min`..`max` in meters), and the empty cell in
 * front of the face it hit (absent when the ray starts inside a block).
 */
export function pickBlock(ray: Ray, solid: Set<number>, min: Vec3, max: Vec3): { cell: Vec3; front?: Vec3 } | null {
  if (!solid.size) return null;
  const span = rayBox(ray, min.map((v) => v - 1) as Vec3, max.map((v) => v + 1) as Vec3);
  if (!span) return null;
  const hit = castGrid(ray, (n) => solid.has(n), span[0], span[1]);
  if (!hit) return null;
  return { cell: unkey(hit.cell) as Vec3, front: hit.prev === undefined ? undefined : (unkey(hit.prev) as Vec3) };
}

/** A point through a view-projection matrix (column-major, as three.js keeps it): screen x, y in -1..1, or null behind the camera. */
export function project(m: ArrayLike<number>, p: Vec3): [number, number] | null {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (w <= 1e-6) return null;
  return [x / w, y / w];
}

/** A rectangle on screen, in -1..1 coordinates (y up). */
export interface ScreenRect { x0: number; y0: number; x1: number; y1: number }

/**
 * The shapes with any part inside a rectangle dragged on screen: any of their blocks (their own, visible or not:
 * a subtract shape is caught by the space it cuts), or for roofs any point of their box, in front of the camera.
 */
export function shapesInRect(m: ArrayLike<number>, rect: ScreenRect, shapes: Shape[], cache: CellCache): string[] {
  const inside = (p: Vec3) => { const q = project(m, p); return !!q && q[0] >= rect.x0 && q[0] <= rect.x1 && q[1] >= rect.y0 && q[1] <= rect.y1; };
  const out: string[] = [];
  const h = VOXEL_SIZE / 2;
  for (const s of shapes) {
    if (isRoof(s.kind)) {
      const b = worldBounds(s);
      let hit = false;
      for (let i = 0; i <= 4 && !hit; i++) for (let j = 0; j <= 4 && !hit; j++) for (let k = 0; k <= 4 && !hit; k++) {
        hit = inside([b.min[0] + ((b.max[0] - b.min[0]) * i) / 4, b.min[1] + ((b.max[1] - b.min[1]) * j) / 4, b.min[2] + ((b.max[2] - b.min[2]) * k) / 4]);
      }
      if (hit) out.push(s.id);
      continue;
    }
    for (const n of cache.get(s).cells) {
      const c = unkey(n);
      if (inside([c[0] * VOXEL_SIZE + h, c[1] * VOXEL_SIZE + h, c[2] * VOXEL_SIZE + h])) { out.push(s.id); break; }
    }
  }
  return out;
}

/** Where a ray meets a plane (through `point`, facing `normal`), or null when it runs along it or away. */
export function rayPlane(ray: Ray, point: Vec3, normal: Vec3): Vec3 | null {
  const d = normal[0] * ray.dir[0] + normal[1] * ray.dir[1] + normal[2] * ray.dir[2];
  if (Math.abs(d) < 1e-9) return null;
  const t = (normal[0] * (point[0] - ray.origin[0]) + normal[1] * (point[1] - ray.origin[1]) + normal[2] * (point[2] - ray.origin[2])) / d;
  if (t < 0) return null;
  return [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
}
