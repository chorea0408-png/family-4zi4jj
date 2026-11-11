// 설정값 모음. 형준·유나가 시트 URL을 받으면 아래 두 줄만 채우면 됨.
// 빈 문자열이면 내장 기본 데이터로 동작함(T2에서 data.js가 처리).
export const CONFIG = {
  // 구글 시트 "웹에 게시(CSV)" URL
  CITIES_CSV_URL: '',
  DAYS_CSV_URL: '',

  // 기준 시간대(경로의 모든 도시가 같은 시간대)
  TIMEZONE: 'Europe/Budapest',

  // 여행 시작·끝 날짜(YYYY-MM-DD)
  TRIP_START: '2026-11-10',
  TRIP_END: '2026-12-02',
};
