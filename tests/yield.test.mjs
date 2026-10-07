// 殖利率的近一年現金股利（js/yield.js 的 Yield）：node --test tests/
//   用瀏覽器載入的同一份程式（util.js、announced.js、yield.js 都是全域變數），放進同一個 vm 環境執行
//   公告的除權息用下面這份假的資料（DIVIDEND_LIST），自己記的除權息直接傳進 info
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 月配 13 個月（2025/09 ～ 2026/09 每月 17 日，每次 0.1 元），下一次 10/21 金額待公告
const monthly = [...Array(13)].map((_, i) => {
  const d = new Date(Date.UTC(2025, 8 + i, 17));
  return ['00929', '復華台灣科技優息', d.toISOString().slice(0, 10), '', 0.1, 0];
});

const DIVIDEND_LIST = {
  updated: '2026-10-06',
  rows: [
    // 季配：去年 10/23 到今年 7/21 四次，下一次 10/22 金額待公告
    ['0056', '元大高股息', '2026-10-22', '2026-11-11', null, 0],
    ['0056', '元大高股息', '2026-07-21', '2026-08-10', 1.35, 0],
    ['0056', '元大高股息', '2026-04-23', '2026-05-14', 1, 0],
    ['0056', '元大高股息', '2026-01-22', '2026-02-11', 0.866, 0],
    ['0056', '元大高股息', '2025-10-23', '2025-11-14', 0.866, 0],
    // 年配：今年的還沒除息，去年的晚了幾天
    ['2884', '玉山金', '2026-07-28', '2026-08-20', 1.5, 0],
    ['2884', '玉山金', '2025-07-15', '2025-08-08', 1.2, 0],
    ...monthly,
    ['00929', '復華台灣科技優息', '2026-10-21', '2026-11-16', null, 0],
    // 剛上市的月配：只配過一次，下一次已公告金額
    ['00400A', '主動國泰動能高息', '2026-10-08', '2026-11-05', 0.12, 0],
    ['00400A', '主動國泰動能高息', '2026-09-07', '2026-10-05', 0.12, 0],
    // 只配股（沒有現金股利）
    ['9999', '只配股', '2026-08-01', '2026-08-20', 0, 1],
  ],
};

const ctx = vm.createContext({ DIVIDEND_LIST, localStorage: { getItem: () => null, setItem() {} } });
for (const f of ['util', 'announced', 'yield']) {
  const src = readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
  vm.runInContext(src, ctx, { filename: `${f}.js` });
}
const { Yield } = vm.runInContext('({ Yield })', ctx);

// vm 裡建立的物件和這裡的原型不同，比較前先轉成一般物件
const plain = v => JSON.parse(JSON.stringify(v));
const info = (code, today, own = []) => plain(Yield.info(code, { today, own }));

test('季配：近一年取最近 4 次，下一次金額待公告', () => {
  const r = info('0056', '2026-10-06');
  assert.equal(r.per, 4);
  assert.equal(r.freq, '季配');
  assert.equal(r.count, 4);
  assert.equal(r.sum, 4.082);
  assert.equal(r.short, false);
  // 暴力年化：最近一次 1.35 × 4
  assert.equal(r.last.exDate, '2026-07-21');
  assert.equal(r.annual, 5.4);
  assert.equal(r.trend, 1); // 1.35 比近一年平均 1.0205 多：紅色
  assert.deepEqual(r.next, { exDate: '2026-10-22', payDate: '2026-11-11', cash: null, own: false });
  assert.equal(r.announced, true);
});

test('除息日每年差一天：今年 10/22 除息後，去年 10/23 那次不會再算一次', () => {
  const own = [{ code: '0056', exDate: '2026-10-22', cash: 1.72 }];
  const r = info('0056', '2026-10-23', own);
  assert.equal(r.count, 4);
  assert.deepEqual(r.recent.map(x => x.exDate), ['2026-10-22', '2026-07-21', '2026-04-23', '2026-01-22']);
  assert.equal(r.sum, 4.936);
});

test('公告的金額還沒出來：用自己記的，標出是自己記的；公告有金額時以公告為主', () => {
  const own = [
    { code: '0056', exDate: '2026-10-21', cash: 1.72 },   // 和公告的 10/22 差一天，算同一次
    { code: '0056', exDate: '2026-07-21', cash: 1.3 },    // 公告已經有金額，用公告的 1.35
  ];
  const before = info('0056', '2026-10-06', own);
  assert.deepEqual(before.next, { exDate: '2026-10-22', payDate: '2026-11-11', cash: 1.72, own: true });
  assert.equal(before.sum, 4.082);
  const after = info('0056', '2026-10-23', own);
  assert.equal(after.recent[0].own, true);
  assert.equal(after.recent[1].cash, 1.35);
});

test('年配：今年的還沒除息時，去年的（晚了幾天）還算得到；下一次是今年的', () => {
  const r = info('2884', '2026-07-20');
  assert.equal(r.freq, '年配');
  assert.equal(r.count, 1);
  assert.equal(r.sum, 1.2);
  assert.equal(r.annual, 1.2); // 年配的暴力年化和近一年一樣
  assert.equal(r.trend, 0);     // 近一年只有一次：不上色
  assert.equal(r.next.exDate, '2026-07-28');
  // 除息之後換成今年的
  assert.equal(info('2884', '2026-07-28').sum, 1.5);
});

test('月配：資料有 13 個月時只取最近 12 次', () => {
  const r = info('00929', '2026-10-06');
  assert.equal(r.freq, '月配');
  assert.equal(r.count, 12);
  assert.equal(r.recent.at(-1).exDate, '2025-10-17');
  assert.equal(r.sum, 1.2);
  assert.equal(r.annual, 1.2); // 0.1 × 12
  assert.equal(r.trend, 0);    // 每個月一樣多：不上色
  assert.equal(r.short, false);
});

test('剛上市的月配：近一年只有 1 次，標出次數不夠', () => {
  const r = info('00400A', '2026-10-06');
  assert.equal(r.freq, '月配');
  assert.equal(r.count, 1);
  assert.equal(r.short, true);
  assert.equal(r.sum, 0.12);
  assert.equal(r.annual, 1.44); // 次數不夠時，暴力年化比較接近實際：0.12 × 12
  assert.equal(r.trend, 0);      // 只配過一次：不上色
  assert.deepEqual(r.next, { exDate: '2026-10-08', payDate: '2026-11-05', cash: 0.12, own: false });
});

test('公告資料裡沒有（上櫃 ETF）：用自己記的除權息算；都沒有時是 null', () => {
  const own = [
    { code: '00679b', exDate: '2026-07-16', cash: 0.37 },  // 小寫代號也認得
    { code: '00679B', exDate: '2026-04-16', cash: 0.37 },
    { code: '00679B', exDate: '2026-01-16', cash: 0.37 },
    { code: '00679B', exDate: '2025-10-16', cash: 0.37 },
    { code: '00679B', exDate: '2025-07-16', cash: 0 },      // 金額 0 不算
  ];
  const r = info('00679B', '2026-10-06', own);
  assert.equal(r.announced, false);
  assert.equal(r.freq, '季配');
  assert.equal(r.count, 4);
  assert.equal(r.sum, 1.48);
  assert.ok(r.recent.every(x => x.own));
  assert.equal(info('00679B', '2026-10-06'), null);
});

test('紅綠：和近一年平均每次比；剛上市次數不夠、每次一樣多時不會因為殖利率少算就變紅', () => {
  const own = [
    // 季配，越配越少：最近一次 0.5，近一年平均 0.825
    { code: '1234', exDate: '2026-09-15', cash: 0.5 },
    { code: '1234', exDate: '2026-06-15', cash: 0.8 },
    { code: '1234', exDate: '2026-03-16', cash: 1 },
    { code: '1234', exDate: '2025-12-15', cash: 1 },
    // 剛上市的月配，配過兩次一樣多：暴力年化比殖利率高，但不是在成長
    { code: '5678', exDate: '2026-09-20', cash: 0.12 },
    { code: '5678', exDate: '2026-08-20', cash: 0.12 },
  ];
  assert.equal(info('1234', '2026-10-06', own).trend, -1);
  const r = info('5678', '2026-10-06', own);
  assert.equal(r.short, true);
  assert.ok(r.annual > r.sum);
  assert.equal(r.trend, 0);
});

test('近一年沒有配息：近一年和暴力年化都算不出來', () => {
  const r = info('2884', '2027-09-01');
  assert.equal(r.count, 0);
  assert.equal(r.last, null);
  assert.equal(r.annual, null);
});

test('只配股的不算現金股利', () => {
  assert.equal(info('9999', '2026-10-06'), null);
});
