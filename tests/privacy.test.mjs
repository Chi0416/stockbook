// 隱藏金額（js/privacy.js）的測試：node --test tests/*.test.mjs
//   用瀏覽器載入的同一份程式（都是全域變數），放進 vm 環境執行；localStorage 用一個物件代替
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const KEY = 'stockbook.hideAmounts';

// 載入 util.js、privacy.js（和其他要測的檔案），saved 是 localStorage 裡原本存的值
function load(saved, files = []) {
  const store = new Map(saved == null ? [] : [[KEY, saved]]);
  const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const ctx = vm.createContext({ localStorage });
  for (const f of ['util', 'privacy', ...files]) {
    vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  }
  return { ctx, store, Privacy: vm.runInContext('Privacy', ctx) };
}

test('預設顯示金額；上次選了隱藏，下次打開維持隱藏', () => {
  assert.equal(load(null).Privacy.hidden, false);
  assert.equal(load('1').Privacy.hidden, true);
  assert.equal(load('0').Privacy.hidden, false);
});

test('切換：記在這台裝置，並通知重畫畫面', () => {
  const { Privacy, store } = load(null);
  const seen = [];
  Privacy.onChange(h => seen.push(h));
  Privacy.toggle();
  assert.equal(Privacy.hidden, true);
  assert.equal(store.get(KEY), '1');
  Privacy.set(false);
  assert.equal(store.get(KEY), '0');
  assert.deepEqual(seen, [true, false]);
});

test('數字：隱藏時不管幾位數都是 ＊＊＊，空白照常', () => {
  const { Privacy } = load('1');
  assert.equal(Privacy.num('1,367,670'), '＊＊＊');
  assert.equal(Privacy.num('51'), '＊＊＊');
  assert.equal(Privacy.num(''), '');
  assert.equal(load('0').Privacy.num('1,367,670'), '1,367,670');
});

test('說明文字：股數換成 ＊＊＊，日期和「從 0 開始」照常', () => {
  const { Privacy } = load('1');
  assert.equal(Privacy.text('股數 = 2026/08/31 快照 42,000 + 買進 1,000 − 賣出 500'),
    '股數 = 2026/08/31 快照 ＊＊＊ + 買進 ＊＊＊ − 賣出 ＊＊＊');
  assert.equal(Privacy.text('從 0 開始 + 買進 2,000'), '從 0 開始 + 買進 ＊＊＊');
  assert.equal(Privacy.text('核對不符：推算 1,000 股，快照是 1,500.5 股'), '核對不符：推算 ＊＊＊ 股，快照是 ＊＊＊ 股');
  assert.equal(Privacy.text('基準日股數為手動輸入'), '基準日股數為手動輸入');
  // 股票代號照常（股數一千以上一定有逗號，四碼以上沒有逗號的是代號）
  assert.equal(Privacy.text('爸爸 0056 元大高股息（2026/09/30 快照）：推算 43,000 股，快照是 500 股'),
    '爸爸 0056 元大高股息（2026/09/30 快照）：推算 ＊＊＊ 股，快照是 ＊＊＊ 股');
  // 名稱裡的數字照常
  assert.equal(Privacy.text('2884 玉山金、00679B 元大美債20年、0050 元大台灣50：推算 1,000 股'),
    '2884 玉山金、00679B 元大美債20年、0050 元大台灣50：推算 ＊＊＊ 股');
  // 算出負數時連負號一起換掉
  assert.equal(Privacy.text('推算 -500 股（從 0 開始 − 賣出 500）'), '推算 ＊＊＊ 股（從 0 開始 − 賣出 ＊＊＊）');
  const shown = load('0').Privacy;
  assert.equal(shown.text('快照 42,000'), '快照 42,000');
});

test('統計：隱藏時金額和佔比都是 ＊＊＊，長條圖照畫', () => {
  const { ctx } = load('1', ['stats']);
  const Stats = vm.runInContext('Stats', ctx);
  const row = (code, name, payDate, net) => ({ id: `${code}-${payDate}`, code, name, payDate, net, member: 'm1' });
  const rows = [row('0056', '元大高股息', '2026-08-12', 3000), row('2884', '玉山金', '2026-08-20', 1200)];
  const cfg = { label: '股息', ranking: '股息來源排行', amount: 'net', date: 'payDate', code: 'code', name: 'name' };
  const html = Stats.html(cfg, {
    rows, context: rows, period: '2026', isPending: () => false, members: [{ id: 'm1', name: '爸爸' }], showMembers: false,
  });
  const shown = html.replace(/<[^>]+>/g, ' '); // 畫面上看得到的文字（長條圖的寬度寫在 style 裡，不算）
  assert.ok(!/3,000|1,200|4,200|\d+%/.test(shown), shown);
  assert.ok(shown.includes('＊＊＊'));
  assert.ok(html.includes('class="bar"'));
  assert.ok(html.includes('元大高股息'));
});
