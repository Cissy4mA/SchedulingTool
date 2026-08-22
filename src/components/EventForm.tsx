import { useEffect, useRef, useState } from 'react'
import { Close } from './icons'
import { Category, CalendarEvent } from '../types'
import { readableText, toKey } from '../utils'
import CategoryAdd from './CategoryAdd'

export default function EventForm({
  title,
  setTitle,
  categoryId,
  setCategoryId,
  categories,
  addCategory,
  date,
  setDate,
  start,
  setStart,
  end,
  setEnd,
  note,
  setNote,
  focusToken,
  editingId,
  onSave,
  onDelete,
  onClear,
  onCancel,
  onUpdateCategory,
}: {
  title: string
  setTitle: (v: string) => void
  categoryId: string
  setCategoryId: (v: string) => void
  categories: Category[]
  addCategory: (name: string, color: string) => string
  date: string
  setDate: (v: string) => void
  start: string
  setStart: (v: string) => void
  end: string
  setEnd: (v: string) => void
  note: string
  setNote: (v: string) => void
  focusToken: number
  editingId: string | null
  onSave: (e: CalendarEvent, repeat?: { days: number[]; start: string; end: string }) => void
  onDelete?: (id: string) => void
  onClear: () => void
  onCancel?: () => void
  onUpdateCategory?: (id: string, name: string, color: string) => void
}) {
  const titleRef = useRef<HTMLInputElement>(null)

  // 在表单内直接编辑某个分组（重命名 / 改色）
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [editCatName, setEditCatName] = useState('')
  const [editCatColor, setEditCatColor] = useState('#39FF14')

  // 重复规则：0=周日 1=周一 ... 6=周六；编辑模式不支持修改重复
  const [repeatDays, setRepeatDays] = useState<number[]>([])
  const [repeatStart, setRepeatStart] = useState<string>(date)
  const [repeatEnd, setRepeatEnd] = useState<string>(date)
  useEffect(() => {
    setRepeatDays([])
    setRepeatStart(date)
    setRepeatEnd(date)
  }, [editingId, date])

  // 选中重复后，若结束日期不晚于开始日期，自动往后延 12 周
  useEffect(() => {
    if (repeatDays.length > 0 && repeatEnd <= repeatStart) {
      const d = new Date(repeatStart + 'T00:00:00')
      d.setDate(d.getDate() + 7 * 12)
      setRepeatEnd(toKey(d))
    }
  }, [repeatDays.length, repeatStart, repeatEnd])

  useEffect(() => {
    titleRef.current?.focus()
  }, [focusToken])

  const toggleRepeatDay = (d: number) => {
    if (editingId) return
    setRepeatDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    )
  }

  const save = () => {
    if (!title.trim()) {
      window.alert('请填写标题')
      return
    }
    if (repeatDays.length > 0 && repeatStart > repeatEnd) {
      window.alert('重复结束日期不能早于开始日期')
      return
    }
    onSave(
      {
        id: editingId ?? 'e' + Date.now(),
        title: title.trim(),
        date,
        startTime: start,
        endTime: end,
        note: note.trim() || undefined,
        categoryId,
      },
      editingId || repeatDays.length === 0
        ? undefined
        : { days: repeatDays, start: repeatStart, end: repeatEnd },
    )
  }

  const handleAddCategory = (name: string, color: string) => {
    const id = addCategory(name, color)
    setCategoryId(id)
  }

  const startEditCat = (c: Category) => {
    setEditCatName(c.name)
    setEditCatColor(c.color)
    setEditingCatId(c.id)
  }

  const saveEditCat = () => {
    if (!editCatName.trim()) {
      window.alert('请填写分组名称')
      return
    }
    if (editingCatId) {
      onUpdateCategory?.(editingCatId, editCatName.trim(), editCatColor)
    }
    setEditingCatId(null)
  }

  const cancelEditCat = () => setEditingCatId(null)

  const handleChipClick = (c: Category) => {
    if (categoryId === c.id) {
      // 再次点击已选中的 chip 进入编辑态
      startEditCat(c)
    } else {
      setCategoryId(c.id)
    }
  }

  return (
    <div className="form-inner">
      <div className="form-head">
        <span className="form-title">{editingId ? '编辑日程' : '新建日程'}</span>
        <button
          className="icon-btn"
          style={{ border: 'none', background: 'transparent' }}
          onClick={() => {
            onClear()
            onCancel?.()
          }}
          aria-label="关闭"
        >
          <Close />
        </button>
      </div>

      <div>
        <label className="field-label">标题</label>
        <input
          ref={titleRef}
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="添加标题"
        />
      </div>

      <div>
        <label className="field-label">日历分组</label>
        <div className="cat-list">
          {categories.map((c) => {
            const active = categoryId === c.id
            const textColor = active ? readableText(c.color) : '#4b5563'
            return editingCatId === c.id ? (
              <div key={c.id} className="cat-edit">
                <input
                  className="input cat-edit-input"
                  value={editCatName}
                  onChange={(e) => setEditCatName(e.target.value)}
                  placeholder="分组名称"
                />
                <div className="cat-edit-row">
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
                  <button className="btn-mini ghost" type="button" onClick={cancelEditCat}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                key={c.id}
                type="button"
                className={`cat-chip${active ? ' active' : ''}`}
                style={
                  active
                    ? { background: c.color, color: textColor, borderColor: 'transparent' }
                    : { borderColor: c.color, color: '#4b5563' }
                }
                onClick={() => handleChipClick(c)}
                title={active ? '再次点击编辑该分组' : '点击选择该分组'}
              >
                <span className="cat-dot" style={{ background: c.color }} />
                <span className="cat-name">{c.name}</span>
                <span
                  className="cat-edit-icon"
                  onClick={(e) => {
                    e.stopPropagation()
                    startEditCat(c)
                  }}
                  title="编辑分组"
                  aria-label={`编辑分组 ${c.name}`}
                  style={{ color: textColor }}
                >
                  ✎
                </span>
              </button>
            )
          })}
        </div>
        <CategoryAdd onAdd={handleAddCategory} label="+ 新建分组" />
      </div>

      <div>
        <label className="field-label">日期</label>
        <input
          className="date-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div>
        <label className="field-label">时间</label>
        <div className="time-row">
          <input
            className="date-input"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <span className="time-sep">至</span>
          <input
            className="date-input"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="field-label">重复（每周）</label>
        <div className="repeat-row">
          {[
            { label: '日', value: 0 },
            { label: '一', value: 1 },
            { label: '二', value: 2 },
            { label: '三', value: 3 },
            { label: '四', value: 4 },
            { label: '五', value: 5 },
            { label: '六', value: 6 },
          ].map(({ label, value }) => {
            const checked = repeatDays.includes(value)
            const id = `repeat-day-${value}`
            return (
              <label
                key={value}
                htmlFor={id}
                className={`repeat-day${checked ? ' active' : ''}${editingId ? ' disabled' : ''}`}
                title={editingId ? '编辑模式下不能修改重复规则' : `每周${label}`}
              >
                <input
                  id={id}
                  type="checkbox"
                  className="repeat-checkbox"
                  checked={checked}
                  disabled={!!editingId}
                  onChange={() => toggleRepeatDay(value)}
                />
                {label}
              </label>
            )
          })}
        </div>
        {repeatDays.length > 0 && !editingId && (
          <div className="repeat-range">
            <div className="repeat-range-row">
              <span className="repeat-range-label">从</span>
              <input
                type="date"
                className="date-input"
                value={repeatStart}
                onChange={(e) => setRepeatStart(e.target.value)}
              />
            </div>
            <div className="repeat-range-row">
              <span className="repeat-range-label">到</span>
              <input
                type="date"
                className="date-input"
                value={repeatEnd}
                onChange={(e) => setRepeatEnd(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="field-label">备注</label>
        <textarea
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="添加备注（可选）"
        />
      </div>

      <div className="btn-row">
        <button className="btn-primary" onClick={save}>
          {editingId ? '保存修改' : '保存'}
        </button>
        {editingId && (
          <button
            className="btn-danger"
            type="button"
            onClick={() => editingId && onDelete?.(editingId)}
          >
            删除
          </button>
        )}
        <button
          className="btn-ghost"
          onClick={() => {
            onClear()
            onCancel?.()
          }}
        >
          取消
        </button>
      </div>
    </div>
  )
}
