import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isProjectPath, KnownFiles } from '../src/core/known-files';

test('Windows paths match whatever their case and slashes', () => {
  const k = new KnownFiles(true);
  k.add('C:\\Builds\\Tower.shapeforge');
  assert.ok(k.has('c:/builds/tower.SHAPEFORGE'));
  assert.ok(!k.has('C:\\Builds\\Other.shapeforge'));
  assert.ok(!k.has('C:\\Windows\\System32\\drivers\\etc\\hosts'));
});

test('elsewhere, case counts', () => {
  const k = new KnownFiles(false);
  k.add('/home/a/T.shapeforge');
  assert.ok(k.has('/home/a/T.shapeforge'));
  assert.ok(!k.has('/home/a/t.shapeforge'));
});

test('keeps the newest, up to its limit, and reloads what it saved', () => {
  const k = new KnownFiles(true, 3);
  for (const n of [1, 2, 3, 4]) k.add(`C:\\p\\${n}.shapeforge`);
  k.add('C:\\p\\2.shapeforge');
  assert.deepEqual(k.list(), ['C:\\p\\3.shapeforge', 'C:\\p\\4.shapeforge', 'C:\\p\\2.shapeforge']);
  const again = new KnownFiles(true, 3);
  again.load([...k.list(), 42, null, { x: 1 }]);
  assert.deepEqual(again.list(), k.list());
  again.load('not a list');
  assert.equal(again.list().length, 3);
});

test('only project files are taken on when updating', () => {
  assert.ok(isProjectPath('C:\\p\\a.shapeforge'));
  assert.ok(isProjectPath('C:\\p\\old.shapeforge.json'));
  assert.ok(!isProjectPath('C:\\Users\\me\\.ssh\\id_rsa'));
  assert.ok(!isProjectPath(7));
});
