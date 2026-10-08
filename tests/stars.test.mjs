// 星星條件（js/stars.js 的 Stars）：node --test tests/
//   用瀏覽器載入的同一份程式（util.js、kd.js、stars.js 都是全域變數），放進同一個 vm 環境執行
//   r 是行情頁 enrich 過的一檔：y 殖利率、ya 暴力年化、info.trend、k、m（K、D、前一天的 K、D）、e（EPS：ahead 超前進度幾 %）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load(saved = {}) {
  const store = { ...saved };
  const localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const ctx = vm.createContext({ localStorage });
  for (const f of ['util', 'kd', 'stars']) {
    vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  }
  return { ...vm.runInContext('({ Stars, KD })', ctx), store };
}

const row = (o = {}) => ({ y: null, ya: null, info: null, k: null, m: null, e: null, ...o });
// vm 裡建立的陣列和這裡的原型不同，比較前先轉成一般的陣列
const keys = (Stars, r) => [...Stars.of(r).map(x => x.key)];

test('預設五個條件都打勾，殖利率至少 5%，EPS 超過進度就算', () => {
  const { Stars } = load();
  assert.equal(Stars.on().length, 5);
  assert.equal(Stars.yieldMin, 5);
  assert.equal(Stars.epsAhead, 0);
});

test('殖利率：剛好 5% 算達標，4.99% 不算；算不出來的不算', () => {
  const { Stars } = load();
  assert.deepEqual(keys(Stars, row({ y: 0.05 })), ['yield']);
  assert.deepEqual(keys(Stars, row({ y: 0.0499 })), []);
  assert.deepEqual(keys(Stars, row()), []);
});

test('暴力年化：最近一次比近一年平均多（紅色）才算', () => {
  const { Stars } = load();
  assert.deepEqual(keys(Stars, row({ ya: 0.06, info: { trend: 1 } })), ['trend']);
  assert.deepEqual(keys(Stars, row({ ya: 0.06, info: { trend: 0 } })), []);
  assert.deepEqual(keys(Stars, row({ ya: 0.06, info: { trend: -1 } })), []);
});

test('低檔：K 值低於 KD 標記的下限，改了下限跟著變', () => {
  const { Stars, KD } = load();
  assert.deepEqual(keys(Stars, row({ k: 24.9 })), ['kdLow']);
  assert.deepEqual(keys(Stars, row({ k: 25 })), []);
  KD.set(20, 80);
  assert.deepEqual(keys(Stars, row({ k: 24.9 })), []);
});

test('黃金交叉：前一天 K ≤ D、今天 K > D；預設只算低檔（D 值低於下限）', () => {
  const { Stars } = load();
  assert.equal(Stars.crossAt, 'low');
  assert.deepEqual(keys(Stars, row({ k: 26, m: { k: 26, d: 22, pk: 18, pd: 20 } })), ['golden']); // K 剛好超過 25 也算
  assert.deepEqual(keys(Stars, row({ k: 59, m: { k: 59, d: 55, pk: 49, pd: 52 } })), []); // 中間位置交叉不算
  assert.deepEqual(keys(Stars, row({ k: 26, m: { k: 26, d: 22, pk: 23, pd: 20 } })), []); // 昨天就在上面了
});

test('黃金交叉算哪個位置可以選：低檔和中間、任何位置', () => {
  const { Stars, KD } = load();
  const mid = row({ k: 59, m: { k: 59, d: 55, pk: 49, pd: 52 } });
  const high = row({ k: 90, m: { k: 90, d: 85, pk: 80, pd: 82 } });
  assert.equal(KD.crossAt(mid.m), 'mid');
  assert.equal(KD.crossAt(high.m), 'high');
  Stars.set({ crossAt: 'mid' });
  assert.deepEqual(keys(Stars, mid), ['golden']);
  assert.deepEqual(keys(Stars, high), []);
  Stars.set({ crossAt: 'any' });
  assert.deepEqual(keys(Stars, high), ['golden']);
  Stars.set({ crossAt: 'top' }); // 不在選項裡：不改
  assert.equal(Stars.crossAt, 'any');
});

test('五個都達標是五顆；沒打勾的條件不算，設定記在這台裝置', () => {
  const { Stars, store } = load();
  const r = row({ y: 0.07, ya: 0.08, info: { trend: 1 }, k: 20, m: { k: 20, d: 18, pk: 15, pd: 16 }, e: { ahead: 12 } }); // 低檔黃金交叉
  assert.equal(Stars.of(r).length, 5);
  Stars.set({ off: ['trend', 'golden'], yieldMin: 8, epsAhead: 10 });
  assert.deepEqual(keys(Stars, r), ['kdLow', 'eps']);
  assert.equal(Stars.has(r, 'trend'), false);
  const again = load(store).Stars;
  assert.equal(again.yieldMin, 8);
  assert.equal(again.epsAhead, 10);
  assert.deepEqual([...again.on().map(x => x.key)], ['yield', 'kdLow', 'eps']);
});

test('EPS：達成率超過進度才算（剛好跟上不算）；可以選要超前幾 % 以上', () => {
  const { Stars } = load();
  assert.deepEqual(keys(Stars, row({ e: { ahead: 1 } })), ['eps']);
  assert.deepEqual(keys(Stars, row({ e: { ahead: 0 } })), []);
  assert.deepEqual(keys(Stars, row({ e: { ahead: -14 } })), []);
  assert.deepEqual(keys(Stars, row({ e: { ahead: null } })), []); // 去年虧損、沒有去年全年
  assert.deepEqual(keys(Stars, row()), []); // ETF
  Stars.set({ epsAhead: 20 });
  assert.deepEqual(keys(Stars, row({ e: { ahead: 19 } })), []);
  assert.deepEqual(keys(Stars, row({ e: { ahead: 20 } })), ['eps']);
  assert.match(Stars.LIST.find(x => x.key === 'eps').label(), /超前進度 20% 以上/);
});

test('以前存的設定沒有 EPS 這一項：照預設打勾、超過就算，其他照舊', () => {
  const old = { 'stockbook.stars': JSON.stringify({ yieldMin: 6, crossAt: 'mid', off: ['trend'] }) };
  const { Stars } = load(old);
  assert.equal(Stars.yieldMin, 6);
  assert.equal(Stars.crossAt, 'mid');
  assert.equal(Stars.epsAhead, 0);
  assert.deepEqual([...Stars.on().map(x => x.key)], ['yield', 'kdLow', 'golden', 'eps']);
});

test('設定裡的數字不在選項裡時不改', () => {
  const { Stars } = load();
  Stars.set({ yieldMin: 4.5 });
  assert.equal(Stars.yieldMin, 5);
  Stars.set({ epsAhead: 7 });
  assert.equal(Stars.epsAhead, 0);
});
