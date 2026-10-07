// 即將除權息（js/upcoming.js 的 Upcoming.list）：node --test tests/
//   用瀏覽器載入的同一份程式（util.js、announced.js、upcoming.js 都是全域變數），放進同一個 vm 環境執行
//   公告的除權息用下面這份假的資料（DIVIDEND_LIST），自己記的除權息直接傳進 list
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const DIVIDEND_LIST = {
  updated: '2026-10-07',
  rows: [
    ['0056', '元大高股息', '2026-10-22', '2026-11-11', null, 0],      // 金額待公告
    ['0056', '元大高股息', '2026-07-21', '2026-08-10', 1.35, 0],      // 已經過了
    ['00922', '國泰台灣領袖50', '2026-10-19', '2026-11-12', 2.1, 0],
    ['00929', '復華台灣科技優息', '2026-10-07', '2026-11-03', 0.38, 0], // 今天
    ['00878', '國泰永續高股息', '2026-11-18', '2026-12-12', 0.5, 0],  // 超過 30 天
    ['1101', '台泥', '2026-10-20', '2026-11-10', 0.5, 0.2],           // 配息又配股
  ],
};

const ctx = vm.createContext({ DIVIDEND_LIST, localStorage: { getItem: () => null, setItem() {} } });
for (const f of ['util', 'announced', 'upcoming']) {
  const src = readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
  vm.runInContext(src, ctx, { filename: `${f}.js` });
}
const { Upcoming } = vm.runInContext('({ Upcoming })', ctx);

// vm 裡建立的物件和這裡的原型不同，比較前先轉成一般物件
const plain = v => JSON.parse(JSON.stringify(v));
const list = (codes, own = []) => plain(Upcoming.list(codes, { today: '2026-10-07', own }));

test('今天到 30 天後要除權息的，依日期排；已經過了、超過 30 天的不列', () => {
  const r = list(['0056', '00922', '00929', '00878', '1101']);
  assert.deepEqual(r.map(x => `${x.exDate} ${x.code}`), ['2026-10-07 00929', '2026-10-19 00922', '2026-10-20 1101', '2026-10-22 0056']);
  assert.equal(r.find(x => x.code === '1101').stock, 0.2);
});

test('只列傳進來的代號（持股和觀察清單），小寫、全形也認得', () => {
  assert.deepEqual(list(['００９２２']).map(x => x.code), ['00922']);
  assert.deepEqual(list(['xyz']), []);
});

test('公告的金額還沒出來：用自己記的，標出是自己記的；都沒有時是 null', () => {
  assert.equal(list(['0056'])[0].cash, null);
  const own = [{ code: '0056', exDate: '2026-10-21', cash: 1.72 }]; // 和公告的 10/22 差一天，算同一次
  const r = list(['0056'], own);
  assert.equal(r.length, 1);
  assert.equal(r[0].exDate, '2026-10-22');
  assert.equal(r[0].cash, 1.72);
  assert.equal(r[0].own, true);
});

test('公告資料裡沒有的（上櫃 ETF）：自己記了就列出來', () => {
  const own = [
    { code: '00679B', exDate: '2026-10-16', payDate: '2026-11-12', cash: 0.37 },
    { code: '00679B', exDate: '2026-07-16', cash: 0.37 }, // 已經過了
  ];
  assert.deepEqual(list(['00679B'], own), [
    { code: '00679B', exDate: '2026-10-16', payDate: '2026-11-12', cash: 0.37, stock: 0, own: true },
  ]);
});
