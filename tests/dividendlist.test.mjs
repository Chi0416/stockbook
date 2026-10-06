// 公告的除權息（js/dividendlist.js，由 tools/update-dividends.mjs 產生）的格式：node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../js/dividendlist.js', import.meta.url), 'utf8'), ctx, { filename: 'dividendlist.js' });
const { updated, rows } = JSON.parse(JSON.stringify(vm.runInContext('DIVIDEND_LIST', ctx)));
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

test('ETF 和個股都有，個股上市、上櫃都有', () => {
  assert.ok(isDate(updated));
  assert.ok(rows.length > 1000, `${rows.length} 筆`);
  const codes = new Set(rows.map(r => r[0]));
  for (const code of ['0056', '00878', '2330', '2884']) assert.ok(codes.has(code), code);
  assert.ok([...codes].some(c => /^[3-8]\d{3}$/.test(c)), '應該有上櫃的個股');
});

test('每一筆：代號、名稱、除權息日、發放日、每股現金股利（大於 0）、每股股票股利', () => {
  for (const [code, name, exDate, payDate, cash, stock] of rows) {
    const what = `${code} ${exDate}`;
    assert.match(code, /^[0-9A-Z]{4,6}$/, what);
    assert.ok(name, what);
    assert.ok(isDate(exDate) && isDate(payDate) && payDate >= exDate, what);
    assert.ok(typeof cash === 'number' && cash > 0, what);
    assert.ok(typeof stock === 'number' && stock >= 0, what);
  }
});

test('同一檔同一天除權息只有一筆（更正公告用最新的）', () => {
  const keys = rows.map(r => `${r[0]} ${r[2]}`);
  assert.equal(new Set(keys).size, keys.length);
});
