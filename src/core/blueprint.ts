import { resolveAnchor, cleanLift } from './anchor';
import { flipCell, flipRoofPiece, flipVoxels } from './handedness';
import { apply, fromQuaternion } from './math';
import { ROTATION_TEXT, mergeVoxels, type PlacedPiece } from './merge';
import { PIECE_BY_ID } from './pieces';
import { YAW_QUATERNION, type RoofPiece } from './roofs';
import { VOXEL_SIZE, type Voxel } from './types';

/** blueprintId of the basic 0.5 m cube. */
export const CUBE_BLUEPRINT_ID = 1986896347;
const CUBE_PIECE = PIECE_BY_ID.get(CUBE_BLUEPRINT_ID)!;

export interface BlueprintMeta {
  name: string;
  /** ISO time, e.g. 2026-11-02T21:33:49Z */
  created: string;
  /** 32 lowercase hex characters. */
  id: string;
  build?: string;
  toolkit?: string;
}

export type HashFn = (text: string) => string;

function num(n: number): string {
  // Integers print without a decimal point, halves as 0.5, matching Embervale's files.
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

function pieceLine(p: PlacedPiece, offset: [number, number, number]): string {
  const [i, j, k] = p.min.map((v, a) => v - offset[a]);
  // Pieces pivot on their pos corner. Turned a quarter turn around y, a piece's length runs toward -z
  // from that corner, so the corner sits at the far z end of its footprint.
  const pos = p.rotation === 'y90' ? [i, j, k + p.type.size[0]] : [i, j, k];
  const [x, y, z] = pos.map((c) => num(c * VOXEL_SIZE));
  return `{"kind":"block","blueprintId":${p.type.blueprintId},"materialItem":${p.materialItem},"pos":[${x},${y},${z}],"rot":[${ROTATION_TEXT[p.rotation]}],"flag":${p.type.flag}}`;
}

export interface WriteOptions {
  /** Replace groups of cubes with larger pieces (see merge.ts). The blocks placed in game are the same. */
  merge?: boolean;
  /** Roof pieces to write alongside the blocks (see roofs.ts). */
  roofs?: RoofPiece[];
  /**
   * The block the blueprint lands on in game (cell indices; see anchor.ts): written first, as a single block kept
   * out of merging. A cell the build doesn't fill gets a marker block. Left out, the lowest block nearest the
   * middle of the footprint. Null: no anchor block (the pieces in their usual order).
   */
  anchor?: [number, number, number] | null;
  /** Meters the build lands above the anchor block (written as the file's lift when not 0). */
  lift?: number;
  /** Flip along z into the game's world (see handedness.ts): what the app exports. Tests of the format leave it off. */
  mirror?: boolean;
}

function roofLine(p: RoofPiece, offset: [number, number, number]): string {
  const [x, y, z] = p.pos.map((v, a) => num(v - offset[a] * VOXEL_SIZE));
  return `{"kind":"block","blueprintId":${p.type.blueprintId},"materialItem":${p.materialItem},"pos":[${x},${y},${z}],"rot":[${YAW_QUATERNION[p.yaw].join(',')}],"flag":${p.type.form === 'cube' ? 0 : 1}}`;
}

/**
 * Writes voxels as an Embervale .ebblueprint text.
 * - Shifts everything so the lowest corner sits at (0, 0, 0), like Embervale's own files.
 * - pos is each piece's pivot corner.
 * - contentSha256 is a SHA-256 of the pieces block. Embervale does not check it, but a real value is written anyway.
 */
export function writeBlueprint(voxels: Voxel[], meta: BlueprintMeta, hash: HashFn, options: WriteOptions = {}): string {
  let roofs = options.roofs ?? [];
  if (voxels.length === 0 && roofs.length === 0) throw new Error('Nothing to export: the scene has no voxels.');
  if (options.mirror) {
    voxels = flipVoxels(voxels);
    roofs = roofs.map(flipRoofPiece);
    if (options.anchor) options = { ...options, anchor: flipCell(options.anchor) };
  }
  // The anchor block goes first, on its own; a marker joins the blocks (it may be the lowest corner).
  const anchor = options.anchor === null ? null : resolveAnchor(voxels, options.anchor);
  let first: PlacedPiece | null = null;
  if (anchor) {
    const [ai, aj, ak] = anchor.cell;
    first = { type: CUBE_PIECE, rotation: 'none', min: [ai, aj, ak], footprint: [1, 1, 1], materialItem: anchor.materialItem };
    voxels = anchor.marker
      ? [...voxels, { i: ai, j: aj, k: ak, materialItem: anchor.materialItem }]
      : voxels;
  }
  const lift = cleanLift(options.lift ?? 0);
  // Shift so the lowest corner of everything, blocks and roof pieces, sits at (0, 0, 0).
  let mi = Infinity, mj = Infinity, mk = Infinity;
  for (const v of voxels) {
    mi = Math.min(mi, v.i); mj = Math.min(mj, v.j); mk = Math.min(mk, v.k);
  }
  for (const r of roofs) {
    mi = Math.min(mi, Math.floor(r.min[0] / VOXEL_SIZE));
    mj = Math.min(mj, Math.floor(r.min[1] / VOXEL_SIZE));
    mk = Math.min(mk, Math.floor(r.min[2] / VOXEL_SIZE));
  }
  const rest = first ? voxels.filter((v) => !(v.i === first!.min[0] && v.j === first!.min[1] && v.k === first!.min[2])) : voxels;
  const placed: PlacedPiece[] = options.merge
    ? mergeVoxels(rest)
    : [...rest]
      .sort((a, b) => a.j - b.j || a.k - b.k || a.i - b.i)
      .map((v) => ({ type: CUBE_PIECE, rotation: 'none' as const, min: [v.i, v.j, v.k], footprint: [1, 1, 1], materialItem: v.materialItem }));
  const lines = [
    ...(first ? [first] : []).concat(placed).map((p) => '    ' + pieceLine(p, [mi, mj, mk])),
    ...roofs.map((r) => '    ' + roofLine(r, [mi, mj, mk])),
  ];
  const pieces = '[\n' + lines.join(',\n') + '\n  ]';
  return [
    '{',
    '  "format": "ebt-blueprint",',
    '  "version": 1,',
    `  "name": ${JSON.stringify(meta.name)},`,
    `  "build": ${JSON.stringify(meta.build ?? '1283531')},`,
    `  "created": ${JSON.stringify(meta.created)},`,
    `  "toolkit": ${JSON.stringify(meta.toolkit ?? '3.4.1')},`,
    `  "id": ${JSON.stringify(meta.id)},`,
    '  "source": "recorded",',
    `  "contentSha256": "${hash(pieces)}",`,
    ...(lift ? [`  "lift": ${num(lift)},`] : []),
    '  "anchor": [0,0,0],',
    `  "pieces": ${pieces}`,
    '}',
    '',
  ].join('\n');
}

interface RawPiece {
  kind: string;
  blueprintId: number;
  materialItem: number;
  pos: [number, number, number];
  rot: [number, number, number, number];
  flag: number;
}

export interface ReadResult {
  voxels: Voxel[];
  /** Number of pieces in the file. */
  pieces: number;
  /** Pieces of a type this app doesn't know (props, or block types added to the game later); left out. */
  skipped: number;
}

/**
 * Reads an .ebblueprint into voxels. Every known piece type is expanded into the 0.5 m cells it covers:
 * each piece rotates around its pos corner, so each of its cells is found by rotating that cell's corners
 * and taking the lowest one.
 */
/** Reads a blueprint; `mirror` flips it from the game's world into ShapeForge's (see handedness.ts), as the app imports. */
export function readBlueprint(text: string, opts: { mirror?: boolean } = {}): ReadResult {
  let data: { pieces?: RawPiece[] };
  try {
    data = JSON.parse(text) as { pieces?: RawPiece[] };
  } catch {
    throw new Error('This file is not an .ebblueprint (it is not valid JSON).');
  }
  if (!data || !Array.isArray(data.pieces)) throw new Error('This file is not an .ebblueprint: it has no pieces list.');
  const voxels: Voxel[] = [];
  let skipped = 0;
  for (const p of data.pieces) {
    const type = p && p.kind === 'block' ? PIECE_BY_ID.get(p.blueprintId) : undefined;
    if (!type || !Array.isArray(p.pos) || !Array.isArray(p.rot)) {
      skipped++;
      continue;
    }
    const m = fromQuaternion(p.rot);
    const [sx, sy, sz] = type.size;
    for (let a = 0; a < sx; a++)
      for (let b = 0; b < sy; b++)
        for (let c = 0; c < sz; c++) {
          let lo: [number, number, number] = [Infinity, Infinity, Infinity];
          for (const cx of [a, a + 1])
            for (const cy of [b, b + 1])
              for (const cz of [c, c + 1]) {
                const r = apply(m, [cx * VOXEL_SIZE, cy * VOXEL_SIZE, cz * VOXEL_SIZE]);
                lo = [Math.min(lo[0], r[0]), Math.min(lo[1], r[1]), Math.min(lo[2], r[2])];
              }
          const cell = (axis: number) => Math.round((p.pos[axis] + lo[axis]) / VOXEL_SIZE);
          voxels.push({ i: cell(0), j: cell(1), k: cell(2), materialItem: p.materialItem });
        }
  }
  return { voxels: opts.mirror ? flipVoxels(voxels) : voxels, pieces: data.pieces.length, skipped };
}
