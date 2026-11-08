import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_MATERIALS, DEFAULT_MATERIAL, MATERIALS, TERRAIN_MATERIALS, materialById } from '../src/core/materials';
import { createShape } from '../src/core/scene';
import { voxelizeScene } from '../src/core/voxelize';

test('the material list has 74 block and 61 terrain materials, each named once', () => {
  assert.equal(BLOCK_MATERIALS.length, 74);
  assert.equal(TERRAIN_MATERIALS.length, 61);
  assert.equal(new Set(MATERIALS.map((m) => m.materialItem)).size, MATERIALS.length, 'unique ids');
  assert.ok(MATERIALS.every((m) => m.name.trim().length > 0), 'every material has a name');
  assert.ok(MATERIALS.every((m) => /^#[0-9a-f]{6}$/.test(m.color)), 'every material has a preview color');
});

test('known materials are where they should be', () => {
  assert.equal(materialById(DEFAULT_MATERIAL)?.name, 'Weathered Stone Block');
  assert.equal(materialById(310129061)?.kind, 'block');
  const stone = materialById(631520303);
  assert.equal(stone?.name, 'Stone');
  assert.equal(stone?.kind, 'terrain');
  assert.equal(materialById(2851443310)?.name, 'Basalt');
});

test('a shape can be built from a terrain material', () => {
  const snow = TERRAIN_MATERIALS.find((m) => m.name === 'Snow')!;
  const out = voxelizeScene([{ ...createShape('box'), materialItem: snow.materialItem }]);
  assert.ok(out.length > 0 && out.every((v) => v.materialItem === snow.materialItem));
});
