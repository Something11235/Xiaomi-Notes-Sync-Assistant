/* eslint-disable @typescript-eslint/no-explicit-any */
import TurndownService from 'turndown'
import { parseHTML } from 'linkedom'

function yamlValue(value: unknown): string {
  return JSON.stringify(String(value ?? ''))
}

function isoDate(value: unknown): string {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  return new Date(timestamp).toISOString()
}

function preprocessHtml(entry: any, extraInfo: any): string {
  if (extraInfo.note_content_type === 'mind') {
    return (
      '<h1>' +
      (extraInfo.title || entry.title || '思维导图') +
      '</h1><p>' +
      String(extraInfo.mind_content_plain_text || '').replace(/\n/g, '<br>') +
      '</p>'
    )
  }

  if (extraInfo.note_content_type === 'handwrite') {
    try {
      const raw = String(extraInfo.mind_content || '')
      if (raw.startsWith('<HandWrite Prdfix>')) {
        const parsed = JSON.parse(raw.replace('<HandWrite Prdfix>', ''))
        return '<p>' + String(parsed.textContent || '').replace(/\n/g, '<br>') + '</p>'
      }
    } catch {
      return ''
    }
    return ''
  }

  let content = String(entry.content || '')
  content = content
    .replace(/<text[^>]*>\s*<\/text>/g, '<p><br></p>')
    .replace(/<text[^>]*>/g, '<p>')
    .replace(/<\/text>\n/g, '</p>')
    .replace(/<\/text>/g, '</p>')
    .replace(/<new-format\s*\/?>/gi, '')
    .replace(/<sound fileid="([^"]+)"[^>]*\/>/g, '<audio data-fileid="$1"></audio>')
    .replace(/<img fileid="([^"]+)"[^>]*>/g, '<img data-fileid="$1">')
    .replace(
      /☺\s+([^<]+)(?:<0\/><\/>)?/g,
      (_match: string, fileId: string) => '<img data-fileid="' + fileId.trim() + '">'
    )
  return content.replace(/\n/g, '<br>')
}

function createTurndown(attachmentLinks: Map<string, string>): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
  })

  service.escape = (text: string): string => text

  service.addRule('minote-highlight', {
    filter: (node) => node.nodeName === 'BACKGROUND',
    replacement: (content) => '==' + content + '=='
  })
  service.addRule('minote-underline', {
    filter: (node) => node.nodeName === 'U',
    replacement: (content) => '<u>' + content + '</u>'
  })
  service.addRule('minote-checkbox', {
    filter: (node) =>
      node.nodeName === 'INPUT' && (node as Element).getAttribute('type') === 'checkbox',
    replacement: (_content, node) =>
      (node as Element).hasAttribute('checked') ? '- [x] ' : '- [ ] '
  })
  service.addRule('minote-image', {
    filter: (node) => node.nodeName === 'IMG' && (node as Element).hasAttribute('data-fileid'),
    replacement: (_content, node) => {
      const id = (node as Element).getAttribute('data-fileid') || ''
      const link = attachmentLinks.get(id)
      return link ? '![](' + link + ')' : ''
    }
  })
  service.addRule('minote-audio', {
    filter: (node) => node.nodeName === 'AUDIO' && (node as Element).hasAttribute('data-fileid'),
    replacement: (_content, node) => {
      const id = (node as Element).getAttribute('data-fileid') || ''
      const link = attachmentLinks.get(id)
      return link ? '[音频附件](' + link + ')' : ''
    }
  })

  return service
}

export function buildNoteMarkdown(
  entry: any,
  extraInfo: any,
  noteId: string,
  category: string,
  title: string,
  attachmentLinks: Map<string, string>
): string {
  let html = preprocessHtml(entry, extraInfo)
  if (extraInfo.note_content_type === 'handwrite') {
    const attachments = Array.isArray(entry.setting?.data) ? entry.setting.data : []
    const thumbnail = attachments.find((item: any) => item.digest === extraInfo.thumbnail)
    if (thumbnail?.fileId) html += '<img data-fileid="' + thumbnail.fileId + '">'
  }

  const { document } = parseHTML('<!doctype html><html><body>' + html + '</body></html>')
  const body = createTurndown(attachmentLinks).turndown(document.body as unknown as HTMLElement)

  return [
    '---',
    'id: ' + yamlValue(noteId),
    'minote_type: note',
    'title: ' + yamlValue(title),
    'category: ' + yamlValue(category),
    'source: ' + yamlValue('Xiaomi Notes'),
    'created: ' + yamlValue(isoDate(entry.createDate)),
    'modified: ' + yamlValue(isoDate(entry.modifyDate)),
    '---',
    '',
    body.trim(),
    ''
  ].join('\n')
}

export function buildTodoMarkdown(todo: any, todoId: string, title: string): string {
  let body = ''
  if (Number(todo.listType) === 1) {
    let parsed: any = {}
    try {
      parsed = JSON.parse(String(todo.content || '{}'))
    } catch {
      parsed = {}
    }
    body +=
      '- [' + (Number(todo.isFinish) ? 'x' : ' ') + '] ' + String(parsed.title || title) + '\n'
    if (Array.isArray(parsed.subTodoEntities)) {
      for (const child of parsed.subTodoEntities) {
        body +=
          '  - [' + (Number(child.isFinish) ? 'x' : ' ') + '] ' + String(child.content || '') + '\n'
      }
    }
  } else {
    body =
      '- [' +
      (Number(todo.isFinish) ? 'x' : ' ') +
      '] ' +
      String(todo.content || todo.plainText || title) +
      '\n'
  }

  return [
    '---',
    'id: ' + yamlValue(todoId),
    'minote_type: todo',
    'title: ' + yamlValue(title),
    'category: ' + yamlValue('待办事项'),
    'source: ' + yamlValue('Xiaomi Notes'),
    'modified: ' + yamlValue(isoDate(todo.modifyDate)),
    '---',
    '',
    body.trimEnd(),
    ''
  ].join('\n')
}
