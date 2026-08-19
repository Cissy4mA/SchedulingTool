import { CalendarEvent, Category } from './types'

// 持久化：将日程与分组写入 localStorage，刷新/关闭后重新打开保持不变
const STORAGE_KEY = 'calendar.v2'
// 缓存版本：版本不符（含首次）即清空旧数据，保证任何人打开都是空白初始状态
const CACHE_VERSION = '2-reset'

export interface PersistedState {
  events: CalendarEvent[]
  categories: Category[]
  view: 'month' | 'week' | 'agenda' | 'reminder' | 'assistant'
  viewDate: string // YYYY-MM-DD（始终为某月 1 日）
  selectedDate: string // YYYY-MM-DD
  accent: string // 全局按键主题色
}

export function loadState(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // 旧缓存（无版本标记或版本不符）一律作废 → 返回空白初始状态
    const ver = localStorage.getItem(STORAGE_KEY + '.ver')
    if (!raw || ver !== CACHE_VERSION) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.setItem(STORAGE_KEY + '.ver', CACHE_VERSION)
      return {}
    }
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 隐私模式或超出配额时静默失败，不影响正常使用
  }
}

// 合并种子数据：保留用户已有的日程/分组，只追加本地没有的种子（避免再次刷新时清空用户编辑）
export function mergeCategories(current: Category[], seeds: Category[]): Category[] {
  const map = new Map(current.map((c) => [c.id, c]))
  for (const c of seeds) {
    if (!map.has(c.id)) map.set(c.id, c)
  }
  return Array.from(map.values())
}

export function mergeEvents(current: CalendarEvent[], seeds: CalendarEvent[]): CalendarEvent[] {
  const map = new Map(current.map((e) => [e.id, e]))
  for (const e of seeds) {
    if (!map.has(e.id)) map.set(e.id, e)
  }
  return Array.from(map.values())
}

// 生成以周日为首列的 6 周（42 格）月历矩阵
export function getMonthMatrix(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay()) // 回退到所在周周日
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push(d)
  }
  return cells
}

// Date -> YYYY-MM-DD
export function toKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatMonthTitle(year: number, month: number): string {
  return `${year}年${month + 1}月`
}

// YYYY-MM-DD -> "8月18日 周二"
export function formatDateTitle(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const wd = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
  return `${m}月${d}日 周${wd}`
}

// 根据背景色亮度返回可读的前景色（用于用户在色盘自由选色后的文字对比）
export function readableText(hex: string): string {
  const c = hex.replace('#', '')
  const full =
    c.length === 3
      ? c
          .split('')
          .map((x) => x + x)
          .join('')
      : c
  const r = parseInt(full.substring(0, 2), 16) || 0
  const g = parseInt(full.substring(2, 4), 16) || 0
  const b = parseInt(full.substring(4, 6), 16) || 0
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1a1a1a' : '#ffffff'
}

// 根据用户选定的主题色派生一个柔和背景色（与白色混合约 82%，用于今日底色/激活态底）
export function softColor(hex: string): string {
  const c = hex.replace('#', '')
  const full =
    c.length === 3
      ? c
          .split('')
          .map((x) => x + x)
          .join('')
      : c
  const r = parseInt(full.substring(0, 2), 16) || 0
  const g = parseInt(full.substring(2, 4), 16) || 0
  const b = parseInt(full.substring(4, 6), 16) || 0
  const mix = (ch: number) => Math.round(ch + (255 - ch) * 0.82)
  const to2 = (n: number) => String(n).padStart(2, '0')
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`
}
