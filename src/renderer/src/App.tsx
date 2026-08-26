import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  Image,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck
} from 'lucide-react'
import type { AppSnapshot, SyncProgress, SyncResult } from '../../shared/types'

const initialSnapshot: AppSnapshot = {
  settings: {
    host: 'i.mi.com',
    exportRoot: '',
    syncMovesAndDeletes: true
  },
  account: {
    loggedIn: false,
    user: '',
    host: 'i.mi.com'
  },
  syncing: false,
  lastResult: null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error)
    return error.message.replace(/^Error invoking remote method '[^']+': /, '')
  return '操作失败，请稍后重试。'
}

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [busy, setBusy] = useState<'login' | 'sync' | 'logout' | null>(null)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<SyncResult | null>(null)

  useEffect(() => {
    void window.api.getSnapshot().then((value) => {
      setSnapshot(value)
      setResult(value.lastResult)
    })
    return window.api.onProgress(setProgress)
  }, [])

  const canSync = snapshot.account.loggedIn && Boolean(snapshot.settings.exportRoot) && !busy
  const progressPercent =
    !progress || progress.total <= 0
      ? 0
      : Math.min(100, Math.round((progress.current / progress.total) * 100))

  async function chooseFolder(): Promise<void> {
    setMessage('')
    try {
      const exportRoot = await window.api.chooseExportRoot()
      if (exportRoot) {
        setSnapshot((current) => ({
          ...current,
          settings: { ...current.settings, exportRoot }
        }))
      }
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  async function updateHost(host: string): Promise<void> {
    setMessage('')
    try {
      const value = await window.api.updateSettings({ host })
      setSnapshot(value)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  async function updateCleanup(enabled: boolean): Promise<void> {
    try {
      const value = await window.api.updateSettings({ syncMovesAndDeletes: enabled })
      setSnapshot(value)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  async function login(): Promise<void> {
    setBusy('login')
    setMessage('')
    try {
      setSnapshot(await window.api.login())
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function logout(): Promise<void> {
    setBusy('logout')
    setMessage('')
    try {
      setSnapshot(await window.api.logout())
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function sync(force = false): Promise<void> {
    setBusy('sync')
    setMessage('')
    setProgress({ phase: 'inventory', message: '正在准备同步', current: 0, total: 0 })
    try {
      const value = await window.api.startSync(force)
      setResult(value)
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <CloudDownload size={24} strokeWidth={2.2} />
        </div>
        <div className="brand-copy">
          <h1>小米笔记同步工具</h1>
          <p>本地导出</p>
        </div>
        <div className={snapshot.account.loggedIn ? 'account-state online' : 'account-state'}>
          <span className="status-dot" />
          {snapshot.account.loggedIn ? snapshot.account.user || '已登录' : '未登录'}
        </div>
      </header>

      <section className="workspace">
        <div className="section-heading">
          <div>
            <span className="eyebrow">账号</span>
            <h2>小米云连接</h2>
          </div>
          {snapshot.account.loggedIn ? (
            <button className="button secondary" onClick={logout} disabled={Boolean(busy)}>
              <LogOut size={17} />
              退出登录
            </button>
          ) : (
            <button className="button primary" onClick={login} disabled={Boolean(busy)}>
              <LogIn size={17} />
              {busy === 'login' ? '登录中' : '登录小米账号'}
            </button>
          )}
        </div>

        <div className="settings-grid">
          <label className="field">
            <span>服务区域</span>
            <select
              value={snapshot.settings.host}
              onChange={(event) => void updateHost(event.target.value)}
              disabled={Boolean(busy)}
            >
              <option value="i.mi.com">中国大陆（i.mi.com）</option>
              <option value="us.i.mi.com">海外（us.i.mi.com）</option>
            </select>
          </label>

          <div className="field export-field">
            <span>导出文件夹</span>
            <div className="path-control">
              <input
                value={snapshot.settings.exportRoot}
                readOnly
                placeholder="尚未选择"
                title={snapshot.settings.exportRoot}
              />
              <button
                className="icon-button"
                onClick={chooseFolder}
                title="选择导出文件夹"
                aria-label="选择导出文件夹"
                disabled={Boolean(busy)}
              >
                <FolderOpen size={19} />
              </button>
              <button
                className="icon-button"
                onClick={() => void window.api.openExportRoot()}
                title="打开导出文件夹"
                aria-label="打开导出文件夹"
                disabled={!snapshot.settings.exportRoot}
              >
                <ExternalLink size={18} />
              </button>
            </div>
          </div>
        </div>

        <label className="toggle-row">
          <span className="toggle-copy">
            <ShieldCheck size={19} />
            <span>
              <strong>同步云端移动与删除</strong>
              <small>删除内容进入 .minote-sync/trash，可手动恢复</small>
            </span>
          </span>
          <input
            type="checkbox"
            checked={snapshot.settings.syncMovesAndDeletes}
            onChange={(event) => void updateCleanup(event.target.checked)}
            disabled={Boolean(busy)}
          />
          <span className="toggle" aria-hidden="true" />
        </label>
      </section>

      <section className="sync-zone">
        <div className="sync-copy">
          <span className="eyebrow">同步</span>
          <h2>{progress?.message || '准备就绪'}</h2>
          <p className="destination">{snapshot.settings.exportRoot || '请选择导出文件夹'}</p>
        </div>
        <div className="sync-actions">
          <button
            className="icon-button force-button"
            onClick={() => void sync(true)}
            disabled={!canSync}
            title="强制重新下载"
            aria-label="强制重新下载"
          >
            <RefreshCw size={19} className={busy === 'sync' ? 'spin' : ''} />
          </button>
          <button className="button sync-button" onClick={() => void sync()} disabled={!canSync}>
            <CloudDownload size={19} />
            {busy === 'sync' ? '正在同步' : '开始同步'}
          </button>
        </div>

        {busy === 'sync' && (
          <div className="progress-track" aria-label="同步进度">
            <span style={{ width: progress?.total ? progressPercent + '%' : '18%' }} />
          </div>
        )}
      </section>

      {message && (
        <div className="notice error" role="alert">
          <AlertTriangle size={19} />
          <span>{message}</span>
        </div>
      )}

      <section className="results">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">最近结果</span>
            <h2>{result ? new Date(result.finishedAt).toLocaleString('zh-CN') : '尚未同步'}</h2>
          </div>
          {result && result.failed === 0 && <CheckCircle2 className="success-icon" size={24} />}
        </div>

        <div className="metric-grid">
          <div className="metric">
            <FileText size={20} />
            <span>已写入</span>
            <strong>{result?.written ?? 0}</strong>
          </div>
          <div className="metric">
            <History size={20} />
            <span>未变化</span>
            <strong>{result?.unchanged ?? 0}</strong>
          </div>
          <div className="metric">
            <Image size={20} />
            <span>移入回收区</span>
            <strong>{result?.movedToTrash ?? 0}</strong>
          </div>
          <div className={result?.failed ? 'metric failed' : 'metric'}>
            <AlertTriangle size={20} />
            <span>失败</span>
            <strong>{result?.failed ?? 0}</strong>
          </div>
        </div>

        {result && result.warnings.length > 0 && (
          <ul className="warning-list">
            {result.warnings.map((warning, index) => (
              <li key={index}>
                <AlertTriangle size={16} />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

export default App
