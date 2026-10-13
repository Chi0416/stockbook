// 帳戶紀錄（js/history.js）：哪幾天要記、記的付出成本和市值、走勢圖的合計：node --test tests/
//   App 的程式照瀏覽器的方式放進 vm 環境執行；收盤資料用下面這份假的（PRICE_LIST），格式和 shared/prices.json 一樣
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = ['util', 'privacy', 'market', 'schema', 'storage', 'holdings', 'history', 'trend'];
// 現在是 10/13 盤中（收盤資料還是 10/12 的）
const NOW = Date.parse('2026-10-13T10:00:00+08:00');

const prices = (complete = false) => ({
  date: '2026-10-12',
  complete,
  rows: {
    '0056': [36, 50, 50, 50, 50],
    '6488': [500, 50, 50, 50, 50, '2026-10-09'], // 10/12 還沒有（櫃買中心的資料晚一點才出來，或暫停交易）
  },
  months: {
    '2026-09-30': { '0056': 35, '6488': 480 },
    '2026-08-31': { '0056': 34 },
  },
});

const snap = (id, member, date, code, shares, totalCost) =>
  ({ id, member, date, type: '現股', code, name: code, shares, totalCost });

// m1：8/31 開始有快照；m2：9/30 才有快照，還有一檔興櫃（收盤資料裡沒有）；m3：只記交易
function app({ complete = false, history = [] } = {}) {
  const data = {
    version: 1,
    members: [{ id: 'm1', name: '爸爸' }, { id: 'm2', name: '媽媽' }, { id: 'm3', name: '小明' }],
    trades: [{ id: 't1', member: 'm3', date: '2026-10-01', type: '普買', code: '0056', name: '元大高股息', shares: 2000, price: 35, fee: 0, tax: 0, settle: 70000 }],
    snapshots: [
      snap('s1', 'm1', '2026-08-31', '0056', 1000, 30000),
      snap('s2', 'm2', '2026-09-30', '6488', 100, 45000),
      snap('s3', 'm2', '2026-09-30', '7777', 1000, 10000),
    ],
    dividends: [], watch: [], cashPools: [], history,
  };
  const ls = { 'stockbook.v1': JSON.stringify(data) };
  const ctx = vm.createContext({
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
    PRICE_LIST: prices(complete),
    document: { getElementById: () => null }, // 帳戶走勢的彈出視窗（trend.js）測試裡用不到
    localStorage: { getItem: k => ls[k] ?? null, setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
  });
  for (const f of FILES) vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  return vm.runInContext('({ History, Store, Trend })', ctx);
}

const plain = v => JSON.parse(JSON.stringify(v));
const rows = list => plain(list).map(r => `${r.member} ${r.date} ${r.cost} ${r.value}`).sort();

test('記最近一個交易日和最近兩個月的月底；付出成本推算到那天，市值用那天的收盤價', () => {
  const { History } = app();
  assert.deepEqual(rows(History.due()), [
    'm1 2026-08-31 30000 34000',
    'm1 2026-09-30 30000 35000',
    'm1 2026-10-12 30000 36000',
    'm2 2026-09-30 45000 48000', // 興櫃（收盤資料裡沒有）不算進去；8/31 在第一期快照之前，不記
    'm3 2026-10-12 70000 72000', // 只記交易的從第一筆交易開始
  ]);
  assert.equal(plain(History.due()).find(r => r.member === 'm1' && r.date === '2026-10-12').id, 'h-m1-2026-10-12');
});

test('有一檔還沒有那天的收盤價：那天先不記，等資料齊了；齊了之後沒成交的用之前的收盤價', () => {
  assert.ok(!rows(app().History.due()).some(r => r.startsWith('m2 2026-10-12')));
  assert.ok(rows(app({ complete: true }).History.due()).includes('m2 2026-10-12 45000 50000'));
});

test('已經有那天的紀錄（自己補的也算）不再記；記過的再算一次不會重複', () => {
  const { History, Store } = app({ history: [{ id: 'x', member: 'm1', date: '2026-08-31', value: 33000, cost: null }] });
  assert.ok(!rows(History.due()).some(r => r.startsWith('m1 2026-08-31')));
  Store.addMany('history', History.due());
  assert.deepEqual(plain(History.due()), []);
  Store.addMany('history', [{ id: 'h-m1-2026-10-12', member: 'm1', date: '2026-10-12', cost: 1, value: 1 }]);
  assert.equal(Store.list('history', 'all').filter(r => r.date === '2026-10-12' && r.member === 'm1').length, 1);
});

test('新增紀錄的表單先帶入：有收盤價的日子兩個都算；查不到收盤價只算付出成本；第一期快照之前都不算', () => {
  const { History } = app();
  assert.deepEqual(plain(History.estimate('m1', '2026-09-30')), { cost: 30000, value: 35000, live: false });
  assert.deepEqual(plain(History.estimate('m1', '2026-09-15')), { cost: 30000, value: null, live: false });
  assert.deepEqual(plain(History.estimate('m2', '2026-08-31')), { cost: null, value: null, live: false });
  assert.deepEqual(plain(History.estimate('', '2026-09-30')), { cost: null, value: null, live: false });
  assert.deepEqual(plain(History.estimate('m1', '')), { cost: null, value: null, live: false });
});

test('今天還沒收盤：用現價先記，標成「盤中」；收盤資料有那一天了換成收盤價、拿掉「盤中」', () => {
  const { History, Store } = app();
  // 沒連結 Google 時現價是最近的收盤價（10/12 的 36）
  assert.deepEqual(plain(History.estimate('m1', '2026-10-13')), { cost: 30000, value: 36000, live: true });
  assert.equal(History.statusOf('2026-10-13'), '盤中');
  assert.equal(History.statusOf('2026-10-12'), '');
  Store.addMany('history', [{ id: 'live', member: 'm1', date: '2026-10-12', cost: 30000, value: 35500, status: '盤中' }]);
  assert.ok(!rows(History.due()).some(r => r.startsWith('m1 2026-10-12'))); // 盤中先記的算有了，不再另外記一筆
  assert.deepEqual(plain(History.settle()), [{ id: 'live', values: { cost: 30000, value: 36000, status: '' } }]);
  Store.updateMany('history', History.settle());
  assert.deepEqual(plain(History.settle()), []);
  // 收盤資料裡沒有那一天（隔太久才打開）：換不了，留著盤中的數字和標記
  Store.addMany('history', [{ id: 'old', member: 'm1', date: '2026-10-05', cost: 30000, value: 35000, status: '盤中' }]);
  assert.deepEqual(plain(History.settle()), []);
});

test('走勢圖：目前檢視範圍每天合計；有人只補了市值，那天的付出成本是 null', () => {
  const { History, Store } = app({
    history: [
      { id: 'a', member: 'm1', date: '2026-09-30', value: 35000, cost: 30000 },
      { id: 'b', member: 'm2', date: '2026-09-30', value: 48000, cost: 45000 },
      { id: 'c', member: 'm1', date: '2025-12-31', value: 20000, cost: null },
      { id: 'd', member: 'm2', date: '2025-12-31', value: 40000, cost: 38000 },
    ],
  });
  assert.deepEqual(plain(History.series()), [
    { date: '2025-12-31', cost: null, value: 60000, live: false },
    { date: '2026-09-30', cost: 75000, value: 83000, live: false },
  ]);
  Store.setScope(['m2']);
  assert.deepEqual(plain(History.series()).map(d => d.cost), [38000, 45000]);
});

test('格線：三、四條、好讀的數字', () => {
  const { Trend } = app();
  assert.deepEqual(plain(Trend.ticks(4100000, 6100000)), [4500000, 5000000, 5500000, 6000000]);
  assert.deepEqual(plain(Trend.ticks(0, 90)), [0, 25, 50, 75]);
  assert.deepEqual(plain(Trend.ticks(5, 5)), [5]);
});
