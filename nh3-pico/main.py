# ─────────────────────────────────────────────────────────────
#  Pico 2 W 암모니아(NH3) 측정기 — 측정 · 플래시 저장 · 웹 다운로드
#  MicroPython (RPI_PICO2_W 펌웨어) 용
#
#  Pico에 저장할 파일: main.py, config.py, index.html
#  전원을 넣으면 자동 실행 → 같은 Wi-Fi의 휴대폰/PC 브라우저로 접속
# ─────────────────────────────────────────────────────────────
import os
import gc
import json
import time
import machine
import network
import asyncio

import config as C

DATA_DIR = "data"
SETTINGS_FILE = "settings.json"
CSV_HEADER = "time,uptime_s,adc_v,sensor_v,rs_kohm,ratio,ppm,warmup,note\n"
RECENT_MAX = 180  # 화면 실시간 그래프용으로 메모리에 보관할 개수

led = machine.Pin("LED", machine.Pin.OUT)
adc = machine.ADC(C.ADC_PIN)
rtc = machine.RTC()
boot_ms = time.ticks_ms()

# ── 설정 저장/불러오기 ──────────────────────────────────────
state = {
    "r0": C.DEFAULT_R0_KOHM,
    "interval": C.LOG_INTERVAL_S,
    "model": C.SENSOR_MODEL,
    "calibrated": False,
    "file": None,        # 현재 기록 중인 파일 이름
    "logging": True,
    "time_synced": False,
    "ip": "",
    "mode": "",
    "pending_note": "",
    "last": None,
    "full": False,
}
recent = []  # [(uptime_s, ppm, ratio, sensor_v)]


def load_settings():
    try:
        with open(SETTINGS_FILE) as f:
            s = json.load(f)
        for k in ("r0", "interval", "model", "calibrated"):
            if k in s:
                state[k] = s[k]
    except (OSError, ValueError):
        pass
    if state["model"] not in C.SENSOR_PROFILES:
        state["model"] = C.SENSOR_MODEL


def save_settings():
    with open(SETTINGS_FILE, "w") as f:
        json.dump({k: state[k] for k in ("r0", "interval", "model", "calibrated")}, f)


# ── 시간 ────────────────────────────────────────────────────
def uptime_s():
    return time.ticks_diff(time.ticks_ms(), boot_ms) // 1000


def now_str():
    if not state["time_synced"]:
        return ""
    t = time.localtime()
    return "%04d-%02d-%02d %02d:%02d:%02d" % t[:6]


def set_clock(y, mo, d, h, mi, s):
    rtc.datetime((y, mo, d, 0, h, mi, s, 0))
    state["time_synced"] = True


def try_ntp():
    try:
        import ntptime
        ntptime.settime()  # UTC
        t = time.localtime(time.time() + C.TZ_OFFSET_H * 3600)
        set_clock(*t[:6])
        return True
    except Exception:
        return False


# ── 센서 계산 ───────────────────────────────────────────────
if C.USE_DIVIDER:
    DIV_RATIO = C.R_BOT_KOHM / (C.R_TOP_KOHM + C.R_BOT_KOHM)
    # 분압 저항이 모듈의 RL과 병렬로 연결되어 실효 부하저항이 작아짐
    R_DIV = C.R_TOP_KOHM + C.R_BOT_KOHM
    RL_EFF = C.RL_KOHM * R_DIV / (C.RL_KOHM + R_DIV)
else:
    DIV_RATIO = 1.0
    RL_EFF = C.RL_KOHM


def read_sensor():
    total = 0
    for _ in range(C.SAMPLES_PER_READ):
        total += adc.read_u16()
    adc_v = total / C.SAMPLES_PER_READ * C.ADC_VREF / 65535
    sensor_v = adc_v / DIV_RATIO
    rs = ratio = ppm = None
    if 0.02 < sensor_v < C.SENSOR_VCC - 0.02:
        rs = RL_EFF * (C.SENSOR_VCC - sensor_v) / sensor_v   # Rs = RL(Vc − Vout)/Vout
        ratio = rs / state["r0"]
        p = C.SENSOR_PROFILES[state["model"]]
        ppm = p["A"] * ratio ** p["B"]
    return adc_v, sensor_v, rs, ratio, ppm


# ── 파일 ────────────────────────────────────────────────────
def ensure_dir():
    try:
        os.mkdir(DATA_DIR)
    except OSError:
        pass


def list_files():
    out = []
    for name in sorted(os.listdir(DATA_DIR)):
        if name.endswith(".csv"):
            out.append({"name": name, "size": os.stat(DATA_DIR + "/" + name)[6]})
    return out


def free_kb():
    st = os.statvfs("/")
    return st[0] * st[3] // 1024


def safe_name(name):
    if not name or len(name) > 40:
        return None
    for ch in name:
        if not (ch.isalpha() or ch.isdigit() or ch in "_-."):
            return None
    if not name.endswith(".csv") or name.startswith("."):
        return None
    if name not in os.listdir(DATA_DIR):
        return None
    return name


def new_run(label=""):
    nums = [int(f["name"][4:7]) for f in list_files()
            if f["name"].startswith("run_") and f["name"][4:7].isdigit()]
    n = (max(nums) + 1) if nums else 1
    tag = "".join(ch for ch in label if ch.isalpha() or ch.isdigit() or ch in "_-")[:20]
    name = "run_%03d%s.csv" % (n, ("_" + tag) if tag else "")
    p = C.SENSOR_PROFILES[state["model"]]
    with open(DATA_DIR + "/" + name, "w") as f:
        # '#' 줄은 메타데이터 — 분석 페이지가 읽어서 ppm 재계산에 사용
        f.write("# device=Pico2W-NH3,model=%s,vc=%.3f,rl_kohm=%.3f,rl_eff_kohm=%.3f,div_ratio=%.4f,"
                "r0_kohm=%.3f,curve_a=%s,curve_b=%s,clean_air_ratio=%s,calibrated=%d,label=%s\n" % (
                    state["model"], C.SENSOR_VCC, C.RL_KOHM, RL_EFF, DIV_RATIO, state["r0"],
                    p["A"], p["B"], p["CLEAN_AIR_RATIO"], 1 if state["calibrated"] else 0, tag))
        f.write(CSV_HEADER)
    state["file"] = name
    return name


def fmt(v, nd):
    return "" if v is None else ("%." + str(nd) + "f") % v


def log_row(r):
    adc_v, sensor_v, rs, ratio, ppm = r
    warm = 1 if uptime_s() < C.WARMUP_S else 0
    note = state["pending_note"].replace(",", " ").replace("\n", " ")
    state["pending_note"] = ""
    line = "%s,%d,%s,%s,%s,%s,%s,%d,%s\n" % (
        now_str(), uptime_s(), fmt(adc_v, 4), fmt(sensor_v, 4), fmt(rs, 3),
        fmt(ratio, 4), fmt(ppm, 2), warm, note)
    with open(DATA_DIR + "/" + state["file"], "a") as f:
        f.write(line)


# ── 측정 루프 ───────────────────────────────────────────────
async def measure_loop():
    while True:
        r = read_sensor()
        adc_v, sensor_v, rs, ratio, ppm = r
        state["last"] = {
            "uptime": uptime_s(), "time": now_str(),
            "adc_v": adc_v, "sensor_v": sensor_v, "rs": rs, "ratio": ratio, "ppm": ppm,
            "warmup": uptime_s() < C.WARMUP_S,
        }
        recent.append((uptime_s(), ppm, ratio, sensor_v))
        if len(recent) > RECENT_MAX:
            recent.pop(0)
        if state["logging"]:
            if free_kb() < C.MIN_FREE_KB:
                state["full"] = True
                state["logging"] = False
            else:
                try:
                    log_row(r)
                    led.on()
                    await asyncio.sleep_ms(60)
                    led.off()
                except OSError:
                    state["logging"] = False
        gc.collect()
        await asyncio.sleep(state["interval"])


# ── 웹 서버 ─────────────────────────────────────────────────
def parse_qs(qs):
    out = {}
    for part in qs.split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k] = url_decode(v)
    return out


def url_decode(s):
    s = s.replace("+", " ")
    b = bytearray()
    i = 0
    while i < len(s):
        if s[i] == "%" and i + 2 < len(s):
            try:
                b.append(int(s[i + 1:i + 3], 16))
                i += 3
                continue
            except ValueError:
                pass
        b.extend(s[i].encode())
        i += 1
    try:
        return bytes(b).decode()
    except UnicodeError:
        return ""


async def send(w, status, ctype, body, extra=""):
    if isinstance(body, str):
        body = body.encode()
    w.write((("HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %d\r\n"
             "Cache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n%sConnection: close\r\n\r\n")
            % (status, ctype, len(body), extra)).encode())
    w.write(body)
    await w.drain()


async def send_json(w, obj, status="200 OK"):
    await send(w, status, "application/json", json.dumps(obj))


async def send_file(w, path, ctype, download_name=None):
    size = os.stat(path)[6]
    extra = ('Content-Disposition: attachment; filename="%s"\r\n' % download_name) if download_name else ""
    w.write((("HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %d\r\n"
             "Cache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n%sConnection: close\r\n\r\n")
            % (ctype, size, extra)).encode())
    buf = bytearray(1024)
    with open(path, "rb") as f:
        while True:
            n = f.readinto(buf)
            if not n:
                break
            w.write(buf[:n])
            await w.drain()


def status_obj():
    return {
        "last": state["last"], "file": state["file"], "logging": state["logging"],
        "interval": state["interval"], "r0": state["r0"], "model": state["model"],
        "calibrated": state["calibrated"], "time_synced": state["time_synced"],
        "time": now_str(), "uptime": uptime_s(), "warmup_s": C.WARMUP_S,
        "free_kb": free_kb(), "full": state["full"], "ip": state["ip"], "mode": state["mode"],
        "models": list(C.SENSOR_PROFILES.keys()),
    }


async def handle(r, w):
    try:
        line = await r.readline()
        if not line:
            return
        parts = line.decode().split(" ")
        if len(parts) < 2:
            return
        while True:  # 헤더는 읽고 버림
            h = await r.readline()
            if not h or h == b"\r\n":
                break
        path, _, qs = parts[1].partition("?")
        q = parse_qs(qs)

        if path in ("/", "/index.html"):
            await send_file(w, "index.html", "text/html; charset=utf-8")
        elif path == "/api/status":
            await send_json(w, status_obj())
        elif path == "/api/recent":
            await send_json(w, recent)
        elif path == "/api/files":
            await send_json(w, {"files": list_files(), "current": state["file"], "free_kb": free_kb()})
        elif path == "/download":
            name = safe_name(q.get("f", ""))
            if not name:
                await send(w, "404 Not Found", "text/plain", "no file")
            else:
                await send_file(w, DATA_DIR + "/" + name, "text/csv; charset=utf-8", name)
        elif path == "/api/delete":
            name = safe_name(q.get("f", ""))
            if not name:
                await send_json(w, {"ok": False, "msg": "파일 없음"}, "404 Not Found")
            elif name == state["file"]:
                await send_json(w, {"ok": False, "msg": "기록 중인 파일은 삭제할 수 없습니다. 새 기록을 먼저 시작하세요."})
            else:
                os.remove(DATA_DIR + "/" + name)
                state["full"] = False
                await send_json(w, {"ok": True})
        elif path == "/api/new":
            name = new_run(q.get("label", ""))
            state["logging"] = True
            await send_json(w, {"ok": True, "file": name})
        elif path == "/api/logging":
            state["logging"] = q.get("on", "1") == "1" and not state["full"]
            await send_json(w, {"ok": True, "logging": state["logging"]})
        elif path == "/api/mark":
            state["pending_note"] = q.get("note", "").strip()[:60]
            await send_json(w, {"ok": True})
        elif path == "/api/time":
            # 브라우저(휴대폰) 시각으로 Pico 시계 맞추기: t=YYYY-MM-DDTHH:MM:SS
            t = q.get("t", "")
            try:
                d, hms = t.split("T")
                y, mo, dd = [int(x) for x in d.split("-")]
                h, mi, s = [int(x) for x in hms.split(":")[:3]]
                set_clock(y, mo, dd, h, mi, s)
                await send_json(w, {"ok": True, "time": now_str()})
            except Exception:
                await send_json(w, {"ok": False}, "400 Bad Request")
        elif path == "/api/interval":
            try:
                v = int(q.get("s", ""))
                state["interval"] = max(1, min(600, v))
                save_settings()
                await send_json(w, {"ok": True, "interval": state["interval"]})
            except ValueError:
                await send_json(w, {"ok": False}, "400 Bad Request")
        elif path == "/api/model":
            m = q.get("m", "")
            if m in C.SENSOR_PROFILES:
                state["model"] = m
                save_settings()
            await send_json(w, {"ok": m in C.SENSOR_PROFILES, "model": state["model"]})
        elif path == "/api/calibrate":
            if uptime_s() < C.WARMUP_S:
                await send_json(w, {"ok": False, "msg": "예열 중에는 교정할 수 없습니다."})
            else:
                vals = []
                for _ in range(20):
                    rs = read_sensor()[2]
                    if rs:
                        vals.append(rs)
                    await asyncio.sleep_ms(100)
                if not vals:
                    await send_json(w, {"ok": False, "msg": "센서 값이 범위를 벗어났습니다. 배선을 확인하세요."})
                else:
                    rs_air = sum(vals) / len(vals)
                    p = C.SENSOR_PROFILES[state["model"]]
                    state["r0"] = rs_air / p["CLEAN_AIR_RATIO"]
                    state["calibrated"] = True
                    save_settings()
                    # 파일 머리말의 R0와 실제 계산값이 일치하도록 새 기록 파일로 전환
                    name = new_run("cal")
                    await send_json(w, {"ok": True, "rs_air": rs_air, "r0": state["r0"], "file": name})
        else:
            await send(w, "404 Not Found", "text/plain", "not found")
    except Exception as e:
        try:
            await send(w, "500 Internal Server Error", "text/plain", str(e))
        except Exception:
            pass
    finally:
        try:
            w.close()
            await w.wait_closed()
        except Exception:
            pass
        gc.collect()


# ── Wi-Fi ───────────────────────────────────────────────────
def connect_wifi():
    if C.WIFI_SSID:
        sta = network.WLAN(network.STA_IF)
        sta.active(True)
        sta.connect(C.WIFI_SSID, C.WIFI_PASSWORD)
        for _ in range(30):  # 최대 15초 대기
            if sta.isconnected():
                state["ip"] = sta.ifconfig()[0]
                state["mode"] = "STA"
                return
            led.toggle()
            time.sleep_ms(500)
        sta.active(False)
    ap = network.WLAN(network.AP_IF)
    ap.config(essid=C.AP_SSID, password=C.AP_PASSWORD)
    ap.active(True)
    while not ap.active():
        time.sleep_ms(100)
    state["ip"] = ap.ifconfig()[0]
    state["mode"] = "AP"


async def main():
    load_settings()
    ensure_dir()
    connect_wifi()
    if state["mode"] == "STA":
        try_ntp()
    new_run()
    print("NH3 logger:", state["mode"], "http://%s" % state["ip"], "->", state["file"])
    await asyncio.start_server(handle, "0.0.0.0", 80)
    await measure_loop()


try:
    asyncio.run(main())
finally:
    asyncio.new_event_loop()
