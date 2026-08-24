# 🤖 젯슨 오린 나노에 분석 서버 만들기

[생기부 분석] 페이지가 사용할 **학교 안의 AI 서버**를 만드는 방법입니다.
생기부는 학교 밖으로 내보내면 안 되는 자료이므로, 분석은 교내망 안의 젯슨에서만 이루어집니다.

> 설치 전에 **학교 정보보안 담당자·정보부장님과 먼저 협의**해 주세요.
> 학교마다 망 정책과 개인정보 처리 지침이 다릅니다.

---

## 0. 준비물

| 항목 | 권장 |
|---|---|
| 보드 | Jetson Orin Nano **8GB** (4GB는 아주 작은 모델만 가능) |
| 저장장치 | NVMe SSD 128GB 이상 (microSD만 쓰면 모델 읽기가 느립니다) |
| 소프트웨어 | JetPack 6.x (Ubuntu 22.04 기반) |
| 네트워크 | 교내망 **유선** 연결 + 고정 IP |

젯슨의 IP는 아래로 확인합니다. 이 주소를 나중에 콘솔에 입력합니다.

```bash
hostname -I
```

---

## 1. Ollama 설치

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

설치가 끝나면 서비스가 자동으로 뜹니다.

```bash
systemctl status ollama
```

---

## 2. 교사 PC에서 접속할 수 있게 열어 주기

기본 설정의 Ollama는 **젯슨 자기 자신에서만** 접속됩니다.
교사 PC의 브라우저가 부를 수 있도록 두 가지를 바꿉니다.

```bash
sudo systemctl edit ollama
```

열린 편집기에 아래를 넣고 저장합니다.

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_ORIGINS=*"
```

- `OLLAMA_HOST` — 교내망의 다른 컴퓨터에서 접속 허용
- `OLLAMA_ORIGINS` — 브라우저의 교차 출처(CORS) 차단 해제. **이게 없으면 연결 테스트가 실패합니다.**

```bash
sudo systemctl restart ollama
sudo ufw allow 11434/tcp    # 방화벽을 쓰는 경우
```

교사 PC에서 아래가 응답하면 성공입니다.

```bash
curl http://<젯슨IP>:11434/api/tags
```

> ⚠️ 젯슨을 **인터넷에 직접 노출하지 마세요.** 공유기 포트포워딩·DMZ 설정을 하지 않아야 합니다.
> 교내망 안에서만 접속되도록 두는 것이 안전합니다.

---

## 3. 모델 내려받기

Orin Nano 8GB는 CPU와 GPU가 메모리를 나눠 쓰므로, **4B급(4bit 양자화)** 부터 시작하시길 권합니다.

```bash
ollama pull exaone3.5:2.4b        # 가볍고 한국어에 강함 (LG AI연구원)
ollama pull gemma3:4b             # 속도·품질 균형
ollama pull qwen2.5:7b            # 더 자세한 글. 8GB에서는 빠듯하고 느립니다
```

- 모델 이름은 바뀔 수 있습니다. 실제로 받을 수 있는 이름은 [ollama.com/library](https://ollama.com/library)에서 확인하세요.
- 받은 목록은 `ollama list` 로 볼 수 있습니다.
- **먼저 작은 모델로 시작해 보고**, 답변이 아쉬우면 큰 모델로 올리는 순서를 권합니다.
  생기부 상담 자료 한 건에 4B급은 40초~1분, 7B급은 2~4분 정도 걸립니다(영역을 몇 개 넣느냐에 따라 다릅니다).

성능을 최대로 쓰려면:

```bash
sudo nvpmodel -m 0    # MAXN 모드
sudo jetson_clocks
```

---

## 4. 콘솔 연결하기

교사 PC 브라우저에서 콘솔을 열고 **[생기부 분석] → 1️⃣ 분석 서버 연결**에서

1. **서버 주소**에 `http://<젯슨IP>:11434` 입력
2. **↻ 목록** 을 눌러 설치된 모델을 불러오고 하나 선택
3. **🔌 연결 테스트** — “사용 준비 완료”가 뜨면 끝입니다

---

## 5. (권장) 콘솔을 젯슨에서 함께 제공하기

`https://` 주소(깃허브 페이지즈 등)로 콘솔을 열면 브라우저가 `http://` 젯슨 호출을 **차단**합니다(혼합 콘텐츠).
젯슨이 콘솔 파일까지 같이 내보내면 이 문제도, CORS 문제도 한 번에 사라집니다.

```bash
sudo apt install -y nginx
sudo mkdir -p /var/www/class-manager
# 저장소 파일을 젯슨으로 복사 (교사 PC에서 실행)
#   scp -r ./* <계정>@<젯슨IP>:/tmp/class-manager/
sudo cp -r /tmp/class-manager/* /var/www/class-manager/
```

`/etc/nginx/sites-available/class-manager` 를 만들고:

```nginx
server {
  listen 8080;
  root /var/www/class-manager;
  index index.html;

  # 모델 서버를 같은 주소로 넘겨준다 → 브라우저 CORS·혼합 콘텐츠 문제 없음
  location ~ ^/(v1|api)/ {
    proxy_pass http://127.0.0.1:11434;
    proxy_buffering off;          # 스트리밍(글자가 차례로 나오는 것)에 필요
    proxy_read_timeout 600s;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/class-manager /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow 8080/tcp
```

이제 교사 PC에서 `http://<젯슨IP>:8080/` 으로 콘솔을 열고,
**서버 주소에도 똑같이 `http://<젯슨IP>:8080`** 을 넣으면 됩니다.

---

## 5-2. 생기부를 읽으려면 OCR 서버가 필요합니다

나이스 생기부는 위·변조를 막으려고 **글자를 모두 그림으로 찍어 냅니다.**
한글(.hwp)로 받든 PDF로 받든 파일 안에 글자가 한 자도 없습니다.
그래서 그림을 글자로 바꿔 줄 작은 서버를 젯슨에 하나 더 띄웁니다.
모델 서버(11434)와는 **별개**이고 포트도 다릅니다(**8404**).

```bash
sudo apt update
sudo apt install -y tesseract-ocr tesseract-ocr-kor
tesseract --list-langs          # 목록에 kor 이 보여야 합니다
```

저장소 파일을 젯슨에 두고 실행합니다.

```bash
python3 ~/class-manager/jetson/ocr-server.py
```

`OCR 서버 시작: http://0.0.0.0:8404` 이 뜨면 됩니다.
교사 PC 브라우저에서 `http://<젯슨IP>:8404/health` 를 열어
`{"ok":true …}` 가 보이면 연결까지 확인된 것입니다.

늘 켜져 있게 하려면:

```bash
sudo tee /etc/systemd/system/saenggibu-ocr.service >/dev/null <<EOF
[Unit]
Description=생기부 OCR 서버
After=network.target
[Service]
ExecStart=/usr/bin/python3 $HOME/class-manager/jetson/ocr-server.py
Restart=always
User=$USER
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now saenggibu-ocr
```

방화벽을 쓰신다면 `sudo ufw allow 8404/tcp` 도 함께 실행하세요.
콘솔에서는 [생기부 분석] → **고급 설정 → OCR 서버 주소**에 넣습니다.
비워 두면 모델 서버와 같은 기기의 8404번으로 알아서 찾아갑니다.

### 알아 두실 점

| | |
|---|---|
| 정확도 | **95% 안팎** — 스무 자에 한 자쯤 틀립니다(`통제`→`동제` 같은 혼동). 뜻을 파악하고 상담 자료를 만들기에는 충분하지만 **원문 그대로 인용할 수준은 아닙니다.** 콘솔이 읽어 낸 글을 확인 칸에 담아 주니 고친 뒤 쓰세요 |
| 걸리는 시간 | 학생 한 명당 **2~4분** (글줄 그림 40~50장). 한 번만 읽으면 되고 진행 막대로 어디쯤인지 보입니다 |
| 성적·출결 | 표 칸은 낱글자 그림이라 OCR에 보내지 않습니다. **[성적] 페이지에 입력한 값**을 씁니다 |
| 개인정보 | 받은 그림은 메모리에만 두고 디스크에 남기지 않으며, 접속 기록에도 생기부 내용이 남지 않습니다 |

---

## 6. 인터넷이 없는 교실에서 PDF 열기

생기부 PDF를 읽는 도구(pdf.js)는 기본적으로 인터넷에서 받아 옵니다.
인터넷이 막힌 망이라면 파일을 미리 받아 콘솔 폴더 안 `vendor/` 에 넣어 두세요. 콘솔이 자동으로 찾아 씁니다.

```bash
mkdir -p /var/www/class-manager/vendor
cd /var/www/class-manager/vendor
curl -O https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
curl -O https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js
```

넣지 않아도 **붙여넣기**로는 언제나 사용할 수 있습니다.

---

## 7. 잘 안 될 때

| 증상 | 확인할 것 |
|---|---|
| “서버에 연결하지 못했습니다” | 젯슨 전원·`systemctl status ollama`·IP와 포트·방화벽(`ufw allow 11434/tcp`) |
| 목록은 되는데 브라우저에서만 실패 | `OLLAMA_ORIGINS=*` 설정 후 `systemctl restart ollama` 했는지 |
| “HTTPS 주소로 연 페이지에서는…” 경고 | 5번처럼 젯슨에서 콘솔을 제공하거나, 파일을 내려받아 여세요 |
| “설치된 모델이 없습니다” | `ollama pull <모델이름>` 을 먼저 실행 |
| “OCR 서버는 젯슨에서 … 따로 켜야 합니다” | 5-2번의 `ocr-server.py` 를 실행했는지 · `systemctl status saenggibu-ocr` |
| “젯슨에 한국어 OCR 자료가 없습니다” | `sudo apt install -y tesseract-ocr-kor` 후 서버 다시 시작 |
| 읽어 낸 글자가 많이 틀린다 | 나이스에서 **가장 큰 크기**로 내려받아 다시 시도해 보세요. 글씨가 작을수록 정확도가 떨어집니다 |
| 응답이 너무 느리다 | 더 작은 모델로 바꾸기 · 넣는 생기부 영역 줄이기 · `nvpmodel -m 0` |
| 중간에 끊긴다 | 고급 설정의 **응답 대기 시간**을 늘리기(예: 300초) |
| 답변이 엉뚱하다 | 4B 미만 모델은 긴 글 요약에 약합니다. 영역을 3~4개로 줄이거나 모델을 키워 보세요 |

---

## 8. 꼭 기억할 것

- 젯슨은 **교내망 안에서만** 접속되게 두세요. 인터넷에 열지 않습니다(11434·8404 둘 다).
- 생기부 원문은 콘솔에 저장되지 않지만, **젯슨 로그**에는 남을 수 있습니다.
  운영 중에는 로그를 주기적으로 확인·정리해 주세요 (`journalctl --vacuum-time=7d`).
- AI가 만든 글은 **초안**입니다. 사실 관계와 표현을 담임 선생님이 반드시 확인한 뒤 사용해 주세요.
