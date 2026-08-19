// Cloudflare Pages Function: POST /api/parse-image （图片 → LLM 视觉日程解析）
import {
  corsHeaders,
  json,
  todayKey,
  resolveModels,
  callLLM,
  systemVisionPrompt,
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
    const img = (body.imageBase64 || '').trim()
    if (!img) return json({ ok: false, reason: 'imageBase64 为空' }, 400)

    const categories = Array.isArray(body.categories) ? body.categories : []
    const { visionModel } = resolveModels(env)

    const userContent = [{ type: 'image_url', image_url: { url: img } }]
    if (body.text && String(body.text).trim()) {
      userContent.push({ type: 'text', text: String(body.text).trim() })
    }

    let content
    try {
      content = await callLLM(env, {
        model: visionModel,
        messages: [
          { role: 'system', content: systemVisionPrompt(todayKey(), categories) },
          { role: 'user', content: userContent },
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
    const events = sanitize(result.events, categories)
    return json({ ok: events.length > 0, action: 'add', events, engine: visionModel })
  } catch (e) {
    return json({ ok: false, reason: 'SERVER_ERROR', hint: String(e).slice(0, 200) }, 500)
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() })
}
