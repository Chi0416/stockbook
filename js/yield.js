// 殖利率：行情的一頁（列表、「全部｜持有｜觀察」、搜尋見 market.js），預設殖利率由高到低
//   排序：依殖利率、依暴力年化（高的在前，算不出來的放最後）或依代號
//   近一年現金股利：公告的除權息（shared/dividends.json，見 announced.js）加上自己記的除權息，照配息頻率取最近幾次（月配 12、季配 4、半年配 2、年配 1）
//     公告的除權息是 App 打開時才下載的：還沒下載好、下載不了時，卡片寫出來，下載好之後整頁重畫（app.js）
//     不直接抓 365 天：除息日每年差一兩天時，去年同一期還在範圍內，會多算一次
//     同一次（代號相同、除權息日差 7 天內，見 announced.js）以公告為主；公告的金額還沒出來、或公告裡沒有的，用自己記的
//   殖利率 = 近一年現金股利 ÷ 現價（大字）
//   暴力年化 = 最近一次 × 一年配幾次 ÷ 現價（卡片右下那一格，深色字；年配的和殖利率一樣）
//     比殖利率高，代表最近一次配得比近一年平均多；成本殖利率（÷ 成本均價）只是看起來高，2026-10-07 拿掉，換成這一格
//     最近一次比近一年平均每次多：紅色，少：綠色（台股的習慣，和總覽的損益一樣）；一樣多、近一年只配一次（年配）：不上色
//       和平均每次比，不直接比殖利率：剛上市、近一年次數不夠時，殖利率會少算，暴力年化一定比較高
//   現價：連結 Google 時用試算表的 GOOGLEFINANCE 抓的（見 sync.js），抓不到的、沒連結的用最近一次的收盤價（見 market.js）
//     全市場的其他股票都用收盤價（GOOGLEFINANCE 只抓持股和觀察清單）
//   殖利率達到星星條件、暴力年化是紅色時，數字旁邊標 ★（見 stars.js）

const Yield = (() => {
  const DAY = 86400000;
  const FREQ = { 12: '月配', 4: '季配', 2: '半年配', 1: '年配' };
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const days = (a, b) => (Date.parse(a) - Date.parse(b)) / DAY;
  const byExDesc = (a, b) => (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0);

  // 這一檔每一次的現金股利，除權息日新的在前：[{ exDate, payDate, cash, stock, own }]
  //   cash 是 null：公告了日期、金額還沒公告，自己也還沒記；own：金額用的是自己記的
  //   stock：同一次另外配的股票股利（元，沒有是 0；詳細頁的配息紀錄寫出來，殖利率不算）
  //   own（參數）：自己記的除權息
  function events(code, own) {
    const c = key(code);
    if (!c) return [];
    const mine = own.filter(d => key(d.code) === c && d.exDate && typeof d.cash === 'number' && d.cash > 0);
    const pub = Announced.forCode(c).filter(r => r.cash !== 0); // 只配股的不算
    const list = pub.map(r => {
      const m = r.cash == null ? mine.find(d => Announced.sameEvent(d, r)) : null;
      return { exDate: r.exDate, payDate: r.payDate, cash: m ? m.cash : r.cash, stock: r.stock || 0, own: !!m };
    });
    mine.filter(d => !pub.some(r => Announced.sameEvent(d, r)))
      .forEach(d => list.push({ exDate: d.exDate, payDate: d.payDate || '', cash: d.cash, stock: d.stock || 0, own: true }));
    return list.sort(byExDesc);
  }

  // 一檔的配息：公告和自己記的都沒有時回傳 null
  //   { per: 一年配幾次, freq: 月配…, recent: 近一年算進去的那幾次, count, sum: 合計,
  //     last: 最近一次（recent 的第一筆）, annual: 最近一次 × 一年配幾次（暴力年化 ÷ 現價之前）,
  //     trend: 最近一次比近一年平均每次多是 1、少是 -1，一樣或近一年只有一次是 0,
  //     next: 下一次（除權息日在今天之後、最近的）,
  //     short: 近一年的次數比一年配的次數少（上市未滿一年、改了配息頻率）, announced: 公告資料裡有這一檔 }
  function info(code, { today = U.today(), own = Store.list('dividends', 'all') } = {}) {
    const list = events(code, own);
    if (!list.length) return null;
    // 一年配幾次：相鄰兩次除權息日相隔天數的中位數（只有一次時當作年配）
    const gaps = list.slice(1).map((r, i) => days(list[i].exDate, r.exDate)).filter(g => g > 0).sort((a, b) => a - b);
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 365;
    const per = gap <= 45 ? 12 : gap <= 120 ? 4 : gap <= 240 ? 2 : 1;
    // 近一年：除權息日在今天以前、金額知道的，最近的 per 次；超過一年又 20 天的不算（年配的除息日晚個幾天也還算得到去年那次）
    const recent = list.filter(r => r.exDate <= today && typeof r.cash === 'number' && days(today, r.exDate) <= 385).slice(0, per);
    const upcoming = list.filter(r => r.exDate > today);
    return {
      per,
      freq: FREQ[per],
      recent,
      count: recent.length,
      sum: U.round(recent.reduce((s, r) => s + r.cash, 0), 6),
      last: recent[0] || null,
      annual: recent.length ? U.round(recent[0].cash * per, 6) : null,
      trend: recent.length > 1 ? Math.sign(U.round(recent[0].cash - recent.reduce((s, r) => s + r.cash, 0) / recent.length, 6)) : 0,
      next: upcoming[upcoming.length - 1] || null,
      short: recent.length < per,
      announced: Announced.forCode(code).length > 0,
    };
  }

  return { events, info };
})();

// 殖利率這一頁（列表見 market.js 的 createMarket）
const YIELD_PAGE = (() => {
  // 今年的日期只寫月/日
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const pct = n => `${U.fmtNum(U.round(n * 100, 2), 2)}%`;
  // 高的在前，算不出來的放最後
  const high = k => (a, b) => (b[k] ?? -1) - (a[k] ?? -1);

  function enrich(r) {
    const info = Yield.info(r.code);
    const { price } = Market.quote(r.code);
    return {
      ...r, info, price,
      y: info?.count && price ? info.sum / price : null,    // 殖利率（近一年）
      ya: info?.annual && price ? info.annual / price : null, // 暴力年化
    };
  }

  // 公告的除權息還沒下載好（App 打開時才下載，見 announced.js）：不能說「公告資料裡沒有這檔」
  const waiting = () => (Announced.state() === 'failed' ? '下載不了公告的除權息（連上網路後會再試）' : '公告的除權息還在下載');

  // 卡片下面的說明：資料從哪來、算不出來的原因、最近一次和下一次除息
  function notes({ info }) {
    const pub = Announced.ready();
    if (!info) return [pub ? '公告資料裡沒有這檔（上櫃 ETF、興櫃沒有資料）' : waiting()];
    const out = [];
    if (!info.count) out.push('近一年沒有配息');
    else if (info.short) out.push(`近一年只有 ${info.count} 次配息，殖利率會偏低（剛上市的常這樣）`);
    const own = info.recent.filter(r => r.own).length;
    if (!info.announced) out.push(pub ? '公告資料裡沒有這檔，用你記的除權息算' : `${waiting()}，先用你記的除權息算`);
    else if (own) out.push(`近一年有 ${own} 次公告還沒有金額，用你記的`);
    if (info.last) out.push(`最近一次 ${md(info.last.exDate)} 除息 ${U.fmtNum(info.last.cash)} 元`);
    const next = info.next;
    if (next) {
      const cash = typeof next.cash === 'number' ? ` ${U.fmtNum(next.cash)} 元${next.own ? '（你記的）' : ''}` : '（金額待公告）';
      out.push(`下次 ${md(next.exDate)} 除息${cash}`);
    }
    return out;
  }

  function cardHTML(r) {
    const { info, price, y, ya } = r;
    const cell = (label, v, cls = '') => `<span class="cell${cls}"><small>${label}</small><span>${v}</span></span>`;
    const cells = [
      cell('現價', price ? U.fmtNum(price, 2) : '—'),
      cell('近一年股利', info?.count ? `${U.fmtNum(info.sum)} 元` : '—'),
      cell('配息', info ? info.freq : '—'),
      cell(`暴力年化${Stars.mark(r, 'trend')}`, ya === null ? '—' : pct(ya), ` strong${ya === null ? '' : info.trend > 0 ? ' up' : info.trend < 0 ? ' down' : ''}`),
    ];
    const tag = holdTagsHTML(r);
    return `
      <div class="card yield-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tag ? `<span class="card-tags">${tag}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>殖利率${Stars.mark(r, 'yield')}</small><b class="yield-pct">${y === null ? '—' : pct(y)}</b></span>
        </span>
        <span class="card-grid">${cells.join('')}</span>
        ${notes(r).map(n => `<span class="card-note">${U.esc(n)}</span>`).join('')}
      </div>`;
  }

  // 列表上面的說明：怎麼算、現價和公告資料是什麼時候的
  //   全市場：持股和觀察清單以外都是收盤價，不一檔一檔數
  function introHTML(all, wide) {
    const how = '殖利率 = 近一年現金股利 ÷ 現價；暴力年化 = 最近一次 × 一年配幾次 ÷ 現價，紅色是最近一次配得比近一年平均多，綠色是比較少。';
    const price = wide ? `價格是 ${md(Market.date())} 收盤價（持股和觀察清單連結 Google 時用即時價格）`
      : Market.priceNote(all.map(r => r.code));
    const updated = Announced.updated();
    const data = [price, updated ? `公告的除權息 ${md(updated)} 更新` : ''].filter(Boolean).join('；');
    return `<p class="list-intro">${how}${data ? `<br>${U.esc(data)}` : ''}</p>`;
  }

  return {
    title: '殖利率',
    sorts: [['yield', '依殖利率', high('y')], ['annual', '依暴力年化', high('ya')], ['code', '依代號', null]],
    enrich, cardHTML, introHTML,
    notes, // 詳細頁（detail.js）也用
  };
})();
