/*
 * hwp.js — 나이스에서 내려받은 생기부 한글(.hwp) 파일 읽기
 *
 * 나이스 생기부는 위·변조를 막으려고 글자를 모두 그림으로 찍어 넣습니다.
 * 그래서 파일 안에 글자 데이터가 한 자도 없고, 대신 문장 덩어리·낱글자가
 * 수백 장의 PNG로 들어 있습니다. 이 파일은 그 그림들을 문서에 놓인 순서
 * 그대로 꺼내 줍니다. 읽는 일(글자 알아보기)은 학교 AI 서버가 맡습니다.
 *
 * 하는 일
 *   1) .hwp 는 OLE 복합 파일 — 그 안의 작은 파일 목록을 읽고
 *   2) BodyText/Section0..N 을 풀어(raw deflate) 레코드로 훑고
 *   3) 그림 레코드(태그 85)에서 그림 번호를 순서대로 모아
 *   4) BinData/BIN####.png 를 그 순서대로 돌려줍니다
 *
 * 파일 내용은 브라우저 밖으로 나가지 않습니다.
 */
(function (global) {
  'use strict';

  const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const FREE = 0xffffffff, END = 0xfffffffe;

  // ── OLE 복합 파일 ──────────────────────────────────────────────
  function readOle(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    for (let i = 0; i < 8; i++) {
      if (u8[i] !== OLE_SIG[i]) throw new Error('한글(.hwp) 파일이 아닙니다.');
    }

    const secSize = 1 << dv.getUint16(30, true);
    const miniSize = 1 << dv.getUint16(32, true);
    const dirStart = dv.getUint32(48, true);
    const miniCutoff = dv.getUint32(56, true);
    const miniFatStart = dv.getUint32(60, true);
    const difatStart = dv.getUint32(68, true);
    const difatCount = dv.getUint32(72, true);
    const secOff = (n) => (n + 1) * secSize;

    // DIFAT — 앞 109개는 헤더 안에, 나머지는 별도 섹터에 이어진다
    const difat = [];
    for (let i = 0; i < 109; i++) {
      const v = dv.getUint32(76 + i * 4, true);
      if (v !== FREE) difat.push(v);
    }
    let ds = difatStart;
    for (let k = 0; k < difatCount && ds !== END && ds !== FREE; k++) {
      const base = secOff(ds);
      const per = secSize / 4 - 1;
      for (let i = 0; i < per; i++) {
        const v = dv.getUint32(base + i * 4, true);
        if (v !== FREE) difat.push(v);
      }
      ds = dv.getUint32(base + per * 4, true);
    }

    // FAT — 섹터 사슬표
    const fat = new Uint32Array(difat.length * (secSize / 4));
    difat.forEach((sec, k) => {
      const base = secOff(sec);
      for (let i = 0; i < secSize / 4; i++) fat[k * (secSize / 4) + i] = dv.getUint32(base + i * 4, true);
    });

    const chain = (start, table) => {
      const out = [];
      let s = start, guard = 0;
      while (s !== END && s !== FREE && s < table.length && guard++ < 1e6) { out.push(s); s = table[s]; }
      return out;
    };
    const readChain = (start, size, table, unit, offsetOf) => {
      const secs = chain(start, table);
      const out = new Uint8Array(secs.length * unit);
      secs.forEach((s, i) => out.set(u8.subarray(offsetOf(s), offsetOf(s) + unit), i * unit));
      return size >= 0 ? out.subarray(0, size) : out;
    };

    // 디렉터리 — 이름·크기·시작 섹터가 128바이트씩 늘어서 있다
    const dirBytes = readChain(dirStart, -1, fat, secSize, secOff);
    const dirs = [];
    for (let i = 0; i + 128 <= dirBytes.length; i += 128) {
      const nameLen = dirBytes[i + 64] | (dirBytes[i + 65] << 8);
      let name = '';
      for (let c = 0; c + 1 < Math.max(0, nameLen - 2); c += 2) {
        name += String.fromCharCode(dirBytes[i + c] | (dirBytes[i + c + 1] << 8));
      }
      const d = new DataView(dirBytes.buffer, dirBytes.byteOffset + i, 128);
      dirs.push({
        name, type: dirBytes[i + 66],
        left: d.getUint32(68, true), right: d.getUint32(72, true), child: d.getUint32(76, true),
        start: d.getUint32(116, true), size: d.getUint32(120, true),
      });
    }

    // 미니 스트림 — 4096바이트보다 작은 것들은 여기 모여 있다
    const miniFatBytes = readChain(miniFatStart, -1, fat, secSize, secOff);
    const miniFat = new Uint32Array(miniFatBytes.buffer, miniFatBytes.byteOffset,
                                    Math.floor(miniFatBytes.length / 4));
    const root = dirs[0];
    const miniStream = root && root.start !== END ? readChain(root.start, root.size, fat, secSize, secOff)
                                                  : new Uint8Array(0);

    // 이름 → 스트림. 빨강-검정 트리를 훑어 경로를 만든다
    const files = new Map();
    (function walk(id, prefix) {
      if (id === FREE || id >= dirs.length) return;
      const e = dirs[id];
      walk(e.left, prefix);
      const path = prefix ? prefix + '/' + e.name : e.name;
      if (e.type === 2) files.set(path, e);
      else if (e.type === 1) walk(e.child, path);
      walk(e.right, prefix);
    })(root ? root.child : FREE, '');

    const read = (path) => {
      const e = files.get(path);
      if (!e) return null;
      if (e.size < miniCutoff) {
        const secs = chain(e.start, miniFat);
        const out = new Uint8Array(secs.length * miniSize);
        secs.forEach((s, i) => out.set(miniStream.subarray(s * miniSize, s * miniSize + miniSize), i * miniSize));
        return out.subarray(0, e.size);
      }
      return readChain(e.start, e.size, fat, secSize, secOff);
    };
    return { names: [...files.keys()], read };
  }

  /* ── 압축 풀기 (헤더 없는 deflate) ────────────────────────────
   *
   * 한글의 구역 자료는 '헤더 없는 deflate + 꼬리표 8바이트' 꼴이다.
   * 꼬리표는 gzip 과 같은 모양으로 CRC32(4) + 원본 길이(4)가 들어 있다.
   * DecompressionStream 은 이 남는 8바이트를 보고 오류를 내면서 아직
   * 내보내지 않은 내용까지 버리므로, 꼬리표를 먼저 떼고 푼 뒤 길이가
   * 맞는지 확인한다. 꼬리표가 없는 파일을 위해 통째로 푸는 길도 남겨 둔다.
   */
  function inflateChunks(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});

    const reader = ds.readable.getReader();
    return (async () => {
      const chunks = [];
      let total = 0, failed = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.length;
        }
      } catch (err) {
        failed = true;
      }
      const out = new Uint8Array(total);
      let at = 0;
      chunks.forEach((c) => { out.set(c, at); at += c.length; });
      return { out, failed };
    })();
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('이 브라우저는 한글 파일 압축을 풀지 못합니다. 최신 크롬·엣지로 열어 주세요.');
    }
    if (bytes.length > 8) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      const expect = dv.getUint32(bytes.length - 4, true);
      const body = await inflateChunks(bytes.subarray(0, bytes.length - 8));
      if (!body.failed && body.out.length === expect) return body.out;
    }
    // 꼬리표가 없거나 길이가 안 맞으면 통째로 풀어 본다
    const whole = await inflateChunks(bytes);
    if (!whole.out.length) {
      throw new Error('한글 파일의 압축을 풀지 못했습니다. 파일이 손상되었을 수 있습니다.');
    }
    return whole.out;
  }

  // ── HWP 레코드 ───────────────────────────────────────────────
  // 4바이트 머리 = 태그(10비트) + 수준(10비트) + 길이(12비트),
  // 길이가 0xFFF면 다음 4바이트가 진짜 길이다
  function* records(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    let i = 0;
    while (i + 4 <= bytes.length) {
      const head = dv.getUint32(i, true); i += 4;
      const tag = head & 0x3ff;
      let size = (head >>> 20) & 0xfff;
      if (size === 0xfff) { size = dv.getUint32(i, true); i += 4; }
      if (i + size > bytes.length) return;
      yield { tag, body: bytes.subarray(i, i + size) };
      i += size;
    }
  }

  const TAG_PICTURE = 85;   // HWPTAG_SHAPE_COMPONENT_PICTURE
  const ID_OFFSET = 71;     // 그림 속성 안에서 그림 번호가 놓인 자리

  function mimeOf(b) {
    if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
    if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
    return '';
  }

  // 그림의 가로·세로. 낱글자 조각과 문장 덩어리를 가려내는 데 쓴다
  function sizeOf(b, mime) {
    try {
      if (mime === 'image/png') {
        const dv = new DataView(b.buffer, b.byteOffset, b.length);
        return { w: dv.getUint32(16), h: dv.getUint32(20) };
      }
      if (mime === 'image/jpeg') {
        let i = 2;
        while (i + 9 < b.length) {
          if (b[i] !== 0xff) { i++; continue; }
          const m = b[i + 1];
          // SOF0~SOF15 (재시작·기타 표식 제외)
          if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
            return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
          }
          i += 2 + ((b[i + 2] << 8) | b[i + 3]);
        }
      }
    } catch { /* 알 수 없으면 0 */ }
    return { w: 0, h: 0 };
  }

  /**
   * .hwp 를 읽어 그림을 문서 순서대로 돌려준다.
   * @param {ArrayBuffer} buf
   * @returns {Promise<{compressed:boolean, sections:number, images:Array}>}
   *   images: [{ section, order, id, mime, bytes, size }]
   */
  async function read(buf) {
    const ole = readOle(buf);

    const header = ole.read('FileHeader');
    if (!header || header.length < 40) throw new Error('한글 파일 머리말을 읽지 못했습니다.');
    const flags = new DataView(header.buffer, header.byteOffset, header.length).getUint32(36, true);
    if (flags & 0x2) throw new Error('암호가 걸린 한글 파일입니다. 암호를 푼 뒤 다시 올려 주세요.');
    const compressed = !!(flags & 0x1);

    // BinData 는 이름이 확장자까지 붙어 있어 번호로 찾아 둔다
    const bin = new Map();
    ole.names.forEach((n) => {
      const m = n.match(/^BinData\/BIN([0-9A-Fa-f]{4})\./);
      if (m) bin.set(parseInt(m[1], 16), n);
    });

    const sections = ole.names.filter((n) => /^BodyText\/Section\d+$/.test(n))
                             .sort((a, b) => (+a.match(/\d+$/)[0]) - (+b.match(/\d+$/)[0]));

    const images = [];
    const seen = new Set();
    for (let s = 0; s < sections.length; s++) {
      let data = ole.read(sections[s]);
      if (compressed) data = await inflateRaw(data);
      for (const rec of records(data)) {
        if (rec.tag !== TAG_PICTURE || rec.body.length < ID_OFFSET + 2) continue;
        const id = rec.body[ID_OFFSET] | (rec.body[ID_OFFSET + 1] << 8);
        const name = bin.get(id);
        if (!name) continue;
        // 같은 그림이 여러 번 놓이는 경우가 있어 처음 나온 자리만 쓴다
        if (seen.has(id)) continue;
        seen.add(id);
        let bytes = ole.read(name);
        if (bytes && !mimeOf(bytes)) {
          try { bytes = await inflateRaw(bytes); } catch { /* 원본 그대로 */ }
        }
        const mime = mimeOf(bytes);
        if (!bytes || !mime) continue;
        const { w, h } = sizeOf(bytes, mime);
        images.push({ section: s, order: images.length, id, mime, bytes, size: bytes.length, w, h });
      }
    }
    return { compressed, sections: sections.length, images };
  }

  /**
   * 글이 담긴 그림만 골라낸다.
   *
   * 나이스 생기부의 그림은 두 갈래다. 표 칸에 든 낱글자 조각(가로 20px 안팎)과,
   * 세부능력·행동특성 같은 서술형 문장 덩어리(가로 1400px 안팎)다.
   * 낱글자를 한 장씩 OCR에 보내면 느리기만 하고 잘 맞지도 않으므로,
   * 가로 길이로 걸러 글줄이 든 그림만 넘긴다.
   * (성적·출결 표는 [성적] 페이지에 직접 입력한 값을 쓴다.)
   */
  function textImages(images, minWidth) {
    const cut = minWidth || 200;
    return images.filter((im) => im.w >= cut);
  }

  global.HwpReader = { read, textImages, records, readOle, sizeOf };
})(typeof window !== 'undefined' ? window : globalThis);
