// 公告的除權息（js/dividendlist.js，由 tools/update-dividends.mjs 產生）：新增除權息時一鍵帶入（見 form.js 的 renderAnnounce）
//   ETF 的金額常常除息前幾天才公告：還沒公告時 cash 是 null，表單上只帶入日期
//   同一次除權息的判斷：代號相同、除權息日相差 7 天以內（日期填錯一兩天也認得出來，不會重複加入）
//   瀏覽器還拿著舊版程式、沒有資料時什麼都不列
//   訊息匣（見 inbox.js 的 checkData）另外用 diffs、missing 比對：記的跟公告不一樣、家裡持有但還沒記的
//     選了「保留我的」「不用記」的記在這台裝置（keep），同一個值不再問；公告的數字變了會再問
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

  // ---------- 比對（訊息匣） ----------
  const KEEP = 'stockbook.announceKeep';
  let kept = null;
  function keptSet() {
    if (!kept) {
      try { kept = new Set(JSON.parse(localStorage.getItem(KEEP)) || []); } catch (_) { kept = new Set(); }
    }
    return kept;
  }
  // 記住「保留我的」「不用記」；最多留 500 個，超過時從最早的刪
  function keep(keys) {
    const set = keptSet();
    [].concat(keys).forEach(k => set.add(k));
    kept = new Set([...set].slice(-500));
    try { localStorage.setItem(KEEP, JSON.stringify([...kept])); } catch (_) {}
  }
  const isKept = k => keptSet().has(k);
  const same = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-9;
  const FIELDS = ['exDate', 'payDate', 'cash', 'stock'];
  const differs = (d, r, k) => (/Date$/.test(k) ? d[k] !== r[k] : !same(d[k], r[k]));

  // 記的跟公告不一樣（金額已經公告的才比）：[{ key, record, announced, fields }]
  //   key 帶著公告的數字：選了「保留我的」之後，公告的數字變了會再問
  function diffs(recorded = []) {
    return recorded.flatMap(d => {
      const r = forCode(d.code).find(x => x.cash != null && sameEvent(d, x));
      const fields = r ? FIELDS.filter(k => differs(d, r, k)) : [];
      if (!fields.length) return [];
      const key = `diff:${d.id}:${FIELDS.map(k => r[k]).join(':')}`;
      return isKept(key) ? [] : [{ key, record: d, announced: r, fields }];
    });
  }

  // 家裡持有但還沒記的：近 12 個月（和之後已經公告金額的），除權息日前家裡有人持有；新的在前
  //   held(代號, 除權息日) 由呼叫的地方判斷（見 inbox.js，用 Holdings.entitled，和累積現金股利的算法一樣）
  //   codes 是記過的代號（交易明細、庫存快照），先篩掉不相干的，才不用每一筆公告都推算持股
  function missing({ recorded = [], codes = [], held, today }) {
    const [y, m, dd] = today.split('-');
    const since = `${+y - 1}-${m}-${dd}`;
    const want = new Set(codes.map(key));
    return rows()
      .filter(r => r.cash != null && r.exDate >= since && want.has(r.code))
      .filter(r => !recorded.some(d => sameEvent(d, r)) && !isKept(`missing:${r.code}:${r.exDate}`))
      .filter(r => held(r.code, r.exDate))
      .sort((a, b) => (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0));
  }

  return { forCode, sameEvent, diffs, missing, keep, isKept, updated: () => data().updated };
})();
