import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeBlueprint } from '../core/blueprint';
import { isProjectPath, KnownFiles } from '../core/known-files';
import { PROJECT_EXTENSION } from '../core/project-file';
import { themeFromRegistry, type SystemTheme } from '../core/theme';
import {
  DIRTY_CHANNEL,
  EXPORT_CHANNEL,
  IMPORT_CHANNEL,
  OPEN_PROJECT_CHANNEL,
  READ_PROJECT_CHANNEL,
  SAVE_PROJECT_CHANNEL,
  SET_THEME_CHANNEL,
  SYSTEM_THEME_CHANGED_CHANNEL,
  SYSTEM_THEME_CHANNEL,
  type ExportRequest,
  type ExportResult,
  type OpenProjectResult,
  type SaveProjectRequest,
  type SaveProjectResult,
} from '../shared/ipc';

/** Projects bigger than this are almost certainly not ShapeForge projects. */
const MAX_PROJECT_BYTES = 50 * 1024 * 1024;
const MAX_BLUEPRINT_BYTES = 100 * 1024 * 1024;

/** Saving writes .shapeforge; opening also accepts .json, which projects saved by versions 0.3 to 0.5 end in. */
const SAVE_PROJECT_FILTERS = [{ name: 'ShapeForge project', extensions: [PROJECT_EXTENSION] }];
const OPEN_PROJECT_FILTERS = [
  { name: 'ShapeForge project', extensions: [PROJECT_EXTENSION, 'json'] },
  { name: 'All files', extensions: ['*'] },
];

// ---------- theme ----------
// Windows' light/dark setting for apps, read from the registry rather than trusted to Chromium, which reported light
// on a Windows set to dark. Dark whenever it can't be read. Elsewhere (not a target), the OS's as Electron sees it,
// taken before the app sets its own.

const PERSONALIZE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
const startupDark = nativeTheme.shouldUseDarkColors;
let systemTheme: SystemTheme =
  process.platform === 'win32'
    ? { theme: 'dark', detail: "Windows' setting not read yet, so dark" }
    : { theme: startupDark ? 'dark' : 'light', detail: `The system asks for ${startupDark ? 'dark' : 'light'}` };

/** Reads Windows' settings again; tells the windows if anything changed. */
function readSystemTheme(): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    execFile('reg', ['query', PERSONALIZE_KEY], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
      const next = themeFromRegistry(err ? null : stdout);
      if (next.theme !== systemTheme.theme || next.detail !== systemTheme.detail) {
        systemTheme = next;
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send(SYSTEM_THEME_CHANGED_CHANNEL, next);
      }
      resolve();
    });
  });
}

ipcMain.on(SYSTEM_THEME_CHANNEL, (event) => { event.returnValue = systemTheme; });
ipcMain.on(SET_THEME_CHANNEL, (_event, theme: unknown) => {
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
});
// Windows' setting changing shows up here (and on coming back to the window, in case it didn't).
nativeTheme.on('updated', () => void readSystemTheme());
app.on('browser-window-focus', () => void readSystemTheme());

// ---------- files the user chose ----------
// The page asks for files by path in two places: reopening last session's files, and Save (to the file already open).
// Both are allowed only for files the user picked in an Open or Save dialog, now or in an earlier session; anything
// else gets the dialog (Save) or is refused (reopening). See known-files.ts.

const known = new KnownFiles(process.platform === 'win32');
const knownStore = () => join(app.getPath('userData'), 'known-projects.json');
/**
 * Right after updating from a version without the list, last session's files aren't on it yet: for the first
 * moments of that first start, the files the page reopens (project files only) are taken onto it.
 */
let adoptUntil = 0;

function loadKnown(): void {
  const file = knownStore();
  if (!existsSync(file)) { adoptUntil = Date.now() + 15_000; return; }
  try { known.load(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* start a new list */ }
}

function remember(path: string): void {
  known.add(path);
  void writeFile(knownStore(), JSON.stringify(known.list()), 'utf8').catch(() => { /* kept for this session only */ });
}

/** Only the app's own page may ask for files. */
function fromApp(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith('file://') && /\/index\.html$/.test(url.split(/[?#]/)[0]);
}

/** Windows with unsaved changes, as reported by their page. */
const dirtyWindows = new WeakSet<BrowserWindow>();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: `ShapeForge ${app.getVersion()}`,
    backgroundColor: '#15171a',
    icon: join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('close', (event) => {
    if (!dirtyWindows.has(win)) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: 'A project open in ShapeForge has unsaved changes.',
      detail: 'If you close now, the changes since the last save are lost (the tab marked • has them).',
    });
    if (choice !== 0) event.preventDefault();
  });

  // Links (the About box's e-mail address) open in the user's own mail program or browser, never in the app window.
  const openOutside = (url: string) => {
    if (/^(mailto:|https:)/i.test(url)) void shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    openOutside(url);
  });

  void win.loadFile(join(__dirname, 'index.html'));
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return cleaned || 'shapeforge';
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function senderWindow(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

async function askSavePath(win: BrowserWindow | undefined, options: Electron.SaveDialogOptions): Promise<string | null> {
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? null : result.filePath;
}

ipcMain.handle(EXPORT_CHANNEL, async (event, req: ExportRequest): Promise<ExportResult> => {
  if (!fromApp(event)) return { status: 'error', message: 'Not allowed.' };
  try {
    const text = writeBlueprint(
      req.voxels,
      {
        name: req.name || 'shapeforge',
        created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        id: randomBytes(16).toString('hex'),
      },
      (s) => createHash('sha256').update(s).digest('hex'),
      { merge: req.merge, roofs: req.roofs, anchor: req.anchor ?? undefined, lift: req.lift, mirror: true },
    );
    const pieces = JSON.parse(text).pieces.length as number;
    const path = await askSavePath(senderWindow(event), {
      title: 'Export blueprint',
      defaultPath: `${safeFileName(req.name)}.ebblueprint`,
      filters: [{ name: 'Embervale blueprint', extensions: ['ebblueprint'] }],
    });
    if (!path) return { status: 'cancelled' };
    await writeFile(path, text, 'utf8');
    return { status: 'saved', path, pieces };
  } catch (err) {
    return { status: 'error', message: errorMessage(err) };
  }
});

ipcMain.handle(SAVE_PROJECT_CHANNEL, async (event, req: SaveProjectRequest): Promise<SaveProjectResult> => {
  if (!fromApp(event) || typeof req?.text !== 'string') return { status: 'error', message: 'Not allowed.' };
  try {
    // Saved straight over only a file the user chose; any other path asks where, starting there.
    let path = typeof req.path === 'string' && known.has(req.path) ? req.path : null;
    if (!path) {
      path = await askSavePath(senderWindow(event), {
        title: 'Save project',
        defaultPath: typeof req.path === 'string' && req.path ? req.path : `${safeFileName(req.suggestedName)}.${PROJECT_EXTENSION}`,
        filters: SAVE_PROJECT_FILTERS,
      });
      if (!path) return { status: 'cancelled' };
    }
    await writeFile(path, req.text, 'utf8');
    remember(path);
    return { status: 'saved', path };
  } catch (err) {
    return { status: 'error', message: errorMessage(err) };
  }
});

/** Shows an open dialog and reads the chosen file as text. */
async function openTextFile(
  event: Electron.IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions,
  maxBytes: number,
  tooBig: string,
  isProject = false,
): Promise<OpenProjectResult> {
  if (!fromApp(event)) return { status: 'error', message: 'Not allowed.' };
  try {
    const win = senderWindow(event);
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const path = result.filePaths[0];
    if (result.canceled || !path) return { status: 'cancelled' };
    if ((await stat(path)).size > maxBytes) return { status: 'error', message: tooBig };
    const text = await readFile(path, 'utf8');
    if (isProject) remember(path);
    return { status: 'opened', path, text };
  } catch (err) {
    return { status: 'error', message: errorMessage(err) };
  }
}

ipcMain.handle(OPEN_PROJECT_CHANNEL, (event) =>
  openTextFile(event, { title: 'Open project', properties: ['openFile'], filters: OPEN_PROJECT_FILTERS },
    MAX_PROJECT_BYTES, 'That file is too large to be a ShapeForge project.', true));

/** Reads a project file the app had open before: only one the user chose (see known-files.ts), no bigger than one can be. */
ipcMain.handle(READ_PROJECT_CHANNEL, async (event, path: unknown): Promise<OpenProjectResult> => {
  if (!fromApp(event)) return { status: 'error', message: 'Not allowed.' };
  try {
    if (typeof path !== 'string') return { status: 'error', message: 'Not a ShapeForge project file.' };
    if (!known.has(path)) {
      if (Date.now() < adoptUntil && isProjectPath(path)) remember(path);
      else return { status: 'error', message: 'Not a file opened in ShapeForge before.' };
    }
    if ((await stat(path)).size > MAX_PROJECT_BYTES) return { status: 'error', message: 'That file is too large to be a ShapeForge project.' };
    return { status: 'opened', path, text: await readFile(path, 'utf8') };
  } catch (err) {
    return { status: 'error', message: errorMessage(err) };
  }
});

ipcMain.handle(IMPORT_CHANNEL, (event) =>
  openTextFile(event, {
    title: 'Import blueprint',
    properties: ['openFile'],
    filters: [{ name: 'Embervale blueprint', extensions: ['ebblueprint'] }, { name: 'All files', extensions: ['*'] }],
  }, MAX_BLUEPRINT_BYTES, 'That blueprint is too large to import.'));

ipcMain.on(DIRTY_CHANNEL, (event, dirty: boolean) => {
  const win = senderWindow(event);
  if (!win) return;
  if (dirty) dirtyWindows.add(win);
  else dirtyWindows.delete(win);
});

void app.whenReady().then(() => {
  // No application menu: the app has its own buttons and shortcuts, and the default menu's Edit > Undo
  // would take Ctrl+Z away from the app's undo.
  Menu.setApplicationMenu(null);
  loadKnown();
  // The app needs no camera, microphone, location, notifications or the like: every such request is refused.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // Know Windows' theme before the page asks for it, so it opens in the right one.
  void readSystemTheme().then(createWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// No embedded pages (webviews) anywhere.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e: { preventDefault(): void }) => e.preventDefault());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
