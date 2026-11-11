// app.js: 초기화, 탭 전환, 데이터·화면 연결 (T1 + 연결 작업)
// 의존 방향: app → views → status / data.

import { CONFIG } from './config.js';
import { loadData } from './data.js';
import { renderToday } from './views/today.js';
import { renderMap, onMapShown } from './views/map.js';
import { renderAlbum } from './views/album.js';

const TABS = ['today', 'map', 'album'];
const DEFAULT_TAB = 'today';
const TODAY_CHECK_MS = 60000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STYLE_ID = 'app-styles';

const tabButtons = document.querySelectorAll('[role="tab"]');
const panels = {
  today: document.getElementById('view-today'),
  map: document.getElementById('view-map'),
  album: document.getElementById('view-album'),
};

// ---------- 오늘 날짜 ----------

// ?date=YYYY-MM-DD 가 있으면 그 날짜를 "오늘"로 쓴다(테스트용). 없으면 TIMEZONE(부다페스트) 기준 오늘.
function testDate() {
  try {
    const v = new URLSearchParams(location.search).get('date');
    return v && DATE_RE.test(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function getToday() {
  const forced = testDate();
  if (forced) return forced;
  return new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.TIMEZONE }).format(new Date()); // YYYY-MM-DD
}

// ---------- 화면 ----------

// TODO(질문): 아래 두 문구와 모양(테스트 날짜 띠, 하단 실패 안내)은 설계서 문구를 그대로 못 옮겨 요약해 둔 것이라 설계서와 한 번 대조 필요.
const CSS = `
.app-test-band { position: fixed; top: var(--header-h); left: 0; right: 0; z-index: 1001; padding: 2px var(--gutter); background: var(--accent); color: #fff; font-size: 15px; line-height: 1.5; text-align: center; }
.app-notice { margin-top: 16px; text-align: center; font-size: 15px; color: var(--ink-2); }
`;

let state = null;
let today = null;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function renderBand() {
  const old = document.querySelector('.app-test-band');
  if (old) old.remove();
  const forced = testDate();
  if (!forced) return;
  const band = document.createElement('div');
  band.className = 'app-test-band';
  band.textContent = `테스트 날짜 ${forced}`;
  document.body.appendChild(band);
}

// 시트를 불러오지 못했을 때만 오늘·앨범 탭 맨 아래에 안내를 붙인다.
function appendNotice(root) {
  if (!state || !state.fetchFailed) return;
  const p = document.createElement('p');
  p.className = 'app-notice';
  p.textContent = '최신 소식을 불러오지 못했어요';
  root.appendChild(p);
}

function renderAll() {
  if (!state) return;
  renderToday(panels.today, state, today);
  appendNotice(panels.today);
  renderMap(panels.map, state, today);
  renderAlbum(panels.album, state, today);
  appendNotice(panels.album);
  renderBand();
}

// ---------- 탭 ----------

function isTab(name) {
  return TABS.includes(name);
}

function showTab(name) {
  const target = isTab(name) ? name : DEFAULT_TAB;

  for (const tab of TABS) {
    panels[tab].hidden = tab !== target;
  }
  for (const btn of tabButtons) {
    btn.setAttribute('aria-selected', btn.dataset.tab === target ? 'true' : 'false');
  }

  // 지도 탭이 보이게 된 직후: 처음이면 지도를 만들고, 그 뒤에는 invalidateSize()
  if (target === 'map') onMapShown();
  return target;
}

function tabFromHash() {
  return location.hash.replace('#', '');
}

// 탭 버튼을 누르면 해시만 바꾼다(페이지 이동 없음). 실제 전환은 hashchange에서 처리.
for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
    const next = `#${btn.dataset.tab}`;
    if (location.hash === next) {
      showTab(btn.dataset.tab);
    } else {
      location.hash = next;
    }
  });
}

window.addEventListener('hashchange', () => {
  const target = showTab(tabFromHash());
  // 알 수 없는 해시는 오늘 탭으로 되돌리고 주소도 맞춘다.
  if (tabFromHash() !== target) {
    history.replaceState(null, '', `#${target}`);
  }
});

// ---------- 시작 ----------

ensureStyles();

// 첫 진입 탭은 항상 오늘 탭(화면 명세 도입부).
// TODO(질문): 첫 진입 때 주소에 #map 처럼 다른 해시가 있어도 오늘 탭으로 열고 해시를 #today로 바꿈. 해시를 존중해야 하면 알려주세요.
showTab(DEFAULT_TAB);
history.replaceState(null, '', `${location.search}#${DEFAULT_TAB}`);

today = getToday();

// 데이터가 바뀔 때마다(기본값 → 캐시 → 시트) 세 화면을 다시 그린다.
loadData((next) => {
  state = next;
  today = getToday();
  renderAll();
});

// 60초마다 날짜가 바뀌었는지 확인해, 바뀌었으면 다시 그린다(자정 넘김 대응).
setInterval(() => {
  const now = getToday();
  if (now !== today) {
    today = now;
    renderAll();
  }
}, TODAY_CHECK_MS);
