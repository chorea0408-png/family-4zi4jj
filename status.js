// status.js: "오늘 어디에 있나"를 정하는 순수 함수 모음 (T3)
// DOM 접근 없음, import 없음. 날짜 문자열(YYYY-MM-DD)과 데이터만 받는다.
// data 모양: { cities: City[], days: Day[] }  (data.js의 buildData 결과)

// 날짜 문자열 → UTC 자정 ms. 서머타임 오차를 피하려고 Date.UTC만 쓴다.
function toUtcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// b - a (일 수)
function dayDiff(a, b) {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86400000);
}

function findCity(cities, cityId) {
  if (cityId === null || cityId === undefined || cityId === 'home') return null;
  return cities.find((c) => c.city_id === cityId) || null;
}

// getStatus(today, data) → { phase, date, day, city, prevCity, moving, dayNumber, totalDays, daysUntilStart }
export function getStatus(today, data) {
  const { cities, days } = data;
  const totalDays = days.length;

  const empty = {
    phase: 'before',
    date: today,
    day: null,
    city: null,
    prevCity: null,
    moving: false,
    dayNumber: null,
    totalDays,
    daysUntilStart: null,
  };

  // TODO(질문): days가 비어 있을 때의 동작이 설계서에 없음. 가장 단순하게 before로 두고 값은 모두 비움.
  if (totalDays === 0) return empty;

  const first = days[0].date;
  const last = days[totalDays - 1].date;

  // 1. 첫날보다 이르면 before
  if (today < first) {
    return { ...empty, phase: 'before', daysUntilStart: dayDiff(today, first) };
  }
  // 2. 마지막 날보다 늦으면 after
  if (today > last) {
    return { ...empty, phase: 'after' };
  }

  // 3. 오늘 행을 찾는다. 없으면(시트에서 행이 빠진 경우) today 이전에서 가장 가까운 행을 쓰고 moving은 false
  let index = days.findIndex((d) => d.date === today);
  const rowMissing = index === -1;
  if (rowMissing) {
    index = -1;
    for (let i = 0; i < totalDays; i++) {
      if (days[i].date < today) index = i;
    }
  }
  const day = days[index];

  const isHome = day.city_id === 'home';
  const city = isHome ? null : findCity(cities, day.city_id);

  // prevCity: 어제(바로 앞 행) 도시. 오늘 도시와 같으면 null
  let prevCity = null;
  if (index > 0) {
    const prevId = days[index - 1].city_id;
    if (prevId !== day.city_id) prevCity = findCity(cities, prevId);
  }

  const moving = !rowMissing && day.move !== null && day.move !== '' && day.move !== undefined;

  return {
    // 4. home이면 home, 5. 그 밖은 traveling
    phase: isHome ? 'home' : 'traveling',
    date: today,
    day,
    city,
    prevCity,
    moving,
    // TODO(질문): 행이 빠진 날의 dayNumber는 행 번호가 아니라 첫날부터 달력상 며칠째인지로 계산함
    dayNumber: dayDiff(first, today) + 1,
    totalDays,
    daysUntilStart: null,
  };
}

// cityState(city, today[, statusCityId]) → 'past' | 'current' | 'upcoming'
// depart < today면 past, arrive ≤ today ≤ depart면 current, 그 밖은 upcoming.
// 같은 날 두 도시가 모두 current면 status.city가 아닌 쪽은 past로 처리한다.
// TODO(질문): 위 마지막 규칙은 status.city를 알아야 해서 설계서 시그니처(city, today)에 없는 세 번째 인자(statusCityId)를 추가함.
//   getStatus의 city?.city_id를 넘기면 되고, 넘기지 않으면 날짜만으로 판정함.
export function cityState(city, today, statusCityId) {
  if (city.depart < today) return 'past';
  if (city.arrive <= today && today <= city.depart) {
    if (statusCityId !== undefined && city.city_id !== statusCityId) return 'past';
    return 'current';
  }
  return 'upcoming';
}

// segmentDone(from, to, today): to.arrive ≤ today면 지나온 구간
export function segmentDone(from, to, today) {
  return to.arrive <= today;
}

// visibleNews(days, today): date ≤ today이고 plan이나 news 중 하나라도 있는 행을 최신순으로. 미래 날짜는 절대 보여주지 않음.
export function visibleNews(days, today) {
  return days
    .filter((d) => d.date <= today && (d.plan || d.news))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ---- 시계 ----

const KOREA_TZ = 'Asia/Seoul';

function timeText(now, timeZone) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
}

function dateText(now, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now); // YYYY-MM-DD
}

function hourIn(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: 'numeric' }).formatToParts(now);
  return Number(parts.find((p) => p.type === 'hour').value);
}

// 해당 시간대가 UTC보다 몇 분 앞서 있는지
function offsetMinutes(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(now.getTime() / 1000) * 1000) / 60000);
}

// 05시~11시는 아침, 11시~17시는 낮, 17시~21시는 저녁, 나머지는 밤
function koreaLabelOf(hour) {
  if (hour >= 5 && hour < 11) return '아침';
  if (hour >= 11 && hour < 17) return '낮';
  if (hour >= 17 && hour < 21) return '저녁';
  return '밤';
}

// clocks(now[, localTimeZone]) → { local, korea, diffHours, koreaLabel, koreaNextDay }
// local, korea는 '오후 6:05' 형식. 시차는 하드코딩하지 않고 계산한다.
// TODO(질문): 설계서 반환값은 { local, korea, diffHours }뿐인데, 같은 장에 적힌 시간대 라벨(아침·낮·저녁·밤)과
//   화면 명세의 "내일" 표시에 필요한 값을 위해 koreaLabel, koreaNextDay를 추가함. 문구를 붙이는 일은 views/today.js에서 함.
// TODO(질문): status.js는 import를 할 수 없어 config.js의 TIMEZONE을 못 읽음. 현지 시간대를 두 번째 인자로 받고,
//   기본값은 설계서의 Europe/Budapest로 둠. 호출하는 쪽에서 CONFIG.TIMEZONE을 넘기면 됨.
export function clocks(now, localTimeZone = 'Europe/Budapest') {
  const diffMinutes = offsetMinutes(now, KOREA_TZ) - offsetMinutes(now, localTimeZone);
  return {
    local: timeText(now, localTimeZone),
    korea: timeText(now, KOREA_TZ),
    diffHours: diffMinutes / 60,
    koreaLabel: koreaLabelOf(hourIn(now, KOREA_TZ)),
    koreaNextDay: dateText(now, KOREA_TZ) !== dateText(now, localTimeZone),
  };
}
