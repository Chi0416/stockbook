// 資料表的欄位定義（除了 optional 的欄位，全部必填）
//   type:        date | text | number | member（家庭成員，表單上是下拉選單，只有一位成員時不顯示）
//                perMember（每位成員各填一個數字，存成 { 成員 id: 數字 }）
//   optional:    可以空白
//   public:      公開資訊（例如每股股利），隱藏金額時照常顯示；其他數字欄位隱藏時顯示成 ＊＊＊（見 privacy.js）
//   format:      列表卡片上的顯示方式
//   digits:      數字顯示時最少的小數位數
//   full:        表單中佔滿整列（預設半列）
//   keep:        連續新增時保留該欄的值，方便輸入同一天／同一份快照
//   default:     新增時預先填入的值
//   hint:        顯示在表單欄位下方的說明
//   note:        依表單目前填的內容，顯示在欄位下方的提醒：note(values) 回傳文字，不用提醒時回傳空字串
//   calc:        依表單目前填的內容先算好填上：calc(values) 回傳數字，算不出來時回傳 null
//                欄位空白、或還是上次算的數字時才填，自己改過的不蓋掉（見 form.js）
//                values 是各欄位填的內容（日期轉成 2025-06-05，看不懂時是空字串）
//   caps:        手機鍵盤預設大寫（代號可能有英文字母，例如 00679B）
//   suggest:     表單下方的快選按鈕（預設值 + 最近輸入過的值），只是提示，不限制；試算表的下拉選單也用這個
//   toggle:      表單上改成左右切換的按鈕（有 toggle 時不顯示 suggest 的快選按鈕）：[{ value, label, tone, match }]
//                value 是存的值；match 是認得的寫法（試算表手打的「融資買進」也算買進那一邊，沒點的話原本的字照舊）
//   pair:        成對的快選按鈕：按下後同時填入本欄與 pair 指定的欄位（代號＋證券）
//   suggestFrom: 快選按鈕另外參考哪些資料表
//   period:      列表篩選與分組用的日期欄位；unit 為 month（年月）或 day（單日）
//                groupSuffix 是分組標題後面的說明，日期在今天之後時改用 futureSuffix
//   card:        列表卡片上的代號、標題、標籤、右上角主要數字，其餘欄位顯示在卡片下方
//   status:      沒有標籤欄位時，卡片左上角的狀態標籤：回傳 { label, cls, pending } 或 null
//                cls 是標籤樣式（pending 為虛線）；pending 為 true 時金額變淡、合計另外列出
//   intro:       列表最上面的一段說明（有資料時才顯示）
//   empty:       還沒有資料時列表顯示的文字
//   annotate:    列表的補充說明：annotate(rows) 回傳 { groups: { 分組值: { text, warn, lines } }, cards: { 記錄 id: { text, warn } } }
//                groups 顯示在分組標題下方，cards 顯示在卡片最下方
//   was:         這個欄位以前在試算表上的標題（改名前），讀得到舊標題的試算表，同步時改成新標題
//   migrate:     讀取舊格式資料時的轉換
//   legacy:      試算表格式版本 1 的舊欄位：{ 舊標題: 舊的 key }，讀進舊的 key 再由 migrate 換算（見 sheet.js）

// 股利的三個階段（以今天為準），除權息頁和累積現金股利頁共用：
//   除權息日之前              → 'ex'  待除權息（之前還可能買賣，股數會變，金額是預估）
//   除權息日當天到發放日之前   → 'pay' 待發放（金額已確定，還沒入帳）
//   發放日當天以後            → ''    已發放（不標示）
function dividendStage(d, today = U.today()) {
  if (d.exDate > today) return 'ex';
  if (d.payDate > today) return 'pay';
  return '';
}

// 舊版的「證券」是代號和名稱合在一起（例如「0056 元大高股息」），拆成代號與證券兩欄
function splitSecurity(r) {
  if ('code' in r) return r;
  const m = U.toHalf(r.name ?? '').trim().match(/^(\d{4,6}[A-Z]?)\s*(\S.*)$/i);
  return m ? { ...r, code: m[1].toUpperCase(), name: m[2].trim() } : { ...r, code: '' };
}

// 舊版存的是成交金額（amount，不含手續費），換算成應收付金額（settle）：買進加上手續費，賣出扣掉手續費和交易稅
//   買進的成本和舊版一樣（舊版的成本 = 成交金額 + 手續費），總覽的數字不會變
function toSettle(r) {
  if ('settle' in r || !('amount' in r)) return r;
  const { amount, ...rest } = r;
  const n = v => Number(v) || 0;
  let settle = amount;
  if (typeof amount === 'number') {
    if (/買/.test(r.type)) settle = amount + n(r.fee);
    else if (/賣/.test(r.type)) settle = amount - n(r.fee) - n(r.tax);
  }
  return { ...rest, settle };
}

// 應收付金額的試算：成交數量 × 成交單價，買進加上手續費、賣出扣掉手續費和交易稅
//   手續費、交易稅用使用者填的（折讓每個人不一樣，App 不算）；還沒選買進／賣出、沒填數量或單價時回傳 null
function settleOf(v) {
  const n = k => U.parseNum(String(v[k] ?? ''));
  const shares = n('shares');
  const price = n('price');
  if (!shares || !price || !/[買賣]/.test(v.type ?? '')) return null;
  const amount = Math.round(shares * price);
  return /買/.test(v.type) ? amount + (n('fee') || 0) : amount - (n('fee') || 0) - (n('tax') || 0);
}

// 代號在股票清單（stocklist.js）和自己記過的資料裡都查不到時提醒；只是提醒，照樣可以儲存
//   打到 4 碼才檢查，打字途中不提醒；瀏覽器還拿著舊版程式、沒有清單時不提醒
function codeNote(v) {
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const code = key(v.code);
  if (code.length < 4 || typeof STOCK_LIST === 'undefined' || STOCK_LIST.names[code]) return '';
  const known = Object.keys(SCHEMAS).some(t => Store.list(t, 'all').some(r => key(r.code) === code));
  return known ? '' : '股票清單裡查不到這個代號，請確認有沒有打錯（剛上市的可能還沒收錄）';
}

const SCHEMAS = {
  trades: {
    title: '交易明細',
    period: { key: 'date', unit: 'month', label: '年月' },
    card: { code: 'code', title: 'name', badge: 'type', primary: 'settle' },
    fields: [
      { key: 'member', label: '成員',     type: 'member', keep: true, full: true },
      { key: 'date',   label: '成交日期', type: 'date', keep: true,
        // 成交日期在總覽用的快照當天或之前：當作已經算在快照裡（見 holdings.js）
        note(v) {
          const snap = v.member && v.date ? Holdings.snapDate(v.member, U.today()) : null;
          return snap && v.date <= snap ? `已算在 ${U.fmtDate(snap)} 的庫存快照裡，總覽不會再加一次` : '';
        } },
      // 表單上是「買進｜賣出」左右切換（和股票軟體一樣），存的還是「普買」「普賣」；沒有預設，免得把賣出記成買進
      { key: 'type',   label: '交易別',   type: 'text', suggest: ['普買', '普賣'],
        toggle: [{ value: '普買', label: '買進', tone: 'buy', match: /買/ }, { value: '普賣', label: '賣出', tone: 'sell', match: /賣/ }] },
      { key: 'code',   label: '代號',     type: 'text', caps: true, pair: 'name', suggestFrom: ['snapshots'],
        hint: '要和庫存快照一致', note: codeNote },
      { key: 'name',   label: '證券',     type: 'text' },
      // 名稱和順序照券商 App 的成交明細；成交金額（= 成交數量 × 成交單價）算得出來，不另外存
      // 計算只用到成交數量和應收付金額（買進的成本 = 應收付金額，已含手續費，見 holdings.js）；成交單價、手續費、交易稅只是記錄
      { key: 'shares', label: '成交數量',   type: 'number', hint: '股數，1 張 = 1,000 股', was: ['股數'] },
      { key: 'price',  label: '成交單價',   type: 'number', digits: 2, optional: true, hint: '可以空白', was: ['單價'] },
      { key: 'fee',    label: '手續費',     type: 'number', optional: true, hint: '可以空白' },
      { key: 'tax',    label: '交易稅',     type: 'number', optional: true, hint: '賣出才有，可以空白', was: ['證交稅款'] },
      { key: 'settle', label: '應收付金額', type: 'number', full: true, was: ['成交金額'],
        hint: '買進是付出的錢（含手續費），賣出是拿回的錢', calc: settleOf,
        // 自動算的數字提醒要核對（成交單價四捨五入、手續費沒填都會有差）；自己改過、和算的不一樣時不提醒
        note(v) {
          const c = settleOf(v);
          if (c === null || U.parseNum(v.settle ?? '') !== c) return '';
          const how = /買/.test(v.type) ? '成交數量 × 成交單價 + 手續費' : '成交數量 × 成交單價 − 手續費 − 交易稅';
          return `自動算的（${how}），請自行和券商 App 的應收付金額核對${v.fee ? '' : '；手續費還沒填'}`;
        } },
    ],
    legacy: { 成交金額: 'amount' },
    migrate: r => toSettle(splitSecurity(r)),
  },

  snapshots: {
    title: '庫存快照',
    period: { key: 'date', unit: 'day', label: '快照日期' },
    defaultLatest: true,
    intro: '這裡是照券商抄的庫存，不會跟著交易明細改變。加上之後的買賣算出來的目前持股，請看「總覽」。',
    empty: '還沒有庫存快照<br>點右上角「＋ 新增」，照券商 App 的庫存一檔填一筆<br>不填也可以，總覽會直接加總交易明細',
    card: { code: 'code', title: 'name', badge: 'type', primary: 'totalCost' },
    fields: [
      { key: 'member',      label: '成員',         type: 'member', keep: true, full: true },
      { key: 'date',        label: '快照日期',     type: 'date', keep: true },
      { key: 'type',        label: '交易別',       type: 'text', keep: true, suggest: ['現股'] },
      { key: 'code',        label: '代號',         type: 'text', caps: true, pair: 'name', note: codeNote },
      { key: 'name',        label: '證券',         type: 'text' },
      // 計算只用到庫存餘額和總投資成本（見 holdings.js）；平均成本價格、累計配息只是顯示
      { key: 'shares',      label: '庫存餘額',     type: 'number', hint: '股數，1 張 = 1,000 股' },
      { key: 'avgCost',     label: '平均成本價格', type: 'number', digits: 2, hint: '不知道寫 0 沒關係' },
      { key: 'totalCost',   label: '總投資成本',   type: 'number', hint: '照券商 App 的付出成本填' },
      { key: 'cumDividend', label: '累計配息',     type: 'number', hint: '不知道寫 0 沒關係' },
    ],
    // 核對（見 holdings.js 的 check）：前一期快照（第一期從 0 開始）＋期間的買賣與配股，應該等於這一期的股數
    //   分組標題下方寫整期的結果；對不上的卡片寫出算式；快照裡沒有、但推算還有股數的另外列在分組說明
    //   第一期之前的交易還沒補齊的卡片寫出還差幾股（不是警告，可以慢慢補）
    annotate(rows) {
      if (typeof Holdings.check !== 'function') return null; // 瀏覽器快取到舊版 holdings.js 時略過
      const dates = new Set(rows.map(r => r.date));
      const results = Holdings.check().filter(c => dates.has(c.date));
      const who = c => (Store.scope === 'all' && Store.members().length > 1 ? `${Store.memberName(c.member)} ` : '');
      const groups = {};
      const cards = {};
      dates.forEach(date => {
        const list = results.filter(c => c.date === date);
        const diff = list.filter(c => c.status === 'diff');
        const ok = list.filter(c => c.status === 'ok').length;
        const partial = list.filter(c => c.status === 'partial');
        const skip = list.filter(c => c.status === 'nohistory').length;
        const parts = [];
        if (diff.length) parts.push(`${diff.length} 檔對不上`);
        else if (ok) parts.push(partial.length ? `${ok} 檔相符 ✓` : '全部相符 ✓');
        if (partial.length) parts.push(`${partial.length} 檔更早的交易還沒補齊`);
        if (skip) parts.push(`${skip} 檔還沒有交易紀錄，沒有核對`);
        if (!parts.length) return;
        groups[date] = {
          text: `核對：${parts.join('，')}`,
          warn: diff.length > 0,
          lines: diff.filter(c => !c.recId).map(c =>
            `${who(c)}${c.code} ${c.name}：推算應有 ${U.fmtNum(c.expected)} 股（${c.formula}），但這一期快照裡沒有`),
        };
        diff.filter(c => c.recId).forEach(c => {
          const gap = c.actual - c.expected;
          cards[c.recId] = {
            warn: true,
            text: `核對不符：推算 ${U.fmtNum(c.expected)} 股（${c.formula}），快照是 ${U.fmtNum(c.actual)} 股，` +
              `${gap > 0 ? '多' : '少'} ${U.fmtNum(Math.abs(gap))} 股`,
          };
        });
        partial.filter(c => c.recId).forEach(c => {
          cards[c.recId] = {
            warn: false,
            text: `更早的交易還沒補齊：推算 ${U.fmtNum(c.expected)} 股（${c.formula}），快照是 ${U.fmtNum(c.actual)} 股，` +
              `還差 ${U.fmtNum(c.actual - c.expected)} 股`,
          };
        });
      });
      return { groups, cards };
    },
    migrate: splitSecurity,
  },

  // 除權息是每檔證券的公告資料，全家共用一份，各成員的股利依各自持股計算
  dividends: {
    title: '除權息',
    period: { key: 'exDate', unit: 'month', label: '年月', groupSuffix: '除權息', futureSuffix: '預計除權息' },
    card: { code: 'code', title: 'name', primary: 'cash' },
    // 除權息日當天就算已除息（當天以後買的拿不到這次股利）；已除息還沒發放時金額已確定，不變淡
    status(r) {
      const stage = dividendStage(r);
      if (stage === 'ex') return { label: '待除權息', cls: 'pending', pending: true };
      if (stage === 'pay') return { label: '待發放', cls: '', pending: false };
      return null;
    },
    fields: [
      { key: 'code',    label: '代號',     type: 'text', caps: true, pair: 'name', suggestFrom: ['snapshots'],
        hint: '要和庫存快照一致', note: codeNote },
      { key: 'name',    label: '證券',     type: 'text' },
      { key: 'exDate',  label: '除權息日', type: 'date' },
      { key: 'payDate', label: '發放日',   type: 'date' },
      { key: 'cash',    label: '現金股利', type: 'number', public: true, hint: '每股（元）' },
      { key: 'stock',   label: '股票股利', type: 'number', public: true, default: 0, hint: '每股（元）' },
      { key: 'baseShares', label: '基準日股數', type: 'perMember', optional: true, full: true,
        hint: '選填。照股利通知書填，有填就用這個股數；空白時依庫存快照與交易明細自動推算',
        // 只列出現有成員（成員刪除後，留在舊資料裡的數字不顯示）
        format: v => {
          const members = Store.members();
          const parts = members
            .filter(m => typeof v?.[m.id] === 'number')
            .map(m => `${members.length > 1 ? `${m.name} ` : ''}${U.fmtNum(v[m.id])}`);
          return parts.length ? parts.join('、') : '自動計算';
        } },
    ],
    // 舊版的「配息/配股」是一個文字欄位（例如「配息 0.866」），拆成兩個數字欄位
    migrate(r) {
      r = splitSecurity(r);
      if (!('value' in r) || 'cash' in r) return r;
      const { value, ...rest } = r;
      const text = U.toHalf(value);
      const m = text.match(/\d+(\.\d+)?|\.\d+/);
      const n = m ? Number(m[0]) : null;
      const isStock = /股/.test(text) && !/息/.test(text);
      return { ...rest, cash: isStock ? 0 : n, stock: isStock ? n : 0 };
    },
  },
};
