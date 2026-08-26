import { describe, expect, it } from 'vitest'
import { buildNoteMarkdown } from './markdown'

describe('Xiaomi note Markdown conversion', () => {
  it('keeps an attachment at its original position', () => {
    const markdown = buildNoteMarkdown(
      {
        content: '<text>图片前</text><img fileid="image-1"><text>图片后</text>',
        createDate: 1000,
        modifyDate: 2000,
        setting: { data: [{ fileId: 'image-1', mimeType: 'image/png' }] }
      },
      { note_content_type: 'common', title: '示例' },
      'note-1',
      '工作',
      '示例',
      new Map([['image-1', '.assets/note-1/image-1.png']])
    )

    const before = markdown.indexOf('图片前')
    const image = markdown.indexOf('![](.assets/note-1/image-1.png)')
    const after = markdown.indexOf('图片后')
    expect(before).toBeGreaterThan(-1)
    expect(image).toBeGreaterThan(before)
    expect(after).toBeGreaterThan(image)
  })

  it('writes stable Xiaomi identity into frontmatter', () => {
    const markdown = buildNoteMarkdown(
      { content: '<text>正文</text>', createDate: 1000, modifyDate: 2000 },
      { note_content_type: 'common' },
      '10000000000000001',
      '随笔',
      '项目记录',
      new Map()
    )
    expect(markdown).toContain('id: "10000000000000001"')
    expect(markdown).toContain('category: "随笔"')
  })
})
