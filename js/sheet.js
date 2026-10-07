// 試算表格式：App 的資料 ↔ Google 試算表的列（只做轉換，不連網路）
//   每張資料表一個分頁，分頁名稱和頁面標題一樣；另有「成員」分頁和隱藏的 _meta 分頁（格式版本）
//   第一列是中文標題（和表單欄位名稱一樣），最後一欄是 id；讀取時依標題找欄位，調換欄位順序也讀得到
//   成員欄寫名字，用「成員」分頁對照 id；代號等文字欄設成純文字（0050 不會變成 50）
//   日期存成試算表的日期（可以排序、篩選）；基準日股數寫成「爸爸 30000、媽媽 5000」
//   讀取時容許手動輸入：空白列略過、沒有 id 的列補上 id、新的成員名字自動新增；
//   看不懂的值記在 problems（例如「交易明細第 12 列：成交日期看不懂」），其他資料照常讀進來
//   格式版本（_meta 分頁）：
//     1：交易明細是「股數、單價、成交金額、手續費、證交稅款」，成交金額不含手續費
//     2（2026-10-06）：照券商 App 改成「成交數量、成交單價、手續費、交易稅、應收付金額」
//        版本 1 的試算表同步時改標題、成交金額換算成應收付金額（見 schema.js 的 toSettle），寫好後記成版本 2
//        只有版本 1 才換算：之後有人把標題改回「成交金額」，也只是改名，不會再加一次手續費
//     3（2026-10-06）：交易明細的應收付金額搬到最後面（交易稅後面），和表單的順序一樣（見 MOVES）
//     4（2026-10-06）：庫存快照照券商 App 的「綜合損益」改名（交易別→類別、庫存餘額→昨日餘額、總投資成本→付出成本、
//        平均成本價格→成本均價），成本均價搬到付出成本後面；「累計配息」拿掉了，舊的那一欄留著不動（App 不讀）
const Sheet = (() => {
  const VERSION = 4;
  const ID = 'id';
  const MEMBERS = { title: '成員', sheetId: 1, headers: ['名稱', ID] };
  const META = { title: '_meta', sheetId: 99 };
  const TABLES = Object.keys(SCHEMAS);
  const TAB = Object.fromEntries(TABLES.map((t, i) => [t, {
    title: SCHEMAS[t].title,
    sheetId: i + 2,
    fields: SCHEMAS[t].fields,
    headers: [...SCHEMAS[t].fields.map(f => f.label), ID],
  }]));

  // ---------- 日期：試算表的日期是從 1899-12-30 起算的天數 ----------
  const EPOCH = Date.UTC(1899, 11, 30);
  const DAY = 86400000;

  function toSerial(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return (Date.UTC(y, m - 1, d) - EPOCH) / DAY;
  }

  function fromSerial(n) {
    const d = new Date(EPOCH + Math.floor(n) * DAY);
    return `${d.getUTCFullYear()}-${U.pad2(d.getUTCMonth() + 1)}-${U.pad2(d.getUTCDate())}`;
  }

  const blank = v => v === undefined || v === null || String(v).trim() === '';

  // 第 0 欄是 A、第 26 欄是 AA
  function colLetter(c) {
    let s = '';
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  // ---------- 寫入：資料 → 列 ----------
  function encode(f, v, names) {
    if (v === null || v === undefined || v === '') return '';
    switch (f.type) {
      case 'date': {
        const iso = U.parseDate(v);
        return iso ? toSerial(iso) : String(v);
      }
      case 'number':
        return typeof v === 'number' ? v : String(v);
      case 'member':
        return names.get(v) ?? v;
      case 'perMember':
        // 已刪除的成員不寫出（App 裡也不顯示）
        return Object.entries(v)
          .filter(([id, n]) => names.has(id) && typeof n === 'number')
          .map(([id, n]) => `${names.get(id)} ${n}`)
          .join('、');
      default:
        return String(v);
    }
  }

  // 一筆資料 → 一列；header 是試算表目前的標題列（欄位順序可能被調整過）
  //   不認得的欄位填 null：Sheets API 寫入時會略過，不會清掉長輩自己加的欄位
  function encodeRow(t, rec, members, header = TAB[t].headers) {
    const names = new Map(members.map(m => [m.id, m.name]));
    const byLabel = new Map(TAB[t].fields.map(f => [f.label, f]));
    return header.map(h => {
      const label = String(h ?? '').trim();
      if (label === ID) return rec.id;
      const f = byLabel.get(label);
      return f ? encode(f, rec[f.key], names) : null;
    });
  }

  // 全部資料 → { 分頁名稱: 二維陣列（含標題列） }
  function toValues(data) {
    const out = { [MEMBERS.title]: [MEMBERS.headers, ...data.members.map(m => [m.name, m.id])] };
    TABLES.forEach(t => {
      out[TAB[t].title] = [TAB[t].headers, ...data[t].map(r => encodeRow(t, r, data.members))];
    });
    return out;
  }

  // ---------- 讀取：列 → 資料 ----------
  // values 是 Sheets API 以 UNFORMATTED_VALUE、SERIAL_NUMBER 讀回的二維陣列，從 A1 開始：
  //   日期格是數字（序號），手動打成文字的日期是字串；每列尾端的空白格會被省略
  function headerIndex(row) {
    const idx = new Map();
    (row || []).forEach((h, i) => {
      const label = String(h ?? '').trim();
      if (label && !idx.has(label)) idx.set(label, i);
    });
    return idx;
  }

  function problem(ctx, tab, row, msg) {
    ctx.problems.push({ tab, row, msg });
  }

  // 「爸爸 30000、媽媽 5000」；只有一位成員時可以只寫數字
  //   分隔可以用頓號、分號、換行，或後面接著名字的逗號（30,000 的千分位逗號不算）
  function decodePerMember(f, raw, ctx) {
    const members = ctx.members;
    if (typeof raw === 'number') {
      if (members.length === 1) return { value: { [members[0].id]: raw } };
      return { error: `${f.label}要寫成員名字，例如「${members[0]?.name ?? '爸爸'} ${raw}」` };
    }
    const value = {};
    const bad = [];
    U.toHalf(raw).split(/[、;\n]|,(?=\s*[^\d\s])/).map(s => s.trim()).filter(Boolean).forEach(part => {
      const m = part.match(/^(.*?)[\s:]*(\d[\d,]*(?:\.\d+)?)$/);
      const name = m ? m[1].trim() : '';
      const n = m ? U.parseNum(m[2]) : null;
      const member = name ? members.find(x => x.name === name) : (members.length === 1 ? members[0] : null);
      if (!member || n === null) bad.push(part);
      else value[member.id] = n;
    });
    return {
      value: Object.keys(value).length ? value : undefined,
      error: bad.length ? `${f.label}看不懂（${bad.join('、')}）` : undefined,
    };
  }

  // 回傳 { value, error }；空白時文字欄是 ''、數字和日期是 null（有預設值的數字用預設值）
  function decode(f, raw, ctx) {
    if (blank(raw)) {
      if (f.type === 'perMember') return { value: undefined };
      if (f.type === 'number' || f.type === 'date') return { value: f.default ?? null };
      return { value: '' };
    }
    switch (f.type) {
      case 'date': {
        const iso = typeof raw === 'number' ? fromSerial(raw) : U.parseDate(raw);
        return iso ? { value: iso } : { value: null, error: `${f.label}看不懂（${raw}）` };
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : U.parseNum(raw);
        return n === null ? { value: null, error: `${f.label}不是數字（${raw}）` } : { value: n };
      }
      case 'perMember':
        return decodePerMember(f, raw, ctx);
      default:
        // 代號欄被改成數字格式時，開頭的 0 會不見（0050 → 50），無法自動補回
        if (typeof raw === 'number' && f.caps) {
          return { value: String(raw), error: `${f.label}被存成數字 ${raw}，開頭的 0 可能不見了，請把這一欄設成純文字後重打` };
        }
        return { value: String(raw).trim() };
    }
  }

  // 沒有任何成員時先建立一位「我」（和 App 的預設一樣）
  function firstMember(ctx) {
    if (!ctx.members.length) {
      const m = { id: 'me', name: '我' };
      ctx.members.push(m);
      ctx.newMembers.push(m);
    }
    return ctx.members[0];
  }

  function readMemberCell(raw, tab, row, ctx) {
    const name = blank(raw) ? '' : String(raw).trim();
    if (!name) {
      const m = firstMember(ctx);
      if (ctx.members.length > 1) problem(ctx, tab, row, `成員空白，先算在「${m.name}」名下`);
      return m.id;
    }
    let m = ctx.members.find(x => x.name === name);
    if (!m) {
      // 名字不合規則（見 schema.js）還是照樣新增，資料才對得到人；列出來請使用者改
      const bad = memberNameError(name);
      if (bad) problem(ctx, tab, row, `成員「${name}」：${bad}`);
      m = { id: U.uid(), name };
      ctx.members.push(m);
      ctx.newMembers.push(m);
    }
    return m.id;
  }

  // 沒有 id 或 id 重複的列給新的 id，記在 idFixes 讓同步時寫回試算表
  //   整個分頁沒有 id 欄時，記在 addIdHeader（寫在最後一個標題的右邊）
  function idColumn(tab, idx, header, ctx) {
    ctx.rowOf[tab] = {};
    ctx.headers[tab] = [...header];
    if (idx.has(ID)) return idx.get(ID);
    const col = header.length;
    ctx.addIdHeader.push({ tab, col });
    ctx.headers[tab][col] = ID;
    return col;
  }

  function takeId(cells, col, tab, row, seen, ctx) {
    let id = blank(cells[col]) ? '' : String(cells[col]).trim();
    if (!id || seen.has(id)) {
      id = U.uid();
      ctx.idFixes.push({ tab, row, col, id });
    }
    seen.add(id);
    ctx.rowOf[tab][id] = row;
    return id;
  }

  function readMembers(values, ctx) {
    const tab = MEMBERS.title;
    if (!values || !values.length) return;
    const header = values[0] || [];
    const idx = headerIndex(header);
    if (!idx.has('名稱')) {
      problem(ctx, tab, 1, '找不到「名稱」欄，請把標題改回「名稱」');
      ctx.broken.push('members');
      return;
    }
    const idCol = idColumn(tab, idx, header, ctx);
    const seen = new Set();
    values.slice(1).forEach((cells, i) => {
      const row = i + 2;
      if (!cells || cells.every(blank)) return;
      const name = blank(cells[idx.get('名稱')]) ? '' : String(cells[idx.get('名稱')]).trim();
      if (!name) { problem(ctx, tab, row, '名稱空白，略過這一列'); return; }
      if (ctx.members.some(m => m.name === name)) { problem(ctx, tab, row, `「${name}」重複了，只用上面那一列`); return; }
      const bad = memberNameError(name);
      if (bad) problem(ctx, tab, row, `「${name}」：${bad}`);
      ctx.members.push({ id: takeId(cells, idCol, tab, row, seen, ctx), name });
    });
  }

  function readTable(t, values, ctx) {
    const { title: tab, fields } = TAB[t];
    if (!values || !values.length) {
      problem(ctx, tab, null, `找不到「${tab}」分頁或分頁是空的`);
      ctx.broken.push(t);
      return [];
    }
    const header = values[0] || [];
    const idx = headerIndex(header);
    // 欄位依標題找，找不到再找改名前的標題（was）；{ key: { col, label } }
    const at = {};
    fields.forEach(f => {
      const label = [f.label, ...(f.was || [])].find(l => idx.has(l));
      if (label) at[f.key] = { col: idx.get(label), label };
    });
    const lost = fields.filter(f => !f.optional && !at[f.key]);
    lost.forEach(f => problem(ctx, tab, 1, `找不到「${f.label}」欄，請把標題改回「${f.label}」`));
    if (lost.length) ctx.broken.push(t);
    const idCol = idColumn(tab, idx, header, ctx);
    // 改名前的標題：同步時改成新的（headers 先換掉，寫回資料時才對得上欄位）
    fields.filter(f => at[f.key] && at[f.key].label !== f.label).forEach(f => {
      ctx.headers[tab][at[f.key].col] = f.label;
      ctx.rewrites.push({ table: t, tab, row: 1, col: at[f.key].col, value: f.label });
    });
    columnMoves(t, tab, at, ctx);
    // 格式版本 1 的舊欄位：值讀進舊的 key，由 migrate 換算後寫回那一格
    const legacy = ctx.version < 2 ? SCHEMAS[t].legacy || {} : {};
    const converted = fields.filter(f => at[f.key] && legacy[at[f.key].label]);
    const migrate = SCHEMAS[t].migrate || (r => r);
    const seen = new Set();
    const rows = [];

    values.slice(1).forEach((cells, i) => {
      const row = i + 2;
      if (!cells || cells.every(blank)) return;
      const rec = {};
      fields.forEach(f => {
        const col = at[f.key]?.col;
        const raw = col === undefined ? '' : cells[col];
        if (f.type === 'member') {
          rec[f.key] = readMemberCell(raw, tab, row, ctx);
          return;
        }
        const { value, error } = decode(f, raw, ctx);
        if (error) problem(ctx, tab, row, error);
        else if (!f.optional && col !== undefined && (value === null || value === '')) problem(ctx, tab, row, `${f.label}空白`);
        if (value !== undefined) rec[(col !== undefined && legacy[at[f.key].label]) || f.key] = value;
      });
      const out = migrate(rec);
      converted.forEach(f => {
        if (typeof out[f.key] === 'number') ctx.rewrites.push({ table: t, tab, row, col: at[f.key].col, value: out[f.key] });
      });
      rows.push({ id: takeId(cells, idCol, tab, row, seen, ctx), ...out });
    });
    return rows;
  }

  // 格式升級時要搬的欄，讓試算表的順序和表單一樣（資料依標題對應，搬不搬都讀得到）
  //   版本比 before 舊的試算表：key 那一欄在 after 那幾欄前面時，搬到它們後面；之後長輩自己調的順序不動
  //   每個分頁最多搬一欄（同一次搬兩欄時，第二欄的位置會跑掉）
  const MOVES = [
    { before: 3, table: 'trades', key: 'settle', after: ['fee', 'tax'] },     // 應收付金額搬到交易稅後面
    { before: 4, table: 'snapshots', key: 'avgCost', after: ['totalCost'] },  // 成本均價搬到付出成本後面
  ];

  // 記在 moves（{ table, tab, from, to }，to 是搬之前的欄位位置）
  function columnMoves(t, tab, at, ctx) {
    MOVES.filter(m => m.table === t && ctx.version < m.before && at[m.key]).forEach(m => {
      const last = Math.max(...m.after.map(k => at[k]?.col ?? -1));
      if (at[m.key].col < last) ctx.moves.push({ table: t, tab, from: at[m.key].col, to: last + 1 });
    });
  }

  // _meta 分頁記的格式版本；沒有這個分頁（或讀不到）時當作版本 1
  function metaVersion(values) {
    const row = (values || []).find(r => String(r?.[0] ?? '').trim() === 'version');
    const v = Number(row?.[1]);
    return v > 0 ? v : 1;
  }

  // byTitle：{ 分頁名稱: values }，由 readRanges() 的範圍讀回，有 _meta 分頁時也一起讀
  // 回傳 { data, problems, newMembers, idFixes, addIdHeader, rowOf, headers, broken, version, rewrites }
  //   data 和 data.json 同樣的結構；newMembers 是讀取時新增、要寫回「成員」分頁的成員
  //   rowOf[分頁][id] 是那一筆在第幾列；headers[分頁] 是標題列（補上 id 欄之後）
  //   broken 是缺分頁或缺欄位的資料表：讀到的資料不完整，同步時不要拿來取代 App 裡的資料
  //   version 是試算表目前的格式版本；rewrites 是舊格式要改寫的格子 [{ table, tab, row, col, value }]（改名的標題、換算過的金額）
  //   moves 是舊格式要搬的欄（見 MOVES）
  // knownMembers：「成員」分頁讀不到時改用這份名單（App 裡現有的成員），名字才對得回原本的 id
  function fromValues(byTitle, knownMembers = []) {
    const ctx = {
      members: [], newMembers: [], problems: [], idFixes: [], addIdHeader: [], rowOf: {}, headers: {}, broken: [],
      version: metaVersion(byTitle[META.title]), rewrites: [], moves: [],
    };
    readMembers(byTitle[MEMBERS.title], ctx);
    if (!ctx.members.length && knownMembers.length) {
      if (!ctx.broken.includes('members')) ctx.broken.push('members');
      ctx.members = knownMembers.map(m => ({ id: m.id, name: m.name }));
    }
    const data = {};
    TABLES.forEach(t => { data[t] = readTable(t, byTitle[TAB[t].title], ctx); });
    firstMember(ctx);
    data.members = ctx.members;
    const { problems, newMembers, idFixes, addIdHeader, rowOf, headers, broken, version, rewrites, moves } = ctx;
    return { data, problems, newMembers, idFixes, addIdHeader, rowOf, headers, broken, version, rewrites, moves };
  }

  // 「交易明細第 12 列：成交日期看不懂（2026/13/01）」
  const problemText = p => `${p.tab}${p.row ? `第 ${p.row} 列` : ''}：${p.msg}`;

  // ---------- 建立試算表 ----------
  const allTabs = () => [...TABLES.map(t => TAB[t]), MEMBERS];

  // spreadsheets.create 的 body；分頁 id 固定，設定格式時用得到
  function createBody(title = '股票記錄簿') {
    return {
      properties: { title, locale: 'zh_TW', timeZone: 'Asia/Taipei' },
      sheets: [
        ...allTabs().map(s => ({ properties: { sheetId: s.sheetId, title: s.title, gridProperties: { frozenRowCount: 1 } } })),
        { properties: { sheetId: META.sheetId, title: META.title, hidden: true } },
      ],
    };
  }

  // 每股金額（現金股利、股票股利）常有好幾位小數，用試算表的自動格式
  const PER_SHARE = new Set(['cash', 'stock']);

  function numberFormat(f) {
    if (f.type === 'date') return { type: 'DATE', pattern: 'yyyy/mm/dd' };
    if (f.type === 'number') {
      if (PER_SHARE.has(f.key)) return null;
      return { type: 'NUMBER', pattern: f.digits ? '#,##0.00##' : '#,##0' };
    }
    return { type: 'TEXT' }; // 文字、成員、基準日股數都存純文字
  }

  const defaultIds = () => Object.fromEntries(allTabs().map(s => [s.title, s.sheetId]));

  // 格式、下拉選單、保護（spreadsheets.batchUpdate 的 requests）
  //   下拉選單和日期檢查只提醒、不擋（和 App 的快選按鈕一樣）；標題列和 id 欄修改時跳出警告
  //   sheetIds：{ 分頁名稱: sheetId }，只設定有列出的分頁（補建單一分頁時用）
  function setupRequests(sheetIds = defaultIds()) {
    const GRAY_BG = { red: 0.95, green: 0.95, blue: 0.93 };
    const GRAY_TEXT = { red: 0.6, green: 0.6, blue: 0.6 };
    const column = (sheetId, c) => ({ sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 });
    const headerRow = sheetId => ({ sheetId, startRowIndex: 0, endRowIndex: 1 });
    const style = (range, userEnteredFormat, fields) => ({ repeatCell: { range, cell: { userEnteredFormat }, fields } });
    const format = (range, numberFormat) => style(range, { numberFormat }, 'userEnteredFormat.numberFormat');
    const validate = (range, condition) => ({
      setDataValidation: { range, rule: { condition, strict: false, showCustomUi: true } },
    });
    const protect = (range, description) => ({ addProtectedRange: { protectedRange: { range, description, warningOnly: true } } });

    const reqs = [];
    const has = s => sheetIds[s.title] !== undefined;
    allTabs().filter(has).forEach(s => {
      const sheetId = sheetIds[s.title];
      const idCol = s.headers.length - 1;
      reqs.push(
        style(headerRow(sheetId), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold'),
        style(headerRow(sheetId), { backgroundColor: GRAY_BG }, 'userEnteredFormat.backgroundColor'),
        format(column(sheetId, idCol), { type: 'TEXT' }),
        style(column(sheetId, idCol), { textFormat: { foregroundColor: GRAY_TEXT } }, 'userEnteredFormat.textFormat.foregroundColor'),
        protect(headerRow(sheetId), '標題列：App 依標題找欄位，請不要修改'),
        protect(column(sheetId, idCol), 'id：App 用來對應每一筆資料，請不要修改'),
      );
    });

    if (has(MEMBERS)) reqs.push(format(column(sheetIds[MEMBERS.title], 0), { type: 'TEXT' }));
    const memberList = { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `='${MEMBERS.title}'!A2:A` }] };
    TABLES.map(t => TAB[t]).filter(has).forEach(s => {
      s.fields.forEach((f, c) => {
        const range = column(sheetIds[s.title], c);
        const nf = numberFormat(f);
        if (nf) reqs.push(format(range, nf));
        if (f.type === 'date') reqs.push(validate(range, { type: 'DATE_IS_VALID' }));
        if (f.type === 'member') reqs.push(validate(range, memberList));
        if (f.suggest) reqs.push(validate(range, { type: 'ONE_OF_LIST', values: f.suggest.map(v => ({ userEnteredValue: v })) }));
      });
    });
    return reqs;
  }

  // _meta 分頁的內容：格式版本，以後改格式時用來判斷要不要轉換
  const metaValues = () => [['version', VERSION]];

  // _股價 分頁（隱藏）：A 欄代號、B 欄用 GOOGLEFINANCE 抓的現價（見 sync.js）
  //   用「使用者輸入」的方式寫入：代號前面加 ' 才會存成文字（0050 不會變成 50），公式才會計算
  const PRICES = { title: '_股價' };
  const priceValues = codes => [['代號', '現價'], ...codes.map(c => [`'${c}`, `=GOOGLEFINANCE("TPE:${c}","price")`])];

  // 同步時讀取的範圍（values.batchGet），順序和 fromValues 需要的分頁一樣
  const readRanges = () => [MEMBERS.title, ...TABLES.map(t => TAB[t].title)];

  return {
    VERSION, ID, MEMBERS, META, PRICES, TAB,
    toSerial, fromSerial, colLetter,
    encodeRow, toValues, fromValues, problemText,
    createBody, setupRequests, metaValues, priceValues, readRanges,
  };
})();
