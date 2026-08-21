#!/bin/bash
# my schedule一键启动：Vite 前端 + LLM 后端
# 用法：终端执行  ./start.sh   （或双击在终端中打开）
cd "$(dirname "$0")"

echo "== 清理旧进程 =="
kill $(lsof -t -i :5173) 2>/dev/null && echo "已停止旧前端(5173)"
kill $(lsof -t -i :8787) 2>/dev/null && echo "已停止旧后端(8787)"
sleep 1

echo "== 启动 LLM 后端(8787) =="
nohup node server/llm-server.mjs > /tmp/llm-server.log 2>&1 &
sleep 1

echo "== 启动前端(5173) =="
nohup npx vite --host > /tmp/calendar-vite.log 2>&1 &
sleep 3

echo ""
echo "✅ 已启动！"
echo "  Mac 本机:   http://localhost:5173"
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -n "$LAN_IP" ]; then
  echo "  iPhone/iPad: http://$LAN_IP:5173   (需同一 WiFi)"
fi
echo ""
echo "日志：/tmp/calendar-vite.log  /tmp/llm-server.log"
