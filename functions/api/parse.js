// Cloudflare Pages Function: POST /api/parse （文本 → LLM 日程解析）
import {
  corsHeaders,
  json,
  todayKey,
  resolveModels,
  callLLM,
  systemTextPrompt,
  extractResult,
  sanitize,
} from '../_lib.js'

export async function onRequestPost(context) {
  const { request, env } = context
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }
  try {
    const body = await request.json().catch(() => ({}))
    const text = (body.text || '').trim()
    if (!text) return json({ ok: false, reason: 'text 为空' }, 400)

    const categories = Array.isArray(body.categories) ? body.categories : []
    const existing = Array.isArray(body.existingEvents) ? body.existingEvents : []
    const { textModel } = resolveModels(env)

    let content
    try {
      content = await callLLM(env, {
        model: textModel,
        messages: [
          { role: 'system', content: systemTextPrompt(todayKey(), categories, existing) },
          { role: 'user', content: text },
        ],
      })
    } catch (err) {
      if (err.message === 'NO_KEY') {
        return json({ ok: false, reason: 'NO_KEY', hint: 'LLM key 未配置：请在 Cloudflare Pages 设置中添加 ZHIPU_API_KEY' })
      }
      if (String(err.message).startsWith('API_')) {
        return json({ ok: false, reason: 'LLM_API_ERROR', hint: err.message.slice(0, 200) })
      }
      return json({ ok: false, reason: 'LLM_TIMEOUT', hint: '请求 LLM 失败或超时' })
    }

    const result = extractResult(content)
    if (!result) {
      return json({ ok: false, reason: 'LLM_PARSE_EMPTY', hint: '模型输出无法解析' })
    }
    if (result.action === 'update_note') {
      return json({
        ok: !!(result.noteTarget && result.noteText),
        action: 'update_note',
        noteTarget: result.noteTarget,
        noteText: result.noteText,
        events: [],
        engine: textModel,
      })
    }
    const events = sanitize(result.events, categories)
    return json({ ok: events.length > 0, action: 'add', events, engine: textModel })
  } catch (e) {
    return json({ ok: false, reason: 'SERVER_ERROR', hint: String(e).slice(0, 200) }, 500)
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() })
}
