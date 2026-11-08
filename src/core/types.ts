/** Size of one voxel (one small Enshrouded cube) in meters. */
export const VOXEL_SIZE = 0.5;

export type Vec3 = [number, number, number];

export type FillMode = 'filled' | 'hollow';

/**
 * How a hollow wall is drawn.
 * - thin:  minimum voxels; neighbors may touch only at edges/corners (diagonal pinholes possible).
 * - thick: every wall voxel shares a face with its neighbors, so the wall is sealed.
 */
export type LineWeight = 'thin' | 'thick';

export type CombineOp = 'add' | 'subtract' | 'intersect';

export type ShapeKind =
  | 'spheroid'
  | 'squashedSphere'
  | 'capsule'
  | 'box'
  | 'slantedBox'
  | 'cylinder'
  | 'cone'
  | 'pyramid4'
  | 'frustum'
  | 'pyramid3'
  | 'trapezoidPrism'
  | 'starExtruded'
  | 'star3d'
  | 'helix'
  | 'vortex'
  | 'saddle'
  | 'teardrop3d'
  | 'polyhedron'
  | 'polygon'
  | 'ellipse'
  | 'ring'
  | 'arc'
  | 'pill'
  | 'roundedRect'
  | 'superellipse'
  | 'crescent'
  | 'lens'
  | 'heart'
  | 'teardrop'
  | 'shield'
  | 'rose'
  | 'leaf'
  | 'arch'
  | 'grid'
  | 'gear'
  | 'gable'
  | 'pipe'
  | 'pipeSplitter'
  | 'text'
  | 'roofShed'
  | 'roofGable'
  | 'roofHip'
  | 'roofL'
  | 'roofT'
  | 'roofCross';

/**
 * Blocks brought in from an .ebblueprint file. Treated as read-only once created, so undo snapshots can share it.
 */
export interface ImportedLayer {
  /** Unique per import; identifies the block data for caching and change tracking. */
  id: string;
  /** Shown in the shape list, usually the file name. */
  name: string;
  /** Size in cells along x, y, z. */
  size: Vec3;
  /** Cells as flat groups of four numbers: i, j, k (from 0 at the layer's lowest corner), materialItem. */
  cells: number[];
}

/** Use as materialItem on an imported layer to keep each block's own material. */
export const KEEP_MATERIALS = 0;

/** One item in a scene: a shape, or an imported layer (kind 'imported'). */
export interface Shape {
  id: string;
  kind: ShapeKind | 'imported';
  /** Shape sizes; their meaning is defined per kind in shapes.ts. Empty for imported layers. */
  params: Record<string, number>;
  /** The blocks of an imported layer. */
  layer?: ImportedLayer;
  /** Center of the shape, in meters. */
  position: Vec3;
  /** Euler rotation in degrees, applied X then Y then Z (same as three.js 'XYZ'). Imported layers snap to 90 degrees. */
  rotation: Vec3;
  fill: FillMode;
  /** Wall thickness in voxels when fill is 'hollow'. */
  wallThickness: number;
  lineWeight: LineWeight;
  /** Embervale materialItem value, or KEEP_MATERIALS on an imported layer. */
  materialItem: number;
  op: CombineOp;
  /** The player's name for it, shown in the shape list; unnamed shapes show their kind. */
  name?: string;
  /** The folder it's in (a Folder id), or none for the top of the list. */
  folder?: string;
}

/** A folder in the shape list. Folders nest; a folder's shapes always stay together in the list's order. */
export interface Folder {
  id: string;
  name: string;
  /** The folder it's in, or null at the top of the list. */
  parent: string | null;
  /** Shown open in the list (its contents listed under it). */
  open: boolean;
}

/** One filled grid cell. i, j, k are cell indexes; the cell's minimum corner is at (i, j, k) * VOXEL_SIZE. */
export interface Voxel {
  i: number;
  j: number;
  k: number;
  materialItem: number;
}
