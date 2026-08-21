/* 교내 로컬 AI 서버(젯슨 오린 나노 등) 연결 클라이언트
 *
 * 학생 개인정보가 담긴 생기부를 다루므로 외부 클라우드 API는 쓰지 않는다.
 * 학교 안에 설치한 서버(Ollama / llama.cpp / vLLM 등)에만 직접 요청하며,
 * 요청은 교사 PC의 브라우저 → 교내망 서버로 바로 가고 그 밖으로 나가지 않는다.
 *
 * 두 가지 규격을 모두 지원하고 자동으로 가려낸다.
 *   - OpenAI 호환 : POST {base}/v1/chat/completions , 목록 GET {base}/v1/models
 *   - Ollama 고유 : POST {base}/api/chat           , 목록 GET {base}/api/tags
 */
(function () {
  // 대시보드의 백업·전체 초기화가 함께 다루도록 'console-' 접두사를 쓴다
  const KEY = 'console-ai';

  const DEFAULTS = {
    base: 'http://192.168.0.100:11434', // 젯슨의 교내망 IP(또는 http://jetson.local:11434)
    model: '',
    api: 'auto',   // auto | openai | ollama
    temp: 0.3,     // 상담 자료는 사실 위주 — 낮게
    maxTokens: 1600,
    timeout: 180,  // 초. 젯슨은 클라우드보다 느리므로 넉넉히
  };

  const load = () => {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY)) || {}); }
    catch { return Object.assign({}, DEFAULTS); }
  };
  const save = (s) => {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  };

  // 끝의 / 와 실수로 붙인 /v1, /api 를 떼어 낸 기본 주소
  function normBase(base) {
    let b = String(base || '').trim().replace(/\s+/g, '');
    if (!b) return '';
    if (!/^https?:\/\//i.test(b)) b = 'http://' + b;
    return b.replace(/\/+$/, '').replace(/\/(v1|api)$/i, '');
  }

  /* https 페이지에서 http 주소를 부르면 브라우저가 막는다(혼합 콘텐츠).
   * 깃허브 페이지즈로 열었을 때 흔히 걸리는 함정이라 미리 알려 준다. */
  function mixedContentWarning(base) {
    const b = normBase(base);
    if (location.protocol === 'https:' && /^http:\/\//i.test(b)) {
      return 'HTTPS 주소로 연 페이지에서는 http:// 로 된 교내 서버를 부를 수 없습니다(브라우저 차단). ' +
             '콘솔 파일을 젯슨에서 http로 제공하거나, 내 컴퓨터에 내려받아 여는 방식으로 사용해 주세요.';
    }
    return '';
  }

  function withTimeout(sec) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), Math.max(5, sec || 60) * 1000);
    return { signal: ac.signal, done: () => clearTimeout(t), abort: () => ac.abort() };
  }

  // 연결 실패 사유를 교사가 읽고 조치할 수 있는 말로 바꾼다
  function explain(err, base) {
    const msg = String((err && err.message) || err || '');
    if (/aborted|abort/i.test(msg)) return '응답 시간이 초과되었습니다. 모델이 너무 크거나 서버가 바쁠 수 있어요.';
    const mixed = mixedContentWarning(base);
    if (mixed) return mixed;
    if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
      return '서버에 연결하지 못했습니다. 주소·포트가 맞는지, 젯슨이 켜져 있는지, ' +
             '외부 접속 허용(OLLAMA_HOST=0.0.0.0)과 CORS 허용(OLLAMA_ORIGINS=*) 설정이 되어 있는지 확인해 주세요.';
    }
    return msg || '알 수 없는 오류';
  }

  /* 설치된 모델 목록 가져오기 — 규격 자동 감지에도 쓴다.
   * → { api: 'openai'|'ollama', models: [이름…] } */
  async function listModels(settings) {
    const s = settings || load();
    const base = normBase(s.base);
    if (!base) throw new Error('서버 주소를 먼저 입력해 주세요.');

    const tries = s.api === 'ollama' ? ['ollama']
      : s.api === 'openai' ? ['openai']
      : ['openai', 'ollama'];

    let lastErr = null;
    for (const api of tries) {
      const t = withTimeout(15);
      try {
        const url = base + (api === 'openai' ? '/v1/models' : '/api/tags');
        const res = await fetch(url, { signal: t.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        const models = api === 'openai'
          ? (j.data || []).map((m) => m.id)
          : (j.models || []).map((m) => m.name || m.model);
        return { api, models: models.filter(Boolean) };
      } catch (e) {
        lastErr = e;
      } finally {
        t.done();
      }
    }
    throw new Error(explain(lastErr, base));
  }

  /* 대화 요청(스트리밍).
   *   opts = { system, prompt, onDelta(조각), signal }
   * 반환: 전체 응답 문자열
   * 스트리밍이 막힌 서버(프록시 등)에서는 한 번에 받는 방식으로 물러선다. */
  async function chat(opts) {
    const s = load();
    const base = normBase(s.base);
    if (!base) throw new Error('서버 주소를 먼저 입력해 주세요.');
    if (!s.model) throw new Error('사용할 모델을 먼저 선택해 주세요.');

    let api = s.api;
    if (api === 'auto') {
      try { api = (await listModels(s)).api; } catch { api = 'openai'; }
    }

    const messages = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    messages.push({ role: 'user', content: opts.prompt });

    const t = withTimeout(s.timeout);
    // 바깥에서 중단 버튼을 누르면 같이 끊는다
    if (opts.signal) opts.signal.addEventListener('abort', t.abort, { once: true });

    const url = base + (api === 'openai' ? '/v1/chat/completions' : '/api/chat');
    const body = api === 'openai'
      ? { model: s.model, messages, stream: true, temperature: Number(s.temp), max_tokens: Number(s.maxTokens) }
      : { model: s.model, messages, stream: true, options: { temperature: Number(s.temp), num_predict: Number(s.maxTokens) } };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: t.signal,
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 300); } catch {}
        throw new Error(`서버가 오류를 돌려주었습니다 (HTTP ${res.status}). ${detail}`);
      }
      if (!res.body) return await nonStream(res, api);
      return await readStream(res.body, api, opts.onDelta);
    } catch (e) {
      throw new Error(explain(e, base));
    } finally {
      t.done();
      if (opts.signal) opts.signal.removeEventListener('abort', t.abort);
    }
  }

  async function nonStream(res, api) {
    const j = await res.json();
    return api === 'openai'
      ? ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '')
      : ((j.message && j.message.content) || '');
  }

  /* OpenAI 호환은 SSE(`data: {…}` 줄), Ollama는 JSON 한 줄씩(NDJSON).
   * 둘 다 줄 단위로 끊어 읽으면 되므로 한 함수로 처리한다. */
  async function readStream(stream, api, onDelta) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;

        let payload = line;
        if (api === 'openai') {
          if (!line.startsWith('data:')) continue;
          payload = line.slice(5).trim();
          if (payload === '[DONE]') { buf = ''; break; }
        }

        let j;
        try { j = JSON.parse(payload); } catch { continue; }

        const piece = api === 'openai'
          ? ((j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || '')
          : ((j.message && j.message.content) || '');
        if (piece) {
          full += piece;
          if (onDelta) onDelta(piece, full);
        }
      }
    }
    return full;
  }

  /* 연결 확인 — 목록을 부른 뒤 짧은 문장 하나를 실제로 생성시켜 본다.
   * 목록만 되고 생성이 안 되는 경우(모델 미다운로드 등)를 걸러 내기 위함. */
  async function testConnection() {
    const s = load();
    const { api, models } = await listModels(s);
    if (!models.length) {
      throw new Error('서버에는 연결되었지만 설치된 모델이 없습니다. 젯슨에서 `ollama pull <모델>` 을 먼저 실행해 주세요.');
    }
    if (!s.model) {
      return { api, models, tried: false, reply: '' };
    }
    if (!models.includes(s.model)) {
      throw new Error(`선택한 모델(${s.model})이 서버에 없습니다. 목록에서 다시 골라 주세요.`);
    }
    const reply = await chat({ system: '너는 한국어로 짧게 답한다.', prompt: '연결 확인. "준비 완료"라고만 답해.' });
    return { api, models, tried: true, reply: reply.trim().slice(0, 80) };
  }

  window.LocalAI = {
    DEFAULTS,
    getSettings: load,
    saveSettings: (s) => save(Object.assign(load(), s)),
    normBase,
    mixedContentWarning,
    listModels,
    chat,
    testConnection,
  };
})();
