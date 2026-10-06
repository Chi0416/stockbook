// 公告的除權息（js/announced.js）：新增除權息時一鍵帶入的候選：node --test tests/*.test.mjs
//   用瀏覽器載入的同一份程式（util.js、announced.js 都是全域變數），放進 vm 環境執行；公告資料用下面的假資料
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const plain = v => JSON.parse(JSON.stringify(v));

function load(list) {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(new URL('../js/util.js', import.meta.url), 'utf8'), ctx);
  if (list) vm.runInContext(`const DIVIDEND_LIST = ${JSON.stringify(list)};`, ctx);
  vm.runInContext(readFileSync(new URL('../js/announced.js', import.meta.url), 'utf8'), ctx, { filename: 'announced.js' });
  return vm.runInContext('Announced', ctx);
}

const Announced = load({
  updated: '2026-10-06',
  rows: [
    ['0056', '元大高股息', '2026-07-21', '2026-08-10', 1.35, 0],
    ['0056', '元大高股息', '2026-10-22', '2026-11-11', 1.07, 0],
    ['00679B', '元大美債20年', '2026-09-15', '2026-10-08', 0.3, 0],
    ['2330', '台積電', '2026-09-16', '2026-10-08', 5, 0],
  ],
});

test('列出這一檔公告的除權息，新的在前', () => {
  assert.deepEqual(plain(Announced.forCode('0056')).map(r => r.exDate), ['2026-10-22', '2026-07-21']);
  assert.deepEqual(plain(Announced.forCode('0056')[0]),
    { code: '0056', name: '元大高股息', exDate: '2026-10-22', payDate: '2026-11-11', cash: 1.07, stock: 0 });
  assert.equal(Announced.updated(), '2026-10-06');
});

test('代號不分大小寫、全形半形；沒有的代號、空白都不列', () => {
  assert.equal(Announced.forCode('００６７９ｂ').length, 1);
  assert.equal(Announced.forCode('9999').length, 0);
  assert.equal(Announced.forCode('').length, 0);
});

test('已經記過的那一次不列：除權息日相差 7 天以內算同一次（日期填錯一兩天也認得）', () => {
  const recorded = [{ code: '0056', exDate: '2026-07-23' }, { code: '2330', exDate: '2026-09-01' }];
  assert.deepEqual(plain(Announced.forCode('0056', recorded)).map(r => r.exDate), ['2026-10-22']);
  assert.equal(Announced.forCode('2330', recorded).length, 1); // 相差 15 天，不是同一次
});

test('同一次的判斷', () => {
  assert.equal(Announced.sameEvent({ code: '0056', exDate: '2026-10-22' }, { code: '0056', exDate: '2026-10-29' }), true);
  assert.equal(Announced.sameEvent({ code: '0056', exDate: '2026-10-22' }, { code: '0056', exDate: '2026-10-30' }), false);
  assert.equal(Announced.sameEvent({ code: '0056', exDate: '2026-10-22' }, { code: '0050', exDate: '2026-10-22' }), false);
  assert.equal(Announced.sameEvent({ code: '0056', exDate: '' }, { code: '0056', exDate: '2026-10-22' }), false);
});

test('瀏覽器還拿著舊版程式、沒有公告資料時什麼都不列', () => {
  const none = load(null);
  assert.equal(none.forCode('0056').length, 0);
  assert.equal(none.updated(), '');
});
