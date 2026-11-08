import type { SystemTheme } from '../core/theme';
import type { RoofPiece } from '../core/roofs';
import type { Voxel } from '../core/types';

export interface ExportRequest {
  name: string;
  voxels: Voxel[];
  /** Replace groups of cubes with larger pieces (same blocks, fewer pieces). */
  merge: boolean;
  /** Roof pieces from roof shapes, written as they are. */
  roofs: RoofPiece[];
  /** The picked anchor cell, or null for the default (see anchor.ts). */
  anchor: [number, number, number] | null;
  /** Meters the build lands above the anchor block. */
  lift: number;
}

export type ExportResult =
  | { status: 'saved'; path: string; pieces: number }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface SaveProjectRequest {
  /** Project file text (see core/project.ts). */
  text: string;
  /** Existing file to overwrite; omitted for Save As or a project never saved. */
  path?: string;
  /** Suggested file name for the dialog, without extension. */
  suggestedName: string;
}

export type SaveProjectResult =
  | { status: 'saved'; path: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export type OpenProjectResult =
  | { status: 'opened'; path: string; text: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

/** The API the preload script exposes to the page as window.shapeforge. */
export interface ShapeForgeApi {
  exportBlueprint(req: ExportRequest): Promise<ExportResult>;
  saveProject(req: SaveProjectRequest): Promise<SaveProjectResult>;
  openProject(): Promise<OpenProjectResult>;
  /** Reads a project file by its path, without asking (reopening last session's files). */
  readProject(path: string): Promise<OpenProjectResult>;
  /** Asks for an .ebblueprint file and returns its text. */
  importBlueprint(): Promise<OpenProjectResult>;
  /** Tells the main process whether there are unsaved changes, so closing the window can warn. */
  setDirty(dirty: boolean): void;
  /** Windows' own light or dark setting (dark when it can't be told), and what was read, for Settings. */
  systemTheme(): SystemTheme;
  /** Calls back when Windows' setting changes. */
  onSystemTheme(listener: (theme: SystemTheme) => void): void;
  /** The theme in use, so the title bar and the app's own dialogs match it. */
  setTheme(theme: 'light' | 'dark'): void;
}

export const EXPORT_CHANNEL = 'shapeforge:export-blueprint';
export const SAVE_PROJECT_CHANNEL = 'shapeforge:save-project';
export const OPEN_PROJECT_CHANNEL = 'shapeforge:open-project';
export const READ_PROJECT_CHANNEL = 'shapeforge:read-project';
export const DIRTY_CHANNEL = 'shapeforge:set-dirty';
export const IMPORT_CHANNEL = 'shapeforge:import-blueprint';
export const SYSTEM_THEME_CHANNEL = 'shapeforge:system-theme';
export const SYSTEM_THEME_CHANGED_CHANNEL = 'shapeforge:system-theme-changed';
export const SET_THEME_CHANNEL = 'shapeforge:set-theme';
