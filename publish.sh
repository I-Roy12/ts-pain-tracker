#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"

msg="${1:-update $(date '+%Y-%m-%d %H:%M')}"

git add -A

if git diff --cached --quiet; then
  echo "変更がないためコミットをスキップしました。"
  exit 0
fi

git commit -m "$msg"
git push

echo "公開用の push が完了しました。"
