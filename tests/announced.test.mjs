// 公告的除權息（js/announced.js）：新增除權息時一鍵帶入的候選、App 打開時下載公告資料：node --test tests/*.test.mjs
//   用瀏覽器載入的同一份程式（util.js、announced.js 都是全域變數），放進 vm 環境執行
//   公告資料用下面的假資料：直接放一份全域的 DIVIDEND_LIST，或用假的 fetch 下載
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
    ['00922', '國泰台灣領袖50', '2026-10-19', '2026-11-12', null, 0],
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

test('金額待公告的也列出來（cash 是 null）', () => {
  assert.deepEqual(plain(Announced.forCode('00922')),
    [{ code: '00922', name: '國泰台灣領袖50', exDate: '2026-10-19', payDate: '2026-11-12', cash: null, stock: 0 }]);
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

test('公告資料還沒下載好時什麼都不列', () => {
  const none = load(null);
  assert.equal(none.forCode('0056').length, 0);
  assert.equal(none.updated(), '');
  assert.equal(none.ready(), false);
  assert.equal(none.state(), 'loading');
});

// ---------- 下載（App 打開時，見 announced.js 的 load、refresh） ----------
//   假的 fetch：依序回 replies 裡的內容（字串是下載到的內容、404 是網站回錯誤、Error 是沒有網路）；asked 記下每次怎麼問
const v1 = JSON.stringify({ updated: '2026-10-06', rows: [['0056', '元大高股息', '2026-10-22', '2026-11-11', null, 0]] });
const v2 = JSON.stringify({ updated: '2026-10-07', rows: [['0056', '元大高股息', '2026-10-22', '2026-11-11', 1.07, 0]] });

function online(replies) {
  const asked = [];
  const ctx = vm.createContext({
    now: 1e12,
    fetch: async (url, opts) => {
      asked.push(`${url} ${opts.cache}`);
      const r = replies.shift();
      if (r instanceof Error) throw r;
      return { ok: r !== 404, text: async () => r };
    },
  });
  vm.runInContext('Date.now = () => now;', ctx);
  vm.runInContext(readFileSync(new URL('../js/util.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(readFileSync(new URL('../js/announced.js', import.meta.url), 'utf8'), ctx, { filename: 'announced.js' });
  const A = vm.runInContext('Announced', ctx);
  const t = { A, ctx, asked, replies, told: 0 };
  A.onChange(() => { t.told += 1; });
  return t;
}
const offline = () => new Error('沒有網路');

test('打開時下載：先問網站有沒有新的，下載好才列出來，通知一次', async () => {
  const t = online([v1]);
  assert.equal(t.A.state(), 'loading');
  assert.equal(await t.A.load(), true);
  assert.deepEqual(t.asked, ['shared/dividends.json no-cache']);
  assert.equal(t.A.ready(), true);
  assert.equal(t.A.updated(), '2026-10-06');
  assert.deepEqual(plain(t.A.forCode('0056')).map(r => r.cash), [null]);
  assert.equal(t.told, 1);
});

test('內容一樣不再通知；換了新的才通知，列出新的', async () => {
  const t = online([v1, v1, v2]);
  await t.A.load();
  assert.equal(await t.A.load(), false);
  assert.equal(t.told, 1);
  assert.equal(await t.A.load(), true);
  assert.equal(t.told, 2);
  assert.equal(t.A.updated(), '2026-10-07');
  assert.deepEqual(plain(t.A.forCode('0056')).map(r => r.cash), [1.07]);
});

test('沒有網路時用瀏覽器暫存的上一份', async () => {
  const t = online([offline(), v1]);
  assert.equal(await t.A.load(), true);
  assert.deepEqual(t.asked, ['shared/dividends.json no-cache', 'shared/dividends.json force-cache']);
  assert.equal(t.A.ready(), true);
});

test('下載不了：第一次通知（表單寫出來），再失敗不重複通知；下載過的留著原本的資料', async () => {
  const t = online([offline(), offline(), 404, offline()]);
  assert.equal(await t.A.load(), true);
  assert.equal(t.A.state(), 'failed');
  assert.equal(t.A.forCode('0056').length, 0);
  assert.equal(await t.A.load(), false);
  assert.equal(t.told, 1);

  t.replies.push(v1, offline(), offline(), '<html>壞掉的網頁</html>');
  await t.A.load();
  assert.equal(t.A.state(), 'ready');
  await t.A.load(); // 沒有網路
  await t.A.load(); // 內容不是公告資料
  assert.equal(t.A.state(), 'ready');
  assert.equal(t.A.updated(), '2026-10-06');
  assert.equal(t.told, 2);
});

test('下載中再叫一次，不會重複下載', async () => {
  const t = online([v1]);
  await Promise.all([t.A.load(), t.A.load(), t.A.refresh()]);
  assert.equal(t.asked.length, 1);
  assert.equal(t.told, 1);
});

test('從背景切回來（refresh）：還沒下載成功的馬上再試；下載過的隔 30 分鐘才再檢查', async () => {
  const t = online([offline(), offline(), v1]);
  await t.A.load();
  assert.equal(t.A.state(), 'failed');
  await t.A.refresh();
  assert.equal(t.A.state(), 'ready');
  assert.equal(t.asked.length, 3);

  t.ctx.now += 29 * 60000;
  assert.equal(await t.A.refresh(), false);
  assert.equal(t.asked.length, 3);
  t.ctx.now += 60000;
  t.replies.push(v2);
  assert.equal(await t.A.refresh(), true);
  assert.equal(t.asked.length, 4);
  assert.equal(t.A.updated(), '2026-10-07');
});
