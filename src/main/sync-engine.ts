/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  unlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings, EntryType, SyncProgress, SyncResult } from '../shared/types'
import { buildNoteMarkdown, buildTodoMarkdown } from './markdown'
import {
  assetExtension,
  deletionIsSafe,
  extractManagedIdentity,
  normalizeRelativePath,
  sanitizePathSegment,
  syncKey,
  toNativePath
} from './path-utils'
import { XiaomiApi, XiaomiHttpError } from './xiaomi-api'

interface CloudEntry {
  id: string
  type: EntryType
  title: string
  category: string
  modified: number
  raw: any
}

interface StateEntry {
  id: string
  type: EntryType
  title: string
  category: string
  modified: number
  path: string
  assetDir?: string
  stalePaths: string[]
  staleAssetDirs: string[]
}

interface SyncState {
  version: 1
  lastSyncAt: string
  lastCloudCount: number
  entries: Record<string, StateEntry>
}

interface Inventory {
  entries: CloudEntry[]
  todoInventoryAvailable: boolean
  warnings: string[]
}

const EMPTY_STATE: SyncState = {
  version: 1,
  lastSyncAt: '',
  lastCloudCount: 0,
  entries: {}
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function atomicWrite(filePath: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = filePath + '.minote-tmp-' + process.pid + '-' + Date.now()
  await writeFile(temporary, content)
  try {
    await rename(temporary, filePath)
  } catch {
    await copyFile(temporary, filePath)
    await unlink(temporary)
  }
}

function cloneStateEntry(entry: StateEntry): StateEntry {
  return {
    ...entry,
    stalePaths: [...(entry.stalePaths || [])],
    staleAssetDirs: [...(entry.staleAssetDirs || [])]
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean).map(normalizeRelativePath))]
}

function titleFromEntry(entry: any): string {
  let extra: any = {}
  try {
    extra = JSON.parse(entry.extraInfo || '{}')
  } catch {
    extra = {}
  }
  const explicit = String(extra.title || '')
    .replace(/<[^>]+>/g, '')
    .trim()
  if (explicit) return explicit

  const snippet = String(
    extra.note_content_type === 'mind' ? extra.mind_content_plain_text || '' : entry.snippet || ''
  )
    .replace(/<[^>]+>/g, '')
    .split(/\r?\n/)[0]
    .trim()
  return snippet || '无标题笔记-' + String(entry.id).slice(-6)
}

function todoTitle(todo: any): string {
  return (
    String(todo.title || todo.plainText || '')
      .replace(/\r?\n/g, ' ')
      .trim()
      .slice(0, 80) || '无标题待办-' + String(todo.id).slice(-6)
  )
}

function assetDirFor(notePath: string, noteId: string): string {
  const category = path.posix.dirname(normalizeRelativePath(notePath))
  return normalizeRelativePath(category + '/.assets/' + sanitizePathSegment(noteId, 'note'))
}

export class SyncEngine {
  constructor(private readonly onProgress: (progress: SyncProgress) => void) {}

  async run(settings: AppSettings, cookie: string, force = false): Promise<SyncResult> {
    if (!settings.exportRoot) throw new Error('请先选择本地导出文件夹。')
    if (!cookie) throw new Error('请先登录小米账号。')

    await mkdir(settings.exportRoot, { recursive: true })
    const state = await this.readState(settings.exportRoot)
    this.progress('inventory', '正在读取小米云完整清单', 0, 0)

    const api = new XiaomiApi(settings.host, cookie)
    const inventory = await this.fetchInventory(api)
    const previousEntries = Object.values(state.entries)
    const previousNotes = previousEntries.filter((entry) => entry.type === 'note').length
    const cloudNotes = inventory.entries.filter((entry) => entry.type === 'note').length

    if (previousNotes > 0 && cloudNotes === 0) {
      throw new Error('安全保护：云端笔记清单为 0，本次没有写入、移动或删除任何文件。')
    }

    const desired = await this.planPaths(settings.exportRoot, inventory.entries, state)
    const nextEntries: Record<string, StateEntry> = {}
    for (const [key, value] of Object.entries(state.entries)) {
      nextEntries[key] = cloneStateEntry(value)
    }

    let written = 0
    let unchanged = 0
    let failed = 0
    let movedToTrash = 0
    const warnings = [...inventory.warnings]
    let index = 0

    for (const cloud of inventory.entries) {
      index += 1
      const key = syncKey(cloud.type, cloud.id)
      const previous = state.entries[key]
      const targetPath = desired.get(key)
      if (!targetPath) continue

      this.progress('download', '正在同步：' + cloud.title, index, inventory.entries.length)
      const targetAbsolute = toNativePath(settings.exportRoot, targetPath)
      const moved = previous && normalizeRelativePath(previous.path) !== targetPath
      const needsWrite =
        force ||
        !previous ||
        Number(cloud.modified) > Number(previous.modified) ||
        !(await exists(targetAbsolute)) ||
        moved

      if (!needsWrite) {
        unchanged += 1
        nextEntries[key] = {
          ...cloneStateEntry(previous),
          title: cloud.title,
          category: cloud.category,
          path: targetPath
        }
        continue
      }

      try {
        const assetDir = cloud.type === 'note' ? assetDirFor(targetPath, cloud.id) : undefined
        let content = ''

        if (cloud.type === 'note') {
          const details = await api.fetchNoteDetails(cloud.id)
          const note = details?.data?.entry
          if (!note) throw new Error('笔记详情不完整。')

          let extraInfo: any = {}
          try {
            extraInfo = JSON.parse(note.extraInfo || '{}')
          } catch {
            extraInfo = {}
          }

          const links = new Map<string, string>()
          const attachments = Array.isArray(note.setting?.data) ? note.setting.data : []
          for (const attachment of attachments) {
            const fileId = String(attachment.fileId || '')
            if (!fileId) continue
            const extension = assetExtension(String(attachment.mimeType || ''))
            const relativeAttachment = normalizeRelativePath(
              String(assetDir) + '/' + sanitizePathSegment(fileId, 'attachment') + '.' + extension
            )
            const absoluteAttachment = toNativePath(settings.exportRoot, relativeAttachment)
            if (force || !(await exists(absoluteAttachment))) {
              const downloaded = await api.fetchAttachment(fileId)
              await atomicWrite(absoluteAttachment, Buffer.from(downloaded.data))
            }
            links.set(
              fileId,
              normalizeRelativePath(
                '.assets/' +
                  sanitizePathSegment(cloud.id, 'note') +
                  '/' +
                  sanitizePathSegment(fileId, 'attachment') +
                  '.' +
                  extension
              )
            )
          }

          content = buildNoteMarkdown(note, extraInfo, cloud.id, cloud.category, cloud.title, links)
          await atomicWrite(targetAbsolute, content)
          const modified = Number(note.modifyDate || cloud.modified)
          const created = Number(note.createDate || modified)
          if (Number.isFinite(modified) && modified > 0) {
            await utimes(targetAbsolute, new Date(created || modified), new Date(modified))
          }
        } else {
          content = buildTodoMarkdown(cloud.raw, cloud.id, cloud.title)
          await atomicWrite(targetAbsolute, content)
          if (Number.isFinite(cloud.modified) && cloud.modified > 0) {
            await utimes(targetAbsolute, new Date(cloud.modified), new Date(cloud.modified))
          }
        }

        const previousAssetDir = previous?.assetDir
        nextEntries[key] = {
          id: cloud.id,
          type: cloud.type,
          title: cloud.title,
          category: cloud.category,
          modified: cloud.modified,
          path: targetPath,
          assetDir,
          stalePaths: unique([...(previous?.stalePaths || []), moved ? previous.path : '']),
          staleAssetDirs: unique([
            ...(previous?.staleAssetDirs || []),
            previousAssetDir && previousAssetDir !== assetDir ? previousAssetDir : ''
          ])
        }
        written += 1
      } catch (error) {
        failed += 1
        warnings.push(
          '同步失败：' +
            cloud.title +
            '（' +
            (error instanceof Error ? error.message : '未知错误') +
            '）'
        )
        if (previous) nextEntries[key] = cloneStateEntry(previous)
      }
    }

    const cloudKeys = new Set(inventory.entries.map((entry) => syncKey(entry.type, entry.id)))
    const deletionCandidates = previousEntries.filter((entry) => {
      if (entry.type === 'todo' && !inventory.todoInventoryAvailable) return false
      return !cloudKeys.has(syncKey(entry.type, entry.id))
    })
    const safeToDelete = deletionIsSafe(
      inventory.entries.length,
      previousEntries.length,
      deletionCandidates.length
    )

    if (settings.syncMovesAndDeletes && failed === 0) {
      this.progress('cleanup', '正在整理移动和删除记录', 0, deletionCandidates.length)

      for (const cloud of inventory.entries) {
        const key = syncKey(cloud.type, cloud.id)
        const current = nextEntries[key]
        if (!current) continue
        for (const stalePath of current.stalePaths) {
          if (await this.moveToTrash(settings.exportRoot, stalePath, 'moved', current))
            movedToTrash += 1
        }
        for (const staleDir of current.staleAssetDirs) {
          if (await this.moveToTrash(settings.exportRoot, staleDir, 'moved-assets')) {
            movedToTrash += 1
          }
        }
        current.stalePaths = []
        current.staleAssetDirs = []
      }

      if (safeToDelete) {
        for (const deleted of deletionCandidates) {
          const paths = unique([deleted.path, ...(deleted.stalePaths || [])])
          const assetDirs = unique([deleted.assetDir || '', ...(deleted.staleAssetDirs || [])])
          for (const relativePath of paths) {
            if (await this.moveToTrash(settings.exportRoot, relativePath, 'deleted', deleted)) {
              movedToTrash += 1
            }
          }
          for (const relativePath of assetDirs) {
            if (await this.moveToTrash(settings.exportRoot, relativePath, 'deleted-assets')) {
              movedToTrash += 1
            }
          }
          delete nextEntries[syncKey(deleted.type, deleted.id)]
        }
      } else if (deletionCandidates.length > 0) {
        warnings.push(
          '检测到 ' + deletionCandidates.length + ' 个云端删除候选，超过安全阈值，已全部保留。'
        )
      }
    } else if (failed > 0 && settings.syncMovesAndDeletes) {
      warnings.push('有笔记同步失败，本次已跳过所有移动和删除清理。')
    }

    const nextState: SyncState = {
      version: 1,
      lastSyncAt: new Date().toISOString(),
      lastCloudCount: inventory.entries.length,
      entries: nextEntries
    }
    await this.writeState(settings.exportRoot, nextState)

    const result: SyncResult = {
      written,
      unchanged,
      movedToTrash,
      failed,
      warnings,
      finishedAt: nextState.lastSyncAt
    }
    this.progress('done', failed > 0 ? '同步完成，但有部分失败' : '同步完成', 1, 1)
    return result
  }

  private async fetchInventory(api: XiaomiApi): Promise<Inventory> {
    const noteMap = new Map<string, CloudEntry>()
    const folderMap = new Map<string, string>()
    let syncTag = ''
    const seenTags = new Set<string>()

    while (true) {
      const page = await api.fetchPage(syncTag)
      if (!page?.data || !Array.isArray(page.data.entries) || !Array.isArray(page.data.folders)) {
        throw new Error('小米云返回了不完整的笔记清单。')
      }

      for (const folder of page.data.folders) {
        if (folder.type === 'folder')
          folderMap.set(String(folder.id), String(folder.subject || '未分类'))
      }
      for (const entry of page.data.entries) {
        if (entry.type !== 'note') continue
        noteMap.set(String(entry.id), {
          id: String(entry.id),
          type: 'note',
          title: titleFromEntry(entry),
          category: '',
          modified: Number(entry.modifyDate || 0),
          raw: entry
        })
      }

      if (page.data.lastPage) break
      const nextTag = String(page.data.syncTag || '')
      if (!nextTag || seenTags.has(nextTag)) {
        throw new Error('小米云笔记分页没有安全结束。')
      }
      seenTags.add(nextTag)
      syncTag = nextTag
    }

    const builtInFolders: Record<string, string> = {
      '0': '未分类',
      '4': '摘录',
      '6': '灵感速记'
    }
    for (const cloud of noteMap.values()) {
      const rawFolder = String(cloud.raw.folderId ?? '0')
      cloud.category = folderMap.get(rawFolder) || builtInFolders[rawFolder] || '未分类'
    }

    const warnings: string[] = []
    const todos: CloudEntry[] = []
    let todoInventoryAvailable = true
    let token: unknown
    try {
      while (true) {
        const page = await api.fetchTodoRecords(token)
        if (!page?.data || !Array.isArray(page.data.records)) {
          todoInventoryAvailable = false
          warnings.push('待办清单返回不完整，本次不会清理已有待办文件。')
          break
        }
        for (const record of page.data.records) {
          const entity = record.contentJson?.entity
          if (!entity) continue
          const normalized = {
            ...entity,
            id: String(record.id),
            modifyDate: Number(entity.lastModifiedTime || entity.createTime || 0)
          }
          todos.push({
            id: String(record.id),
            type: 'todo',
            title: todoTitle(normalized),
            category: '待办事项',
            modified: normalized.modifyDate,
            raw: normalized
          })
        }
        if (!page.data.hasMore) break
        token = page.data.syncToken
        if (!token) {
          todoInventoryAvailable = false
          warnings.push('待办分页缺少同步标记，本次不会清理已有待办文件。')
          break
        }
      }
    } catch (error) {
      if (error instanceof XiaomiHttpError && [401, 403, 404].includes(error.status)) {
        todoInventoryAvailable = false
        warnings.push('待办接口暂不可用，本次只同步普通笔记。')
      } else {
        throw error
      }
    }

    return {
      entries: [...noteMap.values(), ...todos],
      todoInventoryAvailable,
      warnings
    }
  }

  private async planPaths(
    root: string,
    entries: CloudEntry[],
    state: SyncState
  ): Promise<Map<string, string>> {
    const desired = new Map<string, string>()
    const used = new Set<string>()
    const managedPathOwners = new Map<string, string>()
    for (const [key, entry] of Object.entries(state.entries)) {
      managedPathOwners.set(normalizeRelativePath(entry.path).toLowerCase(), key)
    }

    for (const entry of entries) {
      const key = syncKey(entry.type, entry.id)
      const category = sanitizePathSegment(entry.category, '未分类', 80)
      const title = sanitizePathSegment(entry.title, entry.id, 120)
      let candidate = normalizeRelativePath(category + '/' + title + '.md')
      let suffix = 0

      while (true) {
        const lower = candidate.toLowerCase()
        const owner = managedPathOwners.get(lower)
        const occupiedByOtherPlan = used.has(lower)
        const occupiedOnDisk = (await exists(toNativePath(root, candidate))) && owner !== key
        if (!occupiedByOtherPlan && !occupiedOnDisk) break
        suffix += 1
        const ending = suffix === 1 ? '-' + entry.id : '-' + entry.id + '-' + suffix
        candidate = normalizeRelativePath(category + '/' + title + ending + '.md')
      }

      used.add(candidate.toLowerCase())
      desired.set(key, candidate)
    }
    return desired
  }

  private async readState(root: string): Promise<SyncState> {
    const statePath = path.join(root, '.minote-sync', 'state.json')
    if (!(await exists(statePath))) return structuredClone(EMPTY_STATE)
    try {
      const parsed = JSON.parse(await readFile(statePath, 'utf8')) as SyncState
      if (parsed.version !== 1 || typeof parsed.entries !== 'object') {
        throw new Error('版本不受支持')
      }
      for (const entry of Object.values(parsed.entries)) {
        entry.stalePaths = Array.isArray(entry.stalePaths) ? entry.stalePaths : []
        entry.staleAssetDirs = Array.isArray(entry.staleAssetDirs) ? entry.staleAssetDirs : []
      }
      return parsed
    } catch (error) {
      throw new Error(
        '同步状态文件损坏，为避免误删已停止同步：' +
          (error instanceof Error ? error.message : '未知错误')
      )
    }
  }

  private async writeState(root: string, state: SyncState): Promise<void> {
    const statePath = path.join(root, '.minote-sync', 'state.json')
    await atomicWrite(statePath, JSON.stringify(state, null, 2))
  }

  private async moveToTrash(
    root: string,
    relativePath: string,
    reason: string,
    expectedIdentity?: Pick<StateEntry, 'id' | 'type'>
  ): Promise<boolean> {
    const normalized = normalizeRelativePath(relativePath)
    if (!normalized || normalized.startsWith('.minote-sync/')) return false
    const source = toNativePath(root, normalized)
    if (!(await exists(source))) return false

    if (expectedIdentity && path.extname(source).toLowerCase() === '.md') {
      const identity = extractManagedIdentity(await readFile(source, 'utf8'))
      if (identity?.id !== expectedIdentity.id || identity.type !== expectedIdentity.type) {
        return false
      }
    }

    const runId = new Date().toISOString().replace(/[:.]/g, '-')
    let destinationRelative = normalizeRelativePath(
      '.minote-sync/trash/' + runId + '/' + reason + '/' + normalized
    )
    let destination = toNativePath(root, destinationRelative)
    let suffix = 1
    while (await exists(destination)) {
      destinationRelative = normalizeRelativePath(
        '.minote-sync/trash/' + runId + '/' + reason + '/' + normalized + '-' + suffix
      )
      destination = toNativePath(root, destinationRelative)
      suffix += 1
    }

    await mkdir(path.dirname(destination), { recursive: true })
    await rename(source, destination)
    return true
  }

  private progress(
    phase: SyncProgress['phase'],
    message: string,
    current: number,
    total: number
  ): void {
    this.onProgress({ phase, message, current, total })
  }
}
