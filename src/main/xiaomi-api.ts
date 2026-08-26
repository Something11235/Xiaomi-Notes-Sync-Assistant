/* eslint-disable @typescript-eslint/no-explicit-any */
import { net } from 'electron'

export class XiaomiHttpError extends Error {
  readonly status: number
  readonly response: unknown

  constructor(status: number, response: unknown) {
    super('小米云接口返回 HTTP ' + status)
    this.name = 'XiaomiHttpError'
    this.status = status
    this.response = response
  }
}

export class XiaomiApi {
  constructor(
    private readonly host: string,
    private readonly cookie: string
  ) {}

  private async request(route: string, binary = false): Promise<any> {
    const response = await net.fetch('https://' + this.host + route, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: binary ? '*/*' : 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Cookie: this.cookie
      }
    })

    if (binary) {
      if (!response.ok) throw new XiaomiHttpError(response.status, null)
      return {
        data: await response.arrayBuffer(),
        contentType: response.headers.get('content-type') || 'application/octet-stream'
      }
    }

    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }
    if (!response.ok) throw new XiaomiHttpError(response.status, payload)
    return payload
  }

  fetchProfile(): Promise<any> {
    return this.request('/status/lite/profile?ts=' + Date.now())
  }

  fetchPage(syncTag = ''): Promise<any> {
    return this.request(
      '/note/full/page?ts=' + Date.now() + '&syncTag=' + encodeURIComponent(syncTag) + '&limit=200'
    )
  }

  fetchTodoRecords(syncToken?: unknown): Promise<any> {
    let route = '/todo/v1/user/records?ts=' + Date.now() + '&limit=200'
    if (syncToken) route += '&syncToken=' + encodeURIComponent(JSON.stringify(syncToken))
    return this.request(route)
  }

  fetchNoteDetails(noteId: string): Promise<any> {
    return this.request('/note/note/' + encodeURIComponent(noteId) + '/?ts=' + Date.now())
  }

  fetchAttachment(fileId: string): Promise<{ data: ArrayBuffer; contentType: string }> {
    return this.request('/file/full?type=note_img&fileid=' + encodeURIComponent(fileId), true)
  }
}
