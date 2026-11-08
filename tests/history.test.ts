import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/core/history';

/** Simulates an editor: each edit records the old value, then changes it. */
function editor() {
  const h = new History<string>(5, 1000);
  let value = 'a';
  return {
    h,
    get value() { return value; },
    edit(next: string, group?: string, now?: number) { h.record(value, group, now); value = next; },
    undo() { const v = h.undo(value); if (v !== null) value = v; return v !== null; },
    redo() { const v = h.redo(value); if (v !== null) value = v; return v !== null; },
  };
}

test('undo and redo walk back and forth through changes', () => {
  const e = editor();
  e.edit('b'); e.edit('c');
  assert.ok(e.undo()); assert.equal(e.value, 'b');
  assert.ok(e.undo()); assert.equal(e.value, 'a');
  assert.equal(e.undo(), false); assert.equal(e.value, 'a');
  assert.ok(e.redo()); assert.equal(e.value, 'b');
  assert.ok(e.redo()); assert.equal(e.value, 'c');
  assert.equal(e.redo(), false);
});

test('a new change after undo drops the redo steps', () => {
  const e = editor();
  e.edit('b'); e.edit('c');
  e.undo();
  e.edit('x');
  assert.equal(e.h.canRedo, false);
  e.undo(); assert.equal(e.value, 'b');
});

test('quick edits to the same field merge into one step; pauses and other fields do not', () => {
  const e = editor();
  e.edit('1', 'radius', 0); e.edit('12', 'radius', 300); e.edit('12.5', 'radius', 600);
  e.undo(); assert.equal(e.value, 'a', 'typing undoes in one step');
  e.redo(); assert.equal(e.value, '12.5');
  e.edit('13', 'radius', 5000);
  e.undo(); assert.equal(e.value, '12.5', 'a pause starts a new step');
  e.edit('h', 'height', 5100); e.edit('w', 'width', 5200);
  e.undo(); assert.equal(e.value, 'h', 'different fields are separate steps');
});

test('an undo breaks the merge, so the next edit is its own step', () => {
  const e = editor();
  e.edit('1', 'r', 0);
  e.undo();
  e.edit('2', 'r', 100);
  e.edit('3', 'x', 200);
  e.undo(); assert.equal(e.value, '2');
  e.undo(); assert.equal(e.value, 'a');
});

test('history keeps at most the limit, dropping the oldest', () => {
  const e = editor();
  for (const v of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) e.edit(v);
  let steps = 0;
  while (e.undo()) steps++;
  assert.equal(steps, 5);
  assert.equal(e.value, 'c');
});

test('clear forgets everything', () => {
  const e = editor();
  e.edit('b'); e.undo();
  e.h.clear();
  assert.equal(e.h.canUndo, false);
  assert.equal(e.h.canRedo, false);
});
