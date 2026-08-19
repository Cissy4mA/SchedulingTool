export interface Category {
  id: string
  name: string
  color: string // 用户自定义，色盘自由调节
}

export interface CalendarEvent {
  id: string
  title: string
  date: string // YYYY-MM-DD
  startTime: string // HH:mm
  endTime: string // HH:mm
  note?: string
  categoryId: string // 关联自定义分组；空字符串表示「未分类」
  updatedAt?: number // 最后修改时间戳（毫秒），用于云同步冲突解决
}
