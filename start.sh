#!/bin/bash
cd "$(dirname "$0")"
npm install --silent
# делаем порт публичным, чтобы Telegram мог открыть апп
( sleep 10; gh codespace ports visibility 3000:public -c "$CODESPACE_NAME" ) &
echo "Ссылка для BotFather: https://${CODESPACE_NAME}-3000.app.github.dev"
exec node server.js
