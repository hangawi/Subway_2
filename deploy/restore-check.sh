#!/usr/bin/env bash
# 써브웨이 백업 시험 복원 (10/19). 가장 최근 백업(또는 인자로 준 파일)을 **새 빈 폴더**에 풀어 확인만 한다.
# SOPHIA sqlite-snapshot.py 원칙과 같음: 운영 폴더에 바로 되돌려 넣지 않는다.
# 실제로 되돌릴 때 (사람이 판단한 뒤): 컨테이너를 멈추고 → 풀린 var 를 data/var 로 바꾸고 → 다시 띄운다 (docs 안내 참고)
set -euo pipefail
BASE="${SUBWAY_BASE:-/srv/metasolveai/apps/subway/production}"
file="${1:-$(ls -t "$BASE"/backups/subway-var-*.tar.gz 2>/dev/null | head -1)}"
[ -n "$file" ] && [ -f "$file" ] || { echo "백업 파일 없음"; exit 1; }
want="$(cat "$file.sha256" 2>/dev/null || true)"
got="$(sha256sum "$file" | awk '{print $1}')"
[ -z "$want" ] || [ "$want" = "$got" ] || { echo "체크섬 다름: $file"; exit 1; }
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
tar -xzf "$file" -C "$dir"
[ -d "$dir/var" ] || { echo "var 폴더가 없음"; exit 1; }
n=0
# 하루 사용량 기록(JSON)이 모두 읽히는지
while IFS= read -r -d '' f; do
  case "$f" in *.json) node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" 2>/dev/null || python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$f" 2>/dev/null || { echo "읽을 수 없음: $f"; exit 1; } ;; esac
  n=$((n + 1))
done < <(find "$dir/var" -type f -print0)
if [ -n "$want" ]; then sum="일치"; else sum="없음"; fi
echo "시험 복원 성공: $(basename "$file") → 파일 ${n}개, 체크섬 ${sum}"
