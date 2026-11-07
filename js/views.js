// 推算頁面：資料由其他資料表算出來，不另外儲存，也不能直接新增
//   source: 資料從哪張表算出來（那張表改了，這一頁標亮剛改的那筆）；點卡片時開啟那張表的編輯表單
//   stock:  點卡片改成打開那一檔的「我的」（見 mine.js），不打開表單；改資料在帳務
//   total:  在列表上方顯示該欄位的合計（status 的 pending 為 true 的列不計入，另外列出）
//           base：有的話合計後面寫報酬率（合計 ÷ 這一欄的合計）；signed：有賺有賠，合計賺紅賠綠
//   status: 卡片左上角的狀態標籤（格式見 schema.js）
//   rows(): 產生列表資料
const VIEWS = {
  cashDividends: {
    title: '累積現金股利',
    source: 'dividends',
    stock: true, // 股利只看不改：除權息在帳務 → 除權息改
    period: { key: 'payDate', unit: 'month', label: '年月', groupSuffix: '發放', futureSuffix: '預計發放' },
    card: { code: 'code', title: 'name', primary: 'net', note: 'basis' },
    // 還沒入帳的兩個階段（見 schema.js 的 dividendStage）：待除權息（金額是預估）、待發放；都不算進已入帳的合計
    status(r) {
      const stage = dividendStage(r);
      if (stage === 'ex') return { label: '待除權息', cls: 'pending', pending: true };
      if (stage === 'pay') return { label: '待發放', cls: '', pending: true };
      return null;
    },
    total: { key: 'net', label: '股息淨值' },
    // 合計卡片下方的「明細｜統計」切換（見 stats.js）：金額、日期、代號、名稱沿用 total、period、card 的欄位
    //   label：每月圖的標題（「2026 年每月股息」）；ranking：排行的標題
    stats: { label: '股息', ranking: '股息來源排行' },
    empty: '還沒有股利<br>在「帳務」的「除權息」新增後，會自動算在這裡',
    // 明細畫成表格（見 list.js）：證券／代號 | 發放日 | 股利／股數 | 股息淨值，點表頭排序
    //   證券後面的欄位順序和點開後的股利明細（見 mine.js 的 divTable）一樣
    //   表頭盡量窄，名稱欄才夠寬：股數就是基準日股數（點開的股利明細寫全名），股息淨值拆成兩行
    //     寫「基準日股數」或股息淨值一行寫完，那一欄會變寬，八個字的名稱（群益台灣精選高息）就要換行
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

    // 基準日股數 = 除權息日「之前」的持股；除權息日當天以後的交易拿不到這次股利
    //              依序採用：除權息資料手動填的 → 之前的快照往後推 → 之後的快照往回推 → 沒有快照時加總交易（見 holdings.js）
    // 股息淨值   = 現金股利 × 基準日股數，元以下四捨五入（和券商的累積現金股利一致）
    // 除權息全家共用：每位有持股的成員各算一列（member 為成員 id）；只是別的成員的持股時不列出
    // scope 預設是目前的檢視範圍；訊息匣用 'all' 檢查全家
    // 資料沒變就用上一次算好的（見 storage.js 的 memo）：存一筆時這一頁、總覽、訊息匣、詳細頁都要用，不用各算一次
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

          // 每位成員的基準日股數（手動填寫 → 之前的快照往後推 → 之後的快照往回推 → 沒有快照時加總交易）
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

  // 損益（帳務的第二頁，跟在庫存的未實現後面，和券商 App 的已實現損益一樣）：每一筆賣出賺多少
  //   損益 = 拿回的應收付金額 − 賣掉那部分的付出成本（見 holdings.js 的 realized），含持有期間領到的股利
  //   照股利頁的樣子：合計卡片（寫報酬率、賺紅賠綠）、明細｜統計（每月有賺有賠、排行）
  //   點一筆打開那筆賣出的修改視窗（帳務點一筆是修改；算不出來的原因也寫在那裡）
  realized: {
    title: '損益',
    source: 'trades',
    period: { key: 'date', unit: 'month', label: '年月' },
    card: { code: 'code', title: 'name', primary: 'pl', note: 'why', calc: [
      { label: '報酬率', value: r => histPct(r.pl, r.cost), tone: r => plTone(r.pl) },
    ] },
    // base：報酬率的分母（賣掉那部分的付出成本）；signed：有賺有賠，合計上色
    //   more：合計卡片下面一排帳戶報酬（整個帳戶，含沒賣的漲跌和股利，見 history.js 的 returns）；搜尋一檔時不寫（帳戶報酬不分股票）
    total: { key: 'pl', label: '賣出損益', base: 'cost', signed: true, more: (period, keyword) => (keyword ? '' : accountReturnHTML(period)) },
    //   before：統計最上面的每月帳戶報酬（見 history.js 的 monthly），下面才是每月賣出損益和排行
    stats: { label: '損益', ranking: '損益排行', signed: true, base: 'cost', before: (period, keyword) => (keyword ? '' : accountMonthlyHTML(period)) },
    empty: '還沒有賣出<br>在「交易紀錄」記一筆賣出，這裡會算出損益',
    none: '這段期間沒有賣出',
    // 年月選單也列出有帳戶紀錄的月份：沒有賣出的月份也看得到帳戶報酬
    extraPeriods: () => History.months(),
    // 證券／代號｜賣出日｜成本／拿回｜損益／報酬率（照股利頁：日期接在證券後面，金額靠右）
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

    // 目前檢視範圍（勾的成員）的每一筆賣出；算不出損益的 pl 是 null、why 寫原因（列表上紅字，合計不算進去）
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

// 損益頁合計卡片下面一排：這段期間的帳戶報酬（上面小字標題、下面數字，賺紅賠綠）；下面小字寫從哪天到哪天，算不出來寫原因
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

// 損益頁統計最上面：每月（全部而且跨兩年以上時每年）的帳戶報酬率；點一個月改看那個月
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
