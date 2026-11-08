// Writes a sample tower as an .ebblueprint and as a project you can open in the app:
//   npx tsx scripts/make-sample.ts out.ebblueprint   (also writes out.shapeforge; add --cubes to skip merging)
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { writeBlueprint } from '../src/core/blueprint';
import { serializeProject } from '../src/core/project';
import { createShape } from '../src/core/scene';
import type { Shape, ShapeKind } from '../src/core/types';
import { voxelizeScene } from '../src/core/voxelize';

const WEATHERED_STONE = 1406367026;
const WELL_BLOCK = 310129061;
const YELLOW_LUMINESCENT = 3288587434;

function shape(kind: ShapeKind, params: Record<string, number>, over: Partial<Shape>): Shape {
  const s = createShape(kind);
  return { ...s, params: { ...s.params, ...params }, ...over };
}

// A round tower: hollow stone walls, a doorway cut through them, a cone roof and a glowing star on top.
const scene: Shape[] = [
  shape('cylinder', { radius: 4, height: 8 }, { position: [0, 4, 0], fill: 'hollow', materialItem: WEATHERED_STONE }),
  shape('box', { width: 2, height: 3, depth: 3 }, { position: [0, 1.5, 3.5], op: 'subtract', fill: 'filled' }),
  shape('cone', { baseRadius: 5, topRadius: 0, height: 4 }, { position: [0, 10, 0], fill: 'hollow', materialItem: WELL_BLOCK }),
  shape('star3d', { points: 5, outerRadius: 3, innerRadius: 1.5, thickness: 2 }, {
    position: [0, 15, 0], rotation: [-90, 0, 0], fill: 'filled', materialItem: YELLOW_LUMINESCENT,
  }),
];

const out = process.argv[2] ?? 'sample_tower.ebblueprint';
const voxels = voxelizeScene(scene);
const text = writeBlueprint(
  voxels,
  { name: 'sample_tower', created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), id: randomBytes(16).toString('hex') },
  (s) => createHash('sha256').update(s).digest('hex'),
  { merge: !process.argv.includes('--cubes') },
);
writeFileSync(out, text);
const projectOut = out.replace(/\.ebblueprint$/i, '') + '.shapeforge';
writeFileSync(projectOut, serializeProject({ name: 'sample_tower', shapes: scene }));
console.log(`Wrote ${voxels.length} blocks as ${JSON.parse(text).pieces.length} pieces to ${out} and the editable project to ${projectOut}`);
