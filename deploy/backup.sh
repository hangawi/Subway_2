#!/usr/bin/env bash
# 써브웨이 백업 (10/19, 로드맵 49번). sophia-core-01 에서 dev 계정 crontab 으로 매일 한 번.
#   5 4 * * * bash /srv/metasolveai/apps/subway/production/app/deploy/backup.sh >> /srv/metasolveai/apps/subway/production/backups/backup.log 2>&1
# - 써브웨이가 서버에 두는 것은 data/var (외부 API 하루 사용량 기록) 하나뿐 — 개인 기록은 휴대폰에만 있어 서버 백업에 없음
# - SOPHIA 백업(DB·NAS)과 섞지 않는다: 써브웨이 폴더 안 backups/ 에만 쓴다
# - 키(secrets/)는 백업하지 않는다 (복사본이 늘면 새는 곳이 는다). 앱 코드는 Git + 이미지 subway-app:prev 로 되돌린다
# - 보관: 14일 (BACKUP_KEEP_DAYS)
# 시험 복원: deploy/restore-check.sh (새 빈 폴더에 풀어 확인만 — 운영 폴더에 덮어쓰지 않음)
set -euo pipefail
BASE="${SUBWAY_BASE:-/srv/metasolveai/apps/subway/production}"
SRC="$BASE/data/var"
DEST="$BASE/backups"
KEEP="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$DEST"
chmod 700 "$DEST"
[ -d "$SRC" ] || { echo "$(date -Is) 백업할 폴더 없음: $SRC"; exit 1; }
stamp="$(date +%Y%m%d-%H%M%S)"
out="$DEST/subway-var-$stamp.tar.gz"
tmp="$out.part"
tar -czf "$tmp" -C "$(dirname "$SRC")" "$(basename "$SRC")"
# 만든 파일이 제대로 풀리는지 바로 확인
tar -tzf "$tmp" >/dev/null
mv "$tmp" "$out"
chmod 600 "$out"
sha256sum "$out" | awk '{print $1}' > "$out.sha256"
# 오래된 것 지우기 (써브웨이 백업 이름만)
find "$DEST" -maxdepth 1 -type f \( -name 'subway-var-*.tar.gz' -o -name 'subway-var-*.tar.gz.sha256' \) -mtime +"$KEEP" -delete
echo "$(date -Is) 백업 완료 $(basename "$out") $(stat -c %s "$out")B, 보관 $(ls "$DEST"/subway-var-*.tar.gz | wc -l)개"
