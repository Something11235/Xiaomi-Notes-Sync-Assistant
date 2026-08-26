import { describe, expect, it } from 'vitest'
import {
  cleanupLimit,
  deletionIsSafe,
  extractManagedIdentity,
  sanitizePathSegment,
  toNativePath
} from './path-utils'

describe('path safety', () => {
  it('removes characters invalid on Windows', () => {
    expect(sanitizePathSegment('计划: 2026/08?*', '无标题')).toBe('计划： 2026／08？＊')
  })

  it('protects Windows reserved names', () => {
    expect(sanitizePathSegment('CON', '无标题')).toBe('CON_')
  })

  it('prevents paths from escaping the export root', () => {
    expect(() => toNativePath('C:\\Export', '../secret.txt')).toThrow()
  })
})

describe('cleanup safety', () => {
  it('blocks an empty cloud inventory when local state exists', () => {
    expect(deletionIsSafe(0, 12, 12)).toBe(false)
  })

  it('blocks deletion batches above the threshold', () => {
    expect(cleanupLimit(100)).toBe(20)
    expect(deletionIsSafe(80, 100, 21)).toBe(false)
  })

  it('allows a small deletion batch', () => {
    expect(deletionIsSafe(98, 100, 2)).toBe(true)
  })
})
describe('managed identity', () => {
  it('requires both Xiaomi id and entry type', () => {
    expect(extractManagedIdentity('---\nid: "note-1"\nminote_type: note\n---\n正文')).toEqual({
      id: 'note-1',
      type: 'note'
    })
    expect(extractManagedIdentity('普通本地笔记')).toBeNull()
    expect(extractManagedIdentity('---\nid: "note-1"\n---\n正文')).toBeNull()
  })
})
