// Supabase 云同步：账号（邮箱+密码）+ 数据存储（events/categories）
// 全部前端直连 Supabase（公网），手机 / 电脑在任何网络都能同步
import { createClient } from '@supabase/supabase-js'
import { hasCloudConfig, SB_CONFIG } from './cloud-config'
import type { CalendarEvent, Category } from './types'

let sb: ReturnType<typeof createClient> | null = null

export const cloudReady = () => hasCloudConfig()

function client() {
  if (!hasCloudConfig()) return null
  if (!sb) {
    sb = createClient(SB_CONFIG.url, SB_CONFIG.anonKey)
  }
  return sb
}

// ── 账号 ──────────────────────────────────────────────────

export async function cloudSignUp(email: string, password: string): Promise<void> {
  const c = client()
  if (!c) throw new Error('未配置云同步')
  const { error } = await c.auth.signUp({ email, password })
  if (error) throw new Error(zhError(error.message))
}

export async function cloudLogin(email: string, password: string): Promise<void> {
  const c = client()
  if (!c) throw new Error('未配置云同步')
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(zhError(error.message))
}

export function cloudLogout(): void {
  const c = client()
  if (c) void c.auth.signOut()
}

export async function cloudCurrentUserEmail(): Promise<string | null> {
  const c = client()
  if (!c) return null
  // 用 getSession 而非 getUser：getSession 从 localStorage 同步读，更可靠；
  // getUser 会触发异步 auth state 恢复，第一次调用可能拿不到
  const { data: { session } } = await c.auth.getSession()
  return session?.user?.email ?? null
}

// ── 数据同步 ──────────────────────────────────────────────

export interface CloudData {
  events: CalendarEvent[]
  categories: Category[]
  updatedAt: number // 毫秒时间戳（整库最后修改时间）
}

/** 拉取当前用户的云端数据；没有则返回 null；出错则抛出（供 UI 显示真实原因） */
export async function cloudLoadData(): Promise<CloudData | null> {
  const c = client()
  if (!c) return null
  const { data: { session } } = await c.auth.getSession()
  const uid = session?.user?.id
  if (!uid) return null
  try {
    const { data, error } = await (c.from('calendar_data') as any)
      .select('events, categories, updated_at')
      .eq('user_id', uid)
      .maybeSingle()
    if (error) throw new Error(error.message || '查询失败')
    if (!data) return null // 该用户还没有数据行
    return {
      events: Array.isArray(data.events) ? (data.events as CalendarEvent[]) : [],
      categories: Array.isArray(data.categories) ? (data.categories as Category[]) : [],
      updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : 0,
    }
  } catch (e) {
    // 透传真实错误，App 里会显示给用户
    throw e
  }
}

/** 推送当前用户的云端数据（整库覆盖） */
export async function cloudSaveData(data: CloudData): Promise<boolean> {
  const c = client()
  if (!c) return false
  const { data: { session } } = await c.auth.getSession()
  const uid = session?.user?.id
  if (!uid) return false
  try {
    const { error } = await (c.from('calendar_data') as any).upsert(
      {
        user_id: uid,
        events: data.events,
        categories: data.categories,
        updated_at: new Date(data.updatedAt).toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (error) throw new Error(error.message || 'upsert failed')
    return true
  } catch (e) {
    throw e
  }
}

/** 合并：按 id 去重；同 id 冲突取 updatedAt 较新的版本（无时间戳时取本地，兼容旧数据） */
export function mergeCloudData(
  local: { events: CalendarEvent[]; categories: Category[] },
  cloud: CloudData | null,
): { events: CalendarEvent[]; categories: Category[] } {
  if (!cloud) return { events: local.events, categories: local.categories }

  const cloudMap = new Map(cloud.events.map((e) => [e.id, e]))
  const mergedEvents: CalendarEvent[] = []
  const seen = new Set<string>()
  for (const le of local.events) {
    const ce = cloudMap.get(le.id)
    if (ce) {
      const leT = le.updatedAt ?? 0
      const ceT = ce.updatedAt ?? 0
      // 两者都有时间戳 → 取新者；都没有 → 取本地
      mergedEvents.push(leT >= ceT || (leT === 0 && ceT === 0) ? le : ce)
    } else {
      mergedEvents.push(le)
    }
    seen.add(le.id)
  }
  for (const ce of cloud.events) {
    if (!seen.has(ce.id)) {
      mergedEvents.push(ce)
      seen.add(ce.id)
    }
  }

  const cloudCatMap = new Map(cloud.categories.map((c) => [c.id, c]))
  const mergedCats: Category[] = []
  const catSeen = new Set<string>()
  for (const lc of local.categories) {
    mergedCats.push(lc) // 同 id 取本地（分组编辑频率低）
    catSeen.add(lc.id)
  }
  for (const cc of cloud.categories) {
    if (!catSeen.has(cc.id)) {
      mergedCats.push(cc)
      catSeen.add(cc.id)
    }
  }
  void cloudCatMap

  return { events: mergedEvents, categories: mergedCats }
}

// ── 工具 ──────────────────────────────────────────────────

function zhError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return '邮箱或密码不正确'
  if (/already registered/i.test(msg)) return '该邮箱已注册，请直接登录'
  if (/user already registered/i.test(msg)) return '该邮箱已注册，请直接登录'
  if (/password should be at least/i.test(msg)) return '密码至少 6 位'
  if (/network/i.test(msg)) return '网络连接失败，请检查网络后重试'
  if (/fetch/i.test(msg)) return '无法连接云服务（国内网络访问 Supabase 可能较慢，请稍候重试）'
  return msg
}
