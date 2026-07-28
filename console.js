/* 공통: 대시보드에서 저장한 학급 이름을 모든 페이지에 적용
 * localStorage 'console-class-name' → .js-class 요소와 문서 제목 */
(function () {
  var name = '';
  try { name = localStorage.getItem('console-class-name') || ''; } catch (e) {}
  if (!name) return;
  document.querySelectorAll('.js-class').forEach(function (el) { el.textContent = name; });
  document.title = document.title.replace('우리 반', name);
})();
