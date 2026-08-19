// Cloudflare Pages Functions 共享模块：LLM 提示词 + 解析逻辑
// 环境变量（Cloudflare Pages → Settings → Environment variables）：
//   ZHIPU_API_KEY  智谱 key（默认）
//   OPENAI_API_KEY + OPENAI_BASE_URL（可选，香港/海外可切 OpenAI 兼容服务）

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

export function todayKey() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 识别用的模型名（返回给前端展示）
export function resolveModels(env) {
  return {
    textModel: env.LLM_MODEL || 'glm-4-flash',
    visionModel: env.VISION_MODEL || 'glm-4v-flash',
  }
}

// 调用 OpenAI 兼容 chat/completions
export async function callLLM(env, { model, messages }) {
  const key = env.ZHIPU_API_KEY || env.OPENAI_API_KEY
  if (!key) throw new Error('NO_KEY')
  const base = env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.1 }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = JSON.stringify((await res.json()).error || {})
    } catch {}
    throw new Error('API_' + (res.status + ' ' + detail).slice(0, 160))
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// ── 提示词 ──────────────────────────────────────────────

const catListText = (categories) =>
  categories && categories.length > 0
    ? `用户已有的分组：${categories.map((c) => c.name).join('、')}。若用户明确提到归到某个分组，category 字段必须取此列表中的名称；否则 category 填空字符串。`
    : 'category 字段一律填空字符串。'

const existingEventsText = (existing) =>
  Array.isArray(existing) && existing.length > 0
    ? `用户已有的日程（仅近 60 天内，最多 50 条，供你判断"新加"还是"修改备注"；标题原样引述，不要加书名号《》等装饰）：\n` +
      existing.map((e) => `- ${e.date} ${e.title}`).join('\n') +
      `\n【关键判断】用户用「给X加备注」「X的备注是Y」「把Y记到X」这种引用结构（X 是上面已列出的某个日程标题）→ action="update_note"。否则（X 不在上面、或用户在创造新内容、或只是顺嘴说"备注一下"）一律 action="add"，并把用户提到的备注内容放进新日程的 note 字段。`
    : `【关键判断】action 默认 "add"。除非用户明确用「给X加备注」「X的备注是Y」这种结构，否则都按新建日程处理，备注内容放新日程的 note 字段。`

export const systemTextPrompt = (today, categories, existing) =>
  `你是「日程助手」里的 AI 日程解析器。用户会发来中文句子，你要判断用户意图并提取日程信息。
今天日期：${today}（严格以此日期计算「明天/后天/下周一/周X」等相对日期）

只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释文字：
{"action":"add 或 update_note","events":[{"title":"日程标题","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","note":"","category":"分组名或空字符串"}],"note_target":"","note_text":""}

【意图判断】两种意图二选一：
- action="add"：用户是在安排/添加新日程（默认）。events 填新日程（note 字段直接放用户提到的备注内容），note_target/note_text 留空。
- action="update_note"：用户是在给【已有日程】添加或修改备注——典型说法：「给X添加备注Y」「X的备注是Y」「把Y记到X的备注」「备注X是Y」等，语气是修改而非新增，且 X 是已有日程标题。此时 events 填 []，note_target 填用户提到的日程标题（原样），note_text 填要写入的备注内容。

${existingEventsText(existing)}

【add 意图时 events 字段要求】
1. date 必须是完整日期 YYYY-MM-DD
2. startTime/endTime 用 24 小时制
3. 没有给结束时间 → 默认开始后 1 小时
4. 没有给具体时间 → 默认 09:00 开始，并在 note 里写「未指定时间，已默认安排」
5. 一句话可能含多条日程，全部提取
6. ${catListText(categories)}
7. 【关键·备注提取】用户消息中出现的备注说明（如「备注：X」「备注是X」「备注一下X」「备注：需要交作业」），X 必须写入新日程的 note 字段。这些表述中的「备注」「记得」等词本身不要当成标题或日程标题的一部分——X 才是要写进 note 的内容（连同 X 之前的「：」「是」「一下」后面的内容一起）。例：用户说「备注一下需要交作业」→ note 填「需要交作业」。用户说「备注：需要带电脑」→ note 填「需要带电脑」。
8. 同样，用户消息中出现的元数据（分组/分类说明）只在用户明确说"分到X组"/"分组是X"/"归类X"时识别为该日程的 category，不要把"日历分组是学校"或"归类到学校"等当成日程标题——这些是元数据描述，不应单独成为一条日程。
9. 完全无法理解或没有日程 → 输出 {"action":"add","events":[],"note_target":"","note_text":""}

特别说明：用户常用省略句式「日程XXX」「加个XXX」「记一下XXX」「安排XXX」「提醒XXX」「帮我加XXX」「来个XXX」——其中「日程/加个/记一下/安排/提醒/帮我加/来个」等是提示词，**title 字段只取 XXX 这部分，不要把提示词本身当成标题**（否则会出现 title="日程标题"这种错误）。`

export const systemVisionPrompt = (today, categories) =>
  `你是「日程助手」里的 AI 日程解析器。用户发来一张图片（可能是课程表、活动通知、聊天记录、手写便签、图书馆导览通知等），请识别其中所有的日程安排（日期 + 时间 + 事项）。如同时有用户补充文字，也一并参考。
今天日期：${today}（严格以此日期计算相对日期）

只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释文字：
{"events":[{"title":"日程标题","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","note":"","category":"分组名或空字符串"}]}

要求：
1. date 必须是完整日期 YYYY-MM-DD
2. startTime/endTime 用 24 小时制
3. 没有给结束时间 → 默认开始后 1 小时；只有时间段没有日期 → 默认今天
4. 没有给具体时间 → 默认 09:00 开始，并在 note 里写「未指定时间，已默认安排」
5. 图片里有多条日程，全部提取
6. ${catListText(categories)}
7. 图片里没有明确日程 → 输出 {"events":[]}

【重要·备注字段】图片中除核心日程（标题/日期/起止时间）以外的所有可见信息——例如：地点 Venue、地点编号、所属分类、报名状态（已注册/已满/REGISTERED）、举办方、联系人、备注说明、网页链接、报名方式、注意事项、英文原文、关联文档编号、参与者名单等——**全部合并写入 note 字段**，保持简短（关键短语为主，原文照抄也 OK，保留关键英文/数字）。例如"地点:图书馆-B；Venue: Libratorium-B, Library；状态: 已注册"。多条日程时各自 note 只放各自相关的信息。`

// ── 解析 ──────────────────────────────────────────────

const trimTime = (t) => {
  if (typeof t !== 'string') return t
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return t
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

// 提取 JSON（对象 {"action","events",...} 或裸数组）
export function extractResult(text) {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  try {
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a >= 0 && b > a) {
      const obj = JSON.parse(s.slice(a, b + 1))
      if (obj && typeof obj === 'object') {
        return {
          action: obj.action === 'update_note' ? 'update_note' : 'add',
          events: Array.isArray(obj.events) ? obj.events : [],
          noteTarget: typeof obj.note_target === 'string' ? obj.note_target : '',
          noteText: typeof obj.note_text === 'string' ? obj.note_text : '',
        }
      }
    }
  } catch {}
  try {
    const a = s.indexOf('[')
    const b = s.lastIndexOf(']')
    if (a >= 0 && b > a) {
      const arr = JSON.parse(s.slice(a, b + 1))
      if (Array.isArray(arr)) {
        return { action: 'add', events: arr, noteTarget: '', noteText: '' }
      }
    }
  } catch {}
  return null
}

// 清洗事件（简化版：时间修剪 + 分组校验）
export function sanitize(events, categories = []) {
  const known = new Set((categories || []).map((c) => c && c.name).filter(Boolean))
  const placeholderRe = /备注，没有则空字符串|备注|空字符串|无备注|没有备注/
  return (events || [])
    .filter((e) => e && typeof e.title === 'string' && e.title.trim())
    .map((e) => {
      const note = typeof e.note === 'string' ? e.note : ''
      const startTime = trimTime(typeof e.startTime === 'string' ? e.startTime : '09:00')
      const cleanedNote =
        startTime !== '09:00' && /未指定时间|默认安排/.test(note)
          ? ''
          : placeholderRe.test(note)
            ? ''
            : note
      const category = known.has(e.category) ? e.category : ''
      return {
        title: e.title.trim(),
        date: typeof e.date === 'string' ? e.date : '',
        startTime,
        endTime: trimTime(typeof e.endTime === 'string' ? e.endTime : '10:00'),
        note: cleanedNote,
        category,
      }
    })
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))
}
