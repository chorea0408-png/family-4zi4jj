// data.js: 데이터 로딩 (T2)
// 로딩 순서: ① 내장 기본값 즉시 → ② 캐시 → ③ 시트 CSV(병렬 fetch).
// 이 파일은 화면(DOM)을 그리지 않는다. 결과는 onUpdate 콜백으로 state 모양 객체를 넘긴다.
// 전제: PapaParse가 전역 `Papa`로 먼저 로드되어 있어야 함(index.html에서 로드).

import { CONFIG } from './config.js';
import { DEFAULT_CITIES_CSV, DEFAULT_DAYS_CSV } from './data.default.js';

const CACHE_KEY = 'hyn-honeymoon-family-v1';
const FETCH_TIMEOUT_MS = 8000;
const STALE_MS = 5 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALBUM_PREFIXES = ['https://photos.app.goo.gl/', 'https://photos.google.com/'];

// ---------- 정규화 · 검증 (데이터 스키마 4장) ----------

// 1. 앞뒤 공백 제거, 빈 문자열은 null
function clean(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function parseCsv(text) {
  const body = String(text).replace(/^\uFEFF/, '');
  const result = Papa.parse(body, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  return result.data.map((row) => {
    const out = {};
    for (const key of Object.keys(row)) out[key] = clean(row[key]);
    return out;
  });
}

function toNumber(value) {
  if (value === null) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function skip(sheet, rowIndex, reason) {
  // rowIndex는 0부터. 시트 기준 행 번호는 머리글(1행) 다음이라 +2
  console.warn(`[data] ${sheet} ${rowIndex + 2}행 건너뜀: ${reason}`);
}

function normalizeCities(rows) {
  const cities = [];
  rows.forEach((row, i) => {
    // TODO(질문): 설계서에 필수 칸이 비었을 때의 처리가 명시되지 않아, 필수 칸이 비면 그 행을 건너뛰도록 구현함
    for (const key of ['city_id', 'kind', 'name_ko', 'country_ko', 'flag']) {
      if (row[key] === null) return skip('cities', i, `${key} 비어 있음`);
    }
    // TODO(질문): kind가 stay/via가 아닌 경우의 처리가 설계서에 없어 그 행을 건너뛰도록 구현함
    if (row.kind !== 'stay' && row.kind !== 'via') return skip('cities', i, `kind 값 오류(${row.kind})`);

    // 3. 숫자 변환, NaN이면 건너뜀
    const order = toNumber(row.order);
    const lat = toNumber(row.lat);
    const lng = toNumber(row.lng);
    if (Number.isNaN(order) || Number.isNaN(lat) || Number.isNaN(lng)) {
      return skip('cities', i, 'order/lat/lng가 숫자가 아님');
    }

    // 2. 날짜 형식
    if (row.arrive === null || !DATE_RE.test(row.arrive) || row.depart === null || !DATE_RE.test(row.depart)) {
      return skip('cities', i, 'arrive/depart 날짜 형식 오류');
    }

    // 4. album_url은 구글 포토 주소일 때만 인정
    const album = row.album_url && ALBUM_PREFIXES.some((p) => row.album_url.startsWith(p)) ? row.album_url : null;

    cities.push({
      city_id: row.city_id,
      order,
      kind: row.kind,
      name_ko: row.name_ko,
      country_ko: row.country_ko,
      flag: row.flag,
      lat,
      lng,
      arrive: row.arrive,
      depart: row.depart,
      album_url: album,
    });
  });
  // 6. cities는 order 순
  return cities.sort((a, b) => a.order - b.order);
}

function normalizeDays(rows, cities) {
  const cityIds = new Set(cities.map((c) => c.city_id));
  const days = [];
  rows.forEach((row, i) => {
    if (row.date === null || !DATE_RE.test(row.date)) return skip('days', i, 'date 형식 오류');
    // 5. city_id가 cities에 없고 home도 아니면 건너뜀
    if (row.city_id === null || (row.city_id !== 'home' && !cityIds.has(row.city_id))) {
      return skip('days', i, `알 수 없는 city_id(${row.city_id})`);
    }
    // TODO(질문): plan(≤40자), news(≤80자), move(≤40자) 글자 수 제한을 넘어도 자르거나 막지 않고 그대로 둠
    days.push({
      date: row.date,
      city_id: row.city_id,
      plan: row.plan,
      news: row.news,
      move: row.move,
    });
  });
  // 6. days는 date 순(YYYY-MM-DD 문자열 비교)
  return days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// 7. 결과 모양: { cities: City[], days: Day[] }
export function buildData(citiesCsv, daysCsv) {
  const cities = normalizeCities(parseCsv(citiesCsv));
  const days = normalizeDays(parseCsv(daysCsv), cities);
  return { cities, days };
}

// ---------- 캐시 (localStorage는 모두 try/catch) ----------

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.cities) && Array.isArray(parsed.days) && parsed.cities.length > 0 && parsed.days.length > 0) {
      return parsed;
    }
  } catch (e) {
    // 카톡 인앱 브라우저 등에서 차단될 수 있음. 무시.
  }
  return null;
}

function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ cities: data.cities, days: data.days, savedAt: Date.now() }));
  } catch (e) {
    // 저장 실패는 무시
  }
}

// ---------- 시트 가져오기 ----------

function withCacheBuster(url) {
  // 설계서: URL 끝에 &t=<현재ms>. 게시 URL은 이미 ?가 있어 &를 쓰고, 없으면 ?를 씀
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
}

async function fetchCsv(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(withCacheBuster(url), { cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSheet() {
  const [citiesCsv, daysCsv] = await Promise.all([fetchCsv(CONFIG.CITIES_CSV_URL), fetchCsv(CONFIG.DAYS_CSV_URL)]);
  const data = buildData(citiesCsv, daysCsv);
  // TODO(질문): 잘못된 URL이 HTML 페이지를 돌려주면 파싱 결과가 비게 됨. 설계서에 없지만 이 경우도 실패로 취급함
  if (data.cities.length === 0 || data.days.length === 0) throw new Error('시트에서 유효한 행을 찾지 못함');
  return data;
}

// ---------- 로딩 흐름 ----------

// state 모양: { cities, days, source, loadedAt }
// - source: 'default' | 'cache' | 'sheet'  (TODO(질문): 값 이름이 설계서에 없어 임의로 정함)
// - loadedAt: 마지막으로 성공한 시점(ms). 기본값이면 null
// - fetchFailed: 시트를 불러오려다 실패했으면 true. 하단 "최신 소식을 불러오지 못했어요" 표시용
//   TODO(질문): state 모양(cities, days, source, loadedAt)에 없는 필드라 임의로 추가함. 다른 방식이 있으면 알려주세요.
let current = null;
let handler = null;
let refreshing = false;
let lastAttemptAt = 0;
let visibilityBound = false;

function makeState(data, source, loadedAt, fetchFailed) {
  return { cities: data.cities, days: data.days, source, loadedAt, fetchFailed };
}

function emit(state) {
  current = state;
  if (!handler) return;
  try {
    handler(state);
  } catch (e) {
    console.error('[data] onUpdate 처리 중 오류', e);
  }
}

async function refreshFromSheet() {
  // 두 URL이 모두 있어야 시도함. 비어 있으면 실패가 아니라 "아직 연결 안 됨"으로 보고 안내도 띄우지 않음.
  // TODO(질문): URL이 비어 있을 때 하단 안내를 띄울지 설계서에 없음. 지금은 띄우지 않음(fetchFailed=false).
  if (!CONFIG.CITIES_CSV_URL || !CONFIG.DAYS_CSV_URL) return;
  if (refreshing) return;
  refreshing = true;
  lastAttemptAt = Date.now();
  try {
    const data = await fetchSheet();
    saveCache(data);
    emit(makeState(data, 'sheet', Date.now(), false));
  } catch (e) {
    console.warn('[data] 시트를 불러오지 못해 직전 데이터를 유지함', e);
    emit({ ...current, fetchFailed: true });
  } finally {
    refreshing = false;
  }
}

function bindVisibility() {
  if (visibilityBound) return;
  visibilityBound = true;
  // 탭을 다시 열었을 때 마지막 로딩 후 5분이 지났으면 ③을 다시 실행
  // TODO(질문): "마지막 로딩"을 성공 여부와 상관없이 마지막 시도 시각으로 해석함
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastAttemptAt > STALE_MS) {
      refreshFromSheet();
    }
  });
}

// onUpdate(state)는 기본값 → (캐시) → (시트) 순서로 데이터가 바뀔 때마다 호출된다.
export async function loadData(onUpdate) {
  handler = onUpdate;

  // ① 내장 기본값으로 즉시
  emit(makeState(buildData(DEFAULT_CITIES_CSV, DEFAULT_DAYS_CSV), 'default', null, false));

  // ② 캐시가 있으면 캐시로
  const cache = loadCache();
  if (cache) {
    emit(makeState({ cities: cache.cities, days: cache.days }, 'cache', cache.savedAt ?? null, false));
  }

  bindVisibility();

  // ③ 시트
  await refreshFromSheet();
  return current;
}
