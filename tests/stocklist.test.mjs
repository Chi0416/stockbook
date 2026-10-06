// 股票清單（js/stocklist.js，由 tools/update-stocklist.mjs 產生）與代號查不到時的提醒：node --test tests/
//   用瀏覽器載入的同一份程式（util.js、stocklist.js、schema.js 都是全域變數），放進同一個 vm 環境執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 自己記過的資料：清單裡沒有的 9999（例如已經下市）也算認得
const records = { trades: [{ code: '9999', name: '舊股票' }], snapshots: [], dividends: [] };
const ctx = vm.createContext({ Store: { list: t => records[t] } });
for (const f of ['util', 'stocklist', 'schema']) {
  const src = readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
  vm.runInContext(src, ctx, { filename: `${f}.js` });
}
const { STOCK_LIST, codeNote } = vm.runInContext('({ STOCK_LIST, codeNote })', ctx);

test('清單：上市、上櫃、興櫃的股票和 ETF 都有，不含權證', () => {
  assert.match(STOCK_LIST.updated, /^\d{4}-\d{2}-\d{2}$/);
  const n = Object.keys(STOCK_LIST.names).length;
  assert.ok(n > 2000 && n < 5000, `${n} 檔`); // 權證有好幾萬檔，混進來會遠超過 5000
  const expect = { '0050': '元大台灣50', '0056': '元大高股息', '2330': '台積電', '006208': '富邦台50', '00679B': '元大美債20年' };
  for (const [code, name] of Object.entries(expect)) assert.equal(STOCK_LIST.names[code], name, code);
});

test('清單：代號是 4～6 碼的數字或大寫英文，名稱沒有多餘的空白', () => {
  for (const [code, name] of Object.entries(STOCK_LIST.names)) {
    assert.match(code, /^[0-9A-Z]{4,6}$/, code);
    assert.ok(name && name === name.trim() && !/\s{2}|　/.test(name), `${code}「${name}」`);
  }
});

test('提醒：清單或自己記過的資料裡查不到才提醒，打到 4 碼才檢查', () => {
  assert.equal(codeNote({ code: '0056' }), '');
  assert.equal(codeNote({ code: '００５６' }), ''); // 全形
  assert.equal(codeNote({ code: '00679b' }), ''); // 小寫
  assert.equal(codeNote({ code: '9999' }), ''); // 清單裡沒有，但自己記過
  assert.equal(codeNote({ code: '005' }), ''); // 還在打字
  assert.equal(codeNote({ code: '' }), '');
  assert.match(codeNote({ code: '0065' }), /查不到/);
});
