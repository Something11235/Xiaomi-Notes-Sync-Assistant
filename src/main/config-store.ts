import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings } from '../shared/types'

interface StoredConfig {
  host: string
  exportRoot: string
  syncMovesAndDeletes: boolean
  user: string
  encryptedCookie: string
}

const DEFAULT_HOST = 'i.mi.com'
const ALLOWED_HOSTS = new Set(['i.mi.com', 'us.i.mi.com'])

export class ConfigStore {
  private data: StoredConfig = {
    host: DEFAULT_HOST,
    exportRoot: '',
    syncMovesAndDeletes: true,
    user: '',
    encryptedCookie: ''
  }

  private get filePath(): string {
    return path.join(app.getPath('userData'), 'settings.json')
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<StoredConfig>
      this.data = {
        ...this.data,
        ...parsed,
        host: ALLOWED_HOSTS.has(String(parsed.host)) ? String(parsed.host) : DEFAULT_HOST
      }
    } catch {
      // First run has no settings file.
    }
  }

  getSettings(): AppSettings {
    return {
      host: this.data.host,
      exportRoot: this.data.exportRoot,
      syncMovesAndDeletes: this.data.syncMovesAndDeletes
    }
  }

  getUser(): string {
    return this.data.user
  }

  getCookie(): string {
    if (!this.data.encryptedCookie) return ''
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows 安全存储当前不可用，无法读取登录信息。')
    }
    return safeStorage.decryptString(Buffer.from(this.data.encryptedCookie, 'base64'))
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    if (typeof patch.host === 'string') {
      const host = patch.host.trim()
      if (!ALLOWED_HOSTS.has(host)) throw new Error('不支持的小米云服务区域。')
      this.data.host = host
    }
    if (typeof patch.exportRoot === 'string') this.data.exportRoot = patch.exportRoot
    if (typeof patch.syncMovesAndDeletes === 'boolean') {
      this.data.syncMovesAndDeletes = patch.syncMovesAndDeletes
    }
    await this.save()
  }

  async setAccount(cookie: string, user: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows 安全存储当前不可用，不能安全保存小米登录信息。')
    }
    this.data.encryptedCookie = safeStorage.encryptString(cookie).toString('base64')
    this.data.user = user
    await this.save()
  }

  async clearAccount(): Promise<void> {
    this.data.encryptedCookie = ''
    this.data.user = ''
    await this.save()
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8')
  }
}
