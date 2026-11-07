// 帳戶紀錄（schema.js 的 history）：每位成員每個交易日的付出成本、市值，看帳戶的走勢用
//   App 打開時自動記（見 app.js 的 recordHistory）：收盤資料裡有收盤價的日子（最近一個交易日、最近兩個月的月底，見 market.js）
//     持股和付出成本推算到那天收盤後（見 holdings.js），市值用那天的收盤價；不用 GOOGLEFINANCE 的現價（盤中會變）
//   不記的：
//     已經有那天的紀錄（自動記的、自己補的都算）、那天沒有持股
//     那天在這位成員第一期庫存快照之前：那時候的持股推算不出來（沒有快照、只記交易的，從第一筆交易開始）
//     有一檔還沒有那天的收盤價（櫃買中心的資料晚一點才出來）：等晚上那次更新再記，免得少算
//   收盤資料裡沒有的股票（興櫃）不算進付出成本和市值
//   記下來就固定了：之後補記以前的交易，舊的紀錄不會跟著改（刪掉的話，還有收盤價的日子下次打開會重記）
//   盤中先記（status 是「盤中」）：今天還沒收盤時自己新增的，用當下的現價（延遲價或收盤價，和庫存的庫存總市值一樣）；
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

  // 今天盤中：用現價（連結 Google 時是延遲價，抓不到的用最近的收盤價，和庫存的庫存總市值一樣）；抓不到現價的那幾檔不算
  function measureLive(member, date) {
    const priced = heldOn(member, date).map(p => ({ p, price: Market.quote(p.code).price })).filter(x => x.price !== null);
    if (!priced.length) return null;
    return {
      cost: Math.round(priced.reduce((s, x) => s + x.p.cost, 0)),
      value: Math.round(priced.reduce((s, x) => s + x.p.shares * x.price, 0)),
    };
  }

  // 新增帳戶紀錄的表單先帶入的數字（見 schema.js 的 history）：{ cost, value, live }，算不出來的是 null
  //   和自動記的同一種算法，數字和那天收盤後庫存總市值卡片一樣（只是一位成員的）
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
  //   同一天有人只補了市值（付出成本空白）時，那天的 cost 是 null（算不出損益）；有人是盤中先記的，live 是 true
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

  // 這位成員那天有哪幾檔（表單寫價格是哪一種用，見 schema.js）
  const heldCodes = (member, date) => heldOn(member, date).map(p => p.code);

  // ---------- 帳戶報酬（損益頁，見 views.js 的 realized） ----------
  // 一段期間整個帳戶賺賠多少：含沒賣的漲跌、領到的股利（和損益頁的賣出損益不一樣，賣出損益只算賣掉的）
  //   損益 = 期末市值 − 期初市值 − 期間買進付出 + 期間賣出拿回 + 期間除息的股息淨值
  //     不經過付出成本：快照校正成本、第一期快照之前成本推不準都不影響
  //   報酬率 = 損益 ÷（期初市值 + 期間進出的錢照剩下的天數打折）
  //     月中才放進去的錢只算放進去之後的天數（Modified Dietz），月初就有的錢算整個月
  //   期初、期末用帳戶紀錄記下來的市值（記下來就固定，見上面）：
  //     月：上個月最後一筆 → 這個月最後一筆（還沒過完的月到最近一筆）
  //     年：去年最後一筆 → 今年最後一筆；去年沒有紀錄時從今年第一筆算起（late）
  //     全部：第一筆 → 最後一筆
  //     那個月沒有紀錄、但那天沒有持股（賣光了，或只記交易的還沒開始買）：當作市值 0
  //       第一期庫存快照之前不行：那時候的持股推算不出來
  //   期間的錢：期初那天之後到期末那天（含）的買賣、除息日在這段期間的股息淨值
  //     收盤資料裡沒有的股票（興櫃）不算，和市值一樣；收盤資料還沒下載好時算不出來
  //   每位成員分開算，再把損益和分母加起來；有一位缺紀錄就整段算不出來（全家的才會對）
  const lastDay = ym => {
    const [y, m] = ym.split('-').map(Number);
    return `${ym}-${U.pad2(new Date(y, m, 0).getDate())}`;
  };
  const prevMonth = ym => {
    const [y, m] = ym.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${U.pad2(m - 1)}`;
  };
  const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
  const known = code => !!Market.get(code);
  const endOf = period => (!period ? U.today() : period.length === 4 ? `${period}-12-31` : lastDay(period));

  // 這位成員的帳戶紀錄（有市值、今天以前的），日期舊到新
  const recordsOf = member => Store.memo('history', `records|${member}`, () => Store.list('history', member)
    .filter(r => r.date && r.date <= U.today() && typeof r.value === 'number')
    .sort((a, b) => (a.date < b.date ? -1 : 1)));

  // 那一天沒有持股、可以當作市值 0（第一期庫存快照當天或之後；只記交易的沒有快照，開始買之前本來就是 0）
  function zeroOn(member, date) {
    const first = Store.list('snapshots', member).reduce((d, s) => (s.date && (!d || s.date < d) ? s.date : d), null);
    if (first && date < first) return false;
    return !heldOn(member, date).length;
  }

  // prefix（'2026-10' 或 '2026'）裡最後一筆紀錄 { date, value }；沒有紀錄但那天沒有持股時是那段最後一天（不超過今天）的 0
  function lastIn(member, prefix) {
    const list = recordsOf(member).filter(r => r.date.startsWith(prefix));
    if (list.length) return { date: list.at(-1).date, value: list.at(-1).value };
    const end = endOf(prefix);
    const date = end < U.today() ? end : U.today();
    if (!date.startsWith(prefix)) return null; // 還沒到
    return zeroOn(member, date) ? { date, value: 0 } : null;
  }

  // 期間的兩端 { from, to, late }；late：年的期初用今年第一筆（去年沒有紀錄）
  function endsOf(member, period) {
    const recs = recordsOf(member);
    if (!period) return { from: recs[0] || null, to: recs.at(-1) || null, late: false };
    const to = lastIn(member, period);
    const from = lastIn(member, period.length === 4 ? String(+period - 1) : prevMonth(period));
    if (from || period.length !== 4) return { from, to, late: false };
    const first = recs.find(r => r.date.startsWith(period));
    return { from: first || null, to, late: !!first };
  }

  // 期間的錢（放進去是正的）：from 之後到 to（含）的買進（+）、賣出（−）、除息的股息淨值（−，拿出帳戶）
  function flowsOf(member, from, to) {
    const inRange = d => d > from && d <= to;
    const trades = Store.list('trades', member)
      .filter(t => inRange(t.date) && typeof t.settle === 'number' && /[買賣]/.test(t.type ?? '') && known(t.code))
      .map(t => ({ date: t.date, amount: /買/.test(t.type) ? t.settle : -t.settle }));
    const divs = VIEWS.cashDividends.rows('all')
      .filter(r => r.member === member && typeof r.net === 'number' && inRange(r.exDate) && known(r.code))
      .map(r => ({ date: r.exDate, amount: -r.net }));
    return [...trades, ...divs];
  }

  // 一段期間的帳戶報酬（目前檢視範圍）：{ pl, base, rate（%）, from, to, late } 或算不出來時 { pl: null, why }
  //   period：'2026-10'（月）、'2026'（年）、''（全部）
  function returns(period = '') {
    const ready = Market.ready();
    const key = JSON.stringify([period, Store.shown(), ready && Market.date(), U.today()]);
    return Store.memo('history', `returns|${key}`, () => (ready ? returnsOf(period) : { pl: null, why: '收盤資料還沒下載好' }));
  }

  function returnsOf(period) {
    const several = Store.shown().length > 1;
    const out = { pl: 0, base: 0, from: null, to: null, late: false };
    const why = [];
    let any = false;
    Store.shown().forEach(member => {
      const start = startOf(member);
      if (!start || start > endOf(period)) return; // 這段期間還沒開始記帳
      const e = endsOf(member, period);
      if (!e.from || !e.to) {
        const who = several ? `${Store.memberName(member)} ` : '';
        why.push(`${who}${!e.to ? '這段期間' : period.length === 7 ? '上個月' : '去年'}沒有帳戶紀錄`);
        return;
      }
      const flows = flowsOf(member, e.from.date, e.to.date);
      if (!e.from.value && !e.to.value && !flows.length) return; // 這段期間沒有持股，也沒有買賣
      const span = daysBetween(e.from.date, e.to.date);
      const net = flows.reduce((s, f) => s + f.amount, 0);
      const weighted = flows.reduce((s, f) => s + f.amount * (span > 0 ? daysBetween(f.date, e.to.date) / span : 0), 0);
      any = true;
      out.pl += e.to.value - e.from.value - net;
      out.base += e.from.value + weighted;
      out.from = !out.from || e.from.date < out.from ? e.from.date : out.from;
      out.to = !out.to || e.to.date > out.to ? e.to.date : out.to;
      out.late = out.late || e.late;
    });
    if (why.length) return { pl: null, why: why.join('、') };
    if (!any) return { pl: null, why: '這段期間沒有持股' };
    const pl = Math.round(out.pl);
    const base = Math.round(out.base);
    return { ...out, pl, base, rate: base > 0 ? U.round(pl / base * 100, 2) : null };
  }

  // 損益頁統計最上面的每月帳戶報酬：{ unit: 'month' | 'year', year, buckets: [{ key, label, rate }] }
  //   選了年或月：那一年的 1～12 月（還沒到的月份、算不出來的是 null）
  //   全部：帳戶紀錄只有一年時列那一年的月份，兩年以上改成每年一行；沒有紀錄時回傳 null
  function monthly(period = '') {
    const years = [...new Set(Store.shown().flatMap(m => recordsOf(m).map(r => r.date.slice(0, 4))))].sort();
    const now = U.today();
    const year = period ? period.slice(0, 4) : years.length === 1 ? years[0] : null;
    if (!year && !years.length) return null;
    const rate = key => (key > now.slice(0, key.length) ? null : returns(key).rate ?? null);
    if (year) {
      return {
        unit: 'month', year,
        buckets: Array.from({ length: 12 }, (_, i) => `${year}-${U.pad2(i + 1)}`).map((key, i) => ({ key, label: `${i + 1}月`, rate: rate(key) })),
      };
    }
    const last = Math.max(+years.at(-1), +now.slice(0, 4));
    return {
      unit: 'year', year: null,
      buckets: Array.from({ length: last - years[0] + 1 }, (_, i) => String(+years[0] + i)).map(key => ({ key, label: key, rate: rate(key) })),
    };
  }

  // 目前檢視範圍有帳戶紀錄的月份（'2026-10'）：損益頁的年月選單用
  const months = () => [...new Set(Store.shown().flatMap(m => recordsOf(m).map(r => r.date.slice(0, 7))))];

  return { LIVE, due, settle, estimate, statusOf, series, startOf, heldCodes, returns, monthly, months };
})();
