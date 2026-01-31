#!/usr/bin/env bash
# Универсальный коммит и пуш: добавляет всё, коммитит с сообщением и пушит.
# Использование: ./scripts/push.sh "сообщение коммита"
# Или: bash scripts/push.sh "сообщение"

set -e
MSG="${1:-update}"
git add -A
git status
git commit -m "$MSG"
git push
