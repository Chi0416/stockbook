// 庫存快照的收盤價（market.js 的 closeOn、schema.js 的收盤價欄、表格的市值和損益、每一期的合計）：node --test tests/
//   用瀏覽器載入的同一份程式（util.js、privacy.js、market.js、schema.js 都是全域變數），放進同一個 vm 環境執行
//   收盤資料用下面這份假的（PRICE_LIST），格式和 shared/prices.json 一樣
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const PRICE_LIST = {
  date: '2026-10-09', // 星期五
  rows: {
    '0050': [114.8, 80, 80, 80, 80],
    '0056': [36.15, 50, 50, 50, 50],
    '6488': [500, 50, 50, 50, 50, '2026-10-08'], // 10/09 沒有成交（或櫃買中心的資料還沒出來）
  },
  months: {
    '2026-09-30': { '0050': 112.05, '0056': 35.5, '6488': 480 },
    '2026-07-31': { '0050': 100 }, // 星期五
  },
};

function app() {
  const store = new Map();
  const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const ctx = vm.createContext({ localStorage, PRICE_LIST });
  for (const f of ['util', 'privacy', 'market', 'schema']) {
    vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  }
  return vm.runInContext('({ Market, SCHEMAS, Privacy, snapSum, snapValueOf, snapPlOf })', ctx);
}

test('某一天的收盤價：最近一個交易日、月底；快照日期是週末用前一個交易日的', () => {
  const { Market } = app();
  assert.equal(Market.closeOn('0050', '2026-10-09'), 114.8);
  assert.equal(Market.closeOn('0050', '2026/10/09'), 114.8); // 試算表手打的日期
  assert.equal(Market.closeOn('0050', '2026-10-11'), 114.8); // 星期日：中間只隔週末
  assert.equal(Market.closeOn('0050', '2026-09-30'), 112.05);
  assert.equal(Market.closeOn('0056', '2026-09-30'), 35.5);
  assert.equal(Market.closeOn('0050', '2026-08-02'), 100); // 7/31 是星期五，8/2 是星期日
});

test('沒有那一天的收盤價：回傳 null，不拿別天的', () => {
  const { Market } = app();
  assert.equal(Market.closeOn('0050', '2026-10-12'), null); // 星期一：那天的資料還沒出來，不能用星期五的
  assert.equal(Market.closeOn('0050', '2026-10-08'), null); // 不是最近一個交易日，也不是月底
  assert.equal(Market.closeOn('0050', '2026-08-31'), null); // 只有最近兩個月的月底
  assert.equal(Market.closeOn('6488', '2026-10-09'), null); // 最近一個交易日沒有成交：等晚上那次更新
  assert.equal(Market.closeOn('6488', '2026-09-30'), 480);
  assert.equal(Market.closeOn('0057', '2026-10-09'), null); // 資料裡沒有這一檔
  assert.equal(Market.closeOn('0050', ''), null);
});

test('收盤價欄：表單上有那一天的收盤價就帶入，沒有時說明會不會自動補', () => {
  const { SCHEMAS } = app();
  const f = SCHEMAS.snapshots.fields.find(x => x.key === 'price');
  assert.equal(f.optional, true);
  const v = { code: '0050', date: '2026-10-09', price: '' };
  assert.equal(f.calc(v), 114.8);
  assert.equal(f.note({ ...v, price: '114.8' }), '2026/10/09 的收盤價，自動帶入的');
  assert.equal(f.note({ ...v, price: '115' }), ''); // 自己填的
  assert.equal(f.calc({ ...v, date: '2026-10-12' }), null);
  assert.equal(f.note({ ...v, date: '2026-10-12' }), '收盤資料更新後（工作天 15:43、19:43）自動補上');
  assert.equal(f.note({ ...v, date: '2026-08-29' }), '收盤資料裡沒有這一天的價格，要的話自己填');
});

test('市值、損益：昨日餘額 × 收盤價、市值 − 付出成本；沒有收盤價時算不出來', () => {
  const { snapValueOf, snapPlOf } = app();
  const r = { shares: 42000, totalCost: 1367670, price: 36.15 };
  assert.equal(snapValueOf(r), 1518300);
  assert.equal(snapPlOf(r), 150630);
  assert.equal(snapValueOf({ ...r, price: null }), null);
  assert.equal(snapPlOf({ ...r, price: undefined }), null);
});

test('每一期的合計：成本、市值、損益、報酬率；沒有收盤價的不算進市值和損益', () => {
  const { snapSum, Privacy } = app();
  const a = { date: '2026-10-09', shares: 42000, totalCost: 1367670, price: 36.15 };
  const b = { date: '2026-10-09', shares: 1000, totalCost: 100000, price: 114.8 };
  const c = { date: '2026-10-09', shares: 1000, totalCost: 500000, price: null };
  assert.equal(snapSum([a, b], '2026-10-09'), '合計：成本 1,467,670、市值 1,633,100、損益 165,430（11.27%）');
  assert.equal(snapSum([a, b, c], '2026-10-09'),
    '合計：成本 1,967,670、市值 1,633,100、損益 165,430（11.27%）；1 檔沒有收盤價，市值和損益沒有算進去');
  assert.equal(snapSum([c], '2026-10-12'), '合計：成本 500,000；收盤價等收盤資料更新後自動補上');
  assert.equal(snapSum([c], '2026-08-28'), '合計：成本 500,000');
  Privacy.set(true);
  assert.equal(snapSum([a], '2026-10-09'), '合計：成本 ***、市值 ***、損益 ***（***）');
});
