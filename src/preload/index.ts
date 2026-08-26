import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSnapshot,
  DesktopApi,
  SettingsPatch,
  SyncProgress,
  SyncResult
} from '../shared/types'

const api: DesktopApi = {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke('app:get-snapshot'),
  chooseExportRoot: (): Promise<string | null> => ipcRenderer.invoke('settings:choose-export-root'),
  updateSettings: (patch: SettingsPatch): Promise<AppSnapshot> =>
    ipcRenderer.invoke('settings:update', patch),
  login: (): Promise<AppSnapshot> => ipcRenderer.invoke('auth:login'),
  logout: (): Promise<AppSnapshot> => ipcRenderer.invoke('auth:logout'),
  startSync: (force = false): Promise<SyncResult> => ipcRenderer.invoke('sync:start', force),
  openExportRoot: (): Promise<void> => ipcRenderer.invoke('export:open'),
  onProgress: (callback: (progress: SyncProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SyncProgress): void =>
      callback(progress)
    ipcRenderer.on('sync:progress', listener)
    return () => ipcRenderer.removeListener('sync:progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
