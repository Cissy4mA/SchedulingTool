// Cloudflare Worker: LLM 代理（GLM-4-Flash 文本 + GLM-4V-Flash 视觉）
// 路由：/api/parse (文本), /api/parse-image (图片)
// 部署：wrangler deploy --name calendar-llm-proxy worker/llm-proxy.js
// 环境变量：ZHIPU_API_KEY（必需），可选 OPENAI_API_KEY + OPENAI_BASE_URL

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
})

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })

const todayKey = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

const catListText = (categories) =>
  categories && categories.length > 0
    ? '用户已有的分组：' + categories.map((c) => c.name).join('、') +
      '。若用户明确提到归到某个分组，category 字段必须取此列表中的名称；否则 category 填空字符串。'
    : 'category 字段一律填空字符串。'

const existingEventsText = (existing) =>
  Array.isArray(existing) && existing.length > 0
    ? '用户已有的日程（仅近 60 天内，最多 50 条，供你判断"新加"还是"修改备注"；标题原样引述，不要加书名号《》等装饰）：\n' +
      existing.map((e) => '- ' + e.date + ' ' + e.title).join('\n') +
      '\n【关键判断】用户用「给X加备注」「X的备注是Y」「把Y记到X」这种引用（X 是上面已列出的某个日程标题）→ action="update_note"。否则（X 不在上面、或用户在创造新内容、或只是顺嘴说"备注一下"）一律 action="add"，并把用户提到的备注内容放进新日程的 note 字段。'
    : '【关键判断】action 默认 "add"。除非用户明确用「给X加备注」「X的备注是Y」这种结构，否则都按新建日程处理，备注内容放新日程的 note 字段。'

const systemText = (today, categories, existing) =>
  '你是「日程助手」里的 AI 日程解析器。用户会发来中文句子，你要判断用户意图并提取日程信息。\n' +
  '今天日期：' + today + '（严格以此日期计算「明天/后天/下周一/周X」等相对日期）\n\n' +
  '只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释文字：\n' +
  '{"action":"add 或 update_note","events":[{"title":"日程标题","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","note":"","category":"分组名或空字符串"}],"note_target":"","note_text":""}\n\n' +
  '【意图判断】两种意图二选一：\n' +
  '- action="add"：用户是在安排/添加新日程（默认）。events 填新日程（note 字段直接放用户提到的备注内容），note_target/note_text 留空。\n' +
  '- action="update_note"：用户是在给【已有日程】添加或修改备注——典型说法：「给X添加备注Y」「X的备注是Y」「把Y记到X的备注」「备注X是Y」等，语气是修改而非新增，且 X 是已有日程标题。events 填 []，note_target 填用户提到的日程标题（原样），note_text 填要写入的备注内容。\n\n' +
  existingEventsText(existing) + '\n\n' +
  '【add 意图时 events 字段要求】\n' +
  '1. date 必须是完整日期 YYYY-MM-DD\n' +
  '2. startTime/endTime 用 24 小时制\n' +
  '3. 没有给结束时间 → 默认开始后 1 小时\n' +
  '4. 没有给具体时间 → 默认 09:00 开始，并在 note 里写「未指定时间，已默认安排」\n' +
  '5. 一句话可能含多条日程，全部提取\n' +
  '6. ' + catListText(categories) + '\n' +
  '7. 【关键·备注提取】用户消息中出现的备注说明（如「备注：X」「备注是X」「备注一下X」「备注：需要交作业」），X 必须写入新日程的 note 字段。这些表述中的「备注」「记得」等词本身不要当成标题或日程标题的一部分——X 才是要写进 note 的内容（连同 X 之前的「：」「是」「一下」后面的内容一起）。例：用户说「备注一下需要交作业」→ note 填「需要交作业」。\n' +
  '8. 同样，用户消息中出现的元数据（分组/分类说明）只在用户明确说"分到X组"/"分组是X"/"归类X"时识别为该日程的 category，不要把"日历分组是学校"或"归类到学校"等当成日程标题——这些是元数据描述，不应单独成为一条日程。\n' +
  '9. 完全无法理解或没有日程 → 输出 {"action":"add","events":[],"note_target":"","note_text":""}\n\n' +
  '特别说明：用户常用省略句式「日程XXX」「加个XXX」「记一下XXX」「安排XXX」「提醒XXX」「帮我加XXX」「来个XXX」——其中「日程/加个/记一下/安排/提醒/帮我加/来个」等是提示词，**title 字段只取 XXX 这部分，不要把提示词本身当成标题**（否则会出现 title="日程标题"这种错误）。'

const systemVision = (today, categories) =>
  '你是「日程助手」里的 AI 日程解析器。用户发来一张图片（可能是课程表、活动通知、聊天记录、手写便签、图书馆导览通知等），请识别其中所有的日程安排（日期 + 时间 + 事项）。如同时有用户补充文字，也一并参考。\n' +
  '今天日期：' + today + '（严格以此日期计算相对日期）\n\n' +
  '只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释文字：\n' +
  '{"events":[{"title":"日程标题","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","note":"","category":"分组名或空字符串"}]}\n\n' +
  '要求：\n' +
  '1. 【date 格式必须严格是 YYYY-MM-DD，如 2026-08-24。如果图片里是 "24 Aug 2026" 或 "2026年8月24日" 等格式，你必须转换为 2026-08-24。绝对不能原样输出英文或中文日期。】\n' +
  '2. startTime/endTime 用 24 小时制 HH:MM（不要带秒）\n' +
  '3. 没有给结束时间 → 默认开始后 1 小时；只有时间段没有日期 → 默认今天\n' +
  '4. 没有给具体时间 → 默认 09:00 开始，并在 note 里写「未指定时间，已默认安排」\n' +
  '5. 图片里有多条日程，全部提取\n' +
  '6. ' + catListText(categories) + '\n' +
  '7. 图片里没有明确日程 → 输出 {"events":[]}\n\n' +
  '【标题提取规则】title 字段只放事件的核心名称。括号/副标题里的举办方、机构名、地点等**不要放进 title**，要放进 note。例如：\n' +
  '- 图片写 "Job Seeking ... (Postgraduate Career Services)" → title="Job Seeking ..."，note 里放 "Postgraduate Career Services"\n' +
  '- 图片写 "Library Orientations & Tours" + Venue 信息 → title="Library Orientations & Tours"，note 里放地点和注册状态\n\n' +
  '【重要·备注字段·必须执行】图片中除核心日程（标题/日期/起止时间）以外的所有可见信息——特别是：地点 Venue/地点/地址、举办方/机构名、报名状态（已注册/已满/REGISTERED）、联系人、备注说明、网页链接、报名方式、注意事项、英文原文等——**必须全部合并写入 note 字段**，不得遗漏。\n' +
  '提取示例：\n' +
  '- 看到 "Venue: Libratorium-B, Library" 和 "地点: 图书馆-B" → note="地点: Libratorium-B, Library / 图书馆-B"\n' +
  '- 看到 "REGISTERED/已注册" → note 里必须包含 "状态: 已注册/REGISTERED"\n' +
  '- 看到 "(Postgraduate Career Services)" → note="举办方: Postgraduate Career Services"\n' +
  '多条日程时各自 note 只放各自相关的信息。'

const trimTime = (t) => {
  if (typeof t !== 'string') return t
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return t
  return m[1].padStart(2, '0') + ':' + m[2]
}

const extractResult = (text) => {
  let s = text.trim()
  // 处理 ```json ... ``` / ``` ... ``` 围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // 尝试解析为对象（含 events 字段）
  try {
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a >= 0 && b > a) {
      const parsed = JSON.parse(s.slice(a, b + 1))
      if (parsed && typeof parsed === 'object') {
        // 裸数组元素（有 title/date 但没有 events）→ 包成单条
        if (typeof parsed.title === 'string' && typeof parsed.date === 'string' && !Array.isArray(parsed.events)) {
          return { action: 'add', events: [parsed], noteTarget: '', noteText: '' }
        }
        return {
          action: parsed.action === 'update_note' ? 'update_note' : 'add',
          events: Array.isArray(parsed.events) ? parsed.events : [],
          noteTarget: typeof parsed.note_target === 'string' ? parsed.note_target : '',
          noteText: typeof parsed.note_text === 'string' ? parsed.note_text : '',
        }
      }
    }
  } catch {}
  // 尝试解析为裸数组
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
  // 最后兜底：单条事件对象 {title:..., date:..., ...} 包成数组
  try {
    const obj = JSON.parse(s)
    if (obj && typeof obj === 'object' && typeof obj.title === 'string') {
      return { action: 'add', events: [obj], noteTarget: '', noteText: '' }
    }
  } catch {}
  return null
}

const MONTH_MAP = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 把各种日期格式统一转成 YYYY-MM-DD */
const normalizeDate = (raw) => {
  if (typeof raw !== 'string') return ''
  const s = raw.trim()
  // 已经是标准格式
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // 2026年8月24日 / 2026年08月24日
  const cn = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/)
  if (cn) return `${cn[1]}-${pad2(cn[2])}-${pad2(cn[3])}`
  // 24 Aug 2026 / Aug 24, 2026 / 24 August 2026 / August 24 2026
  const en1 = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (en1) {
    const m = MONTH_MAP[en1[2].toLowerCase()]
    if (m) return `${en1[3]}-${pad2(m)}-${pad2(en1[1])}`
  }
  const en2 = s.match(/([A-Za-z]+)\s+(\d{1,2})[,\s]+(\d{4})/)
  if (en2) {
    const m = MONTH_MAP[en2[1].toLowerCase()]
    if (m) return `${en2[3]}-${pad2(m)}-${pad2(en2[2])}`
  }
  // 2026/8/24 或 2026.8.24
  const slash = s.match(/(\d{4})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{1,2})/)
  if (slash) return `${slash[1]}-${pad2(slash[2])}-${pad2(slash[3])}`
  // 8/24/2026（美式，假设年份是4位且≥2000）
  const us = s.match(/(\d{1,2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{4})/)
  if (us && Number(us[3]) >= 2000) return `${us[3]}-${pad2(us[1])}-${pad2(us[2])}`
  return ''
}

const sanitize = (events, categories = []) => {
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
        date: normalizeDate(e.date),
        startTime,
        endTime: trimTime(typeof e.endTime === 'string' ? e.endTime : '10:00'),
        note: cleanedNote,
        category,
      }
    })
    .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))
}

async function callLLM(env, { model, messages, maxTokens = 2048 }) {
  const key = env.ZHIPU_API_KEY || env.OPENAI_API_KEY
  if (!key) throw new Error('NO_KEY')
  const base = env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = JSON.stringify((await res.json()).error || {})
    } catch {}
    throw new Error('API_' + (res.status + ' ' + detail).slice(0, 200))
  }
  const data = await res.json()
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''
}

async function handleParse(request, env) {
  const body = await request.json().catch(() => ({}))
  const text = (body.text || '').trim()
  if (!text) return jsonResponse({ ok: false, reason: 'text 为空' }, 400)

  const categories = Array.isArray(body.categories) ? body.categories : []
  const existing = Array.isArray(body.existingEvents) ? body.existingEvents : []
  const model = env.LLM_MODEL || 'glm-4-flash'

  let content
  try {
    content = await callLLM(env, {
      model,
      messages: [
        { role: 'system', content: systemText(todayKey(), categories, existing) },
        { role: 'user', content: text },
      ],
    })
  } catch (err) {
    if (err.message === 'NO_KEY') {
      return jsonResponse({ ok: false, reason: 'NO_KEY', hint: '服务端未配置 LLM key' })
    }
    if (String(err.message).startsWith('API_')) {
      return jsonResponse({ ok: false, reason: 'LLM_API_ERROR', hint: err.message.slice(0, 200) })
    }
    return jsonResponse({ ok: false, reason: 'LLM_ERROR', hint: '请求 LLM 失败' })
  }

  const result = extractResult(content)
  if (!result) return jsonResponse({ ok: false, reason: 'LLM_PARSE_EMPTY' })
  if (result.action === 'update_note') {
    return jsonResponse({
      ok: !!(result.noteTarget && result.noteText),
      action: 'update_note',
      noteTarget: result.noteTarget,
      noteText: result.noteText,
      events: [],
      engine: model,
    })
  }
  const events = sanitize(result.events, categories)
  if (events.length === 0) {
    return jsonResponse({
      ok: false,
      reason: 'LLM_NO_EVENTS',
      hint: `模型未识别到有效日程。原始响应：${content.slice(0, 200)}`,
      engine: model,
    })
  }
  return jsonResponse({ ok: true, action: 'add', events, engine: model })
}

async function handleParseImage(request, env) {
  const body = await request.json().catch(() => ({}))
  const img = (body.imageBase64 || '').trim()
  if (!img) return jsonResponse({ ok: false, reason: 'imageBase64 为空' }, 400)
  const categories = Array.isArray(body.categories) ? body.categories : []
  const model = env.VISION_MODEL || 'glm-4v-flash'
  const userContent = [{ type: 'image_url', image_url: { url: img } }]
  if (body.text && String(body.text).trim()) {
    userContent.push({ type: 'text', text: String(body.text).trim() })
  }
  let content
  try {
    content = await callLLM(env, {
      model,
      messages: [
        { role: 'system', content: systemVision(todayKey(), categories) },
        { role: 'user', content: userContent },
      ],
      maxTokens: 1024, // 智谱 glm-4v-flash 限制 max_tokens ∈ [1,1024]
    })
  } catch (err) {
    if (err.message === 'NO_KEY') return jsonResponse({ ok: false, reason: 'NO_KEY' })
    if (String(err.message).startsWith('API_'))
      return jsonResponse({ ok: false, reason: 'LLM_API_ERROR', hint: err.message.slice(0, 200) })
    return jsonResponse({ ok: false, reason: 'LLM_ERROR', hint: String(err).slice(0, 200) })
  }
  // 视觉模型偶尔返回纯文本描述（非 JSON），这种情况下告诉用户换图重试
  if (!content.trim()) return jsonResponse({ ok: false, reason: 'LLM_EMPTY', hint: '模型无响应内容' })
  const result = extractResult(content)
  if (!result) {
    return jsonResponse({
      ok: false,
      reason: 'LLM_PARSE_EMPTY',
      hint: content.slice(0, 160), // 把原始响应片段给前端看
    })
  }
  const events = sanitize(result.events, categories)
  if (events.length === 0) {
    return jsonResponse({
      ok: false,
      reason: 'LLM_NO_EVENTS',
      hint: `模型未识别到有效日程。原始响应：${content.slice(0, 200)}`,
      engine: model,
    })
  }
  return jsonResponse({ ok: true, action: 'add', events, engine: model })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() })
    }
    if (url.pathname === '/api/parse' || url.pathname === '/api/parse-image') {
      if (request.method !== 'POST') return jsonResponse({ ok: false, reason: 'method' }, 405)
      try {
        return url.pathname === '/api/parse'
          ? await handleParse(request, env || {})
          : await handleParseImage(request, env || {})
      } catch (e) {
        return jsonResponse({ ok: false, reason: 'SERVER_ERROR', hint: String(e).slice(0, 200) }, 500)
      }
    }
    return new Response('Not Found', { status: 404, headers: corsHeaders() })
  },
}