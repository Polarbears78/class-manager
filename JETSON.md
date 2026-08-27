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

## 1. 한 번에 설치하기 (권장)

명령을 하나씩 따라 하기 어려우시면, 저장소를 젯슨에 내려받아 이것만 실행하세요.
**설치·설정·확인을 한 번에 하고, 콘솔에 넣을 주소까지 알려 줍니다.**

```bash
sudo apt install -y git
git clone -b claude/saenggibu-analysis-counseling-uwuq8j \
  https://github.com/Polarbears78/class-manager.git ~/class-manager
sudo bash ~/class-manager/jetson/setup.sh
```

| 명령 | 하는 일 |
|---|---|
| `sudo bash setup.sh` | 빠진 것을 설치·설정하고 확인 |
| `bash setup.sh --check` | **아무것도 바꾸지 않고** 점검만 (sudo 불필요) |
| `sudo bash setup.sh --model gemma3:4b` | 모델까지 내려받기 (수 GB, 시간 걸림) |

이미 되어 있는 것은 건너뛰므로 **여러 번 실행해도 안전합니다.**
마지막에 `정상 N · 주의 N · 문제 N` 과 콘솔에 넣을 주소가 나옵니다.
문제가 남으면 그 출력을 그대로 전달해 주시면 됩니다.

Ollama 만 아직 없다면 이 한 줄을 먼저 실행하세요.

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

아래 2번부터는 `setup.sh` 가 하는 일을 손으로 하는 방법입니다.
스크립트를 쓰셨다면 **3번(모델 내려받기)으로 건너뛰셔도 됩니다.**

---

## 2. Ollama 설치

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

설치가 끝나면 서비스가 자동으로 뜹니다.

```bash
systemctl status ollama
```

---

## 2-1. 교사 PC에서 접속할 수 있게 열어 주기

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

### 7.1 한 번에 진단하기

저장소를 젯슨에 내려받아 두셨다면 이 한 줄이 가장 빠릅니다.

```bash
bash ~/class-manager/jetson/setup.sh --check
```

아무것도 바꾸지 않고 점검만 하며, 무엇이 문제인지와 고치는 명령까지 알려 줍니다.
저장소 없이 확인만 하시려면 아래를 **통째로 붙여넣으세요.**

```bash
{
echo "== 주소 =="
ip -4 addr show | grep -oP 'inet \K[\d./]+'
echo "== 서비스 =="
systemctl is-active ollama saenggibu-ocr 2>&1
echo "== 열린 포트 =="
ss -tln | grep -E '11434|8404' || echo "열린 포트 없음"
echo "== OCR 언어 =="
tesseract --list-langs 2>&1 | tr '\n' ' '
echo
echo "== 설치된 모델 =="
ollama list 2>&1 | head -5
echo "== 자체 확인 =="
curl -s -m 5 localhost:11434 || echo "ollama 응답 없음"
echo
curl -s -m 5 localhost:8404/health || echo "OCR 응답 없음"
} 2>&1
```

읽는 법:

| 나온 것 | 정상 | 아니면 |
|---|---|---|
| **주소** | 유선 `10.x.x.x` · USB-C `192.168.55.1` | 와이파이라면 주소가 바뀌었을 수 있습니다 → 7.2 |
| **서비스** | `active` 두 줄 | `inactive` → `sudo systemctl restart ollama` (또는 `saenggibu-ocr`) |
| **열린 포트** | `0.0.0.0:11434` · `0.0.0.0:8404` | `127.0.0.1:11434` → 2-1번의 `OLLAMA_HOST=0.0.0.0` 누락 (`setup.sh` 가 고쳐 줍니다) |
| **OCR 언어** | 목록에 `kor` | 없으면 `sudo apt install -y tesseract-ocr-kor` |
| **설치된 모델** | 쓸 모델 이름 | 비었으면 `ollama pull <모델>` |
| **자체 확인** | `Ollama is running` · `{"ok":true…}` | 안 나오면 젯슨 자체 문제 — 위 두 줄부터 |

젯슨 자체는 정상인데 교사 PC에서만 안 되면 **네트워크 문제**입니다 → 7.2.

### 7.2 젯슨은 멀쩡한데 PC에서 안 보일 때

교사 PC에서 `ping <젯슨IP>` 를 해 봅니다.

| 결과 | 원인과 조치 |
|---|---|
| 응답 옴 | 방화벽 → `sudo ufw allow 11434/tcp && sudo ufw allow 8404/tcp` |
| 응답 없음 | 아래 세 가지 중 하나입니다 ↓ |

**가. 주소가 바뀌었다 (와이파이일 때 가장 흔함).**
와이파이는 DHCP라 재부팅하면 주소가 달라집니다. 7.1의 `주소` 값으로 콘솔 설정을 고쳐 보세요.
근본 해결은 고정 IP입니다(정보부에 주소를 먼저 확인받으세요).

```bash
nmcli connection show                       # 연결 이름 확인
nmcli connection modify "<연결이름>" \
  ipv4.method manual ipv4.addresses <젯슨IP>/24 \
  ipv4.gateway <공유기IP> ipv4.dns 168.126.63.1
nmcli connection up "<연결이름>"
```

**나. PC와 젯슨이 서로 다른 대역이다.**
PC 주소(`ipconfig`)와 젯슨 주소의 **앞 세 자리를 비교**하세요.
`10.23.65.x` 와 `10.24.65.x` 처럼 다르면 서로 다른 망이고, 그 사이는 보통 막혀 있습니다.
정보부에 통신 허용을 요청해야 합니다(양식은 8번).

**다. 무선 단말 간 통신 차단(AP isolation).**
학교 와이파이는 이 기능이 켜져 있는 경우가 많습니다. 인터넷은 되는데 젯슨만 안 보이면 대개 이것이며,
젯슨에서는 손댈 수 없고 **네트워크 장비 설정**이라 정보부에 해제를 요청해야 합니다.

> 연결이 됐다 끊겼다 한다면 와이파이 절전 기능을 끄세요.
> ```bash
> echo -e "[connection]\nwifi.powersave = 2" | \
>   sudo tee /etc/NetworkManager/conf.d/wifi-powersave-off.conf
> sudo systemctl restart NetworkManager
> ```

**막히면 USB-C 직결이 가장 빠릅니다.** 젯슨 개발키트를 USB-C로 교사 PC에 꽂으면
학교 망과 무관한 전용 통로(`192.168.55.1`)가 생깁니다. 망 정책·주소 변경에 영향받지 않고
주소가 늘 같으며, 자료가 학교 네트워크를 지나가지도 않습니다.

### 7.3 증상별 대조표

| 증상 | 확인할 것 |
|---|---|
| “서버에 연결하지 못했습니다” | 젯슨 전원·`systemctl status ollama`·IP와 포트·방화벽(`ufw allow 11434/tcp`) |
| 목록은 되는데 브라우저에서만 실패 | `OLLAMA_ORIGINS=*` 설정 후 `systemctl restart ollama` 했는지 (`setup.sh` 가 대신 해 줍니다) |
| “HTTPS 주소로 연 페이지에서는…” 경고 | 5번처럼 젯슨에서 콘솔을 제공하거나, 파일을 내려받아 여세요 |
| “설치된 모델이 없습니다” | `ollama pull <모델이름>` 을 먼저 실행 |
| “OCR 서버는 젯슨에서 … 따로 켜야 합니다” | 5-2번의 `ocr-server.py` 를 실행했는지 · `systemctl status saenggibu-ocr` |
| “젯슨에 한국어 OCR 자료가 없습니다” | `sudo apt install -y tesseract-ocr-kor` 후 서버 다시 시작 |
| 읽어 낸 글자가 많이 틀린다 | 나이스에서 **가장 큰 크기**로 내려받아 다시 시도해 보세요. 글씨가 작을수록 정확도가 떨어집니다 |
| 응답이 너무 느리다 | 더 작은 모델로 바꾸기 · 넣는 생기부 영역 줄이기 · `nvpmodel -m 0` |
| 중간에 끊긴다 | 고급 설정의 **응답 대기 시간**을 늘리기(예: 300초) |
| 답변이 엉뚱하다 | 4B 미만 모델은 긴 글 요약에 약합니다. 영역을 3~4개로 줄이거나 모델을 키워 보세요 |

---

## 8. 밖에서 접속하기 — 학교 VPN

교내망 안에서 먼저 정상 동작한 뒤에 하세요. **VPN은 교내망 문제를 대신 풀어 주지 않습니다** —
VPN으로 들어가는 대역이 지금 막혀 있는 그 대역일 수 있습니다.

### 8.1 어떤 VPN인지 확인

| 종류 | 발급·관리 | 특징 |
|---|---|---|
| **교육청 원격업무 VPN** | 시·도 교육청 | 교사 재택·원격 업무용. 교육청 업무포털에 안내가 있는 경우가 많음 |
| **학교 자체 SSL VPN** | 학교 정보부 | 학교 방화벽 장비(안랩·시큐아이·Fortinet 등) 기능. 전용 프로그램 필요 |

정보 담당 선생님께 "외부에서 교내망 들어올 때 뭘 쓰나요?" 한 번 여쭤보면 정해집니다.

### 8.2 정보부 요청 양식

계정만이 아니라 **통신 경로 확인까지 함께** 요청해야 합니다.

> 학급 상담 자료 작성을 위해 교내망에 설치한 분석용 장비(젯슨 오린 나노)에 접속해야 합니다.
> 아래 두 가지를 요청드립니다.
>
> - **접속 대상**: 교내망 `<젯슨IP>` 의 TCP **11434**, TCP **8404**
> - **용도**: 학교생활기록부 기반 학부모 상담 자료 작성
>   (교내 로컬 서버에서만 처리하며 외부 클라우드로 전송하지 않습니다)
> - **요청 1**: 외부 접속용 VPN 계정 발급
> - **요청 2**: 업무용 PC 대역(`<PC대역>`)과 VPN 대역에서
>   젯슨 장비(`<젯슨IP>`)로 가는 통신이 차단되어 있는지 확인 및 허용

### 8.3 윈도우에서 설정

**전용 프로그램을 받았다면** 설치 후 발급받은 계정으로 로그인하면 끝입니다.

**주소와 계정만 받았다면** 윈도우 기본 기능을 씁니다.

```
설정 → 네트워크 및 인터넷 → VPN → VPN 연결 추가
  VPN 공급자      : Windows(기본 제공)
  연결 이름        : 학교 VPN
  서버 이름 또는 주소 : (정보부 제공)
  VPN 종류         : (정보부 지정 — 예: IKEv2 또는 L2TP/IPsec)
  사용자 이름·암호   : (발급받은 계정)
```

### 8.4 연결한 뒤 확인 순서

```
[VPN 연결]
   │
   ├─ ping <젯슨IP>
   │     ❌ 응답 없음 → VPN 대역에서 젯슨 대역으로 가는 길이 막힘
   │                   → 8.2의 '요청 2' 를 정보부에 다시 요청
   │     ✅ 응답 옴
   │        │
   │        ├─ http://<젯슨IP>:11434       → "Ollama is running"
   │        └─ http://<젯슨IP>:8404/health → {"ok":true …}
   │              │
   │              └─ 콘솔 설정: 서버 주소 = http://<젯슨IP>:11434
   │                            OCR 주소  = 비워 두기
```

### 8.5 집에서 쓸 때 지킬 것

콘솔은 데이터를 **그 브라우저에만** 저장합니다. 댁의 PC에서 쓰시면 학생 정보가 그 컴퓨터에 남습니다.

- 작업이 끝나면 대시보드의 **전체 초기화**를 누르세요
- 내려받은 생기부 파일은 **완전히 삭제**하세요(휴지통 비우기까지)
- 공용·가족 공용 PC에서는 쓰지 마세요

---

## 9. 문제가 생겼을 때 도움받는 법

AI 어시스턴트는 학교 밖 별도 환경에서 동작하므로 **교내망 주소(`192.168.55.1`,
`10.x.x.x`)에 직접 접속하거나 젯슨에 명령을 실행할 수 없습니다.** 대신 이렇게 나눠 일하면 빠릅니다.

| 누가 | 무엇을 |
|---|---|
| **선생님** | 젯슨·PC에서 명령 실행 → **출력 결과를 그대로 전달** |
| **어시스턴트** | 진단 명령 작성 · 결과 해석 · 설정과 코드 수정 |

막혔을 때는 **7.1의 진단 스크립트 결과 한 덩어리**를 그대로 붙여 주세요.
주소·서비스·포트·OCR 언어·모델·자체 응답이 모두 들어 있어, 어디가 문제인지 바로 좁혀집니다.

---

## 10. 꼭 기억할 것

- 젯슨은 **교내망 안에서만** 접속되게 두세요. 인터넷에 열지 않습니다(11434·8404 둘 다).
  두 서버 모두 **암호가 없어서**, 주소만 알면 누구나 모델을 쓰고 자료를 넣을 수 있습니다.
  포트포워딩·외부 터널(ngrok, Cloudflare Tunnel 등)은 쓰지 마세요.
  밖에서 써야 한다면 **학교 VPN**이 유일하게 안전한 길입니다(8번).
- 생기부 원문은 콘솔에 저장되지 않지만, **젯슨 로그**에는 남을 수 있습니다.
  운영 중에는 로그를 주기적으로 확인·정리해 주세요 (`journalctl --vacuum-time=7d`).
- AI가 만든 글은 **초안**입니다. 사실 관계와 표현을 담임 선생님이 반드시 확인한 뒤 사용해 주세요.
