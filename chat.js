/* 상담 빠른 입력 채팅 위젯
 * 문장에서 학생 이름·날짜·상담 영역·후속 조치를 자동 인식해
 * counsel-records(localStorage)에 저장 → 상담 카드 페이지와 공유 */
(function () {
  const KEY = 'counsel-records';
  const $ = (id) => document.getElementById(id);
  const load = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fb; } catch { return fb; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const roster = load('manage-roster', []).slice().sort((a, b) => b.length - a.length);
  const CAT_EMOJI = { '학업': '📚', '교우관계': '🤝', '진로': '🧭', '가정': '🏠', '생활': '🌱' };
  const CAT_WORDS = {
    '교우관계': ['친구', '교우', '다툼', '다퉈', '싸움', '싸웠', '따돌림', '왕따', '화해', '관계'],
    '학업': ['학업', '공부', '성적', '시험', '숙제', '수업', '학습', '국어', '수학', '영어', '과학', '사회', '방과후'],
    '진로': ['진로', '꿈', '장래', '직업', '진학', '고등학교', '특성화', '적성'],
    '가정': ['가정', '부모', '엄마', '아빠', '아버지', '어머니', '가족', '형제', '동생'],
  };

  // ── 파서 ──
  function findName(text) {
    for (const n of roster) if (text.includes(n)) return n;
    return null;
  }
  function parseDate(text) {
    const d = new Date();
    let m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = text.match(/(\d{1,2})월\s*(\d{1,2})일/);
    if (m) return `${d.getFullYear()}-${pad(m[1])}-${pad(m[2])}`;
    if (text.includes('그저께') || text.includes('그제')) d.setDate(d.getDate() - 2);
    else if (text.includes('어제')) d.setDate(d.getDate() - 1);
    return iso(d);
  }
  function parseCat(text) {
    let best = '생활', bestN = 0;
    for (const [cat, words] of Object.entries(CAT_WORDS)) {
      const n = words.filter((w) => text.includes(w)).length;
      if (n > bestN) { best = cat; bestN = n; }
    }
    return best;
  }
  function parseNext(text) {
    const sents = text.split(/[.\n]/).map((s) => s.trim()).filter(Boolean);
    return sents.filter((s) => /재상담|추후|다음\s?주|다음\s?에|예정|연락|지켜보기|권유/.test(s)).join('. ');
  }

  // ── UI ──
  const msgs = $('chatMsgs');
  function bubble(cls, html) {
    const div = document.createElement('div');
    div.className = 'cb ' + cls;
    div.innerHTML = html;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }
  const botSay = (html) => bubble('cb-bot', html);

  let pending = null; // 이름 없이 입력된 내용 대기

  function handle(raw) {
    const text = raw.trim();
    if (!text) return;
    bubble('cb-user', esc(text));

    let name = findName(text);
    let body = text;

    // 이름을 되물은 상태에서 이름만 답한 경우 → 대기 중이던 내용에 연결
    if (pending && text.length <= 6) {
      if (!name) name = text.replace(/[^가-힣a-zA-Z0-9]/g, '');
      body = pending;
      pending = null;
    }
    if (!name) {
      const m = text.match(/^([가-힣]{2,4})[\s,:]/);
      if (m && !roster.length) { name = m[1]; }
    }
    if (!name) {
      pending = text;
      botSay(roster.length
        ? '어느 학생의 상담인가요? 이름만 답해 주세요 🙂<br><small>' + roster.slice().sort().map(esc).join(' · ') + '</small>'
        : '어느 학생의 상담인가요? 이름만 답해 주세요 🙂');
      return;
    }

    const rec = {
      id: Date.now(),
      name,
      date: parseDate(body),
      cat: parseCat(body),
      text: body,
      next: parseNext(body),
    };
    const records = load(KEY, []);
    records.push(rec);
    save(KEY, records);

    botSay(
      `✅ <b>${esc(name)}</b> 학생 카드에 정리해 저장했어요!<br>` +
      `<span class="cb-meta">📅 ${esc(rec.date)} · ${CAT_EMOJI[rec.cat]} ${esc(rec.cat)}</span>` +
      (rec.next ? `<span class="cb-meta">👉 후속: ${esc(rec.next)}</span>` : '') +
      `<span class="cb-actions"><a href="counsel.html">상담 카드 보기 ›</a> <button class="cb-undo" data-undo="${rec.id}">↩ 되돌리기</button></span>`
    );
  }

  msgs.addEventListener('click', (e) => {
    const id = e.target.getAttribute('data-undo');
    if (!id) return;
    const records = load(KEY, []).filter((r) => String(r.id) !== id);
    save(KEY, records);
    e.target.closest('.cb').innerHTML = '↩ 저장을 취소했어요.';
  });

  const input = $('chatInput');
  const send = () => { const v = input.value; input.value = ''; handle(v); };
  $('chatSend').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // 열기/닫기
  const panel = $('chatPanel');
  $('chatFab').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      if (!msgs.childElementCount) {
        botSay('상담 내용을 문장으로 적으면 학생 카드에 자동 정리해 드려요!<br><small>예: “김하늘 오늘 친구와 다툰 일로 상담. 화해하기로 함. 다음 주 재상담 예정”</small><br><small>이름·날짜(오늘/어제/7월 3일)·영역·후속 조치를 자동으로 알아채요. 기록은 이 컴퓨터에만 저장돼요 🔒</small>');
      }
      input.focus();
    }
  });
  $('chatClose').addEventListener('click', () => { panel.hidden = true; });
})();
