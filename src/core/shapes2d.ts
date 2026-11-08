import type { NumberParam, ShapeDefinition, UncapEnd } from './shapes';
import { FONTS, FONT_GROUPS, WEIGHT_NAMES, cleanTextParams, fontOf, insideText, layoutText, textHalf, textOf, languagesLabel } from './text';
import { VOXEL_SIZE, type ShapeKind, type Vec3 } from './types';

/**
 * 2D shapes: an outline (a profile in its own u, v plane) that is flat (one block thick) or cylinderized (raised to
 * a thickness). Each lies flat (u along x, v along z, raised along y) or stands upright (u along x, v along y,
 * raised along z). Hollow, a flat one is its outline and a cylinderized one a shell whose faces (and some shapes'
 * other ends) can be uncapped.
 */

type P = Record<string, number>;

/** A 2D outline: its half sizes along u and v, and whether a point of the plane is inside. */
interface Profile {
  kind: ShapeKind;
  label: string;
  params: NumberParam[];
  half(p: P): [number, number];
  inside(p: P, u: number, v: number): boolean;
  /** Stands upright unless set otherwise. */
  standing?: boolean;
  /** Ends besides the two faces that can be uncapped (in the u, v plane). */
  ends?: ProfileEnd[];
  /** No uncapping at all (a grid is open bars already). */
  noUncap?: boolean;
  /** Whether hollow / filled makes no sense with these settings (an arch frame is already a band). */
  solidOnly?: (p: P) => boolean;
  /** Its own heading in the Add menu (2D shapes otherwise). */
  group?: string;
  /** Settings kept besides `params` (see ShapeDefinition). */
  extraParams?: (raw: P, cleaned: P) => P;
}

/** An end of a 2D shape in its own plane: its outward direction (u, v) and how far a point is inside its face. */
interface ProfileEnd {
  key: string;
  label: string;
  short: string;
  normal(p: P): [number, number];
  face(p: P, u: number, v: number): number;
}

const len = (key: string, label: string, def: number, min = 0.5): NumberParam => ({ key, label, unit: 'm', min, max: 64, step: 0.5, default: def });
const deg = (key: string, label: string, def: number, min = 0, max = 360): NumberParam => ({ key, label, unit: '°', min, max, step: 1, default: def });
const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Lying (0) or standing (1). */
export const isStanding = (p: P) => Number(p.orient) === 1;
/** Flat (0) or cylinderized (1). */
export const isPrism = (p: P) => Number(p.prism) === 1;
/** How thick the shape is along its own raise axis, in meters. */
export const thickness = (p: P) => (isPrism(p) ? Number(p.height) : VOXEL_SIZE);
/** A local point (in the shape's frame) in the shape's own u, v plane, and along its raise axis (w). */
export const toUVW = (p: P, [x, y, z]: Vec3): Vec3 => (isStanding(p) ? [x, y, z] : [x, z, y]);
/** A direction in the u, v plane (and w) back in the shape's frame. */
const fromUVW = (p: P, [u, v, w]: Vec3): Vec3 => (isStanding(p) ? [u, v, w] : [u, w, v]);

/** Settings every 2D shape has: lying or standing, flat or cylinderized, and the thickness then. */
export function orientParams(standing: boolean): NumberParam[] {
  return [
    { key: 'orient', label: 'Lies or stands', min: 0, max: 1, step: 1, default: standing ? 1 : 0, segments: ['Lying', 'Standing'], choices: [{ value: 0, label: 'Lying flat' }, { value: 1, label: 'Standing upright' }] },
  ];
}
export const PRISM_PARAMS: NumberParam[] = [
  { key: 'prism', label: 'Shape', min: 0, max: 1, step: 1, default: 0, segments: ['Flat', 'Cylinderized'], choices: [{ value: 0, label: 'Flat (one block thick)' }, { value: 1, label: 'Cylinderized (with a thickness)' }] },
  { ...len('height', 'Thickness (height when lying, depth when standing)', 4), showIf: (p) => isPrism(p) },
];

/** The two faces of a cylinderized 2D shape: bottom and top lying, back and front standing. */
export function faceEnds(): UncapEnd[] {
  const face = (sign: number): UncapEnd => ({
    key: sign < 0 ? 'uncapBottom' : 'uncapTop',
    // The regular polygon called them its bottom and top layer before 0.22.
    legacy: [sign < 0 ? 'removeBottom' : 'removeTop'],
    label: sign < 0 ? 'Bottom (back when standing)' : 'Top (front when standing)',
    short: (p) => (isStanding(p) ? (sign < 0 ? 'Back' : 'Front') : sign < 0 ? 'Bottom' : 'Top'),
    normal: (p) => fromUVW(p, [0, 0, sign]),
    // Only a cylinderized shape taller than one block has faces to open.
    when: (p) => isPrism(p) && Number(p.height) > VOXEL_SIZE,
  });
  return [face(-1), face(1)];
}

function fromProfile(pr: Profile): { def: ShapeDefinition; ends: UncapEnd[] } {
  const def: ShapeDefinition = {
    kind: pr.kind,
    label: pr.label,
    group: pr.group ?? '2D shapes',
    extraParams: pr.extraParams,
    params: [...pr.params, ...orientParams(!!pr.standing), ...PRISM_PARAMS],
    halfExtents: (p) => {
      const [hu, hv] = pr.half(p);
      const t = thickness(p) / 2;
      return isStanding(p) ? [hu, hv, t] : [hu, t, hv];
    },
    inside: (p, pt) => {
      const [u, v, w] = toUVW(p, pt);
      return Math.abs(w) <= thickness(p) / 2 && pr.inside(p, u, v);
    },
    flat: (p) => ({ axis: fromUVW(p, [0, 0, 1]), prism: isPrism(p) }),
    solidOnly: pr.solidOnly,
  };
  const ends = pr.noUncap ? [] : [
    ...faceEnds(),
    ...(pr.ends ?? []).map((e): UncapEnd => ({
      key: e.key, label: e.label, short: () => e.short,
      normal: (p) => { const [a, b] = e.normal(p); return fromUVW(p, [a, b, 0]); },
      face: (p, local) => { const [u, v] = toUVW(p, local); return e.face(p, u, v); },
    })),
  ];
  return { def, ends };
}

// ---------- the outlines ----------

/** Inside a circle of radius r centered at (cu, cv). */
const inCircle = (u: number, v: number, cu: number, cv: number, r: number) => (u - cu) ** 2 + (v - cv) ** 2 <= r * r;

/** A heart outline (the classic sextic), its bounds found once, scaled to width and length. */
const HEART = (() => {
  const f = (x: number, y: number) => (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0;
  let x0 = 0, y0 = Infinity, y1 = -Infinity;
  for (let x = -1.5; x <= 1.5; x += 0.005) for (let y = -1.5; y <= 1.5; y += 0.005) if (f(x, y)) { x0 = Math.max(x0, Math.abs(x)); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { f, hx: x0, y0, y1 };
})();

/** The arch outline at its outer size (or, for a frame, inside it): width, height to the top, and style. */
function archInside(style: number, w: number, top: number, bottom: number, u: number, v: number): boolean {
  if (w <= 0 || v < bottom || v > top) return false;
  const hw = w / 2;
  if (style === 0) {
    // Round: a half circle on legs.
    const s = Math.max(bottom, top - hw);
    return v <= s ? Math.abs(u) <= hw : inCircle(u, v, 0, s, hw);
  }
  if (style === 3) {
    // Horseshoe: a circle wider than the legs, the legs a little narrower than it.
    const r = hw, s = Math.max(bottom, top - r), leg = 0.85 * hw;
    const meet = s - Math.sqrt(Math.max(0, r * r - leg * leg));
    if (v >= meet) return inCircle(u, v, 0, s, r);
    return Math.abs(u) <= leg;
  }
  // Pointed (equilateral, 2) or Tudor (flatter, 1): two arcs meeting at the top.
  const r = style === 2 ? w : 0.75 * w;
  const c = r - hw; // the arcs' centers sit this far beyond the middle on the far side
  const rise = Math.sqrt(Math.max(0, r * r - c * c));
  const s = Math.max(bottom, top - rise);
  if (v <= s) return Math.abs(u) <= hw;
  return inCircle(u, v, -c, s, r) && inCircle(u, v, c, s, r) && Math.abs(u) <= hw;
}

const ARCH_STYLES = [{ value: 0, label: 'Round' }, { value: 2, label: 'Pointed (Gothic)' }, { value: 1, label: 'Tudor (flatter point)' }, { value: 3, label: 'Horseshoe' }];

/** Side counts offered for the regular polygon. */
export const POLYGON_SIDES = [3, 4, 6, 8, 10, 12, 14, 16, 18, 20];

/**
 * Whether a point `t` meters in from one edge of a grid `span` across is on one of its bars: bars `bar` wide, about
 * `cell` apart, the spacing evened out so the bars run edge to edge and mirror each other, each bar on the block grid.
 */
function onBar(t: number, span: number, cell: number, bar: number): boolean {
  const raw = (span - bar) / cell;
  const blocks = (m: number) => Math.round(m / VOXEL_SIZE);
  // An even number of gaps puts a bar in the middle, which only sits on the grid when it and the span are both odd
  // or both even in blocks.
  const fits = (n: number) => n % 2 === 1 || (blocks(span) - blocks(bar)) % 2 === 0;
  const tries = [Math.floor(raw), Math.ceil(raw), Math.floor(raw) - 1, Math.ceil(raw) + 1].filter((n) => n >= 1).sort((x, y) => Math.abs(x - raw) - Math.abs(y - raw));
  const n = tries.find(fits) ?? Math.max(1, Math.round(raw));
  const step = (span - bar) / n;
  const start = (k: number): number => (2 * k <= n ? Math.round((k * step) / VOXEL_SIZE) * VOXEL_SIZE : span - bar - start(n - k));
  const k = Math.max(0, Math.min(n, Math.round(t / step - bar / (2 * step))));
  return [k - 1, k, k + 1].some((j) => j >= 0 && j <= n && t >= start(j) && t < start(j) + bar);
}

const PROFILES: Profile[] = [
  {
    kind: 'polygon', label: 'Regular polygon',
    params: [
      { key: 'sides', label: 'Sides', min: 3, max: 20, step: 1, default: 6, integer: true, choices: POLYGON_SIDES.map((n) => ({ value: n, label: String(n) })) },
      len('radius', 'Radius (center to a corner)', 4),
    ],
    half: (p) => [p.radius, p.radius],
    inside: (p, u, v) => {
      // A corner toward +v; inside when within the inradius of every side.
      const n = Math.max(3, Math.round(p.sides)), inradius = p.radius * Math.cos(Math.PI / n);
      for (let k = 0; k < n; k++) {
        const a = Math.PI / 2 + ((2 * k + 1) * Math.PI) / n;
        if (u * Math.cos(a) + v * Math.sin(a) > inradius + 1e-9) return false;
      }
      return true;
    },
  },
  {
    kind: 'ellipse', label: 'Ellipse / oval',
    params: [len('width', 'Width (across)', 8), len('length', 'Length', 5)],
    half: (p) => [p.width / 2, p.length / 2],
    inside: (p, u, v) => (u / (p.width / 2)) ** 2 + (v / (p.length / 2)) ** 2 <= 1,
  },
  {
    kind: 'ring', label: 'Ring',
    params: [len('outerRadius', 'Outer radius', 5), len('innerRadius', 'Inner radius', 3, 0)],
    half: (p) => [p.outerRadius, p.outerRadius],
    inside: (p, u, v) => { const r = Math.hypot(u, v); return r <= p.outerRadius && r >= Math.min(p.innerRadius, p.outerRadius - VOXEL_SIZE); },
  },
  {
    kind: 'arc', label: 'Arc / sector',
    params: [len('radius', 'Radius', 6), len('innerRadius', 'Inner radius (0 = a pie slice)', 3, 0), deg('start', 'Start angle', 0, -360, 360), deg('sweep', 'Sweep', 120, 1, 360)],
    half: (p) => [p.radius, p.radius],
    inside: (p, u, v) => {
      const r = Math.hypot(u, v);
      if (r > p.radius || r < Math.min(p.innerRadius, p.radius - VOXEL_SIZE)) return false;
      const a = ((Math.atan2(v, u) / DEG - p.start) % 360 + 720) % 360;
      return a <= p.sweep + 1e-9;
    },
    ends: [
      { key: 'uncapStart', label: 'Start end', short: 'Start', normal: (p) => [Math.sin(p.start * DEG), -Math.cos(p.start * DEG)],
        face: (p, u, v) => (u * Math.cos(p.start * DEG) + v * Math.sin(p.start * DEG) > 0 ? -u * Math.sin(p.start * DEG) + v * Math.cos(p.start * DEG) : Infinity) },
      { key: 'uncapEnd', label: 'Far end', short: 'End', normal: (p) => { const b = (p.start + p.sweep) * DEG; return [-Math.sin(b), Math.cos(b)]; },
        face: (p, u, v) => { const b = (p.start + p.sweep) * DEG; return u * Math.cos(b) + v * Math.sin(b) > 0 ? u * Math.sin(b) - v * Math.cos(b) : Infinity; } },
    ],
  },
  {
    kind: 'pill', label: 'Pill (stadium)',
    params: [len('length', 'Length (end to end)', 10), len('width', 'Width', 4)],
    half: (p) => [Math.max(p.length, p.width) / 2, p.width / 2],
    inside: (p, u, v) => { const r = p.width / 2, reach = Math.max(0, p.length / 2 - r); return inCircle(u - clamp(u, -reach, reach), v, 0, 0, r); },
  },
  {
    kind: 'roundedRect', label: 'Rounded rectangle',
    params: [len('width', 'Width (across)', 8), len('length', 'Length', 6), len('corner', 'Corner radius', 1.5, 0)],
    half: (p) => [p.width / 2, p.length / 2],
    inside: (p, u, v) => {
      const a = p.width / 2, b = p.length / 2, r = Math.min(p.corner, a, b);
      if (Math.abs(u) > a || Math.abs(v) > b) return false;
      const du = Math.abs(u) - (a - r), dv = Math.abs(v) - (b - r);
      return du <= 0 || dv <= 0 || du * du + dv * dv <= r * r;
    },
  },
  {
    kind: 'superellipse', label: 'Superellipse (squircle)',
    params: [len('width', 'Width (across)', 8), len('length', 'Length', 8), { key: 'roundness', label: 'Roundness (1 diamond, 2 circle, higher squarer)', min: 0.5, max: 12, step: 0.1, default: 4 }],
    half: (p) => [p.width / 2, p.length / 2],
    inside: (p, u, v) => Math.abs(u / (p.width / 2)) ** p.roundness + Math.abs(v / (p.length / 2)) ** p.roundness <= 1,
  },
  {
    kind: 'crescent', label: 'Crescent', noUncap: true,
    params: [len('radius', 'Radius', 5), len('cutRadius', 'Cut-out radius', 4), { ...len('offset', 'Cut-out offset (toward +u)', 2.5, -64), min: -64 }],
    half: (p) => [p.radius, p.radius],
    inside: (p, u, v) => inCircle(u, v, 0, 0, p.radius) && !inCircle(u, v, p.offset, 0, p.cutRadius),
  },
  {
    kind: 'lens', label: 'Lens (vesica)',
    params: [len('width', 'Width (across)', 4), len('length', 'Length (point to point)', 8)],
    half: (p) => [p.width / 2, p.length / 2],
    inside: (p, u, v) => {
      // Two circles' overlap, set from the width across and the length point to point.
      const R = (p.width / 2 + (p.length * p.length) / (2 * p.width)) / 2, c = R - p.width / 2;
      return inCircle(u, v, -c, 0, R) && inCircle(u, v, c, 0, R);
    },
  },
  {
    kind: 'heart', label: 'Heart', standing: true,
    params: [len('width', 'Width', 8), len('length', 'Length (top to point)', 7.5)],
    half: (p) => [p.width / 2, p.length / 2],
    inside: (p, u, v) => {
      const x = (u / (p.width / 2)) * HEART.hx;
      const y = HEART.y0 + ((v + p.length / 2) / p.length) * (HEART.y1 - HEART.y0);
      return HEART.f(x, y);
    },
  },
  {
    kind: 'teardrop', label: 'Teardrop', standing: true,
    params: [len('width', 'Width', 5), len('length', 'Length (base to tip)', 8)],
    half: (p) => [p.width / 2, p.length / 2],
    inside: (p, u, v) => {
      const a = Math.min(p.width / 2, p.length / 2), c = -p.length / 2 + a, tip = p.length / 2;
      if (inCircle(u, v, 0, c, a)) return true;
      // The straight sides from the tip, touching the round base.
      const d = tip - c;
      if (d <= a) return false;
      const tangent = c + (a * a) / d, slope = a / Math.sqrt(d * d - a * a);
      return v >= tangent && v <= tip && Math.abs(u) <= (tip - v) * slope;
    },
  },
  {
    kind: 'shield', label: 'Shield (heater)', standing: true,
    params: [len('width', 'Width', 6), len('length', 'Height', 7), { key: 'straight', label: 'Straight part of the sides (fraction)', min: 0, max: 0.9, step: 0.05, default: 0.35 }],
    half: (p) => [p.width / 2, p.length / 2],
    inside: (p, u, v) => {
      const hw = p.width / 2, top = p.length / 2, bottom = -p.length / 2;
      if (v > top || v < bottom) return false;
      const knee = top - p.straight * p.length;
      if (v >= knee) return Math.abs(u) <= hw;
      // Curving in to a point at the bottom.
      const t = (knee - v) / (knee - bottom);
      return Math.abs(u) <= hw * Math.sqrt(Math.max(0, 1 - t ** 1.6));
    },
  },
  {
    kind: 'rose', label: 'Rose curve (flower)',
    params: [{ key: 'petals', label: 'Petals', min: 2, max: 24, step: 1, default: 5, integer: true }, len('radius', 'Radius', 6), { key: 'fill', label: 'Petal depth (0 deep, 0.9 shallow)', min: 0, max: 0.9, step: 0.05, default: 0.15 }],
    half: (p) => [p.radius, p.radius],
    inside: (p, u, v) => {
      const r = Math.hypot(u, v), a = Math.atan2(v, u);
      return r <= p.radius * (p.fill + (1 - p.fill) * Math.abs(Math.cos((p.petals * (a - Math.PI / 2)) / 2)));
    },
  },
  {
    kind: 'leaf', label: 'Leaf',
    params: [len('width', 'Width', 4), len('length', 'Length (stem to tip)', 9)],
    half: (p) => [p.width / 2, p.length / 2],
    inside: (p, u, v) => {
      const t = (v + p.length / 2) / p.length;
      if (t < 0 || t > 1) return false;
      // Widest a third of the way up, rounded at the stem and drawn to a point at the tip.
      return Math.abs(u) <= (p.width / 2) * Math.sin(Math.PI * t ** 0.75) * (t < 0.08 ? Math.sqrt(t / 0.08) : 1);
    },
  },
  {
    kind: 'arch', label: 'Arch outline', standing: true,
    params: [
      { key: 'archMode', label: 'Arch', min: 0, max: 1, step: 1, default: 0, segments: ['Frame', 'Silhouette'], choices: [{ value: 0, label: 'Frame (a band round the opening)' }, { value: 1, label: 'Silhouette (the opening itself)' }] },
      { key: 'style', label: 'Style', min: 0, max: 3, step: 1, default: 0, choices: ARCH_STYLES },
      len('width', 'Width (outside)', 4), len('length', 'Height (outside)', 6),
      { ...len('frame', 'Frame thickness', 1), showIf: (p) => Number(p.archMode) === 0 },
    ],
    half: (p) => [p.width / 2, p.length / 2],
    inside: (p, u, v) => {
      const top = p.length / 2, bottom = -p.length / 2;
      if (!archInside(p.style, p.width, top, bottom, u, v)) return false;
      if (Number(p.archMode) === 1) return true;
      // A frame: the outline less the opening, open at the bottom.
      return !archInside(p.style, p.width - 2 * p.frame, top - p.frame, bottom - 1, u, v);
    },
    // A flat frame is already a band; a cylinderized one is a thick band, which can be hollow like any other.
    solidOnly: (p) => Number(p.archMode) === 0 && !isPrism(p),
    ends: [{ key: 'uncapBase', label: 'Base (the sill)', short: 'Base', normal: () => [0, -1], face: (p, _u, v) => v + p.length / 2 }],
  },
  {
    kind: 'grid', label: 'Grid / lattice', standing: true, noUncap: true,
    params: [
      len('width', 'Width (across)', 6), len('length', 'Length', 6), len('cell', 'Cell size (bar to bar)', 1.5, 1), len('bar', 'Bar width', 0.5),
      { key: 'diagonal', label: 'Bars', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: 'Square' }, { value: 1, label: 'Diagonal (diamond lattice)' }] },
    ],
    half: (p) => [p.width / 2, p.length / 2],
    inside: (p, u, v) => {
      const a = p.width / 2, b = p.length / 2;
      if (Math.abs(u) > a || Math.abs(v) > b) return false;
      // A border all round, and bars every cell size.
      if (Math.abs(u) > a - p.bar || Math.abs(v) > b - p.bar) return true;
      if (Number(p.diagonal) === 1) {
        const m = (t: number) => ((t % p.cell) + p.cell) % p.cell;
        return m((u + v) / Math.SQRT2) < p.bar || m((u - v) / Math.SQRT2) < p.bar;
      }
      return onBar(u + a, 2 * a, p.cell, p.bar) || onBar(v + b, 2 * b, p.cell, p.bar);
    },
  },
  {
    kind: 'gear', label: 'Gear / cog', standing: true,
    params: [
      { key: 'teeth', label: 'Teeth', min: 3, max: 64, step: 1, default: 12, integer: true },
      len('radius', 'Radius (to the tooth tips)', 6), len('toothDepth', 'Tooth depth', 1), { key: 'toothWidth', label: 'Tooth width (fraction of the spacing)', min: 0.1, max: 0.9, step: 0.05, default: 0.5 },
      len('hole', 'Center hole radius (0 = none)', 1, 0),
    ],
    half: (p) => [p.radius, p.radius],
    inside: (p, u, v) => {
      const r = Math.hypot(u, v);
      if (r > p.radius || r < p.hole) return false;
      if (r <= p.radius - p.toothDepth) return true;
      const f = (((Math.atan2(v, u) / (2 * Math.PI)) * p.teeth) % 1 + 1) % 1;
      return Math.abs(f - 0.5) <= p.toothWidth / 2;
    },
  },
  {
    // Block text in a built-in font (text.ts). Standing by default, like a sign; lying, it reads from above.
    kind: 'text', label: 'Text', group: 'Text', standing: true,
    params: [
      { key: 'font', label: 'Font', min: 0, max: FONTS.length - 1, step: 1, default: Math.max(0, FONTS.findIndex((f) => f.id === 'bungee')), integer: true,
        choices: FONTS.map((f, i) => ({ value: i, label: `${f.name} (${languagesLabel(f)})`, group: FONT_GROUPS[f.group] })) },
      { key: 'weight', label: 'Weight', min: 100, max: 900, step: 100, default: 900, integer: true,
        choices: Object.entries(WEIGHT_NAMES).map(([w, label]) => ({ value: Number(w), label })),
        choicesFor: (p) => fontOf(p).weights.map((w) => ({ value: w.weight, label: WEIGHT_NAMES[w.weight] ?? String(w.weight) })),
        showIf: (p) => fontOf(p).weights.length > 1 },
      { key: 'size', label: 'Letter height (capitals; pixel fonts step by their own pixels)', unit: 'blocks', min: 2, max: 200, step: 1, default: 10, integer: true },
      { key: 'spacing', label: 'Extra space between letters', unit: 'blocks', min: -4, max: 40, step: 1, default: 0, integer: true },
      { key: 'lineSpacing', label: 'Extra space between lines', unit: 'blocks', min: -20, max: 40, step: 1, default: 1, integer: true, showIf: (p) => textOf(p).includes('\n') },
      { key: 'align', label: 'Lines line up', min: 0, max: 3, step: 1, default: 1, integer: true, showIf: (p) => textOf(p).includes('\n'),
        segments: ['Left', 'Center', 'Right', 'Justify'],
        choices: [{ value: 0, label: 'On the left' }, { value: 1, label: 'In the middle' }, { value: 2, label: 'On the right' }, { value: 3, label: 'Justified: every line but the last stretched to the full width, between words' }] },
    ],
    half: (p) => textHalf(p),
    // In blocks from the middle; lying, v runs the other way so the text reads from above.
    inside: (p, u, v) => insideText(layoutText(p), u / VOXEL_SIZE, (isStanding(p) ? v : -v) / VOXEL_SIZE),
    extraParams: (raw) => cleanTextParams(raw),
  },
];

/** The 2D shapes made from outlines, and their uncap ends. */
export const PROFILE_SHAPES = PROFILES.map(fromProfile);
