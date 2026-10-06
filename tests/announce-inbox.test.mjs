// 訊息匣比對公告的除權息（announced.js 的 diffs、missing，inbox.js 的 checkAnnounced）：node --test tests/*.test.mjs
//   App 的程式照瀏覽器的方式放進 vm 環境執行；公告資料用下面的假資料，日期從今天往前後推，哪天跑都一樣
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const day = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const LIST = {
  updated: day(0),
  rows: [
    ['0056', '元大高股息', day(16), day(36), null, 0], // 金額待公告
    ['0056', '元大高股息', day(-80), day(-60), 1.35, 0],
    ['0056', '元大高股息', day(-170), day(-150), 1, 0],
    ['0056', '元大高股息', day(-400), day(-380), 0.8, 0], // 超過 12 個月
    ['2480', '敦陽科', day(-110), day(-85), 7.8, 0],
    ['0050', '元大台灣50', day(-100), day(-80), 1, 0], // 家裡沒有
  ],
};

function app() {
  const ls = {};
  const ctx = vm.createContext({
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    alert: () => {},
  });
  const run = f => vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  ['util', 'schema', 'storage', 'holdings', 'views'].forEach(run);
  vm.runInContext(`const DIVIDEND_LIST = ${JSON.stringify(LIST)};`, ctx);
  ['announced', 'inbox'].forEach(run);
  return vm.runInContext('({ Store, Inbox, Announced })', ctx);
}

const plain = v => JSON.parse(JSON.stringify(v));
const open = (Inbox, prefix) => plain(Inbox.list()).filter(m => m.key.startsWith(prefix) && !m.resolved);

// 一年前買了 0056 和 2480
function family() {
  const t = app();
  t.Store.add('trades', { member: 'me', date: day(-300), type: '普買', code: '0056', name: '元大高股息', shares: 1000, price: 1, fee: 0, tax: 0, settle: 1000 });
  t.Store.add('trades', { member: 'me', date: day(-300), type: '普買', code: '2480', name: '敦陽科', shares: 1000, price: 1, fee: 0, tax: 0, settle: 1000 });
  return t;
}

test('還沒記的：近 12 個月、家裡當時持有、金額已公告的，新的在前，集中成一則勾選清單', () => {
  const { Inbox } = family();
  Inbox.checkData();
  const [m] = open(Inbox, 'announce-missing');
  assert.equal(m.title, '有 3 筆除權息可以帶入');
  assert.deepEqual(m.list.map(r => `${r.code} ${r.exDate} ${r.cash}`),
    [`0056 ${day(-80)} 1.35`, `2480 ${day(-110)} 7.8`, `0056 ${day(-170)} 1`]);
  assert.equal(m.list[0].name, '元大高股息'); // 用家裡記過的名稱
});

test('還沒記的：記了（日期差幾天也算）就不列；全部記了就標成已解決', () => {
  const { Store, Inbox } = family();
  Store.add('dividends', { code: '0056', name: '元大高股息', exDate: day(-82), payDate: day(-60), cash: 1.35, stock: 0 });
  Inbox.checkData();
  assert.deepEqual(open(Inbox, 'announce-missing')[0].list.map(r => r.exDate), [day(-110), day(-170)]);
  Store.add('dividends', { code: '2480', name: '敦陽科', exDate: day(-110), payDate: day(-85), cash: 7.8, stock: 0 });
  Store.add('dividends', { code: '0056', name: '元大高股息', exDate: day(-170), payDate: day(-150), cash: 1, stock: 0 });
  Inbox.checkData();
  assert.equal(open(Inbox, 'announce-missing').length, 0);
});

test('還沒記的：勾選的不用記，之後不再列', () => {
  const { Inbox, Announced } = family();
  Announced.keep([`missing:2480:${day(-110)}`]);
  Inbox.checkData();
  assert.deepEqual(open(Inbox, 'announce-missing')[0].list.map(r => r.code), ['0056', '0056']);
});

test('還沒記的：當時還沒買的不列', () => {
  const { Store, Inbox } = app();
  Store.add('trades', { member: 'me', date: day(-90), type: '普買', code: '0056', name: '元大高股息', shares: 1000, price: 1, fee: 0, tax: 0, settle: 1000 });
  Inbox.checkData();
  assert.deepEqual(open(Inbox, 'announce-missing')[0].list.map(r => r.exDate), [day(-80)]);
});

test('還沒記的：只有之後的庫存快照、沒有交易紀錄時不列（看不出當時買了沒）；快照之後的才列', () => {
  const { Store, Inbox } = app();
  Store.add('snapshots', { member: 'me', date: day(-90), type: '現股', code: '0056', name: '元大高股息', shares: 1000, avgCost: 1, totalCost: 1000 });
  Inbox.checkData();
  assert.deepEqual(open(Inbox, 'announce-missing')[0].list.map(r => r.exDate), [day(-80)]); // 快照之前的 -170 天不列
});

test('記的跟公告不一樣：寫出哪裡不一樣，附［改成公告的］［保留我的］', () => {
  const { Store, Inbox } = family();
  const d = Store.add('dividends', { code: '2480', name: '敦陽科', exDate: day(-110), payDate: day(-88), cash: 7.8, stock: 0 });
  Inbox.checkData();
  const [m] = open(Inbox, 'announce-diff:');
  assert.equal(m.title, '除權息和公告不一樣');
  assert.match(m.body, /發放日：你記的 .+，公告是 .+/);
  assert.doesNotMatch(m.body, /現金股利/); // 只寫不一樣的
  assert.deepEqual(m.buttons.map(b => b.label), ['改成公告的', '保留我的']);
  // 改成公告的
  Store.update('dividends', d.id, m.buttons[0].action.values);
  Inbox.checkData();
  assert.equal(open(Inbox, 'announce-diff:').length, 0);
  assert.equal(Store.get('dividends', d.id).payDate, day(-85));
});

test('記的跟公告不一樣：保留我的之後不再問；金額待公告的不比', () => {
  const { Store, Inbox, Announced } = family();
  Store.add('dividends', { code: '0056', name: '元大高股息', exDate: day(-80), payDate: day(-60), cash: 1.3, stock: 0 });
  Store.add('dividends', { code: '0056', name: '元大高股息', exDate: day(16), payDate: day(36), cash: 1.72, stock: 0 });
  Inbox.checkData();
  const list = open(Inbox, 'announce-diff:');
  assert.equal(list.length, 1); // 待公告的那一次不比
  assert.match(list[0].body, /每股現金股利：你記的 1.3，公告是 1.35/);
  Announced.keep(list[0].buttons[1].action.keys);
  Inbox.checkData();
  assert.equal(open(Inbox, 'announce-diff:').length, 0);
});
