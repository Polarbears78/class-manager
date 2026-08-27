#!/usr/bin/env bash
#
# setup.sh — 젯슨을 생기부 분석 서버로 만들고, 잘 되는지 확인까지 한 번에
#
#   sudo bash setup.sh                  점검하고 빠진 것을 설치·설정합니다
#   sudo bash setup.sh --check          아무것도 바꾸지 않고 점검만 합니다
#   sudo bash setup.sh --model gemma3:4b  모델까지 내려받습니다(수 GB, 시간 걸림)
#
# 하는 일
#   1) 한국어 OCR(tesseract-ocr, tesseract-ocr-kor) 설치
#   2) Ollama 를 교사 PC에서 부를 수 있게 설정 (OLLAMA_HOST·OLLAMA_ORIGINS)
#   3) OCR 서버를 부팅 때 자동으로 뜨게 등록 (systemd)
#   4) 방화벽에 11434·8404 열기 (ufw 를 쓰는 경우에만)
#   5) 확인하고, 콘솔에 넣을 주소를 알려 줍니다
#
# 이미 되어 있는 것은 건너뜁니다. 여러 번 실행해도 안전합니다.

set -uo pipefail

CHECK_ONLY=0
PULL_MODEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --model) PULL_MODEL="${2:-}"; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "모르는 옵션: $1"; exit 2 ;;
  esac
  shift
done

OCR_PORT=8404
OLLAMA_PORT=11434
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"

ok=0; warn=0; bad=0
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
pass() { printf '  ✅ %s\n' "$*"; ok=$((ok+1)); }
note() { printf '  ⚠️  %s\n' "$*"; warn=$((warn+1)); }
fail() { printf '  ❌ %s\n' "$*"; bad=$((bad+1)); }
step() { printf '  → %s\n' "$*"; }

if [ "$CHECK_ONLY" = 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "설치·설정을 하려면 sudo 가 필요합니다:  sudo bash $0"
  echo "점검만 하려면:  bash $0 --check"
  exit 1
fi

# ── 1. 한국어 OCR ──────────────────────────────────────────────
say "1. 한국어 OCR"
langs=$(tesseract --list-langs 2>/dev/null | tail -n +2 | tr -d ' \r')
if echo "$langs" | grep -qx kor; then
  pass "tesseract 한국어 자료 있음"
elif [ "$CHECK_ONLY" = 1 ]; then
  fail "tesseract 또는 한국어 자료 없음 — sudo apt install -y tesseract-ocr tesseract-ocr-kor"
else
  step "설치 중… (apt)"
  apt-get update -qq
  if apt-get install -y -qq tesseract-ocr tesseract-ocr-kor >/dev/null; then
    pass "tesseract 한국어 자료 설치함"
  else
    fail "설치 실패 — 인터넷 연결을 확인해 주세요"
  fi
fi

# ── 2. Ollama 를 밖에서 부를 수 있게 ───────────────────────────
say "2. 분석 모델 서버(Ollama)"
if ! command -v ollama >/dev/null 2>&1; then
  fail "Ollama 가 설치돼 있지 않습니다 — curl -fsSL https://ollama.com/install.sh | sh"
else
  pass "Ollama 설치됨"
  need_cfg=0
  env_now=$(systemctl show ollama -p Environment 2>/dev/null)
  echo "$env_now" | grep -q 'OLLAMA_HOST=0.0.0.0' || need_cfg=1
  echo "$env_now" | grep -q 'OLLAMA_ORIGINS='     || need_cfg=1

  if [ "$need_cfg" = 0 ]; then
    pass "교사 PC에서 부를 수 있게 설정돼 있음"
  elif [ "$CHECK_ONLY" = 1 ]; then
    fail "OLLAMA_HOST=0.0.0.0 / OLLAMA_ORIGINS=* 설정이 없습니다 (이대로면 젯슨 안에서만 됩니다)"
  else
    step "설정 추가 중…"
    mkdir -p /etc/systemd/system/ollama.service.d
    cat > /etc/systemd/system/ollama.service.d/override.conf <<EOF
[Service]
Environment="OLLAMA_HOST=0.0.0.0:${OLLAMA_PORT}"
Environment="OLLAMA_ORIGINS=*"
EOF
    systemctl daemon-reload
    systemctl restart ollama
    sleep 2
    pass "설정하고 다시 시작함"
  fi

  models=$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' | grep -v '^$')
  if [ -n "$PULL_MODEL" ] && [ "$CHECK_ONLY" = 0 ]; then
    step "모델 내려받는 중: $PULL_MODEL (수 GB — 시간이 걸립니다)"
    ollama pull "$PULL_MODEL" && models=$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}')
  fi
  if [ -n "$models" ]; then
    pass "설치된 모델: $(echo "$models" | tr '\n' ' ')"
  else
    note "설치된 모델이 없습니다 — 'sudo bash $0 --model gemma3:4b' 또는 'ollama pull gemma3:4b'"
  fi
fi

# ── 3. OCR 서버 자동 실행 등록 ─────────────────────────────────
say "3. OCR 서버"
if [ ! -f "$HERE/ocr-server.py" ]; then
  fail "$HERE/ocr-server.py 가 없습니다 — 저장소를 통째로 내려받았는지 확인해 주세요"
elif systemctl is-active --quiet saenggibu-ocr 2>/dev/null; then
  pass "OCR 서버가 돌고 있음"
elif [ "$CHECK_ONLY" = 1 ]; then
  fail "OCR 서버가 꺼져 있습니다"
else
  step "등록하고 켜는 중…"
  cat > /etc/systemd/system/saenggibu-ocr.service <<EOF
[Unit]
Description=생기부 OCR 서버
After=network.target

[Service]
ExecStart=/usr/bin/python3 ${HERE}/ocr-server.py --port ${OCR_PORT}
Restart=always
User=${RUN_USER}

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now saenggibu-ocr >/dev/null 2>&1
  sleep 2
  if systemctl is-active --quiet saenggibu-ocr 2>/dev/null; then
    pass "OCR 서버를 켜고 자동 실행으로 등록함"
  else
    fail "OCR 서버가 뜨지 않았습니다 — journalctl -u saenggibu-ocr -n 30"
  fi
fi

# ── 4. 방화벽 ──────────────────────────────────────────────────
say "4. 방화벽"
if ! command -v ufw >/dev/null 2>&1 || ! ufw status 2>/dev/null | grep -q '^Status: active'; then
  pass "ufw 를 쓰지 않음 — 따로 열 것 없음"
elif [ "$CHECK_ONLY" = 1 ]; then
  ufw status | grep -qE "^${OLLAMA_PORT}" && pass "${OLLAMA_PORT} 열림" || fail "${OLLAMA_PORT} 막힘"
  ufw status | grep -qE "^${OCR_PORT}"    && pass "${OCR_PORT} 열림"    || fail "${OCR_PORT} 막힘"
else
  ufw allow ${OLLAMA_PORT}/tcp >/dev/null 2>&1
  ufw allow ${OCR_PORT}/tcp    >/dev/null 2>&1
  pass "${OLLAMA_PORT}·${OCR_PORT} 열었음"
fi

# ── 5. 실제로 되는지 ───────────────────────────────────────────
say "5. 확인"
curl -fsS -m 5 "localhost:${OLLAMA_PORT}" >/dev/null 2>&1 \
  && pass "모델 서버 응답함" || fail "모델 서버가 응답하지 않음"

health=$(curl -fsS -m 10 "localhost:${OCR_PORT}/health" 2>/dev/null)
if echo "$health" | grep -q '"ok": *true'; then
  pass "OCR 서버 응답함 (한국어 준비됨)"
elif [ -n "$health" ]; then
  fail "OCR 서버는 떴지만 한국어 자료가 없습니다: $health"
else
  fail "OCR 서버가 응답하지 않음"
fi

if command -v ss >/dev/null 2>&1; then
  ss -tln 2>/dev/null | grep -q "0.0.0.0:${OLLAMA_PORT}\|\[::\]:${OLLAMA_PORT}" \
    && pass "밖에서 접속 가능한 상태로 열림" \
    || note "모델 서버가 127.0.0.1 로만 열려 있습니다 — 교사 PC에서 접속되지 않습니다"
fi

# ── 6. 콘솔에 넣을 주소 ────────────────────────────────────────
say "6. 콘솔에 넣을 주소"
if command -v ip >/dev/null 2>&1; then
  addrs=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
  addrs="$addrs
$(ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep '^192\.168\.55\.')"
else
  addrs=$(hostname -I 2>/dev/null | tr ' ' '\n')
fi
addrs=$(echo "$addrs" | grep -v '^$' | grep -v '^127\.' | sort -u)
usb=$(echo "$addrs" | grep '^192\.168\.55\.' | head -1)
lan=$(echo "$addrs" | grep -v '^192\.168\.55\.' | head -1)

if [ -n "$usb" ]; then
  printf '  USB-C 직결 (권장 — 학교 망과 무관하게 늘 같은 주소)\n'
  printf '    서버 주소 : \033[1mhttp://%s:%s\033[0m\n' "$usb" "$OLLAMA_PORT"
  printf '    OCR 주소  : 비워 두세요\n\n'
fi
if [ -n "$lan" ]; then
  printf '  교내망\n'
  printf '    서버 주소 : \033[1mhttp://%s:%s\033[0m\n' "$lan" "$OLLAMA_PORT"
  printf '    OCR 주소  : 비워 두세요\n'
  printf '    확인용    : http://%s:%s  ·  http://%s:%s/health\n\n' \
    "$lan" "$OLLAMA_PORT" "$lan" "$OCR_PORT"
fi
if [ -z "$usb$lan" ]; then
  note "주소를 찾지 못했습니다 — 랜선이나 USB-C 가 연결돼 있는지 확인해 주세요"
  printf '    확인:  hostname -I\n'
fi

printf '\n\033[1m정상 %d · 주의 %d · 문제 %d\033[0m\n' "$ok" "$warn" "$bad"
if [ "$bad" -gt 0 ] && [ "$CHECK_ONLY" = 1 ]; then
  printf '고치려면:  sudo bash %s\n' "$0"
fi
exit 0
