// 統計：推算頁面「明細｜統計」切換到統計時的畫面（目前用在累積現金股利，設定見 views.js 的 stats）
//   每月：選了年份或月份時，列出那一年的 1～12 月；選「全部」而且資料跨兩年以上時，改成每年一行
//         年月以外的篩選（搜尋、成員）照樣套用；選了某個月時標出那個月
//   排行：依代號合計（全家時各成員加在一起），由大到小，旁邊寫佔全部的比例
//         超過 TOP + 1 檔時，後面的合成一行「其他 N 檔」，點了才全部列出
//         點某一檔時在下面展開那一檔每一次配息（日期、金額、還沒入帳的標籤）
//   長條以最多的那一行（月份或股票）為滿格：股票多的時候每檔只佔幾 %，照佔比畫會短到看不出差別
//   已入帳畫實心、待入帳畫淡色，佔比用兩者的合計算；算不出來（金額空白）的不計入，合計卡片上已經有提示
//   點擊由 list.js 處理（data-act）：period 每月的某一行、code 排行的某一檔、more「其他 N 檔」，點了都留在統計
const Stats = (() => {
  const TOP = 10;
  const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''));
  const codeKey = v => String(v ?? '').trim().toUpperCase();
  const money = n => U.fmtNum(Math.round(n));
  const sum = list => list.reduce((s, e) => s + e.total, 0);

  // 佔比：四捨五入到整數，不到 0.5% 寫成「<1%」
  function pct(v, total) {
    const p = (v / total) * 100;
    return p > 0 && p < 0.5 ? '<1%' : `${Math.round(p)}%`;
  }

  // 每月（或每年）的合計：{ unit: 'month' | 'year', year, buckets: [{ key, label, done, pending }] }
  //   rows 只套用了搜尋與成員；period 是年月篩選的值（''、'2026'、'2026-08'）
  //   key 可以直接當年月篩選的值；沒有可以統計的金額時回傳 null
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

  // 依代號合計（不分大小寫），由大到小：[{ code, name, done, pending, total, members: [[成員 id, 金額], ...] }]
  //   名稱用日期最新的那一筆；合計是 0 的不列出
  function ranking(rows, { amount, date, code, name, isPending }) {
    const byCode = new Map();
    rows.forEach(r => {
      const k = codeKey(r[code]);
      if (typeof r[amount] !== 'number' || !k) return;
      const e = byCode.get(k) || { code: k, name: '', latest: '', done: 0, pending: 0, members: new Map() };
      const d = String(r[date] ?? '');
      if (r[name] && (!e.name || d >= e.latest)) Object.assign(e, { name: r[name], latest: d });
      e[isPending(r) ? 'pending' : 'done'] += r[amount];
      if (r.member) e.members.set(r.member, (e.members.get(r.member) || 0) + r[amount]);
      byCode.set(k, e);
    });
    return [...byCode.values()]
      .map(e => ({
        code: e.code, name: e.name, done: U.round(e.done), pending: U.round(e.pending), total: U.round(e.done + e.pending),
        members: [...e.members].map(([m, v]) => [m, U.round(v)]),
      }))
      .filter(e => e.total > 0)
      .sort((a, b) => b.total - a.total || (a.code < b.code ? -1 : 1));
  }

  // 某一檔每一次配息，新的在上面：[{ date, amount, status }]
  //   全家時同一次除權息有好幾位成員各一列（id 相同），金額加在一起；status 是卡片上的狀態標籤（待發放等）
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

  // ---------- 畫面 ----------
  const LEGEND = '<span class="legend"><i class="done"></i>已入帳<i class="pend"></i>待入帳</span>';
  // 排行每一行右上角的「⌄」：可以點開，點開後轉成朝上
  const CHEVRON = '<svg class="rank-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  // 長條：已入帳實心、待入帳淡色；width 是整條佔欄寬的百分比
  function barHTML(done, pending, width) {
    const seg = (cls, v) => (v > 0 ? `<span class="${cls}" style="flex-grow:${v}"></span>` : '');
    return `<span class="bar" style="width:${U.round(width, 2)}%">${seg('done', done)}${seg('pend', pending)}</span>`;
  }

  function timelineHTML(t, { label, selected }) {
    const max = Math.max(...t.buckets.map(b => b.done + b.pending));
    if (!(max > 0)) return '';
    const title = t.unit === 'month' ? `${t.year} 年每月${label}` : `每年${label}`;
    const rows = t.buckets.map(b => {
      const v = b.done + b.pending;
      const head = `<span class="bar-label">${U.esc(b.label)}</span>`;
      if (!(v > 0)) return `<div class="bar-row empty">${head}<span class="bar-track"></span><span class="bar-value">—</span></div>`;
      return `
        <button type="button" class="bar-row${b.key === selected ? ' on' : ''}" data-act="period" data-value="${U.esc(b.key)}">
          ${head}<span class="bar-track">${barHTML(b.done, b.pending, (v / max) * 100)}</span><span class="bar-value">${money(v)}</span>
        </button>`;
    }).join('');
    const legend = t.buckets.some(b => b.pending > 0) ? LEGEND : '';
    return `<section class="stats-sec"><h3 class="stats-head">${U.esc(title)}${legend}</h3><div class="stats-rows">${rows}</div></section>`;
  }

  // 點開的那一檔：每一次配息一行（日期｜狀態標籤｜金額），還沒入帳的金額變淡
  function payoutsHTML(list) {
    return `<span class="rank-items">${list.map(p => `
      <span class="rank-item${p.status?.pending ? ' pending' : ''}">
        <span class="ri-date">${U.esc(U.fmtDate(p.date))}</span>
        <span>${p.status ? `<span class="badge ${U.esc(p.status.cls)}">${U.esc(p.status.label)}</span>` : ''}</span>
        <span class="ri-amount">${money(p.amount)}</span>
      </span>`).join('')}
    </span>`;
  }

  function rankingHTML(list, { title, periodLabel, expanded, open, details, members, showMembers }) {
    const grand = sum(list);
    const cut = !expanded && list.length > TOP + 1;
    const shown = cut ? list.slice(0, TOP) : list;
    const rest = cut ? list.slice(TOP) : [];
    const max = shown[0].total;
    const order = new Map(members.map((m, i) => [m.id, i]));
    const nameOf = id => members.find(m => m.id === id)?.name || '';

    // 「其他 N 檔」是好幾檔加起來的，常常比第一名還多，只寫金額不畫長條，免得看起來像第一名
    const barRow = (e, bar = true) => `
      <span class="rank-bar">
        <span class="bar-track">${bar ? barHTML(e.done, e.pending, (e.total / max) * 100) : ''}</span><span class="bar-value">${money(e.total)}</span>
      </span>`;
    // 全家檢視時列出每人各領多少
    const note = e => {
      if (!showMembers || !e.members.length) return '';
      const each = e.members.slice().sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
        .map(([m, v]) => `${nameOf(m)} ${money(v)}`).join(' · ');
      return `<span class="rank-note">${U.esc(each)}</span>`;
    };
    const rows = shown.map((e, i) => {
      const isOpen = open.has(e.code);
      return `
      <button type="button" class="rank-row" data-act="code" data-value="${U.esc(e.code)}" aria-expanded="${isOpen}">
        <span class="rank-top">
          <span class="rank-no">${i + 1}</span>
          <span class="rank-name"><span class="card-code">${U.esc(e.code)}</span>${U.esc(e.name)}</span>
          <span class="rank-pct">${pct(e.total, grand)}</span>${CHEVRON}
        </span>
        ${barRow(e)}${note(e)}${isOpen ? payoutsHTML(details(e.code)) : ''}
      </button>`;
    }).join('');
    const other = rest.length ? `
      <button type="button" class="rank-row" data-act="more" aria-expanded="false">
        <span class="rank-top">
          <span class="rank-no"></span>
          <span class="rank-name">其他 ${rest.length} 檔<small>點一下看全部</small></span>
          <span class="rank-pct">${pct(sum(rest), grand)}</span>${CHEVRON}
        </span>
        ${barRow({ total: sum(rest) }, false)}
      </button>` : '';
    // 選了年份或月份時寫在前面（點了某個月之後，看得出排行換成那個月的）
    const sub = (periodLabel ? `${periodLabel} · ` : '') +
      (list.length > 3 ? `共 ${list.length} 檔，前 3 檔佔 ${pct(sum(list.slice(0, 3)), grand)}` : `共 ${list.length} 檔`);
    return `
      <section class="stats-sec">
        <h3 class="stats-head">${U.esc(title)}</h3>
        <p class="stats-note">${U.esc(sub)}</p>
        <div class="stats-rows">${rows}${other}</div>
      </section>`;
  }

  // cfg：views.js 的 stats 加上 amount、date、code、name 欄位（由 list.js 帶入）
  //   rows：套用了全部篩選的列；context：只套用搜尋與成員的列（每月要列出整年）
  //   periodLabel：年月篩選的文字（「2026 年」「2026/08」），寫在排行上方
  //   status(列)：卡片上的狀態標籤 { label, cls, pending }；open：排行裡點開的代號
  function html(cfg, { rows, context, period = '', periodLabel = '', isPending, status, open = new Set(), expanded, members, showMembers }) {
    const keys = { amount: cfg.amount, date: cfg.date, code: cfg.code, name: cfg.name, isPending };
    const list = ranking(rows, keys);
    if (!list.length) return `<p class="empty">這段期間沒有算得出金額的${U.esc(cfg.label)}</p>`;
    const t = timeline(context, { ...keys, period });
    const details = code => payouts(rows, code, { ...keys, status });
    return (t ? timelineHTML(t, { label: cfg.label, selected: period.length === 7 ? period : '' }) : '') +
      rankingHTML(list, { title: cfg.ranking, periodLabel, expanded, open, details, members, showMembers });
  }

  return { timeline, ranking, payouts, pct, html };
})();
