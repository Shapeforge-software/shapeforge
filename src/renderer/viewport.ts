import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { YAW_QUATERNION, type RoofPiece, type RoofPieceType } from '../core/roofs';
import { VOXEL_SIZE, type Vec3, type Voxel } from '../core/types';

/**
 * A Roof Side drawn as a sloped slab in the piece's own frame, pivot at the origin: it is high at x = 0 and slopes
 * down toward +x at 45 degrees, with the 0.5 m eave reaching to x = run + 0.5, and it is `run` wide along z.
 */
function roofSideGeometry(run: number): THREE.BufferGeometry {
  const z0 = 0, z1 = run;
  // Profile in (x, y): top surface from the high edge down to the eave tip, underside 0.5 m below it.
  const A = [0, run + 0.5], B = [run + 0.5, 0], C = [run, 0], D = [0, run];
  const v = ([x, y]: number[], z: number) => [x, y, z];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
  const pts = [
    ...quad(v(A, z0), v(A, z1), v(B, z1), v(B, z0)), // top slope
    ...quad(v(D, z0), v(C, z0), v(C, z1), v(D, z1)), // underside
    ...quad(v(B, z0), v(B, z1), v(C, z1), v(C, z0)), // eave bottom
    ...quad(v(A, z0), v(D, z0), v(D, z1), v(A, z1)), // high edge
    ...quad(v(A, z0), v(B, z0), v(C, z0), v(D, z0)), // side
    ...quad(v(A, z1), v(D, z1), v(C, z1), v(B, z1)), // other side
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A roof corner drawn in its own frame: a square R = run + 0.5 on each side, with a top surface made of two 45-degree
 * facets and an underside 0.5 m below it (resting on y = 0 where it would go lower).
 * Outer (hip): peaks at (x = 0, z = R), sloping down toward +x and -z.
 * Inner (valley): high along x = 0 and z = 0, sloping down toward +x and +z.
 */
function roofCornerGeometry(run: number, form: 'outer' | 'inner'): THREE.BufferGeometry {
  const R = run + 0.5, H = R;
  const top = form === 'outer'
    ? (x: number, z: number) => H - Math.max(x, R - z)
    : (x: number, z: number) => H - Math.min(x, z);
  const facets: [number, number][][] = form === 'outer'
    ? [[[0, R], [R, R], [R, 0]], [[0, R], [R, 0], [0, 0]]]
    : [[[0, 0], [0, R], [R, R]], [[0, 0], [R, R], [R, 0]]];
  const up = (x: number, z: number) => [x, top(x, z), z];
  const down = (x: number, z: number) => [x, Math.max(0, top(x, z) - 0.5), z];
  const pts: number[] = [];
  for (const f of facets) {
    pts.push(...f.flatMap(([x, z]) => up(x, z)));
    pts.push(...[...f].reverse().flatMap(([x, z]) => down(x, z)));
  }
  // Edges all round, between the top and the underside.
  const ring: [number, number][] = [[0, 0], [R, 0], [R, R], [0, R]];
  ring.forEach(([x0, z0], n) => {
    const [x1, z1] = ring[(n + 1) % 4];
    const a = up(x0, z0), b = up(x1, z1), c = down(x1, z1), d = down(x0, z0);
    pts.push(...a, ...b, ...c, ...a, ...c, ...d);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return g;
}

function roofGeometry(type: RoofPieceType): THREE.BufferGeometry {
  if (type.form === 'cube') return new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(0.25, 0.25, 0.25);
  return type.form === 'side' ? roofSideGeometry(type.run) : roofCornerGeometry(type.run, type.form);
}

/** Cubes are drawn slightly smaller than a cell so individual blocks stay countable. */
const CUBE_DRAW_SIZE = VOXEL_SIZE * 0.92;

export class Viewport {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly geometry = new THREE.BoxGeometry(CUBE_DRAW_SIZE, CUBE_DRAW_SIZE, CUBE_DRAW_SIZE);
  private readonly material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  private mesh: THREE.InstancedMesh | null = null;
  private readonly roofMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  /** One instanced mesh per roof piece type, by blueprintId. */
  private readonly roofMeshes = new Map<number, THREE.InstancedMesh>();
  private readonly roofTypes = new Map<number, RoofPieceType>();
  private grid: THREE.GridHelper | null = null;
  private bounds = new THREE.Box3();
  private selectionBox = new THREE.Box3();
  private selection: THREE.Box3Helper | null = null;

  /** Outlines the selected shape's bounding box, or clears the outline when given null. */
  private readonly anchorBox = new THREE.Box3();
  private readonly pinBox = new THREE.Box3();
  private anchorHelpers: [THREE.Box3Helper, THREE.Box3Helper] | null = null;
  private anchorKind: 'auto' | 'picked' | null = null;

  /**
   * Marks the block the blueprint lands on (cell indices): an outline round it and a thin pin standing up from it,
   * bright once picked, pale for the default.
   */
  setAnchor(cell: Vec3 | null, kind: 'auto' | 'picked'): void {
    if (!cell) {
      if (this.anchorHelpers) for (const h of this.anchorHelpers) h.visible = false;
      return;
    }
    const S = VOXEL_SIZE, g = 0.04;
    const [x, y, z] = cell.map((c) => c * S);
    this.anchorBox.min.set(x - g, y - g, z - g);
    this.anchorBox.max.set(x + S + g, y + S + g, z + S + g);
    this.pinBox.min.set(x + S / 2 - 0.03, y + S, z + S / 2 - 0.03);
    this.pinBox.max.set(x + S / 2 + 0.03, y + S + 1.5, z + S / 2 + 0.03);
    // A new pair when the colour changes.
    if (this.anchorHelpers && this.anchorKind !== kind) {
      for (const h of this.anchorHelpers) this.scene.remove(h);
      this.anchorHelpers = null;
    }
    if (!this.anchorHelpers) {
      const colour = new THREE.Color(kind === 'auto' ? '#8fc4e0' : '#ffd23a');
      this.anchorHelpers = [new THREE.Box3Helper(this.anchorBox, colour), new THREE.Box3Helper(this.pinBox, colour)];
      for (const h of this.anchorHelpers) this.scene.add(h);
      this.anchorKind = kind;
    }
    for (const h of this.anchorHelpers) h.visible = true;
  }

  private light = false;

  /** Light or dark: the background and the ground grid (the blocks keep their own colours). */
  setTheme(theme: 'light' | 'dark'): void {
    this.light = theme === 'light';
    this.scene.background = new THREE.Color(this.light ? '#d9dde1' : '#1b1e22');
    this.updateGrid();
  }

  /** Where the camera is and looks (each open file keeps its own view). */
  getView(): { position: Vec3; target: Vec3 } {
    const p = this.camera.position, t = this.controls.target;
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  setView(v: { position: Vec3; target: Vec3 }): void {
    this.camera.position.set(...v.position);
    this.controls.target.set(...v.target);
    this.controls.update();
  }

  setSelection(bounds: { min: Vec3; max: Vec3 } | null): void {
    if (!bounds) {
      if (this.selection) this.selection.visible = false;
      return;
    }
    this.selectionBox.min.set(...bounds.min);
    this.selectionBox.max.set(...bounds.max);
    if (!this.selection) {
      this.selection = new THREE.Box3Helper(this.selectionBox, new THREE.Color('#e0a040'));
      this.scene.add(this.selection);
    }
    this.selection.visible = true;
  }

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#1b1e22');
    this.scene.add(new THREE.HemisphereLight('#dfe6ee', '#3a3128', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(0.6, 1, 0.4);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
    this.camera.position.set(12, 10, 12);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Replaces what is drawn. colorFor maps a materialItem to a CSS color. */
  setVoxels(voxels: Voxel[], colorFor: (materialItem: number) => string): void {
    if (!this.mesh || this.mesh.instanceMatrix.count < voxels.length) {
      if (this.mesh) {
        this.scene.remove(this.mesh);
        this.mesh.dispose();
      }
      const capacity = Math.max(1024, Math.ceil(voxels.length * 1.5));
      this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
      this.scene.add(this.mesh);
    }
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    const half = VOXEL_SIZE / 2;
    this.bounds.makeEmpty();
    voxels.forEach((v, n) => {
      const x = v.i * VOXEL_SIZE + half, y = v.j * VOXEL_SIZE + half, z = v.k * VOXEL_SIZE + half;
      m.makeTranslation(x, y, z);
      this.mesh!.setMatrixAt(n, m);
      this.mesh!.setColorAt(n, color.set(colorFor(v.materialItem)));
      this.bounds.expandByPoint(new THREE.Vector3(x - half, y - half, z - half));
      this.bounds.expandByPoint(new THREE.Vector3(x + half, y + half, z + half));
    });
    this.mesh.count = voxels.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.updateGrid();
  }

  /** Draws roof pieces. Call after setVoxels, since it adds to the model's bounds. */
  setRoofs(pieces: RoofPiece[], colorFor: (materialItem: number) => string): void {
    const order = new Map(pieces.map((p, n) => [p, n] as const));
    const byType = new Map<number, RoofPiece[]>();
    for (const p of pieces) {
      byType.set(p.type.blueprintId, [...(byType.get(p.type.blueprintId) ?? []), p]);
      this.roofTypes.set(p.type.blueprintId, p.type);
    }
    for (const id of new Set([...byType.keys(), ...this.roofMeshes.keys()])) {
      const list = byType.get(id) ?? [];
      let mesh = this.roofMeshes.get(id);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) {
          this.scene.remove(mesh);
          mesh.dispose();
        }
        mesh = new THREE.InstancedMesh(roofGeometry(this.roofTypes.get(id)!), this.roofMaterial, Math.max(64, list.length * 2));
        this.roofMeshes.set(id, mesh);
        this.scene.add(mesh);
      }
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      const color = new THREE.Color();
      list.forEach((p, n) => {
        q.set(...YAW_QUATERNION[p.yaw]);
        // Where pieces overlap in the same slope (an eave over the row below), the game draws the one listed later;
        // lifting each a hair by its place in the list does the same here instead of flickering between them.
        const lift = (order.get(p) ?? 0) * 1e-4;
        m.compose(new THREE.Vector3(p.pos[0], p.pos[1] + lift, p.pos[2]), q, one);
        mesh!.setMatrixAt(n, m);
        mesh!.setColorAt(n, color.set(colorFor(p.materialItem)));
        this.bounds.expandByPoint(new THREE.Vector3(...p.min));
        this.bounds.expandByPoint(new THREE.Vector3(...p.max));
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.updateGrid();
  }

  private updateGrid(): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.dispose();
      this.grid = null;
    }
    if (this.bounds.isEmpty()) return;
    const size = this.bounds.getSize(new THREE.Vector3());
    const span = Math.ceil(Math.max(size.x, size.z) + 8);
    const center = this.bounds.getCenter(new THREE.Vector3());
    // One grid line per meter, laid at the bottom of the model.
    this.grid = new THREE.GridHelper(span, span, this.light ? '#a7aeb6' : '#4a5560', this.light ? '#cdd2d7' : '#2c333a');
    this.grid.position.set(Math.round(center.x), this.bounds.min.y - 0.001, Math.round(center.z));
    this.scene.add(this.grid);
  }

  /** The canvas, for the tools' mouse handling. */
  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  /**
   * Whether a left drag turns the view (the Navigate tool) or is left to the other tools. With it left free, the
   * right button turns the view and the middle button pans; the wheel always zooms.
   */
  setLeftDragTurns(on: boolean): void {
    const buttons = (this.controls as unknown as { mouseButtons?: Record<string, number> }).mouseButtons;
    if (!buttons) return;
    buttons.LEFT = on ? THREE.MOUSE.ROTATE : -1;
    buttons.MIDDLE = on ? THREE.MOUSE.DOLLY : THREE.MOUSE.PAN;
    buttons.RIGHT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  }

  /** The ray from the camera through a point of the canvas (client coordinates). */
  rayAt(clientX: number, clientY: number): { origin: Vec3; dir: Vec3 } {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector3(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5);
    this.camera.updateMatrixWorld();
    const p = ndc.unproject(this.camera);
    const o = this.camera.position;
    const d = p.sub(o).normalize();
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
  }

  /** Canvas client coordinates to screen coordinates (-1..1, y up). */
  toScreen(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1];
  }

  /** The camera's view-projection matrix (column-major). */
  viewProjection(): number[] {
    this.camera.updateMatrixWorld();
    return new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).toArray();
  }

  /** Which way the camera looks, flattened onto the ground (for walking), and how far it is from what it turns round. */
  heading(): { forward: Vec3; right: Vec3; distance: number } {
    const d = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
    const distance = d.length();
    d.y = 0;
    if (d.lengthSq() < 1e-9) d.set(0, 0, -1);
    d.normalize();
    return { forward: [d.x, 0, d.z], right: [-d.z, 0, d.x], distance };
  }

  /** Moves the camera and the point it turns round together (flying, or up and down). */
  moveBy(v: Vec3): void {
    const t = new THREE.Vector3(...v);
    this.camera.position.add(t);
    this.controls.target.add(t);
  }

  /** Swings the camera round the point it looks at (about the vertical), and in or out toward it. */
  orbitBy(yawRadians: number, zoom = 1): void {
    const off = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const c = Math.cos(yawRadians), sn = Math.sin(yawRadians);
    const x = off.x * c + off.z * sn, z = -off.x * sn + off.z * c;
    off.set(x, off.y, z).multiplyScalar(zoom);
    if (off.length() < 0.5) off.setLength(0.5);
    this.camera.position.copy(this.controls.target).add(off);
  }

  /** Points the camera at the whole model. */
  fit(): void {
    if (this.bounds.isEmpty()) return;
    const center = this.bounds.getCenter(new THREE.Vector3());
    const radius = this.bounds.getSize(new THREE.Vector3()).length() / 2;
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.1;
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.controls.target.copy(center);
    this.controls.update();
  }
}
