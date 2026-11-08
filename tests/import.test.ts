import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBlueprint } from '../src/core/blueprint';
import { decodeCells, encodeCells, layerBlockCount } from '../src/core/layer';
import { parseProject, serializeProject } from '../src/core/project';
import { createImportedShape, createShape } from '../src/core/scene';
import { KEEP_MATERIALS, type Shape, type Voxel } from '../src/core/types';
import { voxelizeScene, worldBounds } from '../src/core/voxelize';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const WEATHERED = 1406367026;
const WELL = 310129061;

const cells = (vs: Voxel[]) => new Set(vs.map((v) => `${v.i},${v.j},${v.k}`));
function shifted(vs: Voxel[]): Set<string> {
  const m = [Math.min(...vs.map((v) => v.i)), Math.min(...vs.map((v) => v.j)), Math.min(...vs.map((v) => v.k))];
  return new Set(vs.map((v) => `${v.i - m[0]},${v.j - m[1]},${v.k - m[2]},${v.materialItem}`));
}

test('the circle imports completely: 188 cubes plus 4 Door Frames of 8 cells, forming a closed ring', () => {
  const { voxels, pieces, skipped } = readBlueprint(fixture('circle_thick.ebblueprint'));
  assert.equal(pieces, 192);
  assert.equal(skipped, 0);
  assert.equal(cells(voxels).size, 188 + 4 * 8);
  assert.equal(voxels.filter((v) => v.materialItem === WELL).length, 32, 'Door Frames are Well Block');
  // Flood from the middle of the ring with face moves; a closed ring keeps it inside.
  const ring = cells(voxels);
  const xs = voxels.map((v) => v.i), zs = voxels.map((v) => v.k);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const start = [Math.round((minX + maxX) / 2), Math.round((minZ + maxZ) / 2)];
  const seen = new Set([start.join(',')]);
  const queue = [start];
  let escaped = false;
  while (queue.length && !escaped) {
    const [x, z] = queue.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) { escaped = true; break; }
      const k = `${nx},${nz}`;
      if (seen.has(k) || ring.has(`${nx},0,${nz}`)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  assert.equal(escaped, false, 'the Door Frames close the gaps in the ring');
});

test('test2 still reads exactly as Embervale shows it', () => {
  const { voxels } = readBlueprint(fixture('test2.ebblueprint'));
  assert.deepEqual(cells(voxels), new Set(['0,0,0', '0,0,-1', '0,0,-2', '0,0,-3', '1,0,1', '1,0,-1', '1,0,-3']));
});

test('every piece type expands to its full size, including when rotated', () => {
  const piece = (id: number, rot: number[]) => JSON.stringify({ pieces: [{ kind: 'block', blueprintId: id, materialItem: WEATHERED, pos: [0, 0, 0], rot, flag: 1 }] });
  const quarterY = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  const foundation4m = readBlueprint(piece(950598916, [0, 0, 0, 1])).voxels;
  assert.equal(cells(foundation4m).size, 8 * 4 * 8);
  const wall = readBlueprint(piece(948722226, quarterY)).voxels;
  const span = (a: 'i' | 'j' | 'k') => Math.max(...wall.map((v) => v[a])) - Math.min(...wall.map((v) => v[a])) + 1;
  assert.deepEqual([span('i'), span('j'), span('k')], [1, 8, 8], 'a Wide Wall turned a quarter turn faces the other way');
});

test('unknown pieces are counted and left out; bad files give readable errors', () => {
  const text = JSON.stringify({ pieces: [
    { kind: 'block', blueprintId: 1986896347, materialItem: WEATHERED, pos: [0, 0, 0], rot: [0, 0, 0, 1], flag: 0 },
    { kind: 'prop', blueprintId: 5, materialItem: 0, pos: [0, 0, 0], rot: [0, 0, 0, 1], flag: 0 },
    { kind: 'block', blueprintId: 123, materialItem: WEATHERED, pos: [1, 0, 0], rot: [0, 0, 0, 1], flag: 0 },
  ] });
  const r = readBlueprint(text);
  assert.equal(r.voxels.length, 1);
  assert.equal(r.skipped, 2);
  assert.throws(() => readBlueprint('nope'), /not valid JSON/);
  assert.throws(() => readBlueprint('{"format":"x"}'), /no pieces list/);
});

function circleLayer(): Shape {
  return createImportedShape('circle', readBlueprint(fixture('circle_thick.ebblueprint')).voxels);
}

test('an imported layer places exactly the file\'s blocks, with their own materials', () => {
  const layer = circleLayer();
  assert.equal(layer.materialItem, KEEP_MATERIALS);
  assert.equal(layerBlockCount(layer.layer!), 220);
  const out = voxelizeScene([layer]);
  assert.deepEqual(shifted(out), shifted(readBlueprint(fixture('circle_thick.ebblueprint')).voxels));
  assert.ok(out.every((v) => v.j === 0), 'rests on the ground');
});

test('a layer can be moved, turned in quarter turns, recolored, hollowed and cut', () => {
  const base = circleLayer();
  const n = voxelizeScene([base]).length;
  const turned = voxelizeScene([{ ...base, rotation: [0, 90, 0] }]);
  assert.equal(turned.length, n, 'turning keeps every block');
  const almost = voxelizeScene([{ ...base, rotation: [0, 80, 0] }]);
  assert.deepEqual(shifted(almost), shifted(turned), 'rotation snaps to quarter turns');
  const moved = voxelizeScene([{ ...base, position: [base.position[0] + 3, base.position[1] + 1, base.position[2]] }]);
  assert.equal(Math.min(...moved.map((v) => v.i)) - Math.min(...voxelizeScene([base]).map((v) => v.i)), 6);
  const recolored = voxelizeScene([{ ...base, materialItem: WELL }]);
  assert.ok(recolored.every((v) => v.materialItem === WELL));
  const cutter: Shape = { ...createShape('box'), position: [base.position[0], 0, base.position[2]], params: { width: 64, height: 4, depth: 4 }, op: 'subtract', fill: 'filled' };
  assert.ok(voxelizeScene([base, cutter]).length < n, 'a shape can cut the layer');
  const block: Shape = createImportedShape('cube', [...Array(64)].map((_, x) => ({ i: x % 4, j: Math.floor(x / 16), k: Math.floor(x / 4) % 4, materialItem: WEATHERED })));
  assert.equal(voxelizeScene([{ ...block, fill: 'hollow', lineWeight: 'thin' }]).length, 64 - 8, 'hollowing removes the inside');
  const b = worldBounds(base);
  assert.equal(b.max[0] - b.min[0], 28);
});

test('imported layers are saved inside the project and come back identical', () => {
  const layer = circleLayer();
  const text = serializeProject({ name: 'ring', shapes: [{ ...layer, rotation: [0, 90, 0] }, createShape('box')] });
  const back = parseProject(text);
  assert.equal(back.shapes[0].kind, 'imported');
  assert.equal(back.shapes[0].layer!.name, 'circle');
  assert.deepEqual(back.shapes[0].layer!.cells, layer.layer!.cells);
  assert.deepEqual(shifted(voxelizeScene(back.shapes)), shifted(voxelizeScene([{ ...layer, rotation: [0, 90, 0] }, createShape('box')])));
  const json = JSON.parse(text);
  assert.equal(typeof json.shapes[0].layer.cells, 'string', 'blocks stored compactly');
  assert.throws(() => parseProject(text.replace(/"cells": "[^"]*"/, '"cells": "1,2,x,4"')), /damaged/);
});

test('cell encoding round-trips', () => {
  const c = [0, 0, 0, 5, 3, 1, 2, 310129061];
  assert.deepEqual(decodeCells(encodeCells(c)), c);
  assert.deepEqual(decodeCells(''), []);
});
