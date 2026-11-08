import { cleanAnchorCell, cleanLift } from './anchor';
import { decodeCells, encodeCells, layerFromVoxels } from './layer';
import { DEFAULT_MATERIAL } from './materials';
import { newId } from './scene';
import { SHAPES, cleanParams } from './shapes';
import { normalize } from './tree';
import { KEEP_MATERIALS, type CombineOp, type FillMode, type Folder, type LineWeight, type Shape, type ShapeKind, type Vec3 } from './types';

/**
 * A ShapeForge project file (.shapeforge; files saved by 0.3 to 0.5 used .shapeforge.json): the editable design, as opposed to the exported .ebblueprint,
 * which only holds blocks.
 */
export const PROJECT_FORMAT = 'shapeforge-project';
/** 2: blueprints are flipped into the game's world on export and import (see handedness.ts). */
export const PROJECT_VERSION = 2;
export { PROJECT_EXTENSION } from './project-file';

export interface Project {
  /** Blueprint name used when exporting; blank: the project file's name (see blueprintName in the app). */
  name: string;
  shapes: Shape[];
  /** Folders in the shape list (each shape's `folder` names one). */
  folders?: Folder[];
  /** The picked anchor block (cell indices), if any; see anchor.ts. */
  anchor?: Vec3 | null;
  /** Meters the build lands above the anchor block. */
  lift?: number;
}

/** Longest shape or folder name kept. */
export const MAX_NAME = 120;

/**
 * Shape fields saved to disk. Ids are runtime-only and recreated on load. An imported layer's blocks are saved
 * inside the project, as compact text, so the original .ebblueprint is not needed later.
 */
type SavedShape = Omit<Shape, 'id' | 'layer'> & { layer?: { name: string; cells: string } };

export function serializeProject(project: Project): string {
  const shapes: SavedShape[] = project.shapes.map(({ id: _id, layer, ...rest }) =>
    rest.kind === 'imported'
      ? { ...rest, params: {}, layer: { name: layer?.name ?? 'Imported', cells: encodeCells(layer?.cells ?? []) } }
      : { ...rest, params: cleanParams(rest.kind, rest.params) },
  );
  const folders = project.folders?.length ? { folders: project.folders } : {};
  const anchor = project.anchor ? { anchor: cleanAnchorCell(project.anchor) } : {};
  const lift = cleanLift(project.lift ?? 0) ? { lift: cleanLift(project.lift) } : {};
  return JSON.stringify(
    { format: PROJECT_FORMAT, version: PROJECT_VERSION, name: project.name, ...anchor, ...lift, shapes, ...folders },
    null,
    2,
  ) + '\n';
}

export class ProjectError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function vec(v: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) return [...fallback];
  return v.map((n, a) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback[a])) as Vec3;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function parseLayer(raw: unknown, index: number, flip: boolean): Shape['layer'] {
  if (!isObject(raw) || typeof raw.cells !== 'string') throw new ProjectError(`Shape ${index + 1} is missing its imported blocks.`);
  let cells: number[];
  try {
    cells = decodeCells(raw.cells);
  } catch (err) {
    throw new ProjectError(`Shape ${index + 1}: ${(err as Error).message}`);
  }
  const voxels = [];
  // Saved before blueprints were flipped on import (version 1): flipped now, so it still exports as it did.
  for (let n = 0; n < cells.length; n += 4) voxels.push({ i: cells[n], j: cells[n + 1], k: flip ? -1 - cells[n + 2] : cells[n + 2], materialItem: cells[n + 3] });
  if (voxels.length === 0) throw new ProjectError(`Shape ${index + 1} has no imported blocks.`);
  return layerFromVoxels(typeof raw.name === 'string' && raw.name ? raw.name : 'Imported', voxels);
}

function parseShape(raw: unknown, index: number, flip = false): Shape {
  if (!isObject(raw)) throw new ProjectError(`Shape ${index + 1} is not a valid shape.`);
  const imported = raw.kind === 'imported';
  const kind = raw.kind as ShapeKind;
  if (!imported && !Object.hasOwn(SHAPES, kind)) throw new ProjectError(`Shape ${index + 1} has an unknown type "${String(raw.kind)}".`);
  const params = isObject(raw.params) ? (raw.params as Record<string, number>) : {};
  const wall = Number(raw.wallThickness);
  const material = Number(raw.materialItem);
  const validMaterial = Number.isInteger(material) && (material > 0 || (imported && material === KEEP_MATERIALS));
  return {
    id: newId(),
    ...(imported
      ? { kind: 'imported' as const, params: {}, layer: parseLayer(raw.layer, index, flip) }
      : { kind, params: cleanParams(kind, params) }),
    position: vec(raw.position, [0, 0, 0]),
    rotation: vec(raw.rotation, [0, 0, 0]),
    fill: oneOf<FillMode>(raw.fill, ['filled', 'hollow'], 'hollow'),
    wallThickness: Number.isFinite(wall) ? Math.min(8, Math.max(1, Math.round(wall))) : 1,
    lineWeight: oneOf<LineWeight>(raw.lineWeight, ['thin', 'thick'], 'thick'),
    materialItem: validMaterial ? material : imported ? KEEP_MATERIALS : DEFAULT_MATERIAL,
    op: oneOf<CombineOp>(raw.op, ['add', 'subtract', 'intersect'], 'add'),
    ...(typeof raw.name === 'string' && raw.name.trim() ? { name: raw.name.trim().slice(0, MAX_NAME) } : {}),
    ...(typeof raw.folder === 'string' && raw.folder ? { folder: raw.folder } : {}),
  };
}

function parseFolders(raw: unknown): Folder[] {
  if (!Array.isArray(raw)) return [];
  const out: Folder[] = [];
  const ids = new Set<string>();
  for (const f of raw) {
    if (!isObject(f) || typeof f.id !== 'string' || !f.id || ids.has(f.id)) continue;
    ids.add(f.id);
    out.push({
      id: f.id,
      name: typeof f.name === 'string' && f.name.trim() ? f.name.trim().slice(0, MAX_NAME) : 'Folder',
      parent: typeof f.parent === 'string' && f.parent ? f.parent : null,
      open: f.open !== false,
    });
  }
  return out;
}

/**
 * Reads a project file. Missing or out-of-range values are replaced with defaults so an older or hand-edited
 * file still opens; anything that can't be understood throws a ProjectError with a readable message.
 */
export function parseProject(text: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectError('This file is not a ShapeForge project (it is not valid JSON).');
  }
  if (!isObject(data) || data.format !== PROJECT_FORMAT) {
    throw new ProjectError('This file is not a ShapeForge project.');
  }
  const version = Number(data.version);
  if (!Number.isFinite(version) || version > PROJECT_VERSION) {
    throw new ProjectError('This project was saved by a newer version of ShapeForge. Update the app to open it.');
  }
  if (!Array.isArray(data.shapes)) throw new ProjectError('This project has no shape list.');
  // Folders keep their shapes together in order (see tree.ts); a shape naming a missing folder goes to the top level.
  const flip = version < 2;
  const scene = normalize({ shapes: data.shapes.map((raw, i) => parseShape(raw, i, flip)), folders: parseFolders(data.folders) });
  return {
    // Blank (or the old default "shapeforge"): the blueprint takes the project file's name.
    name: typeof data.name === 'string' && data.name.trim() && data.name.trim() !== 'shapeforge' ? data.name : '',
    shapes: scene.shapes,
    folders: scene.folders,
    anchor: cleanAnchorCell(data.anchor),
    lift: cleanLift(data.lift),
  };
}

/** "C:\\builds\\castle.shapeforge" (or older "castle.shapeforge.json") -> "castle" */
export function projectNameFromPath(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.shapeforge(\.json)?$/i, '').replace(/\.json$/i, '') || 'shapeforge';
}
