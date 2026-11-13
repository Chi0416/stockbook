












const History = (() => {
  const LIVE = '盤中';

  function startOf(member) {
    const first = list => list.reduce((d, r) => (r.date && (!d || r.date < d) ? r.date : d), null);
    return first(Store.list('snapshots', member)) || first(Store.list('trades', member));
  }

  const heldOn = (member, date) => (Holdings.memberAll(member, date)?.positions || []).filter(p => p.shares > 0);


  function measure(member, date) {
    const held = heldOn(member, date);
    let cost = 0;
    let value = 0;
    let priced = 0;
    for (const p of held) {
      const close = Market.closeOn(p.code, date);
      if (close === null) {
        if (Market.get(p.code)) return null;
        continue;
      }
      cost += p.cost;
      value += p.shares * close;
      priced++;
    }
    return priced ? { cost: Math.round(cost), value: Math.round(value) } : null;
  }


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


  const beforeClose = date => date === U.today() && !(Market.ready() && Market.date() >= date);


  function measureLive(member, date) {
    const priced = heldOn(member, date).map(p => ({ p, price: Market.quote(p.code).price })).filter(x => x.price !== null);
    if (!priced.length) return null;
    return {
      cost: Math.round(priced.reduce((s, x) => s + x.p.cost, 0)),
      value: Math.round(priced.reduce((s, x) => s + x.p.shares * x.price, 0)),
    };
  }






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


  const statusOf = date => (beforeClose(date) ? LIVE : '');


  function settle() {
    if (!Market.ready()) return [];
    const dates = new Set(Market.closeDates());
    return Store.list('history', 'all')
      .filter(r => r.status === LIVE && dates.has(r.date))
      .map(r => ({ r, got: measure(r.member, r.date) }))
      .filter(x => x.got)
      .map(({ r, got }) => ({ id: r.id, values: { ...got, status: '' } }));
  }



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


  const heldCodes = (member, date) => heldOn(member, date).map(p => p.code);
















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


  const recordsOf = member => Store.memo('history', `records|${member}`, () => Store.list('history', member)
    .filter(r => r.date && r.date <= U.today() && typeof r.value === 'number')
    .sort((a, b) => (a.date < b.date ? -1 : 1)));


  function zeroOn(member, date) {
    const first = Store.list('snapshots', member).reduce((d, s) => (s.date && (!d || s.date < d) ? s.date : d), null);
    if (first && date < first) return false;
    return !heldOn(member, date).length;
  }


  function lastIn(member, prefix) {
    const list = recordsOf(member).filter(r => r.date.startsWith(prefix));
    if (list.length) return { date: list.at(-1).date, value: list.at(-1).value };
    const end = endOf(prefix);
    const date = end < U.today() ? end : U.today();
    if (!date.startsWith(prefix)) return null;
    return zeroOn(member, date) ? { date, value: 0 } : null;
  }


  function endsOf(member, period) {
    const recs = recordsOf(member);
    if (!period) return { from: recs[0] || null, to: recs.at(-1) || null, late: false };
    const to = lastIn(member, period);
    const from = lastIn(member, period.length === 4 ? String(+period - 1) : prevMonth(period));
    if (from || period.length !== 4) return { from, to, late: false };
    const first = recs.find(r => r.date.startsWith(period));
    return { from: first || null, to, late: !!first };
  }


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
      if (!start || start > endOf(period)) return;
      const e = endsOf(member, period);
      if (!e.from || !e.to) {
        const who = several ? `${Store.memberName(member)} ` : '';
        why.push(`${who}${!e.to ? '這段期間' : period.length === 7 ? '上個月' : '去年'}沒有帳戶紀錄`);
        return;
      }
      const flows = flowsOf(member, e.from.date, e.to.date);
      if (!e.from.value && !e.to.value && !flows.length) return;
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


  const months = () => [...new Set(Store.shown().flatMap(m => recordsOf(m).map(r => r.date.slice(0, 7))))];

  return { LIVE, due, settle, estimate, statusOf, series, startOf, heldCodes, returns, monthly, months };
})();
