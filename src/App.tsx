import { useEffect, useMemo, useState, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  SearchIcon,
  CalendarIcon,
  ListIcon,
  BellIcon,
  SparkleIcon,
} from './components/icons'
import { INITIAL_CATEGORIES, INITIAL_EVENTS } from './data'
import {
  cloudReady,
  cloudCurrentUserEmail,
  cloudLoadData,
  cloudSaveData,
  cloudSignUp,
  cloudLogin,
  cloudLogout,
} from './cloud'
import {
  getMonthMatrix,
  toKey,
  formatMonthTitle,
  formatDateTitle,
  readableText,
  softColor,
  loadState,
  saveState,
  mergeCategories,
  mergeEvents,
} from './utils'
import { CalendarEvent, Category } from './types'
import { parseSchedule, ParsedSchedule, parseWithLLM, parseImageWithLLM, compressImage } from './assistant'
import EventForm from './components/EventForm'
import CategoryAdd from './components/CategoryAdd'

// 「今天」随系统时间实时计算（不再写死设计稿里的 2026-08-18）
const TODAY = new Date()
type View = 'month' | 'week' | 'agenda' | 'reminder' | 'assistant'
type RightMode = 'detail' | 'form'

export default function App() {
  // 从 localStorage 恢复上次编辑后的状态（无记录则用默认值）
  const persisted = loadState()
  const dv = persisted.viewDate?.split('-').map(Number)

  // 有初始日程时，默认打开到第一个日程所在月；否则打开到本月
  const seedMonthDate = INITIAL_EVENTS[0]
    ? new Date(INITIAL_EVENTS[0].date + 'T00:00:00')
    : null
  const defaultViewDate = seedMonthDate
    ? new Date(seedMonthDate.getFullYear(), seedMonthDate.getMonth(), 1)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const defaultSelectedDate = INITIAL_EVENTS[0]?.date ?? toKey(TODAY)

  const initialViewDate = dv
    ? new Date(dv[0], dv[1] - 1, dv[2])
    : defaultViewDate

  const [viewDate, setViewDate] = useState<Date>(initialViewDate)
  // 用 merge 合并种子数据：已有记录保留，缺失的种子才追加，避免覆盖用户编辑
  const [events, setEvents] = useState<CalendarEvent[]>(
    mergeEvents(persisted.events ?? INITIAL_EVENTS, INITIAL_EVENTS),
  )
  const [categories, setCategories] = useState<Category[]>(
    mergeCategories(persisted.categories ?? INITIAL_CATEGORIES, INITIAL_CATEGORIES),
  )
  const [view, setView] = useState<View>(persisted.view ?? 'month')
  const [query, setQuery] = useState('')

  // 全局按键主题色（用户可在左下角色盘自由调节，默认荧光绿 #39FF14）
  const [accent, setAccent] = useState<string>(persisted.accent ?? '#39FF14')
  const accentSoft = softColor(accent)
  const accentText = readableText(accent)

  // 分组编辑（重命名 / 改色）
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [editCatName, setEditCatName] = useState('')
  const [editCatColor, setEditCatColor] = useState('#39FF14')

  // AI 助手的对话记录提升到 App 层：切换视图（月/周/...）后返回仍保留
  const [assistantMsgs, setAssistantMsgs] = useState<ChatMsg[]>([])

  // ── 云同步（LeanCloud 邮箱+密码账号）──
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<'off' | 'idle' | 'syncing' | 'done' | 'error'>('off')
  const [syncError, setSyncError] = useState<string>('')
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPass, setAuthPass] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  // 首次拉取云端并合并完成前，禁止推送——否则 userEmail 一设置就推送本地旧数据覆盖云端
  const initialMergeDone = useRef(false)
  // 拉取诊断（排障用）：显示云端拉取结果
  const [syncDebug, setSyncDebug] = useState('')

  // 右侧面板：选中日期 + 模式（当日详情 / 新建表单）
  const [selectedDate, setSelectedDate] = useState(persisted.selectedDate ?? defaultSelectedDate)
  const [rightMode, setRightMode] = useState<RightMode>('detail')
  const [editingId, setEditingId] = useState<string | null>(null)

  // 新建日程表单状态（受控）
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [formDate, setFormDate] = useState(toKey(TODAY))
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [note, setNote] = useState('')
  const [focusToken, setFocusToken] = useState(0)

  // 等比缩放：宽屏（≥768px）将 1440×900 画布整体缩放居中；窄屏（手机）走响应式布局，不缩放
  useEffect(() => {
    const app = document.getElementById('app')
    const fit = () => {
      if (!app) return
      if (window.innerWidth < 768) {
        app.style.transform = ''
        return
      }
      const s = Math.min(window.innerWidth / 1440, window.innerHeight / 900)
      app.style.transform = `scale(${s})`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // 主题色变化时，实时改写全局 CSS 变量，所有按键/高亮随之变色
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-soft', accentSoft)
    root.style.setProperty('--accent-text', accentText)
  }, [accent, accentSoft, accentText])

  // 任意编辑（日程 / 分组 / 视图位置 / 主题色）后自动落盘，刷新或关闭重开保持不变
  // 本地落盘：任意编辑后自动保存，刷新或关闭重开保持不变
  useEffect(() => {
    saveState({
      events,
      categories,
      view,
      viewDate: toKey(viewDate),
      selectedDate,
      accent,
    })
  }, [events, categories, view, viewDate, selectedDate, accent])

  // 云推送：events/categories 变化后【立即】推送云端（不防抖——防抖会让
  // 「删除→马上刷新」丢失推送，导致云端残留旧数据、刷新后删除被回滚）
  // 关键：首次与云端对齐完成前不推送，避免 userEmail 设置时用本地旧数据覆盖云端
  useEffect(() => {
    if (!userEmail || !cloudReady()) return
    if (!initialMergeDone.current) return
    // 记录本地最后编辑时间（用于 last-write-wins 判断）
    localStorage.setItem('calendar.last-edit', String(Date.now()))
    setSyncState('syncing')
    cloudSaveData({ events, categories, updatedAt: Date.now() })
      .then((ok) => {
        if (ok) {
          setSyncState('done')
          setSyncError('')
        } else {
          setSyncState('error')
          setSyncError('推送云端失败')
        }
      })
      .catch((e) => {
        setSyncState('error')
        setSyncError(e instanceof Error ? e.message : String(e))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, categories, userEmail])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const cells = useMemo(() => getMonthMatrix(year, month), [year, month])

  // 周视图：以 selectedDate 为锚定位该周日~周六（用户最近操作的日期所在周）
  const weekDays = useMemo(() => {
    const anchor = selectedDate
      ? new Date(selectedDate + 'T00:00:00')
      : viewDate
    const start = new Date(anchor)
    start.setDate(anchor.getDate() - anchor.getDay())
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [selectedDate, viewDate])

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const e of events) {
      ;(map[e.date] ||= []).push(e)
    }
    for (const k in map) map[k].sort((a, b) => a.startTime.localeCompare(b.startTime))
    return map
  }, [events])

  const catOf = (id: string) => categories.find((c) => c.id === id)

  // 月切换：月/日程/提醒 视图切月；周视图切周（通过 setSelectedDate 让 weekDays 重新计算）
  const prevMonth = () => {
    if (view === 'week') {
      const start = weekDays[0]
      const prev = new Date(start)
      prev.setDate(start.getDate() - 7)
      setSelectedDate(toKey(prev))
    } else {
      setViewDate(new Date(year, month - 1, 1))
    }
  }
  const nextMonth = () => {
    if (view === 'week') {
      const start = weekDays[0]
      const next = new Date(start)
      next.setDate(start.getDate() + 7)
      setSelectedDate(toKey(next))
    } else {
      setViewDate(new Date(year, month + 1, 1))
    }
  }

  // 点击日期：右侧切到「当日详情」
  const selectDay = (key: string) => {
    setSelectedDate(key)
    setRightMode('detail')
  }

  // 打开新建表单（预填某天）
  const openForm = (dateKey?: string) => {
    setEditingId(null)
    clearForm()
    setFormDate(dateKey || selectedDate)
    setFocusToken((t) => t + 1)
    setRightMode('form')
  }

  // 打开编辑表单（预填某条已存在日程）
  const editEvent = (ev: CalendarEvent) => {
    setTitle(ev.title)
    setCategoryId(ev.categoryId)
    setFormDate(ev.date)
    setStart(ev.startTime)
    setEnd(ev.endTime)
    setNote(ev.note || '')
    setEditingId(ev.id)
    const d = new Date(ev.date + 'T00:00:00')
    setViewDate(new Date(d.getFullYear(), d.getMonth(), 1))
    setFocusToken((t) => t + 1)
    setRightMode('form')
  }

  const backToDetail = () => {
    setEditingId(null)
    setRightMode('detail')
  }

  const clearForm = () => {
    setTitle('')
    setCategoryId('')
    setFormDate(selectedDate)
    setStart('09:00')
    setEnd('10:00')
    setNote('')
  }

  const addCategory = (name: string, color: string): string => {
    const id = 'c' + Date.now()
    setCategories((prev) => [...prev, { id, name, color }])
    return id
  }

  const removeCategory = (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id))
    if (categoryId === id) setCategoryId('')
  }

  // 开始编辑某分组：把当前名称/颜色载入编辑态
  const startEditCat = (c: Category) => {
    setEditCatName(c.name)
    setEditCatColor(c.color)
    setEditingCatId(c.id)
  }

  // 全局更新某个分组（名称 / 颜色）——表单与侧边栏共用
  const updateCategory = (id: string, name: string, color: string) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name: name.trim(), color } : c)),
    )
  }

  // 保存分组改名/改色
  const saveEditCat = () => {
    if (!editCatName.trim()) {
      window.alert('请填写分组名称')
      return
    }
    if (editingCatId) {
      updateCategory(editingCatId, editCatName, editCatColor)
    }
    setEditingCatId(null)
  }

  // AI 助手用的已有日程列表（近 60 天，最多 50 条），传给 LLM 帮它区分"新建" vs "给已有加备注"
  const recentEventsForAI = useMemo(() => {
    const now = new Date()
    const horizon = 60 * 86400000
    return events
      .filter((e) => Math.abs(new Date(e.date + 'T00:00:00').getTime() - now.getTime()) <= horizon)
      .slice(0, 50)
      .map((e) => ({ title: e.title, date: e.date }))
  }, [events])

  // 保存：编辑模式替换原事件，新建模式追加
  const saveEvent = (e: CalendarEvent) => {
    const stamped = { ...e, updatedAt: Date.now() }
    setEvents((prev) => {
      if (editingId) return prev.map((x) => (x.id === editingId ? stamped : x))
      return [...prev, stamped]
    })
    const d = new Date(e.date + 'T00:00:00')
    setViewDate(new Date(d.getFullYear(), d.getMonth(), 1))
    setView('month')
    setSelectedDate(e.date)
    setEditingId(null)
    setRightMode('detail')
    clearForm()
  }

  const deleteEvent = (id: string) => {
    setEvents((prev) => prev.filter((x) => x.id !== id))
    setEditingId(null)
    setRightMode('detail')
    clearForm()
  }

  // AI 助手静默添加：写入日程但不切换视图、不打断对话
  const addEventQuiet = (e: CalendarEvent) => {
    setEvents((prev) => [...prev, { ...e, updatedAt: Date.now() }])
    // 顺便把日历翻到日程所在月，方便用户稍后查看
    const d = new Date(e.date + 'T00:00:00')
    setViewDate(new Date(d.getFullYear(), d.getMonth(), 1))
  }

  // AI 助手给已有日程追加备注（按标题匹配第一条；返回是否找到）
  const applyNoteToEvent = (title: string, noteText: string): boolean => {
    const ev = events.find((e) => e.title === title)
    if (!ev) return false
    setEvents((prev) =>
      prev.map((e) =>
        e.id === ev.id
          ? { ...e, note: e.note ? `${e.note}；${noteText}` : noteText, updatedAt: Date.now() }
          : e,
      ),
    )
    return true
  }

  // 挂载时恢复登录状态，并与云端对齐（last-write-wins：哪边最后修改以哪边为准）
  useEffect(() => {
    if (!cloudReady()) {
      setSyncState('off')
      return
    }
    cloudCurrentUserEmail().then((email) => {
      if (!email) {
        setSyncState('idle')
        return
      }
      setUserEmail(email)
      setSyncState('syncing')
      setSyncError('')
      alignWithCloud()
        .then(() => {
          initialMergeDone.current = true
          setSyncState('done')
        })
        .catch((e) => {
          // 拉取/推送失败：不推送本地覆盖云端（避免"拉取失败 → 本地数据覆盖云端"）
          initialMergeDone.current = true
          setSyncDebug('拉取云端失败')
          setSyncState('error')
          setSyncError(
            e instanceof Error && /fetch|network|Failed to fetch/i.test(e.message)
              ? '无法连接云服务（网络问题），未同步'
              : e instanceof Error
                ? e.message
                : String(e),
          )
        })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 与云端对齐：云端 updated_at 比本地最后编辑晚 → 采用云端（包含对方的删除/修改）；
  // 否则 → 本地较新（或云端无数据）→ 上传本地覆盖云端。
  // 这是 last-write-wins，能正确处理删除（不会把已删的事件又加回来）。
  const alignWithCloud = async (): Promise<void> => {
    const cloud = await cloudLoadData()
    const localLastEdit = Number(localStorage.getItem('calendar.last-edit') || 0)
    if (cloud && cloud.updatedAt > localLastEdit) {
      // 云端较新 → 完全采用云端
      setEvents(cloud.events)
      setCategories(cloud.categories)
      setSyncDebug(`云端 ${cloud.events.length} 条（云端较新，已采用）`)
      return
    }
    // 本地较新 或 云端无数据 → 上传本地
    setSyncDebug(cloud ? `云端 ${cloud.events.length} 条（本地较新，将上传）` : '云端无数据，将上传本地')
    const ok = await cloudSaveData({ events, categories, updatedAt: Date.now() })
    if (!ok) throw new Error('上传失败')
  }

  // 登录 / 注册：成功后拉云端并合并（把本地已有数据也带上去，实现两端融合）
  const submitAuth = async () => {
    const email = authEmail.trim()
    const pass = authPass
    if (!email || !pass) {
      setAuthError('请填写邮箱和密码')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError('邮箱格式不正确，例如 name@example.com')
      return
    }
    if (authMode === 'signup' && pass.length < 6) {
      setAuthError('密码至少 6 位')
      return
    }
    setAuthBusy(true)
    setAuthError('')
    try {
      if (authMode === 'signup') await cloudSignUp(email, pass)
      else await cloudLogin(email, pass)
      setUserEmail(email)
      setAuthOpen(false)
      setSyncState('syncing')
      // 登录后与云端对齐（last-write-wins）
      const localLastEdit = Number(localStorage.getItem('calendar.last-edit') || 0)
      const cloud = await cloudLoadData()
      if (cloud && cloud.updatedAt > localLastEdit) {
        setEvents(cloud.events)
        setCategories(cloud.categories)
        setSyncDebug(`云端 ${cloud.events.length} 条（云端较新，已采用）`)
      } else {
        setSyncDebug(cloud ? `云端 ${cloud.events.length} 条（本地较新，将上传）` : '云端无数据，将上传本地')
        const ok = await cloudSaveData({ events, categories, updatedAt: Date.now() })
        if (!ok) throw new Error('上传失败')
      }
      initialMergeDone.current = true
      setSyncState('done')
    } catch (err) {
      setAuthError((err as { message?: string })?.message || '操作失败，请重试')
      setSyncState('error')
    } finally {
      setAuthBusy(false)
    }
  }

  const logout = () => {
    cloudLogout()
    setUserEmail(null)
    setSyncState('idle')
  }

  // 列表视图（仅「日程」）：仅显示当前翻到的月份的日程，并叠加搜索过滤
  const listEvents = useMemo(() => {
    if (view !== 'agenda') return []
    const ym = `${year}-${String(month + 1).padStart(2, '0')}`
    let list: CalendarEvent[] = events.filter((e) => e.date.startsWith(ym))
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((e) => e.title.toLowerCase().includes(q))
    list.sort((a, b) =>
      a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date),
    )
    return list
  }, [view, events, query, year, month])

  const matchQuery = (e: CalendarEvent) =>
    !query.trim() || e.title.toLowerCase().includes(query.trim().toLowerCase())

  const chipStyle = (cat?: Category) =>
    cat
      ? { background: cat.color, color: readableText(cat.color) }
      : { background: '#eef0f3', color: '#6b7280' }

  return (
    <div className="stage">
      <div className="app" id="app">
        {/* 左侧栏 */}
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">
              <CalendarIcon size={16} color="#0a1f0a" />
            </span>
            <span className="brand-name">日程助手</span>
          </div>

          <button className="new-btn" onClick={() => openForm(selectedDate)}>
            <Plus size={18} color="#0a1f0a" />
            <span>新建日程</span>
          </button>

          <div className="nav-label">视图</div>
          <nav className="nav-group">
            <div
              className={`nav-item${view === 'assistant' ? ' active' : ''}`}
              onClick={() => setView('assistant')}
            >
              <SparkleIcon size={18} color={view === 'assistant' ? 'var(--accent)' : '#6B7280'} />
              <span>AI 助手</span>
            </div>
            <div
              className={`nav-item${view === 'month' ? ' active' : ''}`}
              onClick={() => setView('month')}
            >
              <CalendarIcon size={18} color={view === 'month' ? 'var(--accent)' : '#6B7280'} />
              <span>月</span>
            </div>
            <div
              className={`nav-item${view === 'week' ? ' active' : ''}`}
              onClick={() => setView('week')}
            >
              <CalendarIcon size={18} color={view === 'week' ? 'var(--accent)' : '#6B7280'} />
              <span>周</span>
            </div>
            <div
              className={`nav-item${view === 'agenda' ? ' active' : ''}`}
              onClick={() => setView('agenda')}
            >
              <ListIcon size={18} color={view === 'agenda' ? 'var(--accent)' : '#6B7280'} />
              <span>日程</span>
            </div>
            <div
              className={`nav-item${view === 'reminder' ? ' active' : ''}`}
              onClick={() => setView('reminder')}
            >
              <BellIcon size={18} color={view === 'reminder' ? 'var(--accent)' : '#6B7280'} />
              <span>提醒</span>
            </div>
          </nav>

          <div className="nav-label">日程分类</div>
          <div className="legend">
            {categories.length === 0 && (
              <div className="legend-empty">暂无分组，点击下方新建</div>
            )}
            {categories.map((c) =>
              editingCatId === c.id ? (
                <div key={c.id} className="legend-edit">
                  <input
                    className="input legend-edit-input"
                    value={editCatName}
                    onChange={(e) => setEditCatName(e.target.value)}
                    placeholder="分组名称"
                  />
                  <div className="legend-edit-row">
                    <input
                      type="color"
                      className="color-input"
                      value={editCatColor}
                      onChange={(e) => setEditCatColor(e.target.value)}
                      aria-label="选择分组颜色"
                    />
                    <button className="btn-mini" type="button" onClick={saveEditCat}>
                      保存
                    </button>
                    <button
                      className="btn-mini ghost"
                      type="button"
                      onClick={() => setEditingCatId(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div key={c.id} className="legend-item">
                  <span className="legend-dot" style={{ background: c.color }} />
                  <button
                    type="button"
                    className="legend-name-btn"
                    onClick={() => startEditCat(c)}
                    title="点击重命名或改色"
                  >
                    {c.name}
                  </button>
                  <button
                    className="legend-del"
                    type="button"
                    onClick={() => removeCategory(c.id)}
                    aria-label={`删除分组 ${c.name}`}
                  >
                    ×
                  </button>
                </div>
              ),
            )}
            <CategoryAdd onAdd={addCategory} label="+ 添加分组" />
          </div>

          {/* 云同步：账号登录（手机 / 电脑数据互通） */}
          <div className="sync-card">
            <div className="sync-ver" title="两端版本号必须一致">同步版 v1.4.2</div>
            {!cloudReady() ? (
              <div className="sync-off" title="在 src/cloud-config.ts 填入 LeanCloud 应用凭证后启用">
                <span>☁️ 云同步未配置</span>
                <span className="sync-hint">见 src/cloud-config.ts</span>
              </div>
            ) : userEmail ? (
              <>
                <div className="sync-user">
                  <span className="sync-email">{userEmail}</span>
                  <span className={`sync-badge ${syncState}`}>
                    {syncState === 'syncing'
                      ? '同步中…'
                      : syncState === 'done'
                        ? '已同步 ✓'
                        : syncState === 'error'
                          ? '同步失败'
                          : '未同步'}
                  </span>
                </div>
                {syncError && syncState === 'error' && (
                  <div className="sync-error" title={syncError}>
                    {syncError}
                  </div>
                )}
                {syncDebug && (
                  <div className="sync-debug" title="排障信息">
                    {syncDebug}
                  </div>
                )}
                <button className="sync-logout" onClick={logout} type="button">
                  退出登录
                </button>
              </>
            ) : (
              <button className="sync-login" onClick={() => setAuthOpen(true)} type="button">
                ☁️ 登录以同步
              </button>
            )}
          </div>

          {/* 左下角：按键主题色色盘调节器 */}
          <div className="accent-control">
            <span className="accent-label">主题色</span>
            <label
              className="accent-swatch"
              style={{ background: accent }}
              title="点击调节按键颜色"
            >
              <input
                type="color"
                className="accent-input"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                aria-label="按键主题色"
              />
            </label>
          </div>

          {/* 署名水印 */}
          <div className="watermark">SchedulingToolEventedbyCisssyXiang</div>

          {/* 清空本地缓存（处理 localStorage 残留旧数据） */}
          <button
            className="sync-clear"
            type="button"
            onClick={() => {
              if (window.confirm('确认清空本浏览器里的所有日程与分组？（云端数据不受影响，重新登录会同步回来）')) {
                localStorage.clear()
                cloudLogout()
                setUserEmail(null)
                setEvents([])
                setCategories([])
                setSyncState('idle')
                setSyncError('')
                setSyncDebug('')
              }
            }}
            title="清除本浏览器的本地缓存（解决看到旧数据/缓存残留问题）"
          >
            🧹 清空本地缓存
          </button>
        </aside>

        {/* 主区域：月历/列表 + 右侧面板 */}
        <main className="main">
          <section className="cal-area">
            <div className="toolbar">
              <div className="toolbar-left">
                {view !== 'reminder' && view !== 'assistant' && (
                  <>
                    <button className="icon-btn" onClick={prevMonth} aria-label={view === 'week' ? '上一周' : '上一月'}>
                      <ChevronLeft />
                    </button>
                    <span className="month-title">
                      {view === 'week'
                        ? (() => {
                            const a = weekDays[0]
                            const b = weekDays[6]
                            const sameMonth = a.getMonth() === b.getMonth()
                            return sameMonth
                              ? `${a.getMonth() + 1}月${a.getDate()}日 – ${b.getDate()}日`
                              : `${a.getMonth() + 1}月${a.getDate()}日 – ${b.getMonth() + 1}月${b.getDate()}日`
                          })()
                        : formatMonthTitle(year, month)}
                    </span>
                    <button className="icon-btn" onClick={nextMonth} aria-label={view === 'week' ? '下一周' : '下一月'}>
                      <ChevronRight />
                    </button>
                  </>
                )}
              </div>
              <div className="toolbar-right">
                {view !== 'assistant' && (
                  <div className="search-box">
                    <SearchIcon />
                    <input
                      className="search-input"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索日程"
                    />
                  </div>
                )}
                <div className="view-switch">
                  <button
                    className={`pill${view === 'assistant' ? ' active' : ''}`}
                    onClick={() => setView('assistant')}
                  >
                    AI 助手
                  </button>
                  <button
                    className={`pill${view === 'month' ? ' active' : ''}`}
                    onClick={() => setView('month')}
                  >
                    月
                  </button>
                  <button
                    className={`pill${view === 'week' ? ' active' : ''}`}
                    onClick={() => setView('week')}
                  >
                    周
                  </button>
                  <button
                    className={`pill${view === 'agenda' ? ' active' : ''}`}
                    onClick={() => setView('agenda')}
                  >
                    日程
                  </button>
                  <button
                    className={`pill${view === 'reminder' ? ' active' : ''}`}
                    onClick={() => setView('reminder')}
                  >
                    提醒
                  </button>
                </div>
              </div>
            </div>

            {view === 'assistant' && (
              <AssistantView
                categories={categories}
                existingEvents={recentEventsForAI}
                onAddEvent={addEventQuiet}
                onApplyNote={applyNoteToEvent}
                onGoMonth={() => setView('month')}
                msgs={assistantMsgs}
                setMsgs={setAssistantMsgs}
              />
            )}

            {view === 'month' && (
              <>
                <div className="weekheader">
                  {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
                    <span key={w}>{w}</span>
                  ))}
                </div>
                <div className="grid">
                  {cells.map((d, i) => {
                    const key = toKey(d)
                    const inMonth = d.getMonth() === month
                    const isToday = key === toKey(TODAY)
                    const isSelected = key === selectedDate
                    const dayEvents = (eventsByDate[key] || []).filter(matchQuery)
                    const show = dayEvents.slice(0, 3)
                    const extra = dayEvents.length - show.length
                    return (
                      <div
                        key={i}
                        className={`cell${inMonth ? '' : ' out'}${isToday ? ' today' : ''}${
                          isSelected ? ' selected' : ''
                        }`}
                        onClick={() => selectDay(key)}
                      >
                        <span className={`daynum${inMonth ? '' : ' muted'}`}>
                          {d.getDate()}
                        </span>
                        {show.map((ev) => (
                          <span key={ev.id} className="chip" style={chipStyle(catOf(ev.categoryId))}>
                            {ev.title}
                          </span>
                        ))}
                        {extra > 0 && <span className="more">+{extra}</span>}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {view === 'week' && (
              <WeekView
                weekDays={weekDays}
                eventsByDate={eventsByDate}
                categories={categories}
                selectedDate={selectedDate}
                filter={matchQuery}
                onSelectDay={selectDay}
              />
            )}

            {view === 'agenda' && (
              <EventList
                title={formatMonthTitle(year, month) + '日程'}
                events={listEvents}
                categories={categories}
                onEdit={editEvent}
              />
            )}

            {view === 'reminder' && (
              <ReminderView
                todayKey={toKey(TODAY)}
                tomorrowKey={toKey(
                  new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + 1),
                )}
                eventsByDate={eventsByDate}
                categories={categories}
                onEdit={editEvent}
              />
            )}
          </section>

          {/* 右侧面板：当日详情 / 新建表单 切换 */}
          <aside className="form-panel">
            {rightMode === 'detail' ? (
              <DayDetail
                dateKey={selectedDate}
                events={eventsByDate[selectedDate] || []}
                categories={categories}
                onNew={() => openForm(selectedDate)}
                onEdit={editEvent}
              />
            ) : (
              <EventForm
                title={title}
                setTitle={setTitle}
                categoryId={categoryId}
                setCategoryId={setCategoryId}
                categories={categories}
                addCategory={addCategory}
                date={formDate}
                setDate={setFormDate}
                start={start}
                setStart={setStart}
                end={end}
                setEnd={setEnd}
                note={note}
                setNote={setNote}
                focusToken={focusToken}
                editingId={editingId}
                onSave={saveEvent}
                onDelete={deleteEvent}
                onClear={clearForm}
                onCancel={backToDetail}
                onUpdateCategory={updateCategory}
              />
            )}
          </aside>
        </main>

        {/* 登录 / 注册 弹窗 */}
        {authOpen && (
          <div className="auth-overlay" onClick={() => setAuthOpen(false)}>
            <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
              <button
                className="auth-close"
                onClick={() => setAuthOpen(false)}
                aria-label="关闭"
              >
                ×
              </button>
              <div className="auth-title">云同步账号</div>
              <div className="auth-sub">登录后手机与电脑的日程自动互通</div>
              <div className="auth-tabs">
                <button
                  type="button"
                  className={`auth-tab${authMode === 'login' ? ' active' : ''}`}
                  onClick={() => {
                    setAuthMode('login')
                    setAuthError('')
                  }}
                >
                  登录
                </button>
                <button
                  type="button"
                  className={`auth-tab${authMode === 'signup' ? ' active' : ''}`}
                  onClick={() => {
                    setAuthMode('signup')
                    setAuthError('')
                  }}
                >
                  注册
                </button>
              </div>
              <input
                type="email"
                className="auth-input"
                placeholder="邮箱"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
              <input
                type="password"
                className="auth-input"
                placeholder={authMode === 'signup' ? '设置密码（至少 6 位）' : '密码'}
                value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAuth()
                }}
              />
              {authError && <div className="auth-error">{authError}</div>}
              <button
                className="auth-submit"
                type="button"
                disabled={authBusy}
                onClick={submitAuth}
              >
                {authBusy ? '处理中…' : authMode === 'login' ? '登录' : '注册并开始同步'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DayDetail({
  dateKey,
  events,
  categories,
  onNew,
  onEdit,
}: {
  dateKey: string
  events: CalendarEvent[]
  categories: Category[]
  onNew: () => void
  onEdit: (e: CalendarEvent) => void
}) {
  const catOf = (id: string) => categories.find((c) => c.id === id)
  const list = [...events].sort((a, b) => a.startTime.localeCompare(b.startTime))
  return (
    <div className="day-detail">
      <div className="dd-head">
        <div className="dd-head-text">
          <div className="dd-title">{formatDateTitle(dateKey)}</div>
          <div className="dd-sub">{list.length} 个日程</div>
        </div>
        <button className="new-btn sm" onClick={onNew}>
          <Plus size={16} color="#0a1f0a" />
          新建
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty">当天暂无日程<br />点击「新建」添加一条</div>
      ) : (
        <div className="dd-list">
          {list.map((ev) => {
            const cat = catOf(ev.categoryId)
            const tagBg = cat ? cat.color : '#eef0f3'
            const tagFg = cat ? readableText(cat.color) : '#6b7280'
            return (
              <div
                className="dd-card clickable"
                key={ev.id}
                onClick={() => onEdit(ev)}
                title="点击修改此日程"
              >
                <div className="dd-time">{ev.startTime}–{ev.endTime}</div>
                <div className="dd-body">
                  <div className="dd-name">{ev.title}</div>
                  {ev.note && <div className="dd-note">{ev.note}</div>}
                  <div className="dd-edit-hint">点击修改</div>
                </div>
                <span className="dd-tag" style={{ background: tagBg, color: tagFg }}>
                  {cat ? cat.name : '未分类'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EventList({
  title,
  events,
  categories,
  onEdit,
}: {
  title: string
  events: CalendarEvent[]
  categories: Category[]
  onEdit: (e: CalendarEvent) => void
}) {
  const catOf = (id: string) => categories.find((c) => c.id === id)
  if (events.length === 0) {
    return (
      <div className="list">
        <div className="list-title">{title}</div>
        <div className="empty">暂无日程</div>
      </div>
    )
  }
  let lastDate = ''
  return (
    <div className="list">
      <div className="list-title">{title}</div>
      {events.map((ev) => {
        const newDay = ev.date !== lastDate
        lastDate = ev.date
        const cat = catOf(ev.categoryId)
        const tagStyle = cat
          ? { background: cat.color, color: readableText(cat.color) }
          : { background: '#eef0f3', color: '#6b7280' }
        const tagLabel = cat ? cat.name : '未分类'
        return (
          <div key={ev.id}>
            {newDay && <div className="list-date">{ev.date}</div>}
            <div className="list-card clickable" onClick={() => onEdit(ev)} title="点击修改此日程">
              <div className="t">{ev.title}</div>
              <div className="meta">
                <span className="tag" style={tagStyle}>
                  {tagLabel}
                </span>
                <span>
                  {ev.startTime} – {ev.endTime}
                </span>
              </div>
              {ev.note && <div className="meta">{ev.note}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ReminderView({
  todayKey,
  tomorrowKey,
  eventsByDate,
  categories,
  onEdit,
}: {
  todayKey: string
  tomorrowKey: string
  eventsByDate: Record<string, CalendarEvent[]>
  categories: Category[]
  onEdit: (e: CalendarEvent) => void
}) {
  const catOf = (id: string) => categories.find((c) => c.id === id)

  const renderSection = (key: string, heading: string) => {
    const list = [...(eventsByDate[key] || [])].sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    )
    return (
      <div className="rem-sec">
        <div className="rem-sec-head">
          <span className="rem-sec-title">{heading}</span>
          <span className="rem-sec-date">{formatDateTitle(key)}</span>
          <span className="rem-sec-count">{list.length} 项</span>
        </div>
        {list.length === 0 ? (
          <div className="empty">暂无日程</div>
        ) : (
          list.map((ev) => {
            const cat = catOf(ev.categoryId)
            const tagStyle = cat
              ? { background: cat.color, color: readableText(cat.color) }
              : { background: '#eef0f3', color: '#6b7280' }
            return (
              <div
                key={ev.id}
                className="list-card clickable"
                onClick={() => onEdit(ev)}
                title="点击修改此日程"
              >
                <div className="t">{ev.title}</div>
                <div className="meta">
                  <span className="tag" style={tagStyle}>
                    {cat ? cat.name : '未分类'}
                  </span>
                  <span>
                    {ev.startTime} – {ev.endTime}
                  </span>
                </div>
                {ev.note && <div className="meta">{ev.note}</div>}
              </div>
            )
          })
        )}
      </div>
    )
  }

  return (
    <div className="list">
      <div className="list-title">提醒</div>
      {renderSection(todayKey, '今日')}
      {renderSection(tomorrowKey, '明日')}
    </div>
  )
}

function WeekView({
  weekDays,
  eventsByDate,
  categories,
  selectedDate,
  filter,
  onSelectDay,
}: {
  weekDays: Date[]
  eventsByDate: Record<string, CalendarEvent[]>
  categories: Category[]
  selectedDate: string
  filter: (e: CalendarEvent) => boolean
  onSelectDay: (key: string) => void
}) {
  const HOUR_H = 44
  const DAYS = ['日', '一', '二', '三', '四', '五', '六']
  const catOf = (id: string) => categories.find((c) => c.id === id)
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + (m || 0)
  }

  // 贪心分列：按开始时间排序，日程放入第一个「末尾 <= 新开始」的列，否则新开一列
  const layout = (list: CalendarEvent[]) => {
    const sorted = [...list].sort((a, b) => toMin(a.startTime) - toMin(b.startTime))
    const cols: CalendarEvent[][] = []
    const colEnds: number[] = []
    for (const ev of sorted) {
      const s = toMin(ev.startTime)
      let placed = false
      for (let i = 0; i < cols.length; i++) {
        if (colEnds[i] <= s) {
          cols[i].push(ev)
          colEnds[i] = Math.max(colEnds[i], toMin(ev.endTime))
          placed = true
          break
        }
      }
      if (!placed) {
        cols.push([ev])
        colEnds.push(toMin(ev.endTime))
      }
    }
    return cols
  }

  return (
    <div className="week-view">
      <div className="week-head">
        <div className="week-gutter" />
        {weekDays.map((d, i) => {
          const key = toKey(d)
          const isToday = key === toKey(TODAY)
          const isSelected = key === selectedDate
          return (
            <div
              key={key}
              className={`week-day-head${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
              onClick={() => onSelectDay(key)}
            >
              <span className="week-day-name">{DAYS[i]}</span>
              <span className="week-day-num">{d.getDate()}</span>
            </div>
          )
        })}
      </div>
      <div className="week-body">
        <div className="week-lines">
          {Array.from({ length: 25 }, (_, h) => (
            <div key={h} className="week-hour" style={{ top: h * HOUR_H }}>
              <span>{h % 2 === 0 ? `${h}:00` : ''}</span>
            </div>
          ))}
        </div>
        <div className="week-cols">
          {weekDays.map((d) => {
            const key = toKey(d)
            const dayList = (eventsByDate[key] || []).filter(filter)
            const cols = layout(dayList)
            const maxCols = Math.max(1, cols.length)
            return (
              <div key={key} className="week-col" onClick={() => onSelectDay(key)}>
                {cols.map((col, ci) =>
                  col.map((ev) => {
                    const s = toMin(ev.startTime)
                    const e = toMin(ev.endTime)
                    const top = (s / 60) * HOUR_H
                    const h = Math.max(((e - s) / 60) * HOUR_H, 18)
                    const cat = catOf(ev.categoryId)
                    const bg = cat ? cat.color : '#eef0f3'
                    return (
                      <div
                        key={ev.id}
                        className="week-ev"
                        style={{
                          top,
                          height: h,
                          left: (ci / maxCols) * 100 + '%',
                          width: `calc(${100 / maxCols}% - 2px)`,
                          background: bg,
                          color: readableText(bg),
                        }}
                        onClick={(evt) => {
                          evt.stopPropagation()
                          onSelectDay(key)
                        }}
                        title={`${ev.startTime}–${ev.endTime} ${ev.title}`}
                      >
                        <span className="week-ev-time">{ev.startTime}</span>
                        <span className="week-ev-title">{ev.title}</span>
                      </div>
                    )
                  }),
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── AI 助手 ──────────────────────────────────────────────────────────
type ParsedItem = ParsedSchedule & { done?: boolean }

interface ChatMsg {
  id: number
  role: 'user' | 'ai'
  text: string
  image?: string // 用户消息附带的图片（data URL 缩略图）
  parsed?: ParsedItem[] // AI 回复中识别出的待确认日程
  done?: boolean // 已全部加入日历
  error?: boolean
  engine?: string // 使用的引擎：glm-4-flash / glm-4v-flash / local
  noteTarget?: string // 备注意图：目标日程标题
  noteText?: string // 备注意图：备注内容
  noteDone?: boolean // 备注已应用
}

let chatSeq = 0
const nextId = () => ++chatSeq

const fmtDateCN = (key: string) => {
  const d = new Date(key + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function AssistantView({
  categories,
  existingEvents,
  onAddEvent,
  onApplyNote,
  onGoMonth,
  msgs,
  setMsgs,
}: {
  categories: Category[]
  existingEvents: { title: string; date: string }[]
  onAddEvent: (e: CalendarEvent) => void
  onApplyNote: (title: string, noteText: string) => boolean
  onGoMonth: () => void
  msgs: ChatMsg[]
  setMsgs: (updater: ChatMsg[] | ((prev: ChatMsg[]) => ChatMsg[])) => void
}) {
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [engine, setEngine] = useState<'checking' | 'llm' | 'local'>('checking')
  const [dragOver, setDragOver] = useState(false)
  const [lastEventId, setLastEventId] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 探测 LLM 代理是否可用
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setEngine(d.hasKey ? 'llm' : 'local'))
      .catch(() => setEngine('local'))
  }, [])

  // 初始欢迎语（引擎状态确定后一次性插入）
  useEffect(() => {
    if (msgs.length > 0 || engine === 'checking') return
    const stateText =
      engine === 'llm'
        ? 'AI 引擎已连接（智谱 GLM）✅ 文字、图片都能理解，直接说或拍照即可。'
        : '当前为本地规则版（LLM 未配置）。文字用规则解析，图片识别需在 server/config.json 填入智谱 API key。'
    setMsgs([
      {
        id: nextId(),
        role: 'ai',
        text:
          `你好，我是日程助手 🤖 直接告诉我你想安排的日程就行，例如：\n「明天下午3点开组会」\n「9月10日 11点到12点半 简历课」\n「下周一上午10点面试」\n\n也可以点 📷 上传课程表 / 通知截图，我帮你识别。识别后我会给你确认，确认无误再加入日历。\n\n${stateText}`,
      },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  // 新消息自动滚到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs, typing])

  const reply = (text: string, extra?: Partial<ChatMsg>) =>
    setMsgs((prev) => [...prev, { id: nextId(), role: 'ai', text, ...extra }])

  const pushParsed = (parsed: ParsedSchedule[], engineName: string) => {
    const head =
      parsed.length === 1
        ? '我识别到 1 个日程，请确认：'
        : `我识别到 ${parsed.length} 个日程，请逐一确认：`
    reply(head, { parsed, engine: engineName })
  }

  // 发送：文本可附带图片；LLM 优先，失败回退本地规则（图片无回退）
  const send = async (raw?: string, image?: string | null) => {
    const text = (raw ?? input).trim()
    // 默认从 pendingImage 取图片——按钮点「发送」时若已预览图片，应一并发出
    const img = image === undefined ? pendingImage : image
    if (!text && !img) return
    setInput('')
    setPendingImage(null)
    const userMsg: ChatMsg = { id: nextId(), role: 'user', text }
    if (img) userMsg.image = img
    setMsgs((prev) => [...prev, userMsg])
    setTyping(true)

    try {
      if (img) {
        const llm = await parseImageWithLLM(img, text || undefined, categories)
        if (llm.ok && (llm.events?.length ?? 0) > 0) {
          pushParsed(llm.events!, llm.engine || 'glm-4v-flash')
          return
        }
        if (llm.ok && (llm.events?.length ?? 0) === 0) {
          reply('图片里没有识别出明确的日程安排 🤔 可以换个更清晰的图，或用文字补充说明。')
          return
        }
        // LLM 失败：按具体原因提示
        reply(
          llm.reason === 'NO_KEY'
            ? 'LLM key 未配置：请在 server/config.json 填入智谱 API key 后重启后端。'
            : llm.reason === 'LLM_TIMEOUT'
              ? '图片识别超时，请换张更小的图，或稍后再试。'
              : llm.reason === 'LLM_API_ERROR'
                ? `图片识别失败（LLM 调用出错）：${(llm.hint || '').slice(0, 120)}`
                : llm.reason === 'FETCH_FAILED'
                  ? '图片识别失败：本地后端连不上，请确认 calendar-app/server 目录下的 llm-server.mjs 在运行。'
                  : `图片识别失败：${llm.reason || '未知错误'}`,
          { error: true },
        )
        return
      }

      // 纯文本：LLM 优先；existingEvents（已有日程近 60 天）让模型能区分"新建并附备注" vs "给已有加备注"
      const llm = await parseWithLLM(text, categories, existingEvents)
      // 备注意图：给已有日程加备注（不新增日程）
      if (llm.ok && llm.action === 'update_note' && llm.noteTarget && llm.noteText) {
        reply(`要把这段备注加到「${llm.noteTarget}」上吗？`, {
          noteTarget: llm.noteTarget,
          noteText: llm.noteText,
        })
        return
      }
      if (llm.ok && (llm.events?.length ?? 0) > 0) {
        pushParsed(llm.events!, llm.engine || 'glm-4-flash')
        return
      }
      if (llm.ok && (llm.events?.length ?? 0) === 0) {
        reply('AI 没理解到日程安排，换个说法试试？也可以直接说「明天下午3点开组会」这种格式。', { error: true })
        return
      }
      // LLM 失败：回退本地规则版（文本永远有规则兜底）——但要告诉用户为什么走规则版
      if (llm.reason === 'FETCH_FAILED') {
        reply('⚠️ AI 服务连不上（本地后端 llm-server 可能没运行），已自动用本地规则版解析。打开终端运行 `cd calendar-app && npm run server` 可启动后端；启动后刷新页面即可恢复 AI。', { error: true })
      } else if (llm.reason === 'NO_KEY') {
        reply('⚠️ LLM key 未配置，已用本地规则版解析（不支持图片）。', { error: true })
      } else if (llm.reason === 'LLM_TIMEOUT' || llm.reason === 'NETWORK') {
        reply('⚠️ AI 服务网络超时，已用本地规则版解析。请稍后重试。', { error: true })
      }
      const r = parseSchedule(text)
      if (!r.ok || !r.events || r.events.length === 0) {
        reply(r.ok ? '没有识别出日程内容，换个说法试试？' : (r.reason ?? '没听懂，换个说法试试？'), {
          error: true,
        })
        return
      }
      pushParsed(r.events, 'local')
    } finally {
      setTyping(false)
    }
  }

  const confirmAdd = (ev: ParsedSchedule, msgId: number, idx: number) => {
    // 优先用 AI 识别的分组名匹配已有分组；匹配不到则用第一个分组
    const catId = ev.category
      ? (categories.find((c) => c.name === ev.category)?.id ?? categories[0]?.id ?? '')
      : (categories[0]?.id ?? '')
    onAddEvent({
      id: 'e' + Date.now() + '_' + (lastEventId + 1),
      title: ev.title,
      date: ev.date,
      startTime: ev.startTime,
      endTime: ev.endTime,
      note: ev.note ?? '',
      categoryId: catId,
    })
    setLastEventId((n) => n + 1)
    setMsgs((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.parsed) return m
        const next = m.parsed.map((p, i) => (i === idx ? { ...p, done: true as boolean } : p))
        return { ...m, parsed: next, done: next.every((p) => p.done) }
      }),
    )
  }

  const applyNote = (msgId: number) => {
    const msg = msgs.find((m) => m.id === msgId)
    if (!msg || !msg.noteTarget) return
    // 容错：去除标题两端可能带的书名号/引号/括号等装饰
    const cleanTarget = msg.noteTarget.replace(/^[《「"'"』》]+|[《」"'》』]+$/g, '').trim()
    const ok = onApplyNote(cleanTarget, msg.noteText || '')
    if (!ok) {
      reply(
        `没有找到标题为「${cleanTarget}」的日程。请先在「月」或「日程」视图确认标题写法，或换个说法（比如把标题原样发我）。`,
        { error: true },
      )
      return
    }
    setMsgs((prev) => prev.map((m) => (m.id === msgId ? { ...m, noteDone: true } : m)))
  }

  const onPickImage = async (f: File | undefined) => {
    if (!f) return
    if (!f.type.startsWith('image/')) {
      reply(`文件类型不支持（${f.type || '未知'}），请选择图片文件。`, { error: true })
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      reply(`图片太大（${(f.size / 1024 / 1024).toFixed(1)}MB），请选择 10MB 以内的图片。`, { error: true })
      return
    }
    try {
      const dataUrl = await compressImage(f)
      setPendingImage(dataUrl)
    } catch (e) {
      reply(
        `图片处理失败：${e instanceof Error ? e.message : '未知错误'}。可以换个更小的图、或用其他浏览器试试。`,
        { error: true },
      )
    }
  }

  const sendOnEnter = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const sendDisabled = !input.trim() && !pendingImage

  return (
    <div className="assistant-wrap">
      <div className="chat-list" ref={listRef}>
        {msgs.map((m) => (
          <div key={m.id} className={`chat-row ${m.role}`}>
            <div className={`chat-bubble${m.error ? ' error' : ''}`}>
              <div className="chat-text">{m.text}</div>
              {m.image && (
                <img className="chat-image" src={m.image} alt="用户上传" />
              )}
              {m.noteTarget !== undefined && (
                <div className="chat-confirms">
                  <div className={`confirm-card${m.noteDone ? ' done' : ''}`}>
                    <div className="confirm-main">
                      <span className="confirm-title">给「{m.noteTarget}」添加备注</span>
                      <span className="confirm-meta">{m.noteText}</span>
                    </div>
                    {m.noteDone ? (
                      <span className="confirm-done">已添加 ✓</span>
                    ) : (
                      <button className="btn-mini" type="button" onClick={() => applyNote(m.id)}>
                        应用备注
                      </button>
                    )}
                  </div>
                  <div className="chat-engine-tip">✨ 由 AI 识别</div>
                </div>
              )}
              {m.parsed && m.parsed.length > 0 && (
                <div className="chat-confirms">
                  {m.parsed.map((p, idx) => (
                    <div key={idx} className={`confirm-card${p.done ? ' done' : ''}`}>
                      <div className="confirm-main">
                        <span className="confirm-title">{p.title}</span>
                        <span className="confirm-meta">
                          {fmtDateCN(p.date)} {p.startTime}–{p.endTime}
                          {p.note ? ` · ${p.note}` : ''}
                          {p.category ? ` · 分组：${p.category}` : ''}
                        </span>
                      </div>
                      {p.done ? (
                        <span className="confirm-done">已加入 ✓</span>
                      ) : (
                        <button
                          className="btn-mini"
                          type="button"
                          onClick={() => confirmAdd(p, m.id, idx)}
                        >
                          加入日历
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="chat-engine-tip">
                    {m.engine === 'glm-4v-flash' ? '📷 由 AI 视觉识别' : m.engine === 'glm-4-flash' ? '✨ 由 AI 识别' : '⚙️ 本地规则解析'}
                  </div>
                  {m.done && (
                    <div className="chat-done-tip">
                      全部已加入 ✓ 可以去「月」视图查看
                      <button className="btn-mini ghost" type="button" onClick={onGoMonth}>
                        去看看 →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {typing && (
          <div className="chat-row ai">
            <div className="chat-bubble chat-typing">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
      </div>

      <div className="chat-input-row">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            onPickImage(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button
          className="chat-img"
          onClick={() => fileRef.current?.click()}
          type="button"
          title="上传图片识别（课程表 / 通知截图）"
        >
          📷
        </button>
        <div
          className={`chat-input-box${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              if (!dragOver) setDragOver(true)
            }
          }}
          onDragLeave={(e) => {
            // 仅当真正离开 chat-input-box 时清除状态（子元素触发不算）
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragOver(false)
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) onPickImage(f)
          }}
        >
          {dragOver && (
            <div className="chat-drag-tip">松开鼠标上传图片</div>
          )}
          {pendingImage && (
            <div className="chat-preview">
              <img src={pendingImage} alt="待发送" />
              <button
                className="chat-preview-x"
                type="button"
                onClick={() => setPendingImage(null)}
                aria-label="移除图片"
              >
                ×
              </button>
            </div>
          )}
          <textarea
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={sendOnEnter}
            placeholder={pendingImage ? '可选：补充说明图片里的日程' : '说说什么日程，如：明天下午3点开组会（Enter 发送 · 可拖拽图片到此处）'}
            rows={1}
          />
        </div>
        <button className="chat-send" onClick={() => send()} type="button" disabled={sendDisabled || typing}>
          {typing ? '…' : '发送'}
        </button>
      </div>
    </div>
  )
}
