import type { Vec3 } from './types';

/**
 * Patterns: a second material laid across a shape's blocks (the shape's own material for the rest). They choose
 * materials only; the blocks are the shape's. Worked out per block from where it is in the shape's own frame (so a
 * pattern moves and turns with its shape), in blocks from the shape's middle.
 *
 * Most patterns are flat, drawn on a plane. On the skin (Auto for a 3D shape, or Skin) each block on the surface
 * takes the pattern of the face it shows on, as far in as Depth says, the inside staying plain; on a 2D shape Auto
 * is its own face. Top, Front and Side draw it on that plane, running straight through the shape. 3D gives
 * checkerboard, rings and polygons in three dimensions (cubes, spherical shells, nested boxes); the other patterns
 * use Auto then.
 */

export const PATTERNS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Checkerboard' },
  { value: 2, label: 'Stripes' },
  { value: 3, label: 'Rings' },
  { value: 4, label: 'Concentric polygons' },
  { value: 5, label: 'Spiral' },
  { value: 6, label: 'Maze' },
  { value: 7, label: 'Flagstones' },
  { value: 8, label: 'Herringbone' },
  { value: 9, label: 'Basketweave' },
] as const;

export const enum Pattern { None, Checker, Stripes, Rings, Polygons, Spiral, Maze, Flagstones, Herringbone, Basketweave }

/** The plane setting: 0 Auto, 1 Top, 2 Front, 3 Side, 4 3D. */
export const PLANES = ['Auto', 'Top', 'Front', 'Side', '3D', 'Skin'];

/** Whether a shape's pattern goes on its skin: Skin, or Auto on a 3D shape (`flat`: a 2D shape). */
export const onSkin = (p: P, flat: boolean) => { const plane = Math.round(p.patternPlane ?? 0); return plane === 5 || (plane === 0 && !flat); };

type P = Record<string, number>;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** A small, repeatable hash of whole numbers to 0..1 (stone positions, the maze's turns). */
function hash(a: number, b: number, seed: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The axes (in the shape's frame) a flat pattern is drawn on: [across, up], and the one it runs through. */
export function patternAxes(p: P, flatNormal?: Vec3, faceAxis?: number): { u: number; v: number; w: number } {
  const plane = Math.round(p.patternPlane ?? 0);
  let w = 1; // Top: drawn on x and z, through y
  if (faceAxis !== undefined) w = faceAxis; // on the skin: the face the block shows on
  else if (plane === 2) w = 2; // Front: x and y, through z
  else if (plane === 3) w = 0; // Side: z and y, through x
  else if (plane === 0 && flatNormal) w = [0, 1, 2].reduce((m, a) => (Math.abs(flatNormal[a]) > Math.abs(flatNormal[m]) ? a : m), 0);
  const [u, v] = w === 0 ? [2, 1] : w === 1 ? [0, 2] : [0, 1];
  return { u, v, w };
}

/** Maze walls on a grid (true = wall): rooms on odd cells, opened by a depth-first walk from a corner. */
const mazes = new Map<string, Uint8Array>();
function maze(cols: number, rows: number, seed: number): Uint8Array {
  const key = `${cols},${rows},${seed}`;
  const hit = mazes.get(key);
  if (hit) return hit;
  const wall = new Uint8Array(cols * rows).fill(1);
  const rx = Math.floor((cols - 1) / 2), ry = Math.floor((rows - 1) / 2);
  if (rx > 0 && ry > 0) {
    const seen = new Uint8Array(rx * ry);
    const stack: [number, number][] = [[0, 0]];
    seen[0] = 1;
    wall[1 * cols + 1] = 0;
    let step = 0;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < rx && ny < ry && !seen[ny * rx + nx];
      });
      if (!next.length) { stack.pop(); continue; }
      const [dx, dy] = next[Math.floor(hash(step++, x * 7919 + y, seed) * next.length)];
      const nx = x + dx, ny = y + dy;
      seen[ny * rx + nx] = 1;
      wall[(2 * y + 1 + dy) * cols + (2 * x + 1 + dx)] = 0;
      wall[(2 * ny + 1) * cols + (2 * nx + 1)] = 0;
      stack.push([nx, ny]);
    }
  }
  if (mazes.size > 32) mazes.clear();
  mazes.set(key, wall);
  return wall;
}

/**
 * Whether a block takes the pattern's material. `at` is the block's middle in the shape's frame, in blocks from the
 * shape's middle; `half` the shape's half size in blocks (for the maze, which fills the shape's box); `flatNormal` a
 * 2D shape's face direction (for Auto).
 */
export function patternAt(p: P, at: Vec3, half: Vec3, flatNormal?: Vec3, faceAxis?: number): boolean {
  const kind = Math.round(p.pattern ?? 0) as Pattern;
  if (kind === Pattern.None) return false;
  const solid3D = Math.round(p.patternPlane ?? 0) === 4;
  const { u: au, v: av, w: aw } = patternAxes(solid3D ? { ...p, patternPlane: 0 } : p, flatNormal, faceAxis);
  const u = at[au], v = at[av], w = at[aw];
  switch (kind) {
    case Pattern.Checker: {
      const s = Math.max(1, p.checkSize ?? 2);
      const n = Math.floor(u / s) + Math.floor(v / s) + (solid3D ? Math.floor(w / s) : 0);
      return mod(n, 2) === 1;
    }
    case Pattern.Stripes: {
      const dir = Math.round(p.stripeDir ?? 0);
      if (dir === 4) {
        // Swirl: stripes from pole to pole round the shape's axis (its up, unless Laid on says Front or Side),
        // each turning `twist` times from bottom to top; they close in at the poles.
        const pole = patternAxes(p, flatNormal).w;
        const [a, b] = pole === 0 ? [2, 1] : pole === 1 ? [0, 2] : [0, 1];
        const around = Math.atan2(at[b], at[a]) / (2 * Math.PI);
        const t = (at[pole] + half[pole]) / Math.max(1e-9, 2 * half[pole]);
        const count = Math.max(1, Math.round(p.swirlCount ?? 8));
        const phase = count * (around - (p.swirlDir ?? 1) * (p.swirlTwist ?? 0.5) * t);
        return mod(phase, 1) < (p.swirlShare ?? 30) / 100;
      }
      const s = Math.max(1, p.stripeWidth ?? 2);
      const t = dir === 0 ? v : dir === 1 ? u : dir === 2 ? (u + v) / Math.SQRT2 : (u - v) / Math.SQRT2;
      return mod(Math.floor(t / s), 2) === 1;
    }
    case Pattern.Rings: {
      const s = Math.max(1, p.ringWidth ?? 2);
      const r = solid3D ? Math.hypot(u, v, w) : Math.hypot(u, v);
      return mod(Math.floor(r / s), 2) === 1;
    }
    case Pattern.Polygons: {
      const s = Math.max(1, p.ringWidth ?? 2);
      const sides = Math.max(3, Math.round(p.polySides ?? 4));
      let r: number;
      if (solid3D) r = Math.max(Math.abs(u), Math.abs(v), Math.abs(w));
      else {
        // Distance in a regular polygon's terms: the furthest of its sides' directions (a flat side square to v).
        r = 0;
        for (let k = 0; k < sides; k++) {
          const a = (2 * Math.PI * k) / sides + Math.PI / 2 + (sides % 2 ? 0 : Math.PI / sides);
          r = Math.max(r, u * Math.cos(a) + v * Math.sin(a));
        }
      }
      return mod(Math.floor(r / s), 2) === 1;
    }
    case Pattern.Spiral: {
      const s = Math.max(1, p.spiralWidth ?? 2);
      const arms = Math.max(1, Math.round(p.spiralArms ?? 1));
      const turn = (p.spiralDir ?? 1) >= 0 ? 1 : -1;
      const r = Math.hypot(u, v), a = Math.atan2(v, u) * turn;
      // Each arm's turns are 2 x width x arms apart, so bands and gaps are each `width` wide.
      const phase = r / (2 * s) - (arms * a) / (2 * Math.PI);
      return mod(phase, 1) >= 0.5;
    }
    case Pattern.Maze: {
      const s = Math.max(1, p.mazePath ?? 2);
      const hu = half[au], hv = half[av];
      const cols = Math.max(3, Math.floor((2 * hu) / s)), rows = Math.max(3, Math.floor((2 * hv) / s));
      // The maze's grid, centred on the shape; outside it is wall.
      const x = Math.floor((u + (cols * s) / 2) / s), y = Math.floor((v + (rows * s) / 2) / s);
      if (x < 0 || y < 0 || x >= cols || y >= rows) return true;
      return maze(cols, rows, Math.round(p.mazeSeed ?? 1))[y * cols + x] === 1;
    }
    case Pattern.Flagstones: {
      const s = Math.max(2, p.stoneSize ?? 6);
      const joint = Math.max(0.5, p.jointWidth ?? 1);
      const seed = Math.round(p.stoneSeed ?? 1);
      // A stone round a point jittered in each grid square; joints where two stones meet (near their bisector).
      const gx = Math.floor(u / s), gy = Math.floor(v / s);
      const pts: [number, number][] = [];
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        const cx = gx + i, cy = gy + j;
        pts.push([(cx + 0.15 + 0.7 * hash(cx, cy, seed)) * s, (cy + 0.15 + 0.7 * hash(cy, cx, seed + 17)) * s]);
      }
      let best = 0, bd = Infinity;
      pts.forEach(([x, y], k) => { const d = (u - x) ** 2 + (v - y) ** 2; if (d < bd) { bd = d; best = k; } });
      const [bx, by] = pts[best];
      for (let k = 0; k < pts.length; k++) {
        if (k === best) continue;
        const [x, y] = pts[k];
        const len = Math.hypot(x - bx, y - by);
        const toBisector = ((u - x) ** 2 + (v - y) ** 2 - bd) / (2 * len);
        if (toBisector < joint / 2) return true;
      }
      return false;
    }
    case Pattern.Herringbone: {
      // Bricks `ratio` long and `width` wide in zigzags. On the grid of brick widths the bricks come in pairs, one
      // lengthwise from (0, 0) and one upright above it from (0, 1), repeated by (1, 1) and (ratio, -ratio): a cell
      // is in a lengthwise brick when (x - y) mod 2 x ratio is below ratio, and m along it; otherwise upright.
      const s = Math.max(1, p.brickWidth ?? 2);
      const n = Math.max(2, Math.round(p.brickRatio ?? 2));
      const x = Math.floor(u / s), y = Math.floor(v / s);
      const m = mod(x - y, 2 * n), lengthwise = m < n;
      // Two-tone: lengthwise bricks in one material, upright ones in the other (zigzag bands, the usual two-tone look).
      if ((p.brickStyle ?? 1) === 0) return !lengthwise;
      // Joints: each brick's first block along its length and along its width.
      const bx = Math.floor(u) - x * s, by = Math.floor(v) - y * s;
      return lengthwise ? (m === 0 && bx === 0) || by === 0 : (m === n + n - 1 && by === 0) || bx === 0;
    }
    case Pattern.Basketweave: {
      // Squares of `ratio` bricks side by side, turning a quarter each square.
      const s = Math.max(1, p.brickWidth ?? 2);
      const n = Math.max(2, Math.round(p.brickRatio ?? 2));
      const x = Math.floor(u / s), y = Math.floor(v / s);
      const sx = Math.floor(x / n), sy = Math.floor(y / n);
      const across = mod(sx + sy, 2) === 0;
      // Two-tone: the bricks in each square alternate.
      if ((p.brickStyle ?? 1) === 0) return mod(across ? y : x, 2) === 1;
      const bx = Math.floor(u) - x * s, by = Math.floor(v) - y * s;
      return across ? by === 0 || (mod(x, n) === 0 && bx === 0) : bx === 0 || (mod(y, n) === 0 && by === 0);
    }
    default:
      return false;
  }
}
