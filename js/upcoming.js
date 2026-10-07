// 即將除權息：持股總覽的一張卡片（見 overview.js），列出持股和觀察清單接下來 30 天要除權息的
//   除權息日當天參考價會扣掉股利，看起來變便宜，可以當作買進的時間點參考；想領這次股利，最晚前一個交易日買進
//   資料：公告的除權息（announced.js）加上自己記的除權息；同一次（代號相同、除權息日差 7 天內）以公告為主，
//         公告的金額還沒出來時用自己記的；百分比是每股現金股利 ÷ 現價（連結 Google 才有現價），參考價大約少這麼多
//   持股跟著上面選的成員；觀察清單全家共用；兩邊都有的標「持有」
const Upcoming = (() => {
  const DAYS = 30;
  const MAX = 8; // 卡片上最多列幾筆，其他的寫「還有 N 筆」
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const num = v => (typeof v === 'number' ? v : null);

  function plusDays(iso, n) {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${U.pad2(d.getMonth() + 1)}-${U.pad2(d.getDate())}`;
  }

  // 這些代號在今天到 days 天後（都含）要除權息的：[{ code, exDate, payDate, cash, stock, own }]，除權息日早的在前
  //   cash 是 null：金額還沒公告、自己也還沒記；own：金額用的是自己記的
  function list(codes, { today = U.today(), days = DAYS, own = Store.list('dividends', 'all') } = {}) {
    const until = plusDays(today, days);
    const inRange = d => !!d && d >= today && d <= until;
    return [...new Set(codes.map(key).filter(Boolean))].flatMap(c => {
      const mine = own.filter(d => key(d.code) === c && inRange(d.exDate));
      const pub = Announced.forCode(c).filter(r => inRange(r.exDate));
      const rows = pub.map(r => {
        const m = r.cash == null ? mine.find(d => Announced.sameEvent(d, r) && num(d.cash) !== null) : null;
        return { code: c, exDate: r.exDate, payDate: r.payDate, cash: m ? m.cash : r.cash, stock: r.stock || 0, own: !!m };
      });
      mine.filter(d => !pub.some(r => Announced.sameEvent(d, r))).forEach(d => rows.push({
        code: c, exDate: d.exDate, payDate: d.payDate || '', cash: num(d.cash), stock: num(d.stock) || 0, own: true,
      }));
      return rows;
    }).sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }

  // 卡片：holdings 是 Holdings.all 的結果（沒有持股時是 null），q 是現價（Sync.prices，沒連結時是 null）
  function cardHTML(holdings, q) {
    const today = U.today();
    const held = new Map((holdings ? holdings.positions : []).filter(p => p.shares > 0).map(p => [p.code, p.name]));
    const watched = new Map(Store.list('watch').map(r => [key(r.code), r.name]));
    const rows = list([...held.keys(), ...watched.keys()], { today });
    const nameOf = c => held.get(c) || watched.get(c) || (typeof STOCK_LIST !== 'undefined' && STOCK_LIST.names[c]) || '';
    const md = d => (d.startsWith(today.slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
    const pct = n => `${U.fmtNum(U.round(n * 100, 2), 2)}%`;

    const row = r => {
      const price = q?.quotes[r.code];
      const cash = r.cash === null ? '金額待公告'
        : `${U.fmtNum(r.cash)} 元${r.stock ? `＋配股 ${U.fmtNum(r.stock)} 元` : ''}${r.own ? '（你記的）' : ''}`;
      const drop = r.cash !== null && typeof price === 'number' && price > 0 ? `約 ${pct(r.cash / price)}` : '';
      const tag = held.has(r.code) ? '<span class="badge member">持有</span>' : '<span class="badge">觀察</span>';
      return `
        <li class="up-row">
          <span class="up-date">${md(r.exDate)} ${r.exDate === today ? '今天' : U.weekday(r.exDate)}</span>
          <span class="up-cash">${U.esc(cash)}</span>
          <span class="up-name"><span class="card-code">${U.esc(r.code)}</span>${U.esc(nameOf(r.code))} ${tag}</span>
          <span class="up-pct">${drop}</span>
        </li>`;
    };

    let body;
    if (!held.size && !watched.size) body = '<span class="kpi-sub">還沒有持股和觀察的股票</span>';
    else if (!Announced.ready() && !rows.length) {
      body = `<span class="kpi-sub">${Announced.state() === 'failed' ? '下載不了公告的除權息（連上網路後會再試）' : '公告的除權息還在下載'}</span>`;
    } else if (!rows.length) body = `<span class="kpi-sub">接下來 ${DAYS} 天沒有已公告的除權息</span>`;
    else {
      const more = rows.length - MAX;
      body = `<ul class="up-list">${rows.slice(0, MAX).map(row).join('')}</ul>` +
        (more > 0 ? `<span class="kpi-sub">還有 ${more} 筆</span>` : '') +
        '<span class="kpi-sub">除權息日當天參考價會扣掉股利，大約少右邊的 %；想領這次股利，最晚前一個交易日買進</span>';
    }
    return `
      <div class="kpi wide upcoming">
        <small>即將除權息</small>
        <span class="kpi-sub">持股和觀察清單，接下來 ${DAYS} 天</span>
        ${body}
      </div>`;
  }

  return { list, cardHTML };
})();
