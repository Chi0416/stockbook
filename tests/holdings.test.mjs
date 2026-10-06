// 持股推算（總覽的持股、累積現金股利的基準日股數）的測試：node --test tests/
//   App 的程式（util.js、schema.js、storage.js、holdings.js、views.js）照瀏覽器的方式放進 vm 環境執行
//   每個測試用一份新的資料（放在模擬的 localStorage 裡）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const FILES = ['util', 'schema', 'storage', 'holdings', 'views'];

// data：成員、交易明細、庫存快照、除權息；scope：檢視哪位成員（預設全家）
function app({ members = [{ id: 'me', name: '我' }], trades = [], snapshots = [], dividends = [] } = {}, scope = 'all') {
  const ls = {
    'stockbook.v1': JSON.stringify({ version: 1, members, trades, snapshots, dividends }),
    'stockbook.member': scope,
  };
  const ctx = vm.createContext({
    localStorage: {
      getItem: k => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: k => { delete ls[k]; },
    },
  });
  for (const f of FILES) vm.runInContext(readFileSync(new URL(`js/${f}.js`, ROOT), 'utf8'), ctx, { filename: `${f}.js` });
  return vm.runInContext('({ Holdings, VIEWS, SCHEMAS })', ctx);
}

// vm 裡建立的物件和這裡的原型不同，比較前先轉成一般物件
const plain = v => JSON.parse(JSON.stringify(v));

let n = 0;
// amount 是成交金額；應收付金額買進加上手續費、賣出扣掉手續費
const trade = (member, date, type, code, shares, amount, fee = 0) =>
  ({ id: `t${++n}`, member, date, type, code, name: code, shares, price: 0, fee, tax: 0, settle: /買/.test(type) ? amount + fee : amount - fee });
const snap = (member, date, code, shares, totalCost) =>
  ({ id: `s${++n}`, member, date, type: '現股', code, name: code, shares, avgCost: 0, totalCost, cumDividend: 0 });
const div = (code, exDate, payDate, cash, stock = 0, baseShares = null) =>
  ({ id: `d${++n}`, code, name: code, exDate, payDate, cash, stock, baseShares });

// 總覽的持股：[代號, 股數, 成本, 算式]；全家檢視時算式在各成員的明細（parts）裡
const positions = h => plain(h.positions).map(p => [p.code, p.shares, p.cost, p.formula ?? p.parts.map(x => x.formula).join('、')]);
// 累積現金股利的列：[代號, 成員, 基準日股數, 股息淨值, 說明]
const cash = v => plain(v.cashDividends.rows()).map(r => [r.code, r.member, r.shares, r.net, r.basis]);

test('什麼都沒有：總覽沒有持股資料', () => {
  const { Holdings } = app();
  assert.equal(Holdings.all('2026-10-04'), null);
});

test('沒有快照：從 0 開始加總交易明細，成本用移動平均', () => {
  const { Holdings } = app({
    trades: [
      trade('me', '2026-03-02', '普買', '0050', 1000, 150000, 213),
      trade('me', '2026-04-01', '普買', '0050', 1000, 170000, 242),
      trade('me', '2026-05-01', '普賣', '0050', 500, 90000),
    ],
  });
  const h = Holdings.all('2026-10-04');
  assert.equal(h.snapDate, null);
  assert.equal(h.mixed, false);
  // 成本 320455，賣掉 2000 股裡的 500 股後剩 3/4
  assert.deepEqual(positions(h), [['0050', 1500, 240341, '從 0 開始 + 買進 2,000 − 賣出 500']]);
});

test('沒有快照：只算到指定的日期為止', () => {
  const { Holdings } = app({
    trades: [trade('me', '2026-03-02', '普買', '0050', 1000, 150000), trade('me', '2026-11-01', '普買', '0050', 1000, 160000)],
  });
  assert.deepEqual(positions(Holdings.all('2026-10-04')), [['0050', 1000, 150000, '從 0 開始 + 買進 1,000']]);
});

test('沒有快照：現金股利依除權息日之前的交易算，當天以後買的不算', () => {
  const { VIEWS } = app({
    trades: [trade('me', '2026-03-02', '普買', '0050', 1000, 150000), trade('me', '2026-07-16', '普買', '0050', 500, 80000)],
    dividends: [div('0050', '2026-07-16', '2026-08-08', 1.5), div('2330', '2026-07-16', '2026-08-08', 3)],
  });
  assert.deepEqual(cash(VIEWS), [
    ['0050', 'me', 1000, 1500, '股數 = 從 0 開始 + 買進 1,000'],
    ['2330', '', null, null, '2026/07/16 之前的交易明細裡沒有這檔'],
  ]);
});

test('沒有快照：配股在發放日加進持股，依除權息日之前的股數計算', () => {
  const { Holdings } = app({
    trades: [trade('me', '2026-03-02', '普買', '0050', 1000, 150000), trade('me', '2026-07-20', '普買', '0050', 1000, 150000)],
    dividends: [div('0050', '2026-07-16', '2026-08-08', 0, 1)], // 每股配 0.1 股，7/20 買的不算
  });
  assert.deepEqual(positions(Holdings.all('2026-10-04')), [['0050', 2100, 300000, '從 0 開始 + 買進 2,000 + 配股 100']]);
});

test('沒有快照：除權息有手動填基準日股數時用手動的', () => {
  const { VIEWS } = app({
    trades: [trade('me', '2026-03-02', '普買', '0050', 1000, 150000)],
    dividends: [div('0050', '2026-07-16', '2026-08-08', 1, 0, { me: 3000 })],
  });
  assert.deepEqual(cash(VIEWS), [['0050', 'me', 3000, 3000, '基準日股數為手動輸入']]);
});

test('有快照：從最近一期快照開始，只加快照日期之後的交易（當天和之前的已經算在快照裡）', () => {
  const { Holdings } = app({
    snapshots: [snap('me', '2026-06-30', '0050', 2000, 300000)],
    trades: [
      trade('me', '2026-05-01', '普買', '0050', 999, 1),
      trade('me', '2026-06-30', '普買', '0050', 888, 1),
      trade('me', '2026-07-01', '普買', '0050', 1000, 160000),
    ],
  });
  const h = Holdings.all('2026-10-04');
  assert.equal(h.snapDate, '2026-06-30');
  assert.deepEqual(positions(h), [['0050', 3000, 460000, '2026/06/30 快照 2,000 + 買進 1,000']]);
});

test('有快照：除權息日在第一期快照之前，從之後的快照往回推，不會改成從 0 開始', () => {
  const { VIEWS } = app({
    snapshots: [snap('me', '2026-06-30', '0050', 2000, 300000)],
    trades: [trade('me', '2026-03-01', '普買', '0050', 500, 75000)], // 交易沒記齊：快照有 2000 股
    dividends: [div('0050', '2026-01-16', '2026-02-08', 1)],
  });
  assert.deepEqual(cash(VIEWS), [['0050', 'me', 1500, 1500, '股數 = 2026/06/30 快照 2,000 − 期間買進 500（往回推算）']]);
});

test('全家：一人有快照、一人沒有，各自推算後依代號合計', () => {
  const { Holdings } = app({
    members: [{ id: 'dad', name: '爸爸' }, { id: 'mom', name: '媽媽' }],
    snapshots: [snap('dad', '2026-06-30', '0050', 2000, 300000)],
    trades: [trade('mom', '2026-07-01', '普買', '0050', 1000, 160000)],
  });
  const h = Holdings.all('2026-10-04');
  assert.equal(h.snapDate, null);
  assert.equal(h.mixed, true);
  const p = plain(h.positions)[0];
  assert.deepEqual([p.code, p.shares, p.cost], ['0050', 3000, 460000]);
  assert.deepEqual(p.parts.map(x => [x.member, x.shares, x.formula]), [
    ['dad', 2000, '2026/06/30 快照 2,000'],
    ['mom', 1000, '從 0 開始 + 買進 1,000'],
  ]);
});

test('全家：只看某位成員時，只算那個人的', () => {
  const data = {
    members: [{ id: 'dad', name: '爸爸' }, { id: 'mom', name: '媽媽' }],
    trades: [trade('dad', '2026-03-02', '普買', '0050', 1000, 150000), trade('mom', '2026-03-02', '普買', '2330', 100, 60000)],
  };
  assert.deepEqual(positions(app(data, 'mom').Holdings.all('2026-10-04')), [['2330', 100, 60000, '從 0 開始 + 買進 100']]);
});

test('核對：第一期快照之前只有配股、沒有買賣紀錄時不核對（配到股的持股是開始記帳之前就有的）', () => {
  const { Holdings } = app({
    snapshots: [snap('me', '2026-08-31', '2887', 25431, 317850), snap('me', '2026-08-31', '0050', 2100, 300000)],
    trades: [trade('me', '2026-03-02', '普買', '0050', 2000, 300000)],
    dividends: [
      div('2887', '2026-07-10', '2026-08-05', 0, 0.1, { me: 25180 }), // 基準日股數手動填，配 251 股
      div('0050', '2026-07-16', '2026-08-08', 0, 0.5),                 // 依交易算 2,000 股，配 100 股
    ],
  });
  const checks = plain(Holdings.check()).map(c => [c.code, c.status, c.expected, c.actual]);
  assert.deepEqual(checks, [['2887', 'nohistory', 251, 25431], ['0050', 'ok', 2100, 2100]]);
});

test('核對：第一期快照之前的交易可以慢慢補，比快照少是還沒補齊（不警告），補齊了相符，比快照多才是對不上', () => {
  const partial = snap('me', '2026-08-31', '0050', 3000, 290150);
  const full = snap('me', '2026-08-31', '00919', 10000, 307450);
  const over = snap('me', '2026-08-31', '00878', 1000, 30000);
  const { Holdings, SCHEMAS } = app({
    snapshots: [partial, full, over],
    trades: [
      trade('me', '2026-08-05', '普買', '0050', 1000, 103050, 146),  // 8 月以前買的還沒補
      trade('me', '2026-08-18', '普買', '00919', 5000, 150750, 214),
      trade('me', '2026-08-28', '普買', '00919', 5000, 156700, 223),
      trade('me', '2026-08-03', '普買', '00878', 5000, 163700, 233), // 比快照多：少記了賣出或打錯
    ],
  });
  const checks = plain(Holdings.check()).map(c => [c.code, c.status, c.expected, c.actual]);
  assert.deepEqual(checks, [['0050', 'partial', 1000, 3000], ['00919', 'ok', 10000, 10000], ['00878', 'diff', 5000, 1000]]);

  const notes = plain(SCHEMAS.snapshots.annotate([{ date: '2026-08-31' }]));
  assert.deepEqual(notes.groups['2026-08-31'], { text: '核對：1 檔對不上，1 檔更早的交易還沒補齊', warn: true, lines: [] });
  assert.deepEqual(notes.cards[partial.id], {
    warn: false, text: '更早的交易還沒補齊：推算 1,000 股（從 0 開始 + 買進 1,000），快照是 3,000 股，還差 2,000 股',
  });
  assert.equal(notes.cards[full.id], undefined);
  assert.equal(notes.cards[over.id].warn, true);
});

test('舊版的成交金額換算成應收付金額：買進的成本和以前一樣（成交金額 + 手續費）', () => {
  const old = (type, shares, amount, fee, tax) =>
    ({ id: `o${++n}`, member: 'me', date: '2026-09-01', type, code: '0050', name: '元大台灣50', shares, price: 0, amount, fee, tax });
  const { Holdings } = app({
    trades: [old('普買', 5000, 163700, 233, 0), old('普買', 1000, 103196, 0, 0), old('普賣', 2000, 122400, 174, 367)],
  });
  const h = Holdings.all('2026-10-04');
  // 買進成本 163,933 + 103,196（照舊說明填付出成本、手續費 0）；賣出 2,000 股依平均成本扣掉
  assert.deepEqual(positions(h), [['0050', 4000, Math.round((163933 + 103196) * 4000 / 6000), '從 0 開始 + 買進 6,000 − 賣出 2,000']]);
});

test('交易表單的提醒：成交日期在這位成員的快照當天或之前時出現', () => {
  const { SCHEMAS } = app({
    members: [{ id: 'dad', name: '爸爸' }, { id: 'mom', name: '媽媽' }],
    snapshots: [snap('dad', '2025-06-30', '0050', 2000, 300000)],
  });
  const note = SCHEMAS.trades.fields.find(f => f.key === 'date').note;
  const msg = '已算在 2025/06/30 的庫存快照裡，總覽不會再加一次';
  assert.equal(note({ member: 'dad', date: '2025-06-29' }), msg);
  assert.equal(note({ member: 'dad', date: '2025-06-30' }), msg);
  assert.equal(note({ member: 'dad', date: '2025-07-01' }), '');
  assert.equal(note({ member: 'mom', date: '2025-06-01' }), ''); // 媽媽沒有快照
  assert.equal(note({ member: '', date: '2025-06-01' }), '');    // 還沒選成員
  assert.equal(note({ member: 'dad', date: '' }), '');           // 日期看不懂
});
