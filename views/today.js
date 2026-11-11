// views/today.js: 오늘 탭 렌더 (T4)
// 의존 방향: app → views → status / data. 이 파일은 state와 today(날짜 문자열)만 읽는다.
// 사용: renderToday(rootElement, state, today)
//   state = { cities, days, ... }  (data.js의 결과), today = 'YYYY-MM-DD' (app.js가 정함, ?date= 우선)

import { getStatus, clocks } from '../status.js';
import { CONFIG } from '../config.js';

const STYLE_ID = 'today-view-styles';
const CLOCK_INTERVAL_MS = 30000;

// TODO(질문): T4 산출 파일에 styles.css가 없어서, 이 탭의 스타일을 여기서 <style>로 한 번만 넣음. styles.css로 옮길지 확인 필요.
const CSS = `
.today-hero { padding: 8px 0 16px; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
.today-progress { font-size: 15px; line-height: 1.4; color: var(--ink-2); }
.today-flag { font-size: 40px; line-height: 1.3; margin-top: 4px; }
.today-headline { margin: 4px 0 0; font-size: 28px; font-weight: 800; line-height: 1.35; word-break: keep-all; }
.today-sub { margin-top: 8px; color: var(--ink-2); }
.today-move { margin-top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.today-badge { background: var(--accent-soft); color: var(--ink); font-size: 15px; font-weight: 700; line-height: 1.4; padding: 4px 12px; border-radius: 999px; white-space: nowrap; }
.today-move-text { min-width: 0; }
.today-card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 20px; margin-bottom: 12px; }
.today-card-title { margin: 0 0 8px; font-size: 20px; font-weight: 700; line-height: 1.4; }
.today-clock-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.today-clock-label { color: var(--ink-2); flex: none; }
.today-clock-value { font-weight: 700; text-align: right; }
.today-clock-diff { margin-top: 4px; font-size: 15px; color: var(--ink-2); }
.today-news-text { font-size: 20px; line-height: 1.5; }
.today-news-by { margin-top: 8px; text-align: right; font-size: 15px; color: var(--ink-2); }
.today-btn { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 56px; padding: 8px 16px; background: var(--accent); color: #fff; border-radius: var(--radius); font-size: 18px; font-weight: 700; line-height: 1.4; text-align: center; text-decoration: none; }
.today-album-empty { margin-top: 4px; text-align: center; color: var(--ink-2); }
`;

let clockTimer = null;

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

// 이름 뒤에 "으로/로"를 붙여 돌려준다. 받침이 없거나 ㄹ이면 "로", 그 밖의 받침이면 "으로".
// 받침은 (code - 0xAC00) % 28 로 구하며 0이면 받침 없음, 8이면 ㄹ. 예: 빈 → 빈으로, 프라하 → 프라하로
export function josaRo(name) {
  const code = name.charCodeAt(name.length - 1);
  // TODO(질문): 마지막 글자가 한글이 아닐 때의 처리가 설계서에 없어 "로"를 붙임
  if (code < 0xac00 || code > 0xd7a3) return `${name}로`;
  const jong = (code - 0xac00) % 28;
  return jong === 0 || jong === 8 ? `${name}로` : `${name}으로`;
}

// 헤드라인 표(화면 명세 2장): 위에서부터 차례로 확인해 처음 맞는 행을 쓴다.
function describe(status) {
  const city = status.city ? status.city.name_ko : '';
  const prev = status.prevCity ? status.prevCity.name_ko : '';

  if (status.phase === 'before') {
    // TODO(질문): 아래 줄의 "11월 10일", "부다페스트"는 설계서 문구를 글자 그대로 둔 것이라 시트 날짜가 바뀌어도 따라가지 않음
    return { headline: `출발까지 ${status.daysUntilStart}일 남았어요`, sub: '11월 10일에 부다페스트로 떠나요', badge: false };
  }
  if (status.phase === 'home') {
    return { headline: '오늘 한국으로 돌아와요', sub: status.day.plan, badge: false };
  }
  if (status.phase === 'after') {
    return { headline: '무사히 다녀왔어요', sub: '앨범에서 여행 사진을 다시 볼 수 있어요', badge: false };
  }
  if (status.moving && status.prevCity) {
    return { headline: `오늘은 ${prev}에서 ${josaRo(city)} 이동해요`, sub: null, badge: true };
  }
  if (status.moving) {
    return { headline: `지금 ${city}에 있어요`, sub: null, badge: true };
  }
  if (status.prevCity) {
    return { headline: `${city}에 도착했어요`, sub: null, badge: false };
  }
  return { headline: `지금 ${city}에 있어요`, sub: null, badge: false };
}

function stopClock() {
  if (clockTimer !== null) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

function buildClockCard() {
  const card = el('section', 'today-card today-clock');

  const localRow = el('div', 'today-clock-row');
  localRow.append(el('span', 'today-clock-label', '현지 시각'));
  const local = el('span', 'today-clock-value');
  localRow.append(local);

  const koreaRow = el('div', 'today-clock-row');
  koreaRow.append(el('span', 'today-clock-label', '한국 시각'));
  const korea = el('span', 'today-clock-value');
  koreaRow.append(korea);

  const diff = el('div', 'today-clock-diff');

  card.append(localRow, koreaRow, diff);

  // 30초마다 갱신
  function update() {
    const c = clocks(new Date(), CONFIG.TIMEZONE);
    local.textContent = c.local;
    korea.textContent = `${c.koreaNextDay ? '내일 ' : ''}${c.korea} · ${c.koreaLabel}`;
    diff.textContent = `한국이 ${c.diffHours}시간 빨라요`;
  }
  return { card, update };
}

function externalLink(className, href, text) {
  const a = el('a', className, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function renderToday(root, state, today) {
  ensureStyles();
  stopClock();

  const status = getStatus(today, state);
  const { headline, sub, badge } = describe(status);
  const showCards = status.phase !== 'before' && status.phase !== 'after';

  const frag = document.createDocumentFragment();

  // ── 상단: 여행 N일째, 국기, 헤드라인, 아래 줄 ──
  const hero = el('section', 'today-hero');

  // TODO(질문): before/after에서는 "여행 N일째" 줄을 숨김. 국기는 도시가 있으면 그 도시 국기, home이면 🇰🇷, before/after는 숨김.
  if (status.phase === 'traveling' || status.phase === 'home') {
    hero.append(el('div', 'today-progress', `여행 ${status.dayNumber}일째 / ${status.totalDays}일`));
  }
  if (status.city) {
    const flag = el('div', 'today-flag', status.city.flag);
    flag.setAttribute('aria-hidden', 'true');
    hero.append(flag);
  } else if (status.phase === 'home') {
    const flag = el('div', 'today-flag', '🇰🇷');
    flag.setAttribute('aria-hidden', 'true');
    hero.append(flag);
  }

  hero.append(el('h2', 'today-headline', headline));

  if (badge) {
    const move = el('div', 'today-move');
    move.append(el('span', 'today-badge', '이동하는 날'));
    move.append(el('span', 'today-move-text', status.day.move));
    hero.append(move);
  } else if (sub) {
    hero.append(el('p', 'today-sub', sub));
  }
  frag.append(hero);

  // ── 시계 카드 ──
  // TODO(질문): 시계 카드는 설계서에 숨기라는 말이 없어 모든 상태에서 보여줌. 단 home·before에서는 "현지 시각"이 부다페스트 시각이라 어색할 수 있음.
  const clock = buildClockCard();
  frag.append(clock.card);

  // ── 오늘 일정, 오늘의 한 줄 소식 (before·after에서는 숨김) ──
  if (showCards) {
    const planCard = el('section', 'today-card');
    planCard.append(el('h3', 'today-card-title', '오늘 일정'));
    planCard.append(el('p', null, status.day.plan ? status.day.plan : '일정이 곧 올라와요'));
    frag.append(planCard);

    // TODO(질문): 소식이 비어 있을 때 보여줄 문구가 설계서에 없어서, 이때는 이 카드를 통째로 숨김
    if (status.day.news) {
      const newsCard = el('section', 'today-card');
      newsCard.append(el('h3', 'today-card-title', '오늘의 한 줄 소식'));
      newsCard.append(el('p', 'today-news-text', `"${status.day.news}"`));
      newsCard.append(el('p', 'today-news-by', '— 형준·유나'));
      frag.append(newsCard);
    }
  }

  // ── 사진 버튼 ──
  if (status.phase === 'after') {
    const btn = el('a', 'today-btn', '앨범 보기');
    btn.href = '#album'; // app.js의 hashchange가 앨범 탭으로 전환
    frag.append(btn);
  } else if (status.city) {
    // TODO(질문): 도시가 없는 before·home에서는 사진 버튼도 "사진이 곧 올라와요"도 보여주지 않음
    if (status.city.album_url) {
      frag.append(externalLink('today-btn', status.city.album_url, `📷 ${status.city.name_ko} 사진 보러 가기`));
    } else {
      frag.append(el('p', 'today-album-empty', '사진이 곧 올라와요'));
    }
  }

  root.replaceChildren(frag);

  clock.update();
  clockTimer = setInterval(clock.update, CLOCK_INTERVAL_MS);
}
