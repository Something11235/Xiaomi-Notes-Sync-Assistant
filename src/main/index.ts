import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { AppSnapshot, SettingsPatch, SyncProgress, SyncResult } from '../shared/types'
import { ConfigStore } from './config-store'
import { SyncEngine } from './sync-engine'
import { openXiaomiLogin } from './xiaomi-auth'

let mainWindow: BrowserWindow | null = null
let syncing = false
let lastResult: SyncResult | null = null
const config = new ConfigStore()

function snapshot(): AppSnapshot {
  const settings = config.getSettings()
  let loggedIn = false
  try {
    loggedIn = Boolean(config.getCookie())
  } catch {
    loggedIn = false
  }
  return {
    settings,
    account: {
      loggedIn,
      user: config.getUser(),
      host: settings.host
    },
    syncing,
    lastResult
  }
}

function sendProgress(progress: SyncProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync:progress', progress)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 820,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f6f5',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('app:get-snapshot', () => snapshot())

  ipcMain.handle('settings:choose-export-root', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择小米笔记导出文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    await config.updateSettings({ exportRoot: result.filePaths[0] })
    return result.filePaths[0]
  })

  ipcMain.handle('settings:update', async (_event, patch: SettingsPatch) => {
    const previousHost = config.getSettings().host
    await config.updateSettings({
      host: patch.host,
      exportRoot: patch.exportRoot,
      syncMovesAndDeletes: patch.syncMovesAndDeletes
    })
    if (patch.host && patch.host !== previousHost) {
      await config.clearAccount()
      await session.fromPartition('persist:minote-auth').clearStorageData({
        storages: ['cookies']
      })
    }
    return snapshot()
  })

  ipcMain.handle('auth:login', async () => {
    if (!mainWindow) throw new Error('主窗口尚未准备好。')
    await openXiaomiLogin(mainWindow, config)
    return snapshot()
  })

  ipcMain.handle('auth:logout', async () => {
    await config.clearAccount()
    await session.fromPartition('persist:minote-auth').clearStorageData({
      storages: ['cookies']
    })
    return snapshot()
  })

  ipcMain.handle('sync:start', async (_event, force = false) => {
    if (syncing) throw new Error('同步正在进行，请稍候。')
    syncing = true
    try {
      const engine = new SyncEngine(sendProgress)
      lastResult = await engine.run(config.getSettings(), config.getCookie(), Boolean(force))
      return lastResult
    } finally {
      syncing = false
    }
  })

  ipcMain.handle('export:open', async () => {
    const root = config.getSettings().exportRoot
    if (!root) throw new Error('尚未选择导出文件夹。')
    const error = await shell.openPath(root)
    if (error) throw new Error(error)
  })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.something.minote-exporter')
  await config.load()
  registerIpc()

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
