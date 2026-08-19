import { useState } from 'react'

// 内联「新建分组」：名称 + 色盘取色，onAdd(name, color)
export default function CategoryAdd({
  onAdd,
  label = '+ 新建分组',
}: {
  onAdd: (name: string, color: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#39ff14')

  if (!open) {
    return (
      <button className="cat-add" type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }

  const submit = () => {
    if (!name.trim()) {
      window.alert('请填写分组名称')
      return
    }
    onAdd(name.trim(), color)
    setName('')
    setOpen(false)
  }

  return (
    <div className="cat-new">
      <input
        className="input"
        placeholder="分组名称"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="cat-new-row">
        <input
          type="color"
          className="color-input"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="选择颜色"
        />
        <button className="btn-mini" type="button" onClick={submit}>
          添加
        </button>
        <button className="btn-mini ghost" type="button" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </div>
  )
}
