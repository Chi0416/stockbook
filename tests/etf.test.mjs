// ETF 成分股（etf.js）：一檔股票被哪幾檔 ETF 持有（行情的 ETF 頁用）：node --test tests/
//   用瀏覽器載入的同一份程式（util.js、etf.js 都是全域變數），放進同一個 vm 環境執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// vm 裡建出來的陣列和這裡的不是同一種，比較前先換成一般的資料
const plain = v => JSON.parse(JSON.stringify(v));

const ETF_LIST = {
  etfs: {
    '0056': { name: '元大高股息', source: '元大投信', date: '2026-10-15', url: 'https://x', holdings: [['1303', 10], ['2330', 2]] },
    '0050': { name: '元大台灣50', source: '元大投信', date: '2026-10-15', url: 'https://x', holdings: [['2330', 57], ['1303', 1.5]] },
    '00878': { name: '國泰永續高股息', source: '國泰投信', date: '2026-10-14', url: 'https://x', holdings: [['2891', 10]] },
  },
};

function app() {
  const store = new Map();
  const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const ctx = vm.createContext({ ETF_LIST, localStorage });
  for (const f of ['util', 'etf']) vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  return vm.runInContext('({ Etf })', ctx);
}

test('被哪幾檔 ETF 持有：權重大的在前', () => {
  const { Etf } = app();
  assert.deepEqual(plain(Etf.holders('2330').map(x => [x.code, x.weight])), [['0050', 57], ['0056', 2]]);
  assert.deepEqual(plain(Etf.holders('1303').map(x => x.code)), ['0056', '0050']);
  assert.deepEqual(plain(Etf.holders('2891').map(x => x.name)), ['國泰永續高股息']);
  assert.deepEqual([...Etf.holders('9999')], []);
});

test('可以選的 ETF 照代號排；記住選的那一檔，不在資料裡時用第一檔', () => {
  const { Etf } = app();
  assert.deepEqual(plain(Etf.list().map(e => e.code)), ['0050', '0056', '00878']);
  assert.equal(Etf.current().code, '0050');
  Etf.select('00878');
  assert.equal(Etf.current().code, '00878');
  Etf.select('00999');
  assert.equal(Etf.current().code, '0050');
});
