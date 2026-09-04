#!/usr/bin/env python3
"""
ocr-server.py — 젯슨에서 도는 한국어 OCR 서버

나이스 생기부는 위·변조를 막으려고 글자를 모두 그림으로 찍어 넣습니다.
그래서 콘솔이 파일에서 꺼낸 그림을 여기로 보내면, 이 서버가 글자로 바꿔
돌려줍니다. 바꾼 글자는 선생님이 화면에서 확인·수정한 뒤 분석에 씁니다.

준비 (젯슨에서 한 번만)
    sudo apt update
    sudo apt install -y tesseract-ocr tesseract-ocr-kor

실행
    python3 ocr-server.py                 # 0.0.0.0:8404
    python3 ocr-server.py --port 9000     # 포트 바꾸기

주고받는 것
    GET  /health          → {"ok":true,"langs":[...]}
    POST /ocr             몸통 = 그림 파일 그대로 → {"text":"..."}
                          ?psm=6  글줄 덩어리(기본) / ?psm=7 한 줄
                          ?lang=kor (기본) — 영어를 섞으면 한글 정확도가 떨어집니다

이 서버는 교내망 안에서만 쓰세요. 암호가 없으므로 인터넷에 열지 않습니다.
받은 그림은 잠깐 메모리에만 두고 디스크에 남기지 않습니다.
"""

import argparse
import json
import shutil
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

MAX_BYTES = 12 * 1024 * 1024          # 그림 한 장 12MB 까지
ALLOWED_PSM = {'3', '4', '6', '7', '11', '13'}
MAGIC = (b'\x89PNG', b'\xff\xd8\xff', b'GIF8', b'BM')


def tesseract_langs():
    try:
        out = subprocess.run(['tesseract', '--list-langs'],
                             capture_output=True, text=True, timeout=20)
        return [l.strip() for l in out.stdout.splitlines()[1:] if l.strip()]
    except Exception:
        return []


def run_ocr(data, lang, psm):
    """그림 바이트 → 글자. 파일로 남기지 않도록 표준 입출력으로 주고받는다."""
    proc = subprocess.run(
        ['tesseract', 'stdin', 'stdout', '-l', lang, '--psm', psm],
        input=data, capture_output=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode('utf-8', 'replace').strip()[:500])
    return proc.stdout.decode('utf-8', 'replace')


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'saenggibu-ocr'

    def log_message(self, fmt, *args):
        # 생기부 내용이 로그에 남지 않도록 접속 기록만 짧게 남긴다
        sys.stderr.write('%s %s\n' % (self.command, self.path.split('?')[0]))

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path != '/health':
            return self._json(404, {'error': '없는 주소입니다'})
        langs = tesseract_langs()
        self._json(200, {
            'ok': 'kor' in langs,
            'langs': langs,
            'hint': '' if 'kor' in langs else
                    'sudo apt install -y tesseract-ocr-kor 를 먼저 실행해 주세요',
        })

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != '/ocr':
            return self._json(404, {'error': '없는 주소입니다'})

        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            return self._json(400, {'error': '길이를 읽지 못했습니다'})
        if length <= 0:
            return self._json(400, {'error': '그림이 비어 있습니다'})
        if length > MAX_BYTES:
            return self._json(413, {'error': '그림이 너무 큽니다 (12MB 넘음)'})

        data = self.rfile.read(length)
        if not data.startswith(MAGIC):
            return self._json(415, {'error': '그림 파일이 아닙니다'})

        q = parse_qs(url.query)
        psm = (q.get('psm') or ['6'])[0]
        if psm not in ALLOWED_PSM:
            psm = '6'
        lang = (q.get('lang') or ['kor'])[0]
        if not all(c.isalnum() or c == '+' for c in lang):
            lang = 'kor'

        try:
            text = run_ocr(data, lang, psm)
        except subprocess.TimeoutExpired:
            return self._json(504, {'error': '시간이 너무 오래 걸렸습니다'})
        except FileNotFoundError:
            return self._json(500, {'error': 'tesseract 가 설치돼 있지 않습니다'})
        except Exception as e:
            return self._json(500, {'error': str(e)})

        self._json(200, {'text': text})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='0.0.0.0')
    ap.add_argument('--port', type=int, default=8404)
    a = ap.parse_args()

    if not shutil.which('tesseract'):
        sys.exit('tesseract 가 없습니다.\n'
                 '  sudo apt install -y tesseract-ocr tesseract-ocr-kor')
    langs = tesseract_langs()
    if 'kor' not in langs:
        print('⚠ 한국어 글꼴 자료가 없습니다 — sudo apt install -y tesseract-ocr-kor',
              file=sys.stderr)

    print('OCR 서버 시작: http://%s:%d  (설치된 언어: %s)'
          % (a.host, a.port, ', '.join(langs) or '없음'))
    print('교내망 안에서만 쓰세요. 인터넷에 열지 마세요.')
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
