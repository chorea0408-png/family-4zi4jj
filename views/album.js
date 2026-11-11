// views/album.js: 앨범 탭 (T6)
// 의존 방향: app → views → status / data. 이 파일은 state와 today(날짜 문자열)만 읽는다.
// 사용: renderAlbum(rootElement, state, today)
//   state = { cities, days, ... }  (data.js의 결과), today = 'YYYY-MM-DD' (app.js가 정함, ?date= 우선)

import { visibleNews } from '../status.js';

const STYLE_ID = 'album-view-styles';

// TODO(질문): T6 산출 파일에 styles.css가 없어서, 이 탭의 스타일을 여기서 <style>로 한 번만 넣음(오늘 탭과 같은 방식). styles.css로 옮길지 확인 필요.
const CSS = `
.album-section-title { margin: 8px 0 12px; font-size: 20px; font-weight: 700; line-height: 1.4; }
.album-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
.album-city { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 64px; padding: 8px 12px; border-radius: var(--radius); font-size: 18px; font-weight: 700; line-height: 1.35; text-align: center; text-decoration: none; word-break: keep-all; }
.album-city--on { background: var(--accent); color: #fff; }
.album-city--off { background: var(--card); color: var(--ink-2); border: 1px solid var(--line); opacity: 0.6; }
.album-city__soon { font-size: 15px; font-weight: 400; line-height: 1.3; }
.album-list { list-style: none; margin: 0; padding: 0; }
.album-item { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 20px; margin-bottom: 12px; }
.album-item__meta { font-size: 15px; line-height: 1.4; color: var(--ink-2); }
.album-item__plan { margin-top: 4px; font-size: 16px; line-height: 1.5; color: var(--ink-2); }
.album-item__news { margin-top: 4px; font-size: 18px; line-height: 1.6; color: var(--ink); }
.album-item__btn { display: flex; align-items: center; justify-content: center; min-height: 48px; margin-top: 12px; padding: 6px 16px; background: var(--card); color: var(--accent); border: 1px solid var(--accent); border-radius: var(--radius); font-size: 16px; font-weight: 700; line-height: 1.4; text-align: center; text-decoration: none; }
.album-empty { padding: 24px 0; text-align: center; color: var(--ink-2); }
`;

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  timeZone: 'UTC',
});

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// 'YYYY-MM-DD' → "11월 13일 (금)" 모양. Date.UTC + timeZone:'UTC'라서 사는 곳의 시간대와 상관없이 요일이 맞는다.
function dateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return dateFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

function externalLink(className, href, text) {
  const a = el('a', className, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

// ---------- 위쪽: 도시별 앨범 버튼 ----------

function cityLabel(city, stays) {
  // 같은 이름의 도시가 둘 이상이면(부다페스트) 1차·2차로 나눠 보여 준다.
  // TODO(질문): 버튼 이름 모양이 설계서에 없어서 "부다페스트 1", "부다페스트 2"로 씀. "처음 만난/다시 돌아온"(지도 탭)과 맞출지 확인 필요.
  const same = stays.filter((c) => c.name_ko === city.name_ko);
  const base = `${city.flag} ${city.name_ko}`;
  if (same.length > 1) return `${base} ${same.indexOf(city) + 1}`;
  return base;
}

function buildCityGrid(cities) {
  const stays = cities.filter((c) => c.kind === 'stay');
  const grid = el('div', 'album-grid');
  for (const city of stays) {
    const label = cityLabel(city, stays);
    if (city.album_url) {
      grid.append(externalLink('album-city album-city--on', city.album_url, label));
    } else {
      // 링크가 없으면 눌리지 않는 흐린 칸 + "곧 올라와요"
      const box = el('div', 'album-city album-city--off');
      box.append(el('span', null, label), el('span', 'album-city__soon', '곧 올라와요'));
      grid.append(box);
    }
  }
  return grid;
}

// ---------- 아래쪽: 날짜별 소식 ----------

function buildItem(day, cityById) {
  const li = el('li', 'album-item');

  const isHome = day.city_id === 'home';
  const city = isHome ? null : cityById.get(day.city_id) || null;

  let place = '';
  if (isHome) place = '🇰🇷 한국';
  else if (city) place = `${city.flag} ${city.name_ko}`;

  li.append(el('div', 'album-item__meta', place ? `${dateLabel(day.date)} · ${place}` : dateLabel(day.date)));
  if (day.plan) li.append(el('p', 'album-item__plan', day.plan));
  if (day.news) li.append(el('p', 'album-item__news', day.news));

  // home 행에는 사진 버튼 없음. 앨범 링크가 없는 도시도 버튼을 만들지 않는다(위쪽 칸에서 "곧 올라와요"로 알림).
  // TODO(질문): 도시에 album_url이 없을 때 이 목록 안의 버튼을 숨길지 "곧 올라와요"를 보여줄지 설계서에 없어서 숨김.
  if (city && city.album_url) {
    li.append(externalLink('album-item__btn', city.album_url, `📷 ${city.name_ko} 사진 보기`));
  }
  return li;
}

export function renderAlbum(root, state, today) {
  ensureStyles();

  const frag = document.createDocumentFragment();

  frag.append(el('h2', 'album-section-title', '도시별 사진'));
  frag.append(buildCityGrid(state.cities));

  frag.append(el('h2', 'album-section-title', '날짜별 소식'));
  const items = visibleNews(state.days, today); // 오늘까지, 최신순. 미래 날짜는 여기서 이미 빠짐
  if (items.length === 0) {
    frag.append(el('p', 'album-empty', '여행 소식이 곧 올라와요'));
  } else {
    const cityById = new Map(state.cities.map((c) => [c.city_id, c]));
    const ul = el('ul', 'album-list');
    for (const day of items) ul.append(buildItem(day, cityById));
    frag.append(ul);
  }

  root.replaceChildren(frag);
}
