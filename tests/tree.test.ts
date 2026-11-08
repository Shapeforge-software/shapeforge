import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProject, serializeProject } from '../src/core/project';
import { cloneShape, createShape } from '../src/core/scene';
import {
  addFolder, buildTree, canStep, deleteFolder, duplicateFolder, flatten, folderPath, freeFolderName, insertAfter, insertShape,
  moveItem, normalize, shapesIn, stepItem, wrapInFolder, type Scene, type TreeNode,
} from '../src/core/tree';
import type { Folder, Shape } from '../src/core/types';

const shape = (name: string, folder?: string): Shape => ({ ...createShape('box'), name, ...(folder ? { folder } : {}) });
const folder = (id: string, parent: string | null = null): Folder => ({ id, name: id, parent, open: true });
const names = (s: Scene) => s.shapes.map((x) => x.name);
/** The tree as text: folders as name[...]. */
const show = (t: TreeNode[]): string => t.map((n) => (n.type === 'shape' ? n.shape.name : `${n.folder.name}[${show(n.children)}]`)).join(' ');

test('a folder keeps its shapes together, standing where its first shape is', () => {
  const scene = { shapes: [shape('a'), shape('b', 'F'), shape('c'), shape('d', 'F'), shape('e', 'G')], folders: [folder('F'), folder('G', 'F')] };
  const n = normalize(scene);
  assert.deepEqual(names(n), ['a', 'b', 'd', 'e', 'c']);
  assert.equal(show(buildTree(n)), 'a F[b d G[e]] c');
  // Already in order: unchanged.
  assert.deepEqual(names(normalize(n)), names(n));
});

test('unknown folders and folder loops fall back to the top level', () => {
  const n = normalize({ shapes: [shape('a', 'nope'), shape('b', 'X')], folders: [folder('X', 'Y'), folder('Y', 'X')] });
  assert.equal(n.shapes[0].folder, undefined);
  assert.equal(show(buildTree(n)).includes('b'), true);
  assert.equal(n.folders.filter((f) => f.parent === null).length >= 1, true);
});

test('empty folders stand at the end of their folder', () => {
  const n = normalize({ shapes: [shape('a'), shape('b', 'F')], folders: [folder('E'), folder('F'), folder('E2', 'F')] });
  assert.equal(show(buildTree(n)), 'a F[b E2[]] E[]');
});

test('moving shapes and folders in, out and between keeps the order whole', () => {
  let s: Scene = normalize({ shapes: [shape('a'), shape('b'), shape('c'), shape('d')], folders: [folder('F')] });
  const id = (nm: string) => s.shapes.find((x) => x.name === nm)!.id;
  s = moveItem(s, id('c'), { parent: 'F' });
  assert.equal(show(buildTree(s)), 'a b d F[c]');
  s = moveItem(s, 'F', { parent: null, before: id('b') });
  assert.equal(show(buildTree(s)), 'a F[c] b d');
  s = moveItem(s, id('a'), { parent: 'F', before: id('c') });
  assert.equal(show(buildTree(s)), 'F[a c] b d');
  assert.deepEqual(names(s), ['a', 'c', 'b', 'd']);
  // A folder can't go inside itself.
  s = addFolder(s, folder('G'), { parent: 'F' });
  assert.equal(show(buildTree(s)), 'F[a c G[]] b d');
  assert.equal(moveItem(s, 'F', { parent: 'G' }), s);
  // Out again.
  s = moveItem(s, id('a'), { parent: null });
  assert.equal(show(buildTree(s)), 'F[c G[]] b d a');
  assert.equal(s.shapes.find((x) => x.name === 'a')!.folder, undefined);
  assert.equal(s.shapes.find((x) => x.name === 'c')!.folder, 'F');
});

test('up and down move an item among the items beside it, a folder with all its shapes', () => {
  let s: Scene = normalize({ shapes: [shape('a'), shape('b', 'F'), shape('c', 'F'), shape('d')], folders: [folder('F')] });
  const id = (nm: string) => s.shapes.find((x) => x.name === nm)!.id;
  assert.equal(canStep(s, id('b'), -1), false);
  s = stepItem(s, id('b'), 1);
  assert.equal(show(buildTree(s)), 'a F[c b] d');
  s = stepItem(s, 'F', -1);
  assert.equal(show(buildTree(s)), 'F[c b] a d');
  assert.deepEqual(names(s), ['c', 'b', 'a', 'd']);
  s = stepItem(s, 'F', 1);
  s = stepItem(s, 'F', 1);
  assert.equal(show(buildTree(s)), 'a d F[c b]');
  assert.equal(canStep(s, 'F', 1), false);
});

test('new shapes go at the end of a folder, or straight after a shape', () => {
  let s: Scene = normalize({ shapes: [shape('a', 'F'), shape('b')], folders: [folder('F')] });
  s = insertShape(s, shape('n'), 'F');
  assert.equal(show(buildTree(s)), 'F[a n] b');
  s = insertAfter(s, shape('m'), s.shapes[0].id);
  assert.equal(show(buildTree(s)), 'F[a m n] b');
  s = insertShape(s, shape('z'), null);
  assert.equal(show(buildTree(s)), 'F[a m n] b z');
});

test('deleting a folder keeps or drops what is in it', () => {
  const s = normalize({ shapes: [shape('a'), shape('b', 'G'), shape('c', 'F'), shape('d')], folders: [folder('F'), folder('G', 'F')] });
  assert.equal(show(buildTree(s)), 'a F[G[b] c] d');
  const kept = deleteFolder(s, 'F', true);
  assert.equal(show(buildTree(kept)), 'a G[b] c d');
  assert.equal(kept.folders.find((f) => f.id === 'G')!.parent, null);
  const gone = deleteFolder(s, 'F', false);
  assert.equal(show(buildTree(gone)), 'a d');
  assert.equal(gone.folders.length, 0);
});

test('duplicating a folder copies everything in it, straight after it', () => {
  const s = normalize({ shapes: [shape('a', 'F'), shape('b', 'G'), shape('c')], folders: [folder('F'), folder('G', 'F')] });
  const { scene, id } = duplicateFolder(s, 'F', cloneShape);
  assert.equal(show(buildTree(scene)), 'F[a G[b]] F[a G[b]] c');
  assert.notEqual(id, 'F');
  assert.equal(new Set(scene.shapes.map((x) => x.id)).size, 5);
  assert.equal(new Set(scene.folders.map((x) => x.id)).size, 4);
  assert.equal(shapesIn(scene, id).length, 2);
});

test('folder paths and free names', () => {
  const s = normalize({ shapes: [shape('a', 'G')], folders: [folder('F'), folder('G', 'F')] });
  assert.deepEqual(folderPath(s, 'G').map((f) => f.id), ['F', 'G']);
  assert.equal(freeFolderName(s, null), 'Folder');
  assert.equal(freeFolderName({ ...s, folders: [...s.folders, { ...folder('x'), name: 'Folder' }] }, null), 'Folder 2');
});

test('projects keep shape names and folders', () => {
  const s = normalize({ shapes: [shape('Front wall', 'F'), shape('Roof')], folders: [{ ...folder('F'), name: 'House', open: false }, folder('G', 'F')] });
  const back = parseProject(serializeProject({ name: 'p', shapes: s.shapes, folders: s.folders }));
  assert.deepEqual(back.shapes.map((x) => [x.name, x.folder]), [['Front wall', 'F'], ['Roof', undefined]]);
  assert.deepEqual(back.folders, s.folders);
  // Older files: no folders, no names.
  const old = parseProject(serializeProject({ name: 'p', shapes: [createShape('box')] }));
  assert.equal(old.shapes[0].name, undefined);
  assert.deepEqual(old.folders, []);
  // flatten of an empty tree
  assert.deepEqual(flatten([]), { shapes: [], folders: [] });
});

test('a new folder round an item stands where the item was', () => {
  let s: Scene = normalize({ shapes: [shape('a'), shape('b', 'F'), shape('c')], folders: [folder('F')] });
  s = wrapInFolder(s, folder('W'), s.shapes[1].id);
  assert.equal(show(buildTree(s)), 'a F[W[b]] c');
  s = wrapInFolder(s, folder('X'), 'F');
  assert.equal(show(buildTree(s)), 'a X[F[W[b]]] c');
  assert.deepEqual(names(s), ['a', 'b', 'c']);
});
