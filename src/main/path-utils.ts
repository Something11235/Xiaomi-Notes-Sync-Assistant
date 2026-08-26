/* eslint-disable no-control-regex */
import path from 'node:path'

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const INVALID_CHARACTER_REPLACEMENTS: Record<string, string> = {
  '\\': '＼',
  '/': '／',
  ':': '：',
  '*': '＊',
  '?': '？',
  '"': '＂',
  '<': '＜',
  '>': '＞',
  '|': '｜'
}

export function sanitizePathSegment(value: unknown, fallback: string, maxLength = 100): string {
  let segment = String(value || fallback || '')
    .replace(/<[^>]+>/g, '')
    .replace(/[\\/:*?"<>|]/g, (character) => INVALID_CHARACTER_REPLACEMENTS[character])
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  segment = Array.from(segment)
    .slice(0, maxLength)
    .join('')
    .replace(/[. ]+$/g, '')
  if (!segment) segment = fallback || '无标题'
  if (WINDOWS_RESERVED_NAMES.test(segment)) segment += '_'
  return segment
}

export function normalizeRelativePath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
}

export function toNativePath(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  const target = path.resolve(root, ...normalized.split('/').filter(Boolean))
  const resolvedRoot = path.resolve(root)
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep
  if (target !== resolvedRoot && !target.startsWith(prefix)) {
    throw new Error('导出路径超出了目标文件夹。')
  }
  return target
}

export function syncKey(type: string, id: string): string {
  return (type || 'note') + ':' + String(id)
}

export function cleanupLimit(referenceCount: number): number {
  return Math.max(5, Math.ceil(Math.max(0, referenceCount) * 0.2))
}

export function deletionIsSafe(
  cloudCount: number,
  previousCount: number,
  deletionCount: number
): boolean {
  if (previousCount > 0 && cloudCount === 0) return false
  return deletionCount <= cleanupLimit(Math.max(cloudCount, previousCount))
}

export function extractManagedIdentity(
  content: string
): { id: string; type: 'note' | 'todo' } | null {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!frontmatter) return null
  const id = frontmatter[1].match(/^id:\s*["']?([^\s"']+)["']?\s*$/m)?.[1]
  const type = frontmatter[1].match(/^minote_type:\s*["']?(note|todo)["']?\s*$/m)?.[1]
  if (!id || (type !== 'note' && type !== 'todo')) return null
  return { id, type }
}
export function assetExtension(mimeType: string): string {
  const normalized = String(mimeType || '')
    .toLowerCase()
    .split(';')[0]
  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/wav': 'wav'
  }
  return known[normalized] || sanitizePathSegment(normalized.split('/')[1] || 'bin', 'bin', 12)
}
