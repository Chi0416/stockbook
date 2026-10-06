// 公告的除權息（js/dividendlist.js，由 tools/update-dividends.mjs 產生）：新增除權息時一鍵帶入（見 form.js 的 renderAnnounce）
//   ETF 的金額常常除息前幾天才公告：還沒公告時 cash 是 null，表單上只帶入日期
//   同一次除權息的判斷：代號相同、除權息日相差 7 天以內（日期填錯一兩天也認得出來，不會重複加入）
//   瀏覽器還拿著舊版程式、沒有資料時什麼都不列
const Announced = (() => {
  const DAY = 86400000;
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const data = () => (typeof DIVIDEND_LIST !== 'undefined' ? DIVIDEND_LIST : { updated: '', rows: [] });

  let cache = null;
  function rows() {
    if (!cache) {
      cache = data().rows.map(([code, name, exDate, payDate, cash, stock]) => ({ code, name, exDate, payDate, cash, stock }));
    }
    return cache;
  }

  const sameEvent = (a, b) => key(a.code) === key(b.code) && !!a.exDate && !!b.exDate &&
    Math.abs(Date.parse(a.exDate) - Date.parse(b.exDate)) <= 7 * DAY;

  // 這一檔公告的除權息，除權息日新的在前；recorded 是已經記過的除權息，記過的那一次不列
  function forCode(code, recorded = []) {
    const c = key(code);
    if (!c) return [];
    return rows()
      .filter(r => r.code === c && !recorded.some(d => sameEvent(d, r)))
      .sort((a, b) => (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0));
  }

  return { forCode, sameEvent, updated: () => data().updated };
})();
