import { apply, eulerXYZ } from './math';
import { VOXEL_SIZE, type Shape, type Vec3 } from './types';
import { key, unkey } from './voxelize-keys';

/**
 * Pipe runs: one shape for a whole pipe (straight lengths, turns, S-bends, traps, helixes, reducers, couplings and
 * branches), built as one piece so every joint seals whatever its angle. The water channel (`radius`, inside) is
 * made first; the wall is every block within the wall thickness of it, plus every block sharing a face with a channel
 * block, so no face-to-face gap leads from the channel to the outside except at the open ends. Water doesn't pass
 * through blocks that touch only at an edge (tested in game, 2026-11-06), so diagonal gaps don't need closing.
 *
 * The run starts at its own origin heading +x with +y up and is then centered in its box. Segments follow in order
 * (up to SEGMENTS of them); each turns toward its own side (left, right, up or down of where the pipe is heading).
 */

export const SEGMENTS = 8;

/**
 * Branches. A joint's side outlets (T, cross, Y, 45° lateral, manifold) each start with the joint's straight stub
 * (its Branch length) and can carry on with their own segments, read from settings named after where they are: the
 * first outlet of segment 3 has `s3b1s1Type`, `s3b1s1Len`, ... and its end `s3b1End`. A branch's own joints can
 * branch again, down to MAX_BRANCH_DEPTH.
 */
export const MAX_BRANCH_DEPTH = 15;
/** The settings prefix of a joint's outlet: segment i of the chain at `prefix`, outlet b (from 1). */
export const branchPrefix = (prefix: string, i: number, b: number) => `${prefix}s${i}b${b}`;
/** How many branches deep a chain is: 0 for the run itself. */
export const branchDepth = (prefix: string) => (prefix.match(/b\d+/g) ?? []).length;

/** Segment kinds, by number. */
export const SEG = {
  none: 0, straight: 1, turn: 2, sBend: 3, uTrap: 4, helix: 5, reducer: 6, coupling: 7, tee: 8, cross: 9, wye: 10, lateral: 11, manifold: 12,
} as const;
export const SEG_LABELS: [number, string][] = [
  [SEG.none, 'None (end of the run)'], [SEG.straight, 'Straight'], [SEG.turn, 'Turn'], [SEG.sBend, 'S-bend (offset)'], [SEG.uTrap, 'U-trap'],
  [SEG.helix, 'Helix'], [SEG.reducer, 'Reducer (new radius)'], [SEG.coupling, 'Coupling (sleeve)'], [SEG.tee, 'T joint'], [SEG.cross, 'Cross'],
  [SEG.wye, 'Y joint'], [SEG.lateral, '45° lateral'], [SEG.manifold, 'Manifold'],
];

/** Fittings with side outlets. */
export const BRANCHING: ReadonlySet<number> = new Set([SEG.tee, SEG.cross, SEG.wye, SEG.lateral, SEG.manifold]);

/** How many side outlets segment i of the chain at `prefix` has (0 unless it's a joint). */
export function outletCount(p: Record<string, number>, prefix: string, i: number): number {
  const type = Math.round(p[`${prefix}s${i}Type`] ?? 0);
  if (type === SEG.cross) return 2;
  if (type === SEG.manifold) return Math.max(1, Math.round(p[`${prefix}s${i}Count`] ?? 3)) * (Math.round(p[`${prefix}s${i}Sides`] ?? 0) === 1 ? 2 : 1);
  return BRANCHING.has(type) ? 1 : 0;
}

/** The segments in use on the chain at `prefix`: from the first, up to the first set to None. */
export function chainSegments(p: Record<string, number>, prefix: string): number[] {
  const out: number[] = [];
  for (let i = 1; i <= SEGMENTS; i++) { if (Math.round(p[`${prefix}s${i}Type`] ?? 0) === SEG.none) break; out.push(i); }
  return out;
}

/** End fittings, by number. */
export const END = { open: 0, cap: 1, flange: 2, bell: 3, tank: 4 } as const;
export const END_LABELS: [number, string][] = [[END.open, 'Open'], [END.cap, 'End cap'], [END.flange, 'Flange'], [END.bell, 'Bell mouth'], [END.tank, 'Tank connector']];

type P = Record<string, number>;
type Sample = { pos: Vec3; r: number; s: number; branch: number };
type End = { pos: Vec3; tan: Vec3; r: number; kind: number; branch: number; s: number };

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return mul(a, 1 / l); };

/** A vector turned by `t` radians in the plane of f and s (f toward s), the rest of it kept. */
function inPlane(v: Vec3, f: Vec3, s: Vec3, t: number): Vec3 {
  const a = dot(v, f), b = dot(v, s);
  const rest = sub(sub(v, mul(f, a)), mul(s, b));
  return add(rest, add(mul(f, a * Math.cos(t) - b * Math.sin(t)), mul(s, a * Math.sin(t) + b * Math.cos(t))));
}

const STEP = 0.1;

interface Frame { pos: Vec3; f: Vec3; u: Vec3; r: number; s: number; flat?: Vec3 }

const UP: Vec3 = [0, 1, 0];

/**
 * The way a segment turns, as a vector across the pipe: left, right, up or down. Up is always toward +y (the pipe's
 * own up, before the shape's rotation) and down toward -y; left and right are level, as seen looking along the pipe
 * the way it runs. Heading straight up or down there's no level left or right, so they're as they were just before
 * (the frame carried along the pipe).
 */
function side(fr: Frame, dir: number): Vec3 {
  const level = cross(fr.f, UP);
  const right = Math.hypot(...level) > 1e-6 ? norm(level) : norm(cross(fr.f, fr.u));
  const up = norm(cross(right, fr.f));
  return [mul(right, -1), right, up, mul(up, -1)][Math.max(0, Math.min(3, Math.round(dir)))] as Vec3;
}

/** The pipe's path: samples along its center (radius at each), and its open ends. In its own frame, not centered. */
export function pipePath(p: P): { samples: Sample[]; ends: End[]; rings: { from: number; to: number; branch: number; extra: number }[]; outer: number } {
  const wall = Math.max(1, Math.round(p.wall ?? 1)) * VOXEL_SIZE;
  const samples: Sample[] = [];
  const ends: End[] = [];
  const rings: { from: number; to: number; branch: number; extra: number }[] = [];
  let branches = 0;
  // Heading +x, or straight down (a start facing up, for a fill end) with `startDown`.
  const down = Math.round(p.startDown ?? 0) === 1;
  let fr: Frame = { pos: [0, 0, 0], f: down ? [0, -1, 0] : [1, 0, 0], u: down ? [1, 0, 0] : [0, 1, 0], r: Math.max(0.25, p.radius ?? 1), s: 0 };
  const put = (frm: Frame, branch: number) => samples.push({ pos: frm.pos, r: frm.r, s: frm.s, branch });
  const bendRadius = (v: number | undefined, r: number) => Math.max(r + wall + 0.25, v ?? 0);
  // Moves a frame along a straight line, or around an arc toward `sd`.
  const straight = (frm: Frame, len: number, branch: number, r1?: number, ecc?: Vec3): Frame => {
    const n = Math.max(1, Math.ceil(len / STEP));
    let out = frm;
    const r0 = frm.r;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const r = r1 === undefined ? r0 : r0 + (r1 - r0) * t;
      // Eccentric: the flat side stays put, so the center moves by the change in radius.
      const shift = ecc ? mul(ecc, -(r - r0)) : [0, 0, 0] as Vec3;
      out = { ...frm, pos: add(add(frm.pos, mul(frm.f, len * t)), shift), r, s: frm.s + len * t };
      put(out, branch);
    }
    return out;
  };
  const arc = (frm: Frame, angle: number, sd: Vec3, R: number, branch: number): Frame => {
    const th = (angle * Math.PI) / 180;
    const n = Math.max(2, Math.ceil((R * th) / STEP));
    const C = add(frm.pos, mul(sd, R));
    let out = frm;
    for (let i = 1; i <= n; i++) {
      const t = (th * i) / n;
      const pos = add(C, add(mul(sd, -R * Math.cos(t)), mul(frm.f, R * Math.sin(t))));
      out = { ...frm, pos, f: inPlane(frm.f, frm.f, sd, t), u: inPlane(frm.u, frm.f, sd, t), s: frm.s + R * t };
      put(out, branch);
    }
    return out;
  };
  const branchEnd = Math.round(p.branchEnds ?? END.open);
  // A side outlet: a straight stub from a point on the run, then the branch's own segments (`sub`), then its end.
  const outlet = (at: Frame, dir: Vec3, len: number, chain: string, angle = 90, R?: number) => {
    const b = ++branches;
    let o: Frame = { ...at, s: 0 };
    put(o, b);
    // Its frame's up as near +y as the new heading allows (the run's heading, if the outlet points straight up or down).
    if (angle === 90 && R === undefined) {
      const lift = sub(UP, mul(dir, dot(dir, UP)));
      o = { ...o, f: dir, u: Math.hypot(...lift) > 1e-6 ? norm(lift) : at.f };
    }
    else o = arc(o, angle, dir, bendRadius(R, at.r), b);
    o = straight(o, Math.max(VOXEL_SIZE, len), b);
    if (branchDepth(chain) <= MAX_BRANCH_DEPTH) o = runChain(chain, o, b);
    const kind = Math.round(p[`${chain}End`] ?? branchEnd);
    ends.push({ pos: o.pos, tan: o.f, r: o.r, kind, branch: b, s: o.s });
    if (kind === END.flange) rings.push({ from: o.s - (p.flangeLen ?? 1), to: o.s, branch: b, extra: Math.max(1, Math.round(p.flangeThick ?? 1)) * VOXEL_SIZE });
  };
  put(fr, 0);
  ends.push({ pos: fr.pos, tan: mul(fr.f, -1), r: fr.r, kind: Math.round(p.startEnd ?? END.open), branch: 0, s: fr.s });
  const startS = 0;
  fr = runChain('', fr, 0);
  function runChain(prefix: string, start: Frame, branch: number): Frame {
  let fr = start;
  for (let i = 1; i <= SEGMENTS; i++) {
    const g = (k: string, d: number) => (p[`${prefix}s${i}${k}`] ?? d);
    const outletKey = (b: number) => branchPrefix(prefix, i, b);
    let type = Math.round(g('Type', 0));
    if (type === SEG.none) break;
    if (BRANCHING.has(type) && branchDepth(prefix) >= MAX_BRANCH_DEPTH) type = SEG.straight;
    const len = Math.max(VOXEL_SIZE, g('Len', 2));
    const sd = side(fr, g('Dir', 1));
    const R = bendRadius(g('Bend', 0), fr.r);
    switch (type) {
      case SEG.straight: fr = straight(fr, len, branch); break;
      case SEG.turn: fr = arc(fr, g('Angle', 90), sd, R, branch); break;
      case SEG.sBend: {
        const a = Math.max(15, Math.min(90, g('Angle', 45))), th = (a * Math.PI) / 180;
        const offset = Math.max(0, g('Offset', 2));
        let Rb = R;
        // Two matching turns, with a straight between them to make up the offset.
        if (2 * Rb * (1 - Math.cos(th)) > offset) Rb = Math.max(fr.r + wall, offset / (2 * (1 - Math.cos(th))));
        const mid = Math.max(0, (offset - 2 * Rb * (1 - Math.cos(th))) / Math.sin(th));
        fr = arc(fr, a, sd, Rb, branch);
        if (mid > 0) fr = straight(fr, mid, branch);
        fr = arc(fr, a, mul(side(fr, g('Dir', 1)), -1), Rb, branch);
        break;
      }
      case SEG.uTrap: {
        // Down, round the bottom, and back up: a dip that holds water, then on in the same direction.
        const depth = Math.max(0, g('Depth', 1));
        const forward = fr.f;
        fr = arc(fr, 90, sd, R, branch);
        if (depth > 0) fr = straight(fr, depth, branch);
        fr = arc(fr, 180, forward, R, branch);
        if (depth > 0) fr = straight(fr, depth, branch);
        fr = arc(fr, 90, forward, R, branch);
        break;
      }
      case SEG.helix: {
        // Round a helix whose axis runs the way the pipe heads, rising along it.
        const turns = Math.max(0.25, g('Turns', 1)), Rh = Math.max(fr.r + wall + 0.5, g('HelixR', 3)), rise = Math.max(2 * (fr.r + wall), g('Rise', 3));
        const axis = fr.f, a0 = mul(sd, -1), b0 = norm(cross(axis, a0));
        const C = sub(fr.pos, mul(a0, Rh));
        const total = turns * 2 * Math.PI, n = Math.max(8, Math.ceil((Math.hypot(Rh * total, rise * turns)) / STEP));
        let out = fr;
        for (let k = 1; k <= n; k++) {
          const t = (total * k) / n;
          const pos = add(C, add(add(mul(a0, Rh * Math.cos(t)), mul(b0, Rh * Math.sin(t))), mul(axis, (rise * t) / (2 * Math.PI))));
          const tan = norm(add(add(mul(a0, -Rh * Math.sin(t)), mul(b0, Rh * Math.cos(t))), mul(axis, rise / (2 * Math.PI))));
          out = { ...fr, pos, f: tan, u: axis, s: fr.s + (Math.hypot(Rh * total, rise * turns) * k) / n };
          put(out, branch);
        }
        fr = out;
        break;
      }
      case SEG.reducer: {
        const ecc = Math.round(g('Ecc', 0)) === 1 ? sd : undefined;
        fr = straight(fr, len, branch, Math.max(0.25, g('Radius', fr.r)), ecc);
        break;
      }
      case SEG.coupling: {
        const s0 = fr.s;
        fr = straight(fr, len, branch);
        rings.push({ from: s0, to: fr.s, branch, extra: Math.max(1, Math.round(p.flangeThick ?? 1)) * VOXEL_SIZE });
        break;
      }
      case SEG.tee: case SEG.cross: case SEG.lateral: {
        const half = straight(fr, len / 2, branch);
        const blen = g('Branch', 2);
        if (type === SEG.lateral) outlet(half, sd, blen, outletKey(1), 45, g('Bend', 0) || undefined);
        else outlet(half, sd, blen, outletKey(1));
        if (type === SEG.cross) outlet(half, mul(sd, -1), blen, outletKey(2));
        fr = straight(half, len / 2, branch);
        break;
      }
      case SEG.wye: {
        // The run carries on round one arm; the other arm is a branch, mirrored.
        const a = g('Angle', 45);
        outlet(fr, mul(sd, -1), g('Branch', 2), outletKey(1), a, R);
        fr = arc(fr, a, sd, R, branch);
        fr = straight(fr, g('Branch', 2), branch);
        break;
      }
      case SEG.manifold: {
        // Outlets as close as their walls allow (channel, a shared wall, channel), plus Spacing blocks between them;
        // the same again before the first and after the last.
        const count = Math.max(1, Math.round(g('Count', 3)));
        const step = 2 * fr.r + wall + Math.max(0, Math.round(g('Spacing', 0))) * VOXEL_SIZE;
        const both = Math.round(g('Sides', 0)) === 1;
        let n = 0;
        for (let k = 1; k <= count; k++) {
          fr = straight(fr, step, branch);
          outlet(fr, sd, g('Branch', 1), outletKey(++n));
          if (both) outlet(fr, mul(sd, -1), g('Branch', 1), outletKey(++n));
        }
        fr = straight(fr, step, branch);
        break;
      }
    }
  }
  return fr;
  }
  ends.push({ pos: fr.pos, tan: fr.f, r: fr.r, kind: Math.round(p.finishEnd ?? END.open), branch: 0, s: fr.s });
  // Flanges at the run's own ends.
  const fl = Math.max(VOXEL_SIZE, p.flangeLen ?? 1), ft = Math.max(1, Math.round(p.flangeThick ?? 1)) * VOXEL_SIZE;
  if (Math.round(p.startEnd ?? 0) === END.flange) rings.push({ from: startS, to: startS + fl, branch: 0, extra: ft });
  if (Math.round(p.finishEnd ?? 0) === END.flange) rings.push({ from: fr.s - fl, to: fr.s, branch: 0, extra: ft });
  // Bell mouths: the channel flares out over their length.
  for (const [which, at] of [[p.startEnd, 'start'], [p.finishEnd, 'end']] as const) {
    if (Math.round(which ?? 0) !== END.bell) continue;
    const L = Math.max(VOXEL_SIZE, p.bellLen ?? 1.5), R = Math.max(0.5, p.bellRadius ?? 2);
    const last = fr.s;
    for (const smp of samples) {
      if (smp.branch !== 0) continue;
      const d = at === 'start' ? smp.s : last - smp.s;
      if (d < L) smp.r = smp.r + (R - smp.r) * (1 - d / L) ** 2;
    }
    const e = ends.find((x) => x.branch === 0 && (at === 'start' ? x === ends[0] : x !== ends[0]));
    if (e) e.r = R;
  }
  return { samples, ends, rings, outer: wall };
}

/**
 * The pipe's blocks in the world: worked out for its rotation and position at once, on the world grid, so a turned
 * pipe stays sealed.
 */
export function pipeWorldCells(shape: Shape, p: P): Set<number> {
  const { samples, ends, rings, outer } = pipePath(p);
  const { center } = pipeBox(p);
  const rot = eulerXYZ(shape.rotation);
  const toWorld = (v: Vec3): Vec3 => add(apply(rot, sub(v, center)), shape.position);
  const W = samples.map((s) => ({ ...s, pos: toWorld(s.pos) }));
  const E = ends.map((e) => ({ ...e, pos: toWorld(e.pos), tan: norm(apply(rot, e.tan)) }));
  const cellOf = (v: number) => Math.floor(v / VOXEL_SIZE);
  const centerOf = (i: number) => (i + 0.5) * VOXEL_SIZE;
  const channel = new Set<number>();
  const wallSet = new Set<number>();
  const visitBall = (c: Vec3, rad: number, fn: (i: number, j: number, k: number, d2: number) => void) => {
    const lo = c.map((v) => cellOf(v - rad)), hi = c.map((v) => cellOf(v + rad));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
      const d2 = (centerOf(i) - c[0]) ** 2 + (centerOf(j) - c[1]) ** 2 + (centerOf(k) - c[2]) ** 2;
      if (d2 <= rad * rad) fn(i, j, k, d2);
    }
  };
  // Beyond an end (past its plane, near it): the channel and wall stop there. A capped end keeps its wall. Only the
  // blocks made by the stretch of pipe leading to that end are cut, so an end lying beside another part of the run
  // (a helix's last coil over the straight before it, say) doesn't cut a hole in that part.
  const beyond = (i: number, j: number, k: number, onlyOpen: boolean, from: Sample) => E.some((e) => {
    if (onlyOpen && e.kind === END.cap) return false;
    if (e.branch !== from.branch || Math.abs(e.s - from.s) > e.r + outer + 2.5) return false;
    const v: Vec3 = [centerOf(i) - e.pos[0], centerOf(j) - e.pos[1], centerOf(k) - e.pos[2]];
    const reach = e.r + outer + 2.5;
    return dot(v, e.tan) > 1e-6 && dot(v, v) < reach * reach;
  });
  const owner = new Map<number, Sample>();
  for (const s of W) visitBall(s.pos, s.r - 1e-6, (i, j, k) => {
    if (beyond(i, j, k, false, s)) return;
    const n = key(i, j, k);
    channel.add(n);
    if (!owner.has(n)) owner.set(n, s);
  });
  // The centreline itself, walked block by block so each block shares a face with the next: keeps a thin channel
  // (down to one block across) open on diagonals and curves, where the blocks within the radius alone could touch
  // only at an edge.
  const addChannel = (i: number, j: number, k: number, s: Sample) => {
    if (beyond(i, j, k, false, s)) return;
    const n = key(i, j, k);
    channel.add(n);
    if (!owner.has(n)) owner.set(n, s);
  };
  for (let t = 0; t < W.length; t++) {
    const a = W[t], b = W[t + 1];
    const c = a.pos.map(cellOf);
    addChannel(c[0], c[1], c[2], a);
    if (!b || b.branch !== a.branch || Math.abs(b.s - a.s) > 1) continue;
    // Grid walk from a to b, one axis step at a time.
    const d = sub(b.pos, a.pos), stepDir = d.map(Math.sign), end = b.pos.map(cellOf);
    const tMax = d.map((v, x) => (v === 0 ? Infinity : ((stepDir[x] > 0 ? (c[x] + 1) * VOXEL_SIZE : c[x] * VOXEL_SIZE) - a.pos[x]) / v));
    const tDelta = d.map((v) => (v === 0 ? Infinity : VOXEL_SIZE / Math.abs(v)));
    for (let guard = 0; guard < 64 && (c[0] !== end[0] || c[1] !== end[1] || c[2] !== end[2]); guard++) {
      const x = tMax[0] <= tMax[1] && tMax[0] <= tMax[2] ? 0 : tMax[1] <= tMax[2] ? 1 : 2;
      if (tMax[x] > 1) break;
      c[x] += stepDir[x]; tMax[x] += tDelta[x];
      addChannel(c[0], c[1], c[2], a);
    }
  }
  const ringExtra = (s: Sample) => rings.reduce((m, r) => (r.branch === s.branch && s.s >= r.from - 1e-6 && s.s <= r.to + 1e-6 ? Math.max(m, r.extra) : m), 0);
  // A thin channel (under a block's width from centreline to side) gets its wall built out from its blocks rather than
  // round the centreline, which can sit on a block boundary and give a lopsided wall; flanges still go round it.
  const thin = (s: Sample) => s.r < VOXEL_SIZE - 1e-6;
  for (const s of W) {
    const extra = ringExtra(s);
    if (thin(s) && extra === 0) continue;
    visitBall(s.pos, s.r + outer + extra, (i, j, k) => {
      const n = key(i, j, k);
      if (!channel.has(n) && !beyond(i, j, k, true, s)) wallSet.add(n);
    });
  }
  for (const n of channel) {
    const from = owner.get(n)!;
    if (!thin(from)) continue;
    const [i, j, k] = unkey(n), w = Math.round(outer / VOXEL_SIZE);
    for (let a = -w; a <= w; a++) for (let b = -w; b <= w; b++) for (let c = -w; c <= w; c++) {
      if (a * a + b * b + c * c > w * w) continue;
      const m = key(i + a, j + b, k + c);
      if (!channel.has(m) && !beyond(i + a, j + b, k + c, true, from)) wallSet.add(m);
    }
  }
  // Sealed: every block sharing a face with the channel is wall (or channel). Edge and corner contacts hold water.
  const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const n of channel) {
    const [i, j, k] = unkey(n), from = owner.get(n)!;
    for (const [a, b, c] of FACES) {
      const m = key(i + a, j + b, k + c);
      if (!channel.has(m) && !beyond(i + a, j + b, k + c, true, from)) wallSet.add(m);
    }
  }
  // Tank connectors: a flat ring across the end, flush with it, for setting against a wall or tank.
  for (const e of E) {
    if (e.kind !== END.tank) continue;
    const R = Math.max(e.r + outer, p.tankRadius ?? 3), T = Math.max(1, Math.round(p.tankThick ?? 1)) * VOXEL_SIZE;
    visitBall(e.pos, Math.hypot(R, T) + VOXEL_SIZE, (i, j, k) => {
      const v: Vec3 = [centerOf(i) - e.pos[0], centerOf(j) - e.pos[1], centerOf(k) - e.pos[2]];
      const along = dot(v, e.tan), across = Math.hypot(...sub(v, mul(e.tan, along)));
      const n = key(i, j, k);
      if (along <= 1e-6 && along > -T && across <= R && !channel.has(n)) wallSet.add(n);
    });
  }
  return wallSet;
}

/** The pipe's box in its own frame: its middle (the frame is shifted so the box is centered) and half its size. */
export function pipeBox(p: P): { center: Vec3; half: Vec3 } {
  const k = JSON.stringify(p);
  const hit = boxMemo.get(k);
  if (hit) return hit;
  const { samples, rings, outer, ends } = pipePath(p);
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const extra = Math.max(0, ...rings.map((r) => r.extra));
  const tank = ends.some((e) => e.kind === END.tank) ? Math.max(0, (p.tankRadius ?? 3)) : 0;
  for (const s of samples) for (let a = 0; a < 3; a++) {
    const m = Math.max(s.r + outer + extra + VOXEL_SIZE, tank);
    lo[a] = Math.min(lo[a], s.pos[a] - m); hi[a] = Math.max(hi[a], s.pos[a] + m);
  }
  const out = { center: lo.map((v, a) => (v + hi[a]) / 2) as Vec3, half: lo.map((v, a) => (hi[a] - v) / 2) as Vec3 };
  if (boxMemo.size > 64) boxMemo.clear();
  boxMemo.set(k, out);
  return out;
}
const boxMemo = new Map<string, { center: Vec3; half: Vec3 }>();

/**
 * A water splitter as a pipe run: a fill end facing up, a drop of `inputHeight`, a level run of `inputLength` to the
 * first outlets, then the outlets in pairs (one left, one right) as close as their walls allow. An odd count adds one
 * drain straight on; an even count caps the far end. Every outlet is level with the others and `outletLength` long.
 */
export function splitterPipe(p: P): P {
  const r = Math.max(0.25, p.radius ?? 0.25), wallBlocks = Math.max(1, Math.round(p.wall ?? 1)), wall = wallBlocks * VOXEL_SIZE;
  const R = r + wall + 0.25; // the tightest bend (see bendRadius)
  const n = Math.max(2, Math.round(p.outlets ?? 6)), pairs = Math.floor(n / 2), odd = n % 2 === 1;
  const spacing = 2 * r + wallBlocks * VOXEL_SIZE + Math.max(0, Math.round(p.spacing ?? 0)) * VOXEL_SIZE; // channel, shared wall, channel
  const outletLen = Math.max(VOXEL_SIZE, p.outletLength ?? 2.5);
  const q: P = {
    radius: r, wall: wallBlocks, startDown: 1, startEnd: END.open, finishEnd: odd ? END.open : END.cap, branchEnds: END.open,
    s1Type: SEG.straight, s1Len: Math.max(VOXEL_SIZE, (p.inputHeight ?? 3) - R),
    s2Type: SEG.turn, s2Angle: 90, s2Dir: 2, s2Bend: 0,
    s3Type: SEG.straight, s3Len: Math.max(VOXEL_SIZE, (p.inputLength ?? 3) - R - spacing),
    s4Type: SEG.manifold, s4Len: spacing * (pairs + 1), s4Count: pairs, s4Sides: 1, s4Dir: 0, s4Branch: outletLen, s4Spacing: Math.max(0, Math.round(p.spacing ?? 0)),
    s5Type: SEG.none,
  };
  // The drain straight on reaches as far out as the side outlets.
  if (odd && outletLen > spacing) { q.s5Type = SEG.straight; q.s5Len = outletLen - spacing; q.s6Type = SEG.none; }
  return q;
}
