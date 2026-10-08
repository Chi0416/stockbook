// EPS 達成率（js/eps.js 的 Eps、EPS_PAGE）：node --test tests/
//   用瀏覽器載入的同一份程式（util.js、eps.js 都是全域變數），放進同一個 vm 環境執行
//   EPS 用下面這份假的資料（EPS_LIST），格式和 shared/eps.json 一樣
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const EPS_LIST = {
  updated: '2026-10-08',
  rows: {
    // 你舉的例子：去年全年 10 元，今年第 1 季 4 元
    1111: { eps: { 2025: [2.5, 5, 7.5, 10], 2026: [4] }, div: {} },
    // 台積電（實際的數字）：上半年 49.33，去年全年 66.26、去年上半年 29.31
    2330: { eps: { 2024: [8.7, 18.25, 30.8, 45.25], 2025: [13.95, 29.31, 46.75, 66.26], 2026: [22.08, 49.33] }, div: {} },
    // 旺季在下半年：達成率落後，比去年同期多很多
    1736: { eps: { 2025: [0.5, 1.28, 4, 9.06], 2026: [1.5, 3.27] }, div: {} },
    // 只公布半年報：第 1、3 季沒有
    1294: { eps: { 2025: [null, 2.35, null, 4.6], 2026: [null, 2.22] }, div: {} },
    // 去年全年虧損（台泥）
    1101: { eps: { 2025: [0.07, 0.07, -1.28, -1.6], 2026: [0.1, 0.38] }, div: {} },
    // 今年才上市：沒有去年全年
    7777: { eps: { 2025: [null, 1.2, 2.0], 2026: [0.8, 1.5] }, div: {} },
    // 今年虧損、去年賺錢
    8888: { eps: { 2025: [1, 2, 3, 4], 2026: [-0.5, -1] }, div: {} },
    // 剛好跟上進度
    9999: { eps: { 2025: [1, 2, 3, 4], 2026: [1, 2] }, div: {} },
    // 去年只賺 0.05：基期很低
    3490: { eps: { 2025: [0.01, 0.02, 0.03, 0.05], 2026: [3, 6.15] }, div: {} },
  },
};

function load(list = EPS_LIST) {
  const localStorage = { getItem: () => null, setItem() {} };
  const ctx = vm.createContext({ localStorage, EPS_LIST: list });
  for (const f of ['util', 'eps']) {
    vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  }
  return vm.runInContext('({ Eps, EPS_PAGE })', ctx);
}
const { Eps, EPS_PAGE } = load();
const pick = (e, keys) => Object.fromEntries(keys.map(k => [k, e[k]]));

test('達成率 = 今年累計 ÷ 去年全年；進度每季 25%；超前 = 達成率 − 進度', () => {
  assert.deepEqual(pick(Eps.info('1111'), ['year', 'q', 'now', 'last', 'pct', 'pace', 'ahead', 'est']),
    { year: 2026, q: 1, now: 4, last: 10, pct: 40, pace: 25, ahead: 15, est: 16 });
});

test('台積電：上半年 49.33 ÷ 去年全年 66.26 = 74%，進度 50%，超前 24%；照這速度全年 98.66', () => {
  const e = Eps.info('2330');
  assert.deepEqual(pick(e, ['q', 'pct', 'pace', 'ahead', 'est', 'same']), { q: 2, pct: 74, pace: 50, ahead: 24, est: 98.66, same: 29.31 });
  assert.equal(Math.round(e.growth * 100), 68); // 比去年同期多 68%
  assert.deepEqual([...e.years.map(y => [y.year, y.eps, y.q])].map(x => [...x]), [[2024, 45.25, 4], [2025, 66.26, 4], [2026, 49.33, 2]]);
});

test('旺季在下半年：達成率落後，去年同期看得出來今年比較好', () => {
  const e = Eps.info('1736');
  assert.equal(e.pct, 36);
  assert.equal(e.ahead, -14);
  assert.equal(Math.round(e.growth * 100), 155);
});

test('只公布半年報的公司：季數照最後一個有數字的季', () => {
  const e = Eps.info('1294');
  assert.deepEqual(pick(e, ['q', 'last', 'same', 'pct', 'pace', 'ahead']), { q: 2, last: 4.6, same: 2.35, pct: 48, pace: 50, ahead: -2 });
});

test('去年全年虧損、沒有去年全年：算不出達成率', () => {
  const loss = Eps.info('1101');
  assert.equal(loss.last, -1.6);
  assert.deepEqual(pick(loss, ['pct', 'ahead', 'rate']), { pct: null, ahead: null, rate: null });
  const fresh = Eps.info('7777');
  assert.equal(fresh.last, null);
  assert.equal(fresh.ahead, null);
  assert.equal(fresh.same, 1.2); // 去年第 2 季有，同期還是比得出來
});

test('今年虧損：達成率是負的，落後', () => {
  const e = Eps.info('8888');
  assert.deepEqual(pick(e, ['pct', 'ahead']), { pct: -25, ahead: -75 });
});

test('ETF、資料裡沒有的：null', () => {
  assert.equal(Eps.info('0050'), null);
  assert.equal(Eps.info(''), null);
});

test('代號全形、小寫也找得到', () => {
  assert.equal(Eps.info('２３３０').pct, 74);
});

test('財報公布到第幾季：九成的公司公布到的那一季；有公司先公布下一季時 more', () => {
  // 20 家公布到第 2 季
  const rows = Object.fromEntries([...Array(20)].map((_, i) => [`${1000 + i}`, { eps: { 2025: [1, 2, 3, 4], 2026: [1, 2] }, div: {} }]));
  assert.deepEqual({ ...load({ updated: '2026-09-01', rows }).Eps.latest() }, { year: 2026, q: 2, more: false });
  // 台積電先公布了第 3 季
  const early = { ...rows, 2330: { eps: { 2026: [1, 2, 3] }, div: {} } };
  assert.deepEqual({ ...load({ updated: '2026-10-20', rows: early }).Eps.latest() }, { year: 2026, q: 2, more: true });
  // 1～5 月：今年還沒有財報，看的是去年
  const jan = Object.fromEntries(Object.entries(rows).map(([c, r]) => [c, { eps: { 2025: r.eps[2025] }, div: {} }]));
  assert.deepEqual({ ...load({ updated: '2027-04-01', rows: jan }).Eps.latest() }, { year: 2025, q: 4, more: false });
});

test('排序：超前多的在前，算不出來的放最後', () => {
  const rows = ['1111', '2330', '1736', '1101', '9999'].map(code => EPS_PAGE.enrich({ code, name: '' }));
  const cmp = EPS_PAGE.sorts.find(([v]) => v === 'ahead')[2];
  assert.deepEqual(rows.sort(cmp).map(r => r.code), ['2330', '1111', '9999', '1736', '1101']);
});

test('這一頁只列有 EPS 的；說明寫出進度、超前或落後、去年同期', () => {
  assert.equal(EPS_PAGE.keep(EPS_PAGE.enrich({ code: '0050' })), false);
  assert.equal(EPS_PAGE.keep(EPS_PAGE.enrich({ code: '2330' })), true);
  const notes = EPS_PAGE.notes(Eps.info('2330'));
  assert.match(notes[0], /進度 50%（到第 2 季，每季 25%），超前 24%/);
  assert.match(notes[1], /同期（到第 2 季）29\.31，.{1,6}多 68%/); // 「今年」「去年」看執行的日期
  assert.match(EPS_PAGE.notes(Eps.info('1736'))[0], /落後 14%/);
  assert.match(EPS_PAGE.notes(Eps.info('9999'))[0], /剛好跟上/);
  assert.match(EPS_PAGE.notes(Eps.info('1101'))[0], /全年虧損（-1\.60），算不出達成率；.*已經賺 0\.38/);
  assert.match(EPS_PAGE.notes(Eps.info('7777'))[0], /算不出達成率/);
  // 去年賺不到 0.5 元：照算，多一句提醒
  assert.equal(Eps.info('3490').pct, 12300);
  assert.match(EPS_PAGE.notes(Eps.info('3490'))[1], /全年只賺 0\.05，基期很低/);
  assert.ok(!EPS_PAGE.notes(Eps.info('2330')).some(n => /基期/.test(n)));
});
