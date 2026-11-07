// Market：收盤價（shared/prices.json，由 tools/update-prices.mjs 產生）；日 KD 另外放（見 kd.js）
//   GitHub 每個工作天收盤後自動更新這個檔案（見 .github/workflows/update-prices.yml），不用改版本號：
//     App 打開時下載（load），從背景切回來、網路恢復時，距離上次超過 30 分鐘再檢查一次（refresh）
//     每次都先問網站有沒有新的（沒變只回一個很小的回應）；沒有網路時用瀏覽器暫存的上一份
//     第一次下載好、或下載到不一樣的資料時通知 onChange（app.js 重畫總覽和選股）
//   價格有兩種，畫面上一定看得出是哪一種：
//     收盤價（get、closeLine、closeNote）：選股全部用這個，全市場同一天的價格，比較才公平
//     延遲價＋收盤價（quote、priceLine、priceNote、tag）：帳務和到價用，延遲價是 GOOGLEFINANCE 抓的（見 sync.js），可能晚 20 分鐘
//       抓不到的（上櫃常常抓不到）、沒連結 Google 的，用最近一次的收盤價
//       延遲價存在裝置上沒有期限，不一定比收盤價新，所以要比日期（見 quote）
//   某一天的收盤價（closeOn）：庫存快照的收盤價用，只有最近一個交易日和最近兩個月的月底（months）
//   大盤指數（indices、indexLine）：總覽最上面那張卡片用，加權、櫃買的收盤指數和漲跌，和收盤價同一個檔案（index）
const Market = (() => {
  const FILE = 'shared/prices.json';
  const AGAIN = 30 * 60000;
  const DAY = 86400000;
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  // 台灣時間（UTC+8，沒有日光節約）的 'YYYY-MM-DD HH:MM'
  const twStamp = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

  // 測試時直接放一份全域的 PRICE_LIST，不用下載
  let data = typeof PRICE_LIST !== 'undefined' ? PRICE_LIST : null;
  let state = data ? 'ready' : 'loading';
  let text = '';      // 上次下載到的內容，一樣的就不通知
  let lastTry = 0;
  let pending = null; // 下載中（同時只下載一次）
  const listeners = [];

  // 下載收盤資料：有新的資料、或第一次就下載失敗時通知 onChange；下載失敗、格式不對時留著原本的資料
  //   again：正在下載時等這次下載完再下載一次（sw.js 通知有新的那時候，正在讀的可能是舊的那份，見 app.js）
  function load(again = false) {
    if (pending) return again ? pending.then(() => load()) : pending;
    lastTry = Date.now();
    const get = async mode => {
      try {
        const res = await fetch(FILE, { cache: mode });
        return res.ok ? await res.text() : null;
      } catch (_) {
        return null;
      }
    };
    pending = (async () => {
      const got = (await get('no-cache')) ?? (await get('force-cache'));
      let changed = false;
      if (got !== null && got !== text) {
        try {
          const next = JSON.parse(got);
          if (typeof next.date === 'string' && next.rows && typeof next.rows === 'object') {
            data = next;
            text = got;
            state = 'ready';
            changed = true;
          }
        } catch (_) {}
      }
      if (!data && state !== 'failed') {
        state = 'failed';
        changed = true;
      }
      pending = null;
      if (changed) listeners.forEach(fn => fn());
      return changed;
    })();
    return pending;
  }

  // 從背景切回來、網路恢復時：還沒下載成功的馬上再試，下載過的隔 30 分鐘才再檢查
  const refresh = () => (state !== 'ready' || Date.now() - lastTry >= AGAIN ? load() : Promise.resolve(false));

  // 這一檔的收盤價：{ close, date（收盤價是哪一天的）}；資料裡沒有這一檔（興櫃、還沒開始交易）時回傳 null
  function get(code) {
    const r = data?.rows[key(code)];
    return r ? { close: r[0], date: r[1] || data.date } : null;
  }

  //   每一列都會問一次：只看有沒有連結（Sync.state() 每次都會數一遍待同步的筆數）
  const linked = () => typeof Sync !== 'undefined' && Sync.linked();
  const live = () => (linked() ? Sync.prices() : null);

  // 這一檔的延遲價：{ price, at: 這個價格是什麼時候的（台灣時間）, early: 開盤前、週末讀到的（其實是上次的價格）}；沒有時回傳 null
  //   Google 有給成交時間就用成交時間；沒有時看讀到的時間：14:00 以後讀到的是 13:30 收盤時的價格
  //     還在抓、留著上次價格的那幾檔（kept）看上次讀到的時間，不是這次
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

  // 收盤資料涵蓋到哪一天：這一檔最近沒有成交時，資料都齊了（complete）才算有涵蓋到（可能是櫃買中心的資料還沒出來）
  function closedUpTo(code) {
    const r = data?.rows[key(code)];
    return !r ? '' : !r[1] || data.complete ? data.date : r[1];
  }

  // 帳務、到價用的價格：{ price, close: 用收盤價時是哪一天的（用延遲價是 ''）, at: 用延遲價時是什麼時候的 }；都沒有時 price 是 null
  //   收盤資料涵蓋到延遲價那一天（或之後）就用收盤價：登入過期、停在早上的價格時，不會蓋過收盤後的價格
  //   沒有收盤價（資料還在下載、下載不了、資料裡沒有這一檔）比不了，照樣用延遲價；開盤前、週末讀到的不知道是什麼時候的，不寫時間
  function quote(code) {
    const d = delayed(code);
    const m = get(code);
    if (!m) return d ? { price: d.price, close: '', at: d.early ? '' : d.at } : { price: null, close: '', at: '' };
    if (d && !d.early && closedUpTo(code) < d.at.slice(0, 10)) return { price: d.price, close: '', at: d.at };
    return { price: m.close, close: m.date, at: '' };
  }

  // 某一天收盤後的價格（庫存快照的收盤價，見 schema.js、app.js 的 fillPrices）：沒有那一天的資料時回傳 null
  //   有的：最近一個交易日（date），最近兩個月的月底（months）
  //   快照日期是週末時用前一個交易日的（中間只隔週末才算；隔了平日可能是那天的資料還沒出來，不能用前一天的）
  //   最近一個交易日沒有成交的：上市、上櫃的資料都有了（complete）才算暫停交易，用之前最近一次成交的收盤價；
  //     還沒齊的可能是櫃買中心的資料還沒出來，不算，等晚上那次更新
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

  // 有收盤價的日子（帳戶紀錄用，見 history.js）：最近一個交易日、最近兩個月的月底
  const closeDates = () => (data ? [data.date, ...Object.keys(data.months || {})] : []);

  // 今年的日期只寫月/日
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));

  // 收盤資料還沒下載好、下載不了時的說明（下載好了是 ''）
  const waiting = () => (state === 'ready' ? '' : state === 'failed' ? '下載不了收盤價（連上網路後會再試）' : '收盤價還在下載');

  // 延遲價的時間：今天的只寫幾點幾分
  const clock = at => (at.slice(0, 10) === twStamp(Date.now()).slice(0, 10) ? at.slice(11) : `${md(at.slice(0, 10))} ${at.slice(11)}`);

  // 一檔的價格是哪一種（未實現損益、到價的表單）：「延遲 10:55」或「11/04 收盤」；沒有價格是 ''
  function tag(code) {
    const q = quote(code);
    if (q.close) return `${md(q.close)} 收盤`;
    if (q.price === null) return '';
    return q.at ? `延遲 ${clock(q.at)}` : '延遲';
  }

  // 盤中多久沒有更新（分鐘，每 10 分鐘一跳）；沒有停住是 0（見 sync.js）
  const late = () => (typeof Sync !== 'undefined' && Sync.priceLate ? Sync.priceLate() : 0);

  // 一張列表的價格：live 用延遲價的那幾檔、closed 用收盤價的那幾檔；newest 最新的延遲價時間、day 最新的收盤日
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

  // 同一張列表兩種價格都有：用收盤價的那幾列要標出來（closeTag）
  function mixed(codes) {
    const s = sumUp(codes);
    return s.live.length > 0 && s.closed.length > 0;
  }
  const closeTag = code => (quote(code).close ? '<small class="px-close">收</small>' : '');

  // 用收盤價、又不是最新那一天的（最近沒有成交，或櫃買中心的資料還沒出來）
  const olderOf = s => s.closed.filter(x => x.q.close < s.day);
  const olderText = list => list.map(x => `${x.code} 是 ${md(x.q.close)}`).join('、');

  // 列表上面那一行的每一段：{ text, warn: 紅字 }
  //   「延遲 10:55」「延遲 10:55・6488 用 11/04 收盤」「延遲 10:55・已停 40 分鐘」「11/04 收盤」「11/05 收盤・6488 是 11/04」
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
  // 已經是 HTML，停住的那一段是紅字
  const priceLine = codes => lineParts(codes).map(p => (p.warn ? `<span class="warn-text">${U.esc(p.text)}</span>` : U.esc(p.text))).join('・');
  // 純文字（帳戶紀錄的表單）
  const priceText = codes => lineParts(codes).map(p => p.text).join('・');

  // 「說明」裡的完整說法
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

  // 選股每一頁上面：全部是收盤價
  //   櫃買中心的資料比較晚出來（complete 是 false）：上櫃的股票還是前一天的，先說
  const closeLine = () => waiting() || `${md(data.date)} 收盤${data.complete === false ? '（上櫃還沒更新）' : ''}`;
  const closeNote = () => waiting() || `價格是 ${md(data.date)} 收盤價，每個工作天收盤後更新，盤中不會變` +
    (data.complete === false ? '；櫃買中心的資料還沒出來，上櫃的股票還是前一天的，晚上會更新' : '');

  // 大盤指數（總覽最上面那張卡片，見 overview.js）：[{ name, date, close, change, pct }]，加權在前；資料裡沒有的不列
  //   pct 是漲跌幅（%）：漲跌點數 ÷ 前一天的收盤指數（今天收盤減掉漲跌）
  //   還在下載、下載不了、舊的資料沒有 index 時回傳 []，卡片就不顯示
  const INDEX_NAMES = [['taiex', '加權指數'], ['tpex', '櫃買指數']];
  function indices() {
    return INDEX_NAMES.map(([k, name]) => {
      const r = data?.index?.[k];
      if (!r || typeof r.date !== 'string' || !(r.close > 0) || typeof r.change !== 'number') return null;
      const before = r.close - r.change;
      return { name, date: r.date, close: r.close, change: r.change, pct: before > 0 ? (r.change / before) * 100 : null };
    }).filter(Boolean);
  }
  // 卡片上面那一行：「11/06 收盤」；兩個指數的日期不一樣時，另一個寫在後面（「11/06 收盤・櫃買 11/05」）
  function indexLine(list = indices()) {
    if (!list.length) return '';
    const [first, ...rest] = list;
    const other = rest.filter(r => r.date !== first.date).map(r => `${r.name.slice(0, 2)} ${md(r.date)}`);
    return [`${md(first.date)} 收盤`, ...other].join('・');
  }

  return {
    get, quote, tag, closeOn, closeDates, mixed, closeTag, priceLine, priceText, priceNote, closeLine, closeNote, waiting, load, refresh,
    indices, indexLine,
    // 資料裡的每一檔（選股的「全市場」）
    codes: () => (data ? Object.keys(data.rows) : []),
    date: () => (data ? data.date : ''),
    state: () => state,
    ready: () => state === 'ready',
    onChange: fn => listeners.push(fn),
  };
})();
