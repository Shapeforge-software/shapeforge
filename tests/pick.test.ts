import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupBounds, toolTurn, turnPivot, turnRules } from '../src/core/group';
import { blockOwners, castGrid, pickShape, project, rayBox, rayPlane, shapesInRect, type Ray } from '../src/core/pick';
import { createShape } from '../src/core/scene';
import { cleanParams } from '../src/core/shapes';
import type { Shape, Vec3 } from '../src/core/types';
import { CellCache, shapeCells } from '../src/core/voxelize';
import { key, unkey } from '../src/core/voxelize-keys';

const at = (kind: Parameters<typeof createShape>[0], position: Vec3, extra: Partial<Shape> = {}): Shape => ({ ...createShape(kind), position, fill: 'filled', ...extra });
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return v.map((x) => x / l) as Vec3; };
const rayTo = (from: Vec3, to: Vec3): Ray => ({ origin: from, dir: norm(to.map((v, a) => v - from[a]) as Vec3) });

/** A camera's view-projection matrix (column-major), as three.js makes it: perspective times look-at. */
function viewProj(eye: Vec3, target: Vec3, fovDeg = 45, aspect = 1.5, near = 0.1, far = 1000): number[] {
  const z = norm(eye.map((v, a) => v - target[a]) as Vec3);
  // x = up × z, y = z × x
  const up: Vec3 = [0, 1, 0];
  const cx: Vec3 = norm([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
  const cy: Vec3 = [z[1] * cx[2] - z[2] * cx[1], z[2] * cx[0] - z[0] * cx[2], z[0] * cx[1] - z[1] * cx[0]];
  const view = [cx[0], cy[0], z[0], 0, cx[1], cy[1], z[1], 0, cx[2], cy[2], z[2], 0,
    -(cx[0] * eye[0] + cx[1] * eye[1] + cx[2] * eye[2]), -(cy[0] * eye[0] + cy[1] * eye[1] + cy[2] * eye[2]), -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1];
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += proj[k * 4 + r] * view[c * 4 + k];
  return out;
}

test('a ray finds the first block in its way, walking the grid', () => {
  const solid = new Set([key(4, 0, 0), key(8, 0, 0)]);
  const hit = castGrid({ origin: [0.25, 0.25, 0.25], dir: [1, 0, 0] }, (n) => solid.has(n), 0, 100);
  assert.equal(hit?.cell, key(4, 0, 0));
  assert.ok(Math.abs(hit!.t - 1.75) < 1e-6);
  // Diagonally, through a box's corner region.
  const d = castGrid(rayTo([-5, 5, -5], [2.25, 0.25, 2.25]), (n) => n === key(4, 0, 4), 0, 100);
  assert.equal(d?.cell, key(4, 0, 4));
  assert.deepEqual(rayBox({ origin: [0, 0, 0], dir: [1, 0, 0] }, [2, -1, -1], [3, 1, 1]), [2, 3]);
  assert.equal(rayBox({ origin: [0, 5, 0], dir: [1, 0, 0] }, [2, -1, -1], [3, 1, 1]), null);
});

test('a click picks the shape whose visible block is first along the ray, not one cut away or hidden behind', () => {
  const cache = new CellCache();
  const front = at('box', [0, 3, 6], { params: { ...createShape('box').params, width: 2, height: 2, depth: 2 } });
  const back = at('box', [0, 3, 0]);
  const hole = at('box', [0, 3, 6], { op: 'subtract', params: { ...createShape('box').params, width: 1, height: 1, depth: 4 } });
  const eye: Vec3 = [0, 3.1, 30];
  const owners = blockOwners([back, front], cache);
  assert.equal(pickShape(rayTo(eye, [0, 3.1, 0]), [back, front], owners), front.id);
  // Through the hole cut in the front box: the back one.
  const owners2 = blockOwners([back, front, hole], cache);
  assert.equal(pickShape(rayTo(eye, [0.1, 3.1, 0]), [back, front, hole], owners2), back.id);
  // Missing everything.
  assert.equal(pickShape(rayTo(eye, [40, 40, 0]), [back, front], owners), null);
  // A roof made of pieces is hit by its box.
  const roof = { ...createShape('roofGable'), position: [20, 1.5, 0] as Vec3 };
  assert.equal(pickShape(rayTo([20, 30, 0.1], [20, 0, 0]), [back, roof], blockOwners([back, roof], cache)), roof.id);
});

test('a dragged box takes in every shape with any part inside it on screen', () => {
  const cache = new CellCache();
  const a = at('box', [-6, 3, 0]), b = at('box', [6, 3, 0]), c = at('cylinder', [0, 3, -30]);
  const m = viewProj([0, 8, 30], [0, 3, 0]);
  const pa = project(m, a.position)!, pb = project(m, b.position)!;
  assert.ok(pa[0] < 0 && pb[0] > 0, 'left box on the left of the screen');
  // A box over the left half takes the left box and the far cylinder (straddling the middle), not the right box.
  const left = shapesInRect(m, { x0: -1, y0: -1, x1: 0.02, y1: 1 }, [a, b, c], cache);
  assert.deepEqual(left.sort(), [a.id, c.id].sort());
  // Grazing just a corner of the right box is enough.
  const edge = Math.min(...[...shapeCells(b)].map((n) => project(m, unkey(n).map((v) => v * 0.5 + 0.25) as Vec3)![0]));
  assert.deepEqual(shapesInRect(m, { x0: edge - 0.001, y0: -1, x1: edge + 0.01, y1: 1 }, [b], cache), [b.id]);
  assert.deepEqual(shapesInRect(m, { x0: 0.95, y0: 0.95, x1: 1, y1: 1 }, [a, b], cache), []);
  // Behind the camera: not taken.
  assert.equal(project(m, [0, 3, 60]), null);
});

test('a drag on the ground plane finds the point under the mouse', () => {
  const p = rayPlane(rayTo([0, 10, 10], [2, 0, 3]), [0, 0, 0], [0, 1, 0])!;
  assert.ok(Math.abs(p[0] - 2) < 1e-9 && Math.abs(p[2] - 3) < 1e-9 && Math.abs(p[1]) < 1e-9);
  assert.equal(rayPlane({ origin: [0, 10, 0], dir: [1, 0, 0] }, [0, 0, 0], [0, 1, 0]), null);
});

test('rotation tool rules: 5° steps on any axis; quarter turns with an imported layer; roofs only about the vertical', () => {
  const box = at('box', [0, 3, 0]), cyl = at('cylinder', [6, 3, 0]);
  const roof = { ...createShape('roofGable'), position: [0, 1.5, 10] as Vec3 };
  assert.deepEqual(turnRules([box, cyl]), { axes: [true, true, true], step: 5 });
  assert.equal(turnRules([box, roof]).step, 90);
  assert.deepEqual(turnRules([box, roof]).axes, [false, true, false]);
  const pivot = turnPivot([box, cyl]);
  // 37° asked: 35° made, both turned as one round their middle.
  const t = toolTurn([box, cyl], 1, 37, pivot);
  assert.equal(t.degrees, 35);
  assert.deepEqual(t.shapes[0].rotation, [0, 35, 0]);
  const c0 = groupBounds([box, cyl]).center;
  assert.ok(Math.hypot(t.shapes[1].position[0] - pivot[0], t.shapes[1].position[2] - pivot[2]) - Math.hypot(cyl.position[0] - c0[0], cyl.position[2] - c0[2]) < 1e-6);
  // Tilting with a roof selected does nothing; a quarter turn turns the roof's facing.
  assert.equal(toolTurn([box, roof], 0, 90, turnPivot([box, roof])).degrees, 0);
  const q = toolTurn([roof], 1, 80, turnPivot([roof]));
  assert.equal(q.degrees, 90);
  assert.notEqual(cleanParams('roofGable', q.shapes[0].params).facing, cleanParams('roofGable', roof.params).facing);
  // Too small a drag: nothing yet.
  assert.equal(toolTurn([box], 2, 2, pivot).degrees, 0);
});
