// 帳戶紀錄（schema.js 的 history）：每位成員每個交易日的付出成本、市值，看帳戶的走勢用
//   App 打開時自動記（見 app.js 的 recordHistory）：收盤資料裡有收盤價的日子（最近一個交易日、最近兩個月的月底，見 market.js）
//     持股和付出成本推算到那天收盤後（見 holdings.js），市值用那天的收盤價；不用 GOOGLEFINANCE 的現價（盤中會變）
//   不記的：
//     已經有那天的紀錄（自動記的、自己補的都算）、那天沒有持股
//     那天在這位成員第一期庫存快照之前：那時候的持股推算不出來（沒有快照、只記交易的，從第一筆交易開始）
//     有一檔還沒有那天的收盤價（櫃買中心的資料晚一點才出來）：等晚上那次更新再記，免得少算
//   收盤資料裡沒有的股票（興櫃）不算進付出成本和市值
//   記下來就固定了：之後補記以前的交易，舊的紀錄不會跟著改（刪掉的話，還有收盤價的日子下次打開會重記）
//   id 用成員和日期組成：兩台裝置同一天都記了，同步時是同一筆，不會變兩筆
const History = (() => {
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

  // 新增帳戶紀錄的表單先帶入的數字（見 schema.js 的 history）：{ cost, value }，算不出來的是 null
  //   和自動記的同一種算法，數字和那天收盤後總覽的庫存總市值卡片一樣（只是一位成員的）
  //   那天的收盤價查不到（更早的日子）：只算付出成本，市值照券商的歷史抄
  //   第一期庫存快照之前：都推算不出來
  function estimate(member, date) {
    const start = member && date ? startOf(member) : null;
    if (!start || date < start) return { cost: null, value: null };
    const got = measure(member, date);
    if (got) return got;
    const held = heldOn(member, date);
    return { cost: held.length ? Math.round(held.reduce((s, p) => s + p.cost, 0)) : null, value: null };
  }

  // 走勢圖（見 trend.js）：目前檢視範圍每一天的合計 [{ date, cost, value }]，日期舊到新
  //   同一天有人只補了市值（付出成本空白）時，那天的 cost 是 null（圖上只畫市值）
  function series() {
    const byDate = new Map();
    Store.list('history').forEach(r => {
      if (!r.date || typeof r.value !== 'number') return;
      const d = byDate.get(r.date) || { date: r.date, cost: 0, value: 0 };
      d.value += r.value;
      d.cost = d.cost === null || typeof r.cost !== 'number' ? null : d.cost + r.cost;
      byDate.set(r.date, d);
    });
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  return { due, estimate, series, startOf };
})();
