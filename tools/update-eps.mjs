// 產生 shared/eps.json：上市、上櫃每一家公司近 5 年的 EPS 和股利（依股利所屬年度），行情的股利預估用
//   EPS：公開資訊觀測站「各產業 EPS 統計資訊」https://mopsov.twse.com.tw/mops/web/t163sb19（一次一個市場、一季的全部公司）
//     基本每股盈餘是當年累計到那一季的，第 4 季就是全年
//   股利：公開資訊觀測站「股利分派情形」彙總表 https://mopsov.twse.com.tw/mops/web/t05st09_new，依股利所屬年度查（一次一個市場、一年度）
//     網頁按查詢後另開視窗，資料在 /server-java/t05st09sub（Big5）
//     現金股利 = 盈餘、法定盈餘公積、資本公積發的現金加起來；股票股利 = 三種轉增資配股加起來（元）
//     季配、半年配的一季（半年）一列，加起來是那一年度的；同時記下涵蓋幾季：年度 4、半年 2、一季 1，4 以上代表那一年度都決議了
//     年中改配息頻率（季配改年配）、另外用資本公積多配一次的，同一年度會超過 4，金額照樣加起來
//     決議不配的也有一列（都是 0），和還沒決議（沒有這一列）分得出來
//   ETF 沒有 EPS，不在裡面
//   GitHub 每個工作天晚上自動執行，只重抓最近三季的 EPS、今年和去年的股利，有變才存進 repo（見 .github/workflows/update-eps.yml）
//     從 GitHub 抓很慢（EPS 一次 30 多秒、股利一次一、兩分鐘），全部重抓要 40 分鐘，超過時間上限
//     第一次、或要全部重抓：在本機執行 node tools/update-eps.mjs --all（大約 6 分鐘），再存進 repo
//   App 打開時自己下載，不用改版本號
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('../shared/eps.json', import.meta.url);
const BASE = 'https://mopsov.twse.com.tw';
const YEARS = 5;
const MARKETS = [['sii', '上市'], ['otc', '上櫃']];
const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded' };
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
const thisYear = Number(today.slice(0, 4));
const wait = ms => new Promise(r => setTimeout(r, ms));
const text = s => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/[\s　]+/g, ' ').trim();
const rowsOf = html => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
  .map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => text(c[1])));
// 「1,215.00」「-0.52」→ 數字；空白、「--」→ null
const num = s => (/\d/.test(s ?? '') ? Number(String(s).replace(/[,\s]/g, '')) : null);
const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

// 觀測站偶爾會卡住，查太快也會回一頁「FOR SECURITY REASONS」：等一下再試，最多 3 次
//   ok：查詢結果一定有的字（表頭，或查無資料）；沒有就當作被擋
async function post(path, body, { encoding = 'utf-8', ok, label }) {
  for (let k = 1; ; k++) {
    try {
      const res = await fetch(BASE + path, { method: 'POST', headers: HEADERS, body: new URLSearchParams(body), signal: AbortSignal.timeout(300000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = new TextDecoder(encoding).decode(await res.arrayBuffer());
      if (!ok.test(html)) throw new Error(`回來的不是查詢結果（${text(html).slice(0, 40)}）`);
      return html;
    } catch (e) {
      if (k >= 3) throw new Error(`${label}：${e.cause?.code || e.message}`);
      console.log(`${label} 失敗（${e.cause?.code || e.message}），30 秒後再試（第 ${k} 次）`);
      await wait(30000);
    }
  }
}

// 一季的 EPS：Map(代號 → 累計到這一季的基本每股盈餘)；還沒公布時是 null
async function eps(typek, market, year, q) {
  const label = `EPS ${market} ${year} 年第 ${q} 季`;
  const html = await post('/mops/web/ajax_t163sb19',
    { encodeURIComponent: 1, step: 1, firstin: 1, TYPEK: typek, code: '', year: year - 1911, season: `0${q}` },
    { ok: /公司代號|查無資料/, label });
  if (!/公司代號/.test(html)) return null;
  // 公司代號、公司名稱、產業別、基本每股盈餘(元)、普通股每股面額、營業收入、營業利益、營業外收入及支出、稅後淨利
  const head = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].slice(0, 9).map(c => text(c[1]));
  if (head[0] !== '公司代號' || !/^基本每股盈餘/.test(head[3] || '')) throw new Error(`${label}：表頭是「${head.join('、')}」，網站格式可能改了`);
  const map = new Map();
  for (const c of rowsOf(html)) {
    if (c.length >= 9 && /^[0-9A-Z]{4,6}$/.test(c[0]) && num(c[3]) !== null) map.set(c[0], num(c[3]));
  }
  if (!map.size) throw new Error(`${label}：一家都沒有讀到，網站格式可能改了`);
  return map;
}

// 一年度的股利：Map(代號 → [現金股利, 股票股利, 涵蓋幾季])；還沒有人決議時是空的
const QUARTERS = { 年度: 4, 上半年: 2, 下半年: 2, 第1季: 1, 第2季: 1, 第3季: 1, 第4季: 1 };
async function div(typek, market, year) {
  const label = `股利 ${market} ${year} 年度`;
  const html = await post('/server-java/t05st09sub',
    { step: 1, TYPEK: typek, YEAR: year - 1911, first: '', qryType: 2 },
    { encoding: 'big5', ok: /股利分派情形/, label });
  const map = new Map();
  if (/查無符合條件之資料/.test(html)) return map;
  if (!/盈餘分配 ?之現金股利/.test(text(html))) throw new Error(`${label}：找不到「盈餘分配之現金股利」，網站格式可能改了`);
  // 公司代號 名稱、決議進度、股利所屬年(季)度、所屬期間、期別、董事會決議日、股東會日期、期初未分配盈餘、本期淨利、可分配盈餘、
  // 分配後期末未分配盈餘、盈餘分配之現金股利、法定盈餘公積發放之現金、資本公積發放之現金、現金股利總金額、
  // 盈餘轉增資配股、法定盈餘公積轉增資配股、資本公積轉增資配股、配股總股數、公司章程、備註
  const roc = `${year - 1911}年`;
  for (const c of rowsOf(html)) {
    const code = c.length === 21 && (c[0].match(/^([0-9A-Z]{4,6}) - /) || [])[1];
    if (!code || !c[2].startsWith(roc)) continue;
    const quarters = QUARTERS[c[2].slice(roc.length)];
    if (!quarters) throw new Error(`${label}：${code} 的股利所屬期間是「${c[2]}」，不認得`);
    const sum = cols => cols.reduce((s, i) => s + (num(c[i]) || 0), 0);
    const [cash, stock, n] = map.get(code) || [0, 0, 0];
    map.set(code, [cash + sum([11, 12, 13]), stock + sum([15, 16, 17]), n + quarters]);
  }
  if (!map.size) throw new Error(`${label}：一家都沒有讀到，網站格式可能改了`);
  return map;
}

// ---------- 要抓哪幾季、哪幾年 ----------
let prev = null;
try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch (_) {}
const full = process.argv.includes('--all') || !prev;
// 季底在今天以前的季（還沒公布的會回查無資料）；一般只抓最近三季，全部重抓時抓近 6 年（今年還沒有資料時，往前多一年才湊得到 5 年）
const quarters = [];
for (let y = thisYear; y > thisYear - YEARS - 1; y--) {
  for (let q = 4; q >= 1; q--) {
    if (`${y}-${['03-31', '06-30', '09-30', '12-31'][q - 1]}` < today) quarters.push([y, q]);
  }
}
const epsTargets = full ? quarters : quarters.slice(0, 3);
const divTargets = full ? Array.from({ length: YEARS + 1 }, (_, i) => thisYear - i) : [thisYear, thisYear - 1];
console.log(full ? '全部重抓' : `只抓 ${epsTargets.map(([y, q]) => `${y}Q${q}`).join('、')} 的 EPS，${divTargets.join('、')} 年度的股利`);

// 代號 → { eps: { 年: [到第 1 季, 到第 2 季, …] }, div: { 年: [現金股利, 股票股利, 涵蓋幾季] } }
const data = new Map();
if (!full) for (const [c, r] of Object.entries(prev.rows)) data.set(c, { eps: { ...r.eps }, div: { ...r.div } });
const of = c => data.get(c) || data.set(c, { eps: {}, div: {} }).get(c);

// 觀測站查太快會被擋，每次之間停 5 秒
//   新的季先抓：今年已經有 EPS 時，5 年湊得齊，最前面那一年就不用抓
const has = y => [...data.values()].some(r => r.eps[y]);
for (const [y, q] of epsTargets) {
  if (y === thisYear - YEARS && has(thisYear)) break;
  for (const [typek, market] of MARKETS) {
    const map = await eps(typek, market, y, q);
    await wait(5000);
    console.log(`EPS ${market} ${y}Q${q}：${map ? `${map.size} 家` : '還沒公布'}`);
    if (!map) continue;
    for (const [c, v] of map) {
      const list = of(c).eps[y] = (of(c).eps[y] || []).slice();
      while (list.length < q - 1) list.push(null); // 前幾季沒有（年中才上市、上櫃）
      list[q - 1] = v;
    }
  }
}
for (const y of divTargets) {
  if (y === thisYear - YEARS && has(thisYear)) break;
  const year = new Map();
  for (const [typek, market] of MARKETS) {
    const map = await div(typek, market, y);
    await wait(5000);
    console.log(`股利 ${market} ${y} 年度：${map.size} 家`);
    map.forEach((v, c) => year.set(c, v));
  }
  // 這一年度重抓了：沒有列出的就是還沒決議，拿掉上一份的
  for (const [c, r] of data) if (!year.has(c)) delete r.div[y];
  for (const [c, [cash, stock, n]] of year) of(c).div[y] = [round(cash, 4), round(stock, 4), n];
}

// ---------- 只留有 EPS 的最近 5 年；有 EPS 的公司才收 ----------
const last = Math.max(...[...data.values()].flatMap(r => Object.keys(r.eps).map(Number)));
const keep = y => y > last - YEARS && y <= last;
const rows = [...data.entries()]
  .map(([c, r]) => {
    const pick = o => Object.fromEntries(Object.entries(o).filter(([y]) => keep(Number(y))).sort(([a], [b]) => a - b));
    return [c, { eps: pick(r.eps), div: pick(r.div) }];
  })
  .filter(([, r]) => Object.keys(r.eps).length)
  .sort(([a], [b]) => (a < b ? -1 : 1));
console.log(`${last - YEARS + 1}～${last} 年，共 ${rows.length} 家`);
for (const code of ['2330', '2412', '2884', '6488']) {
  if (!rows.some(([c]) => c === code)) throw new Error(`資料裡沒有 ${code}，可能有問題`);
}
const before = prev?.rows ? Object.keys(prev.rows).length : 0;
if (rows.length < 1700 || (before && rows.length < before * 0.9)) {
  throw new Error(`這次只有 ${rows.length} 家${before ? `，上一份有 ${before} 家` : ''}，太少了，可能沒抓完整，先不存`);
}

const body = rows.map(([c, r]) => `    ${JSON.stringify(c)}: ${JSON.stringify(r)}`).join(',\n');
const same = !!prev && JSON.stringify(prev.rows) === JSON.stringify(Object.fromEntries(rows));
const updated = same ? prev.updated : today;
mkdirSync(new URL('./', OUT), { recursive: true });
writeFileSync(OUT, `{
  "note": "EPS 和股利：公開資訊觀測站的各產業 EPS 統計資訊、股利分派情形（依股利所屬年度），有 EPS 的最近 ${YEARS} 年。由 tools/update-eps.mjs 產生，GitHub 每個工作天晚上自動更新，不要手動修改。每一家：eps 是每一年累計到第 1、2、3、4 季的基本每股盈餘（第 4 季就是全年；那一季沒有的是 null）；div 是每一年度的 [現金股利, 股票股利（元）, 涵蓋幾季]，年度配的 4、半年配一次 2、季配一次 1，4 以上代表那一年度都決議了，沒有的是還沒決議",
  "updated": "${updated}",
  "rows": {
${body}
  }
}
`);
console.log(same ? `和上一份一樣（${updated} 更新）` : '已寫入 shared/eps.json');
