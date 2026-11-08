import { dieNumbers } from './dice';
import type { Vec3 } from './types';

/**
 * Polyhedra: the five Platonic solids and the six standard dice (the same solids, plus the d10's pentagonal
 * trapezohedron). Each is described by its face normals; every face is the same distance from the middle, so a point
 * is inside when it is behind every face (n · p <= 1). Corners are where three faces meet.
 *
 * A solid stands on a face (as a die rests), an edge or a point (a corner, or the d10's pole), turned so that part is
 * straight down; its height as it stands is the size asked for, and its box is centred on the shape's position.
 */

export interface PolyhedronInfo {
  id: number;
  name: string;
  die: string;
  faces: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;

const signs = (v: Vec3): Vec3[] => {
  const out: Vec3[] = [];
  for (const sx of v[0] ? [1, -1] : [1]) for (const sy of v[1] ? [1, -1] : [1]) for (const sz of v[2] ? [1, -1] : [1]) out.push([v[0] * sx, v[1] * sy, v[2] * sz]);
  return out;
};
const cyclic = (v: Vec3): Vec3[] => [v, [v[1], v[2], v[0]], [v[2], v[0], v[1]]];

/**
 * The d10's kites, alternately tilted up and down round the middle. `tilt` 1 is the dual of a pentagonal antiprism with
 * equal edges; more makes the faces face more up and down (a squatter die), less a more pointed one. The ten kites
 * stay alike whatever the tilt, so it's still a fair die.
 */
function d10Normals(tilt: number): Vec3[] {
  return Array.from({ length: 10 }, (_, k): Vec3 => [2 * Math.cos((k * Math.PI) / 5), k % 2 ? -tilt : tilt, 2 * Math.sin((k * Math.PI) / 5)]);
}

/** Face normals (not yet unit length), by solid. */
const NORMALS: Record<number, Vec3[]> = {
  0: [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
  1: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  2: signs([1, 1, 1]),
  // The d10: kites alternately tilted up and down round the middle, the dual of a pentagonal antiprism with equal edges.
  3: d10Normals(1),
  4: cyclic([0, 1, PHI]).flatMap(signs),
  5: [...signs([1, 1, 1]), ...cyclic([0, 1 / PHI, PHI]).flatMap(signs)],
};

export const POLYHEDRA: PolyhedronInfo[] = [
  { id: 0, name: 'Tetrahedron', die: 'd4', faces: 4 },
  { id: 1, name: 'Cube', die: 'd6', faces: 6 },
  { id: 2, name: 'Octahedron', die: 'd8', faces: 8 },
  { id: 3, name: 'Pentagonal trapezohedron', die: 'd10', faces: 10 },
  { id: 4, name: 'Dodecahedron', die: 'd12', faces: 12 },
  { id: 5, name: 'Icosahedron', die: 'd20', faces: 20 },
];

/** What it stands on. */
export const STANDS = ['face', 'edge', 'point'] as const;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

export interface Solid {
  normals: Vec3[];
  vertices: Vec3[];
  edges: [number, number][];
  edgeFaces: number[][];
  /** By corner, the faces meeting there. */
  vertexFaces: number[][];
}

/** A solid's unit normals (faces at distance 1), its corners and its edges (corners sharing two faces). */
const solids = new Map<string, Solid>();
export function solid(id: number, tilt = 1): Solid {
  const memoKey = `${id}:${id === 3 ? tilt : 1}`;
  const hit = solids.get(memoKey);
  if (hit) return hit;
  const built = buildSolid(id === 3 ? d10Normals(tilt) : NORMALS[id]);
  if (solids.size > 256) solids.clear();
  solids.set(memoKey, built);
  return built;
}

function buildSolid(raw: Vec3[]): Solid {
  // Scaled so every face is at distance 1: the raw normals are all the same length for each solid.
  const normals = raw.map(unit);
  const vertices: Vec3[] = [];
  const faceSets: number[][] = [];
  for (let a = 0; a < normals.length; a++) for (let b = a + 1; b < normals.length; b++) for (let c = b + 1; c < normals.length; c++) {
    const [na, nb, nc] = [normals[a], normals[b], normals[c]];
    const det = dot(na, cross(nb, nc));
    if (Math.abs(det) < 1e-9) continue;
    // The point on all three planes (each at distance 1).
    const bc = cross(nb, nc), ca = cross(nc, na), ab = cross(na, nb);
    const p: Vec3 = [0, 1, 2].map((i) => (bc[i] + ca[i] + ab[i]) / det) as Vec3;
    if (normals.some((n) => dot(n, p) > 1 + 1e-7)) continue;
    let at = vertices.findIndex((v) => Math.hypot(v[0] - p[0], v[1] - p[1], v[2] - p[2]) < 1e-6);
    if (at < 0) { vertices.push(p); faceSets.push([]); at = vertices.length - 1; }
    for (const f of [a, b, c]) if (!faceSets[at].includes(f)) faceSets[at].push(f);
  }
  const edges: [number, number][] = [];
  const edgeFaces: number[][] = [];
  for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) {
    const shared = faceSets[i].filter((f) => faceSets[j].includes(f));
    if (shared.length >= 2) { edges.push([i, j]); edgeFaces.push(shared); }
  }
  return { normals, vertices, edges, edgeFaces, vertexFaces: faceSets };
}

/** The turn taking unit vector u to unit vector t (rows of a 3 x 3 matrix). */
function turnOnto(u: Vec3, t: Vec3): Vec3[] {
  const c = dot(u, t);
  if (c > 1 - 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (c < -1 + 1e-12) {
    // Half a turn about any axis square to u.
    const a = unit(Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]));
    return [0, 1, 2].map((r) => [0, 1, 2].map((s) => 2 * a[r] * a[s] - (r === s ? 1 : 0)) as Vec3);
  }
  const v = cross(u, t), k = 1 / (1 + c);
  return [
    [c + v[0] * v[0] * k, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1]],
    [v[1] * v[0] * k + v[2], c + v[1] * v[1] * k, v[1] * v[2] * k - v[0]],
    [v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], c + v[2] * v[2] * k],
  ];
}
export const apply = (m: Vec3[], v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

export interface PlacedSolid {
  /** Unit face normals, turned as it stands. */
  normals: Vec3[];
  /** Faces at this distance from the middle (meters, for the size asked for). */
  reach: number;
  /** The solid's middle from the middle of its box (meters). */
  offset: Vec3;
  /** Half the box, in meters. */
  half: Vec3;
  /** The edges, ends in meters from the solid's middle (as `offset` measures it). */
  edges: [Vec3, Vec3][];
  /** By face (as `normals`), the edges round it. */
  faceEdges: [Vec3, Vec3][][];
  /** Which solid, and the d10's tilt (see d10Normals): with `turn` and `scale`, how to place things on its faces. */
  solidId: number;
  tilt: number;
  /** The turn (rows) taking the unit solid to how it stands, and meters per unit. */
  turn: Vec3[];
  scale: number;
}

const memo = new Map<string, PlacedSolid>();

/** A solid turned so it stands on a face, edge or point: its normals and corners turned, and its box (unit size). */
function stood(s: Solid, stand: number, up?: Vec3): { normals: Vec3[]; verts: Vec3[]; lo: number[]; hi: number[]; turn: Vec3[] } {
  // What goes straight down: the lowest face, edge middle or corner (ties: the first listed).
  const lowest = <T>(items: T[], dir: (x: T) => Vec3) => items.reduce((best, x) => (unit(dir(x))[1] < unit(dir(best))[1] - 1e-9 ? x : best), items[0]);
  let down: Vec3;
  if (stand === 1) {
    const e = lowest(s.edges, ([a, b]) => [0, 1, 2].map((i) => s.vertices[a][i] + s.vertices[b][i]) as Vec3);
    down = unit([0, 1, 2].map((i) => s.vertices[e[0]][i] + s.vertices[e[1]][i]) as Vec3);
  } else if (stand === 2) down = unit(lowest(s.vertices, (v) => v));
  else down = lowest(s.normals, (n) => n);
  if (up) down = [-up[0], -up[1], -up[2]];
  const m = turnOnto(down, [0, -1, 0]);
  const verts = s.vertices.map((v) => apply(m, v));
  return {
    normals: s.normals.map((n) => apply(m, n)),
    verts,
    lo: [0, 1, 2].map((a) => Math.min(...verts.map((v) => v[a]))),
    hi: [0, 1, 2].map((a) => Math.max(...verts.map((v) => v[a]))),
    turn: m,
  };
}

/** A d10's width: across its middle, corner to corner (square to the line through its two tips), unit size. */
function d10Across(s: Solid): number {
  return 2 * Math.max(...s.vertices.map((v) => Math.hypot(v[0], v[2])));
}

/** Width across the middle, over height as it stands, for a d10 of this tilt. */
function d10Ratio(tilt: number, stand: number): number {
  const s = solid(3, tilt);
  const t = stood(s, stand);
  return d10Across(s) / (t.hi[1] - t.lo[1]);
}

/** The tilt giving a d10 this width for this height as it stands (as near as it can: very flat or very thin ones stop). */
export function d10Tilt(width: number, height: number, stand: number): number {
  const want = width / height;
  // The ratio grows with the tilt: halve the range (in log terms) until it's close.
  let lo = Math.log(0.1), hi = Math.log(10);
  if (d10Ratio(Math.exp(lo), stand) >= want) return Math.exp(lo);
  if (d10Ratio(Math.exp(hi), stand) <= want) return Math.exp(hi);
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (d10Ratio(Math.exp(mid), stand) < want) lo = mid; else hi = mid;
  }
  return Math.exp((lo + hi) / 2);
}

/** A d10's natural width (its usual shape) for this height as it stands. */
export const d10NaturalWidth = (height: number, stand: number) => d10Ratio(1, stand) * height;

/**
 * A solid standing on a face, edge or point, `height` meters tall as it stands. A d10 can be given its own `width`
 * across its middle (corner to corner); its faces tilt to fit, all ten kites still alike.
 */
export function placeSolid(id: number, stand: number, height: number, width?: number, topNumber?: number): PlacedSolid {
  const which = Math.max(0, Math.min(5, Math.round(id)));
  const custom = which === 3 && width !== undefined && width > 0;
  const k = JSON.stringify([which, stand, height, custom ? width : 0, stand === 0 ? topNumber ?? null : null]);
  const hit = memo.get(k);
  if (hit) return hit;
  const tilt = custom ? d10Tilt(width!, height, stand) : 1;
  const s = solid(which, tilt);
  // Standing on a face, the face with this number on top (a d4: the corner with it), the face opposite underneath.
  let up: Vec3 | undefined;
  if (stand === 0 && topNumber !== undefined) {
    const numbers = dieNumbers(which, tilt);
    const at = numbers.indexOf(topNumber);
    if (at >= 0) up = which === 0 ? unit(s.vertices[at]) : s.normals[at];
  }
  const { normals, verts, lo, hi, turn } = stood(s, stand, up);
  const scale = height / (hi[1] - lo[1]);
  const placed: PlacedSolid = {
    normals,
    reach: scale,
    offset: [0, 1, 2].map((a) => (-(lo[a] + hi[a]) / 2) * scale) as Vec3,
    half: [0, 1, 2].map((a) => ((hi[a] - lo[a]) / 2) * scale) as Vec3,
    edges: s.edges.map(([a, b]) => [verts[a].map((v) => v * scale) as Vec3, verts[b].map((v) => v * scale) as Vec3]),
    faceEdges: [],
    solidId: which,
    tilt,
    turn,
    scale,
  };
  placed.faceEdges = s.normals.map((_, f) => placed.edges.filter((_, e) => s.edgeFaces[e].includes(f)));
  if (memo.size > 64) memo.clear();
  memo.set(k, placed);
  return placed;
}

/** Whether a point (from the middle of the box) is inside. */
export function insideSolid(s: PlacedSolid, p: Vec3): boolean {
  const q: Vec3 = [p[0] - s.offset[0], p[1] - s.offset[1], p[2] - s.offset[2]];
  for (const n of s.normals) if (dot(n, q) > s.reach + 1e-9) return false;
  return true;
}

/** How far a point is from a segment. */
function toSegment(q: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const aq: Vec3 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
  const u = Math.max(0, Math.min(1, dot(aq, ab) / dot(ab, ab)));
  return Math.hypot(aq[0] - ab[0] * u, aq[1] - ab[1] * u, aq[2] - ab[2] * u);
}

/**
 * Whether a point (from the middle of the box) is in the wireframe: inside the solid, within `thickness` meters of a
 * face and, measured along that face, within `thickness` of its border. Each edge is a bar showing the same width on
 * both faces it joins, whatever the angle between them (a cube's bars are square), and the frame keeps the solid's
 * outline (its outer faces flush) with the middles of the faces left open.
 */
export function insideFrame(s: PlacedSolid, p: Vec3, thickness: number): boolean {
  const q: Vec3 = [p[0] - s.offset[0], p[1] - s.offset[1], p[2] - s.offset[2]];
  const gaps = s.normals.map((n) => s.reach - dot(n, q));
  if (gaps.some((g) => g < -1e-9)) return false;
  for (let f = 0; f < s.normals.length; f++) {
    if (gaps[f] > thickness + 1e-9) continue;
    // The point brought onto the face, and its distance to the face's border.
    const n = s.normals[f];
    const on: Vec3 = [q[0] + n[0] * gaps[f], q[1] + n[1] * gaps[f], q[2] + n[2] * gaps[f]];
    for (const [a, b] of s.faceEdges[f]) if (toSegment(on, a, b) <= thickness + 1e-9) return true;
  }
  return false;
}

/** Counts, for checking: faces, corners and edges of a solid. */
export function solidCounts(id: number): { faces: number; vertices: number; edges: number } {
  const s = solid(id);
  return { faces: s.normals.length, vertices: s.vertices.length, edges: s.edges.length };
}
