// 月線扣抵、5 日線（ma.js）和 K 線資料（candles.js）：node --test tests/
//   用瀏覽器載入的同一份程式（util.js、candles.js、ma.js 都是全域變數），放進同一個 vm 環境執行
//   K 線資料用下面這份假的（CANDLE_LIST），格式和 shared/candles.json 一樣
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 21 個交易日，新的在前：10/13（星期二）、10/12、10/09……9/15
const days = ['2026-10-13', '2026-10-12', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05', '2026-10-02', '2026-10-01',
  '2026-09-30', '2026-09-29', '2026-09-28', '2026-09-25', '2026-09-24', '2026-09-23', '2026-09-22', '2026-09-21', '2026-09-18', '2026-09-17', '2026-09-16', '2026-09-15'];
const down = days.map((_, i) => 100 + i); // 一路跌：最近 100，越早越高（21 天前 120）
// 最近 10 天是 [開, 高, 低, 收]，更早的只有收盤價
const row = closes => closes.map((v, i) => (v === null || i >= 10 ? v : [v + 0.5, v + 1, v - 1, v]));
const CANDLE_LIST = {
  date: '2026-10-13',
  days,
  rows: {
    2330: row(down),
    6488: row(down.map((v, i) => (i === 3 ? null : v))), // 10/08 沒有成交：有成交的剛好 20 天
    '00999': row(down.slice(0, 10)), // 上市才 10 天
  },
};

function app(data = CANDLE_LIST, today = '2026-10-14') {
  const ctx = vm.createContext(data ? { CANDLE_LIST: data } : {});
  for (const f of ['util', 'candles', 'ma']) {
    vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  }
  vm.runInContext(`U.today = () => '${today}'`, ctx);
  return vm.runInContext('({ Candles, MA })', ctx);
}
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}：${a} ≠ ${b}`);

test('K 線資料：照 days 的日期，[開, 高, 低, 收] 或只有收盤價，沒有成交的那天跳過', () => {
  const { Candles } = app();
  const list = Candles.get('2330');
  assert.equal(list.length, 21);
  assert.deepEqual({ ...list[0] }, { date: '2026-10-13', open: 100.5, high: 101, low: 99, close: 100 });
  assert.deepEqual({ ...list[10] }, { date: '2026-09-29', open: null, high: null, low: null, close: 110 });
  const gap = Candles.get('6488');
  assert.equal(gap.length, 20);
  assert.equal(gap[3].date, '2026-10-07');
  assert.deepEqual([...Candles.get('9999')], []);
  assert.equal(app(null).Candles.get('2330'), null); // 還沒下載
});

test('月線 = 最近 20 天的平均；今天的月線用輸入的價格，扣掉 20 天前（第 20 筆）的收盤價', () => {
  const { MA } = app();
  // 前 19 天 100～118 加起來 2071，扣抵值是第 20 筆 119（9/16）
  const r = MA.calc('2330', 139);
  assert.deepEqual([r.deduct.date, r.deduct.close], ['2026-09-16', 119]);
  near(r.prev, (2071 + 119) / 20, '前一天的月線');
  near(r.ma, (2071 + 139) / 20, '今天的月線');
  assert.equal(r.dir, 1); // 139 比扣抵值 119 高：上彎
  assert.equal(r.prevDir, -1); // 前一天：加進 100、扣掉 120，往下
  assert.equal(r.last, '2026-10-13');
  assert.equal(MA.calc('2330', 119).dir, 0); // 和扣抵值一樣：持平
  near(MA.calc('2330', 119).ma, r.prev, '持平');
  assert.equal(MA.calc('2330', 99).dir, -1);
});

test('接下來 5 天的扣抵值：今天扣第 20 筆，之後 4 天扣第 19、18…16 筆，先扣的在前', () => {
  const { MA } = app();
  const r = MA.calc('2330', 110);
  assert.deepEqual(r.deducts.map(x => x.close), [119, 118, 117, 116, 115]);
  assert.deepEqual(r.next.map(x => x.close), [118, 117, 116, 115]);
  assert.deepEqual(r.next.map(x => x.date), ['2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22']);
});

test('扣低、扣高：這 5 天的扣抵值有幾天比價格低、高', () => {
  const { MA } = app();
  assert.deepEqual([MA.calc('2330', 117).low, MA.calc('2330', 117).high], [2, 2]); // 115、116 低，118、119 高，117 一樣
  assert.deepEqual([MA.calc('2330', 200).low, MA.calc('2330', 200).high], [5, 0]);
  assert.deepEqual([MA.calc('2330', 50).low, MA.calc('2330', 50).high], [0, 5]);
});

test('價格一直不變的月線（虛線）：第 k 天加 k 個價格、扣掉 k 天，畫 5 天', () => {
  const { MA } = app();
  const r = MA.calc('2330', 139);
  assert.equal(r.proj.length, 5);
  near(r.proj[0], r.ma, '今天');
  near(r.proj[1], (2 * 139 + 2071 - 118) / 20, '第 2 天：再扣掉 118');
  near(r.proj[4], (5 * 139 + (100 + 114) * 15 / 2) / 20, '第 5 天：剩下最近 15 天');
});

test('5 日線：最近 5 天的平均，價格不變的話第 5 天就等於價格', () => {
  const { MA } = app();
  const r = MA.calc('2330', 139);
  near(r.prev5, (100 + 101 + 102 + 103 + 104) / 5, '前一天的 5 日線');
  near(r.ma5, (139 + 100 + 101 + 102 + 103) / 5, '今天的 5 日線：扣掉 104');
  assert.equal(r.dir5, 1);
  assert.equal(r.proj5.length, 5);
  near(r.proj5[4], 139, '第 5 天');
});

test('沒有輸入價格：只算前一天的月線和扣抵值，沒有虛線', () => {
  const { MA } = app();
  for (const p of [null, 0, -5]) {
    const r = MA.calc('2330', p);
    assert.equal(r.ma, null);
    assert.equal(r.dir, null);
    assert.equal(r.proj.length, 0);
    assert.equal(r.low, null);
    assert.equal(r.deduct.close, 119);
  }
});

test('中間有一天沒成交：有成交的 20 天照樣算，再前一天的月線不知道', () => {
  const { MA } = app();
  const r = MA.calc('6488', 100);
  assert.deepEqual([r.deduct.date, r.deduct.close], ['2026-09-15', 120]);
  assert.equal(r.prevDir, null);
});

test('算不出來的時候寫原因', () => {
  const { MA } = app();
  assert.match(MA.calc('00999', 100).why, /只有 10 天/);
  assert.match(MA.calc('9999', 100).why, /沒有這檔/);
  assert.match(app(null).MA.calc('2330', 100).why, /下載中/);
});

test('輸入的價格是今天的，還是下一個交易日的', () => {
  assert.equal(app(CANDLE_LIST, '2026-10-14').MA.dayName('2026-10-13'), '今天'); // 盤中：收盤資料到昨天
  assert.equal(app(CANDLE_LIST, '2026-10-14').MA.dayName('2026-10-14'), '下一個交易日'); // 收盤資料已經有今天的
  assert.equal(app(CANDLE_LIST, '2026-10-17').MA.dayName('2026-10-16'), '下一個交易日'); // 星期六
});
