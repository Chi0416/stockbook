// 試算表格式的測試：node --test tests/
//   用瀏覽器載入的同一份程式（util.js、schema.js、sheet.js 都是全域變數），放進同一個 vm 環境執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
for (const f of ['util', 'schema', 'sheet']) {
  const src = readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
  vm.runInContext(src, ctx, { filename: `${f}.js` });
}
const { Sheet } = vm.runInContext('({ Sheet })', ctx);

// vm 裡建立的物件和這裡的原型不同，比較前先轉成一般物件
const plain = v => JSON.parse(JSON.stringify(v));

const sample = () => ({
  members: [{ id: 'm1', name: '爸爸' }, { id: 'm2', name: '媽媽' }],
  trades: [
    { id: 't1', member: 'm1', date: '2026-09-01', type: '普買', code: '0050', name: '元大台灣50', shares: 1000, price: 96.5, amount: 96500, fee: 137, tax: 0 },
    { id: 't2', member: 'm2', date: '2026-09-15', type: '普賣', code: '00878', name: '國泰永續高股息', shares: 2000, price: 22.31, amount: 44620, fee: 63, tax: 44 },
  ],
  snapshots: [
    { id: 's1', member: 'm1', date: '2026-08-31', type: '現股', code: '0056', name: '元大高股息', shares: 42000, avgCost: 32.56, totalCost: 1367670, cumDividend: 434810 },
  ],
  dividends: [
    { id: 'd1', code: '00919', name: '群益台灣精選高息', exDate: '2026-09-16', payDate: '2026-10-15', cash: 0.866, stock: 0 },
    { id: 'd2', code: '0056', name: '元大高股息', exDate: '2026-07-16', payDate: '2026-08-12', cash: 1, stock: 0, baseShares: { m1: 30000, m2: 5000 } },
  ],
});

// 試算表讀回來時尾端空白格會被省略，模擬這個行為
const trimRows = values => values.map(row => {
  const r = [...row];
  while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === null)) r.pop();
  return r;
});
const asRead = byTitle => Object.fromEntries(Object.entries(byTitle).map(([k, v]) => [k, trimRows(v)]));

// 以全部寫出的資料為底，把某個分頁換成手動輸入的內容
function withTab(title, rows) {
  const v = asRead(plain(Sheet.toValues(sample())));
  v[title] = rows;
  return v;
}

test('日期序號：2023-03-15 是 45000，來回轉換不變', () => {
  assert.equal(Sheet.toSerial('2023-03-15'), 45000);
  assert.equal(Sheet.fromSerial(45000), '2023-03-15');
  for (const iso of ['1900-03-01', '2024-02-29', '2026-08-31', '2026-12-31']) {
    assert.equal(Sheet.fromSerial(Sheet.toSerial(iso)), iso);
  }
  assert.equal(Sheet.fromSerial(46265.75), '2026-08-31'); // 有時間的日期只取日期
});

test('寫出後再讀回，資料完全一樣', () => {
  const data = sample();
  const r = plain(Sheet.fromValues(asRead(plain(Sheet.toValues(data)))));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.idFixes, []);
  assert.deepEqual(r.newMembers, []);
  assert.deepEqual(r.data, plain(data));
});

test('寫出的格式：中文標題、成員寫名字、日期是序號、代號是文字、基準日股數寫名字', () => {
  const v = plain(Sheet.toValues(sample()));
  assert.deepEqual(v['交易明細'][0], ['成員', '成交日期', '交易別', '代號', '證券', '股數', '單價', '成交金額', '手續費', '證交稅款', 'id']);
  const t1 = v['交易明細'][1];
  assert.equal(t1[0], '爸爸');
  assert.equal(t1[1], Sheet.toSerial('2026-09-01'));
  assert.equal(t1[3], '0050');
  assert.equal(t1.at(-1), 't1');
  assert.equal(v['除權息'][2][6], '爸爸 30000、媽媽 5000');
  assert.equal(v['除權息'][1][6], ''); // 沒填基準日股數
  assert.deepEqual(v['成員'], [['名稱', 'id'], ['爸爸', 'm1'], ['媽媽', 'm2']]);
});

test('手動輸入：空白列略過、沒有 id 的列補上 id', () => {
  const r = plain(Sheet.fromValues(withTab('庫存快照', [
    ['成員', '快照日期', '交易別', '代號', '證券', '庫存餘額', '平均成本價格', '總投資成本', '累計配息', 'id'],
    [],
    ['', '', ''],
    ['媽媽', '2026/9/30', '現股', '00878', '國泰永續高股息', '1,000', '22.5', '22500', '0'],
  ])));
  assert.deepEqual(r.problems, []);
  assert.equal(r.data.snapshots.length, 1);
  const s = r.data.snapshots[0];
  assert.equal(s.member, 'm2');
  assert.equal(s.date, '2026-09-30');
  assert.equal(s.shares, 1000);
  assert.equal(s.avgCost, 22.5);
  assert.equal(r.idFixes.length, 1);
  assert.deepEqual({ ...r.idFixes[0], id: undefined }, { tab: '庫存快照', row: 4, col: 9, id: undefined });
  assert.equal(r.idFixes[0].id, s.id);
});

test('手動輸入：調換欄位順序、多出不認得的欄位也讀得到', () => {
  const r = plain(Sheet.fromValues(withTab('交易明細', [
    ['備註', '代號', '證券', '成交日期', '成員', '交易別', '股數', '單價', '成交金額', '手續費', '證交稅款', 'id'],
    ['長輩自己加的', '0050', '元大台灣50', Sheet.toSerial('2026-09-01'), '爸爸', '普買', 1000, 96.5, 96500, 137, 0, 't1'],
  ])));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.data.trades, [plain(sample().trades[0])]);
});

test('寫回一筆時依目前的標題列排列，不認得的欄位不動（null）', () => {
  const header = ['備註', '代號', '成員', 'id'];
  const row = plain(Sheet.encodeRow('trades', sample().trades[0], sample().members, header));
  assert.deepEqual(row, [null, '0050', '爸爸', 't1']);
});

test('手動輸入：新的成員名字自動新增', () => {
  const r = plain(Sheet.fromValues(withTab('交易明細', [
    Sheet.TAB.trades.headers,
    ['阿姨', Sheet.toSerial('2026-09-02'), '普買', '2330', '台積電', 10, 1000, 10000, 20, 0, 'x1'],
  ])));
  assert.deepEqual(r.problems, []);
  assert.equal(r.newMembers.length, 1);
  assert.equal(r.newMembers[0].name, '阿姨');
  assert.equal(r.data.trades[0].member, r.newMembers[0].id);
  assert.equal(r.data.members.length, 3);
});

test('看不懂的值記成問題，其他資料照常讀進來', () => {
  const r = plain(Sheet.fromValues(withTab('交易明細', [
    Sheet.TAB.trades.headers,
    ['爸爸', '2026/13/01', '普買', 50, '元大台灣50', '一千', 96.5, 96500, 137, 0, 'bad1'],
    ['', Sheet.toSerial('2026-09-03'), '普買', '0056', '元大高股息', 1000, 35, 35000, 50, '', 'bad2'],
  ])));
  const texts = r.problems.map(p => `${p.tab}第 ${p.row} 列：${p.msg}`);
  assert.deepEqual(texts, [
    '交易明細第 2 列：成交日期看不懂（2026/13/01）',
    '交易明細第 2 列：代號被存成數字 50，開頭的 0 可能不見了，請把這一欄設成純文字後重打',
    '交易明細第 2 列：股數不是數字（一千）',
    '交易明細第 3 列：成員空白，先算在「爸爸」名下',
    '交易明細第 3 列：證交稅款空白',
  ]);
  assert.equal(r.data.trades.length, 2);
  assert.equal(r.data.trades[0].code, '50');
  assert.equal(r.data.trades[0].date, null);
  assert.equal(r.data.trades[1].member, 'm1');
});

test('基準日股數：各種寫法', () => {
  const read = cell => {
    const r = plain(Sheet.fromValues(withTab('除權息', [
      Sheet.TAB.dividends.headers,
      ['0056', '元大高股息', Sheet.toSerial('2026-07-16'), Sheet.toSerial('2026-08-12'), 1, 0, cell, 'd1'],
    ])));
    return { value: r.data.dividends[0].baseShares, problems: r.problems.map(p => p.msg) };
  };
  assert.deepEqual(read('爸爸 30,000、媽媽 5000'), { value: { m1: 30000, m2: 5000 }, problems: [] });
  assert.deepEqual(read('爸爸：30000，媽媽：5000'), { value: { m1: 30000, m2: 5000 }, problems: [] }); // 全形冒號、逗號
  assert.deepEqual(read('爸爸30000\n媽媽 5000'), { value: { m1: 30000, m2: 5000 }, problems: [] });
  assert.deepEqual(read(''), { value: undefined, problems: [] });
  assert.deepEqual(read('叔叔 100'), { value: undefined, problems: ['基準日股數看不懂（叔叔 100）'] });
  assert.deepEqual(read(30000), { value: undefined, problems: ['基準日股數要寫成員名字，例如「爸爸 30000」'] });
});

test('只有一位成員時，基準日股數可以只寫數字', () => {
  const v = asRead(plain(Sheet.toValues({ ...sample(), members: [{ id: 'm1', name: '我' }], trades: [], snapshots: [] })));
  v['除權息'][1][6] = 12000;
  v['除權息'][2][6] = '15,000';
  const r = plain(Sheet.fromValues(v));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.data.dividends.map(d => d.baseShares), [{ m1: 12000 }, { m1: 15000 }]);
});

test('id 重複時，第二筆換新的 id', () => {
  const r = plain(Sheet.fromValues(withTab('除權息', [
    Sheet.TAB.dividends.headers,
    ['0056', 'A', Sheet.toSerial('2026-07-16'), Sheet.toSerial('2026-08-12'), 1, 0, '', 'd1'],
    ['0056', 'B', Sheet.toSerial('2026-10-16'), Sheet.toSerial('2026-11-12'), 1, 0, '', 'd1'],
  ])));
  const [a, b] = r.data.dividends;
  assert.equal(a.id, 'd1');
  assert.notEqual(b.id, 'd1');
  assert.deepEqual(r.idFixes.map(f => [f.row, f.id]), [[3, b.id]]);
});

test('股票股利空白時用預設值 0', () => {
  const r = plain(Sheet.fromValues(withTab('除權息', [
    Sheet.TAB.dividends.headers,
    ['0056', '元大高股息', Sheet.toSerial('2026-07-16'), Sheet.toSerial('2026-08-12'), 1, '', '', 'd1'],
  ])));
  assert.deepEqual(r.problems, []);
  assert.equal(r.data.dividends[0].stock, 0);
});

test('缺欄位、缺分頁、沒有 id 欄', () => {
  const v = asRead(plain(Sheet.toValues(sample())));
  delete v['除權息'];
  v['庫存快照'] = [['成員', '快照日期', '代號', '證券', '庫存餘額', '平均成本價格', '總投資成本', '累計配息']];
  const r = plain(Sheet.fromValues(v));
  assert.deepEqual(r.problems.map(Sheet.problemText), [
    '庫存快照第 1 列：找不到「交易別」欄，請把標題改回「交易別」',
    '除權息：找不到「除權息」分頁或分頁是空的',
  ]);
  assert.deepEqual(r.addIdHeader, [{ tab: '庫存快照', col: 8 }]);
  assert.equal(r.headers['庫存快照'][8], 'id');
  assert.deepEqual(r.data.dividends, []);
  assert.deepEqual(r.broken, ['snapshots', 'dividends']);
});

test('記錄每一筆在第幾列（空白列也算列號）', () => {
  const v = asRead(plain(Sheet.toValues(sample())));
  v['交易明細'].splice(2, 0, []); // t1 和 t2 中間插一列空白
  const r = plain(Sheet.fromValues(v));
  assert.deepEqual(r.rowOf['交易明細'], { t1: 2, t2: 4 });
  assert.deepEqual(r.rowOf['成員'], { m1: 2, m2: 3 });
  assert.deepEqual(r.headers['交易明細'], plain(Sheet.TAB.trades.headers));
  assert.deepEqual(r.broken, []);
});

test('欄位字母', () => {
  assert.deepEqual([0, 9, 25, 26, 27, 51, 52, 701, 702].map(Sheet.colLetter),
    ['A', 'J', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('補建單一分頁時，只產生那個分頁的格式設定', () => {
  const reqs = plain(Sheet.setupRequests({ 除權息: 777 }));
  const sheetIdOf = r => (r.repeatCell || r.setDataValidation || r.addProtectedRange.protectedRange).range.sheetId;
  assert.ok(reqs.length > 0);
  assert.ok(reqs.every(r => sheetIdOf(r) === 777));
});

test('完全空白的試算表：建立預設成員「我」', () => {
  const r = plain(Sheet.fromValues({ 成員: [['名稱', 'id']], 交易明細: [Sheet.TAB.trades.headers], 庫存快照: [Sheet.TAB.snapshots.headers], 除權息: [Sheet.TAB.dividends.headers] }));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.data.members, [{ id: 'me', name: '我' }]);
  assert.deepEqual(r.newMembers, [{ id: 'me', name: '我' }]);
});

test('建立試算表：分頁、格式、下拉選單、保護', () => {
  const body = plain(Sheet.createBody());
  assert.deepEqual(body.sheets.map(s => s.properties.title), ['交易明細', '庫存快照', '除權息', '成員', '_meta']);
  assert.equal(body.properties.locale, 'zh_TW');
  assert.equal(body.sheets.at(-1).properties.hidden, true);

  const reqs = plain(Sheet.setupRequests());
  const ids = new Set(body.sheets.map(s => s.properties.sheetId));
  const sheetIdOf = r => (r.repeatCell || r.setDataValidation || r.addProtectedRange.protectedRange).range.sheetId;
  reqs.forEach(r => assert.ok(ids.has(sheetIdOf(r)), JSON.stringify(r)));

  const trades = Sheet.TAB.trades.sheetId;
  const fmtOf = c => reqs.find(r => r.repeatCell?.range.sheetId === trades && r.repeatCell.range.startColumnIndex === c
    && r.repeatCell.fields === 'userEnteredFormat.numberFormat')?.repeatCell.cell.userEnteredFormat.numberFormat;
  assert.deepEqual(fmtOf(1), { type: 'DATE', pattern: 'yyyy/mm/dd' }); // 成交日期
  assert.deepEqual(fmtOf(3), { type: 'TEXT' });                         // 代號
  assert.deepEqual(fmtOf(6), { type: 'NUMBER', pattern: '#,##0.00##' }); // 單價
  assert.deepEqual(fmtOf(7), { type: 'NUMBER', pattern: '#,##0' });      // 成交金額

  const lists = reqs.filter(r => r.setDataValidation?.range.sheetId === trades).map(r => r.setDataValidation.rule);
  assert.ok(lists.every(rule => rule.strict === false));
  assert.ok(lists.some(rule => rule.condition.type === 'ONE_OF_LIST' && rule.condition.values.map(v => v.userEnteredValue).join() === '普買,普賣'));
  assert.equal(reqs.filter(r => r.addProtectedRange).length, 8); // 4 個分頁 × 標題列與 id 欄
  assert.ok(reqs.filter(r => r.addProtectedRange).every(r => r.addProtectedRange.protectedRange.warningOnly));
});

test('「成員」分頁不見時，用 App 現有的成員對回原本的 id', () => {
  const v = asRead(plain(Sheet.toValues(sample())));
  delete v['成員'];
  const r = plain(Sheet.fromValues(v, sample().members));
  assert.deepEqual(r.newMembers, []);
  assert.equal(r.data.trades[1].member, 'm2');
  assert.ok(r.broken.includes('members'));
});
