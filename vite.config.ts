import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // 把 /api 转发到本地 LLM 代理（手机通过局域网 IP 访问时同样生效）
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
