











const Market = (() => {
  const NAME = 'prices';
  const DAY = 86400000;
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();

  const twStamp = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');


  let data = typeof PRICE_LIST !== 'undefined' ? PRICE_LIST : null;



  const file = U.dataFile(NAME, {
    preset: data,
    set: next => { data = next; },
  });
  const load = file.load;


  const refresh = file.check;


  function get(code) {
    const r = data?.rows[key(code)];
    return r ? { close: r[0], date: r[1] || data.date } : null;
  }


  const linked = () => typeof Sync !== 'undefined' && Sync.linked();
  const live = () => (linked() ? Sync.prices() : null);




  function delayed(code) {
    const q = live();
    const k = key(code);
    const price = q?.quotes[k];
    if (!(typeof price === 'number' && price > 0)) return null;
    const traded = q.times?.[k];
    if (traded) return { price, at: traded, early: false };
    const read = q.kept?.[k] || q.at;
    if (!read) return { price, at: '', early: false };
    const at = twStamp(Date.parse(read));
    const day = new Date(`${at.slice(0, 10)}T00:00:00Z`).getUTCDay();
    const min = +at.slice(11, 13) * 60 + +at.slice(14);
    return { price, at: min >= 14 * 60 ? `${at.slice(0, 10)} 13:30` : at, early: day === 0 || day === 6 || min < 9 * 60 };
  }


  function closedUpTo(code) {
    const r = data?.rows[key(code)];
    return !r ? '' : !r[1] || data.complete ? data.date : r[1];
  }




  function quote(code) {
    const d = delayed(code);
    const m = get(code);
    if (!m) return d ? { price: d.price, close: '', at: d.early ? '' : d.at } : { price: null, close: '', at: '' };
    if (d && !d.early && closedUpTo(code) < d.at.slice(0, 10)) return { price: d.price, close: '', at: d.at };
    return { price: m.close, close: m.date, at: '' };
  }






  function closeOn(code, date) {
    const iso = U.parseDate(date ?? '');
    if (!data || !iso) return null;
    const k = key(code);
    const near = from => {
      if (from > iso) return false;
      for (let t = Date.parse(from) + DAY; t <= Date.parse(iso); t += DAY) {
        if (![0, 6].includes(new Date(t).getUTCDay())) return false;
      }
      return true;
    };
    const r = data.rows[k];
    if (r && (!r[1] || data.complete) && near(data.date)) return r[0];
    const m = Object.entries(data.months || {}).find(([d, rows]) => typeof rows?.[k] === 'number' && near(d));
    return m ? m[1][k] : null;
  }


  const closeDates = () => (data ? [data.date, ...Object.keys(data.months || {})] : []);


  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));


  const waiting = () => file.waiting('下載不了收盤價（連上網路後會再試）', '收盤價還在下載');


  const clock = at => (at.slice(0, 10) === twStamp(Date.now()).slice(0, 10) ? at.slice(11) : `${md(at.slice(0, 10))} ${at.slice(11)}`);


  function tag(code) {
    const q = quote(code);
    if (q.close) return `${md(q.close)} 收盤`;
    if (q.price === null) return '';
    return q.at ? `延遲 ${clock(q.at)}` : '延遲';
  }


  const late = () => (typeof Sync !== 'undefined' && Sync.priceLate ? Sync.priceLate() : 0);


  function sumUp(codes) {
    const all = [...new Set(codes.map(key))].map(code => ({ code, q: quote(code) }));
    const newer = (list, val) => list.reduce((a, x) => (val(x) > a ? val(x) : a), '');
    const delays = all.filter(x => x.q.price !== null && !x.q.close);
    const closed = all.filter(x => x.q.close);
    return {
      live: delays,
      closed,
      none: all.length - delays.length - closed.length,
      newest: newer(delays, x => x.q.at),
      day: newer(closed, x => x.q.close),
    };
  }


  function mixed(codes) {
    const s = sumUp(codes);
    return s.live.length > 0 && s.closed.length > 0;
  }
  const closeTag = code => (quote(code).close ? '<small class="px-close">收</small>' : '');


  const olderOf = s => s.closed.filter(x => x.q.close < s.day);
  const olderText = list => list.map(x => `${x.code} 是 ${md(x.q.close)}`).join('、');



  function lineParts(codes) {
    const s = sumUp(codes);
    if (!s.live.length) {
      if (waiting()) return [{ text: waiting() }];
      if (s.none && !s.closed.length) return [{ text: `${s.none} 檔沒有價格` }];
      const older = olderOf(s);
      return [
        { text: `${md(s.day || data.date)} 收盤` },
        ...(older.length ? [{ text: older.length > 2 ? `${older.length} 檔比較舊` : olderText(older) }] : []),
      ];
    }
    const days = [...new Set(s.closed.map(x => x.q.close))].sort().reverse();
    const closedText = s.closed.length > 2
      ? (days.length === 1 ? `${s.closed.length} 檔用 ${md(days[0])} 收盤` : `${s.closed.length} 檔用收盤價`)
      : days.map(d => `${s.closed.filter(x => x.q.close === d).map(x => x.code).join('、')} 用 ${md(d)} 收盤`).join('、');
    return [
      { text: s.newest ? `延遲 ${clock(s.newest)}` : '延遲' },
      ...(late() ? [{ text: `已停 ${late()} 分鐘`, warn: true }] : []),
      ...(s.closed.length ? [{ text: closedText }] : []),
    ];
  }

  const priceLine = codes => lineParts(codes).map(p => (p.warn ? `<span class="warn-text">${U.esc(p.text)}</span>` : U.esc(p.text))).join('・');

  const priceText = codes => lineParts(codes).map(p => p.text).join('・');


  function priceNote(codes) {
    const s = sumUp(codes);
    const parts = [];
    if (s.live.length) {
      parts.push(`${s.newest ? `${clock(s.newest)} 的` : ''}延遲價，可能比實際晚 20 分鐘`);
      if (late()) parts.push(`已經 ${late()} 分鐘沒有更新，按「同步」再抓一次`);
      if (s.closed.length) parts.push(`${s.closed.length} 檔用收盤價（抓不到延遲價，或收盤資料比較新），列表標「收」`);
    } else if (s.closed.length) {
      parts.push(`價格是 ${md(s.day)} 收盤價${linked() ? '，盤中抓得到時換成延遲價' : '（連結 Google 帳號後，盤中會抓延遲價）'}`);
    }
    if (olderOf(s).length) parts.push(`${olderText(olderOf(s))}（最近沒有成交，或資料還沒出來）`);
    if (s.none) parts.push(`${s.none} 檔沒有價格`);
    if (waiting()) parts.push(waiting());
    return parts.join('；');
  }



  const closeLine = () => waiting() || `${md(data.date)} 收盤${data.complete === false ? '（上櫃還沒更新）' : ''}`;
  const closeNote = () => waiting() || `價格是 ${md(data.date)} 收盤價，每個工作天收盤後更新，盤中不會變` +
    (data.complete === false ? '；櫃買中心的資料還沒出來，上櫃的股票還是前一天的，晚上會更新' : '');




  const INDEX_NAMES = [['taiex', '加權指數'], ['tpex', '櫃買指數']];
  function indices() {
    return INDEX_NAMES.map(([k, name]) => {
      const r = data?.index?.[k];
      if (!r || typeof r.date !== 'string' || !(r.close > 0) || typeof r.change !== 'number') return null;
      const before = r.close - r.change;
      return { name, date: r.date, close: r.close, change: r.change, pct: before > 0 ? (r.change / before) * 100 : null };
    }).filter(Boolean);
  }

  function indexLine(list = indices()) {
    if (!list.length) return '';
    const [first, ...rest] = list;
    const other = rest.filter(r => r.date !== first.date).map(r => `${r.name.slice(0, 2)} ${md(r.date)}`);
    return [`${md(first.date)} 收盤`, ...other].join('・');
  }

  return {
    get, quote, tag, closeOn, closeDates, mixed, closeTag, priceLine, priceText, priceNote, closeLine, closeNote, waiting, load, refresh,
    indices, indexLine,

    codes: () => (data ? Object.keys(data.rows) : []),
    date: () => (data ? data.date : ''),
    state: file.state,
    ready: file.ready,
    onChange: file.onChange,
  };
})();
