// 股票搜尋（js/stocksearch.js）：表單「股票」欄打字時的候選、打完之後認出是哪一檔：node --test tests/*.test.mjs
//   用瀏覽器載入的同一份程式（util.js、stocklist.js、stocksearch.js 都是全域變數），放進同一個 vm 環境執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
for (const f of ['util', 'stocklist', 'stocksearch']) {
  vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
}
const StockSearch = vm.runInContext('StockSearch', ctx);
const plain = v => JSON.parse(JSON.stringify(v));
const codes = list => plain(list).map(p => p.code);

test('搜尋：名稱裡有這幾個字', () => {
  assert.deepEqual(plain(StockSearch.search('台積')), [{ code: '2330', name: '台積電' }]);
  const r = codes(StockSearch.search('高股息'));
  assert.equal(r.length, 8); // 最多 8 個
  assert.deepEqual(r.slice(0, 2), ['0056', '00878']); // 依代號排
});

test('搜尋：代號開頭相同，完全相同的排第一個；全形、小寫也找得到', () => {
  assert.deepEqual(codes(StockSearch.search('233')).slice(0, 3), ['2330', '2331', '2332']);
  assert.equal(codes(StockSearch.search('0056'))[0], '0056');
  assert.equal(codes(StockSearch.search('００５６'))[0], '0056');
  assert.equal(codes(StockSearch.search('00679b'))[0], '00679B');
});

test('搜尋：名稱開頭相同的排在名稱中間有這幾個字的前面', () => {
  const r = plain(StockSearch.search('玉山'));
  assert.equal(r[0].name.startsWith('玉山'), true);
  assert.ok(r.every(p => p.name.includes('玉山')));
});

test('搜尋：自己記過的排最前面，用自己的寫法，不會重複', () => {
  const own = [{ code: '00878', name: '國泰高股息' }];
  const r = plain(StockSearch.search('高股息', own));
  assert.deepEqual(r[0], { code: '00878', name: '國泰高股息' });
  assert.equal(r.filter(p => p.code === '00878').length, 1);
});

test('搜尋：空白不列出', () => {
  assert.deepEqual(plain(StockSearch.search('  ')), []);
});

test('認出是哪一檔：代號、完整名稱、「代號 名稱」', () => {
  assert.deepEqual(plain(StockSearch.resolve('2330')), { code: '2330', name: '台積電' });
  assert.deepEqual(plain(StockSearch.resolve(' ２３３０ ')), { code: '2330', name: '台積電' });
  assert.deepEqual(plain(StockSearch.resolve('台積電')), { code: '2330', name: '台積電' });
  assert.deepEqual(plain(StockSearch.resolve('2330 台積電')), { code: '2330', name: '台積電' }); // 和按鈕上的字一樣
  assert.deepEqual(plain(StockSearch.resolve('2330 台積')), { code: '2330', name: '台積電' }); // 認得的代號用認得的名稱
  assert.equal(StockSearch.resolve('00999Z'), null); // 清單裡沒有的代號，只打代號認不出來
  assert.deepEqual(plain(StockSearch.resolve('00999z 新ETF')), { code: '00999Z', name: '新ETF' }); // 打「代號 名稱」就可以
});

test('認出是哪一檔：只打一半、對到好幾檔、空白都認不出來', () => {
  assert.equal(StockSearch.resolve('台積'), null);
  assert.equal(StockSearch.resolve('233'), null);
  assert.equal(StockSearch.resolve(''), null);
  assert.equal(StockSearch.resolve('不存在的股票'), null);
});

test('認出是哪一檔：自己記過的優先（清單裡沒有的舊股票也認得）', () => {
  const own = [{ code: '9999', name: '舊股票' }, { code: '0056', name: '高股息ETF' }];
  assert.deepEqual(plain(StockSearch.resolve('9999', own)), { code: '9999', name: '舊股票' });
  assert.deepEqual(plain(StockSearch.resolve('舊股票', own)), { code: '9999', name: '舊股票' });
  assert.deepEqual(plain(StockSearch.resolve('0056', own)), { code: '0056', name: '高股息ETF' });
});
