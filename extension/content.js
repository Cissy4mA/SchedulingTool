// VoiceAnywhere content script
// 在所有网页右下角注入浮动麦克风按钮，点击开始/停止语音识别，识别完成后把文字注入到当前聚焦的输入框。

(function () {
  'use strict'
  if (window.__voiceAnywhereInjected) return
  window.__voiceAnywhereInjected = true

  const HOST_ID = 'voice-anywhere-host'

  function buildButton() {
    if (document.getElementById(HOST_ID)) return
    const host = document.createElement('div')
    host.id = HOST_ID
    // Shadow DOM 隔离样式，避免与宿主页面冲突
    const shadow = host.attachShadow({ mode: 'open' })

    // 读取外部 css（通过 link 加载，避免内联）
    const cssLink = document.createElement('link')
    cssLink.rel = 'stylesheet'
    cssLink.href = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
      ? chrome.runtime.getURL('content.css')
      : 'content.css'

    const wrap = document.createElement('div')
    wrap.innerHTML = `
      <button class="va-btn" title="点击开始/停止语音输入" aria-label="语音输入">🎙</button>
      <div class="va-tip" id="va-tip">点击开始语音输入</div>
    `

    shadow.appendChild(cssLink)
    shadow.appendChild(wrap)

    document.documentElement.appendChild(host)

    const btn = shadow.querySelector('.va-btn')
    const tip = shadow.getElementById('va-tip')

    let rec = null
    let tipTimer = null

    function showTip(text, isError) {
      tip.textContent = text
      tip.classList.toggle('error', !!isError)
      tip.classList.add('show')
      if (tipTimer) clearTimeout(tipTimer)
      tipTimer = setTimeout(() => tip.classList.remove('show'), 2400)
    }

    function injectText(text) {
      const el = document.activeElement
      if (!el || el === document.body) {
        showTip('请先把光标放到输入框里', true)
        return
      }
      // <input> / <textarea>
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const start = el.selectionStart ?? el.value.length
        const end = el.selectionEnd ?? el.value.length
        const before = el.value.slice(0, start)
        const after = el.value.slice(end)
        el.value = before + text + after
        const pos = start + text.length
        el.selectionStart = el.selectionEnd = pos
        // 触发框架监听（React/Vue 的 onChange）
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return
      }
      // contenteditable（富文本编辑器）
      if (el.isContentEditable) {
        const ok = document.execCommand && document.execCommand('insertText', false, text)
        if (ok) return
      }
      showTip('当前输入框不支持注入文字', true)
    }

    function startListen() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SR) {
        showTip('当前浏览器不支持网页语音（建议用 Chrome / Edge）', true)
        return
      }
      rec = new SR()
      rec.lang = 'zh-CN'
      rec.continuous = false
      rec.interimResults = false
      let finalText = ''
      let got = false

      rec.onresult = (e) => {
        got = true
        for (let i = 0; i < e.results.length; i++) {
          finalText += e.results[i][0].transcript
        }
      }
      rec.onend = () => {
        stopUI()
        if (finalText.trim()) {
          injectText(finalText.trim())
          showTip('已填入 ✓')
        } else if (!got) {
          showTip('没有听到声音，靠近麦克风再试', true)
        }
      }
      rec.onerror = (e) => {
        stopUI()
        const code = (e && e.error) || ''
        const msg =
          code === 'not-allowed' || code === 'service-not-allowed'
            ? '麦克风权限被拒绝，请在浏览器设置中允许'
            : code === 'network'
              ? '识别服务连不上网络，检查后重试'
              : `识别出错（${code || '未知'}）`
        showTip(msg, true)
      }

      try {
        rec.start()
        btn.classList.add('listening')
        btn.textContent = '⏹'
        showTip('🎙 正在聆听…点击停止')
      } catch (e) {
        stopUI()
        showTip('启动识别失败：' + e.message, true)
      }
    }

    function stopUI() {
      if (rec) {
        try { rec.stop() } catch {}
        rec = null
      }
      btn.classList.remove('listening')
      btn.textContent = '🎙'
    }

    btn.addEventListener('click', () => {
      if (rec) {
        stopUI()
      } else {
        startListen()
      }
    })
  }

  function ensureInjected() {
    if (!document.documentElement) return
    if (document.getElementById(HOST_ID)) return
    buildButton()
  }

  // 初次注入
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureInjected, { once: true })
  } else {
    ensureInjected()
  }

  // SPA 路由切换时重新注入
  let lastHref = location.href
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href
      setTimeout(ensureInjected, 300)
    }
  }, 800)
})()