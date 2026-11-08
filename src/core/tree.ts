import type { Folder, Shape } from './types';

/**
 * The shape list as a tree of folders. Shapes still apply top to bottom in one order (a subtract shape cuts the
 * shapes above it), so a folder is a run of the list: its shapes, and its folders' shapes, always sit together, and
 * the folder stands where its first shape is. An empty folder stands at the end of the folder it's in.
 *
 * Every change goes through the tree and is flattened back, which keeps that true: the shapes come out in the
 * tree's order, each with the folder it's under.
 */

export interface Scene {
  shapes: Shape[];
  folders: Folder[];
}

export type TreeNode =
  | { type: 'folder'; id: string; folder: Folder; children: TreeNode[] }
  | { type: 'shape'; id: string; shape: Shape };

let counter = 0;
export function newFolderId(): string {
  counter += 1;
  return `folder-${Date.now().toString(36)}-${counter}`;
}

/** Folders by id, with a missing parent or a loop (a folder inside itself) put back at the top. */
function folderMap(folders: Folder[]): Map<string, Folder> {
  const map = new Map(folders.map((f) => [f.id, f]));
  const fixed = new Map<string, Folder>();
  for (const f of folders) {
    const seen = new Set([f.id]);
    let p = f.parent;
    let ok = true;
    while (p !== null) {
      const up = map.get(p);
      if (!up || seen.has(p)) { ok = false; break; }
      seen.add(p);
      p = up.parent;
    }
    fixed.set(f.id, ok ? f : { ...f, parent: null });
  }
  return fixed;
}

export function buildTree(scene: Scene): TreeNode[] {
  const folders = folderMap(scene.folders);
  const root: TreeNode[] = [];
  const nodes = new Map<string, TreeNode & { type: 'folder' }>();
  const ensure = (id: string): TreeNode[] => {
    const have = nodes.get(id);
    if (have) return have.children;
    const folder = folders.get(id)!;
    const into = folder.parent === null ? root : ensure(folder.parent);
    const node = { type: 'folder' as const, id, folder, children: [] as TreeNode[] };
    nodes.set(id, node);
    into.push(node);
    return node.children;
  };
  for (const shape of scene.shapes) {
    const into = shape.folder && folders.has(shape.folder) ? ensure(shape.folder) : root;
    into.push({ type: 'shape', id: shape.id, shape });
  }
  for (const f of scene.folders) ensure(f.id);
  return root;
}

/** The scene in the tree's order, each shape and folder marked with the folder it's under. */
export function flatten(tree: TreeNode[]): Scene {
  const shapes: Shape[] = [];
  const folders: Folder[] = [];
  const walk = (list: TreeNode[], parent: string | null) => {
    for (const n of list) {
      if (n.type === 'shape') {
        const { folder: _f, ...rest } = n.shape;
        shapes.push(parent === null ? rest : { ...rest, folder: parent });
      } else {
        folders.push({ ...n.folder, parent });
        walk(n.children, n.id);
      }
    }
  };
  walk(tree, null);
  return { shapes, folders };
}

/** Puts a scene in order: each folder's shapes together, unknown folders dropped. */
export function normalize(scene: Scene): Scene {
  return flatten(buildTree(scene));
}

/** Finds a node and the list holding it. */
function locate(tree: TreeNode[], id: string): { list: TreeNode[]; index: number; node: TreeNode } | null {
  for (let i = 0; i < tree.length; i++) {
    const n = tree[i];
    if (n.id === id) return { list: tree, index: i, node: n };
    if (n.type === 'folder') {
      const inner = locate(n.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

/** The children of a folder, or the top of the list for null. */
function childrenOf(tree: TreeNode[], folder: string | null): TreeNode[] | null {
  if (folder === null) return tree;
  const at = locate(tree, folder);
  return at && at.node.type === 'folder' ? at.node.children : null;
}

const contains = (node: TreeNode, id: string): boolean =>
  node.id === id || (node.type === 'folder' && node.children.some((c) => contains(c, id)));

/** Shapes inside a folder, however deep, in order. */
export function shapesIn(scene: Scene, folder: string): Shape[] {
  const at = locate(buildTree(scene), folder);
  if (!at) return [];
  const out: Shape[] = [];
  const walk = (n: TreeNode) => { if (n.type === 'shape') out.push(n.shape); else n.children.forEach(walk); };
  walk(at.node);
  return out;
}

/** Folders a folder sits in, outermost first. */
export function folderPath(scene: Scene, id: string | undefined | null): Folder[] {
  const map = folderMap(scene.folders);
  const out: Folder[] = [];
  let p = id ?? null;
  while (p !== null && map.has(p)) { const f = map.get(p)!; out.unshift(f); p = f.parent; }
  return out;
}

/** Where to put something: inside `parent` (null for the top), before the item `before`, or at the end. */
export interface Place {
  parent: string | null;
  before?: string | null;
}

/**
 * Moves a shape or folder (with everything in it) to a new place. Nothing changes when the place is inside the
 * folder being moved, or doesn't exist.
 */
export function moveItem(scene: Scene, id: string, place: Place): Scene {
  const tree = buildTree(scene);
  const from = locate(tree, id);
  if (!from) return scene;
  if (place.parent !== null && contains(from.node, place.parent)) return scene;
  if (place.before === id) return scene;
  from.list.splice(from.index, 1);
  const into = childrenOf(tree, place.parent);
  if (!into) return scene;
  const at = place.before ? into.findIndex((n) => n.id === place.before) : -1;
  into.splice(at < 0 ? into.length : at, 0, from.node);
  return flatten(tree);
}

/** Moves an item one place up (-1) or down (1) among the items beside it, or out of the end of its folder. */
export function stepItem(scene: Scene, id: string, delta: -1 | 1): Scene {
  const tree = buildTree(scene);
  const at = locate(tree, id);
  if (!at) return scene;
  const j = at.index + delta;
  if (j < 0 || j >= at.list.length) return scene;
  [at.list[at.index], at.list[j]] = [at.list[j], at.list[at.index]];
  return flatten(tree);
}

/** Whether stepItem can move it that way. */
export function canStep(scene: Scene, id: string, delta: -1 | 1): boolean {
  const at = locate(buildTree(scene), id);
  return !!at && at.index + delta >= 0 && at.index + delta < at.list.length;
}

/** Adds a shape at the end of a folder (or the top level). */
export function insertShape(scene: Scene, shape: Shape, parent: string | null): Scene {
  return moveItem({ ...scene, shapes: [...scene.shapes, { ...shape, folder: undefined }] }, shape.id, { parent });
}

/** Adds a shape straight after another, in the same folder. */
export function insertAfter(scene: Scene, shape: Shape, after: string): Scene {
  const tree = buildTree({ ...scene, shapes: [...scene.shapes, { ...shape, folder: undefined }] });
  const node = tree.pop()!;
  const at = locate(tree, after);
  if (!at) { tree.push(node); return flatten(tree); }
  at.list.splice(at.index + 1, 0, node);
  return flatten(tree);
}

/** A new folder standing where an item is, with that item inside it. */
export function wrapInFolder(scene: Scene, folder: Folder, id: string): Scene {
  const tree = buildTree({ ...scene, folders: [...scene.folders, { ...folder, parent: null }] });
  const node = tree.pop()!;
  if (node.type !== 'folder') return scene;
  const at = locate(tree, id);
  if (!at) { tree.push(node); return flatten(tree); }
  node.children.push(at.node);
  at.list.splice(at.index, 1, node);
  return flatten(tree);
}

/** Adds an empty folder at a place. */
export function addFolder(scene: Scene, folder: Folder, place: Place): Scene {
  return moveItem({ ...scene, folders: [...scene.folders, { ...folder, parent: null }] }, folder.id, place);
}

/**
 * Removes a folder. With `keepContents`, what was in it moves up into the folder it was in, in the same place;
 * otherwise its shapes and folders go too.
 */
export function deleteFolder(scene: Scene, id: string, keepContents: boolean): Scene {
  const tree = buildTree(scene);
  const at = locate(tree, id);
  if (!at || at.node.type !== 'folder') return scene;
  at.list.splice(at.index, 1, ...(keepContents ? at.node.children : []));
  return flatten(tree);
}

/** Copies a folder and everything in it, placed straight after it. Returns the copy's id with the scene. */
export function duplicateFolder(scene: Scene, id: string, copyShape: (s: Shape) => Shape): { scene: Scene; id: string } {
  const tree = buildTree(scene);
  const at = locate(tree, id);
  if (!at || at.node.type !== 'folder') return { scene, id };
  const copy = (n: TreeNode): TreeNode => {
    if (n.type === 'shape') { const s = copyShape(n.shape); return { type: 'shape', id: s.id, shape: s }; }
    const fid = newFolderId();
    return { type: 'folder', id: fid, folder: { ...n.folder, id: fid }, children: n.children.map(copy) };
  };
  const dup = copy(at.node);
  at.list.splice(at.index + 1, 0, dup);
  return { scene: flatten(tree), id: dup.id };
}

/** A name not yet used by a folder beside it: "Folder", "Folder 2", ... */
export function freeFolderName(scene: Scene, parent: string | null, base = 'Folder'): string {
  const used = new Set(scene.folders.filter((f) => f.parent === parent).map((f) => f.name));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}
