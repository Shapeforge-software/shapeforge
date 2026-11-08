import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShape } from '../src/core/scene';
import { cleanParams, snapPipeRadius } from '../src/core/shapes';
import type { Shape, Vec3 } from '../src/core/types';
import { shapeCells, worldBounds } from '../src/core/voxelize';
import { key, unkey } from '../src/core/voxelize-keys';
import { MAX_BRANCH_DEPTH, SEG, pipeBox, pipePath, splitterPipe } from '../src/core/pipes';

const pipe = (params: Record<string, number>, rotation: Vec3 = [0, 0, 0]): Shape => {
  const s = createShape('pipe');
  return { ...s, rotation, params: cleanParams('pipe', { ...s.params, ...params }) };
};

/** Spaces not in the pipe, by face-joined regions in its box (plus a margin): sizes of those that don't reach the box's edge. */
function enclosed(s: Shape, diagonal = false): number[] {
  const wall = shapeCells(s), b = worldBounds(s);
  const lo = b.min.map((v) => Math.floor(v * 2) - 2), hi = b.max.map((v) => Math.ceil(v * 2) + 2);
  const steps: number[][] = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if ((x || y || z) && (diagonal || Math.abs(x) + Math.abs(y) + Math.abs(z) === 1)) steps.push([x, y, z]);
  const seen = new Set<number>(), out: number[] = [];
  for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) {
    const n = key(i, j, k);
    if (wall.has(n) || seen.has(n)) continue;
    seen.add(n);
    const stack = [[i, j, k]]; let edge = false, size = 0;
    while (stack.length) {
      const [a, c, d] = stack.pop()!;
      size++;
      if (a === lo[0] || a === hi[0] || c === lo[1] || c === hi[1] || d === lo[2] || d === hi[2]) edge = true;
      for (const [x, y, z] of steps) {
        const A = a + x, B = c + y, C = d + z;
        if (A < lo[0] || A > hi[0] || B < lo[1] || B > hi[1] || C < lo[2] || C > hi[2]) continue;
        const m = key(A, B, C);
        if (wall.has(m) || seen.has(m)) continue;
        seen.add(m); stack.push([A, B, C]);
      }
    }
    if (!edge) out.push(size);
  }
  return out;
}

const FITTINGS: Record<string, number>[] = [
  {}, { s2Angle: 45, s2Bend: 3 }, { s2Angle: 30 }, { s2Angle: 120 }, { s2Angle: 180 }, { s2Dir: 2, s2Angle: 60 },
  { s2Type: 3 }, { s2Type: 4 }, { s2Type: 5 }, { s2Type: 6, s2Radius: 2 }, { s2Type: 6, s2Radius: 2, s2Ecc: 1, s2Dir: 3 },
  { s2Type: 7 }, { s2Type: 8 }, { s2Type: 9 }, { s2Type: 10 }, { s2Type: 11, s2Bend: 4 }, { s2Type: 12 }, { radius: 2 }, { radius: 0.5 },
  { radius: 0.25 }, { radius: 0.25, s2Angle: 45 }, { radius: 0.25, s2Type: 5 }, { radius: 0.25, s2Type: 6, s2Radius: 1 },
  { s2Type: 12, s2Sides: 1 }, { radius: 0.25, s2Type: 12, s2Sides: 1, s2Count: 1 },
  // Branches with segments of their own (a T's branch turning and running on; a cross's two; a branch's own T).
  { s2Type: 8, s2b1s1Type: 2, s2b1s1Angle: 90, s2b1s1Dir: 2, s2b1s2Type: 1, s2b1s2Len: 3 },
  { s2Type: 9, s2b1s1Type: 1, s2b1s1Len: 2, s2b2s1Type: 2, s2b2s1Angle: 45 },
  { radius: 0.25, s2Type: 8, s2b1s1Type: 1, s2b1s2Type: 8, s2b1s2b1s1Type: 2, s2b1s2b1s2Type: 1 },
];

test('a pipe run capped at every end holds its water: no face-to-face way out at any rotation (edge contacts hold water in game)', () => {
  for (const f of FITTINGS) for (const rotation of [[0, 0, 0], [0, 37, 0], [20, 30, 10]] as Vec3[]) {
    const s = pipe({ ...f, startEnd: 1, finishEnd: 1, branchEnds: 1 }, rotation);
    const sealed = enclosed(s);
    assert.ok(sealed.length >= 1 && Math.max(...sealed) > 8, `${JSON.stringify(f)} ${rotation}: sealed`);
  }
});

test('open ends are open: with every end open nothing is shut in', () => {
  for (const f of FITTINGS) {
    const shut = enclosed(pipe({ ...f, startEnd: 0, finishEnd: 0, branchEnds: 0 }));
    assert.ok(shut.every((n) => n <= 8), `${JSON.stringify(f)}: ${shut}`);
  }
});

test('ends: flanges, bell mouths and tank connectors add blocks; caps close the pipe', () => {
  const count = (p: Record<string, number>) => shapeCells(pipe(p)).size;
  const open = count({});
  for (const finishEnd of [1, 2, 3, 4]) assert.ok(count({ finishEnd }) > open, `end ${finishEnd}`);
  assert.ok(count({ flangeThick: 2, startEnd: 2 }) > count({ startEnd: 2 }));
  assert.ok(count({ s2Type: 7 }) > count({ s2Type: 1, s2Len: 4 }), 'a coupling is a sleeve');
});

test('an open end cuts only its own stretch of pipe, not a coil or run passing beside it', () => {
  const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const f of [{ s2Type: 5, s3Type: 0 }, { s2Type: 5, s2HelixR: 2, s2Rise: 2.5, s3Type: 0 }, { s2Type: 5, s2Turns: 2, s3Type: 0 }, { s2Angle: 180, s3Len: 2 }, { s2Type: 4 }] as Record<string, number>[]) {
    const s = pipe({ ...f, startEnd: 0, finishEnd: 0, branchEnds: 0 }), wall = shapeCells(s);
    const P = s.params as Record<string, number>, { center } = pipeBox(P), { samples, ends } = pipePath(P);
    const at = (v: number[]) => v.map((x, a) => x - center[a] + s.position[a]);
    const channel = new Set<number>();
    for (const q of samples) {
      const c = at(q.pos);
      for (let i = Math.floor((c[0] - q.r) * 2); i <= Math.ceil((c[0] + q.r) * 2); i++) for (let j = Math.floor((c[1] - q.r) * 2); j <= Math.ceil((c[1] + q.r) * 2); j++) for (let k = Math.floor((c[2] - q.r) * 2); k <= Math.ceil((c[2] + q.r) * 2); k++)
        if (Math.hypot((i + 0.5) / 2 - c[0], (j + 0.5) / 2 - c[1], (k + 0.5) / 2 - c[2]) < q.r) channel.add(key(i, j, k));
    }
    // A face out of the channel that isn't wall, away from the open ends, is a hole.
    const holes = [];
    for (const n of channel) {
      const [i, j, k] = unkey(n);
      for (const [a, b, c] of FACES) {
        const m = key(i + a, j + b, k + c);
        if (channel.has(m) || wall.has(m)) continue;
        const p = [(i + a + 0.5) / 2, (j + b + 0.5) / 2, (k + c + 0.5) / 2];
        if (ends.every((e) => Math.hypot(...p.map((v, x) => v - at(e.pos)[x])) > e.r + 0.6)) holes.push(m);
      }
    }
    assert.equal(holes.length, 0, `${JSON.stringify(f)}: ${holes.length} holes in the wall away from the ends`);
  }
});

test('a 0.25 m radius pipe has a channel one block across with a one-block wall round it', () => {
  for (const rotation of [[0, 0, 0], [0, 37, 0], [20, 30, 10]] as Vec3[]) {
    const s = pipe({ radius: 0.25, startEnd: 1, finishEnd: 1, s2Type: 1, s2Len: 0.5, s3Type: 0, s1Len: 4 }, rotation);
    const sealed = enclosed(s);
    assert.equal(sealed.length, 1, `${rotation}: one channel`);
    // About one block per half meter of a 4.5 m run: one block across, not a wider channel.
    assert.ok(sealed[0] >= 9 && sealed[0] <= 24, `${rotation}: channel of ${sealed[0]} blocks`);
  }
  const straight = pipe({ radius: 0.25, s2Type: 1, s2Len: 0.5, s3Type: 0, s1Len: 4 });
  // Open both ends: 9 or 10 slices, 4 wall blocks round each (a cross), no more.
  const n = shapeCells(straight).size;
  assert.ok(n >= 36 && n <= 40, `${n} blocks`);
});

test('water splitter: the fill end faces up at the top, every outlet is level and open, and it seals', () => {
  for (const [outlets, radius] of [[6, 0.25], [3, 0.25], [2, 0.5], [7, 1]] as const) {
    const p = splitterPipe({ outlets, radius, outletLength: 2.5, inputLength: 3, inputHeight: 3 });
    const { ends } = pipePath(p);
    const open = ends.filter((e) => e.kind === 0);
    assert.equal(open.length, outlets + 1, `${outlets}: fill end plus every outlet open`);
    const fill = ends[0];
    assert.ok(fill.tan[1] > 0.99, 'the fill end faces up');
    const drains = open.slice(1);
    for (const d of drains) {
      assert.ok(Math.abs(d.pos[1] - drains[0].pos[1]) < 1e-6, 'outlets level');
      assert.ok(Math.abs(fill.pos[1] - d.pos[1] - 3) < 1e-6, 'fill end 3 m above the outlets');
      assert.ok(Math.abs(d.tan[1]) < 1e-6, 'outlets face sideways');
    }
    // Capped all round it holds its water, as a pipe run.
    const s = { ...createShape('pipe'), params: { ...p, startEnd: 1, finishEnd: 1, branchEnds: 1 } };
    const sealed = enclosed(s);
    assert.ok(sealed.length >= 1 && Math.max(...sealed) > 8, `${outlets}: sealed`);
  }
  // As its own shape: the same blocks as the pipe run it stands for.
  const sp = { ...createShape('pipeSplitter'), params: cleanParams('pipeSplitter', { outlets: 6 }) };
  const run = { ...createShape('pipe'), position: sp.position, rotation: sp.rotation, params: splitterPipe(sp.params) };
  assert.deepEqual([...shapeCells(sp)].sort(), [...shapeCells(run)].sort());
});

test('a branch carries on with its own segments to its own end', () => {
  const plain = pipePath(cleanParams('pipe', { s2Type: 8 }));
  const p = cleanParams('pipe', { s2Type: 8, s2b1s1Type: 2, s2b1s1Angle: 90, s2b1s2Type: 1, s2b1s2Len: 3, s2b1End: 1 });
  const path = pipePath(p);
  const end = (x: typeof path) => x.ends.find((e) => e.branch === 1)!;
  // Further out than the bare stub, turned, and capped as set.
  assert.ok(end(path).s > end(plain).s + 3, 'longer than the stub');
  assert.ok(Math.abs(end(path).tan[0] - end(plain).tan[0]) > 0.5 || Math.abs(end(path).tan[1] - end(plain).tan[1]) > 0.5, 'turned');
  assert.equal(end(path).kind, 1);
  // Settings for outlets that don't exist, or deeper than allowed, aren't kept.
  const extra = cleanParams('pipe', { s5b1s1Type: 1, s2Type: 8, s2b2s1Type: 1 });
  assert.equal(extra.s5b1s1Type, undefined);
  assert.equal(extra.s2b2s1Type, undefined);
  // T joints inside T joints, past the deepest level: kept down to it, where a joint becomes a straight.
  const deep: Record<string, number> = { s2Type: SEG.tee };
  const prefixes = ['s2b1'];
  for (let d = 1; d <= MAX_BRANCH_DEPTH + 1; d++) { const pre = prefixes[d - 1]; deep[`${pre}s1Type`] = SEG.tee; prefixes.push(`${pre}s1b1`); }
  const kept = cleanParams('pipe', deep);
  for (let d = 1; d < MAX_BRANCH_DEPTH; d++) assert.equal(kept[`${prefixes[d - 1]}s1Type`], SEG.tee, `depth ${d}`);
  assert.equal(kept[`${prefixes[MAX_BRANCH_DEPTH - 1]}s1Type`], SEG.straight, 'at the deepest level a joint becomes a straight');
  assert.equal(kept[`${prefixes[MAX_BRANCH_DEPTH]}s1Type`], undefined);
  assert.equal(MAX_BRANCH_DEPTH, 15);
});

test('a pipe radius is 0.25 m or a multiple of 0.5 m', () => {
  assert.deepEqual([0.25, 0.3, 0.5, 0.75, 1, 1.25, 2.2].map((r) => cleanParams('pipe', { radius: r }).radius), [0.25, 0.25, 0.5, 1, 1, 1.5, 2]);
  assert.equal(cleanParams('pipe', { s2Type: 6, s2Radius: 0.75 }).s2Radius, 1);
  assert.equal(cleanParams('pipeSplitter', { radius: 1.25 }).radius, 1.5);
  assert.equal(snapPipeRadius(0.75, 0.5), 1);
  assert.equal(snapPipeRadius(0.75, 1), 0.5);
  assert.equal(snapPipeRadius(0.5, 0.25), 0.5);
});

test('manifold outlets sit as close as their walls allow, plus the spacing set', () => {
  for (const [radius, wall, spacing] of [[0.25, 1, 0], [0.25, 1, 2], [1, 1, 0], [0.5, 2, 3]]) {
    const p = cleanParams('pipe', { radius, wall, s2Type: SEG.manifold, s2Count: 4, s2Spacing: spacing, s3Type: 0 });
    const outlets = pipePath(p).ends.filter((e) => e.branch > 0).map((e) => e.pos[0]).sort((a, b) => a - b);
    assert.equal(outlets.length, 4);
    const gaps = outlets.slice(1).map((x, k) => x - outlets[k]);
    for (const g of gaps) assert.ok(Math.abs(g - (2 * radius + wall * 0.5 + spacing * 0.5)) < 1e-6, `r ${radius} wall ${wall} spacing ${spacing}: gap ${g}`);
  }
  // At 0, both sides, capped: still sealed, every outlet its own channel joined to the run.
  const s = pipe({ radius: 0.25, s2Type: SEG.manifold, s2Count: 4, s2Sides: 1, s2Spacing: 0, startEnd: 1, finishEnd: 1, branchEnds: 1 });
  const sealed = enclosed(s);
  assert.equal(sealed.length, 1);
  // Older projects (spread over a Length) keep about the same spacing.
  assert.equal(cleanParams('pipe', { radius: 0.25, s2Type: SEG.manifold, s2Len: 10, s2Count: 4 }).s2Spacing, 2);
});

test('up is always +y and left and right are level, after joints, traps and helixes too', () => {
  // A T's branch: a U-trap dipping down, a straight and a turn right: the turn stays level.
  const p = cleanParams('pipe', { s4Type: SEG.tee, s4b1s1Type: SEG.uTrap, s4b1s1Dir: 3, s4b1s2Type: SEG.straight, s4b1s2Len: 6, s4b1s3Type: SEG.turn, s4b1s3Angle: 90, s4b1s3Dir: 1, s5Type: 0 });
  const path = pipePath(p);
  const branch = path.samples.filter((s) => s.branch === 1);
  const end = path.ends.find((e) => e.branch === 1)!;
  assert.ok(Math.abs(end.tan[1]) < 1e-6, `branch end faces ${end.tan}`);
  assert.ok(Math.min(...branch.map((s) => s.pos[1])) < -1, 'the trap dips down');
  assert.ok(Math.abs(end.pos[1]) < 1e-6, 'and comes back up to the branch level');
  // Right of a heading is the same level side wherever the pipe has been: +x heading, right is +z.
  const right = (q: Record<string, number>) => pipePath(cleanParams('pipe', q)).ends.at(-1)!.tan;
  assert.deepEqual(right({ s1Type: SEG.turn, s1Angle: 90, s1Dir: 1, s2Type: 0 }).map(Math.round), [0, 0, 1]);
  // After a helix (its axis along the pipe), a quarter turn up goes the way nearest +y from where the helix left it.
  const before = pipePath(cleanParams('pipe', { s2Type: SEG.helix, s3Type: 0 })).ends.at(-1)!.tan;
  const afterHelix = pipePath(cleanParams('pipe', { s2Type: SEG.helix, s3Type: SEG.turn, s3Angle: 90, s3Dir: 2, s4Type: 0 })).ends.at(-1)!.tan;
  assert.ok(Math.abs(afterHelix[1] - Math.sqrt(1 - before[1] ** 2)) < 1e-3, `after a helix, up faces ${afterHelix} (from ${before})`);
  // Every turn up or down from level points straight up or down.
  for (const [dir, y] of [[2, 1], [3, -1]]) {
    const t = pipePath(cleanParams('pipe', { s2Type: SEG.tee, s2b1s1Type: SEG.turn, s2b1s1Angle: 90, s2b1s1Dir: dir, s3Type: 0 })).ends.find((e) => e.branch === 1)!.tan;
    assert.ok(Math.abs(t[1] - y) < 1e-6, `branch turn ${dir}: ${t}`);
  }
});

test('a pipe branched many levels deep holds its water when capped', () => {
  // Each level: a straight, then a T whose branch turns (alternating sides) and carries on to the next level.
  const p: Record<string, number> = { radius: 0.25, s1Type: SEG.straight, s1Len: 1, s2Type: SEG.tee, s2Len: 2, s3Type: 0, startEnd: 1, finishEnd: 1, branchEnds: 1 };
  let pre = 's2b1';
  for (let d = 1; d <= 6; d++) {
    Object.assign(p, { [`${pre}s1Type`]: SEG.turn, [`${pre}s1Angle`]: 90, [`${pre}s1Dir`]: d % 2, [`${pre}s2Type`]: SEG.straight, [`${pre}s2Len`]: 1.5, [`${pre}s3Type`]: SEG.tee, [`${pre}s3Len`]: 2 });
    pre = `${pre}s3b1`;
  }
  const path = pipePath(cleanParams('pipe', p));
  assert.equal(path.ends.filter((e) => e.branch > 0).length, 7, 'one end for each level of branch');
  const s = pipe(p);
  const sealed = enclosed(s);
  assert.equal(sealed.length, 1, 'one sealed channel');
});
