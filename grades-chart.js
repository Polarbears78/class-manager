/* grades-chart.js — 과목별 성적 변화 그래프와 점수표
 *
 * [성적] 페이지에 입력한 점수로 그린다. 학부모 안내문(handout.html)과
 * 상담 자료(report.html)가 같은 그림을 쓰도록 여기 한곳에 모았다.
 *
 * 인쇄에서 배경색이 빠져도 읽히도록 인라인 SVG로 그리고,
 * 정확한 값은 바로 아래 점수표가 싣는다. 표의 색 표식이 그래프의 범례를 겸한다.
 *
 * 쓰는 쪽에서는 admin.css 의 --s1 … --s8 이 정의된 요소(.sheet 또는
 * .grade-chart) 안에 넣어야 과목 색이 나온다.
 */
(function () {
  'use strict';

  const load = (k, fb) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fb; } catch { return fb; }
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SERIES = 8;   // admin.css의 --s1 … --s8

  // 이 학생 점수가 들어 있는 시험만 입력 순서대로
  function examsWith(name) {
    const gdb = load('grades-data', { exams: [] });
    return (gdb.exams || []).filter((e) => {
      const row = (e.scores || {})[name];
      return row && Object.values(row).some((v) => typeof v === 'number');
    });
  }

  // 과목 반평균 — 저장된 값이 있으면 그것을, 없으면 반 전체 점수로 계산
  function classAvg(exam, sub) {
    if (exam.avg && isFinite(exam.avg[sub])) return exam.avg[sub];
    const vals = Object.values(exam.scores || {}).map((r) => r[sub]).filter((x) => typeof x === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  // 여러 시험에 걸친 과목 목록 (처음 나온 순서 유지)
  function subjectsOf(name, exams) {
    const out = [];
    exams.forEach((e) => Object.keys(e.scores[name] || {}).forEach((sub) => {
      if (typeof e.scores[name][sub] === 'number' && !out.includes(sub)) out.push(sub);
    }));
    return out;
  }

  // 변화 표·그래프를 쓸 상황인가 (시험이 2회 이상이어야 변화가 있다)
  function usesTrend(name, mode) {
    return mode !== 'bar' && examsWith(name).length >= 2;
  }

  /* 과목 × 시험 점수표 — 맨 오른쪽에 처음→마지막 변화 */
  function scoreTable(name, exams, subs) {
    let h = '<table class="score-table"><thead><tr><th>과목</th>';
    exams.forEach((e) => { h += `<th>${esc(e.name)}</th>`; });
    h += '<th>변화</th></tr></thead><tbody>';
    subs.forEach((sub, i) => {
      h += `<tr><th><span class="s-key" style="background:var(--s${(i % SERIES) + 1})"></span>${esc(sub)}</th>`;
      const seen = [];
      exams.forEach((e) => {
        const v = (e.scores[name] || {})[sub];
        if (typeof v !== 'number') { h += '<td class="s-none">—</td>'; return; }
        seen.push(v);
        const a = classAvg(e, sub);
        h += `<td>${v}${a === null ? '' : `<small>반 ${a.toFixed(0)}</small>`}</td>`;
      });
      if (seen.length < 2) {
        h += '<td class="s-none">—</td>';
      } else {
        const d = seen[seen.length - 1] - seen[0];
        h += `<td class="s-delta${d > 0 ? ' up' : d < 0 ? ' down' : ''}">` +
             `${d > 0 ? '▲ +' + d : d < 0 ? '▼ ' + d : '– 0'}</td>`;
      }
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  /* 과목별 추이 꺾은선 — 숫자는 표가 실으므로 끝점에 과목 이름만 붙인다 */
  function trendSvg(name, exams, subs) {
    const W = 560, H = 200, L = 36, R = 96, T = 14, B = 28;
    let lo = 100, hi = 0, any = false;
    subs.forEach((sub) => exams.forEach((e) => {
      const v = (e.scores[name] || {})[sub];
      if (typeof v === 'number') { lo = Math.min(lo, v); hi = Math.max(hi, v); any = true; }
    }));
    if (!any) return '';
    lo = Math.max(0, Math.floor((lo - 5) / 10) * 10);
    hi = Math.min(100, Math.ceil((hi + 5) / 10) * 10);
    if (hi - lo < 20) { lo = Math.max(0, hi - 20); hi = Math.min(100, lo + 20); }

    const px = (i) => L + (exams.length < 2 ? (W - L - R) / 2 : i * (W - L - R) / (exams.length - 1));
    const py = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));

    let g = `<svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="과목별 점수 추이">`;
    // 가로 눈금은 아래·가운데·위 세 줄만 — 그래프가 조용해야 선이 보인다
    [...new Set([lo, Math.round((lo + hi) / 2), hi])].forEach((v) => {
      g += `<line class="t-grid" x1="${L}" y1="${py(v)}" x2="${W - R}" y2="${py(v)}"/>`;
      g += `<text class="t-ax" x="${L - 6}" y="${py(v) + 4}" text-anchor="end">${v}</text>`;
    });
    exams.forEach((e, i) => {
      g += `<text class="t-ax" x="${px(i)}" y="${H - 8}" text-anchor="middle">${esc(e.name)}</text>`;
    });

    const ends = [];
    subs.forEach((sub, si) => {
      const color = `var(--s${(si % SERIES) + 1})`;
      const pts = [];
      exams.forEach((e, i) => {
        const v = (e.scores[name] || {})[sub];
        if (typeof v === 'number') pts.push([px(i), py(v)]);
      });
      if (!pts.length) return;
      if (pts.length > 1) {
        g += `<polyline class="t-line" stroke="${color}" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
      }
      pts.forEach(([x, y]) => { g += `<circle class="t-dot" cx="${x}" cy="${y}" r="4" fill="${color}"/>`; });
      ends.push({ sub, x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });
    });
    // 끝점 이름은 서로 붙지 않을 때만 — 겹치면 아래 표가 대신 알려 준다
    ends.sort((a, b) => a.y - b.y);
    let lastY = -99;
    ends.forEach((e) => {
      if (e.y - lastY < 13) return;
      lastY = e.y;
      g += `<text class="t-end" x="${e.x + 9}" y="${e.y + 4}">${esc(e.sub)}</text>`;
    });
    return g + '</svg>';
  }

  /* 시험 한 회만 — 본인 점수와 반 평균 막대 */
  function barSvg(name, examId) {
    const gdb = load('grades-data', { exams: [] });
    const exam = (gdb.exams || []).find((e) => String(e.id) === String(examId));
    if (!exam) return { html: '', examName: '' };
    const row = (exam.scores || {})[name];
    if (!row) return { html: '', examName: exam.name };

    const subs = Object.keys(row).filter((s) => typeof row[s] === 'number');
    if (!subs.length) return { html: '', examName: exam.name };

    const W = 560, LABEL = 62, RIGHT = 96, rowH = 26, PAD = 6;
    const barW = W - LABEL - RIGHT;
    const H = subs.length * rowH + PAD * 2 + 16;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="과목별 점수와 반 평균">`;

    subs.forEach((s, i) => {
      const y = PAD + i * rowH;
      const v = row[s];
      const vals = Object.values(exam.scores).map((r) => r[s]).filter((x) => typeof x === 'number');
      const avg = (exam.avg && isFinite(exam.avg[s])) ? exam.avg[s]
        : (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
      const w = Math.max(2, Math.round(barW * Math.min(100, Math.max(0, v)) / 100));

      svg += `<text x="0" y="${y + 14}" class="c-lab">${esc(s)}</text>`;
      svg += `<rect x="${LABEL}" y="${y + 4}" width="${barW}" height="14" rx="7" class="c-bg"/>`;
      svg += `<rect x="${LABEL}" y="${y + 4}" width="${w}" height="14" rx="7" class="c-me"/>`;
      if (avg !== null) {
        const ax = LABEL + Math.round(barW * Math.min(100, Math.max(0, avg)) / 100);
        svg += `<line x1="${ax}" y1="${y + 1}" x2="${ax}" y2="${y + 21}" class="c-avg"/>`;
        svg += `<text x="${W - RIGHT + 8}" y="${y + 14}" class="c-val">${v}점 <tspan class="c-sub">(반 ${avg.toFixed(1)})</tspan></text>`;
      } else {
        svg += `<text x="${W - RIGHT + 8}" y="${y + 14}" class="c-val">${v}점</text>`;
      }
    });
    // 범례
    const ly = PAD + subs.length * rowH + 8;
    svg += `<rect x="${LABEL}" y="${ly}" width="14" height="8" rx="4" class="c-me"/>`;
    svg += `<text x="${LABEL + 20}" y="${ly + 8}" class="c-sub">우리 아이</text>`;
    svg += `<line x1="${LABEL + 92}" y1="${ly - 2}" x2="${LABEL + 92}" y2="${ly + 12}" class="c-avg"/>`;
    svg += `<text x="${LABEL + 100}" y="${ly + 8}" class="c-sub">반 평균</text>`;
    svg += '</svg>';
    return { html: svg, examName: exam.name };
  }

  /* 성적 칸 전체 — 표시 방법에 따라 골라 그린다.
   *   mode  : 'auto' | 'trend' | 'bar'
   *   examId: 막대로 그릴 때 쓸 시험 (비우면 마지막 시험) */
  function gradeBlock(name, mode, examId) {
    if (usesTrend(name, mode)) {
      const exams = examsWith(name);
      const subs = subjectsOf(name, exams);
      if (subs.length) {
        return {
          html: trendSvg(name, exams, subs) + scoreTable(name, exams, subs),
          caption: `${exams[0].name} → ${exams[exams.length - 1].name}`,
        };
      }
    }
    const all = examsWith(name);
    const id = examId || (all.length ? all[all.length - 1].id : '');
    const { html, examName } = barSvg(name, id);
    return { html, caption: examName };
  }

  /* ══════════ 생기부에서 읽어 낸 성적 ══════════
   *
   * [성적] 페이지에 점수를 입력하지 않아도, 생기부 교과학습발달상황에서
   * 읽어 낸 원점수·과목평균으로 바로 그린다.
   *
   * 학기가 둘 이상이면 과목별 변화를, 하나뿐이면 원점수와 과목평균을
   * 나란히 놓은 막대를 그린다. 자유학기제 학기는 원점수가 없어 점수로
   * 잡히지 않으므로, 중학교 생기부는 대개 막대 쪽이 된다.
   */

  // 학년·학기를 하나의 시점으로 묶는다
  function termsOf(subjects) {
    const map = new Map();
    subjects.forEach((r) => {
      const key = `${r.grade || 0}-${r.term || 0}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: r.grade && r.term ? `${r.grade}학년 ${r.term}학기`
              : r.grade ? `${r.grade}학년`
              : r.term ? `${r.term}학기` : '원점수',
          rows: [],
        });
      }
      map.get(key).rows.push(r);
    });
    return [...map.values()];
  }

  /* 원점수와 과목평균을 나란히 — 시점이 하나일 때 */
  function subjectBars(rows) {
    const subs = rows.slice().sort((a, b) => b.score - a.score);
    if (!subs.length) return '';
    const W = 560, LABEL = 74, RIGHT = 118, rowH = 26, PAD = 6;
    const barW = W - LABEL - RIGHT;
    const H = subs.length * rowH + PAD * 2 + 16;
    const at = (v) => LABEL + Math.round(barW * Math.min(100, Math.max(0, v)) / 100);

    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="과목별 원점수와 과목평균">`;
    subs.forEach((r, i) => {
      const y = PAD + i * rowH;
      svg += `<text x="0" y="${y + 14}" class="c-lab">${esc(r.subject)}</text>`;
      svg += `<rect x="${LABEL}" y="${y + 4}" width="${barW}" height="14" rx="7" class="c-bg"/>`;
      svg += `<rect x="${LABEL}" y="${y + 4}" width="${Math.max(2, at(r.score) - LABEL)}" height="14" rx="7" class="c-me"/>`;
      svg += `<line x1="${at(r.avg)}" y1="${y + 1}" x2="${at(r.avg)}" y2="${y + 21}" class="c-avg"/>`;
      svg += `<text x="${W - RIGHT + 8}" y="${y + 14}" class="c-val">${r.score}점 ` +
             `<tspan class="c-sub">(반 ${r.avg.toFixed(1)})</tspan></text>`;
    });
    const ly = PAD + subs.length * rowH + 8;
    svg += `<rect x="${LABEL}" y="${ly}" width="14" height="8" rx="4" class="c-me"/>`;
    svg += `<text x="${LABEL + 20}" y="${ly + 8}" class="c-sub">원점수</text>`;
    svg += `<line x1="${LABEL + 80}" y1="${ly - 2}" x2="${LABEL + 80}" y2="${ly + 12}" class="c-avg"/>`;
    svg += `<text x="${LABEL + 88}" y="${ly + 8}" class="c-sub">과목평균</text>`;
    return svg + '</svg>';
  }

  /* 과목별 표 — 반평균 대비 차이를 함께 실어 강약을 바로 읽게 한다 */
  function subjectTable(terms) {
    const subs = [];
    terms.forEach((t) => t.rows.forEach((r) => {
      if (!subs.includes(r.subject)) subs.push(r.subject);
    }));
    const one = terms.length === 1;
    // 성취도는 OCR 이 통째로 흘리는 일이 잦다. 하나도 못 읽었으면 빈 열을 두지 않는다.
    const hasLevel = terms.some((t) => t.rows.some((r) => r.level));
    let h = '<table class="score-table"><thead><tr><th>과목</th>';
    terms.forEach((t) => { h += `<th>${esc(t.name)}</th>`; });
    h += one ? '<th>반평균 대비</th>' + (hasLevel ? '<th>성취도</th>' : '') : '<th>변화</th>';
    h += '</tr></thead><tbody>';

    subs.forEach((sub, i) => {
      h += `<tr><th><span class="s-key" style="background:var(--s${(i % SERIES) + 1})"></span>${esc(sub)}</th>`;
      const seen = [];
      let last = null;
      terms.forEach((t) => {
        const r = t.rows.find((x) => x.subject === sub);
        if (!r) { h += '<td class="s-none">—</td>'; return; }
        seen.push(r.score); last = r;
        h += `<td>${r.score}<small>반 ${r.avg.toFixed(1)}</small></td>`;
      });
      if (one) {
        const d = last ? last.score - last.avg : 0;
        h += `<td class="s-delta${d > 0 ? ' up' : d < 0 ? ' down' : ''}">` +
             `${d > 0 ? '+' : ''}${d.toFixed(1)}</td>` +
             (hasLevel ? `<td>${esc((last && last.level) || '—')}</td>` : '');
      } else if (seen.length < 2) {
        h += '<td class="s-none">—</td>';
      } else {
        const d = seen[seen.length - 1] - seen[0];
        h += `<td class="s-delta${d > 0 ? ' up' : d < 0 ? ' down' : ''}">` +
             `${d > 0 ? '▲ +' + d : d < 0 ? '▼ ' + d : '– 0'}</td>`;
      }
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  /* 생기부에서 읽어 낸 과목 배열로 성적 칸을 만든다.
   * → { html, caption, kind: 'trend' | 'bar' | '' } */
  function fromSaenggibu(subjects) {
    const rows = (subjects || []).filter((r) => typeof r.score === 'number' && typeof r.avg === 'number');
    if (!rows.length) return { html: '', caption: '', kind: '' };

    const terms = termsOf(rows).sort((a, b) => a.key.localeCompare(b.key));
    if (terms.length >= 2) {
      // 여러 학기가 있으면 시점별 점수를 시험처럼 다뤄 추이를 그린다
      const subs = [];
      terms.forEach((t) => t.rows.forEach((r) => { if (!subs.includes(r.subject)) subs.push(r.subject); }));
      const exams = terms.map((t) => ({
        name: t.name,
        scores: { _: Object.fromEntries(t.rows.map((r) => [r.subject, r.score])) },
        avg: Object.fromEntries(t.rows.map((r) => [r.subject, r.avg])),
      }));
      return {
        html: trendSvg('_', exams, subs) + subjectTable(terms),
        caption: `${terms[0].name} → ${terms[terms.length - 1].name}`,
        kind: 'trend',
      };
    }
    return {
      html: subjectBars(terms[0].rows) + subjectTable(terms),
      caption: terms[0].name === '원점수' ? '원점수와 과목평균'
             : terms[0].name + ' · 원점수와 과목평균',
      kind: 'bar',
    };
  }

  window.GradeChart = {
    SERIES, examsWith, classAvg, subjectsOf, usesTrend,
    scoreTable, trendSvg, barSvg, gradeBlock,
    termsOf, subjectBars, subjectTable, fromSaenggibu,
  };
})();
