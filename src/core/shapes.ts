import { POLYHEDRA, insideFrame, insideSolid, placeSolid, type PlacedSolid } from './polyhedra';
import { FONTS, FONT_GROUPS } from './text';
import { PATTERNS } from './patterns';
import { CUSTOM_ANGLE, DEFAULT_EDGE_MATERIAL, DEFAULT_ROOF_MATERIAL, DEFAULT_INNER_MATERIAL, RECEDE_BOTH_ENDS, RECEDE_NEGATIVE_END, RECEDE_NO_ENDS, RECEDE_POSITIVE_END, RISE_RUN, isDoubleRoof, isTripleRoof, ROOF_ARMS, SET_BY_HEIGHT, armLegacyKeys, armShiftLimits, armShiftSaved, joinedUsesBlocks, roofLocalSize, type ArmField, type JoinedKind, type RoofKind } from './roofs';
import { VOXEL_SIZE, type ShapeKind, type Vec3 } from './types';
import { PROFILE_SHAPES, orientParams } from './shapes2d';
import { BRANCHING, END, END_LABELS, MAX_BRANCH_DEPTH, SEG, SEGMENTS, SEG_LABELS, branchDepth, branchPrefix, chainSegments, outletCount, pipeBox, splitterPipe } from './pipes';
import { GABLE_UNDER_GABLE, GABLE_UNDER_SHED, MAX_INSET, fromJunction, gableHalfExtents, gableInside } from './gables';

/**
 * Every shape is described in its own local space: centered at the origin, unrotated, y up.
 * - inside: is this local point inside the solid shape?
 * - halfExtents: half the size of a box around the origin that contains the whole shape.
 * Hollow walls, line weight, placement and combining are handled elsewhere, so they work for every shape.
 */

export interface NumberParam {
  key: string;
  label: string;
  /** Shown after the label, e.g. "m". */
  unit?: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Whole numbers only. */
  integer?: boolean;
  /** Shown as a dropdown instead of a number box. */
  choices?: { value: number; label: string; group?: string }[];
  /** The choices that apply with the shape's other settings (a font's own weights); the nearest is shown and used. */
  choicesFor?: (p: Record<string, number>) => { value: number; label: string; group?: string }[];
  /**
   * A roof length along a ridge: counted in pieces (whole numbers, as min/max say) or, when the roof's `units` is
   * meters, in meters down to 0.5 (up to max x 4).
   */
  length?: boolean;
  /** Shown in the editor only when this says so (other settings make it irrelevant otherwise). */
  showIf?: (p: Record<string, number>) => boolean;
  /** Left unset when missing (no default is filled in); the shape works out a value itself. */
  optional?: boolean;
  /** Older keys this setting is read from when it is missing, for projects saved by earlier versions. */
  legacy?: string[];
  /** A heading the editor shows above this field and the ones after it that share it. */
  group?: string;
  /** Works the value out from older settings when it is missing (for a setting saved differently before). */
  fromLegacy?: (p: Record<string, number>) => number | undefined;
  /** Shown as a row of toggle buttons (one per choice, these short labels) instead of a pull-down. */
  segments?: string[];
  /** Only for hollow shapes (opening an end makes no sense on a filled one): hidden and ignored when filled. */
  hollowOnly?: boolean;
  /** Limits that depend on the shape's other settings, applied on top of min and max. */
  limits?: (p: Record<string, number>) => { min: number; max: number };
  /** Only some values are allowed (a pipe's radius: 0.25, or 0.5 m steps): the nearest one, or the next one past `prev` in the way it moved. */
  snap?: (v: number, prev?: number) => number;
}

type P = Record<string, number>;

/** A spheroid's six ends: the setting that uncaps each, and its label. */
export const SPHEROID_ENDS: [string, string][] = [
  ['uncapNX', 'End toward -x'], ['uncapPX', 'End toward +x'], ['uncapNY', 'Bottom (-y)'],
  ['uncapPY', 'Top (+y)'], ['uncapNZ', 'End toward -z'], ['uncapPZ', 'End toward +z'],
];


const ENDS = [{ value: 0, label: 'Gable' }, { value: 1, label: 'Hip' }];

/**
 * Double thick: a second layer under the roof in its own material, optionally receded one block. `ends` says which
 * gable ends the receded layer can keep flush: both separately (gables and sheds), all at once (L, T and cross roofs,
 * whose arms end in gables), or none (hips have no gable ends).
 */
function doubleParams(ends: 'two' | 'all' | 'none'): NumberParam[] {
  const receded = (p: P) => isDoubleRoof(p) && Number(p.recede) === 1;
  const endChoices = ends === 'two'
    ? [{ value: RECEDE_BOTH_ENDS, label: 'Both ends' }, { value: RECEDE_NO_ENDS, label: 'Neither end' }, { value: RECEDE_NEGATIVE_END, label: 'Only the -x / -z end' }, { value: RECEDE_POSITIVE_END, label: 'Only the +x / +z end' }]
    : [{ value: RECEDE_BOTH_ENDS, label: 'Yes' }, { value: RECEDE_NO_ENDS, label: 'No' }];
  const edged = (p: P) => Number(p.edging) === 1;
  const yesNo = [{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }];
  return [
    // Roof edging: the roof's pieces (or a block roof's blocks) along its edges in another material.
    { key: 'edging', label: 'Edging', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: 'None' }, { value: 1, label: 'Another material along the edges' }] },
    { key: 'edgeMaterial', label: 'Edging material', min: 0, max: 4294967295, step: 1, default: DEFAULT_EDGE_MATERIAL, integer: true, showIf: edged },
    { key: 'edgeRidge', label: 'Edging along the ridge', min: 0, max: 1, step: 1, default: 1, choices: yesNo, showIf: edged },
    { key: 'edgeEaves', label: 'Edging along the eaves', min: 0, max: 1, step: 1, default: 1, choices: yesNo, showIf: edged },
    ...(ends === 'none' ? [] : [{ key: 'edgeSides', label: 'Edging along the gable ends', min: 0, max: 1, step: 1, default: 0, choices: yesNo, showIf: edged }]),
    { key: 'double', label: 'Layers', min: 0, max: 2, step: 1, default: 0, choices: [{ value: 0, label: 'Single' }, { value: 1, label: 'Double thick' }, { value: 2, label: 'Triple thick (two layers of roof material)' }] },
    { key: 'innerMaterial', label: 'Inside material', min: 0, max: 4294967295, step: 1, default: DEFAULT_INNER_MATERIAL, integer: true, showIf: (p) => isDoubleRoof(p) },
    { key: 'innerDrop', label: 'Inside layer drop', unit: 'blocks', min: 0, max: 5, step: 1, default: 1, integer: true, showIf: (p) => isDoubleRoof(p) },
    { key: 'recede', label: 'Recede bottom layer', min: 0, max: 1, step: 1, default: 0, showIf: (p) => isDoubleRoof(p),
      choices: [{ value: 0, label: 'No (layers flush)' }, { value: 1, label: 'One block from the edges' }] },
    ...(ends === 'none' ? [] : [
      { key: 'recedeEnds', label: ends === 'two' ? 'Inside layer recedes at gable ends' : 'Inside layer recedes at the arms\' gable ends', min: 0, max: 3, step: 1, default: RECEDE_BOTH_ENDS, showIf: receded, choices: endChoices },
      // Triple thick: the second layer of roof material recedes with the inside layer, with its own gable ends.
      { key: 'recedeEnds2', label: ends === 'two' ? 'Second roof layer recedes at gable ends' : 'Second roof layer recedes at the arms\' gable ends', min: 0, max: 3, step: 1, default: RECEDE_BOTH_ENDS, showIf: (p: P) => receded(p) && isTripleRoof(p), choices: endChoices },
    ]),
  ];
}

const STANDARD_ANGLES = [{ value: 45, label: '45° (roof pieces)' }, { value: 22.5, label: '22.5° (blocks)' }, { value: 33.3, label: '33.3° (blocks)' }, { value: 67.5, label: '67.5° (blocks)' }, { value: SET_BY_HEIGHT, label: 'Set by height (blocks)' }];
const ANGLE_PARAM: NumberParam = { key: 'angle', label: 'Roof angle', min: 0, max: 67.5, step: 0.1, default: 45, choices: STANDARD_ANGLES };
/** Gables and sheds also take any angle, or a pitch as rise over run (both built from blocks, as close as the size allows). */
const ANGLE_PARAM_PITCH: NumberParam = {
  ...ANGLE_PARAM, min: RISE_RUN,
  choices: [...STANDARD_ANGLES, { value: CUSTOM_ANGLE, label: 'Custom angle (blocks)' }, { value: RISE_RUN, label: 'Rise / run (blocks)' }],
};

/**
 * Each arm of an L, T or cross roof: length past the junction, width (rows of pieces, or meters when the roof is
 * built from blocks), height, sideways offset and end. Width and height in meters are left unset until edited; the
 * roof works them out from the rows (see armSizes in roofs.ts).
 */
function armParams(kind: JoinedKind): NumberParam[] {
  return ROOF_ARMS[kind].flatMap((arm) => {
    const legacy = (field: ArmField) => armLegacyKeys(arm, field);
    const blocks = (p: P) => joinedUsesBlocks(kind, p);
    const shift: NumberParam[] = arm.noShift ? [] : [
      {
        key: `${arm.key}Shift`, label: 'Offset sideways', unit: 'm', min: -128, max: 128, step: 0.5, default: 0, optional: true, group: arm.label,
        // Always meters; limited to the length of the arms it joins (see armShiftLimits in roofs.ts).
        fromLegacy: (p: P) => (p[`${arm.key}Off`] === undefined ? undefined : armShiftSaved(p, arm)),
        limits: (p: P) => armShiftLimits(kind, p, ROOF_ARMS[kind].indexOf(arm)),
      },
    ];
    return [
      { ...ANGLE_PARAM, key: `${arm.key}Angle`, label: 'Angle', legacy: legacy('Angle'), group: arm.label },
      { key: `${arm.key}Len`, label: 'Length past the junction', unit: 'pieces', min: 1, max: 32, step: 1, default: arm.fallbackLength, integer: true, length: true, legacy: legacy('Len'), group: arm.label },
      { key: `${arm.key}Rows`, label: 'Width (rows up each slope)', min: 1, max: 8, step: 1, default: 1, integer: true, legacy: legacy('Rows'), group: arm.label, showIf: (p: P) => !blocks(p) },
      { key: `${arm.key}Width`, label: 'Width', unit: 'm', min: 2, max: 66, step: 0.5, default: 5, optional: true, group: arm.label, showIf: blocks },
      { key: `${arm.key}Height`, label: 'Height', unit: 'm', min: 1, max: 64, step: 0.5, default: 4, optional: true, legacy: legacy('Height'), group: arm.label },
      ...shift,
      { key: `${arm.key}End`, label: 'End', min: 0, max: 1, step: 1, default: 0, choices: ENDS, legacy: legacy('End'), group: arm.label },
    ];
  });
}

export interface ShapeDefinition {
  kind: ShapeKind;
  label: string;
  /** Built from game pieces (roofs) rather than blocks; see roofs.ts. */
  pieces?: boolean;
  params: NumberParam[];
  halfExtents(p: P): Vec3;
  inside(p: P, point: Vec3): boolean;
  /** The heading it is listed under when adding shapes. */
  group?: string;
  /** A 2D shape: its raise axis (in its own frame) and whether it is cylinderized (otherwise one block thick). */
  flat?: (p: P) => { axis: Vec3; prism: boolean };
  /** Hollow or filled makes no sense with these settings (it is always built filled). */
  solidOnly?: (p: P) => boolean;
  /** Settings kept besides `params` (cleaned): given the raw settings and the listed ones already cleaned. */
  extraParams?: (raw: P, cleaned: P) => P;
}

/**
 * An end a hollow shape can open (uncap): its setting, its button label, its outward direction in the shape's frame,
 * and (for a face that isn't square to an axis) how far a point is inside it.
 */
export interface UncapEnd {
  key: string;
  label: string;
  short: (p: P) => string;
  normal: (p: P) => Vec3;
  face?: (p: P, local: Vec3) => number;
  /** Older keys it was saved as. */
  legacy?: string[];
  /** Offered only when this says so. */
  when?: (p: P) => boolean;
}

/** A length in meters, 0.5 to 64 m in half-meter steps. */
const len = (label: string, def: number): NumberParam => ({
  key: '', label, unit: 'm', min: 0.5, max: 64, step: 0.5, default: def,
});

function param(key: string, base: NumberParam): NumberParam {
  return { ...base, key };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** The teardrop curve's radius at angle t (0 at the tip, pi at the round end), and its widest, for a point setting. */
const teardropCurve = (t: number, m: number) => Math.sin(t) * Math.sin(t / 2) ** m;
const tearMax = new Map<number, number>();
function teardropMax(m: number): number {
  let best = tearMax.get(m);
  if (best === undefined) {
    best = 0;
    for (let i = 1; i < 2000; i++) best = Math.max(best, teardropCurve((Math.PI * i) / 2000, m));
    tearMax.set(m, best);
  }
  return best;
}
/** A d10's own width across its middle, when set. */
const polyWidth = (p: P) => (p.solid === 3 && p.widthMode === 1 ? p.width : undefined);
/** A polyhedron as its settings place it (see polyhedra.ts). */
export const placedPolyhedron = (p: P): PlacedSolid => placeSolid(p.solid, p.stand, p.height, polyWidth(p), topNumber(p));
/** The numbers a die can show on top (a d4: at its top corner). */
const topChoices = (p: P) => {
  const id = Math.max(0, Math.min(5, Math.round(p.solid ?? 5)));
  const count = POLYHEDRA[id].faces;
  const values = id === 3 ? Array.from({ length: 10 }, (_, i) => i) : Array.from({ length: count }, (_, i) => i + 1);
  return values.reverse().map((v) => ({ value: v, label: id === 3 && v === 0 && p.tenAs === 1 ? '10' : String(v) }));
};
/** The number asked for on top, or the nearest the die has (the highest, to start). */
const topNumber = (p: P): number | undefined => {
  const ok = topChoices(p).map((c) => c.value);
  const want = p.top ?? 20;
  return ok.reduce((b, c) => (Math.abs(c - want) < Math.abs(b - want) || (Math.abs(c - want) === Math.abs(b - want) && c > b) ? c : b), ok[0]);
};
/** The default marking material: Hollow Halls Block, nearly black, to stand out like a die's numbers. */
export const DEFAULT_MARK_MATERIAL = 2041116756;
const marked = (p: P) => p.marks === 1;
const usesFont = (p: P) => marked(p) && !(p.solid === 1 && p.pips === 1);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const DIRECTION: NumberParam['choices'] = [
  { value: 1, label: 'Counter-clockwise' },
  { value: -1, label: 'Clockwise' },
];

/** Box with possibly different bottom and top sizes (a frustum); bottom at y = -h/2. */
function taperedBox(bw: number, bd: number, tw: number, td: number, h: number, [x, y, z]: Vec3): boolean {
  if (Math.abs(y) > h / 2) return false;
  const t = (y + h / 2) / h;
  return Math.abs(x) <= lerp(bw, tw, t) / 2 && Math.abs(z) <= lerp(bd, td, t) / 2;
}

/**
 * Star outline in the x/z plane, first point toward +z.
 * Returns the distance from the center to the star's edge along the direction of (x, z).
 */
function starEdgeRadius(points: number, outer: number, inner: number, x: number, z: number): number {
  const sector = (2 * Math.PI) / points;
  const half = sector / 2;
  let a = Math.atan2(x, z); // 0 along +z
  a = ((a % sector) + sector) % sector;
  const phi = a > half ? sector - a : a; // fold into [0, half]
  // Edge runs from the outer point (outer, 0) to the inner point (inner * cos half, inner * sin half).
  const ox = outer, oy = 0;
  const ix = inner * Math.cos(half), iy = inner * Math.sin(half);
  const ex = ix - ox, ey = iy - oy;
  const dx = Math.cos(phi), dy = Math.sin(phi);
  const denom = dx * ey - dy * ex;
  return (ox * ey - oy * ex) / denom;
}

function starParams(): NumberParam[] {
  return [
    { key: 'points', label: 'Points', min: 3, max: 16, step: 1, default: 5, integer: true },
    param('outerRadius', len('Outer radius', 5)),
    param('innerRadius', len('Inner radius', 2.5)),
  ];
}

const DEFINITIONS: ShapeDefinition[] = [
  {
    kind: 'spheroid',
    label: 'Spheroid',
    params: [
      param('rx', len('Radius x', 4)), param('ry', len('Radius y', 4)), param('rz', len('Radius z', 4)),
    ],
    halfExtents: (p) => [p.rx, p.ry, p.rz],
    inside: (p, [x, y, z]) => (x / p.rx) ** 2 + (y / p.ry) ** 2 + (z / p.rz) ** 2 <= 1,
  },
  {
    kind: 'squashedSphere',
    label: 'Squashed sphere',
    params: [param('radius', len('Radius across', 5)), param('height', len('Height', 4))],
    halfExtents: (p) => [p.radius, p.height / 2, p.radius],
    inside: (p, [x, y, z]) => (x * x + z * z) / (p.radius * p.radius) + (y / (p.height / 2)) ** 2 <= 1,
  },
  {
    kind: 'capsule',
    label: 'Capsule',
    params: [param('radius', len('Radius', 2)), param('length', len('Length (total)', 8))],
    halfExtents: (p) => [p.radius, Math.max(p.length / 2, p.radius), p.radius],
    inside: (p, [x, y, z]) => {
      const reach = Math.max(0, p.length / 2 - p.radius);
      const cy = Math.max(-reach, Math.min(reach, y));
      return x * x + (y - cy) ** 2 + z * z <= p.radius * p.radius;
    },
  },
  {
    kind: 'teardrop3d',
    label: 'Teardrop (3D)',
    params: [
      param('width', len('Width (at the widest)', 6)),
      param('height', len('Height', 9)),
      { key: 'point', label: 'Point (higher: a longer, sharper tip)', min: 0.5, max: 4, step: 0.5, default: 1 },
    ],
    halfExtents: (p) => [p.width / 2, p.height / 2, p.width / 2],
    inside: (p, [x, y, z]) => {
      // The teardrop curve r = sin t * sin(t/2)^m, y = cos t, spun round the vertical: round at the bottom (t = pi),
      // tapering to a point at the top (t = 0); scaled so its widest is the width.
      const yn = y / (p.height / 2);
      if (Math.abs(yn) > 1) return false;
      const t = Math.acos(yn);
      const r = ((p.width / 2) * teardropCurve(t, p.point)) / teardropMax(p.point);
      return x * x + z * z <= r * r;
    },
  },
  {
    kind: 'box',
    label: 'Cube / box',
    params: [param('width', len('Width (x)', 6)), param('height', len('Height (y)', 6)), param('depth', len('Depth (z)', 6))],
    halfExtents: (p) => [p.width / 2, p.height / 2, p.depth / 2],
    inside: (p, [x, y, z]) => Math.abs(x) <= p.width / 2 && Math.abs(y) <= p.height / 2 && Math.abs(z) <= p.depth / 2,
  },
  {
    kind: 'slantedBox',
    label: 'Slanted box (rhomboid)',
    params: [
      param('width', len('Width (x)', 4)),
      param('height', len('Height (y)', 6)),
      param('depth', len('Depth (z)', 4)),
      { key: 'slantX', label: 'Top shift x', unit: 'm', min: -32, max: 32, step: 0.5, default: 2 },
      { key: 'slantZ', label: 'Top shift z', unit: 'm', min: -32, max: 32, step: 0.5, default: 0 },
    ],
    halfExtents: (p) => [p.width / 2 + Math.abs(p.slantX) / 2, p.height / 2, p.depth / 2 + Math.abs(p.slantZ) / 2],
    inside: (p, [x, y, z]) => {
      if (Math.abs(y) > p.height / 2) return false;
      const t = y / p.height; // -0.5 at the bottom, 0.5 at the top
      return Math.abs(x - p.slantX * t) <= p.width / 2 && Math.abs(z - p.slantZ * t) <= p.depth / 2;
    },
  },
  {
    kind: 'cylinder',
    label: 'Cylinder',
    params: [param('radius', len('Radius', 3)), param('height', len('Height', 6))],
    halfExtents: (p) => [p.radius, p.height / 2, p.radius],
    inside: (p, [x, y, z]) => Math.abs(y) <= p.height / 2 && x * x + z * z <= p.radius * p.radius,
  },
  {
    kind: 'cone',
    label: 'Cone / frustum (round)',
    params: [
      param('baseRadius', len('Base radius', 4)),
      { ...param('topRadius', len('Top radius', 0)), min: 0 },
      param('height', len('Height', 6)),
    ],
    halfExtents: (p) => {
      const r = Math.max(p.baseRadius, p.topRadius);
      return [r, p.height / 2, r];
    },
    inside: (p, [x, y, z]) => {
      if (Math.abs(y) > p.height / 2) return false;
      const r = lerp(p.baseRadius, p.topRadius, (y + p.height / 2) / p.height);
      return x * x + z * z <= r * r;
    },
  },
  {
    kind: 'pyramid4',
    label: 'Pyramid, 4-sided',
    params: [
      param('baseWidth', len('Base width (x)', 6)),
      param('baseDepth', len('Base depth (z)', 6)),
      param('height', len('Height', 5)),
      { ...param('topSize', len('Top size', 0)), min: 0 },
    ],
    halfExtents: (p) => [Math.max(p.baseWidth, p.topSize) / 2, p.height / 2, Math.max(p.baseDepth, p.topSize) / 2],
    inside: (p, pt) => taperedBox(p.baseWidth, p.baseDepth, p.topSize, p.topSize, p.height, pt),
  },
  {
    kind: 'frustum',
    label: 'Frustum (cut pyramid)',
    params: [
      param('baseWidth', len('Base width (x)', 6)),
      param('baseDepth', len('Base depth (z)', 6)),
      { ...param('topWidth', len('Top width (x)', 3)), min: 0 },
      { ...param('topDepth', len('Top depth (z)', 3)), min: 0 },
      param('height', len('Height', 4)),
    ],
    halfExtents: (p) => [Math.max(p.baseWidth, p.topWidth) / 2, p.height / 2, Math.max(p.baseDepth, p.topDepth) / 2],
    inside: (p, pt) => taperedBox(p.baseWidth, p.baseDepth, p.topWidth, p.topDepth, p.height, pt),
  },
  {
    kind: 'pyramid3',
    label: 'Pyramid, 3-sided',
    params: [
      param('side', len('Base side length', 7)),
      param('height', len('Height', 5)),
      { ...param('topSize', len('Top side length', 0)), min: 0 },
    ],
    halfExtents: (p) => {
      const s = Math.max(p.side, p.topSize);
      return [s / 2, p.height / 2, s / Math.sqrt(3)];
    },
    inside: (p, [x, y, z]) => {
      if (Math.abs(y) > p.height / 2) return false;
      const side = lerp(p.side, p.topSize, (y + p.height / 2) / p.height);
      const inradius = side / (2 * Math.sqrt(3));
      // Equilateral triangle centered on its centroid, one corner toward +z; outward edge normals at these angles.
      for (const a of [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) {
        if (x * Math.cos(a) + z * Math.sin(a) > inradius + 1e-9) return false;
      }
      return true;
    },
  },
  {
    kind: 'trapezoidPrism',
    label: 'Trapezoid, extruded',
    params: [
      param('bottomWidth', len('Bottom width (x)', 8)),
      { ...param('topWidth', len('Top width (x)', 4)), min: 0 },
      param('height', len('Height (y)', 4)),
      param('depth', len('Depth (z)', 3)),
    ],
    halfExtents: (p) => [Math.max(p.bottomWidth, p.topWidth) / 2, p.height / 2, p.depth / 2],
    inside: (p, [x, y, z]) => {
      if (Math.abs(y) > p.height / 2 || Math.abs(z) > p.depth / 2) return false;
      return Math.abs(x) <= lerp(p.bottomWidth, p.topWidth, (y + p.height / 2) / p.height) / 2;
    },
  },
  {
    kind: 'starExtruded',
    label: 'Star, extruded',
    params: [...starParams(), param('height', len('Height', 2))],
    halfExtents: (p) => [p.outerRadius, p.height / 2, p.outerRadius],
    inside: (p, [x, y, z]) => {
      if (Math.abs(y) > p.height / 2) return false;
      return Math.hypot(x, z) <= starEdgeRadius(p.points, p.outerRadius, p.innerRadius, x, z);
    },
  },
  {
    kind: 'star3d',
    label: 'Star, spiky 3D',
    params: [...starParams(), param('thickness', len('Center thickness', 3))],
    halfExtents: (p) => [p.outerRadius, p.thickness / 2, p.outerRadius],
    inside: (p, [x, y, z]) => {
      const r = Math.hypot(x, z);
      const edge = starEdgeRadius(p.points, p.outerRadius, p.innerRadius, x, z);
      if (r > edge) return false;
      return Math.abs(y) <= (p.thickness / 2) * (1 - r / edge);
    },
  },
  {
    kind: 'helix',
    label: 'Helix',
    params: [
      param('radius', len('Radius (to band center)', 4)),
      param('bandWidth', len('Band width', 2)),
      param('bandThickness', len('Band thickness', 0.5)),
      param('rise', len('Rise per turn', 4)),
      { key: 'turns', label: 'Turns', min: 0.25, max: 20, step: 0.25, default: 2 },
      { key: 'direction', label: 'Direction', min: -1, max: 1, step: 2, default: 1, choices: DIRECTION },
    ],
    halfExtents: (p) => {
      const r = p.radius + p.bandWidth / 2;
      return [r, (p.turns * p.rise + p.bandThickness) / 2, r];
    },
    inside: (p, [x, y, z]) => {
      const r = Math.hypot(x, z);
      if (Math.abs(r - p.radius) > p.bandWidth / 2) return false;
      const angle = Math.atan2(z, x) * (p.direction < 0 ? -1 : 1);
      const s0 = ((angle / (2 * Math.PI)) % 1 + 1) % 1; // fraction of a turn, 0..1
      const yy = y + (p.turns * p.rise) / 2; // 0 at the start of the band
      const k0 = Math.round(yy / p.rise - s0);
      for (let k = k0 - 1; k <= k0 + 1; k++) {
        const s = s0 + k;
        if (s < 0 || s > p.turns) continue;
        if (Math.abs(yy - s * p.rise) <= p.bandThickness / 2) return true;
      }
      return false;
    },
  },
  {
    kind: 'vortex',
    label: 'Flat vortex',
    params: [
      param('outerRadius', len('Outer radius', 8)),
      { ...param('innerRadius', len('Inner radius (open eye)', 1)), min: 0 },
      { key: 'arms', label: 'Arms', min: 1, max: 12, step: 1, default: 3, integer: true },
      { key: 'turns', label: 'Turns', min: 0.25, max: 8, step: 0.25, default: 1 },
      param('armWidth', len('Arm width', 1.5)),
      param('thickness', len('Thickness', 0.5)),
      { key: 'direction', label: 'Direction', min: -1, max: 1, step: 2, default: 1, choices: DIRECTION },
    ],
    halfExtents: (p) => {
      const r = p.outerRadius + p.armWidth / 2;
      return [r, p.thickness / 2, r];
    },
    inside: (p, [x, y, z]) => {
      if (Math.abs(y) > p.thickness / 2) return false;
      const r = Math.hypot(x, z);
      const w = p.armWidth / 2;
      if (r < p.innerRadius - w || r > p.outerRadius + w) return false;
      const sweep = 2 * Math.PI * p.turns;
      const growth = (p.outerRadius - p.innerRadius) / sweep; // radius gained per radian
      const angle = Math.atan2(z, x) * (p.direction < 0 ? -1 : 1);
      const arms = Math.max(1, Math.round(p.arms));
      for (let arm = 0; arm < arms; arm++) {
        const start = ((angle - (2 * Math.PI * arm) / arms) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        for (let theta = start; theta <= sweep + 1e-9; theta += 2 * Math.PI) {
          if (Math.abs(r - (p.innerRadius + growth * theta)) <= w) return true;
        }
      }
      return false;
    },
  },
  {
    kind: 'saddle',
    label: 'Saddle sheet',
    params: [
      param('width', len('Width (x)', 10)),
      param('depth', len('Depth (z)', 10)),
      { ...param('curve', len('Curvature height', 4)), min: 0 },
      param('thickness', len('Thickness', 0.5)),
    ],
    halfExtents: (p) => [p.width / 2, p.curve / 2 + p.thickness / 2, p.depth / 2],
    inside: (p, [x, y, z]) => {
      if (Math.abs(x) > p.width / 2 || Math.abs(z) > p.depth / 2) return false;
      const surface = (p.curve / 2) * ((2 * x / p.width) ** 2 - (2 * z / p.depth) ** 2);
      return Math.abs(y - surface) <= p.thickness / 2;
    },
  },
  {
    kind: 'polyhedron',
    label: 'Polyhedron (Platonic solids, dice)',
    params: [
      { key: 'solid', label: 'Solid', min: 0, max: 5, step: 1, default: 5, integer: true, choices: POLYHEDRA.map((s) => ({ value: s.id, label: `${s.name} (${s.die}, ${s.faces} faces)` })) },
      { key: 'stand', label: 'Stands on', min: 0, max: 2, step: 1, default: 0, integer: true, segments: ['Face', 'Edge', 'Point'], choices: [{ value: 0, label: 'A face, as a die rests' }, { value: 1, label: 'An edge' }, { value: 2, label: 'A point (a corner, or the d10\'s tip)' }] },
      { ...param('height', len('Height as it stands', 8)), min: 1 },
      { key: 'top', label: 'Number on top', min: 0, max: 20, step: 1, default: 20, integer: true, choices: Array.from({ length: 21 }, (_, i) => ({ value: i, label: String(i) })), choicesFor: topChoices, showIf: (p) => p.stand === 0 },
      { key: 'widthMode', label: 'Width (d10)', min: 0, max: 1, step: 1, default: 0, integer: true, segments: ['Natural', 'Custom'], choices: [{ value: 0, label: 'Its usual shape' }, { value: 1, label: 'Set across its middle' }], showIf: (p) => p.solid === 3 },
      { ...param('width', len('Width across the middle', 6)), min: 1, showIf: (p) => p.solid === 3 && p.widthMode === 1 },
      { key: 'frame', label: 'Faces', min: 0, max: 1, step: 1, default: 0, integer: true, segments: ['Closed', 'Wireframe'], choices: [{ value: 0, label: 'Closed (filled or hollow)' }, { value: 1, label: 'Wireframe: only the edges, the faces left open' }] },
      { key: 'edge', label: 'Edge thickness', unit: 'blocks', min: 1, max: 16, step: 1, default: 2, integer: true, showIf: (p) => p.frame === 1 },
      { key: 'marks', label: 'Faces numbered', min: 0, max: 1, step: 1, default: 0, integer: true, group: 'Numbers', segments: ['No', 'Yes'], choices: [{ value: 0, label: 'No numbers' }, { value: 1, label: 'Numbered like a die' }] },
      { key: 'pips', label: 'd6 faces', min: 0, max: 1, step: 1, default: 0, integer: true, group: 'Numbers', segments: ['Numbers', 'Dots'], choices: [{ value: 0, label: 'Numbers' }, { value: 1, label: 'Dots (pips)' }], showIf: (p) => marked(p) && p.solid === 1 },
      { key: 'markFont', label: 'Font', min: 0, max: FONTS.length - 1, step: 1, default: 0, integer: true, group: 'Numbers', choices: FONTS.map((f, i) => ({ value: i, label: f.name, group: FONT_GROUPS[f.group] })), showIf: usesFont },
      { key: 'tenAs', label: 'd10\'s ten', min: 0, max: 1, step: 1, default: 0, integer: true, group: 'Numbers', segments: ['0', '10'], choices: [{ value: 0, label: 'Written 0' }, { value: 1, label: 'Written 10' }], showIf: (p) => usesFont(p) && p.solid === 3 },
      { key: 'markSize', label: 'Size', unit: '%', min: 30, max: 200, step: 5, default: 100, integer: true, group: 'Numbers', showIf: marked },
      { key: 'markDepth', label: 'Depth', unit: 'blocks', min: 1, max: 4, step: 1, default: 1, integer: true, group: 'Numbers', showIf: marked },
      { key: 'markMaterial', label: 'Material', min: 0, max: 4294967295, step: 1, default: DEFAULT_MARK_MATERIAL, integer: true, group: 'Numbers', showIf: marked },
    ],
    halfExtents: (p) => placedPolyhedron(p).half,
    inside: (p, pt) => (p.frame === 1 ? insideFrame(placedPolyhedron(p), pt, p.edge * VOXEL_SIZE) : insideSolid(placedPolyhedron(p), pt)),
    // A wireframe is its own kind of open shape: filled or hollow doesn't apply.
    solidOnly: (p) => p.frame === 1,
  },
  {
    kind: 'roofShed',
    label: 'Roof, shed (one slope)',
    pieces: true,
    params: [
      ANGLE_PARAM_PITCH,
      { key: 'customAngle', label: 'Custom angle', unit: '°', min: 1, max: 89, step: 0.1, default: 30, showIf: (p) => p.angle === CUSTOM_ANGLE },
      { key: 'pitchRise', label: 'Rise', min: 0.5, max: 64, step: 0.5, default: 6, showIf: (p) => p.angle === RISE_RUN },
      { key: 'pitchRun', label: 'Run', min: 0.5, max: 64, step: 0.5, default: 12, showIf: (p) => p.angle === RISE_RUN },
      { key: 'height', label: 'Roof height', unit: 'm', min: 1, max: 64, step: 0.5, default: 4 },
      { key: 'pieceSize', label: 'Piece size', min: 2, max: 4, step: 2, default: 2, choices: [{ value: 2, label: '2 m roof pieces' }, { value: 4, label: '4 m roof pieces' }] },
      { key: 'units', label: 'Lengths in', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: 'Pieces' }, { value: 1, label: 'Meters (0.5 m steps)' }] },
      { key: 'length', label: 'Length', unit: 'pieces', min: 1, max: 32, step: 1, default: 3, integer: true, length: true },
      { key: 'rows', label: 'Rows up the slope', min: 1, max: 8, step: 1, default: 1, integer: true },
      ...doubleParams('two'),
      { key: 'facing', label: 'High side faces', min: 0, max: 270, step: 90, default: 0, choices: [
        { value: 0, label: '-z' }, { value: 90, label: '-x' }, { value: 180, label: '+z' }, { value: 270, label: '+x' }] },
    ],
    halfExtents: (p) => roofHalfExtents('roofShed', p),
    inside: () => false,
  },
  {
    kind: 'roofGable',
    label: 'Roof, gable (two slopes)',
    pieces: true,
    params: [
      ANGLE_PARAM_PITCH,
      { key: 'customAngle', label: 'Custom angle', unit: '°', min: 1, max: 89, step: 0.1, default: 30, showIf: (p) => p.angle === CUSTOM_ANGLE },
      { key: 'pitchRise', label: 'Rise', min: 0.5, max: 64, step: 0.5, default: 6, showIf: (p) => p.angle === RISE_RUN },
      { key: 'pitchRun', label: 'Run', min: 0.5, max: 64, step: 0.5, default: 12, showIf: (p) => p.angle === RISE_RUN },
      { key: 'height', label: 'Roof height', unit: 'm', min: 1, max: 64, step: 0.5, default: 4 },
      { key: 'pieceSize', label: 'Piece size', min: 2, max: 4, step: 2, default: 2, choices: [{ value: 2, label: '2 m roof pieces' }, { value: 4, label: '4 m roof pieces' }] },
      { key: 'units', label: 'Lengths in', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: 'Pieces' }, { value: 1, label: 'Meters (0.5 m steps)' }] },
      { key: 'length', label: 'Length along ridge', unit: 'pieces', min: 1, max: 32, step: 1, default: 3, integer: true, length: true },
      { key: 'rows', label: 'Rows up each slope', min: 1, max: 8, step: 1, default: 1, integer: true },
      { key: 'asym', label: 'Sides', min: 0, max: 2, step: 1, default: 0, choices: [{ value: 0, label: 'Symmetric' }, { value: 1, label: 'Saltbox (one side longer)' }, { value: 2, label: 'Off-center ridge (blocks)' }] },
      { key: 'extraRows', label: 'Extra rows on the long side', min: 1, max: 8, step: 1, default: 1, integer: true, showIf: (p) => p.asym === 1 },
      { key: 'longSide', label: 'Long side', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: '+z side' }, { value: 1, label: '-z side' }], showIf: (p) => p.asym === 1 },
      { key: 'ridgeOffset', label: 'Ridge offset toward +z', unit: 'm', min: -16, max: 16, step: 0.5, default: 1, showIf: (p) => p.asym === 2 },
      ...doubleParams('two'),
      { key: 'facing', label: 'Ridge runs along', min: 0, max: 90, step: 90, default: 0, choices: [
        { value: 0, label: 'x' }, { value: 90, label: 'z' }] },
    ],
    halfExtents: (p) => roofHalfExtents('roofGable', p),
    inside: () => false,
  },
  {
    kind: 'roofHip',
    label: 'Roof, hip or pyramid (four slopes)',
    pieces: true,
    params: [
      ANGLE_PARAM,
      { key: 'height', label: 'Roof height', unit: 'm', min: 1, max: 64, step: 0.5, default: 4 },
      { key: 'pieceSize', label: 'Piece size', min: 2, max: 4, step: 2, default: 2, choices: [{ value: 2, label: '2 m roof pieces' }, { value: 4, label: '4 m roof pieces' }] },
      { key: 'units', label: 'Lengths in', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: 'Pieces' }, { value: 1, label: 'Meters (0.5 m steps)' }] },
      { key: 'length', label: 'Ridge length (0 = pyramid)', unit: 'pieces', min: 0, max: 32, step: 1, default: 2, integer: true, length: true },
      { key: 'rows', label: 'Rows up each slope', min: 1, max: 8, step: 1, default: 1, integer: true },
      { key: 'asym', label: 'Sides', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: 'Symmetric' }, { value: 1, label: 'Saltbox (one side longer)' }] },
      { key: 'extraRows', label: 'Extra rows on the long side', min: 1, max: 8, step: 1, default: 1, integer: true, showIf: (p) => p.asym === 1 },
      { key: 'longSide', label: 'Long side', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: '+z side' }, { value: 1, label: '-z side' }], showIf: (p) => p.asym === 1 },
      ...doubleParams('none'),
      { key: 'facing', label: 'Ridge runs along', min: 0, max: 90, step: 90, default: 0, choices: [
        { value: 0, label: 'x' }, { value: 90, label: 'z' }] },
    ],
    halfExtents: (p) => roofHalfExtents('roofHip', p),
    inside: () => false,
  },
  {
    kind: 'roofL',
    label: 'Roof, L-shaped',
    pieces: true,
    params: [
      { key: 'pieceSize', label: 'Piece size', min: 2, max: 4, step: 2, default: 2, choices: [{ value: 2, label: '2 m roof pieces' }, { value: 4, label: '4 m roof pieces' }] },
      { key: 'units', label: 'Lengths in', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: 'Pieces' }, { value: 1, label: 'Meters (0.5 m steps)' }] },
      ...armParams('roofL'),
      ...doubleParams('all'),
      { key: 'facing', label: 'Turn', min: 0, max: 270, step: 90, default: 0, choices: [
        { value: 0, label: '0°' }, { value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' }] },
    ],
    halfExtents: (p) => roofHalfExtents('roofL', p),
    inside: () => false,
  },
  {
    kind: 'roofT',
    label: 'Roof, T-shaped',
    pieces: true,
    params: [
      { key: 'pieceSize', label: 'Piece size', min: 2, max: 4, step: 2, default: 2, choices: [{ value: 2, label: '2 m roof pieces' }, { value: 4, label: '4 m roof pieces' }] },
      { key: 'units', label: 'Lengths in', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: 'Pieces' }, { value: 1, label: 'Meters (0.5 m steps)' }] },
      ...armParams('roofT'),
      ...doubleParams('all'),
      { key: 'facing', label: 'Turn', min: 0, max: 270, step: 90, default: 0, choices: [
        { value: 0, label: '0°' }, { value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' }] },
    ],
    halfExtents: (p) => roofHalfExtents('roofT', p),
    inside: () => false,
  },
  {
    kind: 'roofCross',
    label: 'Roof, cross-shaped',
    pieces: true,
    params: [
      { key: 'pieceSize', label: 'Piece size', min: 2, max: 4, step: 2, default: 2, choices: [{ value: 2, label: '2 m roof pieces' }, { value: 4, label: '4 m roof pieces' }] },
      { key: 'units', label: 'Lengths in', min: 0, max: 1, step: 1, default: 0, choices: [{ value: 0, label: 'Pieces' }, { value: 1, label: 'Meters (0.5 m steps)' }] },
      ...armParams('roofCross'),
      ...doubleParams('all'),
    ],
    halfExtents: (p) => roofHalfExtents('roofCross', p),
    inside: () => false,
  },
];

/** Half the roof's box, with x and z swapped when it's turned a quarter turn. */
function roofHalfExtents(kind: RoofKind, p: P): Vec3 {
  const [x, y, z] = roofLocalSize(kind, p);
  return (Math.round((p.facing ?? 0) / 90) % 2 === 0 ? [x / 2, y / 2, z / 2] : [z / 2, y / 2, x / 2]) as Vec3;
}

/**
 * Shapes drawn in a plane and raised (the extruded star and trapezoid, the flat vortex) get the 2D shapes' lying /
 * standing setting. `nativeStanding` says how they were built: the other way is a quarter turn about x.
 */
const NATIVE_STANDING: Partial<Record<ShapeKind, boolean>> = { starExtruded: false, vortex: false };
/** New ones start standing even though drawn lying (projects saved before they could stand keep lying). */
const STARTS_STANDING: Partial<Record<ShapeKind, boolean>> = { starExtruded: true };

/** A direction (or point) in a shape's native frame, in its frame as it lies or stands now. */
export function orientPoint(p: P, nativeStanding: boolean, [x, y, z]: Vec3): Vec3 {
  if ((Number(p.orient) === 1) === nativeStanding) return [x, y, z];
  return nativeStanding ? [x, -z, y] : [x, z, -y];
}

/** And back: a point in the shape's frame now, in its native frame. */
function nativePoint(p: P, nativeStanding: boolean, [x, y, z]: Vec3): Vec3 {
  if ((Number(p.orient) === 1) === nativeStanding) return [x, y, z];
  return nativeStanding ? [x, z, -y] : [x, -z, y];
}

// The gable: the wall under one end of a gable or shed roof, worked out from a roof with the settings it copies.
{
  const roof = DEFINITIONS.find((d) => d.kind === 'roofGable')!;
  const from = (key: string, over: Partial<NumberParam> = {}): NumberParam => ({ ...roof.params.find((q) => q.key === key)!, group: 'Roof it fits under', ...over });
  const underGable = (p: P) => Number(p.roofType) !== GABLE_UNDER_SHED;
  const receded = (p: P) => isDoubleRoof(p) && Number(p.recede) === 1;
  const yesNo = [{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }];
  DEFINITIONS.push({
    kind: 'gable',
    label: 'Gable (fills under a roof end)',
    group: 'Roofs',
    params: [
      { key: 'depth', label: 'Thickness', unit: 'blocks', min: 1, max: 16, step: 1, default: 1, integer: true },
      { key: 'end', label: 'Outer face', min: 0, max: 1, step: 1, default: 0, segments: ['−x end', '+x end'], choices: [{ value: 0, label: 'At the -x end of the ridge' }, { value: 1, label: 'At the +x end of the ridge' }] },
      { key: 'inset', label: 'Recede into the roof', unit: 'blocks', min: 0, max: MAX_INSET, step: 1, default: 0, integer: true },
      { key: 'roofEdge', label: 'Blocks touching roof pieces', min: 0, max: 1, step: 1, default: 1, choices: [{ value: 1, label: 'In the roof\'s material (no bleed-through)' }, { value: 0, label: 'In the gable\'s material' }] },
      { key: 'roofType', label: 'Roof', min: 0, max: 1, step: 1, default: GABLE_UNDER_GABLE, group: 'Roof it fits under', segments: ['Gable', 'Shed'], choices: [{ value: GABLE_UNDER_GABLE, label: 'Gable (two slopes)' }, { value: GABLE_UNDER_SHED, label: 'Shed (one slope)' }] },
      { key: 'roofMaterial', label: 'Roof material', min: 0, max: 4294967295, step: 1, default: DEFAULT_ROOF_MATERIAL, integer: true, group: 'Roof it fits under' },
      from('angle'), from('customAngle'), from('pitchRise'), from('pitchRun'), from('height'), from('pieceSize'),
      from('rows', { label: 'Rows up each slope' }),
      from('asym', { showIf: underGable }),
      from('extraRows', { showIf: (p) => underGable(p) && p.asym === 1 }),
      from('longSide', { showIf: (p) => underGable(p) && p.asym === 1 }),
      from('ridgeOffset', { showIf: (p) => underGable(p) && p.asym === 2 }),
      from('double'),
      from('innerMaterial'),
      from('innerDrop'),
      from('recede'),
      { key: 'recedeHere', label: 'Inside layer recedes at this end', min: 0, max: 1, step: 1, default: 1, group: 'Roof it fits under', choices: yesNo, showIf: receded },
      { key: 'recedeHere2', label: 'Second roof layer recedes at this end', min: 0, max: 1, step: 1, default: 1, group: 'Roof it fits under', choices: yesNo, showIf: (p) => receded(p) && isTripleRoof(p) },
      // The roof's edging barely changes the space under it, so it isn't shown; Match a roof still copies it.
      from('edging', { showIf: () => false }), from('edgeMaterial', { showIf: () => false }), from('edgeRidge', { showIf: () => false }),
      from('edgeEaves', { showIf: () => false }), from('edgeSides', { showIf: () => false }),
    ],
    halfExtents: (p) => gableHalfExtents(p),
    inside: (p, pt) => gableInside(p, pt),
    // A wall: always solid (no Filled / Hollow).
    solidOnly: () => true,
  });
  const gable = DEFINITIONS[DEFINITIONS.length - 1];
  // Worked out from an L, T or cross roof's arm: its own gable / shed settings step aside (the roof's material stays).
  for (const q of gable.params) {
    if (q.group !== 'Roof it fits under' || q.key === 'roofMaterial') continue;
    const shown = q.showIf;
    q.showIf = (p) => !fromJunction(p) && (!shown || shown(p));
  }
  gable.params.find((q) => q.key === 'end')!.showIf = (p) => !fromJunction(p);
  // Which roof it is worked out from, and that roof's every setting, kept (not shown) so the gable fits it exactly.
  const hidden = (key: string): NumberParam => ({ key, label: key, min: -1e9, max: 1e9, step: 0.5, default: 0, optional: true, showIf: () => false });
  gable.params.push(
    { key: 'source', label: 'Worked out from', min: 0, max: 1, step: 1, default: 0, showIf: () => false },
    { key: 'srcKind', label: 'Junction roof', min: 0, max: 2, step: 1, default: 1, integer: true, showIf: () => false },
    { key: 'arm', label: 'Arm', min: 0, max: 3, step: 1, default: 0, integer: true, showIf: () => false },
    { key: 'cut', label: 'At the junction', min: 0, max: 1, step: 1, default: 0, integer: true, showIf: () => false },
  );
  const have = new Set(gable.params.map((q) => q.key));
  for (const kind of ['roofL', 'roofT', 'roofCross'] as const) {
    for (const q of DEFINITIONS.find((d) => d.kind === kind)!.params) {
      if (have.has(q.key) || q.key === 'facing') continue;
      have.add(q.key);
      gable.params.push(hidden(q.key));
    }
  }
}

// The pipe run: one shape for a whole pipe, its fittings in order (see pipes.ts).
{
  const types = (p: P, i: number) => Math.round(Number(p[`s${i}Type`] ?? 0));
  const shown = (i: number) => (p: P) => { for (let k = 1; k < i; k++) if (types(p, k) === SEG.none) return false; return true; };
  const is = (i: number, ...kinds: number[]) => (p: P) => shown(i)(p) && kinds.includes(types(p, i));
  const anyEnd = (p: P, kind: number) => Math.round(Number(p.startEnd)) === kind || Math.round(Number(p.finishEnd)) === kind;
  const branched = (p: P) => [...Array(SEGMENTS).keys()].some((k) => shown(k + 1)(p) && ([SEG.tee, SEG.cross, SEG.wye, SEG.lateral, SEG.manifold] as number[]).includes(types(p, k + 1)));
  const segs: NumberParam[] = [];
  const defaults: Record<number, number> = { 1: SEG.straight, 2: SEG.turn, 3: SEG.straight };
  for (let i = 1; i <= SEGMENTS; i++) {
    const group = `Segment ${i}`;
    segs.push(
      { key: `s${i}Type`, label: 'Fitting', min: 0, max: 12, step: 1, default: defaults[i] ?? SEG.none, group, choices: SEG_LABELS.map(([value, label]) => ({ value, label })), showIf: shown(i) },
      { key: `s${i}Len`, label: 'Length', unit: 'm', min: 0.5, max: 64, step: 0.5, default: 4, group, showIf: is(i, SEG.straight, SEG.reducer, SEG.coupling, SEG.tee, SEG.cross, SEG.lateral) },
      { key: `s${i}Angle`, label: 'Angle', min: 30, max: 180, step: 1, default: 90, group, choices: [180, 120, 90, 60, 45, 30].map((v) => ({ value: v, label: `${v}°` })), showIf: is(i, SEG.turn, SEG.sBend, SEG.wye) },
      { key: `s${i}Dir`, label: 'Toward', min: 0, max: 3, step: 1, default: 1, group, choices: [{ value: 0, label: 'Left' }, { value: 1, label: 'Right' }, { value: 2, label: 'Up' }, { value: 3, label: 'Down' }],
        showIf: (p) => is(i, SEG.turn, SEG.sBend, SEG.uTrap, SEG.helix, SEG.tee, SEG.cross, SEG.wye, SEG.lateral, SEG.manifold)(p) || (is(i, SEG.reducer)(p) && Number(p[`s${i}Ecc`]) === 1) },
      { key: `s${i}Bend`, label: 'Bend radius (0: tightest)', unit: 'm', min: 0, max: 32, step: 0.5, default: 0, group, showIf: is(i, SEG.turn, SEG.sBend, SEG.uTrap, SEG.wye, SEG.lateral) },
      { key: `s${i}Offset`, label: 'Offset sideways', unit: 'm', min: 0.5, max: 32, step: 0.5, default: 3, group, showIf: is(i, SEG.sBend) },
      { key: `s${i}Depth`, label: 'Depth of the dip', unit: 'm', min: 0, max: 16, step: 0.5, default: 1, group, showIf: is(i, SEG.uTrap) },
      { key: `s${i}Turns`, label: 'Turns', min: 0.25, max: 16, step: 0.25, default: 1, group, showIf: is(i, SEG.helix) },
      { key: `s${i}HelixR`, label: 'Helix radius', unit: 'm', min: 1, max: 32, step: 0.5, default: 3, group, showIf: is(i, SEG.helix) },
      { key: `s${i}Rise`, label: 'Rise per turn', unit: 'm', min: 1, max: 32, step: 0.5, default: 4, group, showIf: is(i, SEG.helix) },
      { key: `s${i}Radius`, label: 'New inner radius (0.25, then 0.5 m steps)', unit: 'm', min: 0.25, max: 16, step: 0.25, default: 2, group, showIf: is(i, SEG.reducer), snap: snapPipeRadius },
      { key: `s${i}Ecc`, label: 'Shape', min: 0, max: 1, step: 1, default: 0, group, choices: [{ value: 0, label: 'Concentric (a cone)' }, { value: 1, label: 'Eccentric (one side flat)' }], showIf: is(i, SEG.reducer) },
      { key: `s${i}Branch`, label: 'Branch length', unit: 'm', min: 0.5, max: 32, step: 0.5, default: 2, group, showIf: is(i, SEG.tee, SEG.cross, SEG.wye, SEG.lateral, SEG.manifold) },
      { key: `s${i}Count`, label: 'Outlets', min: 1, max: 16, step: 1, default: 3, integer: true, group, showIf: is(i, SEG.manifold) },
      { key: `s${i}Sides`, label: 'Outlets on', min: 0, max: 1, step: 1, default: 0, integer: true, group, showIf: is(i, SEG.manifold), choices: [{ value: 0, label: 'One side' }, { value: 1, label: 'Both sides (in pairs)' }] },
      // Blocks between neighboring outlets, past the one wall block they share (0: as close as their walls allow).
      // Manifolds saved before 0.34.1 were spread over their Length instead: the nearest spacing to that.
      { key: `s${i}Spacing`, label: 'Spacing between outlets', unit: 'blocks', min: 0, max: 64, step: 1, default: 0, integer: true, group, showIf: is(i, SEG.manifold),
        fromLegacy: (p) => {
          if (p[`s${i}Len`] === undefined) return undefined;
          const r = Number(p.radius ?? 1), w = Math.max(1, Math.round(Number(p.wall ?? 1))) * 0.5;
          const pitch = Number(p[`s${i}Len`]) / (Math.max(1, Math.round(Number(p[`s${i}Count`] ?? 3))) + 1);
          return Math.max(0, Math.round((pitch - 2 * r - w) / 0.5));
        } },
    );
  }
  const ends = END_LABELS.map(([value, label]) => ({ value, label }));
  DEFINITIONS.push({
    kind: 'pipe',
    label: 'Pipe run',
    group: 'Pipes',
    params: [
      { key: 'radius', label: 'Inner radius (the water channel; 0.25 is one block across, then 0.5 m steps)', unit: 'm', min: 0.25, max: 16, step: 0.25, default: 1, snap: snapPipeRadius },
      { key: 'wall', label: 'Wall thickness', unit: 'blocks', min: 1, max: 4, step: 1, default: 1, integer: true },
      { key: 'startDown', label: 'Start end faces', min: 0, max: 1, step: 1, default: 0, integer: true, choices: [{ value: 0, label: 'Sideways (the pipe heads off level)' }, { value: 1, label: 'Up (the pipe heads down from it; a fill end)' }] },
      { key: 'startEnd', label: 'Start', min: 0, max: 4, step: 1, default: END.open, choices: ends },
      { key: 'finishEnd', label: 'End', min: 0, max: 4, step: 1, default: END.open, choices: ends },
      { key: 'branchEnds', label: 'Branch ends', min: 0, max: 2, step: 1, default: END.open, choices: ends.slice(0, 3), showIf: branched },
      { key: 'flangeThick', label: 'Flange / coupling thickness', unit: 'blocks', min: 1, max: 4, step: 1, default: 1, integer: true,
        showIf: (p) => anyEnd(p, END.flange) || Math.round(Number(p.branchEnds)) === END.flange || [...Array(SEGMENTS).keys()].some((k) => shown(k + 1)(p) && types(p, k + 1) === SEG.coupling) },
      { key: 'flangeLen', label: 'Flange length', unit: 'm', min: 0.5, max: 8, step: 0.5, default: 1, showIf: (p) => anyEnd(p, END.flange) || Math.round(Number(p.branchEnds)) === END.flange },
      { key: 'bellRadius', label: 'Bell mouth radius', unit: 'm', min: 1, max: 32, step: 0.5, default: 2.5, showIf: (p) => anyEnd(p, END.bell) },
      { key: 'bellLen', label: 'Bell mouth length', unit: 'm', min: 0.5, max: 16, step: 0.5, default: 1.5, showIf: (p) => anyEnd(p, END.bell) },
      { key: 'tankRadius', label: 'Tank connector radius', unit: 'm', min: 1, max: 32, step: 0.5, default: 3, showIf: (p) => anyEnd(p, END.tank) },
      { key: 'tankThick', label: 'Tank connector thickness', unit: 'blocks', min: 1, max: 4, step: 1, default: 1, integer: true, showIf: (p) => anyEnd(p, END.tank) },
      ...segs,
    ],
    halfExtents: (p) => pipeBox(p).half,
    inside: () => false,
    // Always a pipe: hollow by its own wall setting (no Filled / Hollow).
    solidOnly: () => true,
    extraParams: (raw, cleaned) => pipeBranchParams(raw, cleaned),
  });
  DEFINITIONS.push({
    kind: 'pipeSplitter',
    label: 'Water splitter',
    group: 'Pipes',
    params: [
      { key: 'radius', label: 'Inner radius (the water channel; 0.25 is one block across, then 0.5 m steps)', unit: 'm', min: 0.25, max: 16, step: 0.25, default: 0.25, snap: snapPipeRadius },
      { key: 'wall', label: 'Wall thickness', unit: 'blocks', min: 1, max: 4, step: 1, default: 1, integer: true },
      { key: 'outlets', label: 'Outlets (in pairs left and right; an odd one drains straight on)', min: 2, max: 32, step: 1, default: 6, integer: true },
      { key: 'outletLength', label: 'Outlet length', unit: 'm', min: 0.5, max: 32, step: 0.5, default: 2.5 },
      { key: 'spacing', label: 'Spacing between outlets', unit: 'blocks', min: 0, max: 64, step: 1, default: 0, integer: true },
      { key: 'inputLength', label: 'Input length (fill end to the first outlets)', unit: 'm', min: 0.5, max: 64, step: 0.5, default: 3 },
      { key: 'inputHeight', label: 'Input height (fill end above the outlets)', unit: 'm', min: 0.5, max: 64, step: 0.5, default: 3 },
    ],
    halfExtents: (p) => pipeBox(splitterPipe(p)).half,
    inside: () => false,
    solidOnly: () => true,
  });
}

for (const d of DEFINITIONS) {
  const native = NATIVE_STANDING[d.kind];
  if (native === undefined) continue;
  const { halfExtents, inside } = d;
  const [orient] = orientParams(STARTS_STANDING[d.kind] ?? native);
  // Saved before 0.22 (no setting): as it was drawn.
  d.params.push({ ...orient, fromLegacy: () => (native ? 1 : 0) });
  d.halfExtents = (p) => { const h = halfExtents(p); return (Number(p.orient) === 1) === native ? h : [h[0], h[2], h[1]]; };
  d.inside = (p, pt) => inside(p, nativePoint(p, native, pt));
}

// The list: 2D shapes first (the outlines, then the raised ones), then 3D shapes, then roofs.
{
  const raised = DEFINITIONS.filter((d) => NATIVE_STANDING[d.kind] !== undefined);
  const rest = DEFINITIONS.filter((d) => NATIVE_STANDING[d.kind] === undefined);
  const flat2d = PROFILE_SHAPES.filter((x) => x.def.group === '2D shapes').map((x) => x.def);
  const ownGroup = PROFILE_SHAPES.filter((x) => x.def.group !== '2D shapes').map((x) => x.def);
  DEFINITIONS.splice(0, DEFINITIONS.length, ...flat2d, ...raised, ...ownGroup, ...rest);
  for (const d of DEFINITIONS) d.group = d.group ?? (NATIVE_STANDING[d.kind] !== undefined ? '2D shapes' : d.pieces ? 'Roofs' : '3D shapes');
}

/** Ends square to the shape's own axes (0 to 5: -x, +x, -y, +y, -z, +z), as uncap ends. */
function axisEnds(ends: number[], topBottom = false): UncapEnd[] {
  return ends.map((e) => {
    const [key, label] = SPHEROID_ENDS[e];
    const normal: Vec3 = [0, 0, 0];
    normal[Math.floor(e / 2)] = e % 2 ? 1 : -1;
    const short = topBottom ? (e === 2 ? 'Bottom' : 'Top') : ({ uncapNX: '−x', uncapPX: '+x', uncapNY: 'Bottom', uncapPY: 'Top', uncapNZ: '−z', uncapPZ: '+z' } as Record<string, string>)[key];
    return { key, label, short: () => short, normal: () => normal };
  });
}

/** The ends of a shape drawn in a plane and raised (a star, a trapezoid), turned with its lying / standing setting. */
function turnedEnds(ends: UncapEnd[], nativeStanding: boolean): UncapEnd[] {
  return ends.map((e) => ({ ...e, normal: (p: P) => orientPoint(p, nativeStanding, e.normal(p)) }));
}

/**
 * Uncapping, for hollow shapes: which ends a shape can open. Round ends (spheres, a capsule) are cut off to an uncap
 * depth; flat ends (faces) lose their wall, the side walls running on to the edge.
 */
export const UNCAP: Partial<Record<ShapeKind, { ends: UncapEnd[]; round?: boolean }>> = {
  spheroid: { ends: axisEnds([0, 1, 2, 3, 4, 5]), round: true },
  squashedSphere: { ends: axisEnds([0, 1, 2, 3, 4, 5]), round: true },
  capsule: { ends: axisEnds([0, 1, 2, 3, 4, 5]), round: true },
  box: { ends: axisEnds([0, 1, 2, 3, 4, 5]) },
  slantedBox: { ends: axisEnds([0, 1, 2, 3, 4, 5]) },
  cylinder: { ends: axisEnds([2, 3], true) },
  cone: { ends: axisEnds([2, 3], true) },
  pyramid4: { ends: axisEnds([2], true) },
  frustum: { ends: axisEnds([2, 3], true) },
  pyramid3: { ends: axisEnds([2], true) },
  // Drawn in a plane and raised: its ends turn with the lying / standing setting.
  trapezoidPrism: { ends: axisEnds([2, 3], true) },
  starExtruded: { ends: turnedEnds(axisEnds([2, 3], true), false) },
  ...Object.fromEntries(PROFILE_SHAPES.filter((x) => x.ends.length).map((x) => [x.def.kind, { ends: x.ends }])),
};
for (const def of DEFINITIONS) {
  const u = UNCAP[def.kind];
  if (!u) continue;
  for (const e of u.ends) {
    def.params.push({ key: e.key, label: e.label, min: 0, max: 1, step: 1, default: 0, hollowOnly: true, legacy: e.legacy, showIf: e.when,
      choices: [{ value: 0, label: 'Keep' }, { value: 1, label: 'Uncap' }] });
  }
  if (u.round) def.params.push({ ...param('uncapDepth', len('Uncap depth (how much of each uncapped end comes off)', 1)), hollowOnly: true, showIf: (p: P) => u.ends.some((e) => p[e.key] === 1) });
  // A cone or frustum with no top comes to a point there: uncapping its top cuts the tip off, to a depth.
  if (def.kind === 'cone' || def.kind === 'frustum') def.params.push({ ...param('uncapDepth', len('Uncap depth (how much of the tip comes off)', 1)), hollowOnly: true,
    showIf: (p: P) => p.uncapPY === 1 && (def.kind === 'cone' ? !(p.topRadius > 0) : !(p.topWidth > 0 && p.topDepth > 0)) });
}

/** A pattern's second material to start: Highly Polished Stone, lighter than the usual stone. */
export const DEFAULT_PATTERN_MATERIAL = 582832101;

/** Patterns (see patterns.ts), on every shape built from blocks: a second material across its blocks. */
function patternParams(): NumberParam[] {
  const on = (p: P) => (p.pattern ?? 0) > 0;
  const is = (...k: number[]) => (p: P) => k.includes(Math.round(p.pattern ?? 0));
  const blocks = (key: string, label: string, def: number, min: number, max: number, showIf: (p: P) => boolean): NumberParam =>
    ({ key, label, unit: 'blocks', min, max, step: 1, default: def, integer: true, group: 'Pattern', showIf });
  return [
    { key: 'pattern', label: 'Pattern', min: 0, max: PATTERNS.length - 1, step: 1, default: 0, integer: true, group: 'Pattern', choices: PATTERNS.map((x) => ({ ...x })) },
    { key: 'patternMaterial', label: 'Pattern material', min: 0, max: 4294967295, step: 1, default: DEFAULT_PATTERN_MATERIAL, integer: true, group: 'Pattern', showIf: on },
    { key: 'patternPlane', label: 'Laid on', min: 0, max: 5, step: 1, default: 0, integer: true, group: 'Pattern', showIf: on, choices: [
      { value: 0, label: 'Auto (a 3D shape\'s skin; a 2D shape\'s face)' }, { value: 5, label: 'Skin (every face, the inside plain)' },
      { value: 1, label: 'Top (running down through it)' }, { value: 2, label: 'Front (running through along z)' }, { value: 3, label: 'Side (running through along x)' },
      { value: 4, label: '3D (checkerboard, rings and polygons in three dimensions)' }] },
    { key: 'patternDepth', label: 'Depth', unit: 'blocks', min: 1, max: 16, step: 1, default: 1, integer: true, group: 'Pattern',
      showIf: (p) => on(p) && (p.patternPlane === 5 || (p.patternPlane ?? 0) === 0) },
    blocks('checkSize', 'Square size', 2, 1, 32, is(1)),
    { key: 'stripeDir', label: 'Stripes run', min: 0, max: 4, step: 1, default: 0, integer: true, group: 'Pattern', showIf: is(2), choices: [
      { value: 0, label: 'Across' }, { value: 1, label: 'Up and down' }, { value: 2, label: 'Diagonally (/)' }, { value: 3, label: 'Diagonally (\\)' },
      { value: 4, label: 'Swirl (pole to pole, round the shape)' }] },
    blocks('stripeWidth', 'Stripe width', 2, 1, 32, (p) => is(2)(p) && p.stripeDir !== 4),
    { key: 'swirlCount', label: 'Stripes around', min: 1, max: 48, step: 1, default: 8, integer: true, group: 'Pattern', showIf: (p) => is(2)(p) && p.stripeDir === 4 },
    { key: 'swirlTwist', label: 'Twist (turns from bottom to top)', min: 0, max: 4, step: 0.25, default: 0.5, group: 'Pattern', showIf: (p) => is(2)(p) && p.stripeDir === 4 },
    { key: 'swirlDir', label: 'Turns', min: -1, max: 1, step: 2, default: 1, integer: true, group: 'Pattern', showIf: (p) => is(2)(p) && p.stripeDir === 4, segments: ['Clockwise', 'Counter-clockwise'], choices: [{ value: -1, label: 'Clockwise' }, { value: 1, label: 'Counter-clockwise' }] },
    { key: 'swirlShare', label: 'Stripe share', unit: '%', min: 5, max: 95, step: 5, default: 30, integer: true, group: 'Pattern', showIf: (p) => is(2)(p) && p.stripeDir === 4 },
    blocks('ringWidth', 'Ring width', 2, 1, 32, is(3, 4)),
    { key: 'polySides', label: 'Sides', min: 3, max: 12, step: 1, default: 4, integer: true, group: 'Pattern', showIf: is(4) },
    blocks('spiralWidth', 'Band width', 2, 1, 32, is(5)),
    { key: 'spiralArms', label: 'Arms', min: 1, max: 8, step: 1, default: 1, integer: true, group: 'Pattern', showIf: is(5) },
    { key: 'spiralDir', label: 'Turns', min: -1, max: 1, step: 2, default: 1, integer: true, group: 'Pattern', showIf: is(5), segments: ['Clockwise', 'Counter-clockwise'], choices: [{ value: -1, label: 'Clockwise' }, { value: 1, label: 'Counter-clockwise' }] },
    blocks('mazePath', 'Path width', 2, 1, 16, is(6)),
    blocks('stoneSize', 'Stone size', 6, 2, 64, is(7)),
    blocks('jointWidth', 'Joint width', 1, 1, 6, is(7)),
    blocks('brickWidth', 'Brick width', 2, 1, 16, is(8, 9)),
    { key: 'brickStyle', label: 'Bricks', min: 0, max: 1, step: 1, default: 1, integer: true, group: 'Pattern', showIf: is(8, 9), segments: ['Two-tone', 'Joints'], choices: [{ value: 0, label: 'Two-tone: bricks one way in one material, the other way in the other (basketweave: alternating in each square)' }, { value: 1, label: 'Joints: lines between bricks (bricks 2 or more wide)' }] },
    { key: 'brickRatio', label: 'Brick length (in widths)', min: 2, max: 6, step: 1, default: 2, integer: true, group: 'Pattern', showIf: is(8, 9) },
    { key: 'mazeSeed', label: 'Variation', min: 1, max: 9999, step: 1, default: 1, integer: true, group: 'Pattern', showIf: is(6) },
    { key: 'stoneSeed', label: 'Variation', min: 1, max: 9999, step: 1, default: 1, integer: true, group: 'Pattern', showIf: is(7) },
  ];
}
for (const def of DEFINITIONS) if (!def.pieces) def.params.push(...patternParams());

export const SHAPES: Record<ShapeKind, ShapeDefinition> = Object.fromEntries(
  DEFINITIONS.map((d) => [d.kind, d]),
) as Record<ShapeKind, ShapeDefinition>;

/** Shapes in menu order. */
export const SHAPE_LIST: ShapeDefinition[] = DEFINITIONS;

/** Shapes whose sizes follow rules of their own (roof pieces, pipe fittings, a gable fitted to its roof, letter heights): no Scale. */
const NO_SCALE = new Set<ShapeKind>(['pipe', 'pipeSplitter', 'gable', 'text']);

/**
 * The sizes Scale changes together: every length in meters the shape shows with its other settings (widths,
 * heights, radii, shifts), not choices, hollow-only settings (uncap depth) or counts. Empty for shapes that can't
 * be scaled, or have fewer than two sizes.
 */
export function sizeKeys(kind: ShapeKind, params: Record<string, number>): string[] {
  const def = SHAPES[kind];
  if (!def || def.pieces || NO_SCALE.has(kind)) return [];
  const p = cleanParams(kind, params);
  const keys = def.params.filter((q) => q.unit === 'm' && !q.choices && !q.hollowOnly && !q.optional && (!q.showIf || q.showIf(p)) && typeof p[q.key] === 'number').map((q) => q.key);
  return keys.length >= 2 ? keys : [];
}

/** The shape's sizes (see sizeKeys) from `base` times `factor`, each on its own step and within its limits. */
export function scaleSizes(kind: ShapeKind, base: Record<string, number>, factor: number): Record<string, number> {
  const out = { ...base };
  for (const key of sizeKeys(kind, base)) {
    const q = SHAPES[kind].params.find((x) => x.key === key)!;
    const v = Math.round((base[key] * factor) / q.step) * q.step;
    out[key] = Math.min(q.max, Math.max(q.min, Math.round(v * 1000) / 1000));
  }
  return cleanParams(kind, out);
}

export function defaultParams(kind: ShapeKind): Record<string, number> {
  // Optional settings stay unset: the shape works them out until they are edited.
  const out: Record<string, number> = {};
  for (const p of SHAPES[kind].params) if (!p.optional) out[p.key] = p.default;
  // And the settings kept besides the listed ones (a text shape's words).
  const extra = SHAPES[kind].extraParams;
  return extra ? { ...out, ...extra(out, out) } : out;
}

/**
 * Limits of a roof length in meters: up to 4 m per piece of the piece count's limit, down to half a meter (0 where
 * the count can be 0, such as a pyramid's ridge). Offsets, which can be negative, go as far the other way.
 */
export function meterLimits(def: NumberParam): { min: number; max: number } {
  return { min: def.min < 0 ? def.min * 4 : def.min === 0 ? 0 : 0.5, max: def.max * 4 };
}

/** Clamps every parameter into its allowed range, filling in defaults for missing ones. */
export function cleanParams(kind: ShapeKind, params: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of SHAPES[kind].params) {
    // A missing setting is read from its older keys, for projects saved by earlier versions.
    const from = [def.key, ...(def.legacy ?? [])].find((k) => params[k] !== undefined && Number.isFinite(Number(params[k])));
    let v = from === undefined ? (def.fromLegacy?.(params) ?? NaN) : Number(params[from]);
    if (!Number.isFinite(v)) {
      if (def.optional) continue;
      v = def.default;
    }
    if (def.length && Number(params.units) === 1) {
      // Meters, on the half-meter grid.
      const { min, max } = meterLimits(def);
      v = Math.min(max, Math.max(min, Math.round(v * 2) / 2));
      out[def.key] = v;
      continue;
    }
    if (def.optional) v = Math.round(v * 2) / 2;
    v = Math.min(def.max, Math.max(def.min, v));
    if (def.limits) { const l = def.limits(params); v = Math.min(l.max, Math.max(l.min, v)); }
    if (def.integer) v = Math.round(v);
    if (def.snap) v = def.snap(v);
    out[def.key] = v;
  }
  // Settings that aren't in the list (a pipe run's branches: see pipeBranchParams).
  const extra = SHAPES[kind].extraParams;
  if (extra) Object.assign(out, extra(params, out));
  return out;
}

/**
 * The value among a setting's choices for these settings nearest `v` (the larger of two as near). The value asked
 * for is kept in the settings (a text's weight stays Black when the font has none, so the next font gets its Black);
 * this is the one shown and used.
 */
export function nearestChoice(def: NumberParam, params: Record<string, number>, v: number): number {
  const ok = def.choicesFor!(params).map((c) => c.value);
  if (!ok.length || ok.includes(v)) return v;
  return ok.reduce((b, c) => (Math.abs(c - v) < Math.abs(b - v) || (Math.abs(c - v) === Math.abs(b - v) && c > b) ? c : b), ok[0]);
}

/**
 * A pipe's inner radius: 0.25 m (a channel one block across) or a multiple of 0.5 m, nothing between (0.75 and 1.25
 * would sit the channel half a block off the wall's grid). The nearest, or past `prev` in the direction it moved.
 */
export function snapPipeRadius(v: number, prev?: number): number {
  const ok = (x: number) => x === 0.25 || (x >= 0.5 && Math.abs(x * 2 - Math.round(x * 2)) < 1e-9);
  if (ok(v)) return v;
  if (prev !== undefined && v > prev) return v < 0.5 ? 0.5 : Math.ceil(v * 2) / 2;
  if (prev !== undefined && v < prev) return v < 0.5 ? 0.25 : Math.floor(v * 2) / 2;
  return v < 0.375 ? 0.25 : Math.round(v * 2) / 2;
}

/**
 * A pipe run's settings seen from a branch chain: its segments read from the branch's own settings (see pipes.ts),
 * everything else (radius, ends) the run's. Unset segments are None.
 */
export function chainView(p: Record<string, number>, prefix: string): Record<string, number> {
  const view: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) if (!/^s\d/.test(k)) view[k] = v;
  for (const [k, v] of Object.entries(p)) if (k.startsWith(prefix) && /^s\d+[A-Z]\w*$/.test(k.slice(prefix.length))) view[k.slice(prefix.length)] = v;
  for (let i = 1; i <= SEGMENTS; i++) view[`s${i}Type`] ??= SEG.none;
  return view;
}

/**
 * Segment j of the branch chain at `prefix`: the run's own segment j settings, named under the prefix, starting as
 * None. At the deepest branch level its fitting can't be another joint.
 */
export function branchSegmentParams(prefix: string, j: number): NumberParam[] {
  const deepest = branchDepth(prefix) >= MAX_BRANCH_DEPTH;
  return SHAPES.pipe.params.filter((d) => d.group === `Segment ${j}`).map((d) => {
    const out: NumberParam = { ...d, key: prefix + d.key, group: undefined, legacy: undefined, fromLegacy: undefined, optional: undefined,
      showIf: (p) => (d.showIf ? d.showIf(chainView(p, prefix)) : true) };
    if (d.key === `s${j}Type`) {
      out.default = SEG.none;
      if (deepest) out.choices = d.choices?.filter((c) => !BRANCHING.has(c.value));
    }
    return out;
  });
}

/** A branch's end: open, capped or flanged (the run's Branch ends unless set). */
export function branchEndParam(prefix: string): NumberParam {
  const def = SHAPES.pipe.params.find((d) => d.key === 'branchEnds')!;
  return { ...def, key: `${prefix}End`, label: 'End fitting', showIf: undefined };
}

/** A pipe run's branch settings, cleaned: only those of outlets that exist, each segment in use filled in. */
function pipeBranchParams(raw: Record<string, number>, cleaned: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  const now = () => ({ ...cleaned, ...out });
  const walk = (prefix: string) => {
    if (branchDepth(prefix) >= MAX_BRANCH_DEPTH) return;
    for (const i of chainSegments(now(), prefix)) {
      const n = outletCount(now(), prefix, i);
      for (let b = 1; b <= n; b++) {
        const bp = branchPrefix(prefix, i, b);
        const end = Number(raw[`${bp}End`]);
        if (Number.isFinite(end)) out[`${bp}End`] = Math.max(0, Math.min(2, Math.round(end)));
        for (let j = 1; j <= SEGMENTS; j++) {
          const t = Number(raw[`${bp}s${j}Type`]);
          if (!Number.isFinite(t) || Math.round(t) === SEG.none) break;
          for (const d of branchSegmentParams(bp, j)) {
            let v = Number(raw[d.key]);
            if (!Number.isFinite(v)) v = d.default;
            v = Math.min(d.max, Math.max(d.min, v));
            if (d.integer) v = Math.round(v);
            if (d.snap) v = d.snap(v);
            if (d.choices && !d.choices.some((c) => c.value === v)) v = d.key.endsWith('Type') ? SEG.straight : d.choices[0].value;
            out[d.key] = v;
          }
        }
        walk(bp);
      }
    }
  };
  walk('');
  return out;
}
