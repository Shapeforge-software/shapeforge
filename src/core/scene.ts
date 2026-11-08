import { DEFAULT_MATERIAL, ROOF_MATERIALS } from './materials';
import { SHAPES, defaultParams } from './shapes';
import { layerFromVoxels, layerHalfExtents } from './layer';
import { DEFAULT_ROOF_MATERIAL, isRoof } from './roofs';
import { KEEP_MATERIALS, VOXEL_SIZE, type Shape, type ShapeKind, type Voxel } from './types';

let counter = 0;

export function newId(): string {
  counter += 1;
  return `shape-${Date.now().toString(36)}-${counter}`;
}

/** A new shape of this kind with default sizes, sitting on the ground at the origin. */
export function createShape(kind: ShapeKind, materialItem = DEFAULT_MATERIAL): Shape {
  const params = defaultParams(kind);
  const [, hy] = SHAPES[kind].halfExtents(params);
  return {
    id: newId(),
    kind,
    params,
    // Rest the shape on the ground, rounded up to the half-meter grid.
    position: [0, Math.ceil(hy * 2) / 2, 0],
    rotation: [0, 0, 0],
    // A gable is a wall and text is letters, so they start filled.
    fill: kind === 'gable' || kind === 'text' ? 'filled' : 'hollow',
    wallThickness: 1,
    lineWeight: 'thick',
    // Roofs keep a roof material if one was passed in, and otherwise start as Red Tile.
    materialItem: isRoof(kind) && !ROOF_MATERIALS.some((m) => m.materialItem === materialItem) ? DEFAULT_ROOF_MATERIAL : materialItem,
    op: 'add',
  };
}

export function cloneShape(shape: Shape): Shape {
  return {
    ...shape,
    id: newId(),
    params: { ...shape.params },
    position: [...shape.position],
    rotation: [...shape.rotation],
  };
}

/** What kind of shape it is: "Sphere", "castle (imported)". */
export function shapeKindLabel(shape: Shape): string {
  return shape.kind === 'imported' ? `${shape.layer?.name ?? 'Imported'} (imported)` : SHAPES[shape.kind].label;
}

/** Its name if it has one, else its kind. */
export function shapeName(shape: Shape): string {
  return shape.name?.trim() || shapeKindLabel(shape);
}

/** "3. Front wall (subtract)": its place in the order, its name (or kind), and how it combines. */
export function shapeTitle(shape: Shape, index: number): string {
  const op = shape.op === 'add' ? '' : shape.op === 'subtract' ? ' (subtract)' : ' (intersect)';
  return `${index + 1}. ${shapeName(shape)}${op}`;
}

/** A new imported layer from blueprint voxels, centered at the origin and resting on the ground. */
export function createImportedShape(name: string, voxels: Voxel[]): Shape {
  const layer = layerFromVoxels(name, voxels);
  const [hx, hy, hz] = layerHalfExtents(layer);
  // Blocks line up with the grid when the center sits on a cell edge for an even number of cells
  // and on a cell center (a quarter meter off) for an odd number.
  const onGrid = (h: number) => (h % VOXEL_SIZE === 0 ? 0 : VOXEL_SIZE / 2);
  return {
    id: newId(),
    kind: 'imported',
    params: {},
    layer,
    position: [onGrid(hx), hy, onGrid(hz)],
    rotation: [0, 0, 0],
    fill: 'filled',
    wallThickness: 1,
    lineWeight: 'thick',
    materialItem: KEEP_MATERIALS,
    op: 'add',
  };
}
