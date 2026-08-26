export type EntryType = 'note' | 'todo'

export interface AppSettings {
  host: string
  exportRoot: string
  syncMovesAndDeletes: boolean
}

export interface AccountStatus {
  loggedIn: boolean
  user: string
  host: string
}

export interface SyncProgress {
  phase: 'inventory' | 'download' | 'cleanup' | 'done'
  message: string
  current: number
  total: number
}

export interface SyncResult {
  written: number
  unchanged: number
  movedToTrash: number
  failed: number
  warnings: string[]
  finishedAt: string
}

export interface AppSnapshot {
  settings: AppSettings
  account: AccountStatus
  syncing: boolean
  lastResult: SyncResult | null
}

export interface SettingsPatch {
  host?: string
  exportRoot?: string
  syncMovesAndDeletes?: boolean
}

export interface DesktopApi {
  getSnapshot(): Promise<AppSnapshot>
  chooseExportRoot(): Promise<string | null>
  updateSettings(patch: SettingsPatch): Promise<AppSnapshot>
  login(): Promise<AppSnapshot>
  logout(): Promise<AppSnapshot>
  startSync(force?: boolean): Promise<SyncResult>
  openExportRoot(): Promise<void>
  onProgress(callback: (progress: SyncProgress) => void): () => void
}
