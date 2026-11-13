











const Stats = (() => {
  const TOP = 10;
  const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''));
  const codeKey = v => String(v ?? '').trim().toUpperCase();
  const money = n => U.fmtNum(Math.round(n));
  const sum = list => list.reduce((s, e) => s + e.total, 0);

  const hide = s => (typeof Privacy === 'undefined' ? s : Privacy.num(s));


  function pct(v, total) {
    const p = (v / total) * 100;
    return p > 0 && p < 0.5 ? '<1%' : `${Math.round(p)}%`;
  }




  function timeline(rows, { amount, date, isPending, period }) {
    const valid = rows.filter(r => typeof r[amount] === 'number' && isDate(r[date]));
    const years = [...new Set(valid.map(r => r[date].slice(0, 4)))].sort();
    if (!years.length) return null;

    const year = period ? period.slice(0, 4) : years.length === 1 ? years[0] : null;
    const buckets = year
      ? Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${U.pad2(i + 1)}`, label: `${i + 1}月` }))
      : Array.from({ length: years.at(-1) - years[0] + 1 }, (_, i) => ({ key: String(+years[0] + i), label: String(+years[0] + i) }));
    const byKey = new Map(buckets.map(b => [b.key, Object.assign(b, { done: 0, pending: 0 })]));
    valid.forEach(r => {
      const b = byKey.get(r[date].slice(0, year ? 7 : 4));
      if (b) b[isPending(r) ? 'pending' : 'done'] += r[amount];
    });
    buckets.forEach(b => { b.done = U.round(b.done); b.pending = U.round(b.pending); });
    return { unit: year ? 'month' : 'year', year, buckets };
  }




  function ranking(rows, { amount, date, code, name, isPending, base, signed }) {
    const byCode = new Map();
    rows.forEach(r => {
      const k = codeKey(r[code]);
      if (typeof r[amount] !== 'number' || !k) return;
      const e = byCode.get(k) || { code: k, name: '', latest: '', done: 0, pending: 0, base: 0, members: new Map() };
      const d = String(r[date] ?? '');
      if (r[name] && (!e.name || d >= e.latest)) Object.assign(e, { name: r[name], latest: d });
      e[isPending(r) ? 'pending' : 'done'] += r[amount];
      if (base) e.base += Number(r[base]) || 0;
      if (r.member) e.members.set(r.member, (e.members.get(r.member) || 0) + r[amount]);
      byCode.set(k, e);
    });
    return [...byCode.values()]
      .map(e => ({
        code: e.code, name: e.name, done: U.round(e.done), pending: U.round(e.pending), total: U.round(e.done + e.pending),
        base: U.round(e.base), members: [...e.members].map(([m, v]) => [m, U.round(v)]),
      }))
      .filter(e => (signed ? e.total !== 0 : e.total > 0))
      .sort((a, b) => b.total - a.total || (a.code < b.code ? -1 : 1));
  }



  function payouts(rows, codeValue, { amount, date, code, status }) {
    const byId = new Map();
    rows.forEach(r => {
      if (typeof r[amount] !== 'number' || codeKey(r[code]) !== codeValue) return;
      const e = byId.get(r.id) || { date: String(r[date] ?? ''), amount: 0, status: status ? status(r) : null };
      e.amount += r[amount];
      byId.set(r.id, e);
    });
    return [...byId.values()]
      .map(e => ({ ...e, amount: U.round(e.amount) }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }


  const LEGEND = '<span class="legend"><i class="done"></i>已入帳<i class="pend"></i>待入帳</span>';

  const CHEVRON = '<svg class="rank-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';


  function barHTML(done, pending, width) {
    const seg = (cls, v) => (v > 0 ? `<span class="${cls}" style="flex-grow:${v}"></span>` : '');
    return `<span class="bar" style="width:${U.round(width, 2)}%">${seg('done', done)}${seg('pend', pending)}</span>`;
  }



  const scaleOf = values => Math.max(0, ...values.map(v => Math.abs(v)));
  function signedBarHTML(v, max) {
    const width = max > 0 ? (Math.abs(v) / max) * 100 : 0;
    return `<span class="bar-track"><span class="bar ${v < 0 ? 'down' : 'up'}" style="width:${U.round(width, 2)}%">` +
      '<span class="done" style="flex-grow:1"></span></span></span>';
  }



  function ratesHTML({ title, note, buckets, selected }) {
    const scale = scaleOf(buckets.map(b => b.rate ?? 0));
    const rows = buckets.map(b => {
      const head = `<span class="bar-label">${U.esc(b.label)}</span>`;
      if (b.rate === null) return `<div class="bar-row empty">${head}<span class="bar-track"></span><span class="bar-value">—</span></div>`;
      return `
        <button type="button" class="bar-row${b.key === selected ? ' on' : ''}" data-act="period" data-value="${U.esc(b.key)}">
          ${head}${signedBarHTML(b.rate, scale)}<span class="bar-value">${hide(`${U.fmtNum(b.rate, 2)}%`)}</span>
        </button>`;
    }).join('');
    return `<section class="stats-sec"><h3 class="stats-head">${U.esc(title)}</h3>` +
      `${note ? `<p class="stats-note">${U.esc(note)}</p>` : ''}<div class="stats-rows">${rows}</div></section>`;
  }

  function timelineHTML(t, { label, selected, signed }) {
    const values = t.buckets.map(b => b.done + b.pending);
    const scale = scaleOf(values);
    const max = Math.max(...values);
    if (signed ? !(scale > 0) : !(max > 0)) return '';
    const title = t.unit === 'month' ? `${t.year} 年每月${label}` : `每年${label}`;
    const rows = t.buckets.map(b => {
      const v = b.done + b.pending;
      const head = `<span class="bar-label">${U.esc(b.label)}</span>`;
      if (signed ? !v : !(v > 0)) return `<div class="bar-row empty">${head}<span class="bar-track"></span><span class="bar-value">—</span></div>`;
      const bar = signed ? signedBarHTML(v, scale) : `<span class="bar-track">${barHTML(b.done, b.pending, (v / max) * 100)}</span>`;
      return `
        <button type="button" class="bar-row${b.key === selected ? ' on' : ''}" data-act="period" data-value="${U.esc(b.key)}">
          ${head}${bar}<span class="bar-value">${hide(money(v))}</span>
        </button>`;
    }).join('');
    const legend = t.buckets.some(b => b.pending > 0) ? LEGEND : '';
    return `<section class="stats-sec"><h3 class="stats-head">${U.esc(title)}${legend}</h3><div class="stats-rows">${rows}</div></section>`;
  }


  function payoutsHTML(list) {
    return `<span class="rank-items">${list.map(p => `
      <span class="rank-item${p.status?.pending ? ' pending' : ''}">
        <span class="ri-date">${U.esc(U.fmtDate(p.date))}</span>
        <span>${p.status ? `<span class="badge ${U.esc(p.status.cls)}">${U.esc(p.status.label)}</span>` : ''}</span>
        <span class="ri-amount">${hide(money(p.amount))}</span>
      </span>`).join('')}
    </span>`;
  }

  function rankingHTML(list, { title, periodLabel, expanded, open, details, members, showMembers, signed }) {
    const grand = sum(list);
    const cut = !expanded && list.length > TOP + 1;
    const shown = cut ? list.slice(0, TOP) : list;
    const rest = cut ? list.slice(TOP) : [];
    const max = shown[0].total;
    const scale = scaleOf(shown.map(e => e.total));

    const pctOf = e => (!signed ? pct(e.total, grand)
      : e.base > 0 ? `${U.fmtNum(U.round(e.total / e.base * 100, 2), 2)}%` : '');
    const order = new Map(members.map((m, i) => [m.id, i]));
    const nameOf = id => members.find(m => m.id === id)?.name || '';


    const barRow = (e, bar = true) => `
      <span class="rank-bar">
        ${!bar ? '<span class="bar-track"></span>' : signed ? signedBarHTML(e.total, scale)
          : `<span class="bar-track">${barHTML(e.done, e.pending, (e.total / max) * 100)}</span>`}<span class="bar-value">${hide(money(e.total))}</span>
      </span>`;

    const note = e => {
      if (!showMembers || !e.members.length) return '';
      const each = e.members.slice().sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
        .map(([m, v]) => `${nameOf(m)} ${hide(money(v))}`).join(' · ');
      return `<span class="rank-note">${U.esc(each)}</span>`;
    };
    const rows = shown.map((e, i) => {
      const isOpen = open.has(e.code);
      return `
      <button type="button" class="rank-row" data-act="code" data-value="${U.esc(e.code)}" aria-expanded="${isOpen}">
        <span class="rank-top">
          <span class="rank-no">${i + 1}</span>
          <span class="rank-name"><span class="card-code">${U.esc(e.code)}</span>${U.esc(e.name)}</span>
          <span class="rank-pct">${hide(pctOf(e))}</span>${CHEVRON}
        </span>
        ${barRow(e)}${note(e)}${isOpen ? payoutsHTML(details(e.code)) : ''}
      </button>`;
    }).join('');
    const other = rest.length ? `
      <button type="button" class="rank-row" data-act="more" aria-expanded="false">
        <span class="rank-top">
          <span class="rank-no"></span>
          <span class="rank-name">其他 ${rest.length} 檔<small>點一下看全部</small></span>
          <span class="rank-pct">${hide(pctOf({ total: sum(rest), base: rest.reduce((s, e) => s + e.base, 0) }))}</span>${CHEVRON}
        </span>
        ${barRow({ total: sum(rest) }, false)}
      </button>` : '';

    const gain = list.filter(e => e.total > 0).length;
    const sub = (periodLabel ? `${periodLabel} · ` : '') +
      (signed ? `共 ${list.length} 檔，賺 ${gain} 檔、賠 ${list.length - gain} 檔`
        : list.length > 3 ? `共 ${list.length} 檔，前 3 檔佔 ${hide(pct(sum(list.slice(0, 3)), grand))}` : `共 ${list.length} 檔`);
    return `
      <section class="stats-sec">
        <h3 class="stats-head">${U.esc(title)}</h3>
        <p class="stats-note">${U.esc(sub)}</p>
        <div class="stats-rows">${rows}${other}</div>
      </section>`;
  }





  function html(cfg, { rows, context, period = '', periodLabel = '', isPending, status, open = new Set(), expanded, members, showMembers }) {
    const keys = { amount: cfg.amount, date: cfg.date, code: cfg.code, name: cfg.name, isPending, base: cfg.base, signed: cfg.signed };
    const list = ranking(rows, keys);
    if (!list.length) return `<p class="empty">這段期間沒有算得出金額的${U.esc(cfg.label)}</p>`;
    const t = timeline(context, { ...keys, period });
    const details = code => payouts(rows, code, { ...keys, status });
    return (t ? timelineHTML(t, { label: cfg.label, selected: period.length === 7 ? period : '', signed: cfg.signed }) : '') +
      rankingHTML(list, { title: cfg.ranking, periodLabel, expanded, open, details, members, showMembers, signed: cfg.signed });
  }

  return { timeline, ranking, payouts, pct, html, ratesHTML };
})();
