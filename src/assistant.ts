// 中文自然语言 → 日程结构化解析（规则版，零依赖，纯本地运行）
// 示例：明天下午3点开组会 / 9月10日 11点到12点半 简历课 / 下周一上午10点面试

export interface ParsedSchedule {
  title: string
  date: string // YYYY-MM-DD
  startTime: string // HH:MM
  endTime: string // HH:MM
  note?: string
  category?: string // AI 识别的分组名（须匹配已有分组）
}

export interface ParseResult {
  ok: boolean
  events?: ParsedSchedule[]
  reason?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const WEEKDAY_NUM: Record<string, number> = { 日: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 天: 0 }

// 时段词：值为 true 表示「小时 < 12 时加 12」
const PERIODS: Record<string, boolean> = {
  凌晨: false,
  早上: false,
  早晨: false,
  上午: false,
  中午: false,
  下午: true,
  傍晚: true,
  晚上: true,
  晚间: true,
  夜里: true,
  今晚: true,
  明晚: true,
}

const normalizeHour = (h: number, period?: string): number => {
  if (period && PERIODS[period] && h < 12) return h + 12
  return h
}

interface TimeRange {
  start: { h: number; m: number }
  end?: { h: number; m: number }
}

/** 解析时间段 / 时间点；返回匹配到的片段与结果 */
function parseTime(text: string): { seg: string; t: TimeRange | null } {
  // 时间段：下午2点到3点半 / 14:00-15:30 / 9点到11点
  const rangeRe =
    /([凌晨早上早晨上午中午下午傍晚晚上晚间夜里今晚明晚]+)?\s*(\d{1,2})\s*[点时:：]\s*(\d{1,2}|半)?\s*分?\s*[到至－—~～-]\s*([凌晨早上早晨上午中午下午傍晚晚上晚间夜里今晚明晚]+)?\s*(\d{1,2})\s*[点时:：]\s*(\d{1,2}|半)?\s*分?/
  let m = text.match(rangeRe)
  if (m) {
    const p1 = m[1]
    const h1 = Number(m[2])
    const mm1 = m[3] === '半' ? 30 : Number(m[3] || 0)
    const p2 = m[4]
    const h2 = Number(m[5])
    const mm2 = m[6] === '半' ? 30 : Number(m[6] || 0)
    let sh = normalizeHour(h1, p1)
    let eh = p2 ? normalizeHour(h2, p2) : h2
    if (!p2 && sh >= 12 && h2 < 12) eh = h2 + 12
    if (eh <= sh) eh = sh + 1
    if (eh > 23) eh = 23
    return { seg: m[0], t: { start: { h: sh, m: mm1 }, end: { h: eh, m: mm2 } } }
  }
  // 单时间点：下午3点 / 9:30 / 3点半
  const pointRe = /([凌晨早上早晨上午中午下午傍晚晚上晚间夜里今晚明晚]+)?\s*(\d{1,2})\s*[点时:：]\s*(\d{1,2}|半)?\s*分?/
  m = text.match(pointRe)
  if (m) {
    const h = normalizeHour(Number(m[2]), m[1])
    const min = m[3] === '半' ? 30 : Number(m[3] || 0)
    return { seg: m[0], t: { start: { h, m: min } } }
  }
  return { seg: '', t: null }
}

/** 解析日期；返回匹配到的片段、日期与是否「晚间」提示 */
function parseDate(text: string): { seg: string; date: Date | null; evening: boolean } {
  let rest = text
  let evening = false
  const now = new Date()

  // 今晚 / 明晚 → 日期 + 晚间提示
  rest = rest.replace(/明晚/g, () => {
    evening = true
    return '明天'
  })
  rest = rest.replace(/今晚/g, () => {
    evening = true
    return '今天'
  })

  // 相对日期
  const rel = rest.match(/(大后天|后天|明天|明日|今天|今日)/)
  if (rel) {
    const off = { 大后天: 3, 后天: 2, 明天: 1, 明日: 1, 今天: 0, 今日: 0 }[rel[1]]!
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off)
    return { seg: rel[1], date: d, evening }
  }

  // X月X日 / X月X号：先按整体匹配，再看"号/日"后跟的中文是时段词（保留日/号）还是日程关键词（去掉日/号）
  const mdNum = rest.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*([号日])/)
  if (mdNum) {
    const idxEnd = (mdNum.index ?? 0) + mdNum[0].length
    const nextChar = rest[idxEnd]
    let realSeg = mdNum[0]
    if (nextChar && /[一-龥]/.test(nextChar)) {
      const nextFour = rest.substring(idxEnd, idxEnd + 4)
      // 时段词/周X 开头 → "日/号"是日期结尾，保留
      // 其他（"日程""安排""事"等关键词）→ "日/号"是关键词字的一部分，用 X月X
      if (
        !/^(晚上|上午|早上|中午|凌晨|傍晚|夜里|今天|今日|明天|明日|后天|大后天|周一|周二|周三|周四|周五|周六|周日|周天|今晚|明晚|本周|这周|下周)/.test(
          nextFour,
        )
      ) {
        realSeg = `${mdNum[1]}月${mdNum[2]}`
      }
    }
    const d = new Date(now.getFullYear(), Number(mdNum[1]) - 1, Number(mdNum[2]))
    return { seg: realSeg, date: d, evening }
  }
  // 不带号日的 X月X：要求数字后不跟中文或数字（"30日程"等已走上一分支处理）
  const mdPlain = rest.match(/(\d{1,2})\s*月\s*(\d{1,2})(?![一-龥\d])/)
  if (mdPlain) {
    const d = new Date(now.getFullYear(), Number(mdPlain[1]) - 1, Number(mdPlain[2]))
    return { seg: mdPlain[0], date: d, evening }
  }

  // 9/10 或 9.10（当月）
  const slash = rest.match(/(\d{1,2})\s*[/.]\s*(\d{1,2})/)
  if (slash) {
    const d = new Date(now.getFullYear(), Number(slash[1]) - 1, Number(slash[2]))
    return { seg: slash[0], date: d, evening }
  }

  // 下周一 / 下礼拜二 / 下周 / 下个周一（必须「下」紧跟「周/礼拜」，避免误伤「下午」）
  const nw = rest.match(/(下)(周|礼拜)([日一二三四五六天])?/)
  if (nw) {
    let d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (nw[3] !== undefined) {
      const target = WEEKDAY_NUM[nw[3]]
      const diff = (target - d.getDay() + 7) % 7
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (diff === 0 ? 7 : diff))
    } else {
      // 「下周」默认下周一
      const diff = (1 - d.getDay() + 7) % 7
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (diff === 0 ? 7 : diff))
    }
    return { seg: nw[0], date: d, evening }
  }

  // 周X / 这周五 / 本周五 / 礼拜五（本周未来最近的该天）
  const wk = rest.match(/(这周|本周|这礼拜)?(周|礼拜)\s*([日一二三四五六天])/)
  if (wk) {
    const target = WEEKDAY_NUM[wk[3]]
    let d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let diff = (target - d.getDay() + 7) % 7
    if (diff === 0) diff = 0 // 今天就是该天
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff)
    return { seg: wk[0], date: d, evening }
  }

  // 10号 / 15日（当月）—— 但要避免"30日程"误识：若前面有"X月X"上下文，则用 X月X
  const plain = rest.match(/(\d{1,2})\s*[号日]/)
  if (plain) {
    const beforeText = rest.substring(Math.max(0, (plain.index ?? 0) - 6), plain.index ?? 0)
    const yueMatch = beforeText.match(/(\d{1,2})\s*月\s*(\d{1,2})$/)
    if (yueMatch) {
      // 前面是 X月X → 这个"号/日"是后续汉字的一部分；用 X月X
      const d = new Date(now.getFullYear(), Number(yueMatch[1]) - 1, Number(yueMatch[2]))
      return { seg: yueMatch[0], date: d, evening }
    }
    // 真正的 X号 / X日
    const d = new Date(now.getFullYear(), now.getMonth(), Number(plain[1]))
    return { seg: plain[0], date: d, evening }
  }

  return { seg: '', date: null, evening }
}

/** 清理指令词与标点，提取标题 */
function extractTitle(text: string): string {
  let t = text
    .replace(/[，,。.！!？?；;、：:]/g, ' ')
    .replace(/帮我|请|麻烦你|麻烦|记得|提醒我|安排|添加|加入|加个|设个|定个|记下|记录|预约|提醒/g, ' ')
    .replace(
      /今天|今日|明天|明日|后天|大后天|下周|礼拜|上周|这周|本周|周一|周二|周三|周四|周五|周六|周日|周天|凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|晚间|夜里|今晚|明晚/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
  return t
}

/** 解析一条自然语言句子 */
function parseOne(raw: string): ParsedSchedule | null {
  let text = raw.trim()
  if (!text) return null

  // 元数据句子检测：分组/归类说明、备注说明这类不是日程本身，整条跳过
  // 例：'日历分组是学校'、'分组：工作'、'归类个人'、'备注：X'、'备注一下X'、'备注是X'
  if (/^(日历分组|分组|归类|分类|备注|备注是|备注一下)\s*[是为：:到就归，,]/.test(text)) return null
  // 纯时间段片段（缺标题）—— 例：'早上9点到10点' 这种只有时间没有事件描述的句子
  if (/^[凌晨早上早晨上午中午下午傍晚晚上晚间夜里]+\s*\d/.test(text) && !/[日程会议约见讲课考试提醒提醒安排记录做去听看买吃饭桌聚活动]/.test(text)) {
    return null
  }

  // 提取日期
  const { seg: dateSeg, date, evening } = parseDate(text)
  if (dateSeg) text = text.replace(dateSeg, ' ')
  const finalDate = date ?? new Date()

  // 提取时间
  const { seg: timeSeg, t } = parseTime(text)
  if (timeSeg) text = text.replace(timeSeg, ' ')

  const startH0 = t ? t.start.h : 9
  const startM0 = t ? t.start.m : 0
  let endH0 = t?.end ? t.end.h : startH0 + 1
  let endM0 = t?.end ? t.end.m : startM0

  // 「今晚/明晚」的晚间提示：没有显式时段词时把 <12 的小时归到晚上（+12）
  let startH = startH0
  let endH = endH0
  if (evening) {
    if (startH < 12) startH += 12
    if (endH < 12) endH += 12
  }
  if (endH > 23) {
    endH = 23
    endM0 = 59
  }
  const finalStart = `${pad(startH)}:${pad(startM0)}`
  const finalEnd = `${pad(endH)}:${pad(endM0)}`

  // 标题：剩余文本清理（处理「日程实变函数 / 加个XXX / 安排XXX」等省略句式）
  let title = extractTitle(text)
  // 用户常见的「指令前缀 + 标题」：「日程X / 加个X / 记一下X / 安排X / 提醒X / 帮我X」 → X 即标题
  title = title.replace(
    /^(日程|加个|加一|记一下|记下|安排|设个|定个|提醒|新建|帮我|请|麻烦|来一个|来个)\s*/,
    '',
  )
  title = title.trim()
  if (!title && dateSeg && timeSeg) {
    title = '未命名日程'
  }
  if (!title) return null

  const note: string[] = []
  if (!t) note.push('未指定时间，已默认安排')

  return {
    title,
    date: toKey(finalDate),
    startTime: finalStart,
    endTime: finalEnd,
    note: note.length ? note.join('；') : undefined,
  }
}

/** 主入口：支持用逗号/分号/换行分隔的多条日程 */
export function parseSchedule(raw: string): ParseResult {
  const parts = raw
    .split(/[，,;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (parts.length === 0) return { ok: false, reason: '没有内容' }

  const events: ParsedSchedule[] = []
  for (const p of parts) {
    const e = parseOne(p)
    if (e) events.push(e)
  }

  if (events.length === 0) {
    return {
      ok: false,
      reason: '没听懂 😅 试试这样说：「明天下午3点开组会」「9月10日 11点到12点半 简历课」「下周一上午10点面试」',
    }
  }
  return { ok: true, events }
}

// ── LLM 增强（可选）──────────────────────────────────────────────
// 通过本地代理调智谱 GLM；代理不可用或未配 key 时返回 null，调用方回退规则版。

export interface LLMResult {
  ok: boolean
  action?: 'add' | 'update_note'
  events?: ParsedSchedule[]
  engine?: string
  reason?: string // NO_KEY / LLM_TIMEOUT / LLM_API_ERROR / NETWORK / FETCH_FAILED
  hint?: string
  noteTarget?: string // update_note 意图：要加备注的日程标题
  noteText?: string // update_note 意图：备注内容
}

async function postParse(path: string, body: unknown): Promise<LLMResult> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return { ok: false, reason: 'NETWORK', hint: `HTTP ${res.status}` }
    const data = (await res.json()) as LLMResult
    return data
  } catch (e) {
    return { ok: false, reason: 'FETCH_FAILED', hint: String(e) }
  }
}

/** 文本 → LLM 解析 */
export async function parseWithLLM(
  text: string,
  categories?: { name: string }[],
  existingEvents?: { title: string; date: string }[],
): Promise<LLMResult> {
  return postParse('/api/parse', {
    text,
    categories: categories ?? [],
    existingEvents: existingEvents ?? [],
  })
}

/** 图片 → LLM 视觉解析 */
export async function parseImageWithLLM(
  imageBase64: string,
  text?: string,
  categories?: { name: string }[],
): Promise<LLMResult> {
  return postParse('/api/parse-image', {
    imageBase64,
    text,
    categories: categories ?? [],
  })
}

/** 图片压缩：最长边 1280、JPEG 0.85，返回 data URL */
export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const MAX = 1280
        let { width, height } = img
        if (width > MAX || height > MAX) {
          const scale = MAX / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('canvas unavailable'))
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = () => reject(new Error('image decode failed'))
      img.src = String(reader.result)
    }
    reader.onerror = () => reject(new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}
