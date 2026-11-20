






const VIEWS = {
  cashDividends: {
    title: '累積現金股利',
    source: 'dividends',
    stock: true,
    period: { key: 'payDate', unit: 'month', label: '年月', groupSuffix: '發放', futureSuffix: '預計發放' },
    card: { code: 'code', title: 'name', primary: 'net', note: 'basis' },

    status(r) {
      const stage = dividendStage(r);
      if (stage === 'ex') return { label: '待除權息', cls: 'pending', pending: true };
      if (stage === 'pay') return { label: '待發放', cls: '', pending: true };
      return null;
    },
    total: { key: 'net', label: '股息淨值' },


    stats: { label: '股息', ranking: '股息來源排行' },
    empty: '還沒有股利<br>在「帳務」的「除權息」新增後，會自動算在這裡',




    table: [
      { label: ['發放日'], date: 'payDate' },
      { label: ['股利', '股數'], keys: ['cash', 'shares'] },
      { label: ['股息', '淨值'], keys: ['net'], strong: true, tone: () => 'up' },
    ],
    fields: [
      { key: 'code',    label: '代號',       type: 'text' },
      { key: 'name',    label: '證券',       type: 'text' },
      { key: 'cash',    label: '現金股利',   cardLabel: '每股現金', type: 'number', public: true },
      { key: 'shares',  label: '基準日股數', type: 'number' },
      { key: 'exDate',  label: '除權息日',   type: 'date' },
      { key: 'net',     label: '股息淨值',   type: 'number' },
      { key: 'payDate', label: '發放日',     type: 'date' },
    ],







    rows(scope = Store.scope) {
      const shown = Store.shown(scope);
      return Store.memo('cashDividends', JSON.stringify(shown), () => VIEWS.cashDividends.build(shown));
    },

    build(shown) {
      const members = Store.members();
      return Store.list('dividends')
        .filter(d => d.cash !== 0)
        .flatMap(d => {
          const code = Holdings.codeOf(d);
          const row = {
            id: d.id, code: d.code, name: d.name, cash: d.cash, exDate: d.exDate, payDate: d.payDate,
            member: '', shares: null, net: null, basis: '', missing: true,
          };
          if (!code) return [{ ...row, basis: '除權息資料缺少代號' }];
          if (typeof d.cash !== 'number') return [{ ...row, basis: '除權息資料缺少現金股利' }];


          const all = members.map(m => Holdings.entitled(m.id, code, d.exDate, d.baseShares?.[m.id]));
          const held = all.filter(e => e.found);
          const mine = held.filter(e => shown.includes(e.member));
          if (!mine.length) {
            if (held.length) return [];
            const snap = all.find(e => e.snapDate);
            return [{
              ...row,
              basis: members.length > 1 ? '各成員的快照和交易紀錄裡都沒有這檔'
                : snap ? `${U.fmtDate(snap.snapDate)} 快照和交易紀錄裡都沒有這檔`
                : `${U.fmtDate(d.exDate)} 之前的交易紀錄裡沒有這檔`,
            }];
          }

          return mine.map(e => (e.error
            ? { ...row, member: e.member, shares: e.shares, basis: e.error }
            : { ...row, member: e.member, shares: e.shares, net: Math.round(U.round(d.cash * e.shares)), basis: e.basis, missing: false }));
        });
    },
  },





  realized: {
    title: '損益',
    source: 'trades',
    period: { key: 'date', unit: 'month', label: '年月' },
    card: { code: 'code', title: 'name', primary: 'pl', note: 'why', calc: [
      { label: '報酬率', value: r => histPct(r.pl, r.cost), tone: r => plTone(r.pl) },
    ] },


    total: { key: 'pl', label: '賣出損益', base: 'cost', signed: true, more: (period, keyword) => (keyword ? '' : accountReturnHTML(period)) },

    stats: { label: '損益', ranking: '損益排行', signed: true, base: 'cost', before: (period, keyword) => (keyword ? '' : accountMonthlyHTML(period)) },
    empty: '還沒有賣出<br>在「交易紀錄」記一筆賣出，這裡會算出損益',
    none: '這段期間沒有賣出',

    extraPeriods: () => History.months(),

    table: [
      { label: ['賣出日'], date: 'date' },
      { label: ['成本', '拿回'], keys: ['cost', 'settle'] },
      { label: ['損益', '報酬率'], sort: 'pl', strong: true,
        cell: (r, v) => [r.pl === null ? '—' : v('pl'), histPct(r.pl, r.cost)], tone: r => plTone(r.pl) },
    ],
    fields: [
      { key: 'code',   label: '代號',     type: 'text' },
      { key: 'name',   label: '證券',     type: 'text' },
      { key: 'date',   label: '成交日期', type: 'date' },
      { key: 'shares', label: '成交數量', type: 'number' },
      { key: 'cost',   label: '付出成本', type: 'number' },
      { key: 'settle', label: '拿回',     type: 'number' },
      { key: 'pl',     label: '損益',     type: 'number' },
    ],


    rows(scope = Store.scope) {
      const shown = Store.shown(scope);
      return Store.memo('realized', JSON.stringify(shown), () => Store.list('trades', 'all')
        .filter(t => shown.includes(t.member) && isSell(t))
        .map(t => {
          const s = Holdings.sale(t) || { pl: null, cost: null, why: '' };
          return {
            id: t.id, member: t.member, code: t.code, name: t.name, date: t.date, shares: t.shares,
            settle: typeof t.settle === 'number' ? Math.round(t.settle) : null,
            cost: s.cost, pl: s.pl, why: s.why, missing: s.pl === null,
          };
        }));
    },
  },
};


function accountReturnHTML(period) {
  const r = History.returns(period);
  const tone = r.pl === null || Privacy.hidden || !r.pl ? '' : r.pl > 0 ? ' class="up"' : ' class="down"';
  const rate = r.rate === null || r.rate === undefined ? '' : `<span class="summary-rate">（${Privacy.num(`${U.fmtNum(r.rate, 2)}%`)}）</span>`;
  const span = r.pl === null ? r.why : `${U.fmtDate(r.from)} 到 ${U.fmtDate(r.to)}${r.late ? '（去年沒有帳戶紀錄，從今年第一筆算起）' : ''}`;
  return `
    <span class="summary-more">
      <small>帳戶報酬<span>整個帳戶，含沒賣的漲跌和領到的股利</span></small>
      <b${tone}>${r.pl === null ? '—' : Privacy.num(U.fmtNum(r.pl))}${rate}</b>
      <span class="summary-pending">${U.esc(span)}</span>
    </span>`;
}


function accountMonthlyHTML(period) {
  const t = History.monthly(period);
  if (!t) return '';
  return Stats.ratesHTML({
    title: t.unit === 'month' ? `${t.year} 年每月帳戶報酬` : '每年帳戶報酬',
    note: '含沒賣的漲跌和股利；下面的損益只算賣掉的',
    buckets: t.buckets,
    selected: period.length === 7 ? period : '',
  });
}
