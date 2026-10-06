// 產生 js/stocklist.js：股票代號與名稱（上市、上櫃、興櫃，不含權證）
//   來源：證交所「有價證券代號及名稱」https://isin.twse.com.tw/isin/C_public.jsp?strMode=2（Big5 編碼的網頁表格）
//   用法：node tools/update-stocklist.mjs
//   更新後要改 index.html 的版本號（見 tests/version.test.mjs），手機上才會重新下載
import { writeFileSync } from 'node:fs';

const SOURCES = [
  { mode: 2, label: '上市', min: 1000 },
  { mode: 4, label: '上櫃', min: 800 },
  { mode: 5, label: '興櫃', min: 100 },
];
const OUT = new URL('../js/stocklist.js', import.meta.url);

const text = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

// 每一列的第一格是「代號　名稱」（中間是全形空白）；只有一格的列是分類標題（股票、ETF、權證……）
function parse(html) {
  const rows = [];
  let category = '';
  for (const [, tr] of html.matchAll(/<tr>(.*?)<\/tr>/gs)) {
    const cells = [...tr.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(m => text(m[1]));
    if (cells.length === 1) { category = cells[0]; continue; }
    if (cells.length < 5 || /權證/.test(category)) continue;
    const k = cells[0].indexOf('　');
    if (k < 0) continue;
    const code = cells[0].slice(0, k).trim().toUpperCase();
    const name = cells[0].slice(k + 1).replace(/[\s　]+/g, ' ').trim();
    if (/^[0-9A-Z]{4,6}$/.test(code) && name) rows.push([code, name]);
  }
  return rows;
}

async function fetchList({ mode, label, min }) {
  const res = await fetch(`https://isin.twse.com.tw/isin/C_public.jsp?strMode=${mode}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`${label}：HTTP ${res.status}`);
  const rows = parse(new TextDecoder('big5').decode(await res.arrayBuffer()));
  // 筆數太少多半是網頁改版，寧可失敗也不要寫出不完整的清單
  if (rows.length < min) throw new Error(`${label}只讀到 ${rows.length} 檔，網頁格式可能改了`);
  console.log(`${label} ${rows.length} 檔`);
  return rows;
}

const names = new Map();
for (const src of SOURCES) {
  for (const [code, name] of await fetchList(src)) names.set(code, name);
  await new Promise(r => setTimeout(r, 1000));
}
for (const code of ['0050', '2330']) if (!names.has(code)) throw new Error(`清單裡沒有 ${code}，資料可能有問題`);

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
const lines = [...names].sort(([a], [b]) => (a < b ? -1 : 1)).map(([c, n]) => `    ${JSON.stringify(c)}: ${JSON.stringify(n)},`);
writeFileSync(OUT, `// 股票代號與名稱：證交所「有價證券代號及名稱」的上市、上櫃、興櫃清單（不含權證）
//   由 tools/update-stocklist.mjs 產生，不要手動修改
//   表單填了代號時用來帶入證券名稱（見 form.js）；查不到時提醒（見 schema.js 的 codeNote）
const STOCK_LIST = {
  updated: '${today}',
  names: {
${lines.join('\n')}
  },
};
`);
console.log(`共 ${names.size} 檔，已寫入 js/stocklist.js`);
