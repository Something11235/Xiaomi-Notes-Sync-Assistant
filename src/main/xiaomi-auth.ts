import { BrowserWindow, session } from 'electron'
import type { ConfigStore } from './config-store'
import { XiaomiApi, XiaomiHttpError } from './xiaomi-api'

const XIAOMI_DOMAINS = ['mi.com', 'xiaomi.com']

function isXiaomiUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') return false
    const hostname = url.hostname.toLowerCase()
    return XIAOMI_DOMAINS.some((domain) => hostname === domain || hostname.endsWith('.' + domain))
  } catch {
    return false
  }
}

function serviceLoginUrl(error: unknown): string | null {
  if (!(error instanceof XiaomiHttpError)) return null
  const payload = error.response as { D?: unknown; data?: { D?: unknown } } | null
  const candidate = payload?.D || payload?.data?.D
  return typeof candidate === 'string' && isXiaomiUrl(candidate) ? candidate : null
}

async function cookieHeader(host: string): Promise<string> {
  const cookies = await session.fromPartition('persist:minote-auth').cookies.get({
    url: 'https://' + host + '/'
  })
  return cookies.map((cookie) => cookie.name + '=' + cookie.value).join('; ')
}

export async function openXiaomiLogin(parent: BrowserWindow, store: ConfigStore): Promise<void> {
  const host = store.getSettings().host
  const authSession = session.fromPartition('persist:minote-auth')

  await new Promise<void>((resolve, reject) => {
    let finished = false
    let checking = false
    let todoRetries = 0

    const loginWindow = new BrowserWindow({
      parent,
      modal: true,
      width: 980,
      height: 680,
      minWidth: 760,
      minHeight: 520,
      show: false,
      autoHideMenuBar: true,
      title: '登录小米云服务',
      webPreferences: {
        partition: 'persist:minote-auth',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })

    const finish = async (): Promise<void> => {
      if (finished || checking) return
      checking = true
      try {
        const cookie = await cookieHeader(host)
        if (!cookie) throw new Error('没有读取到小米云登录凭据。')

        const api = new XiaomiApi(host, cookie)
        const profile = await api.fetchProfile()
        try {
          await api.fetchTodoRecords()
        } catch (error) {
          const authUrl = serviceLoginUrl(error)
          if (
            error instanceof XiaomiHttpError &&
            error.status === 401 &&
            authUrl &&
            todoRetries < 2
          ) {
            todoRetries += 1
            loginWindow.setTitle('正在完成小米待办授权')
            await loginWindow.loadURL(authUrl)
            return
          }
          if (!(error instanceof XiaomiHttpError) || ![401, 403, 404].includes(error.status)) {
            throw error
          }
        }

        const nickname =
          typeof profile?.data?.nickname === 'string' && profile.data.nickname
            ? profile.data.nickname
            : '小米用户'
        await store.setAccount(cookie, nickname)
        finished = true
        loginWindow.close()
        resolve()
      } catch (error) {
        loginWindow.setTitle('登录尚未完成，请继续在窗口中登录')
        console.error('[MiNote Exporter] Xiaomi login check failed', {
          status: error instanceof XiaomiHttpError ? error.status : undefined,
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      } finally {
        checking = false
      }
    }

    loginWindow.once('ready-to-show', () => loginWindow.show())

    loginWindow.webContents.on('will-navigate', (event, url) => {
      if (!isXiaomiUrl(url)) event.preventDefault()
    })
    loginWindow.webContents.setWindowOpenHandler((details) => {
      if (isXiaomiUrl(details.url)) {
        void loginWindow.loadURL(details.url)
      }
      return { action: 'deny' }
    })

    const filter = {
      urls: [
        'https://account.xiaomi.com/fe/service/account?cUserId=*',
        'https://' + host + '/status/lite/profile?ts=*'
      ]
    }
    authSession.webRequest.onCompleted(filter, (details) => {
      if (details.url.startsWith('https://account.xiaomi.com/fe/service/account')) {
        if (details.statusCode === 200) void loginWindow.loadURL('https://' + host + '/note/h5')
        return
      }
      if (details.statusCode === 200) void finish()
    })

    loginWindow.on('closed', () => {
      authSession.webRequest.onCompleted(filter, null)
      if (!finished) reject(new Error('登录窗口已关闭。'))
    })

    void loginWindow.loadURL('https://account.xiaomi.com/fe/service/login/qrcode')
  })
}
