import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectError, parseProject, projectNameFromPath, serializeProject } from '../src/core/project';
import { createShape } from '../src/core/scene';
import { SHAPE_LIST } from '../src/core/shapes';
import type { Shape } from '../src/core/types';
import { voxelizeScene } from '../src/core/voxelize';

function sampleShapes(): Shape[] {
  const tower = { ...createShape('cylinder'), position: [0, 4, 0] as [number, number, number], materialItem: 310129061 };
  const door = { ...createShape('box'), op: 'subtract' as const, fill: 'filled' as const, position: [0, 1.5, 3.5] as [number, number, number] };
  const star = { ...createShape('star3d'), rotation: [-90, 15, 0] as [number, number, number], lineWeight: 'thin' as const, wallThickness: 2 };
  return [tower, door, star];
}

test('a project round-trips: same shapes, same blocks, new ids', () => {
  const shapes = sampleShapes();
  const back = parseProject(serializeProject({ name: 'My "tower"', shapes }));
  assert.equal(back.name, 'My "tower"');
  assert.equal(back.shapes.length, 3);
  back.shapes.forEach((s, i) => {
    const { id, ...rest } = s;
    const { id: origId, ...orig } = shapes[i];
    assert.notEqual(id, origId);
    assert.deepEqual(rest, orig);
  });
  assert.equal(voxelizeScene(back.shapes).length, voxelizeScene(shapes).length);
});

test('every shape type survives a save and load', () => {
  const shapes = SHAPE_LIST.map((d) => createShape(d.kind));
  const back = parseProject(serializeProject({ name: 'all', shapes }));
  assert.deepEqual(back.shapes.map((s) => s.kind), shapes.map((s) => s.kind));
  back.shapes.forEach((s, i) => assert.deepEqual(s.params, shapes[i].params));
});

test('saved files are readable JSON without runtime ids', () => {
  const text = serializeProject({ name: 'x', shapes: sampleShapes() });
  const data = JSON.parse(text);
  assert.equal(data.format, 'shapeforge-project');
  assert.equal(data.version, 2);
  assert.ok(!('id' in data.shapes[0]));
  assert.ok(text.includes('\n  "shapes"'), 'pretty-printed');
});

test('missing and out-of-range values fall back to safe defaults', () => {
  const text = JSON.stringify({
    format: 'shapeforge-project', version: 1,
    shapes: [{ kind: 'vortex', params: { arms: 99, outerRadius: 'big' }, position: [1, 'x'], fill: 'sparkly', wallThickness: 40, op: 'explode' }],
  });
  const { name, shapes } = parseProject(text);
  const s = shapes[0];
  // No name: blank, so the blueprint takes the project file's name.
  assert.equal(name, '');
  assert.equal(s.params.arms, 12);
  assert.equal(s.params.outerRadius, 8);
  assert.deepEqual(s.position, [0, 0, 0]);
  assert.equal(s.fill, 'hollow');
  assert.equal(s.wallThickness, 8);
  assert.equal(s.op, 'add');
  assert.equal(s.materialItem, 1406367026);
});

test('bad files give readable errors', () => {
  const cases: [string, RegExp][] = [
    ['not json', /not valid JSON/],
    ['{"format":"ebt-blueprint","version":1,"pieces":[]}', /not a ShapeForge project/],
    ['{"format":"shapeforge-project","version":3,"shapes":[]}', /newer version/],
    ['{"format":"shapeforge-project","version":1}', /no shape list/],
    ['{"format":"shapeforge-project","version":1,"shapes":[{"kind":"teapot"}]}', /Shape 1 has an unknown type "teapot"/],
  ];
  for (const [text, message] of cases) {
    assert.throws(() => parseProject(text), (e: unknown) => e instanceof ProjectError && message.test(e.message));
  }
});

test('project names come from file names', () => {
  assert.equal(projectNameFromPath('C:\\builds\\castle.shapeforge'), 'castle');
  assert.equal(projectNameFromPath('C:\\builds\\keep.shapeforge.json'), 'keep', 'older files');
  assert.equal(projectNameFromPath('/home/me/tower.json'), 'tower');
  assert.equal(projectNameFromPath('plain'), 'plain');
});

test('a blank blueprint name is kept blank (it follows the file\'s name); the old default "shapeforge" counts as blank; a typed name is kept', () => {
  const save = (name: string) => parseProject(serializeProject({ name, shapes: [] })).name;
  assert.equal(save(''), '');
  assert.equal(save('shapeforge'), '');
  assert.equal(save('Ember Hall'), 'Ember Hall');
  assert.equal(projectNameFromPath('C:\\builds\\Castle Gate.shapeforge'), 'Castle Gate');
});

test('a shape type that is only an object built-in is refused cleanly', () => {
  for (const kind of ['__proto__', 'toString', 'constructor']) {
    const saved = JSON.parse(serializeProject({ name: 'x', shapes: [createShape('box')], folders: [] } as never));
    saved.shapes[0].kind = kind;
    const text = JSON.stringify(saved);
    assert.throws(() => parseProject(text), /unknown type/);
  }
});
