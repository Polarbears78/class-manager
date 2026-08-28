# vendor — 밖에서 가져온 파일

인터넷이 막힌 학교에서도 PDF를 읽을 수 있도록, CDN에서 받아 오던 파일을
저장소에 함께 넣어 둔 것입니다. 콘솔은 CDN을 먼저 시도하고
실패하면 이 폴더를 씁니다.

| 파일 | 무엇 | 출처 |
|---|---|---|
| `pdf.min.js` · `pdf.worker.min.js` | PDF에서 글자를 뽑고 쪽을 그림으로 그리는 데 씁니다 | [PDF.js](https://mozilla.github.io/pdf.js/) 3.11.174 · Apache-2.0 · Mozilla |

`pdf.js-LICENSE` 에 원 라이선스 전문을 함께 두었습니다.

## 판올림하려면

```bash
npm pack pdfjs-dist@<버전>
tar xzf pdfjs-dist-<버전>.tgz
cp package/build/pdf.min.js package/build/pdf.worker.min.js vendor/
```

`report.html` 의 CDN 주소에 적힌 버전도 함께 맞춰 주세요.
