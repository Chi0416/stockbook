// 推算頁面：資料由其他資料表算出來，不另外儲存，也不能直接新增
//   source: 點卡片時開啟哪張資料表的編輯表單
//   total:  在列表上方顯示該欄位的合計（status 的 pending 為 true 的列不計入，另外列出）
//   status: 卡片左上角的狀態標籤（格式見 schema.js）
//   rows(): 產生列表資料
const VIEWS = {
  cashDividends: {
    title: '累積現金股利',
    source: 'dividends',
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
    empty: '還沒有現金股利<br>在「除權息」頁新增後會自動算在這裡',
    fields: [
      { key: 'code',    label: '代號',       type: 'text' },
      { key: 'name',    label: '證券',       type: 'text' },
      { key: 'cash',    label: '現金股利',   type: 'number' },
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
    rows(scope = Store.scope) {
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
          const mine = held.filter(e => scope === 'all' || e.member === scope);
          if (!mine.length) {
            if (held.length) return [];
            const snap = all.find(e => e.snapDate);
            return [{
              ...row,
              basis: members.length > 1 ? '各成員的快照和交易明細裡都沒有這檔'
                : snap ? `${U.fmtDate(snap.snapDate)} 快照和交易明細裡都沒有這檔`
                : `${U.fmtDate(d.exDate)} 之前的交易明細裡沒有這檔`,
            }];
          }

          return mine.map(e => (e.error
            ? { ...row, member: e.member, shares: e.shares, basis: e.error }
            : { ...row, member: e.member, shares: e.shares, net: Math.round(U.round(d.cash * e.shares)), basis: e.basis, missing: false }));
        });
    },
  },
};
