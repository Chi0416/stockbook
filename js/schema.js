
























































function dividendStage(d, today = U.today()) {
  if (d.exDate > today) return 'ex';
  if (d.payDate > today) return 'pay';
  return '';
}


function splitSecurity(r) {
  if ('code' in r) return r;
  const m = U.toHalf(r.name ?? '').trim().match(/^(\d{4,6}[A-Z]?)\s*(\S.*)$/i);
  return m ? { ...r, code: m[1].toUpperCase(), name: m[2].trim() } : { ...r, code: '' };
}



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



function settleOf(v) {
  const n = k => U.parseNum(String(v[k] ?? ''));
  const shares = n('shares');
  const price = n('price');
  if (!shares || !price || !/[買賣]/.test(v.type ?? '')) return null;
  const amount = Math.round(shares * price);
  return /買/.test(v.type) ? amount + (n('fee') || 0) : amount - (n('fee') || 0) - (n('tax') || 0);
}


function avgCostOf(v) {
  const shares = U.parseNum(String(v.shares ?? ''));
  const cost = U.parseNum(String(v.totalCost ?? ''));
  return shares && cost !== null ? U.round(cost / shares, 2) : null;
}


function snapCloseOf(v) {
  return typeof Market !== 'undefined' && Market.closeOn ? Market.closeOn(v.code, v.date) : null;
}


const snapValueOf = r => (typeof r.price === 'number' && typeof r.shares === 'number' ? Math.round(r.shares * r.price) : null);
function snapPlOf(r) {
  const v = snapValueOf(r);
  return v !== null && typeof r.totalCost === 'number' ? v - Math.round(r.totalCost) : null;
}


const histEstimate = v => (typeof History !== 'undefined' ? History.estimate(v.member, v.date) : { cost: null, value: null, live: false });


const histPlOf = r => (typeof r.value === 'number' && typeof r.cost === 'number' ? Math.round(r.value) - Math.round(r.cost) : null);



function codeNote(v) {
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const code = key(v.code);
  if (code.length < 4 || typeof STOCK_LIST === 'undefined' || STOCK_LIST.names[code]) return '';
  const known = Object.keys(SCHEMAS).filter(t => SCHEMAS[t].fields.some(f => f.key === 'code'))
    .some(t => Store.list(t, 'all').some(r => key(r.code) === code));
  return known ? '' : '股票清單裡查不到這個代號，請確認有沒有打錯（剛上市的可能還沒收錄）';
}





const MEMBER_NAME_MAX = 5;
function memberNameError(name) {
  const width = [...name].reduce((w, c) => w + (/[\x20-\x7e｡-ﾟ]/.test(c) ? 0.5 : 1), 0);
  if (width > MEMBER_NAME_MAX) return `名字最多 ${MEMBER_NAME_MAX} 個字（英文、數字最多 ${MEMBER_NAME_MAX * 2} 個）`;
  if (name === '全家') return '「全家」是設定裡勾選全部成員用的，請換一個名字';
  if (/[、,，;；\n]/.test(name)) return '名字不能有頓號、逗號、分號';
  return '';
}



function snapSum(rows, date) {
  if (!rows.length) return '';
  const fmt = n => Privacy.num(U.fmtNum(n));
  const cost = rows.reduce((s, r) => s + (typeof r.totalCost === 'number' ? Math.round(r.totalCost) : 0), 0);
  const priced = rows.filter(r => snapPlOf(r) !== null);
  const missing = rows.length - priced.length;
  if (!priced.length) {
    const later = typeof Market !== 'undefined' && Market.ready() && date > Market.date();
    return `合計：成本 ${fmt(cost)}${later ? '；收盤價等收盤資料更新後自動補上' : ''}`;
  }
  const value = priced.reduce((s, r) => s + snapValueOf(r), 0);
  const pl = priced.reduce((s, r) => s + snapPlOf(r), 0);
  const base = priced.reduce((s, r) => s + Math.round(r.totalCost), 0);
  const rate = base > 0 ? `（${Privacy.num(`${U.fmtNum(U.round(pl / base * 100, 2), 2)}%`)}）` : '';
  return `合計：成本 ${fmt(cost)}、市值 ${fmt(value)}、損益 ${fmt(pl)}${rate}` +
    (missing ? `；${missing} 檔沒有收盤價，市值和損益沒有算進去` : '');
}


const snapMoney = n => (n === null ? '—' : Privacy.num(U.fmtNum(n)));
function snapRate(r) {
  const pl = snapPlOf(r);
  return pl === null || !(r.totalCost > 0) ? '—' : Privacy.num(`${U.fmtNum(U.round(pl / r.totalCost * 100, 2), 2)}%`);
}

function snapTone(r) {
  const pl = snapPlOf(r);
  return Privacy.hidden || !pl ? '' : pl > 0 ? 'up' : 'down';
}


const histPct = (pl, cost) => (pl === null || !(cost > 0) ? '—' : Privacy.num(`${U.fmtNum(U.round(pl / cost * 100, 2), 2)}%`));
const histRate = r => histPct(histPlOf(r), r.cost);
function histTone(r) {
  const pl = histPlOf(r);
  return Privacy.hidden || !pl ? '' : pl > 0 ? 'up' : 'down';
}



const isSell = r => !/買/.test(r.type ?? '') && /賣/.test(r.type ?? '');
const saleOf = r => (typeof Holdings !== 'undefined' ? Holdings.sale(r) : null);
const plTone = pl => (Privacy.hidden || !pl ? '' : pl > 0 ? 'up' : 'down');

const salePlHTML = pl => `<span class="sale-pl${plTone(pl) ? ` ${plTone(pl)}` : ''}">${snapMoney(pl)}</span>`;


function saleNote(v, id) {
  if (typeof Holdings === 'undefined' || !isSell(v)) return '';
  const shares = U.parseNum(String(v.shares ?? ''));
  const settle = U.parseNum(String(v.settle ?? ''));
  if (!shares || settle === null) return '';
  const s = Holdings.preview({ id, member: v.member, date: v.date, type: v.type, code: v.code, shares, settle });
  if (!s) return '';
  if (s.pl === null) return `算不出這筆的損益：${s.why}`;
  const fmt = n => Privacy.num(U.fmtNum(n));
  return `這筆賣出的損益 ${fmt(s.pl)}（${histPct(s.pl, s.cost)}）＝ 拿回 ${fmt(Math.round(settle))} − 賣掉那部分的付出成本 ${fmt(s.cost)}`;
}

const SCHEMAS = {
  trades: {
    title: '交易紀錄',
    sheetTitle: '交易明細',
    period: { key: 'date', unit: 'month', label: '年月' },

    card: { code: 'code', title: 'name', badge: 'type', primary: 'settle', calc: [
      { label: '損益', when: isSell, value: r => snapMoney(saleOf(r)?.pl ?? null), tone: r => plTone(saleOf(r)?.pl ?? null) },
      { label: '報酬率', when: isSell, value: r => histPct(saleOf(r)?.pl ?? null, saleOf(r)?.cost), tone: r => plTone(saleOf(r)?.pl ?? null) },
    ] },


    table: [
      { label: ['數量', '單價'], keys: ['shares', 'price'] },
      { label: ['應收付', '損益'], sort: 'settle', strong: true,
        cell: (r, v) => [`${/買/.test(r.type) && typeof r.settle === 'number' ? '−' : ''}${v('settle')}`,
          isSell(r) ? salePlHTML(saleOf(r)?.pl ?? null) : ''],
        tone: r => (/買/.test(r.type) ? 'down' : /賣/.test(r.type) ? 'up' : '') },
      { label: ['日期'], date: 'date' },
    ],

    annotate(rows) {
      const cards = {};
      rows.forEach(r => {
        const s = isSell(r) ? saleOf(r) : null;
        if (s?.why) cards[r.id] = { text: `算不出損益：${s.why}`, warn: false };
      });
      return { cards };
    },
    fields: [
      { key: 'member', label: '成員',     type: 'member', keep: true, full: true },
      { key: 'date',   label: '成交日期', type: 'date', keep: true,

        note(v) {
          const snap = v.member && v.date ? Holdings.snapDate(v.member, U.today()) : null;
          return snap && v.date <= snap ? `已算在 ${U.fmtDate(snap)} 的庫存快照裡，庫存不會再加一次` : '';
        } },

      { key: 'type',   label: '交易別',   type: 'text', suggest: ['普買', '普賣'],
        toggle: [{ value: '普買', label: '買進', tone: 'buy', match: /買/ }, { value: '普賣', label: '賣出', tone: 'sell', match: /賣/ }] },
      { key: 'code',   label: '代號',     type: 'text', caps: true, pair: 'name', suggestFrom: ['snapshots'],
        hint: '要和庫存快照一致', note: codeNote },
      { key: 'name',   label: '證券',     type: 'text' },


      { key: 'shares', label: '成交數量',   type: 'number', hint: '股數，1 張 = 1,000 股', was: ['股數'] },
      { key: 'price',  label: '成交單價',   type: 'number', digits: 2, optional: true, hint: '可以空白', was: ['單價'] },
      { key: 'fee',    label: '手續費',     type: 'number', optional: true, hint: '可以空白' },
      { key: 'tax',    label: '交易稅',     type: 'number', optional: true, hint: '賣出才有，可以空白', was: ['證交稅款'] },
      { key: 'settle', label: '應收付金額', type: 'number', full: true, was: ['成交金額'],
        hint: '買進是付出的錢（含手續費），賣出是拿回的錢', calc: settleOf,


        note(v, id) {
          const c = settleOf(v);
          const how = /買/.test(v.type) ? '成交數量 × 成交單價 + 手續費' : '成交數量 × 成交單價 − 手續費 − 交易稅';
          const auto = c === null || U.parseNum(v.settle ?? '') !== c ? ''
            : `自動算的（${how}），請自行和券商 App 的應收付金額核對${v.fee ? '' : '；手續費還沒填'}`;
          return [auto, saleNote(v, id)].filter(Boolean).join('\n');
        } },
    ],
    legacy: { 成交金額: 'amount' },
    migrate: r => toSettle(splitSecurity(r)),
  },

  snapshots: {
    title: '庫存快照',
    period: { key: 'date', unit: 'day', label: '快照日期' },
    defaultLatest: true,
    intro: {
      line: '照券商 App「綜合損益」抄的庫存',
      body: '<p>不會跟著交易紀錄改變</p><p>加上之後的買賣、除息算出來的目前持股，請看「庫存」</p>',
    },
    empty: '還沒有庫存快照<br>點右上角「＋ 新增」，照券商 App 的「綜合損益」一檔填一筆<br>不填也可以，庫存會直接加總交易紀錄',

    card: { code: 'code', title: 'name', badge: 'type', primary: 'totalCost', calc: [
      { label: '當日現值', value: r => snapMoney(snapValueOf(r)) },
      { label: '損益', value: r => snapMoney(snapPlOf(r)), tone: snapTone },
      { label: '報酬率', value: snapRate, tone: snapTone },
    ] },


    table: [
      { label: ['庫存股', '當日現值'], sort: 'shares', cell: (r, v) => [v('shares'), snapMoney(snapValueOf(r))] },
      { label: ['損益', '報酬率'], sort: 'pl', value: snapPlOf, strong: true,
        cell: r => [snapMoney(snapPlOf(r)), snapRate(r)], tone: snapTone },
      { label: ['快照日'], date: 'date' },
    ],
    fields: [
      { key: 'member',      label: '成員',         type: 'member', keep: true, full: true },

      { key: 'date',      label: '快照日期', type: 'date', keep: true, hint: '照「昨日餘額」抄的話，填前一個交易日' },

      { key: 'type',      label: '類別',     type: 'text', keep: true, default: '現股', suggest: ['現股', '其他'], was: ['交易別'],
        toggle: [{ value: '現股', label: '現股', tone: '', match: /現股/ }, { value: '其他', label: '其他', tone: '', match: /^(?!.*現股)./ }] },
      { key: 'code',      label: '代號',     type: 'text', caps: true, pair: 'name', note: codeNote },
      { key: 'name',      label: '證券',     type: 'text' },


      { key: 'shares',    label: '昨日餘額', type: 'number', hint: '股數，1 張 = 1,000 股', was: ['庫存餘額'] },
      { key: 'totalCost', label: '付出成本', type: 'number', hint: '已含手續費、扣掉已除息的現金股利，照抄就好', was: ['總投資成本'] },
      { key: 'avgCost',   label: '成本均價', type: 'number', digits: 2, optional: true, was: ['平均成本價格'], calc: avgCostOf,
        note(v) {
          const c = avgCostOf(v);
          return c !== null && U.parseNum(v.avgCost ?? '') === c ? '自動算的（付出成本 ÷ 昨日餘額），請自行和券商 App 核對' : '';
        } },


      { key: 'price',     label: '收盤價',   type: 'number', digits: 2, optional: true, public: true, since: 5, calc: snapCloseOf,
        hint: '不用填，App 會自動補上快照日期的收盤價',
        note(v) {
          const c = snapCloseOf(v);
          const cur = U.parseNum(v.price ?? '');
          if (c !== null) return cur === c ? `${U.fmtDate(v.date)} 的收盤價，自動帶入的` : '';
          if (cur !== null || !v.code || !v.date || typeof Market === 'undefined' || !Market.ready()) return '';
          return v.date > Market.date() ? '收盤資料更新後（工作天 15:43、19:43）自動補上'
            : '收盤資料裡沒有這一天的價格，要的話自己填';
        } },
    ],




    annotate(rows) {
      const dates = new Set(rows.map(r => r.date));
      const groups = {};
      const cards = {};
      dates.forEach(date => {
        const sum = snapSum(rows.filter(r => r.date === date), date);
        if (sum) groups[date] = { text: '', warn: false, lines: [], sum };
      });
      if (typeof Holdings.check !== 'function') return { groups, cards };
      const results = Holdings.check().filter(c => dates.has(c.date));
      const who = c => (Store.shown().length > 1 ? `${Store.memberName(c.member)} ` : '');
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
          ...groups[date],
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


  dividends: {
    title: '除權息',
    announce: true,
    period: { key: 'exDate', unit: 'month', label: '年月', groupSuffix: '除權息', futureSuffix: '預計除權息' },
    card: { code: 'code', title: 'name', primary: 'cash' },

    table: [
      { label: ['現金', '股票'], sort: 'cash', cell: (r, v) => [v('cash'), r.stock ? v('stock') : ''] },
      { label: ['除權息日'], date: 'exDate' },
      { label: ['發放日'], date: 'payDate' },
    ],

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
      { key: 'cash',    label: '現金股利', cardLabel: '每股現金', type: 'number', public: true, hint: '每股（元）' },
      { key: 'stock',   label: '股票股利', cardLabel: '每股配股', type: 'number', public: true, default: 0, hint: '每股（元）' },
      { key: 'baseShares', label: '基準日股數', type: 'perMember', optional: true, full: true,
        hint: '選填。照股利通知書填，有填就用這個股數；空白時依庫存快照與交易紀錄自動推算',

        format: v => {
          const members = Store.members();
          const parts = members
            .filter(m => typeof v?.[m.id] === 'number')
            .map(m => `${members.length > 1 ? `${m.name} ` : ''}${U.fmtNum(v[m.id])}`);
          return parts.length ? parts.join('、') : '自動計算';
        } },
    ],

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





  watch: {
    siteWrites: true,
    title: '觀察清單',
    formTitle: '自選股',
    noList: true,
    manage: { title: '目前的自選', empty: '還沒有自選股，在上面打代號或名稱加進來' },
    unique: ['code'],
    uniqueMsg: dup => `自選裡已經有 ${[dup.code, dup.name].filter(Boolean).join(' ')} 了`,
    remove: { label: '從自選移除', done: '已移除' },
    card: { code: 'code', title: 'name' },
    fields: [
      { key: 'code', label: '代號', type: 'text', caps: true, pair: 'name', suggestFrom: ['dividends', 'snapshots', 'trades'], note: codeNote },
      { key: 'name', label: '證券', type: 'text' },
    ],
  },




  cashPools: {
    title: '現金單',
    noList: true,
    unique: ['member'],
    uniqueMsg: dup => `${Store.memberName(dup.member)}已經有現金單了（${[dup.code, dup.name].filter(Boolean).join(' ')}）`,
    closeOnAdd: true,
    remove: { label: '刪除這個現金單', done: '已刪除' },
    card: { code: 'code', title: 'name' },
    fields: [
      { key: 'member',    label: '成員',   type: 'member', full: true },
      { key: 'code',      label: '代號',   type: 'text', caps: true, pair: 'name', suggestFrom: ['snapshots', 'trades'],
        hint: '當資金池的股票，例如 0050', note: codeNote },
      { key: 'name',      label: '證券',   type: 'text' },

      { key: 'discount',  label: '手續費折數', type: 'number', default: 6, hint: '6 折填 6、2.8 折填 2.8，沒有折扣填 10' },
      { key: 'rebate',    label: '折扣方式', type: 'text', default: '當日折', suggest: ['當日折', '月退'],
        toggle: [{ value: '當日折', label: '當日折', tone: '', match: /日/ }, { value: '月退', label: '月退', tone: '', match: /月/ }],
        hint: '月退是先收原價、下個月才退，提領時用原價算' },
      { key: 'minFee',    label: '整股最低手續費', type: 'number', default: 20, hint: '一張以上，元' },
      { key: 'oddMinFee', label: '零股最低手續費', type: 'number', default: 1, hint: '不到一張，元' },
    ],
  },




  history: {
    title: '帳戶紀錄',
    period: { key: 'date', unit: 'month', label: '年月' },
    intro: {
      line: '收盤後自動記下付出成本和市值',
      body: '<p>收盤資料更新後打開記錄簿，會用收盤價自動記下每位成員那天的付出成本和市值，走勢圖在「庫存」</p>' +
        '<p>今天還沒收盤也可以先記，收盤後會自動換成收盤價</p><p>以前的可以點右上角自己補，付出成本不知道可以空白</p>',
    },
    empty: '還沒有帳戶紀錄<br>有持股的話，收盤資料更新後打開記錄簿就會自動記一筆<br>以前的可以點右上角「＋ 新增紀錄」自己補',
    search: '搜尋成員',
    name: {
      label: ['日期'],
      cell: r => [`${U.fmtDate(r.date).slice(5)} ${U.weekday(r.date)}`, String(r.date).slice(0, 4)],
      card: r => `${U.fmtDate(r.date)} ${U.weekday(r.date)}`,
    },
    card: { primary: 'value', calc: [
      { label: '損益', value: r => snapMoney(histPlOf(r)), tone: histTone },
      { label: '報酬率', value: histRate, tone: histTone },
    ] },
    table: [
      { label: ['付出成本', '市值'], keys: ['cost', 'value'] },
      { label: ['損益', '報酬率'], sort: 'pl', value: histPlOf, strong: true,
        cell: r => [snapMoney(histPlOf(r)), histRate(r)], tone: histTone },
    ],

    status: r => (r.status === History.LIVE ? { label: '盤中', cls: '', pending: true } : null),

    beforeSave: rec => ({ ...rec, status: History.statusOf(rec.date) }),

    unique: ['date', 'member'],
    uniqueMsg: dup => `${U.fmtDate(dup.date)} 已經有${Store.members().length > 1 ? ` ${Store.memberName(dup.member)} 的` : ''}紀錄了，點那一筆修改就好`,

    fields: [
      { key: 'member', label: '成員',     type: 'member', keep: true, full: true },

      { key: 'date',   label: '日期',     type: 'date', hint: '自己補的話，填每個月最後一個交易日',
        note(v) {
          if (!v.date || typeof Market === 'undefined' || !Market.ready() || v.date <= Market.date()) return '';
          if (v.date > U.today()) return '這一天還沒到';
          return '還沒收盤，先記盤中的數字；收盤資料更新後（工作天 15:43、19:43）打開記錄簿，會自動換成收盤價';
        } },
      { key: 'value',  label: '市值',     type: 'number', full: true, calc: v => histEstimate(v).value,
        hint: '有那天的收盤價就自動算好；查不到的照券商的歷史抄',
        note(v) {
          const { value: c, live } = histEstimate(v);
          if (c !== null && U.parseNum(v.value ?? '') !== c) return '';
          if (c !== null) return live ? `價格是 ${Market.priceText(History.heldCodes(v.member, v.date))}，和庫存總市值一樣` : `用 ${U.fmtDate(v.date)} 的收盤價算的，和庫存總市值同一種算法`;
          return v.member && v.date && typeof Market !== 'undefined' && Market.ready() && v.date < Market.date()
            ? '查不到這一天的收盤價，照券商的歷史抄' : '';
        } },
      { key: 'cost',   label: '付出成本', type: 'number', full: true, optional: true, calc: v => histEstimate(v).cost,
        hint: '不知道可以空白，那天就算不出損益',
        note(v) {
          if (histEstimate(v).cost !== null) {
            return U.parseNum(v.cost ?? '') === histEstimate(v).cost ? '照庫存快照和交易紀錄推算的' : '';
          }
          const start = v.member && typeof History !== 'undefined' ? History.startOf(v.member) : null;
          return start && v.date && v.date < start ? `${U.fmtDate(start)} 第一期庫存快照之前推算不出來` : '';
        } },

      { key: 'status', label: '狀態',     type: 'text', optional: true, auto: true, since: 6 },
    ],
  },






  alerts: {
    siteWrites: true,
    title: '到價通知',
    formTitle: '到價',
    noList: true,
    closeOnAdd: true,
    unique: ['code', 'dir', 'price', 'months', 'days', 'pct'],
    uniqueMsg: dup => `${[dup.code, dup.name].filter(Boolean).join(' ')} 已經有「${Alerts.label(dup)}」了`,
    remove: { label: '刪除這個到價', done: '已刪除' },
    card: { code: 'code', title: 'name' },

    beforeSave: rec => ({ ...rec, status: '', hitAt: '', since: Alerts.stamp() }),
    fields: [
      { key: 'code',   label: '代號',     type: 'text', caps: true, pair: 'name', suggestFrom: ['trades', 'snapshots', 'dividends'], note: codeNote },
      { key: 'name',   label: '證券',     type: 'text' },
      { key: 'dir',    label: '條件',     type: 'text', default: '漲到', full: true,
        hint: '盤中碰到就寄信通知一次；通知過的，打開按儲存會重新開始',
        toggle: [
          { value: '漲到', label: '漲到', tone: 'buy', match: /漲/ }, { value: '跌到', label: '跌到', tone: 'sell', match: /跌/ },
          { value: '新高', label: '新高', tone: 'buy', match: /新高/ }, { value: '新低', label: '新低', tone: 'sell', match: /新低/ },
          { value: '量增', label: '量增', tone: 'buy', match: /量/ },
        ] },
      { key: 'price',  label: '價格',     type: 'number', digits: 2, public: true, full: true, optional: true,
        when: v => Alerts.isPrice(v.dir), check: n => (n > 0 ? '' : '要大於 0'), note: v => Alerts.priceNote(v) },
      { key: 'months', label: '月數',     type: 'number', public: true, full: true, optional: true, since: 7, initial: 2,
        when: v => Alerts.isWindow(v.dir), hint: '和前幾個月的最高、最低比；現有資料最長 2 個月', note: v => Alerts.levelNote(v),
        toggle: [{ value: '1', label: '1 個月', tone: '', match: /^1$/ }, { value: '2', label: '2 個月', tone: '', match: /^2$/ }] },
      { key: 'days',   label: '均量天數', type: 'number', public: true, full: true, optional: true, since: 7, initial: 20,
        when: v => Alerts.isVolume(v.dir), hint: '最多 20 日', check: n => (Number.isInteger(n) && n >= 1 && n <= 20 ? '' : '填 1 到 20') },
      { key: 'pct',    label: '高於均量 %', type: 'number', public: true, full: true, optional: true, since: 7, initial: 50,
        when: v => Alerts.isVolume(v.dir), hint: '今天累積的量，通常下午才碰得到', check: n => (n >= 0 ? '' : '不能是負的'), note: v => Alerts.levelNote(v) },
      { key: 'status', label: '狀態',     type: 'text', optional: true, auto: true },
      { key: 'hitAt',  label: '通知時間', type: 'text', optional: true, auto: true },
      { key: 'since',  label: '設定時間', type: 'text', optional: true, auto: true },
    ],
  },
};
