// 帳戶紀錄（schema.js 的 history）：每位成員每個交易日的付出成本、市值，看帳戶的走勢用
//   App 打開時自動記（見 app.js 的 recordHistory）：收盤資料裡有收盤價的日子（最近一個交易日、最近兩個月的月底，見 market.js）
//     持股和付出成本推算到那天收盤後（見 holdings.js），市值用那天的收盤價；不用 GOOGLEFINANCE 的現價（盤中會變）
//   不記的：
//     已經有那天的紀錄（自動記的、自己補的都算）、那天沒有持股
//     那天在這位成員第一期庫存快照之前：那時候的持股推算不出來（沒有快照、只記交易的，從第一筆交易開始）
//     有一檔還沒有那天的收盤價（櫃買中心的資料晚一點才出來）：等晚上那次更新再記，免得少算
//   收盤資料裡沒有的股票（興櫃）不算進付出成本和市值
//   記下來就固定了：之後補記以前的交易，舊的紀錄不會跟著改（刪掉的話，還有收盤價的日子下次打開會重記）
//   盤中先記（status 是「盤中」）：今天還沒收盤時自己新增的，用當下的現價（和總覽的庫存總市值一樣）；
//     收盤資料有那一天以後打開 App，自動換成收盤價算的數字、拿掉「盤中」（見 settle）
//     隔天以後才打開、那天的收盤價已經查不到時換不了，留著盤中的數字和標記
//   id 用成員和日期組成：兩台裝置同一天都記了，同步時是同一筆，不會變兩筆
const History = (() => {
  const LIVE = '盤中';
  // 成員的持股從哪一天推算得出來：第一期庫存快照；沒有快照時是第一筆交易；都沒有時是 null
  function startOf(member) {
    const first = list => list.reduce((d, r) => (r.date && (!d || r.date < d) ? r.date : d), null);
    return first(Store.list('snapshots', member)) || first(Store.list('trades', member));
  }

  const heldOn = (member, date) => (Holdings.memberAll(member, date)?.positions || []).filter(p => p.shares > 0);

  // 這位成員這一天的紀錄：{ cost, value }；不能記（還沒有收盤價、沒有持股）時回傳 null
  function measure(member, date) {
    const held = heldOn(member, date);
    let cost = 0;
    let value = 0;
    let priced = 0;
    for (const p of held) {
      const close = Market.closeOn(p.code, date);
      if (close === null) {
        if (Market.get(p.code)) return null; // 收盤資料裡有這一檔，只是還沒有那天的價格
        continue;
      }
      cost += p.cost;
      value += p.shares * close;
      priced++;
    }
    return priced ? { cost: Math.round(cost), value: Math.round(value) } : null;
  }

  // 該補記的紀錄：[{ id, member, date, cost, value }]
  function due() {
    if (!Market.ready()) return [];
    const have = new Set(Store.list('history', 'all').map(r => `${r.member}|${r.date}`));
    return Store.members().flatMap(m => {
      const start = startOf(m.id);
      if (!start) return [];
      return Market.closeDates()
        .filter(date => date >= start && !have.has(`${m.id}|${date}`))
        .map(date => ({ date, got: measure(m.id, date) }))
        .filter(x => x.got)
        .map(({ date, got }) => ({ id: `h-${m.id}-${date}`, member: m.id, date, ...got }));
    });
  }

  // 還沒收盤（收盤資料還沒有今天的）
  const beforeClose = date => date === U.today() && !(Market.ready() && Market.date() >= date);

  // 今天盤中：用現價（連結 Google 時是即時價，抓不到的用最近的收盤價，和總覽的庫存總市值一樣）；抓不到現價的那幾檔不算
  function measureLive(member, date) {
    const priced = heldOn(member, date).map(p => ({ p, price: Market.quote(p.code).price })).filter(x => x.price !== null);
    if (!priced.length) return null;
    return {
      cost: Math.round(priced.reduce((s, x) => s + x.p.cost, 0)),
      value: Math.round(priced.reduce((s, x) => s + x.p.shares * x.price, 0)),
    };
  }

  // 新增帳戶紀錄的表單先帶入的數字（見 schema.js 的 history）：{ cost, value, live }，算不出來的是 null
  //   和自動記的同一種算法，數字和那天收盤後總覽的庫存總市值卡片一樣（只是一位成員的）
  //   今天還沒收盤：用現價（live 是 true），存起來標成「盤中」，收盤後自動換成收盤價（見 settle）
  //   那天的收盤價查不到（更早的日子）：只算付出成本，市值照券商的歷史抄
  //   第一期庫存快照之前：都推算不出來
  function estimate(member, date) {
    const none = { cost: null, value: null, live: false };
    const start = member && date ? startOf(member) : null;
    if (!start || date < start) return none;
    if (beforeClose(date)) {
      const got = measureLive(member, date);
      return got ? { ...got, live: true } : none;
    }
    const got = measure(member, date);
    if (got) return { ...got, live: false };
    const held = heldOn(member, date);
    return { ...none, cost: held.length ? Math.round(held.reduce((s, p) => s + p.cost, 0)) : null };
  }

  // 存檔時的狀態（見 schema.js 的 beforeSave）：日期是今天、還沒收盤的是「盤中」
  const statusOf = date => (beforeClose(date) ? LIVE : '');

  // 盤中先記的，收盤資料有那一天了：換成收盤價算的數字，拿掉「盤中」；[{ id, values }]
  function settle() {
    if (!Market.ready()) return [];
    const dates = new Set(Market.closeDates());
    return Store.list('history', 'all')
      .filter(r => r.status === LIVE && dates.has(r.date))
      .map(r => ({ r, got: measure(r.member, r.date) }))
      .filter(x => x.got)
      .map(({ r, got }) => ({ id: r.id, values: { ...got, status: '' } }));
  }

  // 走勢圖（見 trend.js）：目前檢視範圍每一天的合計 [{ date, cost, value, live }]，日期舊到新
  //   同一天有人只補了市值（付出成本空白）時，那天的 cost 是 null（圖上只畫市值）；有人是盤中先記的，live 是 true
  function series() {
    const byDate = new Map();
    Store.list('history').forEach(r => {
      if (!r.date || typeof r.value !== 'number') return;
      const d = byDate.get(r.date) || { date: r.date, cost: 0, value: 0, live: false };
      d.value += r.value;
      d.cost = d.cost === null || typeof r.cost !== 'number' ? null : d.cost + r.cost;
      d.live = d.live || r.status === LIVE;
      byDate.set(r.date, d);
    });
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  return { LIVE, due, settle, estimate, statusOf, series, startOf };
})();
