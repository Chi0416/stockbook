// 現金單（js/cash.js 的 Cash，和 holdings.js 的投入、已提領、股利）：node --test tests/
//   App 的程式（util.js、schema.js、storage.js、holdings.js、cash.js）照瀏覽器的方式放進 vm 環境執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const FILES = ['util', 'schema', 'storage', 'holdings', 'cash'];

function app({ members = [{ id: 'me', name: '我' }], trades = [], snapshots = [], dividends = [] } = {}) {
  const ls = { 'stockbook.v1': JSON.stringify({ version: 1, members, trades, snapshots, dividends }) };
  const ctx = vm.createContext({
    localStorage: {
      getItem: k => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: k => { delete ls[k]; },
    },
  });
  for (const f of FILES) vm.runInContext(readFileSync(new URL(`js/${f}.js`, ROOT), 'utf8'), ctx, { filename: `${f}.js` });
  return vm.runInContext('({ Cash, Holdings })', ctx);
}

const { Cash } = app();
const plain = v => JSON.parse(JSON.stringify(v));

// 手續費 6 折當日折，整股最低 20 元、零股最低 1 元
const S = { discount: 6, rebate: '當日折', minFee: 20, oddMinFee: 1 };

test('證交稅：股票 0.3%，ETF、ETN 0.1%，債券 ETF 免稅（槓桿、反向的債券 ETF 照樣 0.1%）', () => {
  assert.equal(Cash.taxRate('2330'), 0.003);
  assert.equal(Cash.taxRate('0050'), 0.001);
  assert.equal(Cash.taxRate('006208'), 0.001);
  assert.equal(Cash.taxRate('00400A'), 0.001); // 主動式 ETF
  assert.equal(Cash.taxRate('020020'), 0.001); // ETN
  assert.equal(Cash.taxRate('00679b'), 0);     // 小寫也認得
  assert.equal(Cash.taxRate('00680L'), 0.001); // 美債 20 年正 2
});

test('手續費：0.1425% × 折數，元以下捨去；不足最低手續費收最低，整股、零股分開', () => {
  assert.equal(Cash.fee(100044, true, S), 85);   // 100,044 × 0.1425% × 0.6 = 85.54
  assert.equal(Cash.fee(1000, true, S), 1);      // 0.85 → 零股最低 1 元
  assert.equal(Cash.fee(10000, false, S), 20);   // 8.55 → 整股最低 20 元
  assert.equal(Cash.fee(0, true, S), 0);
  // 月退、沒有折扣（10 折）、沒填：都用原價
  assert.equal(Cash.fee(100044, true, { ...S, rebate: '月退' }), 142);
  assert.equal(Cash.fee(100044, true, { ...S, discount: 10 }), 142);
  assert.equal(Cash.fee(100044, true, { ...S, discount: null }), 142);
  // 1,000,000 × 0.1425% × 0.28 = 399，浮點數算出來是 398.99999…，不能少算 1 元
  assert.equal(Cash.fee(1000000, false, { ...S, discount: 2.8 }), 399);
});

test('全部賣掉：1,200 股是整張一筆、零股 200 股一筆，手續費和證交稅各算', () => {
  const r = plain(Cash.sell(1200, 198.5, '0050', S));
  assert.deepEqual(r, { shares: 1200, lots: 1000, odd: 200, amount: 238200, fee: 169 + 33, tax: 198 + 39, net: 237761 });
});

test('提領 10 萬：實拿不超過 10 萬的最多股數', () => {
  const r = plain(Cash.plan(100000, 1200, 198.5, '0050', S));
  assert.deepEqual(r, { shares: 504, lots: 0, odd: 504, amount: 100044, fee: 85, tax: 100, net: 99859, all: false });
  assert.ok(Cash.sell(505, 198.5, '0050', S).net > 100000);
});

test('提領 20 萬：超過一張時整張和零股分開算，還是不超過 20 萬', () => {
  const r = Cash.plan(200000, 1200, 198.5, '0050', S);
  assert.equal(r.lots, 1000);
  assert.ok(r.net <= 200000);
  assert.ok(Cash.sell(r.shares + 1, 198.5, '0050', S).net > 200000);
});

test('不夠提：全部賣掉還不到；一股都不夠時 0 股', () => {
  const all = Cash.plan(300000, 1200, 198.5, '0050', S);
  assert.equal(all.all, true);
  assert.equal(all.shares, 1200);
  assert.equal(all.net, 237761);
  assert.equal(Cash.plan(100, 1200, 198.5, '0050', S).shares, 0);
});

test('個股的證交稅 0.3%', () => {
  const r = plain(Cash.plan(100000, 1000, 1000, '2330', S));
  assert.deepEqual(r, { shares: 100, lots: 0, odd: 100, amount: 100000, fee: 85, tax: 300, net: 99615, all: false });
  assert.ok(Cash.sell(101, 1000, '2330', S).net > 100000);
});

let n = 0;
const trade = (date, type, code, shares, settle) => ({ id: `t${++n}`, member: 'me', date, type, code, name: code, shares, settle });

test('投入、已提領、股利：從 0 開始加總交易和除息', () => {
  const { Holdings } = app({
    trades: [
      trade('2026-01-05', '普買', '0050', 1000, 150213),
      trade('2026-03-02', '普買', '0050', 200, 32046),
      trade('2026-08-03', '普賣', '0050', 100, 19780),
    ],
    dividends: [{ id: 'd1', code: '0050', name: '元大台灣50', exDate: '2026-07-16', payDate: '2026-08-08', cash: 1, stock: 0 }],
  });
  const p = Holdings.position('me', '0050', '2026-10-08', true);
  assert.deepEqual([p.shares, p.paid, p.got, p.divs], [1100, 150213 + 32046, 19780, 1200]);
});

test('有快照時：投入從快照的付出成本算起，快照之前的交易不算', () => {
  const { Holdings } = app({
    trades: [
      trade('2026-01-05', '普買', '0050', 1000, 150213),
      trade('2026-09-10', '普買', '0050', 100, 19028),
    ],
    snapshots: [{ id: 's1', member: 'me', date: '2026-06-30', type: '現股', code: '0050', name: '元大台灣50', shares: 1000, totalCost: 149000 }],
  });
  const p = Holdings.position('me', '0050', '2026-10-08', true);
  assert.deepEqual([p.shares, p.paid, p.got, p.divs, p.snapDate], [1100, 149000 + 19028, 0, 0, '2026-06-30']);
});
