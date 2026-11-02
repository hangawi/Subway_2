#!/usr/bin/env bash
# 써브웨이 배포 (sophia-core-01 안에서). GitHub Actions(.github/workflows/deploy.yml)도 이 순서를 그대로 쓴다.
# 수동: 이 컴퓨터에서 git -c core.autocrlf=false archive 로 소스를 올린 뒤 서버에서
#   SUBWAY_BUILD_COMMIT=<커밋> bash /srv/metasolveai/apps/subway/production/app/deploy/deploy.sh
# 하는 일: 지금 이미지를 subway-app:prev 로 표시(되돌리기) → 새로 만들기(검사·시험 포함) → 띄우기 → /health·/version.json 확인
#          → SOPHIA /health 가 그대로 200인지 확인. 실패하면 prev 로 되돌린다.
set -euo pipefail
APP=/srv/metasolveai/apps/subway/production/app
cd "$APP/deploy"
export SUBWAY_BUILD_COMMIT="${SUBWAY_BUILD_COMMIT:-UNCOMMITTED}"
export SUBWAY_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

current=$(docker inspect --format='{{.Image}}' subway-prod 2>/dev/null || true)
if [ -n "$current" ]; then docker tag "$current" subway-app:prev && echo "되돌리기 지점: $current → subway-app:prev"; fi

docker compose build
docker compose up -d

ok=0
for i in $(seq 1 12); do
  sleep 3
  if body=$(curl -fsS http://127.0.0.1:4174/version.json 2>/dev/null) && echo "$body" | grep -q "\"commit\":\"$SUBWAY_BUILD_COMMIT\"" && curl -fsS http://127.0.0.1:4174/health >/dev/null; then ok=1; break; fi
  echo "확인 $i/12 기다리는 중"
done
if [ "$ok" != 1 ]; then
  echo "새 버전 확인 실패 → 되돌림"
  if docker image inspect subway-app:prev >/dev/null 2>&1; then docker tag subway-app:prev subway-app:latest && docker compose up -d --no-build; fi
  exit 1
fi
echo "써브웨이 배포 확인: $body"

sophia=$(curl -s -o /dev/null -w '%{http_code}' https://sophia.metasolveai.com/health || true)
echo "SOPHIA /health: $sophia"
[ "$sophia" = 200 ] || { echo "경고: SOPHIA /health 가 200이 아님 — 써브웨이 배포와 관계있는지 확인"; exit 2; }
