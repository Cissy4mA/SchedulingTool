import { Category, CalendarEvent } from './types'

// 初始状态：完全空白（无预置日程、无预置分组）
// 新访客打开即为干净状态；数据完全由用户自己创建 + 云同步
export const INITIAL_CATEGORIES: Category[] = []

export const INITIAL_EVENTS: CalendarEvent[] = []
