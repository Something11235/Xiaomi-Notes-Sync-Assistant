import type { DesktopApi } from '../shared/types'

declare global {
  interface Window {
    api: DesktopApi
  }
}

export {}
