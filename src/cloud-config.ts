// Supabase 云同步配置
// 1. 打开 https://supabase.com 注册（邮箱+密码，无需实名）
// 2. 创建项目 → 区域选 Singapore（亚太，访问快）
// 3. 项目 → 左侧 Settings → API：
//    - Project URL        → 填到 url
//    - anon public key    → 填到 anonKey
// 4. 在 SQL Editor 执行建表 SQL（见下方说明或问助手）
// 5. 填好后刷新页面即可注册/登录同步
export const SB_CONFIG = {
  url: 'https://frwwdmyuwivegynqgsdh.supabase.co',
  anonKey: 'sb_publishable_IsO8-rgxAbCUjLClrpUjOQ_nNgQ_aFA',
}

export const hasCloudConfig = () => Boolean(SB_CONFIG.url && SB_CONFIG.anonKey)
