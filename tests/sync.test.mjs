// 同步流程的測試：node --test tests/*.test.mjs
//   用一個模擬的 Google 雲端硬碟＋試算表（FakeGoogle，存在記憶體裡）代替真的 Google
//   App 的程式（storage.js、sheet.js、google.js、sync.js）照瀏覽器的方式放進 vm 環境執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ---------- 模擬的 Google API ----------
class FakeGoogle {
  constructor() {
    this.files = {}; // id → { appProperties, trashed, sheets: [{ sheetId, title, grid }] }
    this.n = 0;
    this.calls = [];
    this.onBatchGet = null; // 讀取時插入的動作（模擬同步途中使用者又改了資料）
  }

  // 'title'!A5、'title'!A:ZZ、title
  static parseRange(r) {
    const m = r.match(/^(?:'((?:[^']|'')+)'|([^!]+))(?:!([A-Z]+)(\d+)?(?::[A-Z]+\d*)?)?$/);
    const col = (m[3] || 'A').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return { title: (m[1] || m[2]).replace(/''/g, "'"), col, row: m[4] ? Number(m[4]) - 1 : 0 };
  }

  sheet(id, title) {
    return this.files[id].sheets.find(s => s.title === title);
  }

  // 試算表讀回來的樣子：空字串是空格，尾端的空格與空列省略
  static read(grid) {
    const rows = grid.map(r => {
      const out = (r || []).map(v => (v === undefined || v === null ? '' : v));
      while (out.length && out.at(-1) === '') out.pop();
      return out;
    });
    while (rows.length && !rows.at(-1).length) rows.pop();
    return rows;
  }

  write(id, range, values) {
    const { title, col, row } = FakeGoogle.parseRange(range);
    const grid = this.sheet(id, title).grid;
    values.forEach((vals, i) => {
      grid[row + i] ||= [];
      vals.forEach((v, j) => { if (v !== null && v !== undefined) grid[row + i][col + j] = v; });
    });
  }

  // 直接改試算表（模擬長輩在 Google 試算表裡手動修改）
  values(id, title) {
    return FakeGoogle.read(this.sheet(id, title).grid);
  }

  setCell(id, title, row, col, v) {
    const grid = this.sheet(id, title).grid;
    grid[row - 1] ||= [];
    grid[row - 1][col] = v;
  }

  appendRow(id, title, row) {
    this.sheet(id, title).grid.push(row);
  }

  fetch = async (url, opts = {}) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    this.calls.push(`${method} ${decodeURIComponent(u.pathname)}`);
    const ok = json => ({ status: 200, ok: true, text: async () => JSON.stringify(json) });
    const notFound = () => ({ status: 404, ok: false, text: async () => JSON.stringify({ error: { message: 'not found' } }) });
    const path = decodeURIComponent(u.pathname);

    if (path === '/drive/v3/about') return ok({ user: { emailAddress: 'test@example.com' } });
    if (path === '/drive/v3/files') {
      const files = Object.entries(this.files)
        .filter(([, f]) => f.appProperties?.stockbook === '1' && !f.trashed)
        .map(([id]) => ({ id }));
      return ok({ files });
    }
    let m = path.match(/^\/drive\/v3\/files\/(.+)$/);
    if (m) {
      const f = this.files[m[1]];
      if (!f) return notFound();
      if (method === 'PATCH') f.appProperties = { ...f.appProperties, ...body.appProperties };
      return ok({ id: m[1], trashed: !!f.trashed });
    }
    if (path === '/v4/spreadsheets' && method === 'POST') {
      const id = `sheet${++this.n}`;
      this.files[id] = { sheets: body.sheets.map(s => ({ sheetId: s.properties.sheetId, title: s.properties.title, grid: [] })) };
      return ok({ spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}` });
    }
    m = path.match(/^\/v4\/spreadsheets\/([^/:]+)(.*)$/);
    if (!m) throw new Error(`未模擬的網址 ${url}`);
    const [, id, rest] = m;
    const f = this.files[id];
    if (!f) return notFound();

    if (rest === '' && method === 'GET') {
      return ok({
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}`,
        sheets: f.sheets.map(s => ({ properties: { sheetId: s.sheetId, title: s.title } })),
      });
    }
    if (rest === ':batchUpdate') {
      const replies = body.requests.map(r => {
        if (r.addSheet) {
          const sheetId = 1000 + (++this.n);
          f.sheets.push({ sheetId, title: r.addSheet.properties.title, grid: [] });
          return { addSheet: { properties: { sheetId, title: r.addSheet.properties.title } } };
        }
        if (r.deleteDimension) {
          const { sheetId, startIndex, endIndex } = r.deleteDimension.range;
          f.sheets.find(s => s.sheetId === sheetId).grid.splice(startIndex, endIndex - startIndex);
        }
        return {};
      });
      return ok({ replies });
    }
    if (rest === '/values:batchClear') {
      body.ranges.forEach(r => { this.sheet(id, FakeGoogle.parseRange(r).title).grid = []; });
      return ok({});
    }
    if (rest === '/values:batchUpdate') {
      body.data.forEach(d => this.write(id, d.range, d.values));
      return ok({});
    }
    if (rest === '/values:batchGet') {
      if (this.onBatchGet) { const fn = this.onBatchGet; this.onBatchGet = null; fn(); }
      const ranges = u.searchParams.getAll('ranges');
      return ok({ valueRanges: ranges.map(r => ({ values: this.values(id, FakeGoogle.parseRange(r).title) })) });
    }
    m = rest.match(/^\/values\/(.+):append$/);
    if (m) {
      const grid = this.sheet(id, FakeGoogle.parseRange(m[1]).title).grid;
      const last = FakeGoogle.read(grid).length;
      body.values.forEach((row, i) => { grid[last + i] = row.map(v => (v === null ? undefined : v)); });
      return ok({});
    }
    throw new Error(`未模擬的網址 ${method} ${url}`);
  };
}

// ---------- 載入 App ----------
const ROOT = new URL('../', import.meta.url);
const FILES = ['util', 'schema', 'storage', 'config', 'google', 'sheet', 'sync'];

// 每個測試一個全新的裝置：localStorage、權杖、Google 都是新的
function device(fake, { storage = {}, token = true, confirmAnswer = true } = {}) {
  const ls = { ...storage };
  const toasts = [];
  const asked = { answer: confirmAnswer, messages: [] };
  const ctx = vm.createContext({
    localStorage: {
      getItem: k => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: k => { delete ls[k]; },
    },
    alert: () => {},
    confirm: msg => { asked.messages.push(msg); return asked.answer; },
    setTimeout: () => 0, // 自動同步的計時器不執行，測試裡直接呼叫同步
    clearTimeout: () => {},
    fetch: fake.fetch,
    URLSearchParams,
    location: { origin: 'http://localhost:8765', pathname: '/', search: '', hash: '', assign() {} },
    history: { replaceState() {} },
    document: { hidden: false, addEventListener() {} },
  });
  ctx.window = ctx;
  ctx.window.addEventListener = () => {};
  // Google 登入元件：按下登入就直接成功
  ctx.google = {
    accounts: {
      oauth2: {
        initTokenClient: cfg => ({ requestAccessToken: () => cfg.callback({ access_token: 'fake', expires_in: 3600 }) }),
        hasGrantedAllScopes: () => true,
        revoke: () => {},
      },
    },
  };
  if (token) ls['stockbook.google.token'] = JSON.stringify({ accessToken: 'fake', expiresAt: Date.now() + 3600e3 });
  for (const f of FILES) vm.runInContext(readFileSync(new URL(`js/${f}.js`, ROOT), 'utf8'), ctx, { filename: `${f}.js` });
  const app = vm.runInContext('({ Store, Sync, Sheet })', ctx);
  app.Sync.init({ toast: (msg, kind) => toasts.push(kind ? `${kind}:${msg}` : msg) });
  return { ...app, ls, toasts, asked };
}

const plain = v => JSON.parse(JSON.stringify(v));
const TRADE = { member: 'me', date: '2026-09-01', type: '普買', code: '0050', name: '元大台灣50', shares: 1000, price: 96.5, amount: 96500, fee: 137, tax: 0 };

// 連結後的第一台裝置，已有一筆快照
async function linked(fake = new FakeGoogle()) {
  const d = device(fake);
  d.Store.add('snapshots', { member: 'me', date: '2026-08-31', type: '現股', code: '0056', name: '元大高股息', shares: 42000, avgCost: 32.56, totalCost: 1367670, cumDividend: 434810 });
  await d.Sync.startLink();
  const id = d.Sync.state().url.split('/').pop();
  return { fake, d, id };
}

test('連結：雲端沒有試算表時建立一份，寫入這台裝置的資料', async () => {
  const { fake, d, id } = await linked();
  const st = d.Sync.state();
  assert.equal(st.linked, true);
  assert.equal(st.email, 'test@example.com');
  assert.equal(st.pending, 0);
  assert.equal(st.error, '');
  assert.ok(d.toasts.includes('已連結 Google 帳號'));
  assert.deepEqual(fake.files[id].appProperties, { stockbook: '1' });
  assert.deepEqual(fake.values(id, '庫存快照')[1].slice(0, 5), ['我', d.Sheet.toSerial('2026-08-31'), '現股', '0056', '元大高股息']);
  assert.deepEqual(fake.values(id, '成員'), [['名稱', 'id'], ['我', 'me']]);
  assert.deepEqual(fake.values(id, '_meta'), [['version', 1]]);
});

test('新增、修改、刪除都寫回試算表的同一列', async () => {
  const { fake, d, id } = await linked();
  const t = d.Store.add('trades', TRADE);
  assert.equal(d.Sync.state().pending, 1);
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 0);
  let rows = fake.values(id, '交易明細');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].at(-1), t.id);

  d.Store.update('trades', t.id, { shares: 2000 });
  await d.Sync.syncNow();
  rows = fake.values(id, '交易明細');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][5], 2000);

  d.Store.remove('trades', t.id);
  await d.Sync.syncNow();
  assert.equal(fake.values(id, '交易明細').length, 1);
  assert.equal(d.Sync.state().pending, 0);
});

test('長輩在試算表裡修改、新增（沒有 id、新的成員名字），同步後 App 也有', async () => {
  const { fake, d, id } = await linked();
  fake.setCell(id, '庫存快照', 2, 5, 43000); // 改庫存餘額
  fake.appendRow(id, '交易明細', ['媽媽', '2026/9/10', '普買', '00878', '國泰永續高股息', 1000, 22.5, 22500, 32, 0]);
  await d.Sync.syncNow();

  assert.equal(d.Store.list('snapshots', 'all')[0].shares, 43000);
  const trades = d.Store.list('trades', 'all');
  assert.equal(trades.length, 1);
  assert.equal(trades[0].date, '2026-09-10');
  const mom = d.Store.members().find(m => m.name === '媽媽');
  assert.ok(mom);
  assert.equal(trades[0].member, mom.id);
  // 試算表補上 id，「成員」分頁加上媽媽
  assert.equal(fake.values(id, '交易明細')[1][10], trades[0].id);
  assert.deepEqual(fake.values(id, '成員')[2], ['媽媽', mom.id]);
  // 再同步一次不會重複新增
  await d.Sync.syncNow();
  assert.equal(d.Store.list('trades', 'all').length, 1);
  assert.equal(d.Store.members().length, 2);
  assert.equal(fake.values(id, '成員').length, 3);
});

test('長輩在試算表刪掉一列，App 也跟著刪除（少量刪除不詢問）', async () => {
  const { fake, d, id } = await linked();
  fake.sheet(id, '庫存快照').grid.splice(1, 1);
  await d.Sync.syncNow();
  assert.equal(d.Store.list('snapshots', 'all').length, 0);
  assert.deepEqual(d.asked.messages, []);
});

// 連結後再加 5 筆交易並同步，回傳試算表 id
async function withTrades(n = 5) {
  const ctx = await linked();
  for (let i = 0; i < n; i++) ctx.d.Store.add('trades', { ...TRADE, shares: 1000 + i });
  await ctx.d.Sync.syncNow();
  ctx.d.asked.messages.length = 0;
  return ctx;
}

test('試算表一次少了 5 筆以上：先詢問，選「取消」就保留並寫回試算表', async () => {
  const { fake, d, id } = await withTrades();
  fake.sheet(id, '交易明細').grid.splice(1, 5); // 長輩選取一大片刪掉
  d.asked.answer = false;
  await d.Sync.syncNow();
  assert.equal(d.asked.messages.length, 1);
  assert.match(d.asked.messages[0], /少了 5 筆資料（交易明細 5 筆）/);
  assert.equal(d.Store.list('trades', 'all').length, 5);
  assert.equal(fake.values(id, '交易明細').length, 6);
  assert.equal(d.Sync.state().pending, 0);
  // 再同步一次不會重複寫入，也不會再問
  await d.Sync.syncNow();
  assert.equal(fake.values(id, '交易明細').length, 6);
  assert.equal(d.asked.messages.length, 1);
});

test('試算表一次少了 5 筆以上：選「確定」就跟著刪除', async () => {
  const { fake, d, id } = await withTrades();
  fake.sheet(id, '交易明細').grid.splice(1, 5);
  d.asked.answer = true;
  await d.Sync.syncNow();
  assert.equal(d.asked.messages.length, 1);
  assert.equal(d.Store.list('trades', 'all').length, 0);
});

test('沒有網路：顯示會自動同步，不算失敗；網路恢復後正常同步', async () => {
  const { fake, d } = await linked();
  d.Store.add('trades', TRADE);
  fake.offline = true;
  await d.Sync.syncNow();
  let st = d.Sync.state();
  assert.equal(st.offline, true);
  assert.equal(st.error, '');
  assert.equal(st.pending, 1);
  assert.ok(d.toasts.includes('目前沒有網路，連上後會自動同步'));
  fake.offline = false;
  await d.Sync.syncNow();
  st = d.Sync.state();
  assert.equal(st.offline, false);
  assert.equal(st.pending, 0);
});

test('成員改名：「成員」分頁和資料裡的名字一起改', async () => {
  const { fake, d, id } = await linked();
  d.Store.renameMember('me', '爸爸');
  assert.ok(d.Sync.state().pending >= 2);
  await d.Sync.syncNow();
  assert.deepEqual(fake.values(id, '成員')[1], ['爸爸', 'me']);
  assert.equal(fake.values(id, '庫存快照')[1][0], '爸爸');
  assert.equal(d.Sync.state().pending, 0);
});

test('還沒同步的修改優先：同步時不會被試算表的舊資料蓋掉', async () => {
  const { fake, d, id } = await linked();
  const s = d.Store.list('snapshots', 'all')[0];
  d.Store.update('snapshots', s.id, { shares: 50000 });
  fake.setCell(id, '庫存快照', 2, 4, '長輩改的名字');
  await d.Sync.syncNow();
  assert.equal(d.Store.list('snapshots', 'all')[0].shares, 50000);
  assert.equal(fake.values(id, '庫存快照')[1][5], 50000);
});

test('同步途中又修改的資料，留到下一次同步', async () => {
  const { fake, d } = await linked();
  const s = d.Store.list('snapshots', 'all')[0];
  fake.onBatchGet = () => d.Store.update('snapshots', s.id, { shares: 1 });
  d.Store.add('trades', TRADE);
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 1);
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 0);
});

test('分頁被刪掉：補建回來並寫入這台裝置的資料', async () => {
  const { fake, d, id } = await linked();
  fake.files[id].sheets = fake.files[id].sheets.filter(s => s.title !== '庫存快照');
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().error, '');
  assert.equal(d.Store.list('snapshots', 'all').length, 1);
  assert.equal(fake.values(id, '庫存快照').length, 2);
});

test('標題被改壞：App 的資料保留、修改留著，顯示要改回哪個標題', async () => {
  const { fake, d, id } = await linked();
  fake.setCell(id, '庫存快照', 1, 5, '股數'); // 「庫存餘額」被改名
  const s = d.Store.list('snapshots', 'all')[0];
  d.Store.update('snapshots', s.id, { shares: 1 });
  await d.Sync.syncNow();
  const st = d.Sync.state();
  assert.equal(st.pending, 1);
  assert.equal(d.Store.list('snapshots', 'all')[0].shares, 1);
  assert.deepEqual(plain(st.problems).map(d.Sheet.problemText), ['庫存快照第 1 列：找不到「庫存餘額」欄，請把標題改回「庫存餘額」']);
  // 改回來之後就正常
  fake.setCell(id, '庫存快照', 1, 5, '庫存餘額');
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 0);
  assert.deepEqual(plain(d.Sync.state().problems), []);
});

test('試算表被丟到垃圾桶：詢問後選「確定」，用這台裝置的資料重新建立一份', async () => {
  const { fake, d, id } = await linked();
  fake.files[id].trashed = true;
  await d.Sync.syncNow();
  assert.equal(d.asked.messages.length, 1);
  assert.match(d.asked.messages[0], /試算表找不到了/);
  const newId = d.Sync.state().url.split('/').pop();
  assert.notEqual(newId, id);
  assert.equal(fake.values(newId, '庫存快照').length, 2);
  assert.ok(d.toasts.some(t => t.includes('重新建立')));
});

test('試算表被丟到垃圾桶：選「取消」就取消連結，資料保留、不重建', async () => {
  const { fake, d, id } = await linked();
  fake.files[id].trashed = true;
  const files = Object.keys(fake.files).length;
  d.asked.answer = false;
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().linked, false);
  assert.equal(Object.keys(fake.files).length, files);
  assert.equal(d.Store.list('snapshots', 'all').length, 1);
  assert.ok(d.toasts.includes('已取消連結'));
});

test('第二台裝置（沒有資料）連結：直接用雲端的資料', async () => {
  const { fake } = await linked();
  const phone = device(fake);
  await phone.Sync.startLink();
  assert.equal(phone.Store.list('snapshots', 'all').length, 1);
  assert.equal(phone.Sync.state().linked, true);
});

test('兩邊都有資料時先詢問；選「取消」就不連結', async () => {
  const { fake } = await linked();
  const other = device(fake, { confirmAnswer: false });
  other.Store.add('trades', TRADE);
  await other.Sync.startLink();
  assert.equal(other.Sync.state().linked, false);
  assert.equal(other.Store.list('trades', 'all').length, 1);

  const yes = device(fake, { confirmAnswer: true });
  yes.Store.add('trades', TRADE);
  await yes.Sync.startLink();
  assert.equal(yes.Sync.state().linked, true);
  assert.equal(yes.Store.list('trades', 'all').length, 0); // 改用雲端的資料
  assert.equal(yes.Store.list('snapshots', 'all').length, 1);
});

test('匯入 data.json 後整份重寫試算表', async () => {
  const { fake, d, id } = await linked();
  fake.appendRow(id, '交易明細', ['我', '2026/9/10', '普買', '2330', '台積電', 1, 1, 1, 0, 0, 'x']);
  d.Store.replaceAll(d.Store.parseImport({ members: [{ id: 'me', name: '我' }], trades: [{ ...TRADE, id: 't9' }], snapshots: [], dividends: [] }));
  await d.Sync.syncNow();
  assert.deepEqual(fake.values(id, '交易明細').map(r => r.at(-1)), ['id', 't9']);
  assert.equal(fake.values(id, '庫存快照').length, 1);
  assert.equal(d.Sync.state().pending, 0);
});

test('登入過期：不會自動同步，狀態顯示需要重新連線', async () => {
  const { fake, d } = await linked();
  const storage = { ...d.ls, 'stockbook.google.token': JSON.stringify({ accessToken: 'old', expiresAt: Date.now() - 1 }) };
  const again = device(fake, { storage, token: false });
  const before = fake.calls.length;
  assert.equal(again.Sync.state().needLogin, true);
  assert.equal(fake.calls.length, before);
  // 按「同步」：重新登入後同步
  again.Store.add('trades', TRADE);
  await again.Sync.syncNow();
  assert.equal(again.Sync.state().needLogin, false);
  assert.equal(again.Sync.state().pending, 0);
});

test('取消連結：資料保留，不再同步', async () => {
  const { d } = await linked();
  d.Sync.unlink();
  assert.equal(d.Sync.state().linked, false);
  assert.equal(d.Store.list('snapshots', 'all').length, 1);
});
