import { History } from '../core/history';
import { BLOCK_MATERIALS, DEFAULT_MATERIAL, ROOF_MATERIALS, TERRAIN_MATERIALS, materialById } from '../core/materials';
import { turnScene } from '../core/rotate';
import { CUSTOM_ANGLE, LENGTH_IN_METERS, RISE_RUN, ROOF_ARMS, SET_BY_HEIGHT, armShiftLimits, armShiftSaved, armSizes, isBlockRoof, isJoinedKind, joinedBlockReason, isRoof, roofPieces, roofSlope, type RoofPiece } from '../core/roofs';
import { MAX_NAME, ProjectError, parseProject, projectNameFromPath, serializeProject } from '../core/project';
import { readBlueprint } from '../core/blueprint';
import { pieceCount } from '../core/merge';
import { layerBlockCount } from '../core/layer';
import { cloneShape, createImportedShape, createShape, shapeKindLabel, shapeName, shapeTitle } from '../core/scene';
import { addFolder, buildTree, canStep, deleteFolder, duplicateFolder, folderPath, freeFolderName, insertAfter, insertShape, moveItem, newFolderId, normalize, shapesIn, stepItem, wrapInFolder, type Scene, type TreeNode } from '../core/tree';
import { groupBounds, moveGroup, toolTurn, turnGroup, turnPivot, turnRules } from '../core/group';
import { blockOwners, pickBlock, pickShape, rayPlane, shapesInRect } from '../core/pick';
import { MARKER_MATERIAL, cleanLift, resolveAnchor, type ResolvedAnchor } from '../core/anchor';
import { key } from '../core/voxelize-keys';
import { MAX_TEXT, fontLanguages, fontOf, glyphFor, layoutText, pixelSteps, textOf, textParams, weightOf, type FontWeight } from '../core/text';
import { symbolsIn } from '../core/symbols';
import { END, MAX_BRANCH_DEPTH, SEG, SEGMENTS, branchDepth, branchPrefix, chainSegments, outletCount } from '../core/pipes';
import { GABLE_JOINED, fromJunction, gableEnds, matchGable } from '../core/gables';
import { SHAPES, SHAPE_LIST, UNCAP, scaleSizes, sizeKeys, nearestChoice, branchEndParam, branchSegmentParams, chainView, cleanParams, defaultParams, meterLimits, type NumberParam, type UncapEnd } from '../core/shapes';
import { KEEP_MATERIALS, VOXEL_SIZE, type CombineOp, type FillMode, type Folder, type LineWeight, type Shape, type ShapeKind, type Vec3, type Voxel } from '../core/types';
import { CellCache, voxelizeScene, worldBounds } from '../core/voxelize';
import type { ShapeForgeApi } from '../shared/ipc';
import type { SystemTheme } from '../core/theme';
import { markdownToHtml } from '../core/markdown';
import { Viewport } from './viewport';

/** The app's version, set by the build from package.json. */
declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
declare const __APP_AUTHOR__: { name?: string; email?: string };
declare const __README__: string;
declare const __APP_HOMEPAGE__: string;
const APP_HOMEPAGE = typeof __APP_HOMEPAGE__ === 'string' ? __APP_HOMEPAGE__ : '';
const README_TEXT = typeof __README__ === 'string' ? __README__ : '';
const APP_AUTHOR = typeof __APP_AUTHOR__ === 'object' && __APP_AUTHOR__ ? __APP_AUTHOR__ : {};

declare global {
  interface Window {
    shapeforge: ShapeForgeApi;
  }
}

const WARN_PIECES = 150_000;
const MERGE_SETTING = 'shapeforge.mergePieces';

/** App-wide options, remembered between sessions (not stored in projects). */
const options = {
  get merge(): boolean {
    try {
      return localStorage.getItem(MERGE_SETTING) !== 'false';
    } catch {
      return true;
    }
  },
  set merge(on: boolean) {
    try {
      localStorage.setItem(MERGE_SETTING, String(on));
    } catch {
      // Storage unavailable: the setting just won't be remembered.
    }
  },
};

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

const colorFor = (id: number) => materialById(id)?.color ?? '#8a8a8a';

// ---------- state ----------

let shapes: Shape[] = [createShape('spheroid')];
/** Folders in the shape list; a folder's shapes always sit together in `shapes` (see tree.ts). */
let folders: Folder[] = [];
/** The selected shape or folder (the one last clicked, when several are selected). */
let selectedId: string | null = shapes[0].id;
/** Everything selected: just selectedId, or several items picked with Ctrl or Shift. */
let picked = new Set<string>(selectedId ? [selectedId] : []);
/** Where a Shift-click range starts. */
let anchorId: string | null = selectedId;
let voxels: Voxel[] = [];
/** The picked anchor block (cell indices), or null for the default; and the lift, in meters (see anchor.ts). */
let landAt: Vec3 | null = null;
let lift = 0;
/** The anchor as it will be written, worked out with the blocks. */
let landing: ResolvedAnchor | null = null;
/** Roof pieces from roof shapes, placed as they are. */
let roofs: RoofPiece[] = [];
const cache = new CellCache();

const isMulti = () => picked.size > 1;
const selected = () => (isMulti() ? null : shapes.find((s) => s.id === selectedId) ?? null);
const selectedFolder = () => (isMulti() ? null : folders.find((f) => f.id === selectedId) ?? null);
/** Every selected shape, with the shapes in selected folders, in list order. */
function pickedShapes(): Shape[] {
  const ids = new Set<string>();
  for (const id of picked) {
    if (shapes.some((s) => s.id === id)) ids.add(id);
    else if (folders.some((f) => f.id === id)) for (const s of shapesIn(scene(), id)) ids.add(s.id);
  }
  return shapes.filter((s) => ids.has(s.id));
}
/** Keeps the selection to things that exist, and to selectedId alone once something else picked it. */
function syncPicked(): void {
  const exists = (id: string) => shapes.some((s) => s.id === id) || folders.some((f) => f.id === id);
  picked = new Set([...picked].filter(exists));
  if (selectedId && !exists(selectedId)) selectedId = null;
  if (!selectedId) { picked.clear(); anchorId = null; return; }
  if (!picked.has(selectedId)) { picked = new Set([selectedId]); anchorId = selectedId; }
  if (anchorId && !picked.has(anchorId)) anchorId = selectedId;
}
const scene = (): Scene => ({ shapes, folders });
/** Takes a changed scene (from tree.ts) as the current one. */
const setScene = (next: Scene) => { shapes = next.shapes; folders = next.folders; };
/** The folder new shapes go into: the selected folder, or the selected shape's folder. */
const targetFolder = (): string | null => selectedFolder()?.id ?? selected()?.folder ?? null;

/** Blueprint name; the name box mirrors it. */
/** The blueprint name typed in the ribbon, or blank to follow the project file's name. */
let projectName = '';

/** The name the blueprint is exported with: the one typed, else the project file's name, else "shapeforge". */
function blueprintName(): string {
  return projectName.trim() || (projectPath ? projectNameFromPath(projectPath) : '') || 'shapeforge';
}

/** The ribbon's Name box: the typed name, or (greyed) the file's name it follows. */
function showName(): void {
  const box = $<HTMLInputElement>('name');
  if (box.value !== projectName) box.value = projectName;
  box.placeholder = blueprintName();
  box.title = projectName.trim()
    ? 'The blueprint\'s name in Embervale Toolkit (clear it to use the project file\'s name)'
    : 'The blueprint\'s name in Embervale Toolkit: the project file\'s name until you type one';
}

/** The project file on disk, or null for a project never saved. */
let projectPath: string | null = null;
let dirty = false;

// ---------- undo / redo ----------

interface Snapshot {
  shapes: Shape[];
  folders: Folder[];
  selectedId: string | null;
  name: string;
  landAt: Vec3 | null;
  lift: number;
}

let history = new History<Snapshot>();

/** Copies the scene for undo. Imported block data never changes once created, so copies share it. */
function snapshot(): Snapshot {
  const copy = shapes.map((s) => ({ ...s, params: { ...s.params }, position: [...s.position] as Vec3, rotation: [...s.rotation] as Vec3 }));
  return { shapes: copy, folders: folders.map((f) => ({ ...f })), selectedId, name: projectName, landAt: landAt && [...landAt], lift };
}

/** Everything that is saved to the project file, for comparing against the last save; layers by id only. */
const stateKey = () => JSON.stringify([projectName, shapes, folders, landAt, lift], (k, v) => (k === 'layer' && v ? v.id : v));
let savedKey = stateKey();

/** Call before changing the scene. Changes with the same group in quick succession undo as one step. */
function record(group?: string): void {
  history.record(snapshot(), group);
  syncUndoButtons();
}

function syncUndoButtons(): void {
  $<HTMLButtonElement>('undo').disabled = !history.canUndo;
  $<HTMLButtonElement>('redo').disabled = !history.canRedo;
}

function restore(snap: Snapshot | null): void {
  if (!snap) return;
  shapes = snap.shapes;
  folders = snap.folders;
  selectedId = [...shapes, ...folders].some((s) => s.id === snap.selectedId) ? snap.selectedId : shapes[0]?.id ?? null;
  picked = new Set(selectedId ? [selectedId] : []);
  anchorId = selectedId;
  projectName = snap.name;
  showName();
  landAt = snap.landAt;
  lift = snap.lift;
  $<HTMLInputElement>('lift').value = String(lift);
  structureChanged();
  syncUndoButtons();
}

const undo = () => restore(history.undo(snapshot()));
const redo = () => restore(history.redo(snapshot()));

/** Unsaved means different from the last save, so undoing back to it clears the marker. */
function refreshDirty(): void {
  setDirty(stateKey() !== savedKey);
}

function setDirty(value: boolean): void {
  dirty = value;
  // The window warns on closing when any open file has unsaved changes; the tab bar marks which.
  const any = value || docs.some((d, i) => i !== currentDoc && d.dirty);
  if (anyDirty !== any) { anyDirty = any; window.shapeforge.setDirty(any); }
  renderFileTabs();
  const file = projectPath ? projectPath.split(/[\\/]/).pop()! : 'Untitled';
  $('project-file').textContent = file;
  // The ribbon shows the file's name; hovering shows where it is.
  $('project-file').parentElement!.title = projectPath ?? 'Not saved yet';
  $('dirty').hidden = !dirty;
  document.title = `${file}${dirty ? ' *' : ''} - ShapeForge ${APP_VERSION}`;
}

// ---------- settings ----------

/** Per computer: the theme (System follows Windows, dark when it has no preference) and reopening files on start. */
interface Settings { theme: 'system' | 'light' | 'dark'; reopen: boolean }
const SETTINGS_KEY = 'shapeforge.settings';
let settings: Settings = { theme: 'system', reopen: true };
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
  settings = {
    theme: saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'system',
    reopen: saved.reopen !== false,
  };
} catch { /* the defaults */ }

function saveSettings(): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* not kept */ }
}

/**
 * Windows' own setting, from the app (see main.ts); dark when it can't be told. Only a plain browser (no app, as in
 * the UI checks) goes by the page's prefers-color-scheme.
 */
const inApp = typeof (window.shapeforge as Partial<ShapeForgeApi> | undefined)?.systemTheme === 'function';
const prefersLight = inApp ? null : window.matchMedia?.('(prefers-color-scheme: light)');
let systemTheme: 'light' | 'dark' = 'dark';
/** What was read, shown under System in Settings. */
let systemThemeDetail = '';
function takeSystemTheme(t: SystemTheme | undefined): void {
  systemTheme = t?.theme === 'light' ? 'light' : 'dark';
  systemThemeDetail = typeof t?.detail === 'string' ? t.detail : '';
  const note = document.getElementById('theme-detail');
  if (note) note.textContent = systemThemeDetail;
}
try {
  if (inApp) takeSystemTheme(window.shapeforge.systemTheme());
  else takeSystemTheme({ theme: prefersLight?.matches ? 'light' : 'dark', detail: `The browser asks for ${prefersLight?.matches ? 'light' : 'dark'}` });
} catch { takeSystemTheme(undefined); }

/** The theme in use: the one chosen, or Windows' (dark unless it plainly asks for light). */
function themeNow(): 'light' | 'dark' {
  return settings.theme === 'system' ? systemTheme : settings.theme;
}

function applyTheme(): void {
  const t = themeNow();
  document.documentElement.dataset.theme = t;
  viewport?.setTheme(t);
  if (inApp) window.shapeforge.setTheme(t);
}
prefersLight?.addEventListener?.('change', () => { takeSystemTheme({ theme: prefersLight.matches ? 'light' : 'dark', detail: `The browser asks for ${prefersLight.matches ? 'light' : 'dark'}` }); if (settings.theme === 'system') applyTheme(); });
if (inApp) window.shapeforge.onSystemTheme((t) => { takeSystemTheme(t); if (settings.theme === 'system') applyTheme(); });
// Dark straight away (also the stylesheet's default); light only once it's known to be wanted.
document.documentElement.dataset.theme = themeNow();

// ---------- open files (tabs) ----------

/** Everything that belongs to one open file; the one being edited lives in the module's variables. */
interface Doc {
  shapes: Shape[];
  folders: Folder[];
  selectedId: string | null;
  picked: Set<string>;
  anchorId: string | null;
  segmentSel: string | null;
  landAt: Vec3 | null;
  lift: number;
  projectName: string;
  projectPath: string | null;
  history: History<Snapshot>;
  savedKey: string;
  dirty: boolean;
  view: { position: Vec3; target: Vec3 } | null;
  firstFit: boolean;
}
let docs: Doc[] = [];
let currentDoc = 0;
let anyDirty = false;

/** The file being edited, as a Doc (to set aside when switching). */
function captureDoc(): Doc {
  return {
    shapes, folders, selectedId, picked, anchorId, segmentSel, landAt, lift, projectName, projectPath, history, savedKey,
    dirty: stateKey() !== savedKey, view: viewport ? viewport.getView() : null, firstFit,
  };
}

/** Makes a Doc the one being edited, and shows it. */
function applyDoc(d: Doc): void {
  ({ shapes, folders, selectedId, picked, anchorId, segmentSel, landAt, lift, projectName, projectPath, history, savedKey } = d);
  $<HTMLInputElement>('lift').value = String(lift);
  showName();
  syncUndoButtons();
  firstFit = d.firstFit;
  structureChanged();
  if (d.view && !d.firstFit) viewport.setView(d.view);
  refreshDirty();
}

/** A tab's label: the file's name, or Untitled. */
const docLabel = (d: Doc) => (d.projectPath ? projectNameFromPath(d.projectPath) : 'Untitled');

/** Shows the open files as tabs above the ribbon, when there's more than one. */
function renderFileTabs(): void {
  const bar = document.getElementById('file-tabs');
  if (!bar) return;
  bar.hidden = docs.length + (pageOpen ? 1 : 0) < 2;
  if (bar.hidden) { bar.replaceChildren(); return; }
  const tabs = docs.map((d, i) => {
    const live = i === currentDoc;
    const shown = live && !pageActive;
    const isDirty = live ? dirty : d.dirty;
    const path = live ? projectPath : d.projectPath;
    const label = live ? (projectPath ? projectNameFromPath(projectPath) : 'Untitled') : docLabel(d);
    const tab = el('div', { className: 'file-tab', title: path ?? 'Not saved yet' });
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(shown));
    const name = el('button', { type: 'button', className: 'file-tab-name', textContent: `${label}${isDirty ? ' •' : ''}` });
    name.addEventListener('click', () => fileTabActions.switchTo(i));
    tab.addEventListener('auxclick', (e) => { if (e.button === 1) fileTabActions.close(i); });
    const close = el('button', { type: 'button', className: 'file-tab-close', textContent: '×', title: 'Close this file (Ctrl+W)' });
    close.setAttribute('aria-label', `Close ${label}`);
    close.addEventListener('click', () => fileTabActions.close(i));
    tab.append(name, close);
    return tab;
  });
  if (pageOpen) {
    const tab = el('div', { className: 'file-tab doc-tab', title: `The README for ShapeForge ${APP_VERSION}` });
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(pageActive));
    const name = el('button', { type: 'button', className: 'file-tab-name', textContent: 'README' });
    name.addEventListener('click', () => showPage(true));
    tab.addEventListener('auxclick', (e) => { if (e.button === 1) closePage(); });
    const close = el('button', { type: 'button', className: 'file-tab-close', textContent: '×', title: 'Close the README (Ctrl+W)' });
    close.setAttribute('aria-label', 'Close README');
    close.addEventListener('click', closePage);
    tab.append(name, close);
    tabs.push(tab);
  }
  bar.replaceChildren(...tabs);
}

/** The tab bar's actions, set up in main() (they need the project actions). */
const fileTabActions = { switchTo: (_i: number) => {}, close: (_i: number) => {} };

// ---------- the README tab ----------
// A tab that shows the README (as built into this version) instead of a project. While it's in front, the project
// stays loaded behind it; its panels and view are hidden and the ribbon's project tools rest.

let pageOpen = false;
let pageActive = false;
const PAGE_ID_PREFIX = 'readme-';

/** The ribbon's parts that act on the project in front: resting while the README is. */
function projectOnlyParts(): HTMLElement[] {
  const ids = ['save', 'save-as', 'fit'];
  const groups = ['g-edit', 'g-tools', 'g-export'];
  return [
    ...ids.map((id) => document.getElementById(id)),
    ...groups.map((g) => document.querySelector<HTMLElement>(`#ribbon .rgroup[aria-labelledby="${g}"]`)),
    document.querySelector<HTMLElement>('#ribbon .walk'),
  ].filter((e): e is HTMLElement => !!e);
}

/** Brings the README to the front (opening its tab the first time), or puts the project back in front. */
function showPage(on: boolean): void {
  if (on && !pageOpen) {
    $('page-body').innerHTML = markdownToHtml(README_TEXT, PAGE_ID_PREFIX);
    pageOpen = true;
  }
  pageActive = on && pageOpen;
  document.body.classList.toggle('page-mode', pageActive);
  $('page-view').hidden = !pageActive;
  for (const part of projectOnlyParts()) {
    part.inert = pageActive;
    part.classList.toggle('page-off', pageActive);
  }
  if (pageActive) {
    held.clear();
    $('page-view').focus({ preventScroll: true });
  }
  renderFileTabs();
}

function closePage(): void {
  if (!pageOpen) return;
  showPage(false);
  pageOpen = false;
  $('page-body').replaceChildren();
  renderFileTabs();
}

/** Which files are open, for reopening them next time. */
const SESSION_KEY = 'shapeforge.session';
function saveSession(): void {
  const all = docs.map((d, i) => (i === currentDoc ? projectPath : d.projectPath));
  const files = all.filter((p): p is string => !!p);
  const active = all[currentDoc] ? files.indexOf(all[currentDoc]!) : -1;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ files, active })); } catch { /* not kept */ }
}

/** Changes made since the last save are lost if the user goes ahead; asks first when there are any. */
function confirmDiscard(action: string): boolean {
  return !dirty || window.confirm(`This project has unsaved changes. ${action} anyway and lose them?`);
}

// ---------- editor fields ----------

/** A number box that writes into the shape when edited. */
function numberField(label: string, value: number, opts: { min?: number; max?: number; step?: number; unit?: string; snap?: (v: number, prev?: number) => number },
  onChange: (v: number) => void): HTMLElement {
  const input = el('input', { type: 'number', value: String(value), step: String(opts.step ?? 0.5) });
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  // With only some values allowed, the arrows step to the next allowed one, and a typed value settles on the nearest.
  let last = value;
  input.addEventListener('input', () => {
    let v = parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    if (opts.snap) {
      const stepped = Math.abs(Math.abs(v - last) - (opts.step ?? 0.5)) < 1e-9;
      if (stepped) { v = opts.snap(v, last); input.value = String(v); }
      else v = opts.snap(v);
      last = v;
    }
    onChange(v);
  });
  if (opts.snap) input.addEventListener('change', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) { input.value = String(opts.snap!(v)); last = opts.snap!(v); } });
  return el('label', { className: 'row' }, [opts.unit ? `${label} (${opts.unit})` : label, input]);
}

/** A dropdown. Options with a group are shown under that group's heading, in the order the groups first appear. */
function selectField<T extends string | number>(label: string, value: T, options: { value: T; label: string; group?: string }[],
  onChange: (v: T) => void, id?: string): HTMLElement {
  const select = el('select');
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const o of options) {
    const option = el('option', { value: String(o.value), textContent: o.label });
    if (!o.group) {
      select.append(option);
      continue;
    }
    let group = groups.get(o.group);
    if (!group) {
      group = el('optgroup', { label: o.group });
      groups.set(o.group, group);
      select.append(group);
    }
    group.append(option);
  }
  select.value = String(value);
  select.addEventListener('change', () => {
    const o = options.find((x) => String(x.value) === select.value);
    if (o) onChange(o.value);
  });
  const row = el('label', { className: 'row' }, [label, select]);
  if (id) row.id = id;
  return row;
}

/** Whether a shape is built hollow: set so, and not a shape whose settings make it a band already (an arch frame). */
function builtHollow(shape: Shape): boolean {
  const def = SHAPES[shape.kind as ShapeKind];
  return shape.fill === 'hollow' && !(def?.solidOnly?.(cleanParams(shape.kind as ShapeKind, shape.params)));
}

/** A shape's settings, with its uncap ends (if any) as one row of toggle buttons where the first of them would be. */
function shapeFields(shape: Shape): HTMLElement[] {
  const kind = shape.kind as ShapeKind;
  const uncapKeys = new Map((UNCAP[kind]?.ends ?? []).map((e) => [e.key, e]));
  const shown = SHAPES[kind].params.filter((p) => (!p.showIf || p.showIf(shape.params)) && (!p.hollowOnly || builtHollow(shape)));
  const out: HTMLElement[] = kind === 'gable' ? [gableMatchField(shape)] : kind === 'text' ? textFields(shape) : [];
  const ends = shown.filter((p) => uncapKeys.has(p.key));
  let group: string | undefined;
  for (const p of shown) {
    // A heading above settings grouped together (a gable's "Roof it fits under").
    if (p.group && p.group !== group) out.push(el('div', { className: 'arm-head' }, [el('h4', { textContent: p.group })]));
    group = p.group;
    if (!uncapKeys.has(p.key)) out.push(paramField(shape, p));
    else if (p === ends[0]) out.push(uncapButtons(shape, ends, uncapKeys));
  }
  return out;
}

/** A text shape's words (several lines allowed), and a line saying how it comes out. */
function textFields(shape: Shape): HTMLElement[] {
  const box = el('textarea', { value: textOf(shape.params), rows: 2, maxLength: MAX_TEXT, spellcheck: false, id: 'text-input' });
  box.addEventListener('input', () => {
    const before = textOf(selected()?.params ?? {}).includes('\n');
    updateSelected('text', (s) => {
      const params: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.params)) if (!/^c\d+$/.test(k) && k !== 'textLen') params[k] = v;
      return { ...s, params: { ...params, ...textParams(box.value) } };
    });
    // Line spacing and alignment show once there's a second line.
    if (box.value.includes('\n') !== before) {
      const at = box.selectionStart;
      renderEditor();
      const again = document.querySelector<HTMLTextAreaElement>('#text-input');
      if (again) { again.focus(); again.setSelectionRange(at, at); }
    }
  });
  const hint = el('p', { className: 'hint', id: 'text-hint', textContent: textHintText(shape) });
  return [el('label', { className: 'row' }, ['Text (Enter for a new line)', box]), symbolPicker(shape, box), hint];
}

/** Whether the symbol picker is open, and the group it shows (kept while the editor is redrawn). */
let symbolsOpen = false;
let symbolGroup = '';

/**
 * The Text shape's symbol picker: the characters the chosen font has beyond plain letters and digits, by group,
 * each drawn from the font itself (so it shows exactly what gets built). A click puts it in the text at the cursor.
 */
function symbolPicker(shape: Shape, box: HTMLTextAreaElement): HTMLElement {
  const weight = weightOf(cleanParams('text', shape.params));
  const groups = symbolsIn(weight);
  const toggle = el('button', { type: 'button', className: 'secondary small', id: 'symbols-toggle', textContent: symbolsOpen ? 'Hide symbols' : 'Symbols…' });
  toggle.setAttribute('aria-expanded', String(symbolsOpen));
  const wrap = el('div', { className: 'symbols' }, [toggle]);
  if (!symbolsOpen) {
    toggle.addEventListener('click', () => { symbolsOpen = true; wrap.replaceWith(symbolPicker(shape, box)); });
    return wrap;
  }
  toggle.addEventListener('click', () => { symbolsOpen = false; wrap.replaceWith(symbolPicker(shape, box)); });
  if (!groups.some((g) => g.name === symbolGroup)) symbolGroup = groups[0].name;
  const pick = el('select', { id: 'symbols-group' });
  pick.setAttribute('aria-label', 'Symbol group');
  const headings = new Map<string, HTMLOptGroupElement>();
  for (const g of groups) {
    let og = headings.get(g.heading);
    if (!og) { og = el('optgroup', { label: g.heading }); headings.set(g.heading, og); pick.append(og); }
    og.append(el('option', { value: g.name, textContent: `${g.name} (${g.symbols.length.toLocaleString()})` }));
  }
  pick.value = symbolGroup;
  const grid = el('div', { className: 'symbol-grid' });
  const fill = () => {
    grid.replaceChildren();
    for (const { ch, from, font } of groups.find((g) => g.name === symbolGroup)!.symbols) {
      const code = ch.codePointAt(0)!;
      const b = el('button', { type: 'button', className: 'symbol', title: `${ch}  U+${code.toString(16).toUpperCase().padStart(4, '0')}${font ? `  (from ${font})` : ''}` });
      b.setAttribute('aria-label', ch);
      b.append(glyphCanvas(from, code));
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the cursor in the text box
      b.addEventListener('click', () => {
        const at = box.selectionStart ?? box.value.length, end = box.selectionEnd ?? at;
        if (box.value.length - (end - at) + ch.length > MAX_TEXT) { status(`Text is limited to ${MAX_TEXT} characters.`, 'error'); return; }
        box.setRangeText(ch, at, end, 'end');
        box.dispatchEvent(new Event('input'));
        box.focus();
      });
      grid.append(b);
    }
  };
  pick.addEventListener('change', () => { symbolGroup = pick.value; fill(); });
  fill();
  wrap.append(pick, grid);
  return wrap;
}

/** A character drawn from a font's own outlines, fitted to a small square. */
function glyphCanvas(w: FontWeight, code: number, size = 26): HTMLCanvasElement {
  const ratio = window.devicePixelRatio || 1;
  const c = el('canvas', { width: Math.round(size * ratio), height: Math.round(size * ratio) });
  c.style.width = `${size}px`; c.style.height = `${size}px`;
  const g = w.glyphs[String(code)];
  const ctx = c.getContext('2d');
  if (!g || !ctx) return c;
  const xs = g[1].flatMap((p) => p.filter((_, i) => i % 2 === 0)), ys = g[1].flatMap((p) => p.filter((_, i) => i % 2 === 1));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  // The same scale for every character of a font (its full height), unless one is too wide for the square.
  const em = w.ascent - w.descent;
  const k = Math.min((size * ratio * 0.86) / em, (size * ratio * 0.9) / Math.max(1, x1 - x0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  ctx.setTransform(k, 0, 0, -k, size * ratio / 2 - cx * k, size * ratio / 2 + cy * k);
  ctx.fillStyle = getComputedStyle(document.body).color || '#ddd';
  const path = new Path2D();
  for (const poly of g[1]) {
    path.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) path.lineTo(poly[i], poly[i + 1]);
    path.closePath();
  }
  ctx.fill(path, 'nonzero');
  return c;
}

/** How the text comes out: its capital height and size in blocks, and any characters the font hasn't got. */
function textHintText(shape: Shape): string {
  const p = cleanParams('text', shape.params);
  const l = layoutText(p), w = weightOf(p);
  const missing = [...new Set([...textOf(p)].filter((c) => c !== '\n' && c !== ' ' && !glyphFor(w, c.codePointAt(0)!)))];
  const pixel = w.grid ? ` ${fontOf(p).name} is a pixel font: each of its pixels is ${pixelSteps(w, p.size).unit} block${pixelSteps(w, p.size).unit === 1 ? '' : 's'}, so its letter height goes in steps of ${pixelSteps(w, p.size).capPixels}.` : '';
  const miss = missing.length ? ` Not in this font or the symbol fonts, so left out: ${missing.join(' ')}` : '';
  // Which languages' letters the font has.
  const f = fontOf(p), lang = fontLanguages(f);
  const scripts = [...(lang.greek ? ['Greek'] : []), ...(lang.cyrillic ? ['Cyrillic'] : [])];
  const also = scripts.length ? `, and ${scripts.join(' and ')}` : '';
  // Familiar letters first (Polish, Czech, Turkish, Hungarian, Romanian, ...), then the rest in code order.
  const familiar = 'łčşőąęžřğıśźćňťďůűșțŁČŞŐĄĘŽŘĞİŚŹĆŇŤĎŮŰȘȚ';
  const rank = (c: string) => (familiar.includes(c) ? familiar.indexOf(c) : familiar.length);
  const few = (xs: string[]) => { const o = [...xs].sort((a, b2) => rank(a) - rank(b2)); return o.slice(0, 10).join(' ') + (o.length > 10 ? ' …' : ''); };
  const letters = lang.european === 'all'
    ? ` ${f.name} has the accented letters of every European language${also}.`
    : lang.european === 'most'
      ? ` ${f.name} has most European accented letters${also}; not ${few(lang.missing)}.`
      : ` ${f.name} has Western European accents only (é, ñ, ü, ...)${also}; not Central or Eastern European letters such as ${few(lang.missing)}.`;
  return `Capitals ${l.capBlocks} blocks tall; the text is ${l.width} × ${l.height} blocks (${l.width / 2} × ${l.height / 2} m).${pixel}${letters}${miss}`;
}

/** A gable's "Match a roof": the gable and shed roofs in the build, by end; picking one fits the gable under it. */
function gableMatchField(shape: Shape): HTMLElement {
  const NONE = '';
  const options: { value: string; label: string }[] = [{ value: NONE, label: 'Pick a roof end to fit under…' }];
  shapes.forEach((r, i) => {
    for (const e of gableEnds(r)) options.push({ value: `${r.id}|${e.which}`, label: `${shapeTitle(r, i)}: ${e.label}` });
  });
  if (options.length === 1) options[0].label = 'No roof with a gable end in the build yet';
  const row = selectField<string>('Match a roof', NONE, options, (v) => {
    if (v === NONE) return;
    const [id, which] = v.split('|');
    const roof = shapes.find((r) => r.id === id);
    if (!roof) return;
    updateSelected('match', (s) => matchGable(s, roof, which));
    renderEditor();
  });
  const p = cleanParams('gable', shape.params);
  if (fromJunction(p)) {
    // Worked out from an L, T or cross roof's arm: its settings were copied whole, so there are none to show here.
    const kind = GABLE_JOINED[p.srcKind] ?? 'roofT';
    const arm = ROOF_ARMS[kind][p.arm];
    const note = el('p', { className: 'hint', textContent: `Fits under the end of a ${SHAPES[kind].label.replace('Roof, ', '')} roof's ${arm?.label ?? 'arm'}, with all that roof's settings (layers and edging included). Match again after changing the roof.` });
    const own = el('button', { type: 'button', className: 'secondary small', textContent: 'Use its own roof settings instead' });
    own.addEventListener('click', () => { updateSelected('param:source', (s) => ({ ...s, params: { ...s.params, source: 0 } })); renderEditor(); });
    return el('div', {}, [row, note, own]);
  }
  row.title = 'Copies the roof\'s settings and puts the gable under that end; change anything afterward to adjust it';
  return row;
}

/** Uncap ends as toggle buttons: pressed means that end is open. */
function uncapButtons(shape: Shape, ends: NumberParam[], defs: Map<string, UncapEnd>): HTMLElement {
  const buttons = ends.map((p) => {
    const on = shape.params[p.key] === 1;
    const b = el('button', { type: 'button', className: on ? 'toggle on' : 'toggle', textContent: defs.get(p.key)?.short(shape.params) ?? p.label });
    b.title = `${p.label}: ${on ? 'uncapped (click to close)' : 'closed (click to uncap)'}`;
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      updateSelected(`param:${p.key}`, (s) => ({ ...s, params: { ...s.params, [p.key]: s.params[p.key] === 1 ? 0 : 1 } }));
      // The uncap depth shows once an end is open.
      renderEditor();
    });
    return b;
  });
  return el('div', { className: 'row' }, ['Uncap ends', el('div', { className: 'toggles' }, buttons)]);
}

/** A two- or few-way setting as toggle buttons, the chosen one pressed (Lying / Standing, Flat / Cylinderized). */
function segmentField(shape: Shape, p: NumberParam): HTMLElement {
  const now = Number(cleanParams(shape.kind as ShapeKind, shape.params)[p.key]);
  const buttons = p.choices!.map((c, i) => {
    const on = now === c.value;
    const b = el('button', { type: 'button', className: on ? 'toggle on' : 'toggle', textContent: p.segments![i] ?? c.label });
    b.title = c.label;
    b.setAttribute('aria-pressed', String(on));
    b.dataset.key = p.key;
    b.addEventListener('click', () => {
      if (on) return;
      updateSelected(`param:${p.key}`, (s) => ({ ...s, params: { ...s.params, [p.key]: c.value } }));
      // These show or hide other settings (thickness, uncap ends, the frame, hollow / filled).
      renderEditor();
    });
    return b;
  });
  return el('div', { className: 'row' }, [p.label, el('div', { className: 'toggles' }, buttons)]);
}

function vecField(label: string, value: Vec3, step: number, onChange: (v: Vec3) => void, reset?: string): HTMLElement {
  const v: Vec3 = [...value];
  const inputs: HTMLInputElement[] = [];
  const cells = (['X', 'Y', 'Z'] as const).map((axis, a) => {
    const input = el('input', { type: 'number', value: String(value[a]), step: String(step) });
    input.setAttribute('aria-label', `${label} ${axis}`);
    inputs.push(input);
    input.addEventListener('input', () => {
      const n = parseFloat(input.value);
      if (Number.isFinite(n)) {
        v[a] = n;
        onChange([...v]);
      }
    });
    return el('label', {}, [axis, input]);
  });
  const head: HTMLElement = el('label', { className: 'row', textContent: label });
  if (!reset) return el('div', {}, [head, el('div', { className: 'triple' }, cells)]);
  // A Reset button: every value back to 0.
  const button = el('button', { type: 'button', className: 'secondary small reset', textContent: 'Reset', title: reset });
  button.addEventListener('click', () => {
    if (v.every((x) => x === 0)) return;
    for (let a = 0; a < 3; a++) { v[a] = 0; inputs[a].value = '0'; }
    onChange([0, 0, 0]);
  });
  return el('div', {}, [el('div', { className: 'vec-head' }, [head, button]), el('div', { className: 'triple' }, cells)]);
}

/** An editor field for one parameter, tagged with its key so it can be found again. */
function paramField(shape: Shape, p: NumberParam): HTMLElement {
  const row = paramFieldRow(shape, p);
  row.id = `field-${p.key}`;
  return row;
}

/**
 * Scale: every size of the shape at once (see sizeKeys), as a percent of the sizes it had when scaling began, so
 * going to 150% and back to 100% gives the original exactly. Editing a size by hand, or picking another shape,
 * starts again from 100%.
 */
let scaling: { id: string; base: Record<string, number>; percent: number; result: string } | null = null;

function scaleField(shape: Shape): HTMLElement[] {
  const kind = shape.kind as ShapeKind;
  if (!sizeKeys(kind, shape.params).length) return [];
  const now = JSON.stringify(cleanParams(kind, shape.params));
  if (!scaling || scaling.id !== shape.id || scaling.result !== now) scaling = { id: shape.id, base: cleanParams(kind, shape.params), percent: 100, result: now };
  const apply = (percent: number) => {
    const s = scaling!;
    const pct = Math.min(1000, Math.max(10, Math.round(percent)));
    const params = scaleSizes(kind, s.base, pct / 100);
    s.percent = pct;
    s.result = JSON.stringify(params);
    updateSelected('scale', (x) => ({ ...x, params: { ...x.params, ...params } }));
    // The size fields show the new sizes; the cursor stays in the scale box.
    const focused = document.activeElement?.id === 'scale-input';
    renderEditor();
    if (focused) { const box = document.querySelector<HTMLInputElement>('#scale-input'); box?.focus(); }
    const hit = sizeKeys(kind, params).filter((k) => { const q = SHAPES[kind].params.find((x) => x.key === k)!; return params[k] === q.max || params[k] === q.min; });
    status(hit.length ? `Scaled to ${pct}%; some sizes are at their limit, so the proportions changed a little.` : `Scaled to ${pct}% of the sizes when you started.`, hit.length ? 'info' : 'ok');
  };
  const input = el('input', { type: 'number', id: 'scale-input', value: String(scaling.percent), min: '10', max: '1000', step: '10' });
  input.setAttribute('aria-label', 'Scale, percent');
  input.addEventListener('change', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) apply(v); });
  const half = el('button', { type: 'button', className: 'secondary small', textContent: '½×', title: 'Half the size' });
  const twice = el('button', { type: 'button', className: 'secondary small', textContent: '2×', title: 'Twice the size' });
  half.addEventListener('click', () => apply(scaling!.percent / 2));
  twice.addEventListener('click', () => apply(scaling!.percent * 2));
  const row = el('div', { className: 'scale-row' }, [input, half, twice]);
  return [el('div', { id: 'field-scale' }, [el('label', { className: 'row', textContent: 'Scale (%, all sizes together)', htmlFor: 'scale-input' }), row])];
}

/** Puts the cursor back in a field after the editor is redrawn. */
function refocus(key: string, value?: number): void {
  const input = document.querySelector<HTMLInputElement>(`#field-${key} input`);
  if (!input) return;
  input.focus();
  if (value !== undefined) input.value = String(value);
}

/** Which arm of an L, T or cross roof a setting belongs to, and which setting it is. */
function armOf(shape: Shape, key: string): { index: number; field: string } | null {
  if (!isJoinedKind(shape.kind)) return null;
  const index = ROOF_ARMS[shape.kind].findIndex((a) => key.startsWith(a.key) && /^[A-Z]/.test(key.slice(a.key.length)));
  return index < 0 ? null : { index, field: key.slice(ROOF_ARMS[shape.kind][index].key.length) };
}

/**
 * Sets every arm's width and height to what the roof has now, so a roof switching to blocks keeps its shape.
 */
function seedArmSizes(s: Shape, params: Record<string, number>): void {
  if (!isJoinedKind(s.kind)) return;
  const sizes = armSizes(s);
  ROOF_ARMS[s.kind].forEach((arm, i) => {
    params[`${arm.key}Height`] = sizes[i].height;
    params[`${arm.key}Width`] = sizes[i].width;
  });
}

function paramFieldRow(shape: Shape, p: NumberParam): HTMLElement {
  const arm = armOf(shape, p.key);
  // On an L, T or cross roof, a change can switch the roof between pieces and blocks, which swaps width fields.
  const set = (v: number) => {
    const before = isBlockRoof(shape);
    updateSelected(`param:${p.key}`, (s) => ({ ...s, params: { ...s.params, [p.key]: v } }));
    const now = selected();
    // Redrawn, the field shows the value in use (an offset past its limit is held at the limit).
    if (arm && now && isBlockRoof(now) !== before) { renderEditor(); refocus(p.key, now.params[p.key] ?? v); }
  };
  if (arm?.field === 'Height') return armHeightField(shape, p, arm.index);
  if (arm?.field === 'Shift') {
    const limits = armShiftLimits(shape.kind as 'roofL', shape.params, arm.index);
    const row = numberField(p.label, shape.params[p.key] ?? armShiftSaved(shape.params, ROOF_ARMS[shape.kind as 'roofL'][arm.index]), { ...limits, step: p.step, unit: p.unit }, set);
    // A typed offset past the limits is held at the limit; show that once the field is left.
    const input = row.querySelector('input')!;
    input.addEventListener('change', () => {
      const now = selected();
      if (now && now.params[p.key] !== undefined) input.value = String(now.params[p.key]);
    });
    return row;
  }
  if (arm?.field === 'Width') {
    const S = shape.params.pieceSize === 4 ? 4 : 2;
    return numberField(p.label, shape.params[p.key] ?? armSizes(shape)[arm.index].width, { min: p.min, max: p.max, step: p.step, unit: p.unit }, (v) => {
      // Keep the rows close, for going back to roof pieces.
      updateSelected(`param:${p.key}`, (s) => ({ ...s, params: { ...s.params, [p.key]: v, [`${ROOF_ARMS[s.kind as 'roofL'][arm.index].key}Rows`]: Math.max(1, Math.round((v - 1) / (2 * S))) } }));
    });
  }
  if (p.key === 'units' && isRoof(shape.kind)) {
    // Switching units converts every length, so the roof stays the same size (rounding up to whole pieces).
    return selectField(p.label, shape.params.units ?? 0, p.choices!, (units) => {
      updateSelected('param:units', (s) => {
        const pieceM = s.params.pieceSize === 4 ? 4 : 2;
        const params: Record<string, number> = { ...s.params, units };
        for (const def of SHAPES[s.kind as ShapeKind].params) {
          if (!def.length || (s.params.units ?? 0) === units) continue;
          const v = Number(s.params[def.key] ?? def.default);
          // Lengths round up to whole pieces; offsets (which can be negative) round to the nearest piece.
          params[def.key] = units === LENGTH_IN_METERS ? v * pieceM
            : def.min < 0 ? Math.round(v / pieceM) : Math.max(def.min, Math.ceil(v / pieceM - 1e-9));
        }
        return { ...s, params };
      });
      renderEditor();
    });
  }
  if (p.key === 'height' && isRoof(shape.kind)) return roofHeightField(shape, p);
  if (p.key === 'innerMaterial' || p.key === 'edgeMaterial' || p.key === 'roofMaterial' || p.key === 'markMaterial' || p.key === 'patternMaterial') return innerMaterialField(shape, p);
  if (p.choices && isRoof(shape.kind)) {
    // Roof choices can show or hide other fields, so the editor is redrawn after one changes.
    return selectField(p.label, shape.params[p.key], p.choices, (v) => {
      updateSelected(`param:${p.key}`, (s) => {
        const params: Record<string, number> = { ...s.params, [p.key]: v };
        // Switching to "set by height" starts from the height the roof has now (each arm's, on L, T and cross roofs).
        if (p.key === 'angle' && v === SET_BY_HEIGHT) {
          const b = worldBounds(s);
          params.height = Math.max(1, b.max[1] - b.min[1]);
        } else if (arm?.field === 'Angle' && isJoinedKind(s.kind)) {
          // An arm's angle. Leaving roof pieces keeps every arm's width; "set by height" starts from the arm's height now.
          const sizes = armSizes(s);
          if (!isBlockRoof(s)) ROOF_ARMS[s.kind].forEach((a, i) => { params[`${a.key}Width`] = sizes[i].width; });
          if (v === SET_BY_HEIGHT) params[`${ROOF_ARMS[s.kind][arm.index].key}Height`] = sizes[arm.index].height;
        }
        return { ...s, params };
      });
      renderEditor();
    });
  }
  if (p.choices && p.segments) return segmentField(shape, p);
  // A choice can show or hide other settings (a polygon's height), so the editor is redrawn after one changes.
  // Choices that depend on other settings (a font's own weights) show those, with the value kept nearest.
  if (p.choicesFor) return selectField(p.label, nearestChoice(p, shape.params, cleanParams(shape.kind as ShapeKind, shape.params)[p.key]), p.choicesFor(shape.params), (v) => {
    set(v);
    renderEditor();
  });
  if (p.choices) return selectField(p.label, shape.params[p.key], p.choices, (v) => {
    set(v);
    // A U-trap holds water by dipping down: picking one turns its Toward to Down (it can still be changed after).
    if (shape.kind === 'pipe' && /s\d+Type$/.test(p.key) && v === SEG.uTrap) {
      const dir = p.key.replace(/Type$/, 'Dir');
      updateSelected(`param:${p.key}`, (s) => ({ ...s, params: { ...s.params, [dir]: 3 } }));
    }
    if (SHAPES[shape.kind as ShapeKind].params.some((q) => q.showIf)) renderEditor();
  });
  if (p.length && shape.params.units === LENGTH_IN_METERS) {
    return numberField(p.label, shape.params[p.key], { ...meterLimits(p), step: 0.5, unit: 'm' }, set);
  }
  return numberField(p.label, shape.params[p.key], { min: p.min, max: p.max, step: p.step, unit: p.unit, snap: p.snap }, set);
}

/**
 * Keeps each arm's sideways offset within the length of the arms it joins, so shortening an arm (or switching
 * piece size or units) pulls in an offset that would now reach past it.
 */
function withShiftsInLimits(s: Shape): Shape {
  if (!isJoinedKind(s.kind)) return s;
  let params = s.params;
  ROOF_ARMS[s.kind].forEach((arm, i) => {
    const key = `${arm.key}Shift`;
    if (params[key] === undefined) return;
    const { min, max } = armShiftLimits(s.kind as 'roofL', params, i);
    const v = Math.min(max, Math.max(min, params[key]));
    if (v !== params[key]) params = { ...params, [key]: v };
  });
  return params === s.params ? s : { ...s, params };
}

/** A roof's fields, with a heading above each arm's group on L, T and cross roofs. */
function roofFields(shape: Shape): HTMLElement[] {
  const out: HTMLElement[] = [];
  let group: string | undefined;
  for (const p of SHAPES[shape.kind as ShapeKind].params) {
    if (p.showIf && !p.showIf(shape.params)) continue;
    if (p.group && p.group !== group) out.push(armHeading(shape, p.group));
    // A line between the last arm's settings and the general ones after them (Turn).
    if (!p.group && group) out.push(el('hr', { className: 'arm-end' }));
    group = p.group;
    out.push(paramField(shape, p));
  }
  // The cross has no settings after its arms: the line goes before the material instead.
  if (group) out.push(el('hr', { className: 'arm-end' }));
  return out;
}

/** An arm's name as a tab: "Bar, -x arm" to "Bar -x arm", "Stem (along +z)" to "Stem along +z". */
const tabLabel = (group: string) => group.replace(/^Bar, /, 'Bar ').replace(/\((along [^)]*)\)/, '$1').replace(/\s+/g, ' ').trim();

/** The tab shown for each roof (by shape id), kept while its settings are redrawn. */
const roofTab = new Map<string, string>();

/**
 * An L, T or cross roof's settings in tabs: Roof (name, folder, position, piece size, lengths in, material, then
 * what applies to the whole roof: edging, layers, recede, turn), and one tab for each arm. Every tab is built and the
 * others hidden, so switching is instant and values kept up to date elsewhere (arm heights) stay in place.
 */
function renderRoofTabs(shape: Shape, title: HTMLElement): void {
  const before: HTMLElement[] = [], after: HTMLElement[] = [];
  const arms = new Map<string, HTMLElement[]>();
  for (const p of SHAPES[shape.kind as ShapeKind].params) {
    if (p.showIf && !p.showIf(shape.params)) continue;
    if (p.group) {
      if (!arms.has(p.group)) arms.set(p.group, [armHeading(shape, p.group, tabLabel(p.group))]);
      arms.get(p.group)!.push(paramField(shape, p));
    } else (arms.size ? after : before).push(paramField(shape, p));
  }
  const tabs: { key: string; label: string; body: HTMLElement[] }[] = [
    {
      key: 'roof',
      label: 'Roof',
      body: [
        el('div', { className: 'arm-head' }, [el('h4', { textContent: 'Roof' })]),
        ...placeFields(shape),
        vecField('Position (m, center)', shape.position, 0.5, (position) => updateSelected('position', (s) => ({ ...s, position }))),
        roofHint(shape),
        ...before,
        materialField(shape),
        ...(after.length ? [el('h3', { textContent: 'Whole roof' }), ...after] : []),
      ],
    },
    ...[...arms].map(([label, body]) => ({ key: label, label: tabLabel(label), body })),
  ];
  renderTabbed(shape, title, tabs, 'Roof settings');
}

/**
 * Settings in tabs, one shown at a time, the tab kept for each shape (by id) while it's redrawn. Every tab is built
 * and the others hidden, so switching is instant and values kept up to date elsewhere stay in place. Each tab's first
 * element is its heading.
 */
type Tab = { key: string; label: string; body: HTMLElement[] };
let tabIds = 0;

function renderTabbed(shape: Shape, title: HTMLElement, tabs: Tab[], name: string): void {
  $('editor').append(title, ...buildTabs(shape.id, tabs, name));
}

/**
 * Settings in tabs, one shown at a time; the tab is kept (under `state`) while they're redrawn. Every tab is built
 * and the others hidden, so switching is instant and values kept up to date elsewhere stay in place. Each tab's first
 * element is its heading. Tabs can hold tabs (a pipe's joint, its branches).
 */
function buildTabs(state: string, tabs: Tab[], name: string): HTMLElement[] {
  let active = roofTab.get(state) ?? tabs[0].key;
  if (!tabs.some((t) => t.key === active)) active = tabs[0].key;
  const bar = el('div', { className: 'tabs', role: 'tablist' } as Partial<HTMLDivElement>);
  bar.setAttribute('aria-label', name);
  const panels: HTMLElement[] = [];
  const buttons: HTMLButtonElement[] = [];
  const show = (key: string, focus = false) => {
    roofTab.set(state, key);
    tabs.forEach((t, i) => {
      const on = t.key === key;
      buttons[i].classList.toggle('on', on);
      buttons[i].setAttribute('aria-selected', String(on));
      buttons[i].tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
      if (on && focus) buttons[i].focus();
    });
  };
  tabs.forEach((t, i) => {
    const id = `tab-${++tabIds}`;
    const b = el('button', { type: 'button', className: 'tab', textContent: t.label, id: `${id}-button` });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', id);
    b.addEventListener('click', () => show(t.key));
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      e.stopPropagation();
      const j = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      show(tabs[j].key, true);
    });
    buttons.push(b);
    bar.append(b);
    t.body[0]?.classList.add('tab-head');
    const panel = el('div', { className: 'tab-panel', id }, t.body);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `${id}-button`);
    panels.push(panel);
  });
  show(active);
  return [bar, ...panels];
}

/** An arm's heading, with a button that puts just that arm back as it was when the shape was created. */
function armHeading(shape: Shape, label: string, shown = label): HTMLElement {
  const arm = isJoinedKind(shape.kind) ? ROOF_ARMS[shape.kind].find((a) => a.label === label) : undefined;
  const head = el('div', { className: 'arm-head' }, [el('h4', { textContent: shown })]);
  if (!arm) return head;
  const reset = el('button', { className: 'secondary small', textContent: 'Reset', type: 'button' });
  reset.title = `Put ${label} back as it was when the shape was created`;
  reset.addEventListener('click', () => {
    updateSelected(`reset:${arm.key}`, (s) => {
      const params: Record<string, number> = { ...s.params };
      // Every setting of this arm (and the older names they had) goes; the defaults are filled back in.
      for (const k of Object.keys(params)) if (k.startsWith(arm.key) && /^[A-Z]/.test(k.slice(arm.key.length))) delete params[k];
      const defaults = defaultParams(s.kind as ShapeKind);
      for (const [k, v] of Object.entries(defaults)) if (k.startsWith(arm.key) && /^[A-Z]/.test(k.slice(arm.key.length))) params[k] = v;
      return { ...s, params };
    });
    renderEditor();
  });
  head.append(reset);
  return head;
}

/** Whether an arm of an L, T or cross roof is set by its height (its own angle choice, with a height saved). */
function armByHeight(shape: Shape, index: number): boolean {
  if (!isJoinedKind(shape.kind)) return false;
  const k = ROOF_ARMS[shape.kind][index].key;
  return shape.params[`${k}Angle`] === SET_BY_HEIGHT && shape.params[`${k}Height`] !== undefined;
}

/** A roof's height now, in meters. */
const roofHeightNow = (shape: Shape) => { const b = worldBounds(shape); return b.max[1] - b.min[1]; };

/**
 * Roof height, always shown. With "set by height" it is the roof's height; otherwise it shows the height the roof
 * has, and typing a new one switches the roof to "set by height" (built from blocks at whatever slope that gives).
 */
function roofHeightField(shape: Shape, p: NumberParam): HTMLElement {
  const byHeight = shape.params.angle === SET_BY_HEIGHT;
  const row = numberField(p.label, byHeight ? shape.params.height : roofHeightNow(shape), { min: p.min, max: p.max, step: p.step, unit: p.unit }, (v) => {
    const switching = selected()?.params.angle !== SET_BY_HEIGHT;
    updateSelected('param:height', (s) => ({ ...s, params: { ...s.params, height: v, angle: SET_BY_HEIGHT } }));
    if (switching) {
      // Redraw so the angle shows "set by height", then carry on typing where we were.
      renderEditor();
      const input = document.querySelector<HTMLInputElement>('#roof-height input');
      if (input) { input.focus(); input.value = String(v); }
    }
  });
  row.id = 'roof-height';
  return row;
}

/**
 * An arm's height. With "set by height" it is the arm's own height; otherwise it shows the height the arm has, and
 * typing one switches the roof to "set by height", starting every arm from the size it has now.
 */
function armHeightField(shape: Shape, p: NumberParam, index: number): HTMLElement {
  const byHeight = armByHeight(shape, index);
  const value = byHeight ? shape.params[p.key] : armSizes(shape)[index].height;
  const angleKey = `${ROOF_ARMS[shape.kind as 'roofL'][index].key}Angle`;
  return numberField(p.label, value, { min: p.min, max: p.max, step: p.step, unit: p.unit }, (v) => {
    const now = selected();
    const switching = !now || !armByHeight(now, index);
    updateSelected(`param:${p.key}`, (s) => {
      const params: Record<string, number> = { ...s.params };
      // Leaving roof pieces keeps every arm's width (and the other arms' angles).
      if (switching && !isBlockRoof(s)) seedArmSizes(s, params);
      return { ...s, params: { ...params, [p.key]: v, [angleKey]: SET_BY_HEIGHT } };
    });
    if (switching) { renderEditor(); refocus(p.key, v); }
  });
}

/** A name box: typing renames as you go (one undo step), and the list follows. */
function nameField(label: string, value: string, placeholder: string, onName: (name: string) => void): HTMLElement {
  const input = el('input', { type: 'text', value, placeholder, maxLength: MAX_NAME });
  input.addEventListener('input', () => onName(input.value));
  return el('label', { className: 'row' }, [label, input]);
}

/** Where a shape or folder sits: the top level, or a folder (named by its path). */
function folderOptions(exclude?: string): { value: string; label: string }[] {
  const out = [{ value: '', label: 'Top level (no folder)' }];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.type !== 'folder' || n.id === exclude) continue;
      out.push({ value: n.id, label: folderPath(scene(), n.id).map((f) => f.name).join(' / ') });
      walk(n.children);
    }
  };
  walk(buildTree(scene()));
  return out;
}

function renameShape(id: string, name: string): void {
  record(`${id}:name`);
  shapes = shapes.map((s) => (s.id === id ? { ...s, name: name.slice(0, MAX_NAME) || undefined } : s));
  if (!shapes.find((s) => s.id === id)?.name) shapes = shapes.map((s) => { if (s.id !== id) return s; const { name: _n, ...rest } = s; return rest; });
  refreshDirty();
  renderList();
  syncEditorTitle();
}

function renameFolder(id: string, name: string): void {
  record(`${id}:name`);
  folders = folders.map((f) => (f.id === id ? { ...f, name: name.slice(0, MAX_NAME) } : f));
  refreshDirty();
  renderList();
  syncEditorTitle();
}

/** Moves the selected shape or folder into a folder, at its end. */
function moveToFolder(id: string, folder: string | null): void {
  record();
  setScene(moveItem(scene(), id, { parent: folder }));
  structureChanged();
}

function syncEditorTitle(): void {
  const h = document.querySelector('#editor h2');
  const s = selected(), f = selectedFolder();
  if (h && s) h.textContent = `Selected: ${shapeTitle(s, shapes.indexOf(s))}`;
  if (h && f) h.textContent = `Folder: ${f.name || 'Untitled'}`;
}

function renderFolderEditor(folder: Folder): void {
  const editor = $('editor');
  const inside = shapesIn(scene(), folder.id);
  const subfolders = folders.filter((f) => f.parent === folder.id).length;
  const first = inside.length ? shapes.indexOf(inside[0]) + 1 : 0;
  const what = inside.length
    ? `${inside.length} shape${inside.length === 1 ? '' : 's'} (${first === shapes.indexOf(inside[inside.length - 1]) + 1 ? `number ${first}` : `numbers ${first} to ${shapes.indexOf(inside[inside.length - 1]) + 1}`} in the order)`
    : 'No shapes yet: drag shapes onto it, or add one while it is selected.';
  const ungroup = el('button', { type: 'button', className: 'secondary', textContent: 'Ungroup (keep its shapes)' });
  ungroup.addEventListener('click', () => removeFolder(folder.id, true));
  const del = el('button', { type: 'button', className: 'secondary danger', textContent: 'Delete with its shapes' });
  del.addEventListener('click', () => removeFolder(folder.id, false));
  del.disabled = inside.length === 0 && subfolders === 0;
  editor.append(
    el('h2', { textContent: `Folder: ${folder.name || 'Untitled'}` }),
    nameField('Name', folder.name, 'Folder', (name) => renameFolder(folder.id, name)),
    selectField<string>('In folder', folder.parent ?? '', folderOptions(folder.id), (v) => moveToFolder(folder.id, v || null)),
    ...groupFields(inside, 'the folder'),
    el('p', { className: 'hint', textContent: `${what}${subfolders ? `, ${subfolders} folder${subfolders === 1 ? '' : 's'} inside` : ''}. A folder's shapes stay together in the order; subtract and intersect shapes still cut the shapes above them, in or out of folders.` }),
    el('div', { className: 'buttons folder-actions' }, [ungroup, del]),
  );
}

/**
 * Several shapes at once: their position (the middle of the box round them; changing it moves them all together)
 * and, unless a roof is among them, a turn of the whole group round that middle.
 */
function renderMultiEditor(): void {
  const editor = $('editor');
  const group = pickedShapes();
  const nFolders = [...picked].filter((id) => folders.some((f) => f.id === id)).length;
  const clear = el('button', { type: 'button', className: 'secondary', textContent: 'Select just the last clicked' });
  clear.addEventListener('click', () => select(selectedId));
  const what = `${group.length} shape${group.length === 1 ? '' : 's'}${nFolders ? `, in or with ${nFolders} folder${nFolders === 1 ? '' : 's'}` : ''}`;
  editor.append(
    el('h2', { textContent: `${picked.size} selected` }),
    el('p', { className: 'hint multi-what', textContent: `${what}. Ctrl-click to add or take out one item, Shift-click for everything between; click without them to select one again.` }),
    ...groupFields(group, 'the group'),
    el('div', { className: 'buttons' }, [clear]),
  );
}

/**
 * Position and turn controls for several shapes at once (a multi-selection, or a folder's contents): Position is the
 * middle of the box round them all, and changing it moves them all together; the turn turns them round that middle
 * as one piece. Roofs only face the four directions, so with a roof among them only Position is shown.
 */
function groupFields(group: Shape[], what: string): HTMLElement[] {
  if (!group.length) return [];
  const ids = new Set(group.map((s) => s.id));
  const roofs = group.filter((s) => isRoof(s.kind)).length;
  const imported = group.some((s) => s.kind === 'imported');
  const round = (v: number) => Math.round(v * 100) / 100;
  let center = groupBounds(group).center.map(round) as Vec3;
  // The turn is applied to the shapes as they were when it started, so typing a number doesn't add up errors.
  let base: Shape[] | null = null;
  let pivot: Vec3 = [...center];
  const write = (changed: Shape[]) => {
    const byId = new Map(changed.map((s) => [s.id, s]));
    shapes = shapes.map((s) => byId.get(s.id) ?? s);
    refreshDirty();
    scheduleUpdate();
    renderList();
  };
  const out: HTMLElement[] = [
    vecField(`Position (m, middle of ${what})`, center, 0.5, (v) => {
      const by = v.map((x, a) => x - center[a]) as Vec3;
      if (by.every((x) => x === 0)) return;
      record('group:position');
      center = [...v];
      pivot = pivot.map((x, a) => x + by[a]) as Vec3;
      if (base) base = moveGroup(base, by);
      write(moveGroup(shapes.filter((s) => ids.has(s.id)), by));
    }),
  ];
  if (roofs) {
    out.push(el('p', { className: 'hint', textContent: `Rotation isn't available: ${roofs === 1 ? 'a roof is' : `${roofs} roofs are`} among them, and roofs only face the four directions (set on each roof).` }));
  } else {
    out.push(
      vecField(`Turn ${what} (degrees${imported ? ', quarter turns for imported layers' : ''})`, [0, 0, 0], imported ? 90 : 5, (turn) => {
        record('group:turn');
        base ??= shapes.filter((s) => ids.has(s.id));
        write(turnGroup(base, turn, pivot));
      }, `Undo the turn: ${what} back as it was when you selected it`),
      el('p', { className: 'hint', textContent: `Turns every shape together round the middle of ${what}, as one piece; the numbers are how far it has turned since you selected it.` }),
    );
  }
  return out;
}

function renderEditor(): void {
  const editor = $('editor');
  editor.replaceChildren();
  if (isMulti()) { renderMultiEditor(); return; }
  const folder = selectedFolder();
  if (folder) { renderFolderEditor(folder); return; }
  const shape = selected();
  if (!shape) {
    editor.append(el('h2', { textContent: 'Selected shape' }), el('p', { className: 'hint', textContent: 'Add a shape or pick one from the list to edit it.' }));
    return;
  }
  const index = shapes.indexOf(shape);
  const roof = isRoof(shape.kind);
  const title = el('h2', { textContent: `Selected: ${shapeTitle(shape, index)}` });
  if (roof) {
    // Roofs are made of roof pieces: they are placed as they are, so combining, rotation and walls don't apply.
    if (isJoinedKind(shape.kind)) { renderRoofTabs(shape, title); return; }
    editor.append(
      title,
      ...placeFields(shape),
      roofHint(shape),
      vecField('Position (m, center)', shape.position, 0.5, (position) => updateSelected('position', (s) => ({ ...s, position }))),
      el('h3', { textContent: 'Roof' }),
      ...roofFields(shape),
    );
    editor.append(materialField(shape));
    return;
  }
  if (shape.kind === 'pipe') {
    if (segmentSel !== null) renderSegmentEditor(shape, segmentSel);
    else renderPipeTabs(shape, title);
    return;
  }
  editor.append(
    title,
    ...placeFields(shape),
    combineField(shape),
    ...placeVecs(shape),
    el('h3', { textContent: 'Size' }),
    ...(shape.kind === 'imported' ? [] : scaleField(shape)),
    ...(shape.kind === 'imported' ? [layerInfo(shape)] : shapeFields(shape)),
    el('h3', { textContent: 'Build' }),
    ...(SHAPES[shape.kind as ShapeKind]?.solidOnly?.(cleanParams(shape.kind as ShapeKind, shape.params)) ? [] : [selectField<FillMode>('Fill', shape.fill, [
      { value: 'filled', label: 'Filled' },
      { value: 'hollow', label: 'Hollow' },
    ], (fill) => {
      updateSelected('fill', (s) => ({ ...s, fill }));
      // Settings only for hollow shapes (uncapping, open ends) come and go with it.
      if (SHAPES[shape.kind as ShapeKind]?.params.some((p) => p.hollowOnly)) renderEditor(); else syncHollowRows();
    })]),
  );
  const wall = numberField('Wall thickness (voxels)', shape.wallThickness, { min: 1, max: 8, step: 1 },
    (v) => updateSelected('wall', (s) => ({ ...s, wallThickness: Math.max(1, Math.round(v)) })));
  wall.id = 'wall-row';
  editor.append(
    wall,
    selectField<LineWeight>('Line weight', shape.lineWeight, [
      { value: 'thick', label: 'Thick (sealed walls)' },
      { value: 'thin', label: 'Thin (fewest blocks)' },
    ], (lineWeight) => updateSelected('weight', (s) => ({ ...s, lineWeight })), 'weight-row'),
  );
  editor.append(materialField(shape));
  syncHollowRows();
}

function combineField(shape: Shape): HTMLElement {
  return selectField<CombineOp>('Combine', shape.op, [
    { value: 'add', label: 'Add' },
    { value: 'subtract', label: 'Subtract from shapes above' },
    { value: 'intersect', label: 'Keep only overlap with shapes above' },
  ], (op) => {
    updateSelected('op', (s) => ({ ...s, op }));
    renderList();
    syncEditorTitle();
  });
}

/** Position and rotation. */
function placeVecs(shape: Shape): HTMLElement[] {
  return [
    vecField('Position (m, center)', shape.position, 0.5, (position) => updateSelected('position', (s) => ({ ...s, position }))),
    vecField(shape.kind === 'imported' ? 'Rotation (degrees, snaps to 90)' : 'Rotation (degrees)', shape.rotation,
      shape.kind === 'imported' ? 90 : 5, (rotation) => updateSelected('rotation', (s) => ({ ...s, rotation })), 'Set the rotation back to 0, 0, 0'),
  ];
}

// ---------- pipe runs ----------

/**
 * What's picked inside the selected pipe run in the shape list, as a path: "s2" is its segment 2, "s2b1" that
 * segment's first branch, "s2b1s1" the branch's first segment (see pipes.ts); null for the whole pipe.
 */
let segmentSel: string | null = null;
/** Pipe runs and their joints shown closed in the shape list ("id" or "id|path"; open by default); not saved. */
const pipeClosed = new Set<string>();

/** A path's parts: the chain it's on and its segment number, or a branch (ending in b<n>). */
function parsePath(path: string): { prefix: string; seg?: number; branch?: string } {
  const m = /^(.*?)s(\d+)$/.exec(path);
  if (m) return { prefix: m[1], seg: Number(m[2]) };
  return { prefix: path, branch: path };
}

const pipeParams = (shape: Shape) => cleanParams('pipe', shape.params);

/** The settings of segment i of the chain at `prefix` (the run's own, or a branch's). */
function segmentDefs(prefix: string, i: number): NumberParam[] {
  return prefix ? branchSegmentParams(prefix, i) : SHAPES.pipe.params.filter((q) => q.group === `Segment ${i}`);
}

/** "Turn 90° right", "Straight 3 m": a segment's fitting and its main size. */
function segmentSummary(shape: Shape, prefix: string, i: number): string {
  const p = chainView(pipeParams(shape), prefix);
  const defs = SHAPES.pipe.params;
  const choice = (key: string) => defs.find((d) => d.key === key)?.choices?.find((c) => c.value === p[key])?.label;
  const type = Math.round(p[`s${i}Type`] ?? 0);
  const label = choice(`s${i}Type`) ?? 'None';
  if (type === SEG.none) return 'None';
  if (type === SEG.straight) return `${label} ${p[`s${i}Len`]} m`;
  if (type === SEG.turn) return `${label} ${p[`s${i}Angle`]}° ${(choice(`s${i}Dir`) ?? '').toLowerCase()}`.trim();
  return label;
}

/** The side outlets of segment i on the chain at `prefix` that can have their own segments (none at the deepest level). */
function jointOutlets(shape: Shape, prefix: string, i: number): number {
  return branchDepth(prefix) >= MAX_BRANCH_DEPTH ? 0 : outletCount(pipeParams(shape), prefix, i);
}

/** "Segment 2", "Branch segment 1": a segment's name where it is. */
const segmentName = (prefix: string, i: number) => (prefix ? `Branch segment ${i}` : `Segment ${i}`);

/** The shape with every setting of a branch chain filled in (unset ones at their defaults), for showing fields. */
function withChainDefaults(shape: Shape, prefix: string, i: number): Shape {
  const params = { ...pipeParams(shape) };
  for (const d of segmentDefs(prefix, i)) params[d.key] ??= d.default;
  if (prefix) params[`${prefix}End`] ??= params.branchEnds ?? END.open;
  return { ...shape, params };
}

/** A branch's end setting. */
function branchEndField(shape: Shape, prefix: string): HTMLElement {
  return paramField(withChainDefaults(shape, prefix, 1), branchEndParam(prefix));
}

/** Segment i of a chain: its heading and settings; a joint also gets tabs for its branches' segments. */
function segmentContent(shape: Shape, prefix: string, i: number): HTMLElement[] {
  const used = chainSegments(pipeParams(shape), prefix).includes(i);
  const view = withChainDefaults(shape, prefix, i);
  const fields = segmentDefs(prefix, i).filter((q) => !q.showIf || q.showIf(view.params)).map((q) => paramField(view, q));
  const head = el('div', { className: 'arm-head' }, [el('h4', { textContent: used ? `${segmentName(prefix, i)}: ${segmentSummary(shape, prefix, i)}` : `${segmentName(prefix, i)} (not used yet)` })]);
  const out: HTMLElement[] = [head, ...(used ? [] : [el('p', { className: 'hint', textContent: 'Pick a fitting to add it to the end.' })]), ...fields];
  const n = used ? jointOutlets(shape, prefix, i) : 0;
  if (!n) return out;
  // A joint: its branch (or each of its branches) as a folder of segments of its own.
  const branches = Array.from({ length: n }, (_, k) => branchPrefix(prefix, i, k + 1));
  out.push(el('h3', { textContent: n === 1 ? 'Branch' : 'Branches' }), el('p', { className: 'hint', textContent: n === 1
    ? 'The side outlet can carry on with segments of its own:'
    : 'Each side outlet can carry on with segments of its own:' }));
  if (n === 1) out.push(...buildTabs(`${shape.id}|${branches[0]}`, branchTabs(shape, branches[0]), 'Branch segments'));
  else {
    out.push(...buildTabs(`${shape.id}|${prefix}s${i}`, branches.map((bp, k) => ({
      key: bp, label: `Branch ${k + 1}`,
      body: [el('div', { className: 'arm-head' }, [el('h4', { textContent: `Branch ${k + 1}` })]), ...buildTabs(`${shape.id}|${bp}`, branchTabs(shape, bp), `Branch ${k + 1} segments`)],
    })), 'Branches'));
  }
  return out;
}

/** A branch's tabs: its end, each of its segments, and one more to add a segment. */
function branchTabs(shape: Shape, bp: string): Tab[] {
  const used = chainSegments(pipeParams(shape), bp);
  const next = used.length < SEGMENTS ? [used.length + 1] : [];
  return [
    { key: 'end', label: 'Branch end', body: [el('div', { className: 'arm-head' }, [el('h4', { textContent: 'Branch end' })]), branchEndField(shape, bp)] },
    ...used.map((j) => ({ key: `s${j}`, label: `Segment ${j}`, body: segmentContent(shape, bp, j) })),
    ...next.map((j) => ({ key: `s${j}`, label: `+ Segment ${j}`, body: segmentContent(shape, bp, j) })),
  ];
}

/**
 * A pipe run in tabs: Pipe (name, folder, combine, position, rotation, the pipe's own settings, material), one tab
 * for each segment in use, and one more for the next segment, to add a fitting to the end.
 */
function renderPipeTabs(shape: Shape, title: HTMLElement): void {
  const own = SHAPES.pipe.params.filter((q) => !q.group && (!q.showIf || q.showIf(shape.params))).map((q) => paramField(shape, q));
  const used = chainSegments(pipeParams(shape), '');
  const next = used.length < SEGMENTS ? [used.length + 1] : [];
  renderTabbed(shape, title, [
    {
      key: 'pipe',
      label: 'Pipe',
      body: [el('div', { className: 'arm-head' }, [el('h4', { textContent: 'Pipe' })]), ...placeFields(shape), combineField(shape), ...placeVecs(shape), ...own, materialField(shape)],
    },
    ...used.map((i) => ({ key: `Segment ${i}`, label: `Segment ${i}`, body: segmentContent(shape, '', i) })),
    ...next.map((i) => ({ key: `Segment ${i}`, label: `+ Segment ${i}`, body: segmentContent(shape, '', i) })),
  ], 'Pipe settings');
}

/** Where a path is, in words: "segment 2, branch 1, segment 1". */
function pathWords(path: string): string {
  return path.replace(/s(\d+)/g, ', segment $1').replace(/b(\d+)/g, ', branch $1');
}

/** Just one segment, or one branch, picked under its pipe run in the shape list. */
function renderSegmentEditor(shape: Shape, path: string): void {
  const editor = $('editor');
  const whole = el('button', { type: 'button', className: 'secondary', textContent: 'All the pipe\'s settings' });
  whole.addEventListener('click', () => select(shape.id));
  const at = parsePath(path);
  editor.append(el('h2', { textContent: `Selected: ${shapeTitle(shape, shapes.indexOf(shape))}${pathWords(path)}` }));
  if (at.seg !== undefined) editor.append(...segmentContent(shape, at.prefix, at.seg));
  else editor.append(...buildTabs(`${shape.id}|${path}`, branchTabs(shape, path), 'Branch segments'));
  editor.append(el('div', { className: 'buttons' }, [whole]));
  editor.querySelector('.arm-head')?.classList.add('tab-head');
}

function selectSegment(id: string, path: string): void {
  select(id);
  segmentSel = path;
  renderList();
  renderEditor();
}

/** A shape's name, and the folder it's in. */
function placeFields(shape: Shape): HTMLElement[] {
  const fields = [nameField('Name', shape.name ?? '', shapeKindLabel(shape), (name) => renameShape(shape.id, name))];
  if (folders.length) fields.push(selectField<string>('In folder', shape.folder ?? '', folderOptions(), (v) => moveToFolder(shape.id, v || null)));
  return fields;
}

/** Material picker with a color swatch. Roofs list roof materials first. */
/** A double-thick roof's inside material: roof materials first, then building blocks. */
function innerMaterialField(shape: Shape, p: NumberParam): HTMLElement {
  const byName = (list: typeof BLOCK_MATERIALS, group: string) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ value: m.materialItem, label: m.name, group }));
  const roofIds = new Set(ROOF_MATERIALS.map((m) => m.materialItem));
  // A die's numbers: any building block, by name. Roof layers and edging: roof materials first.
  const options = p.key === 'markMaterial' || p.key === 'patternMaterial'
    ? byName(BLOCK_MATERIALS, 'Building blocks')
    : [...byName(ROOF_MATERIALS, 'Roof materials'), ...byName(BLOCK_MATERIALS.filter((m) => !roofIds.has(m.materialItem)), 'Building blocks')];
  return selectField<number>(p.label, shape.params[p.key] ?? p.default, options,
    (v) => updateSelected(`param:${p.key}`, (s) => ({ ...s, params: { ...s.params, [p.key]: v } })));
}

function materialField(shape: Shape): HTMLElement {
  const swatch = el('span', { className: 'swatch' });
  swatch.style.background = colorFor(shape.materialItem);
  const byName = (list: typeof BLOCK_MATERIALS, group: string) =>
    [...list].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ value: m.materialItem, label: m.name, group }));
  const roofIds = new Set(ROOF_MATERIALS.map((m) => m.materialItem));
  const materialOptions: { value: number; label: string; group?: string }[] = isRoof(shape.kind)
    ? [...byName(ROOF_MATERIALS, 'Roof materials'), ...byName(BLOCK_MATERIALS.filter((m) => !roofIds.has(m.materialItem)), 'Building blocks')]
    : [...byName(BLOCK_MATERIALS, 'Building blocks'), ...byName(TERRAIN_MATERIALS, 'Terrain')];
  if (shape.kind === 'imported') materialOptions.unshift({ value: KEEP_MATERIALS, label: 'Keep original materials' });
  const material = selectField<number>('Material', shape.materialItem, materialOptions,
    (materialItem) => { updateSelected('material', (s) => ({ ...s, materialItem })); swatch.style.background = colorFor(materialItem); });
  const select = material.querySelector('select')!;
  const wrapper = el('span', { className: 'material' }, [swatch]);
  material.replaceChild(wrapper, select);
  wrapper.append(select);
  return material;
}

function layerInfo(shape: Shape): HTMLElement {
  const layer = shape.layer;
  if (!layer) return el('p', { className: 'layer-info', textContent: 'No blocks.' });
  const size = layer.size.map((n) => n * VOXEL_SIZE).join(' x ');
  return el('p', { className: 'layer-info', textContent: `Imported from ${layer.name}: ${layerBlockCount(layer).toLocaleString()} blocks, ${size} m.` });
}

function syncHollowRows(): void {
  const s = selected();
  const hollow = !!s && builtHollow(s);
  for (const id of ['wall-row', 'weight-row']) {
    const row = document.getElementById(id);
    if (row) row.hidden = !hollow;
  }
}

// ---------- list ----------

/** The item being dragged in the shape list. */
let dragId: string | null = null;

/** Replaces a row's label with a text box to rename it; Enter or leaving keeps the name, Escape cancels. */
function startRename(row: HTMLElement, current: string, placeholder: string, done: (name: string) => void): void {
  const label = row.querySelector<HTMLElement>('.label');
  if (!label) return;
  const input = el('input', { type: 'text', className: 'rename', value: current, placeholder, maxLength: MAX_NAME });
  let finished = false;
  const finish = (keep: boolean) => {
    if (finished) return;
    finished = true;
    if (keep && input.value !== current) done(input.value.trim());
    else renderList();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  row.draggable = false;
  label.replaceWith(input);
  input.focus();
  input.select();
}

/** Renames the selected shape or folder in the list (F2, or double-click). */
function renameSelectedInList(): void {
  const row = document.querySelector<HTMLElement>(`#shape-list li[data-id="${selectedId}"]`);
  const s = selected(), f = selectedFolder();
  if (!row) return;
  if (s) startRename(row, s.name ?? '', shapeKindLabel(s), (name) => { renameShape(s.id, name); renderEditor(); });
  else if (f) startRename(row, f.name, 'Folder', (name) => { renameFolder(f.id, name || 'Folder'); renderEditor(); });
}

/** Where a drop on a row puts the dragged item: before it, after it, or (on a folder's middle) inside it. */
type DropZone = 'before' | 'after' | 'into';

function dropZone(row: HTMLElement, e: DragEvent): DropZone {
  const r = row.getBoundingClientRect();
  const y = (e.clientY - r.top) / Math.max(1, r.height);
  if (row.dataset.kind === 'folder') return y < 0.28 ? 'before' : y > 0.72 && row.dataset.open !== 'true' ? 'after' : 'into';
  return y < 0.5 ? 'before' : 'after';
}

function clearDropMarks(): void {
  for (const n of document.querySelectorAll('#shape-list .drop-before, #shape-list .drop-after, #shape-list .drop-into')) {
    n.classList.remove('drop-before', 'drop-after', 'drop-into');
  }
}

function dropOn(row: HTMLElement, zone: DropZone): void {
  if (!dragId) return;
  const id = row.dataset.id!;
  const parent = row.dataset.parent || null;
  const place = zone === 'into' ? { parent: id }
    : zone === 'before' ? { parent, before: id }
    : { parent, before: row.dataset.next || null };
  const next = moveItem(scene(), dragId, place);
  if (next === scene() || JSON.stringify(next.shapes.map((x) => [x.id, x.folder])) + JSON.stringify(next.folders) === JSON.stringify(shapes.map((x) => [x.id, x.folder])) + JSON.stringify(folders)) return;
  record();
  setScene(next);
  if (zone === 'into') folders = folders.map((f) => (f.id === id ? { ...f, open: true } : f));
  structureChanged();
}

function renderList(): void {
  const list = $('shape-list');
  const scroll = list.scrollTop;
  list.replaceChildren();
  const tree = buildTree(scene());
  const order = new Map(shapes.map((s, i) => [s.id, i]));
  const row = (n: TreeNode, depth: number, parent: string | null, next: string | null): HTMLLIElement => {
    const item = el('li', { tabIndex: 0 });
    item.dataset.id = n.id;
    item.dataset.kind = n.type;
    item.dataset.parent = parent ?? '';
    item.dataset.next = next ?? '';
    item.style.paddingLeft = `${8 + depth * 16}px`;
    item.draggable = true;
    // With one of a pipe run's segments selected, the segment's row is the selected one.
    if (picked.has(n.id) && !(n.id === selectedId && segmentSel !== null)) item.classList.add('selected');
    if (n.id === selectedId && segmentSel !== null && !isMulti()) item.classList.add('parent');
    if (isMulti() && n.id === selectedId) item.classList.add('primary');
    if (n.type === 'folder') {
      const f = n.folder;
      item.dataset.open = String(f.open);
      item.classList.add('folder');
      const count = shapesIn(scene(), f.id).length;
      const caret = el('button', { type: 'button', className: 'caret', textContent: f.open ? '▾' : '▸', title: f.open ? 'Close folder' : 'Open folder' });
      caret.setAttribute('aria-label', f.open ? 'Close folder' : 'Open folder');
      caret.addEventListener('click', (e) => {
        e.stopPropagation();
        // Opening and closing isn't an edit to undo, but it is saved with the project.
        folders = folders.map((x) => (x.id === f.id ? { ...x, open: !x.open } : x));
        refreshDirty();
        renderList();
      });
      item.append(caret, el('span', { className: 'folder-icon', textContent: '▤' }), el('span', { className: 'label', textContent: f.name || 'Folder' }),
        el('span', { className: 'count', textContent: String(count) }));
      item.addEventListener('dblclick', (e) => { e.preventDefault(); startRename(item, f.name, 'Folder', (name) => { renameFolder(f.id, name || 'Folder'); renderEditor(); }); });
    } else {
      const shape = n.shape;
      const swatch = el('span', { className: 'swatch small' });
      const keep = shape.kind === 'imported' && shape.materialItem === KEEP_MATERIALS;
      swatch.style.background = shape.op !== 'add' ? 'transparent' : keep ? 'linear-gradient(135deg, #8a7a5a 50%, #4a5560 50%)' : colorFor(shape.materialItem);
      const label = el('span', { className: 'label', textContent: shapeTitle(shape, order.get(shape.id) ?? 0) });
      if (shape.kind === 'pipe') {
        // A pipe run lists its segments under it, like a folder (green).
        const open = !pipeClosed.has(shape.id);
        item.classList.add('pipe');
        item.dataset.open = String(open);
        const caret = el('button', { type: 'button', className: 'caret', textContent: open ? '▾' : '▸', title: open ? 'Hide its segments' : 'Show its segments' });
        caret.setAttribute('aria-label', caret.title);
        caret.addEventListener('click', (e) => {
          e.stopPropagation();
          if (open) pipeClosed.add(shape.id); else pipeClosed.delete(shape.id);
          if (open && selectedId === shape.id && segmentSel !== null) { segmentSel = null; renderEditor(); }
          renderList();
        });
        item.append(caret, el('span', { className: 'folder-icon pipe-icon', textContent: '◎' }), label,
          el('span', { className: 'count', textContent: String(chainSegments(pipeParams(shape), '').length) }));
      } else item.append(el('span', { className: 'caret-space' }), swatch, label);
      if (shape.name?.trim()) item.append(el('span', { className: 'kind', textContent: shapeKindLabel(shape) }));
      if (shape.op !== 'add') item.classList.add('cut');
      item.title = shape.name?.trim() ? `${shapeName(shape)}: ${shapeKindLabel(shape)}` : shapeKindLabel(shape);
      item.addEventListener('dblclick', (e) => { e.preventDefault(); startRename(item, shape.name ?? '', shapeKindLabel(shape), (name) => { renameShape(shape.id, name); renderEditor(); }); });
    }
    const pick = () => { if (selectedId !== n.id || isMulti() || segmentSel !== null) select(n.id); };
    item.addEventListener('click', (e) => {
      if (e.shiftKey) pickRange(n.id, e.ctrlKey || e.metaKey);
      else if (e.ctrlKey || e.metaKey) pickToggle(n.id);
      else pick();
    });
    item.addEventListener('keydown', (e) => {
      if (e.target !== item) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      else if (e.key === 'F2') { e.preventDefault(); pick(); renameSelectedInList(); }
      else if (e.key === 'Escape' && isMulti()) { e.preventDefault(); pick(); }
      else if (n.type === 'folder' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const open = e.key === 'ArrowRight';
        folders = folders.map((x) => (x.id === n.id ? { ...x, open } : x));
        refreshDirty();
        renderList();
        document.querySelector<HTMLElement>(`#shape-list li[data-id="${n.id}"]`)?.focus();
      } else if (n.type === 'shape' && n.shape.kind === 'pipe' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        if (e.key === 'ArrowRight') pipeClosed.delete(n.id); else pipeClosed.add(n.id);
        renderList();
        document.querySelector<HTMLElement>(`#shape-list li[data-id="${n.id}"]`)?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocus(item, e.key === 'ArrowDown' ? 1 : -1);
      }
    });
    item.addEventListener('dragstart', (e) => {
      dragId = n.id;
      e.dataTransfer?.setData('text/plain', n.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => { dragId = null; clearDropMarks(); item.classList.remove('dragging'); });
    item.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      clearDropMarks();
      item.classList.add(`drop-${dropZone(item, e)}`);
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const zone = dropZone(item, e);
      clearDropMarks();
      dropOn(item, zone);
      dragId = null;
    });
    return item;
  };
  /** A row under a pipe run: one of its segments (a joint is a folder of its branch's segments), or a branch. */
  const pipeRow = (shape: Shape, path: string, label: string, depth: number, folderish: boolean, count?: number): HTMLLIElement => {
    const item = el('li', { className: /b\d+$/.test(path) ? 'segment branch' : 'segment', tabIndex: 0 });
    item.dataset.seg = `${shape.id}#${path}`;
    item.style.paddingLeft = `${8 + depth * 16 + (folderish ? 0 : 18)}px`;
    if (selectedId === shape.id && segmentSel === path && !isMulti()) item.classList.add('selected');
    const key = `${shape.id}|${path}`;
    if (folderish) {
      const open = !pipeClosed.has(key);
      const caret = el('button', { type: 'button', className: 'caret', textContent: open ? '▾' : '▸', title: open ? 'Hide its branch' : 'Show its branch' });
      caret.setAttribute('aria-label', caret.title);
      caret.addEventListener('click', (e) => { e.stopPropagation(); if (open) pipeClosed.add(key); else pipeClosed.delete(key); renderList(); });
      item.classList.add('joint');
      item.dataset.open = String(open);
      item.append(caret, el('span', { className: 'folder-icon pipe-icon', textContent: '◎' }));
    } else item.append(el('span', { className: 'seg-dot' }));
    item.append(el('span', { className: 'label', textContent: label }));
    if (count !== undefined) item.append(el('span', { className: 'count', textContent: String(count) }));
    const pick = () => selectSegment(shape.id, path);
    item.addEventListener('click', pick);
    // Nothing drops onto a segment (and it mustn't fall through to the end of the list).
    item.addEventListener('dragover', (e) => { e.stopPropagation(); clearDropMarks(); });
    item.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dragId = null; });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(item, e.key === 'ArrowDown' ? 1 : -1); }
      else if (folderish && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        if (e.key === 'ArrowRight') pipeClosed.delete(key); else pipeClosed.add(key);
        renderList();
        document.querySelector<HTMLElement>(`#shape-list li[data-seg="${shape.id}#${path}"]`)?.focus();
      }
    });
    return item;
  };
  /** A chain's segments, joints opening onto their branches. */
  const chainRows = (shape: Shape, prefix: string, depth: number) => {
    for (const i of chainSegments(pipeParams(shape), prefix)) {
      const path = `${prefix}s${i}`;
      const n = jointOutlets(shape, prefix, i);
      const name = `Segment ${i}: ${segmentSummary(shape, prefix, i)}`;
      const branches = Array.from({ length: n }, (_, k) => branchPrefix(prefix, i, k + 1));
      const inside = n === 1 ? chainSegments(pipeParams(shape), branches[0]).length : n;
      list.append(pipeRow(shape, path, name, depth, n > 0, n ? inside : undefined));
      if (!n || pipeClosed.has(`${shape.id}|${path}`)) continue;
      if (n === 1) chainRows(shape, branches[0], depth + 1);
      else branches.forEach((bp, k) => {
        list.append(pipeRow(shape, bp, `Branch ${k + 1}`, depth + 1, true, chainSegments(pipeParams(shape), bp).length));
        if (!pipeClosed.has(`${shape.id}|${bp}`)) chainRows(shape, bp, depth + 2);
      });
    }
  };
  const walk = (nodes: TreeNode[], depth: number, parent: string | null) => {
    nodes.forEach((n, k) => {
      list.append(row(n, depth, parent, nodes[k + 1]?.id ?? null));
      if (n.type === 'shape' && n.shape.kind === 'pipe' && !pipeClosed.has(n.id)) chainRows(n.shape, '', depth + 1);
      if (n.type === 'folder' && n.folder.open) {
        if (n.children.length) walk(n.children, depth + 1, n.id);
        else {
          const empty = el('li', { className: 'empty', textContent: 'Empty: drag shapes here' });
          empty.style.paddingLeft = `${8 + (depth + 1) * 16 + 18}px`;
          empty.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); e.stopPropagation(); clearDropMarks(); empty.classList.add('drop-into'); } });
          empty.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation(); clearDropMarks();
            const folderRow = list.querySelector<HTMLElement>(`li[data-id="${n.id}"]`);
            if (folderRow) dropOn(folderRow, 'into');
            dragId = null;
          });
          list.append(empty);
        }
      }
    });
  };
  walk(tree, 0, null);
  fitRowWidths();
  list.scrollTop = scroll;
  list.querySelector<HTMLElement>('li.selected')?.scrollIntoView({ block: 'nearest' });

  const has = selected() !== null || selectedFolder() !== null;
  // With several selected, only Delete applies to them all.
  $<HTMLButtonElement>('duplicate').disabled = !has;
  $<HTMLButtonElement>('new-folder').disabled = isMulti();
  $<HTMLButtonElement>('delete').disabled = !has && !isMulti();
  $<HTMLButtonElement>('move-up').disabled = !has || !canStep(scene(), selectedId!, -1);
  $<HTMLButtonElement>('move-down').disabled = !has || !canStep(scene(), selectedId!, 1);
}

/** Gives every row of the shape list the widest row's width (at least the list's), so they line up when it scrolls sideways. */
function fitRowWidths(): void {
  const list = document.getElementById('shape-list');
  if (!list) return;
  const rows = [...list.querySelectorAll<HTMLElement>('li')];
  for (const r of rows) r.style.minWidth = '';
  const widest = Math.max(list.clientWidth, ...rows.map((r) => r.scrollWidth));
  for (const r of rows) r.style.minWidth = `${widest}px`;
}

/** Arrow keys in the shape list: select the row above or below (a shape, a folder or a pipe run's segment). */
function moveFocus(from: HTMLElement, delta: 1 | -1): void {
  const rows = [...document.querySelectorAll<HTMLElement>('#shape-list li[data-id], #shape-list li[data-seg]')];
  const to = rows[rows.indexOf(from) + delta];
  if (!to) return;
  if (to.dataset.seg) {
    const [id, path] = to.dataset.seg.split('#');
    selectSegment(id, path);
    document.querySelector<HTMLElement>(`#shape-list li[data-seg="${to.dataset.seg}"]`)?.focus();
  } else {
    select(to.dataset.id!);
    document.querySelector<HTMLElement>(`#shape-list li[data-id="${to.dataset.id}"]`)?.focus();
  }
}

/** Removes a folder: keeping its shapes (moved up a level) or deleting them with it. */
function removeFolder(id: string, keepContents: boolean): void {
  const f = folders.find((x) => x.id === id);
  if (!f) return;
  const inside = shapesIn(scene(), id).length;
  if (!keepContents && inside && !window.confirm(`Delete the folder "${f.name}" and the ${inside} shape${inside === 1 ? '' : 's'} in it?`)) return;
  record();
  const sibling = shapesIn(scene(), id)[0]?.id;
  setScene(deleteFolder(scene(), id, keepContents));
  selectedId = keepContents && sibling ? sibling : f.parent ?? shapes[0]?.id ?? null;
  structureChanged();
}

/** Ctrl-click: adds the item to the selection, or takes it out. */
function pickToggle(id: string): void {
  if (picked.has(id) && picked.size > 1) {
    picked.delete(id);
    if (selectedId === id) selectedId = [...picked].pop() ?? null;
  } else {
    picked.add(id);
    selectedId = id;
  }
  anchorId = id;
  selectionChanged();
}

/** Shift-click: everything listed from the anchor to this item (added to the selection with Ctrl too). */
function pickRange(id: string, add: boolean): void {
  const rows = [...document.querySelectorAll<HTMLElement>('#shape-list li[data-id]')].map((r) => r.dataset.id!);
  const a = anchorId ? rows.indexOf(anchorId) : -1, b = rows.indexOf(id);
  if (a < 0 || b < 0) { select(id); return; }
  const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1);
  picked = new Set(add ? [...picked, ...range] : range);
  selectedId = id;
  selectionChanged();
}

function selectionChanged(): void {
  renderList();
  renderEditor();
  showSelection();
}

function select(id: string | null): void {
  selectedId = id;
  segmentSel = null;
  picked = new Set(id ? [id] : []);
  anchorId = id;
  renderList();
  renderEditor();
  showSelection();
}

// ---------- scene updates ----------

let viewport: Viewport;
let firstFit = true;
let timer: number | undefined;

/** Changes the selected shape. `field` names what changed, so quick edits to one field undo together. */
function updateSelected(field: string, change: (s: Shape) => Shape): void {
  record(`${selectedId}:${field}`);
  shapes = shapes.map((s) => (s.id === selectedId ? withShiftsInLimits(change(s)) : s));
  refreshDirty();
  scheduleUpdate();
  // A pipe run's segment rows in the list name their fittings.
  if (selected()?.kind === 'pipe' && field.startsWith('param:s')) renderList();
}

function scheduleUpdate(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(recompute, 100);
}

function showSelection(): void {
  const s = selected(), f = selectedFolder();
  if (s) { viewport.setSelection(worldBounds(s)); return; }
  // A folder, or several items: the box round everything in them.
  const inside = isMulti() ? pickedShapes() : f ? shapesIn(scene(), f.id) : [];
  if (!inside.length) { viewport.setSelection(null); return; }
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of inside) {
    const b = worldBounds(x);
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], b.min[a]); max[a] = Math.max(max[a], b.max[a]); }
  }
  viewport.setSelection({ min, max });
}

/** What a roof is built from; for block roofs, the slope as built. Kept up to date as the roof is edited. */
function roofHint(shape: Shape): HTMLElement {
  const hint = el('p', { className: 'hint', id: 'roof-hint' });
  hint.textContent = roofHintText(shape);
  return hint;
}

/** What a custom angle or pitch aims for, for the hint. */
function aimText(p: Record<string, number>): string {
  if (p.angle === CUSTOM_ANGLE) return `, aiming for ${p.customAngle}°`;
  if (p.angle === RISE_RUN) return `, aiming for ${p.pitchRise} in ${p.pitchRun} = ${((Math.atan2(p.pitchRise, p.pitchRun) * 180) / Math.PI).toFixed(1)}°`;
  return '';
}

function roofHintText(shape: Shape): string {
  const place = 'Roofs are always added; place one on top of walls by setting its position.';
  const slope = roofSlope(shape);
  if (!slope) return `Built from the game's roof pieces. Type a roof height to build it from blocks at any slope instead. ${place}`;
  if (slope.arms && isJoinedKind(shape.kind)) {
    const arms = ROOF_ARMS[shape.kind].map((a, i) => `${a.label} ${slope.arms![i].degrees.toFixed(1)}°`).join(', ');
    const why = joinedBlockReason(shape);
    const reason = why === 'junction' ? ' (the game\'s roof pieces can\'t make this junction)'
      : why === 'offset' ? ' (an offset isn\'t a whole number of pieces)' : '';
    return `Built from blocks${reason}; each arm's slope as built: ${arms}. ${place}`;
  }
  const sides = slope.other
    ? `the long side rises ${slope.rise} blocks over ${slope.run} (${slope.degrees.toFixed(1)}°), the short side ${slope.other.rise} over ${slope.other.run} (${slope.other.degrees.toFixed(1)}°)`
    : shape.params.angle === SET_BY_HEIGHT
      ? `each slope rises ${slope.rise} blocks over ${slope.run} (${slope.degrees.toFixed(1)}°, from the height)`
      : `each slope rises ${slope.rise} blocks over ${slope.run} (${slope.degrees.toFixed(1)}° as built${aimText(shape.params)}; larger roofs come closer to the angle chosen)`;
  return `Built from blocks: ${sides}. Piece size and rows set the roof's width. ${place}`;
}

function recompute(): void {
  window.clearTimeout(timer);
  const s = selected();
  const hint = document.getElementById('roof-hint');
  if (s && hint && isRoof(s.kind)) hint.textContent = roofHintText(s);
  if (s && isJoinedKind(s.kind)) {
    const sizes = armSizes(s);
    ROOF_ARMS[s.kind].forEach((arm, i) => {
      const h = document.querySelector<HTMLInputElement>(`#field-${arm.key}Height input`);
      if (h && document.activeElement !== h && !armByHeight(s, i)) h.value = String(sizes[i].height);
      const shift = document.querySelector<HTMLInputElement>(`#field-${arm.key}Shift input`);
      if (shift) {
        const { min, max } = armShiftLimits(s.kind as 'roofL', s.params, i);
        shift.min = String(min);
        shift.max = String(max);
        if (document.activeElement !== shift && s.params[`${arm.key}Shift`] !== undefined) shift.value = String(s.params[`${arm.key}Shift`]);
      }
      const w = document.querySelector<HTMLInputElement>(`#field-${arm.key}Width input`);
      if (w && document.activeElement !== w && s.params[`${arm.key}Width`] === undefined) w.value = String(sizes[i].width);
    });
  }
  const textHint = document.getElementById('text-hint');
  if (s && textHint && s.kind === 'text') textHint.textContent = textHintText(s);
  const heightInput = document.querySelector<HTMLInputElement>('#roof-height input');
  if (s && heightInput && isRoof(s.kind) && s.params.angle !== SET_BY_HEIGHT && document.activeElement !== heightInput) {
    heightInput.value = String(roofHeightNow(s));
  }
  const t0 = performance.now();
  voxels = voxelizeScene(shapes, cache);
  owners = null;
  solid = null;
  landing = resolveAnchor(voxels, landAt);
  roofs = shapes.filter((s) => isRoof(s.kind)).flatMap(roofPieces);
  const ms = Math.round(performance.now() - t0);
  viewport.setVoxels(landing?.marker ? [...voxels, { i: landing.cell[0], j: landing.cell[1], k: landing.cell[2], materialItem: landing.materialItem }] : voxels, colorFor);
  showAnchor();
  viewport.setRoofs(roofs, colorFor);
  showSelection();
  if (firstFit && (voxels.length || roofs.length)) {
    viewport.fit();
    firstFit = false;
  }
  showStats(ms);
}

let statsTimer: number | undefined;
let lastMs = 0;

/**
 * Updates the stats line. With larger pieces on, counting pieces means running the merge, which takes up to
 * about a second on huge builds, so it runs a moment after editing stops.
 */
function showStats(ms = lastMs): void {
  lastMs = ms;
  window.clearTimeout(statsTimer);
  const roofNote = roofs.length ? ` + ${roofs.length.toLocaleString()} roof piece${roofs.length === 1 ? '' : 's'}` : '';
  const head = `${shapes.length} shape${shapes.length === 1 ? '' : 's'} · ${voxels.length.toLocaleString()} blocks${roofNote}`;
  const warn = (pieces: number) => {
    $('warning').textContent = pieces > WARN_PIECES ? 'Very large blueprint: Embervale and the game may struggle with this many pieces.' : '';
  };
  if (!options.merge || voxels.length === 0) {
    $('stats').textContent = `${head} · ${ms} ms`;
    warn(voxels.length + roofs.length);
    return;
  }
  $('stats').textContent = `${head} → counting pieces… · ${ms} ms`;
  const counted = voxels;
  statsTimer = window.setTimeout(() => {
    if (counted !== voxels) return;
    const pieces = pieceCount(voxels, true) + roofs.length;
    $('stats').textContent = `${head} → ${pieces.toLocaleString()} pieces · ${ms} ms`;
    warn(pieces);
  }, 400);
}

function structureChanged(): void {
  syncPicked();
  refreshDirty();
  renderList();
  renderEditor();
  recompute();
}

// ---------- wiring ----------

function status(text: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  const s = $('status');
  s.textContent = text;
  s.dataset.kind = kind;
}

// ---------- 3D view: tools and keys ----------

/** What a left drag in the 3D view does. */
type Tool = 'navigate' | 'select' | 'move' | 'rotate' | 'anchor';
let tool: Tool = 'navigate';
const TOOL_HINTS: Record<Tool, string> = {
  navigate: 'Navigate: drag to turn the view, right-drag to pan, wheel to zoom. W A S D and Page Up / Page Down move the camera; hold Shift to go faster.',
  select: 'Select: click a shape to select it (Ctrl-click adds or takes out one, Shift-click a range); drag a box to select every shape with any part inside it. Right-drag turns the view.',
  move: 'Move: drag to slide the selection level, in 0.5 m steps; hold Ctrl to move it up or down. Dragging an unselected shape selects it first. Right-drag turns the view.',
  rotate: 'Rotate: drag left or right to turn the selection about the vertical axis; hold Ctrl to tilt it (about x) or Alt to roll it (about z). Right-drag turns the view.',
  anchor: 'Anchor: click a block to land the blueprint on it in game; Shift-click a block for a marker block in front of the face you clicked; click empty space for a marker level with the build\'s lowest blocks. Right-drag turns the view.',
};

/** The keys that pick the tools. */
const TOOL_KEYS: Record<string, Tool> = { h: 'navigate', v: 'select', m: 'move', r: 'rotate', p: 'anchor' };

function setTool(t: Tool): void {
  tool = t;
  viewport.setLeftDragTurns(t === 'navigate');
  $('viewport').dataset.tool = t;
  showAnchor();
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool-button]')) b.setAttribute('aria-pressed', String(b.dataset.toolButton === t));
  status(TOOL_HINTS[t]);
}

/** Which shape owns each visible block, worked out when a click needs it (cleared when the scene changes). */
let owners: Map<number, string> | null = null;
const getOwners = () => (owners ??= blockOwners(shapes, cache));

/** The shape under the mouse in the 3D view, if any. */
const shapeAt = (e: MouseEvent) => pickShape(viewport.rayAt(e.clientX, e.clientY), shapes, getOwners());

/** Takes changed shapes into the scene (by id) while dragging; the editor catches up when the drag ends. */
let dragFrame = 0;
function writeShapes(changed: Shape[]): void {
  const byId = new Map(changed.map((x) => [x.id, x]));
  const same = (a: Shape, b: Shape) => a.position.every((v, i) => v === b.position[i]) && a.rotation.every((v, i) => v === b.rotation[i]) && JSON.stringify(a.params) === JSON.stringify(b.params);
  if (shapes.every((x) => { const c = byId.get(x.id); return !c || same(c, x); })) return;
  shapes = shapes.map((x) => byId.get(x.id) ?? x);
  refreshDirty();
  showSelection();
  // The blocks are rebuilt once a frame while the mouse moves, so the shapes follow it, not just their outline.
  if (!dragFrame) dragFrame = requestAnimationFrame(() => { dragFrame = 0; recompute(); });
}

type Drag =
  | { kind: 'select'; x0: number; y0: number; moved: boolean }
  | { kind: 'anchor'; x0: number; y0: number; moved: boolean }
  | { kind: 'move'; base: Shape[]; vertical: boolean; start: Vec3; plane: Vec3; normal: Vec3 }
  | { kind: 'rotate'; base: Shape[]; pivot: Vec3; axis: 0 | 1 | 2; x0: number };
let drag: Drag | null = null;

const AXIS_NAMES = ['tilting it about x', 'turning it about the vertical', 'rolling it about z'];

/** The plane a Move drag slides in: level through the selection's middle, or upright facing the camera with Ctrl. */
function movePlane(group: Shape[], vertical: boolean): { plane: Vec3; normal: Vec3 } {
  const c = groupBounds(group).center;
  if (!vertical) return { plane: c, normal: [0, 1, 0] };
  const f = viewport.heading().forward;
  return { plane: c, normal: [f[0], 0, f[2]] };
}

function startToolDrag(e: PointerEvent): void {
  if (tool === 'select') { drag = { kind: 'select', x0: e.clientX, y0: e.clientY, moved: false }; return; }
  if (tool === 'anchor') { drag = { kind: 'anchor', x0: e.clientX, y0: e.clientY, moved: false }; return; }
  // Move and Rotate: dragging a shape that isn't selected selects it first.
  const hit = shapeAt(e);
  if (hit && !picked.has(hit) && !pickedShapes().some((x) => x.id === hit)) select(hit);
  const group = pickedShapes();
  if (!group.length) { status('Select a shape first: click one with the Select tool, or pick it in the list.', 'error'); return; }
  record(`tool:${tool}:${Date.now()}`);
  if (tool === 'move') {
    const vertical = e.ctrlKey;
    const { plane, normal } = movePlane(group, vertical);
    const start = rayPlane(viewport.rayAt(e.clientX, e.clientY), plane, normal);
    if (!start) return;
    drag = { kind: 'move', base: group, vertical, start, plane, normal };
  } else {
    drag = { kind: 'rotate', base: group, pivot: turnPivot(group), axis: e.ctrlKey ? 0 : e.altKey ? 2 : 1, x0: e.clientX };
    const why = turnRules(group).why;
    status(why ? `Rotate: ${why}` : TOOL_HINTS.rotate);
  }
}

function moveToolDrag(e: PointerEvent): void {
  if (!drag) return;
  if (drag.kind === 'anchor') { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) >= 4) drag.moved = true; return; }
  if (drag.kind === 'select') {
    const rect = $('select-rect');
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    drag.moved = true;
    const box = $('viewport').getBoundingClientRect();
    const x = Math.min(e.clientX, drag.x0) - box.left, y = Math.min(e.clientY, drag.y0) - box.top;
    Object.assign(rect.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(e.clientX - drag.x0)}px`, height: `${Math.abs(e.clientY - drag.y0)}px` });
    rect.hidden = false;
    return;
  }
  if (drag.kind === 'move') {
    // Ctrl pressed or let go mid-drag: carry on from here in the other plane.
    if (e.ctrlKey !== drag.vertical) {
      const ids = new Set(drag.base.map((b) => b.id));
      const now = shapes.filter((x) => ids.has(x.id));
      const { plane, normal } = movePlane(now, e.ctrlKey);
      const start = rayPlane(viewport.rayAt(e.clientX, e.clientY), plane, normal);
      if (start) drag = { kind: 'move', base: now, vertical: e.ctrlKey, start, plane, normal };
      return;
    }
    const at = rayPlane(viewport.rayAt(e.clientX, e.clientY), drag.plane, drag.normal);
    if (!at) return;
    const snap = (v: number) => Math.round(v * 2) / 2;
    const by: Vec3 = drag.vertical ? [0, snap(at[1] - drag.start[1]), 0] : [snap(at[0] - drag.start[0]), 0, snap(at[2] - drag.start[2])];
    writeShapes(moveGroup(drag.base, by));
    status(`Moved ${by.filter((v) => v !== 0).length ? (drag.vertical ? `${by[1] > 0 ? 'up' : 'down'} ${Math.abs(by[1])} m` : `${Math.abs(by[0])} m along x, ${Math.abs(by[2])} m along z`) : 'nowhere yet'}.`);
    return;
  }
  // Rotate: the axis follows the keys held; changing it carries on from the turn so far.
  const axis: 0 | 1 | 2 = e.ctrlKey ? 0 : e.altKey ? 2 : 1;
  if (axis !== drag.axis) {
    const ids = new Set(drag.base.map((b) => b.id));
    const now = shapes.filter((x) => ids.has(x.id));
    drag = { ...drag, base: now, axis, x0: e.clientX };
  }
  const rules = turnRules(drag.base);
  if (!rules.axes[axis]) { status(`Rotate: ${rules.why}`, 'error'); return; }
  // Half a degree a pixel; to the right turns clockwise seen from above (and tilts or rolls forward).
  const want = (e.clientX - drag.x0) * 0.5 * (axis === 1 ? -1 : 1);
  const turned = toolTurn(drag.base, axis, want, drag.pivot);
  writeShapes(turned.shapes);
  status(`Rotate: ${Math.abs(turned.degrees)}°, ${AXIS_NAMES[axis]} (steps of ${rules.step}°).`);
}

function endToolDrag(e: PointerEvent): void {
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.kind === 'anchor') { if (!d.moved) placeAnchor(e); return; }
  if (d.kind === 'select') {
    $('select-rect').hidden = true;
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!d.moved) {
      // A click: the shape under the mouse, with the list's Ctrl and Shift.
      const id = shapeAt(e);
      if (!id) { if (!add) select(null); return; }
      if (e.ctrlKey || e.metaKey) pickToggle(id);
      else if (e.shiftKey) pickRange(id, false);
      else select(id);
      return;
    }
    const [ax, ay] = viewport.toScreen(d.x0, d.y0), [bx, by] = viewport.toScreen(e.clientX, e.clientY);
    const ids = shapesInRect(viewport.viewProjection(), { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }, shapes, cache);
    const next = new Set([...(add ? picked : []), ...ids]);
    if (!next.size) { select(null); return; }
    picked = next;
    selectedId = ids.at(-1) ?? selectedId;
    anchorId = selectedId;
    segmentSel = null;
    selectionChanged();
    status(`Selected ${ids.length} shape${ids.length === 1 ? '' : 's'}${add ? ' more' : ''}.`, 'ok');
    return;
  }
  // Move or Rotate finished: the settings panel shows the new place.
  if (dragFrame) { cancelAnimationFrame(dragFrame); dragFrame = 0; }
  renderEditor();
  renderList();
  recompute();
}

// ---------- where the blueprint lands (see anchor.ts) ----------

/** The blocks shown (the build, and a marker block when there is one), as cell keys, for the Anchor tool's clicks. */
let solid: { keys: Set<number>; min: Vec3; max: Vec3 } | null = null;
function shownBlocks(): { keys: Set<number>; min: Vec3; max: Vec3 } {
  if (solid) return solid;
  const all = landing?.marker ? [...voxels, { i: landing.cell[0], j: landing.cell[1], k: landing.cell[2], materialItem: 0 }] : voxels;
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const keys = new Set<number>();
  for (const v of all) {
    keys.add(key(v.i, v.j, v.k));
    const c = [v.i, v.j, v.k];
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], c[a] * VOXEL_SIZE); max[a] = Math.max(max[a], (c[a] + 1) * VOXEL_SIZE); }
  }
  return (solid = { keys, min, max });
}

const meters = (c: Vec3) => c.map((v) => v * VOXEL_SIZE).join(', ');

/** The Anchor tool's click: a block of the build, a marker in front of a face (Shift), or a marker on empty ground. */
function placeAnchor(e: PointerEvent): void {
  const ray = viewport.rayAt(e.clientX, e.clientY);
  const s = shownBlocks();
  const hit = pickBlock(ray, s.keys, s.min, s.max);
  let cell: Vec3 | null = null;
  if (hit) cell = e.shiftKey ? hit.front ?? hit.cell : hit.cell;
  else {
    // Empty space: on the level of the build's lowest blocks (or the ground), under the mouse.
    const j = voxels.length ? Math.min(...voxels.map((v) => v.j)) : 0;
    const at = rayPlane(ray, [0, j * VOXEL_SIZE, 0], [0, 1, 0]);
    if (at) cell = [Math.floor(at[0] / VOXEL_SIZE), j, Math.floor(at[2] / VOXEL_SIZE)];
  }
  if (!cell) { status('Anchor: click a block, or the ground in front of the build.', 'error'); return; }
  setAnchor(cell);
}

function setAnchor(cell: Vec3 | null): void {
  if (JSON.stringify(cell) === JSON.stringify(landAt)) return;
  record('anchor');
  landAt = cell;
  refreshDirty();
  recompute();
  status(anchorText(true), 'ok');
}

/** What the anchor is, in words. */
function anchorText(long = false): string {
  if (!landing) return 'Anchor: none yet (the build has no blocks).';
  const at = `at ${meters(landing.cell)} m`;
  if (landing.auto) return long ? `Anchor: by default, the lowest block nearest the middle (${at}). It lands on the block you place in game.` : 'Anchor: auto';
  if (landing.marker) return long ? `Anchor: a marker block (${materialById(MARKER_MATERIAL)?.name ?? 'marker'}) ${at}. In game it takes the place of the block you put down; delete it after placing.` : 'Anchor: marker';
  return long ? `Anchor: the build's block ${at}. In game it takes the place of the block you put down.` : 'Anchor: block';
}

/** The anchor in the view (always with the Anchor tool; otherwise only once picked) and in the ribbon. */
function showAnchor(): void {
  if (!viewport) return;
  viewport.setAnchor(landing && (tool === 'anchor' || !landing.auto) ? landing.cell : null, landing?.auto ? 'auto' : 'picked');
  const info = document.getElementById('anchor-info');
  if (info) { info.textContent = anchorText(); info.title = `${anchorText(true)}${lift ? ` Lands ${lift} m ${lift > 0 ? 'above' : 'below'} it.` : ''}`; }
  const clear = document.getElementById('anchor-clear') as HTMLButtonElement | null;
  if (clear) clear.hidden = !landAt;
}

/** W A S D and Page Up / Page Down move the camera while held; Shift goes faster. */
const held = new Set<string>();
let walkMode: 'fly' | 'orbit' = 'fly';
const WALK_SETTING = 'shapeforge.walkMode';

function setWalkMode(m: 'fly' | 'orbit'): void {
  walkMode = m;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-walk]')) b.setAttribute('aria-pressed', String(b.dataset.walk === m));
  try { localStorage.setItem(WALK_SETTING, m); } catch { /* not remembered */ }
}

const WALK_KEYS = new Set(['w', 'a', 's', 'd', 'pageup', 'pagedown']);
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable);

function startWalking(): void {
  let last = performance.now();
  let fast = false;
  document.addEventListener('keydown', (e) => {
    fast = e.shiftKey;
    if (pageActive || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (WALK_KEYS.has(k)) { held.add(k); e.preventDefault(); }
    // N, V, M and R pick the tools.
    const t = TOOL_KEYS[k];
    if (t && !e.shiftKey) { setTool(t); e.preventDefault(); }
  });
  document.addEventListener('keyup', (e) => { fast = e.shiftKey; held.delete(e.key.toLowerCase()); });
  window.addEventListener('blur', () => held.clear());
  const step = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (held.size && viewport) {
      const { forward, right, distance } = viewport.heading();
      const speed = Math.max(3, distance * 0.8) * (fast ? 3 : 1);
      const on = (k: string) => (held.has(k) ? 1 : 0);
      const ahead = on('w') - on('s'), side = on('d') - on('a'), up = on('pageup') - on('pagedown');
      if (walkMode === 'fly') {
        viewport.moveBy([(forward[0] * ahead + right[0] * side) * speed * dt, up * speed * dt, (forward[2] * ahead + right[2] * side) * speed * dt]);
      } else {
        // Orbit: A and D swing round, W and S zoom in and out; Page Up / Down still raise and lower.
        viewport.orbitBy(side * (fast ? 3 : 1.4) * dt, Math.exp(-ahead * (fast ? 2.4 : 1.1) * dt));
        if (up) viewport.moveBy([0, up * speed * dt, 0]);
      }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- sidebars ----------

/** The two sidebars' widths: dragged with the handles beside the view, remembered between sessions. */
const SIDEBARS = {
  left: { prop: '--left-w', key: 'shapeforge.leftWidth', initial: 300 },
  right: { prop: '--right-w', key: 'shapeforge.rightWidth', initial: 290 },
} as const;
type Side = keyof typeof SIDEBARS;
const SIDEBAR_MIN = 220;
/** The view always keeps at least this much width. */
const VIEW_MIN = 280;
const widths: Record<Side, number> = { left: SIDEBARS.left.initial, right: SIDEBARS.right.initial };

/** A width for one sidebar that leaves the other and the view room. */
function clampWidth(side: Side, w: number): number {
  const other = widths[side === 'left' ? 'right' : 'left'];
  const max = Math.max(SIDEBAR_MIN, window.innerWidth - other - 12 - VIEW_MIN);
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN, w)));
}

function setWidth(side: Side, w: number, save = true): void {
  widths[side] = clampWidth(side, w);
  document.body.style.setProperty(SIDEBARS[side].prop, `${widths[side]}px`);
  if (!save) return;
  try { localStorage.setItem(SIDEBARS[side].key, String(widths[side])); } catch { /* not remembered */ }
}

function setupSidebars(): void {
  for (const side of ['left', 'right'] as Side[]) {
    let stored = NaN;
    try { stored = Number(localStorage.getItem(SIDEBARS[side].key)); } catch { /* defaults */ }
    widths[side] = stored > 0 ? stored : SIDEBARS[side].initial;
  }
  for (const side of ['left', 'right'] as Side[]) {
    const gutter = $(`gutter-${side}`);
    // The left sidebar grows as the handle moves right; the right one as it moves left.
    const sign = side === 'left' ? 1 : -1;
    gutter.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, w0 = widths[side];
      gutter.setPointerCapture(e.pointerId);
      gutter.classList.add('dragging');
      document.body.classList.add('resizing');
      const move = (ev: PointerEvent) => setWidth(side, w0 + sign * (ev.clientX - x0), false);
      const up = (ev: PointerEvent) => {
        gutter.releasePointerCapture(ev.pointerId);
        gutter.removeEventListener('pointermove', move);
        gutter.removeEventListener('pointerup', up);
        gutter.removeEventListener('pointercancel', up);
        gutter.classList.remove('dragging');
        document.body.classList.remove('resizing');
        setWidth(side, widths[side]);
      };
      gutter.addEventListener('pointermove', move);
      gutter.addEventListener('pointerup', up);
      gutter.addEventListener('pointercancel', up);
    });
    gutter.addEventListener('dblclick', () => setWidth(side, SIDEBARS[side].initial));
    gutter.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = (e.shiftKey ? 64 : 16) * (e.key === 'ArrowRight' ? 1 : -1);
      setWidth(side, widths[side] + sign * step);
    });
  }
  // A smaller window squeezes them, the wider one first; a wider window doesn't grow them back.
  const fit = () => {
    const room = Math.max(2 * SIDEBAR_MIN, window.innerWidth - 12 - VIEW_MIN);
    let over = widths.left + widths.right - room;
    if (over > 0) {
      const wide: Side = widths.left >= widths.right ? 'left' : 'right', narrow: Side = wide === 'left' ? 'right' : 'left';
      const fromWide = Math.min(over, Math.max(0, widths[wide] - Math.max(SIDEBAR_MIN, widths[narrow])));
      widths[wide] -= fromWide;
      over -= fromWide;
      // Then both evenly.
      if (over > 0) { widths.left -= over / 2; widths.right -= over / 2; }
    }
    for (const side of ['left', 'right'] as Side[]) setWidth(side, widths[side], false);
  };
  fit();
  window.addEventListener('resize', fit);
}

function main(): void {
  setupSidebars();
  viewport = new Viewport($('viewport'));
  applyTheme();
  // The 3D tools: a left drag in the view does what the chosen tool does (Navigate leaves it to the view).
  const canvas = viewport.canvas;
  canvas.addEventListener('pointerdown', (e) => {
    if (tool === 'navigate' || e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    startToolDrag(e);
  });
  canvas.addEventListener('pointermove', (e) => { if (drag) moveToolDrag(e); });
  const end = (e: PointerEvent) => { if (drag) { endToolDrag(e); try { canvas.releasePointerCapture(e.pointerId); } catch { /* already */ } } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool-button]')) b.addEventListener('click', () => setTool(b.dataset.toolButton as Tool));
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-walk]')) b.addEventListener('click', () => setWalkMode(b.dataset.walk as 'fly' | 'orbit'));
  let savedWalk: string | null = null;
  try { savedWalk = localStorage.getItem(WALK_SETTING); } catch { /* default */ }
  setWalkMode(savedWalk === 'orbit' ? 'orbit' : 'fly');
  setTool('navigate');
  startWalking();

  const addKind = $<HTMLSelectElement>('add-kind');
  // Grouped: 2D shapes, 3D shapes, roofs.
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const def of SHAPE_LIST) {
    const name = def.group ?? 'Shapes';
    let g = groups.get(name);
    if (!g) { g = el('optgroup', { label: name }); groups.set(name, g); addKind.append(g); }
    g.append(el('option', { value: def.kind, textContent: def.label }));
  }

  $('add').addEventListener('click', () => {
    // New shapes take the selected shape's material, unless that's an imported layer keeping its own.
    const current = selected()?.materialItem ?? DEFAULT_MATERIAL;
    const material = current === KEEP_MATERIALS ? DEFAULT_MATERIAL : current;
    const shape = createShape(addKind.value as ShapeKind, material);
    record();
    // Into the selected folder (or the selected shape's), at its end.
    setScene(insertShape(scene(), shape, targetFolder()));
    selectedId = shape.id;
    structureChanged();
  });

  $('import').addEventListener('click', async () => {
    const result = await window.shapeforge.importBlueprint();
    if (result.status === 'cancelled') return;
    if (result.status === 'error') {
      status(`Could not import the file: ${result.message}`, 'error');
      return;
    }
    try {
      const read = readBlueprint(result.text, { mirror: true });
      const name = (result.path.split(/[\\/]/).pop() ?? 'blueprint').replace(/\.ebblueprint$/i, '');
      const shape = createImportedShape(name, read.voxels);
      record();
      setScene(insertShape(scene(), shape, targetFolder()));
      selectedId = shape.id;
      structureChanged();
      const skipped = read.skipped ? ` ${read.skipped} piece${read.skipped === 1 ? '' : 's'} of unknown types were left out.` : '';
      status(`Imported ${name}: ${read.pieces.toLocaleString()} pieces, ${layerBlockCount(shape.layer!).toLocaleString()} blocks.${skipped}`, read.skipped ? 'info' : 'ok');
    } catch (err) {
      status(`Could not import the file: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  });

  $('duplicate').addEventListener('click', () => {
    const s = selected(), f = selectedFolder();
    if (f) {
      // A folder and everything in it, straight after it, the copies set 1 m aside.
      record();
      const out = duplicateFolder(scene(), f.id, (x) => {
        const c = cloneShape(x);
        c.position = [x.position[0] + 1, x.position[1], x.position[2] + 1];
        return c;
      });
      setScene(out.scene);
      folders = folders.map((x) => (x.id === out.id ? { ...x, name: `${f.name} copy`.slice(0, MAX_NAME) } : x));
      selectedId = out.id;
      structureChanged();
      return;
    }
    if (!s) return;
    const copy = cloneShape(s);
    copy.position = [s.position[0] + 1, s.position[1], s.position[2] + 1];
    record();
    setScene(insertAfter(scene(), copy, s.id));
    selectedId = copy.id;
    structureChanged();
  });

  // Up and down move the selected shape or folder past the item beside it, within its folder.
  const move = (delta: -1 | 1) => {
    if (!selectedId || !canStep(scene(), selectedId, delta)) return;
    record();
    setScene(stepItem(scene(), selectedId, delta));
    structureChanged();
  };
  $('move-up').addEventListener('click', () => move(-1));
  $('move-down').addEventListener('click', () => move(1));

  const remove = () => {
    if (isMulti()) {
      const group = pickedShapes();
      const pickedFolders = [...picked].filter((id) => folders.some((f) => f.id === id));
      if (!window.confirm(`Delete the ${group.length} selected shape${group.length === 1 ? '' : 's'}${pickedFolders.length ? ` and ${pickedFolders.length} folder${pickedFolders.length === 1 ? '' : 's'}` : ''}?`)) return;
      record();
      const first = shapes.findIndex((s) => s.id === group[0]?.id);
      let next = scene();
      for (const id of pickedFolders) next = deleteFolder(next, id, false);
      const gone = new Set(group.map((s) => s.id));
      setScene({ ...next, shapes: next.shapes.filter((s) => !gone.has(s.id)) });
      selectedId = shapes[Math.max(0, Math.min(first, shapes.length - 1))]?.id ?? null;
      picked = new Set(selectedId ? [selectedId] : []);
      structureChanged();
      return;
    }
    const f = selectedFolder();
    if (f) { removeFolder(f.id, false); return; }
    const i = shapes.findIndex((s) => s.id === selectedId);
    if (i < 0) return;
    const gone = shapes[i];
    record();
    shapes = shapes.filter((s) => s.id !== selectedId);
    // The next shape, or the folder it was in once that's empty.
    selectedId = shapes[Math.min(i, shapes.length - 1)]?.id ?? gone.folder ?? null;
    if (gone.folder && !shapes.some((s) => s.folder === gone.folder) && shapes[i]?.folder !== gone.folder) selectedId = gone.folder;
    structureChanged();
  };
  $('delete').addEventListener('click', remove);

  $('new-folder').addEventListener('click', () => {
    // Where the selected shape or folder is, holding it.
    const s = selected(), f = selectedFolder();
    const parent = f ? f.parent : s?.folder ?? null;
    const folder: Folder = { id: newFolderId(), name: freeFolderName(scene(), parent), parent, open: true };
    record();
    setScene(selectedId ? wrapInFolder(scene(), folder, selectedId) : addFolder(scene(), folder, { parent }));
    selectedId = folder.id;
    structureChanged();
    renameSelectedInList();
  });

  // Dropping below the last row puts the item at the end of the list.
  const listEl = $('shape-list');
  // Rows keep lining up as the sidebar is resized.
  let listW = 0;
  new ResizeObserver(() => { if (listEl.clientWidth !== listW) { listW = listEl.clientWidth; fitRowWidths(); } }).observe(listEl);
  listEl.addEventListener('dragover', (e) => { if (dragId) e.preventDefault(); });
  listEl.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragId) return;
    const next = moveItem(scene(), dragId, { parent: null });
    dragId = null;
    clearDropMarks();
    if (next === scene()) return;
    record();
    setScene(next);
    structureChanged();
  });

  // Turning the whole build: every shape a quarter turn around the build's middle (one undo step).
  const turnAll = (dir: 1 | -1) => {
    if (shapes.length === 0) return;
    record();
    shapes = turnScene(shapes, dir);
    structureChanged();
  };
  $('turn-left').addEventListener('click', () => turnAll(1));
  $('turn-right').addEventListener('click', () => turnAll(-1));
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (pageActive || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (e.key === 'Delete') remove();
    else if (e.key === 'F2') { e.preventDefault(); renameSelectedInList(); }
  });

  $('fit').addEventListener('click', () => viewport.fit());

  const mergeBox = $<HTMLInputElement>('opt-merge');
  mergeBox.checked = options.merge;
  mergeBox.addEventListener('change', () => {
    options.merge = mergeBox.checked;
    showStats();
  });
  const liftInput = $<HTMLInputElement>('lift');
  liftInput.addEventListener('input', () => {
    const n = parseFloat(liftInput.value);
    if (!Number.isFinite(n)) return;
    record('lift');
    lift = cleanLift(n);
    refreshDirty();
    showAnchor();
  });
  $('anchor-clear').addEventListener('click', () => setAnchor(null));
  $('name').addEventListener('input', () => {
    record('name');
    projectName = $<HTMLInputElement>('name').value;
    showName();
    refreshDirty();
  });
  showName();

  /** Replaces the whole scene, e.g. after New or Open. */
  const loadScene = (name: string, next: Shape[], path: string | null, nextFolders: Folder[] = [], anchor: Vec3 | null = null, nextLift = 0) => {
    setScene(normalize({ shapes: next, folders: nextFolders }));
    landAt = anchor;
    lift = nextLift;
    $<HTMLInputElement>('lift').value = String(lift);
    selectedId = shapes[0]?.id ?? null;
    projectPath = path;
    projectName = name;
    showName();
    savedKey = stateKey();
    history.clear();
    syncUndoButtons();
    firstFit = true;
    structureChanged();
  };

  /** An untouched new file (never saved, nothing done to it): New and Open use its tab instead of adding one. */
  const pristine = () => !projectPath && !dirty && !history.canUndo;

  /** Sets the file being edited aside and starts a fresh one in a new tab (its scene is loaded next). */
  const addTab = () => {
    docs[currentDoc] = captureDoc();
    docs.push(captureDoc());
    currentDoc = docs.length - 1;
    history = new History<Snapshot>();
  };

  const switchTo = (i: number) => {
    if (pageActive && i === currentDoc) { showPage(false); return; }
    if (pageActive) showPage(false);
    if (i === currentDoc || i < 0 || i >= docs.length) return;
    docs[currentDoc] = captureDoc();
    currentDoc = i;
    applyDoc(docs[i]);
    saveSession();
    status('');
  };

  const closeTab = (i: number) => {
    if (i < 0 || i >= docs.length) return;
    if (i !== currentDoc) docs[currentDoc] = captureDoc();
    const d = i === currentDoc ? captureDoc() : docs[i];
    if (d.dirty && !window.confirm(`${docLabel(d)} has unsaved changes. Close it anyway and lose them?`)) return;
    docs.splice(i, 1);
    if (!docs.length) {
      // The last one closed: a fresh untitled file.
      history = new History<Snapshot>();
      docs.push(captureDoc());
      currentDoc = 0;
      loadScene('', [createShape('spheroid')], null);
    } else {
      currentDoc = Math.min(i === currentDoc ? i : currentDoc - (i < currentDoc ? 1 : 0), docs.length - 1);
      applyDoc(docs[currentDoc]);
    }
    saveSession();
    renderFileTabs();
  };
  fileTabActions.switchTo = switchTo;
  fileTabActions.close = closeTab;

  const newProject = () => {
    if (pageActive) showPage(false);
    if (!pristine()) addTab();
    loadScene('', [createShape('spheroid')], null);
    renderFileTabs();
    status('');
  };

  /** Opens a project's text into a tab: the one it's already in, the untouched new one, or a new tab. */
  const openText = (path: string, text: string): boolean => {
    if (pageActive) showPage(false);
    const at = docs.findIndex((d, i) => (i === currentDoc ? projectPath : d.projectPath) === path);
    if (at >= 0) { switchTo(at); status(`${projectNameFromPath(path)} is already open.`, 'info'); return true; }
    try {
      const project = parseProject(text);
      if (!pristine()) addTab();
      loadScene(project.name, project.shapes, path, project.folders ?? [], project.anchor ?? null, project.lift ?? 0);
      renderFileTabs();
      saveSession();
      return true;
    } catch (err) {
      status(err instanceof ProjectError ? `${projectNameFromPath(path)}: ${err.message}` : `Could not open ${path}: ${String(err)}`, 'error');
      return false;
    }
  };

  const openProject = async () => {
    const result = await window.shapeforge.openProject();
    if (result.status === 'cancelled') return;
    if (result.status === 'error') {
      status(`Could not open the file: ${result.message}`, 'error');
      return;
    }
    if (openText(result.path, result.text)) status(`Opened ${result.path}`, 'ok');
  };

  /** Reopens the files open last time (Settings: Reopen files), the last active one in front. */
  const reopenSession = async () => {
    if (!settings.reopen) return;
    let saved: { files?: unknown; active?: unknown } = {};
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}'); } catch { /* none */ }
    const files = Array.isArray(saved.files) ? saved.files.filter((f): f is string => typeof f === 'string') : [];
    if (!files.length) return;
    const opened: string[] = [], missing: string[] = [];
    for (const path of files) {
      const r = await window.shapeforge.readProject(path);
      if (r.status === 'opened' && openText(r.path, r.text)) opened.push(path);
      else missing.push(projectNameFromPath(path));
    }
    const active = typeof saved.active === 'number' ? files[saved.active] : undefined;
    const at = docs.findIndex((d, i) => (i === currentDoc ? projectPath : d.projectPath) === active);
    if (at >= 0) switchTo(at);
    saveSession();
    if (missing.length) status(`Reopened ${opened.length} file${opened.length === 1 ? '' : 's'}; couldn't open ${missing.join(', ')} (moved or deleted?).`, 'info');
    else if (opened.length) status(`Reopened ${opened.length} file${opened.length === 1 ? '' : 's'} from last time.`, 'ok');
  };

  const saveProject = async (saveAs: boolean) => {
    window.clearTimeout(timer);
    const savedState = stateKey();
    const result = await window.shapeforge.saveProject({
      // A blank name is saved blank: the blueprint keeps following the file's name.
      text: serializeProject({ name: projectName.trim(), shapes, folders, anchor: landAt, lift }),
      path: saveAs ? undefined : projectPath ?? undefined,
      suggestedName: projectPath ? projectNameFromPath(projectPath) : blueprintName(),
    });
    if (result.status === 'saved') {
      projectPath = result.path;
      showName();
      savedKey = savedState;
      refreshDirty();
      saveSession();
      status(`Saved ${result.path}`, 'ok');
    } else if (result.status === 'error') {
      status(`Save failed: ${result.message}`, 'error');
    }
  };

  $('new').addEventListener('click', newProject);
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('open').addEventListener('click', () => void openProject());
  $('save').addEventListener('click', () => void saveProject(false));
  $('save-as').addEventListener('click', () => void saveProject(true));
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    // With the README in front, only the file and tab keys work.
    if (pageActive && ['z', 'y', 's'].includes(k)) { e.preventDefault(); return; }
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    else if (k === 's') { e.preventDefault(); void saveProject(e.shiftKey); }
    else if (k === 'o' && !e.shiftKey) { e.preventDefault(); void openProject(); }
    else if (k === 'n' && !e.shiftKey) { e.preventDefault(); newProject(); }
    else if (k === 'w' && !e.shiftKey) { e.preventDefault(); if (pageActive) closePage(); else closeTab(currentDoc); }
    else if (k === 'tab' && docs.length + (pageOpen ? 1 : 0) > 1) {
      // Round the tabs in order: the files, then the README (if open).
      e.preventDefault();
      const n = docs.length + (pageOpen ? 1 : 0);
      const at = pageActive ? docs.length : currentDoc;
      const to = (at + (e.shiftKey ? n - 1 : 1)) % n;
      if (to === docs.length) showPage(true);
      else switchTo(to);
    }
  });

  // Settings: the theme and reopening files, kept on this computer.
  const dialog = $<HTMLDialogElement>('settings-dialog');
  $('settings').addEventListener('click', () => {
    for (const r of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) r.checked = r.value === settings.theme;
    $<HTMLInputElement>('opt-reopen').checked = settings.reopen;
    $('theme-detail').textContent = systemThemeDetail;
    dialog.showModal();
  });
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
    r.addEventListener('change', () => { if (r.checked) { settings.theme = r.value as Settings['theme']; saveSettings(); applyTheme(); } });
  }
  $<HTMLInputElement>('opt-reopen').addEventListener('change', () => { settings.reopen = $<HTMLInputElement>('opt-reopen').checked; saveSettings(); });
  $('settings-done').addEventListener('click', () => dialog.close());

  // About: the logo, version, author and credits (from package.json).
  const about = $<HTMLDialogElement>('about-dialog');
  $('about-version').textContent = APP_VERSION;
  $('about-author').textContent = APP_AUTHOR.name ?? '';
  const mail = $<HTMLAnchorElement>('about-email');
  mail.textContent = APP_AUTHOR.email ?? '';
  mail.href = APP_AUTHOR.email ? `mailto:${APP_AUTHOR.email}?subject=${encodeURIComponent(`ShapeForge ${APP_VERSION}`)}` : '#';
  const source = $<HTMLAnchorElement>('about-source');
  source.textContent = APP_HOMEPAGE.replace(/^https:\/\//, '');
  source.href = APP_HOMEPAGE || '#';
  source.target = '_blank';
  const openAbout = () => about.showModal();
  $('about').addEventListener('click', openAbout);
  $('brand-logo').addEventListener('click', openAbout);
  $('about-close').addEventListener('click', () => about.close());
  $('about-readme').addEventListener('click', () => { about.close(); showPage(true); $('page-view').scrollTop = 0; });
  // Links within the README scroll to their heading; https: and mailto: links open outside (main.ts).
  $('page-body').addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href') ?? '';
    if (!href.startsWith('#')) return;
    e.preventDefault();
    document.getElementById(href.slice(1))?.scrollIntoView({ block: 'start' });
  });

  // The first file, then last session's files.
  docs = [captureDoc()];
  currentDoc = 0;
  renderFileTabs();
  void reopenSession();

  $('export').addEventListener('click', async () => {
    recompute();
    if (voxels.length === 0 && roofs.length === 0) {
      status('Nothing to export: the scene has no blocks.', 'error');
      return;
    }
    const button = $<HTMLButtonElement>('export');
    button.disabled = true;
    status('Exporting…');
    try {
      const name = blueprintName();
      const result = await window.shapeforge.exportBlueprint({ name, voxels, merge: options.merge, roofs, anchor: landAt && [...landAt], lift });
      if (result.status === 'saved') status(`Saved ${result.pieces.toLocaleString()} pieces to ${result.path}`, 'ok');
      else if (result.status === 'cancelled') status('');
      else status(`Export failed: ${result.message}`, 'error');
    } finally {
      button.disabled = false;
    }
  });

  savedKey = stateKey();
  syncUndoButtons();
  structureChanged();
}

main();
