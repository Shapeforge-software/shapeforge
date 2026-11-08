import { contextBridge, ipcRenderer } from 'electron';
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
  type ShapeForgeApi,
} from '../shared/ipc';

const api: ShapeForgeApi = {
  exportBlueprint: (req) => ipcRenderer.invoke(EXPORT_CHANNEL, req),
  saveProject: (req) => ipcRenderer.invoke(SAVE_PROJECT_CHANNEL, req),
  openProject: () => ipcRenderer.invoke(OPEN_PROJECT_CHANNEL),
  readProject: (path) => ipcRenderer.invoke(READ_PROJECT_CHANNEL, path),
  importBlueprint: () => ipcRenderer.invoke(IMPORT_CHANNEL),
  setDirty: (dirty) => ipcRenderer.send(DIRTY_CHANNEL, dirty),
  systemTheme: () => ipcRenderer.sendSync(SYSTEM_THEME_CHANNEL),
  onSystemTheme: (listener) => {
    ipcRenderer.on(SYSTEM_THEME_CHANGED_CHANNEL, (_e, theme) => listener(theme));
  },
  setTheme: (theme) => ipcRenderer.send(SET_THEME_CHANNEL, theme),
};

contextBridge.exposeInMainWorld('shapeforge', api);
