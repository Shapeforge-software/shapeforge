import { apply, solid, type PlacedSolid } from './polyhedra';
import { FONTS, insideText, layoutText, pixelSteps, textParams, weightOf, type TextLayout } from './text';
import type { Vec3 } from './types';

/**
 * Numbers (or a d6's dots) on a polyhedron's faces, laid out as real dice are:
 *
 * - Opposite faces add up to one more than the number of faces (d6: 7, d8: 9, d12: 13, d20: 21).
 * - d6: 1 opposite 6, 2 opposite 5, 3 opposite 4, with 1, 2 and 3 counterclockwise round the corner they share (the
 *   usual Western die); dots in the usual patterns, the 2, 3 and 6 on the diagonal and in two columns.
 * - d10: 0 to 9, opposite faces adding to 9, the odd numbers round one tip and the even round the other; the 0 can
 *   read 10. Numbers stand with their tops toward the tip of their kite.
 * - d20: 20 has 2, 8 and 14 round it (and 1 has 19, 13 and 7), as on common d20s.
 * - d8, d12 and the rest of the d20: numbers spread so the faces round each corner add up as evenly as they can.
 * - d4: three numbers on each face, one near each corner, pointing at it: the number at the top corner is the roll;
 *   right-handed, so 1, 2 and 3 run clockwise on their face.
 * - 6 and 9 are underlined on dice that have both.
 *
 * All the numbers on a die are the same size, as big as fits the faces at the Size asked for; a pixel font keeps
 * its pixels a whole number of blocks (at least one), so on small faces it can come out bigger than the face. The
 * marks are found per block by the voxelizer (voxelize.ts): a block near a face whose spot on that face is inside a
 * number or dot takes the marking material.
 */

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
/** How far a point is from the line through a and b. */
const toLine = (p: Vec3, a: Vec3, b: Vec3) => Math.hypot(...cross(sub(p, a), unit(sub(b, a))));

/** A face of the unit solid: its normal, middle (the middle of its largest circle), which way is up, that circle's radius, its corners in order. */
interface UnitFace { n: Vec3; centre: Vec3; up: Vec3; inradius: number; corners: Vec3[]; cornerIds: number[] }

const faceMemo = new Map<string, UnitFace[]>();

function unitFaces(id: number, tilt: number): UnitFace[] {
  const memoKey = `${id}:${tilt}`;
  const hit = faceMemo.get(memoKey);
  if (hit) return hit;
  const s = solid(id, tilt);
  const faces = s.normals.map((n, f): UnitFace => {
    const ids = s.vertices.map((_, v) => v).filter((v) => s.vertexFaces[v].includes(f));
    const c0 = mul(ids.reduce((acc, v) => add(acc, s.vertices[v]), [0, 0, 0] as Vec3), 1 / ids.length);
    // Corners in order round the face.
    const e1 = unit(sub(s.vertices[ids[0]], c0)), e2 = cross(n, e1);
    const angle = (v: number) => { const d = sub(s.vertices[v], c0); return Math.atan2(dot(d, e2), dot(d, e1)); };
    const cornerIds = [...ids].sort((a, b) => angle(a) - angle(b));
    const corners = cornerIds.map((v) => s.vertices[v]);
    const edgesOf = corners.map((c, i): [Vec3, Vec3] => [c, corners[(i + 1) % corners.length]]);
    const fit = (p: Vec3) => Math.min(...edgesOf.map(([a, b]) => toLine(p, a, b)));
    let centre = c0;
    if (id === 3) {
      // A kite: its largest circle sits on the line from its tip to the far corner.
      const tip = corners.reduce((best, c) => (Math.hypot(c[0], c[2]) < Math.hypot(best[0], best[2]) ? c : best));
      const far = corners.reduce((best, c) => (Math.hypot(...sub(c, tip)) > Math.hypot(...sub(best, tip)) ? c : best));
      let lo = 0, hi = 1;
      for (let i = 0; i < 60; i++) {
        const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
        if (fit(add(tip, mul(sub(far, tip), a))) < fit(add(tip, mul(sub(far, tip), b)))) lo = a; else hi = b;
      }
      centre = add(tip, mul(sub(far, tip), (lo + hi) / 2));
    }
    // Up on the face: d6 sides upright, top and bottom toward -z and +z; d10 toward its kite's tip; the rest
    // toward the face's highest corner (ties: the one furthest toward +z, then +x).
    let up: Vec3;
    if (id === 1) up = Math.abs(n[1]) < 0.5 ? [0, 1, 0] : n[1] > 0 ? [0, 0, -1] : [0, 0, 1];
    else {
      const pick = id === 3
        ? corners.reduce((best, c) => (Math.hypot(c[0], c[2]) < Math.hypot(best[0], best[2]) ? c : best))
        : corners.reduce((best, c) => {
          const d = c[1] - best[1];
          if (Math.abs(d) > 1e-6) return d > 0 ? c : best;
          const dz = c[2] - best[2];
          if (Math.abs(dz) > 1e-6) return dz > 0 ? c : best;
          return c[0] > best[0] ? c : best;
        });
      up = unit(sub(pick, centre));
    }
    return { n, centre, up, inradius: fit(centre), corners, cornerIds };
  });
  if (faceMemo.size > 64) faceMemo.clear();
  faceMemo.set(memoKey, faces);
  return faces;
}

/** The face opposite each face (by normal), or -1. */
function opposites(faces: UnitFace[]): number[] {
  return faces.map((f) => faces.findIndex((g) => dot(f.n, g.n) < -1 + 1e-6));
}

/** How evenly the faces round each corner add up: the sum of squared differences from the average (lower is more even). */
function spread(id: number, tilt: number, numbers: number[]): number {
  const s = solid(id, tilt);
  const sums = s.vertexFaces.map((fs) => fs.reduce((t, f) => t + numbers[f], 0));
  const sizes = s.vertexFaces.map((fs) => fs.length);
  // Corners with different numbers of faces (the d10's tips) are compared with their own kind.
  let total = 0;
  for (const size of new Set(sizes)) {
    const group = sums.filter((_, i) => sizes[i] === size);
    const mean = group.reduce((a, b) => a + b, 0) / group.length;
    total += group.reduce((t, x) => t + (x - mean) ** 2, 0);
  }
  return total;
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) { yield items; return; }
  for (let i = 0; i < items.length; i++) for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
}

/** Opposite pairs of faces given the pairs of numbers (low, high), each way round: the most even by `spread`. */
function bestPairs(id: number, tilt: number, facePairs: [number, number][], numberPairs: [number, number][], fixed: number[]): number[] {
  let best: number[] | null = null, bestScore = Infinity;
  for (const order of permutations(numberPairs)) {
    for (let flips = 0; flips < 1 << facePairs.length; flips++) {
      const numbers = [...fixed];
      facePairs.forEach(([a, b], i) => {
        const [lo, hi] = order[i];
        if (flips & (1 << i)) { numbers[a] = hi; numbers[b] = lo; } else { numbers[a] = lo; numbers[b] = hi; }
      });
      const score = spread(id, tilt, numbers);
      if (score < bestScore - 1e-9) { bestScore = score; best = numbers; }
    }
  }
  return best!;
}

const numberMemo = new Map<string, number[]>();

/** The number on each face (d4: on each corner), as real dice have them (see the top of this file). */
export function dieNumbers(id: number, tilt = 1): number[] {
  const memoKey = `${id}:${tilt}`;
  const hit = numberMemo.get(memoKey);
  if (hit) return hit;
  const faces = unitFaces(id, tilt);
  const opp = opposites(faces);
  let numbers: number[];
  if (id === 0) {
    // Corners 1 to 4, right-handed: on the face with 1, 2 and 3, they run clockwise seen from outside.
    const s = solid(0);
    numbers = [1, 2, 3, 4];
    const f = faces.findIndex((x) => x.cornerIds.every((v) => numbers[v] <= 3));
    const [a, b, c] = [1, 2, 3].map((k) => s.vertices[numbers.indexOf(k)]);
    if (dot(cross(sub(b, a), sub(c, a)), faces[f].n) > 0) numbers = [1, 3, 2, 4];
  } else if (id === 1) {
    // +x 3, -x 4, +y 1, -y 6, +z 2, -z 5: 1, 2 and 3 counterclockwise round the corner they share.
    numbers = faces.map((f) => (f.n[1] > 0.5 ? 1 : f.n[1] < -0.5 ? 6 : f.n[2] > 0.5 ? 2 : f.n[2] < -0.5 ? 5 : f.n[0] > 0.5 ? 3 : 4));
  } else if (id === 3) {
    // Odd numbers on the faces round the top tip, each opposite the even one adding to 9.
    const top = faces.map((_, i) => i).filter((i) => faces[i].n[1] > 0);
    let best: number[] | null = null, bestScore = Infinity;
    for (const order of permutations([1, 3, 5, 7, 9])) {
      const n = new Array(faces.length).fill(0);
      top.forEach((f, i) => { n[f] = order[i]; n[opp[f]] = 9 - order[i]; });
      const score = spread(3, tilt, n);
      if (score < bestScore - 1e-9) { bestScore = score; best = n; }
    }
    numbers = best!;
  } else {
    const count = faces.length;
    const pairsOf = (fs: number[]) => fs.filter((f) => f < opp[f]).map((f): [number, number] => [f, opp[f]]);
    if (id === 5) {
      // 20 on the top face with 2, 8 and 14 round it; 1 opposite with 19, 13 and 7.
      const top = faces.reduce((b, f, i) => (f.n[1] > faces[b].n[1] + 1e-9 ? i : b), 0);
      const s = solid(5);
      const around = faces.map((_, i) => i).filter((i) => i !== top && s.edgeFaces.some((ef) => ef.includes(top) && ef.includes(i)));
      let best: number[] | null = null, bestScore = Infinity;
      for (const ring of permutations([2, 8, 14])) {
        const fixed = new Array(count).fill(0);
        fixed[top] = 20; fixed[opp[top]] = 1;
        around.forEach((f, i) => { fixed[f] = ring[i]; fixed[opp[f]] = 21 - ring[i]; });
        const free = faces.map((_, i) => i).filter((i) => fixed[i] === 0);
        const n = bestPairs(5, tilt, pairsOf(free), [[3, 18], [4, 17], [5, 16], [6, 15], [9, 12], [10, 11]], fixed);
        const score = spread(5, tilt, n);
        if (score < bestScore - 1e-9) { bestScore = score; best = n; }
      }
      numbers = best!;
    } else {
      const all = faces.map((_, i) => i);
      const numberPairs = Array.from({ length: count / 2 }, (_, i): [number, number] => [i + 1, count - i]);
      numbers = bestPairs(id, tilt, pairsOf(all), numberPairs, new Array(count).fill(0));
    }
  }
  numberMemo.set(memoKey, numbers);
  return numbers;
}

/** A mark on a face, in meters on the face (u across to the right, v up), from the face's middle. */
type Mark =
  | { kind: 'text'; layout: TextLayout; per: number; cu: number; cv: number; au: number; av: number; underline: boolean }
  | { kind: 'pip'; cu: number; cv: number; r: number };

interface PlacedFace { n: Vec3; centre: Vec3; up: Vec3; right: Vec3; marks: Mark[] }

export interface DieMarks {
  faces: PlacedFace[];
  /** The faces' distance from the middle (meters). */
  reach: number;
  /** Underline size and gap, in layout units. */
  line: number;
}

export interface MarkOptions {
  /** Dots instead of numbers (a d6 only). */
  pips: boolean;
  /** Font, by its place in FONTS. */
  font: number;
  /** Size, percent of what fits the face. */
  size: number;
  /** The d10's 0 written as 10. */
  tenAsTen: boolean;
}

const markMemo = new Map<string, DieMarks>();

/** The numbers or dots on a placed solid's faces (meters, from the solid's middle, as `placed.offset` measures it). */
export function dieMarks(placed: PlacedSolid, opts: MarkOptions): DieMarks {
  const memoKey = JSON.stringify([placed.solidId, placed.tilt, placed.turn, placed.scale, opts]);
  const hit = markMemo.get(memoKey);
  if (hit) return hit;
  const id = placed.solidId, k = placed.scale;
  const unitList = unitFaces(id, placed.tilt);
  const numbers = dieNumbers(id, placed.tilt);
  const font = FONTS[Math.max(0, Math.min(FONTS.length - 1, Math.round(opts.font)))];
  const weight = weightOf({ font: FONTS.indexOf(font), weight: 900 });
  const pixel = weight.grid > 0;
  // Laid out with 1 block a font pixel (pixel fonts), or 24 units tall (others), then scaled to fit.
  const size = pixel ? pixelSteps(weight, 1).capPixels : 24;
  const label = (n: number) => (id === 3 && n === 0 && opts.tenAsTen ? '10' : String(n));
  const underlined = (s: string) => (s === '6' || s === '9') && (id >= 3);
  const layoutOf = (s: string) => layoutText({ font: FONTS.indexOf(font), weight: 900, size, spacing: 0, lineSpacing: 0, align: 1, ...textParams(s) });
  const line = pixel ? 1 : 0.12 * size;
  const labels = [...new Set(numbers.map(label))];
  // Room: the middle of a face (d4: near each corner), as a circle; every number on the die the same size.
  const room = (id === 0 ? 0.45 : 0.85) * Math.min(...unitList.map((f) => f.inradius)) * k * (opts.size / 100);
  const need = Math.max(...labels.map((s) => { const l = layoutOf(s); return Math.hypot(l.width, l.height + (underlined(s) ? 2 * line : 0)) / 2; }));
  let per = room / need;
  if (pixel) {
    // Whole blocks a pixel: the nearest, if the number still fits inside the face's circle; otherwise fewer (at least one).
    const inside = (id === 0 ? 0.5 : 1) * Math.min(...unitList.map((f) => f.inradius)) * k * (opts.size / 100);
    const near = Math.max(0.5, Math.round(per / 0.5) * 0.5);
    per = near * need <= inside + 1e-9 ? near : Math.max(0.5, Math.floor(per / 0.5 + 1e-9) * 0.5);
  }
  const faces = unitList.map((f, i): PlacedFace => {
    const n = apply(placed.turn, f.n);
    let up = apply(placed.turn, f.up);
    // A face lying square on the block grid (the top of a die standing on a face): its number squared up with the
    // grid too, so its pixels land on whole blocks and read crisply.
    const axis = [0, 1, 2].find((a) => Math.abs(n[a]) > 1 - 1e-6);
    if (axis !== undefined) {
      const options = [0, 1, 2].filter((a) => a !== axis).flatMap((a) => [1, -1].map((sg) => { const v: Vec3 = [0, 0, 0]; v[a] = sg; return v; }));
      up = options.reduce((best, v) => (dot(v, up) > dot(best, up) + 1e-9 ? v : best), options[0]);
    }
    const right = cross(up, n);
    const centre = mul(apply(placed.turn, f.centre), k);
    const marks: Mark[] = [];
    if (opts.pips && id === 1) {
      // Dots on a 3 by 3 grid, a quarter of the side in from each edge.
      const side = 2 * f.inradius * k, g = side / 4, r = 0.09 * side * (opts.size / 100);
      const at: Record<number, [number, number][]> = {
        1: [[0, 0]], 2: [[1, 1], [-1, -1]], 3: [[1, 1], [0, 0], [-1, -1]], 4: [[1, 1], [-1, 1], [1, -1], [-1, -1]],
        5: [[1, 1], [-1, 1], [0, 0], [1, -1], [-1, -1]], 6: [[-1, 1], [-1, 0], [-1, -1], [1, 1], [1, 0], [1, -1]],
      };
      for (const [x, y] of at[numbers[i]]) marks.push({ kind: 'pip', cu: x * g, cv: y * g, r });
    } else if (id === 0) {
      // A number near each corner, pointing at it: the corner's own number.
      for (let c = 0; c < f.corners.length; c++) {
        const toward = sub(f.corners[c], f.centre);
        const d = unit(toward);
        const du = dot(apply(placed.turn, d), right), dv = dot(apply(placed.turn, d), up);
        const at = mul(toward, 0.5 * k);
        const s = label(numbers[f.cornerIds[c]]);
        marks.push({ kind: 'text', layout: layoutOf(s), per, cu: dot(apply(placed.turn, at), right), cv: dot(apply(placed.turn, at), up), au: du, av: dv, underline: false });
      }
    } else {
      const s = label(numbers[i]);
      marks.push({ kind: 'text', layout: layoutOf(s), per, cu: 0, cv: 0, au: 0, av: 1, underline: underlined(s) });
    }
    return { n, centre, up, right, marks };
  });
  const out: DieMarks = { faces, reach: placed.reach, line };
  if (markMemo.size > 32) markMemo.clear();
  markMemo.set(memoKey, out);
  return out;
}

/** Whether a spot on a face (meters across and up from its middle) is inside one of its marks. */
function onMark(face: PlacedFace, u: number, v: number, line: number): boolean {
  for (const m of face.marks) {
    const du = u - m.cu, dv = v - m.cv;
    if (m.kind === 'pip') { if (du * du + dv * dv <= m.r * m.r) return true; continue; }
    // Into the number's own frame (its up along a, its right along b), in layout units.
    const x = (du * m.av - dv * m.au) / m.per, y = (du * m.au + dv * m.av) / m.per;
    const h = m.layout.height / 2;
    // With an underline, the number and its line are centred together.
    const shift = m.underline ? line : 0;
    if (insideText(m.layout, x, y - shift)) return true;
    if (m.underline) {
      const yy = y - shift;
      if (yy <= -h - line && yy >= -h - 2 * line && Math.abs(x) <= m.layout.width / 2) return true;
    }
  }
  return false;
}

/**
 * For a point inside the solid (meters, from its middle as `placed.offset` measures it): how deep it is under the
 * nearest face, if its spot on that face is inside a mark; otherwise null.
 */
export function markDepthAt(marks: DieMarks, q: Vec3): number | null {
  let best = -1, gap = Infinity;
  for (let f = 0; f < marks.faces.length; f++) {
    const g = marks.reach - dot(marks.faces[f].n, q);
    if (g < gap) { gap = g; best = f; }
  }
  if (best < 0) return null;
  const face = marks.faces[best];
  const on = add(q, mul(face.n, gap));
  const d = sub(on, face.centre);
  return onMark(face, dot(d, face.right), dot(d, face.up), marks.line) ? gap : null;
}
