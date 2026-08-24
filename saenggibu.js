/* 학교생활기록부(생기부) 텍스트 파서 + 개인정보 지우개
 *
 * PDF·텍스트에서 뽑아낸 생기부 글을 받아
 *   1) 학생별로 자르고
 *   2) 영역(출결·창체·교과·행특 …)별로 나누고
 *   3) 모델에 넘기기 전에 주민등록번호·연락처·주소 같은 식별정보를 지운다.
 *
 * 나이스 출력물의 줄바꿈·띄어쓰기는 판마다 조금씩 달라서
 * 모든 항목을 완벽히 뽑아내지는 못한다. 뽑히지 않은 부분도 원문 그대로
 * 모델에 함께 넘기므로, 여기서의 추출은 화면에 미리 보여 주기 위한 보조 수단이다.
 */
(function () {
  // 나이스 생기부의 영역 이름 — 표기 흔들림(가운뎃점·띄어쓰기)을 함께 인식
  const SECTIONS = [
    ['인적·학적사항', /인\s*적\s*[·ㆍ,]?\s*학\s*적\s*사\s*항|인\s*적\s*사\s*항|학\s*적\s*사\s*항/],
    ['출결상황', /출\s*결\s*상\s*황/],
    ['수상경력', /수\s*상\s*경\s*력/],
    ['자격증 및 인증 취득상황', /자\s*격\s*증\s*및\s*인\s*증|자격증\s*및\s*인증\s*취득/],
    ['진로희망사항', /진\s*로\s*희\s*망\s*사\s*항/],
    ['창의적 체험활동상황', /창\s*의\s*적\s*체\s*험\s*활\s*동/],
    ['자유학기활동상황', /자\s*유\s*학\s*기\s*활\s*동/],
    ['교과학습발달상황', /교\s*과\s*학\s*습\s*발\s*달\s*상\s*황/],
    ['독서활동상황', /독\s*서\s*활\s*동\s*상\s*황/],
    ['행동특성 및 종합의견', /행\s*동\s*특\s*성\s*및\s*종\s*합\s*의\s*견|행동특성/],
  ];

  // 상담 자료를 만들 때 특히 중요한 영역 — 기본으로 켜 둔다
  const CORE = ['창의적 체험활동상황', '교과학습발달상황', '행동특성 및 종합의견', '출결상황', '수상경력', '진로희망사항'];

  const clean = (s) => String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  /* ── 개인정보 지우개 ──────────────────────────────
   * 이름 가림은 선택이지만, 아래 항목은 언제나 지운다.
   * 상담 자료를 만드는 데 필요 없는 정보이기 때문. */
  function scrub(text, opts) {
    const o = opts || {};
    let t = String(text || '');

    t = t.replace(/\d{6}\s*[-–—]\s*\d{7}/g, '(주민등록번호 삭제)');
    t = t.replace(/01[016-9][-–.\s]?\d{3,4}[-–.\s]?\d{4}/g, '(연락처 삭제)');
    t = t.replace(/0\d{1,2}[-–.\s]\d{3,4}[-–.\s]\d{4}/g, '(연락처 삭제)');
    t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '(이메일 삭제)');
    // '주소', '거주지' 라벨이 붙은 줄 전체
    t = t.replace(/^.*(?:주\s*소|거\s*주\s*지)\s*[:：].*$/gm, '(주소 삭제)');
    // 라벨 없이 나오는 도로명·지번 주소
    t = t.replace(/[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도)\s+[가-힣]+[시군구][^\n]{0,40}/g, '(주소 삭제)');

    if (o.maskName && o.name) {
      const re = new RegExp(o.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      t = t.replace(re, '○○○');
    }
    if (o.maskName) {
      // 보호자 성명도 함께 가린다 — '보호자(모) 성명 : 홍길동', '부 : 홍길동' 두 표기 모두
      t = t.replace(/(보호자[^\n:：]{0,10})[:：]\s*[가-힣]{2,4}/g, '$1: ○○○');
      t = t.replace(/^(\s*[부모]\s*)[:：]\s*[가-힣]{2,4}/gm, '$1: ○○○');
    }
    return t;
  }

  /* ── 학생 나누기 ──────────────────────────────
   * 여러 학생이 한 파일에 이어 붙은 출력물을 '인적·학적사항' 머리글 기준으로 자른다. */
  function splitStudents(text) {
    const t = clean(text);
    const head = /(?:^|\n)\s*(?:\d+\s*[.)]\s*)?인\s*적\s*[·ㆍ,]?\s*학\s*적\s*사\s*항/g;
    const at = [];
    let m;
    while ((m = head.exec(t))) at.push(m.index);
    if (at.length < 2) return [t];

    const out = [];
    for (let i = 0; i < at.length; i++) {
      out.push(t.slice(at[i], i + 1 < at.length ? at[i + 1] : t.length).trim());
    }
    return out.filter((s) => s.length > 80);
  }

  /* 이름표(성명·이름)는 줄 첫머리에 있을 때만 믿는다.
   * OCR 로 읽은 글에서는 문장 속 '설명'이 '성명'으로 잘못 읽히는 일이 잦아,
   * 아무 데나 걸리게 두면 엉뚱한 낱말을 이름으로 집는다. */
  function findName(block) {
    const pats = [
      /(?:^|\n)\s*성\s*명\s*[:：]\s*([가-힣]{2,5})/,
      /(?:^|\n)\s*이\s*름\s*[:：]\s*([가-힣]{2,5})/,
      /(?:^|\n)\s*성\s*명\s*\n\s*([가-힣]{2,5})/,
    ];
    for (const p of pats) {
      const m = block.match(p);
      if (m) return m[1].trim();
    }
    return '';
  }

  function findNumbers(block) {
    const out = {};
    // '2026학년도'의 26을 학년으로 잘못 읽지 않도록 연도 표기를 먼저 걷어 낸다
    const t = block.replace(/\d{4}\s*학\s*년\s*도/g, ' ');
    let m = t.match(/(\d{1,2})\s*학\s*년(?!\s*도)/);
    if (m) out.grade = m[1];
    m = t.match(/(\d{1,2})\s*반/);
    if (m) out.classNo = m[1];
    m = t.match(/(\d{1,2})\s*번(?!\s*호)/);
    if (m) out.number = m[1];
    return out;
  }

  /* ── 영역 나누기 ── */
  function splitSections(block) {
    const marks = [];
    SECTIONS.forEach(([name, re]) => {
      const g = new RegExp(re.source, 'g');
      let m;
      while ((m = g.exec(block))) marks.push({ at: m.index, name });
    });
    marks.sort((a, b) => a.at - b.at);

    const sections = {};
    marks.forEach((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].at : block.length;
      // 끝에 딸려 온 다음 영역의 번호('3.')는 떼어 낸다
      const body = block.slice(mk.at, end).replace(/\n\s*\d{1,2}\s*[.)]\s*$/, '').trim();
      if (body.length < 12) return;
      // 같은 영역이 여러 번(학년별 등) 나오면 이어 붙인다
      sections[mk.name] = sections[mk.name] ? sections[mk.name] + '\n\n' + body : body;
    });
    return sections;
  }

  /* ── 교과 성적 표 훑기 ──────────────────────────────
   * 나이스 표기: 과목  원점수/과목평균(표준편차)  성취도(수강자수)  석차등급
   * PDF에서 뽑은 글은 칸이 흐트러지기 쉬워 '숫자/숫자(숫자)' 덩어리를 기준으로 찾는다. */
  function parseSubjects(sectionText) {
    if (!sectionText) return [];
    const out = [];
    // 점수 덩어리는 줄 단위로 찾는다 — 과목 이름이 앞 줄의 표 머리글까지 끌어오지 않도록
    const score = /(\d{1,3}(?:\.\d)?)\s*\/\s*(\d{1,3}(?:\.\d)?)\s*\(\s*(\d{1,3}(?:\.\d)?)\s*\)/;
    const level = /([A-E])\s*\(\s*\d+\s*\)/;

    sectionText.split('\n').forEach((line) => {
      const m = line.match(score);
      if (!m) return;
      // 과목 이름 = 점수 바로 앞에 붙은 마지막 낱말
      const nm = line.slice(0, m.index).match(/([가-힣A-Za-z][가-힣A-Za-z·]{1,9})\s*$/);
      if (!nm) return;
      const name = nm[1];
      if (/원점수|과목평균|표준편차|성취도|석차|등급|학점|단위|학기|이수/.test(name)) return;
      const lv = line.slice(m.index + m[0].length).match(level);
      out.push({
        subject: name,
        score: Number(m[1]),
        avg: Number(m[2]),
        sd: Number(m[3]),
        level: lv ? lv[1] : '',
      });
    });
    // 같은 과목이 여러 학기 나오면 마지막 것만 남긴다
    const seen = new Map();
    out.forEach((r) => seen.set(r.subject, r));
    return [...seen.values()];
  }

  /* ── 출결 훑기 ── */
  function parseAttendance(sectionText) {
    if (!sectionText) return null;
    const grab = (kw) => {
      const m = sectionText.match(new RegExp(kw + '\\s*[:：]?\\s*(\\d{1,3})'));
      return m ? Number(m[1]) : null;
    };
    const a = {
      수업일수: grab('수업일수'),
      결석: grab('결석'),
      지각: grab('지각'),
      조퇴: grab('조퇴'),
      결과: grab('결과'),
    };
    return Object.values(a).some((v) => v !== null) ? a : null;
  }

  /* 파일 하나의 텍스트 → 학생 목록 */
  /* parse(글, { single })
   *   single: 여러 학생으로 나누지 않고 통째로 한 명으로 본다.
   *           OCR 로 읽은 글은 영역 머리글이 흐트러져 잘못 나뉘므로,
   *           한 학생의 파일임이 분명할 때 이 선택을 쓴다. */
  function parse(rawText, opts) {
    const blocks = (opts && opts.single) ? [clean(rawText)] : splitStudents(rawText);
    return blocks.map((block, i) => {
      const sections = splitSections(block);
      const name = findName(block);
      return Object.assign({
        id: 'sgb-' + Date.now() + '-' + i,
        name: name || `학생 ${i + 1}`,
        nameFound: !!name,
        raw: block,
        sections,
        sectionNames: Object.keys(sections),
        subjects: parseSubjects(sections['교과학습발달상황']),
        attendance: parseAttendance(sections['출결상황']),
      }, findNumbers(block));
    });
  }

  /* 모델에 넘길 발췌문 만들기
   *   student : parse()가 돌려준 학생 하나
   *   picked  : 넣을 영역 이름 배열
   *   opts    : { maskName, limit } — limit은 영역별 글자 수 상한(작은 모델 보호) */
  function excerpt(student, picked, opts) {
    const o = Object.assign({ maskName: true, limit: 1800 }, opts || {});
    const names = (picked && picked.length ? picked : student.sectionNames)
      .filter((n) => student.sections[n]);

    if (!names.length) {
      // 영역을 못 나눈 경우 원문 앞부분이라도 넘긴다
      return scrub(student.raw.slice(0, o.limit * 2), { maskName: o.maskName, name: student.name });
    }
    const joined = names.map((n) => {
      let body = student.sections[n];
      if (body.length > o.limit) body = body.slice(0, o.limit) + '\n…(이하 생략)';
      return `### ${n}\n${body}`;
    }).join('\n\n');
    return scrub(joined, { maskName: o.maskName, name: student.name });
  }

  window.Saenggibu = { SECTIONS: SECTIONS.map((s) => s[0]), CORE, parse, scrub, excerpt, clean };
})();
