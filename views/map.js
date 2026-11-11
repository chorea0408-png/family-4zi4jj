// views/map.js: 지도 탭 (T5)
// 의존 방향: app → views → status / data. 전역 Leaflet(L)이 먼저 로드되어 있어야 함(index.html).
//
// 사용
//   renderMap(rootElement, state, today)  데이터가 바뀔 때마다 호출. 지도가 이미 있으면 다시 그림.
//   onMapShown()                          지도 탭이 화면에 보이게 된 직후 호출. 처음이면 지도를 만들고, 그 뒤에는 invalidateSize().
// TODO(질문): 탭이 바뀐 사실을 알리는 방식이 설계서에 없어서, app.js가 지도 탭을 보여 준 뒤 onMapShown()을 부르는 것으로 가정함.

import { getStatus, cityState, segmentDone, visibleNews } from '../status.js';

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

const STATE_TEXT = { past: '지나온 곳', current: '지금 여기', upcoming: '곧 갈 곳' };

let root = null;
let canvas = null;
let sheet = null;
let map = null;
let layers = null;
let latest = null; // { state, today }
let groups = [];
let selectedKey = null;

// ---------- 작은 도구 ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// 디자인 토큰(CSS 변수)을 읽는다. SVG 선 색은 var()를 못 쓰므로 실제 값이 필요함.
function token(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}

function utcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// "11월 13일 – 16일 · 3박"
function rangeText(city) {
  const [, am, ad] = city.arrive.split('-').map(Number);
  const [, dm, dd] = city.depart.split('-').map(Number);
  const nights = Math.round((utcMs(city.depart) - utcMs(city.arrive)) / 86400000);
  const to = am === dm ? `${dd}일` : `${dm}월 ${dd}일`;
  return `${am}월 ${ad}일 – ${to} · ${nights}박`;
}

// 같은 좌표에 있는 머무는 도시(stay)를 한 핀으로 묶는다(부다페스트 1·2차).
function groupStays(cities) {
  const list = [];
  const byKey = new Map();
  for (const c of cities) {
    if (c.kind !== 'stay') continue;
    const key = `${c.lat},${c.lng}`;
    if (!byKey.has(key)) {
      const g = { key, lat: c.lat, lng: c.lng, cities: [] };
      byKey.set(key, g);
      list.push(g);
    }
    byKey.get(key).cities.push(c);
  }
  return list;
}

// 한 핀 안에 도시가 둘 이상일 때의 핀 상태: 하나라도 current면 current, 아니면 하나라도 past면 past, 그 밖은 upcoming
// TODO(질문): 부다페스트처럼 1차는 지나갔고 2차는 아직인 때의 핀 모양이 설계서에 없어서 "지나온 도시"(past)로 그림.
function pinState(group, today, statusCityId) {
  const states = group.cities.map((c) => cityState(c, today, statusCityId));
  if (states.includes('current')) return 'current';
  if (states.includes('past')) return 'past';
  return 'upcoming';
}

// ---------- 지도 그리기 ----------

function pinIcon(state, name) {
  const wrap = el('div', `map-pin map-pin--${state}`);
  if (state === 'current') wrap.append(el('span', 'map-pin__ring'));
  wrap.append(el('span', 'map-pin__dot'));
  // TODO(질문): 도시 이름 라벨은 설계서대로 14px로 했는데, 접근성 규칙의 "보조 글씨 15px 이상"과 숫자가 다름.
  wrap.append(el('span', 'map-pin__label', name));
  return L.divIcon({ className: 'map-pin-icon', html: wrap, iconSize: [0, 0] });
}

function draw() {
  if (!map || !latest) return;
  const { state, today } = latest;
  const status = getStatus(today, state);
  const statusCityId = status.city ? status.city.city_id : null;

  const accent = token('--accent', '#C8553D');
  const line = token('--line', '#E6E0D8');

  layers.clearLayers();
  groups = groupStays(state.cities);

  // 경로선: order 순서대로 1→7을 잇는다. 지나온 구간은 accent 실선, 남은 구간은 line 점선.
  // TODO(질문): 남은 구간 색(line #E6E0D8)이 지도 배경과 비슷해 잘 안 보일 수 있음. 설계서 값을 그대로 썼음.
  for (let i = 0; i < state.cities.length - 1; i++) {
    const from = state.cities[i];
    const to = state.cities[i + 1];
    const done = segmentDone(from, to, today);
    const style = done
      ? { color: accent, weight: 4, opacity: 1 }
      : { color: line, weight: 3, opacity: 1, dashArray: '6 8' };
    L.polyline([[from.lat, from.lng], [to.lat, to.lng]], { ...style, interactive: false }).addTo(layers);
  }

  // 경유지(via): line 색 작은 점, 탭 반응 없음
  for (const c of state.cities) {
    if (c.kind !== 'via') continue;
    L.circleMarker([c.lat, c.lng], {
      radius: 5,
      color: line,
      weight: 1,
      fillColor: line,
      fillOpacity: 1,
      interactive: false,
    }).addTo(layers);
  }

  // 머무는 도시 핀(같은 좌표는 하나)
  for (const g of groups) {
    const st = pinState(g, today, statusCityId);
    const name = g.cities[0].name_ko;
    const marker = L.marker([g.lat, g.lng], {
      icon: pinIcon(st, name),
      title: name,
      keyboard: true,
      zIndexOffset: st === 'current' ? 1000 : 0,
    });
    marker.on('click', () => openSheet(g.key));
    marker.addTo(layers);
  }

  refreshSheet();
}

// ---------- 하단 시트 ----------

function photoPart(city) {
  if (city.album_url) {
    const a = el('a', 'map-btn', `📷 ${city.name_ko} 사진 보러 가기`);
    a.href = city.album_url;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }
  return el('p', 'map-album-empty', '사진이 곧 올라와요');
}

function cityBlock(city, today, state, statusCityId, title) {
  const block = el('section', 'map-zone');
  if (title) block.append(el('h3', 'map-zone__title', title));

  const meta = el('div', 'map-zone__meta');
  meta.append(el('span', 'map-zone__range', rangeText(city)));
  const st = cityState(city, today, statusCityId);
  meta.append(el('span', `map-chip map-chip--${st}`, STATE_TEXT[st]));
  block.append(meta);

  // 그 도시의 한 줄 소식을 최신순으로 최대 3개(오늘까지의 날짜만)
  const news = visibleNews(state.days, today)
    .filter((d) => d.city_id === city.city_id && d.news)
    .slice(0, 3);
  if (news.length > 0) {
    const ul = el('ul', 'map-news');
    for (const d of news) ul.append(el('li', null, d.news));
    block.append(ul);
  }

  block.append(photoPart(city));
  return block;
}

function refreshSheet() {
  if (!sheet || selectedKey === null || !latest) return;
  const group = groups.find((g) => g.key === selectedKey);
  if (!group) {
    closeSheet();
    return;
  }
  const { state, today } = latest;
  const status = getStatus(today, state);
  const statusCityId = status.city ? status.city.city_id : null;
  const first = group.cities[0];

  const head = el('div', 'map-sheet__head');
  const flag = el('span', 'map-sheet__flag', first.flag);
  flag.setAttribute('aria-hidden', 'true');
  head.append(flag, el('h2', 'map-sheet__name', first.name_ko));

  const parts = [head];
  if (group.cities.length === 1) {
    parts.push(cityBlock(first, today, state, statusCityId, null));
  } else {
    // 부다페스트: "처음 만난 부다페스트", "다시 돌아온 부다페스트" 두 구역에 각각 앨범 버튼
    // TODO(질문): 같은 좌표에 도시가 3개 이상이면 구역 제목이 설계서에 없어 두 번째 이후도 "다시 돌아온"으로 씀.
    group.cities.forEach((c, i) => {
      const title = i === 0 ? `처음 만난 ${c.name_ko}` : `다시 돌아온 ${c.name_ko}`;
      parts.push(cityBlock(c, today, state, statusCityId, title));
    });
  }

  const close = el('button', 'map-close', '닫기');
  close.type = 'button';
  close.addEventListener('click', closeSheet);
  parts.push(close);

  sheet.replaceChildren(...parts);
}

function openSheet(key) {
  selectedKey = key;
  refreshSheet();
  sheet.scrollTop = 0;
  sheet.classList.add('is-open');
  sheet.setAttribute('aria-hidden', 'false');
}

function closeSheet() {
  selectedKey = null;
  if (!sheet) return;
  sheet.classList.remove('is-open');
  sheet.setAttribute('aria-hidden', 'true');
}

// ---------- 바깥에서 부르는 함수 ----------

function initMap() {
  map = L.map(canvas, { zoomControl: false, attributionControl: true });
  // TODO(질문): 설계서에 확대·축소 버튼 이야기가 없고 범례가 왼쪽 위라서 기본 +/- 버튼은 끔(두 손가락 확대는 가능).
  L.tileLayer(TILE_URL, { subdomains: 'abcd', maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  layers = L.layerGroup().addTo(map);

  // 처음에는 전체 도시가 보이도록(padding 32px)
  const points = latest.state.cities.map((c) => [c.lat, c.lng]);
  if (points.length > 0) map.fitBounds(L.latLngBounds(points), { padding: [32, 32] });

  draw();
}

function buildScaffold(rootEl) {
  root = rootEl;
  root.replaceChildren();

  canvas = el('div', 'map-canvas');

  const legend = el('div', 'map-legend');
  // 범례: "━ 지나온 길  ╌ 남은 길" (왼쪽 위)
  const done = el('span', 'map-legend__done', '━');
  const rest = el('span', 'map-legend__rest', '╌');
  legend.append(done, ' 지나온 길   ', rest, ' 남은 길');

  sheet = el('div', 'map-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-hidden', 'true');

  root.append(canvas, legend, sheet);
}

export function renderMap(rootEl, state, today) {
  if (root !== rootEl) {
    // 새 루트면 처음부터 다시 만든다.
    if (map) {
      map.remove();
      map = null;
      layers = null;
    }
    selectedKey = null;
    buildScaffold(rootEl);
  }
  latest = { state, today };
  draw(); // 지도가 아직 없으면 아무 일도 하지 않음. 처음 열릴 때 onMapShown()이 그린다.
}

export function onMapShown() {
  if (!root || !latest) return;
  if (!map) {
    initMap();
  } else {
    map.invalidateSize();
  }
}
