




















const Sheet = (() => {
  const VERSION = 7;
  const ID = 'id';
  const MEMBERS = { title: '成員', sheetId: 1, headers: ['名稱', ID] };
  const META = { title: '_meta', sheetId: 99 };
  const TABLES = Object.keys(SCHEMAS);
  const TAB = Object.fromEntries(TABLES.map((t, i) => [t, {
    title: SCHEMAS[t].sheetTitle || SCHEMAS[t].title,
    sheetId: i + 2,
    fields: SCHEMAS[t].fields,
    headers: [...SCHEMAS[t].fields.map(f => f.label), ID],
  }]));


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


  function colLetter(c) {
    let s = '';
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }


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

        return Object.entries(v)
          .filter(([id, n]) => names.has(id) && typeof n === 'number')
          .map(([id, n]) => `${names.get(id)} ${n}`)
          .join('、');
      default:
        return String(v);
    }
  }



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


  function toValues(data) {
    const out = { [MEMBERS.title]: [MEMBERS.headers, ...data.members.map(m => [m.name, m.id])] };
    TABLES.forEach(t => {
      out[TAB[t].title] = [TAB[t].headers, ...data[t].map(r => encodeRow(t, r, data.members))];
    });
    return out;
  }




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

        if (typeof raw === 'number' && f.caps) {
          return { value: String(raw), error: `${f.label}被存成數字 ${raw}，開頭的 0 可能不見了，請把這一欄設成純文字後重打` };
        }
        return { value: String(raw).trim() };
    }
  }


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

      const bad = memberNameError(name);
      if (bad) problem(ctx, tab, row, `成員「${name}」：${bad}`);
      m = { id: U.uid(), name };
      ctx.members.push(m);
      ctx.newMembers.push(m);
    }
    return m.id;
  }



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

    const at = {};
    fields.forEach(f => {
      const label = [f.label, ...(f.was || [])].find(l => idx.has(l));
      if (label) at[f.key] = { col: idx.get(label), label };
    });
    const lost = fields.filter(f => !f.optional && !at[f.key]);
    lost.forEach(f => problem(ctx, tab, 1, `找不到「${f.label}」欄，請把標題改回「${f.label}」`));
    if (lost.length) ctx.broken.push(t);
    const idCol = idColumn(tab, idx, header, ctx);
    addColumns(t, tab, at, ctx);

    fields.filter(f => at[f.key] && at[f.key].label !== f.label).forEach(f => {
      ctx.headers[tab][at[f.key].col] = f.label;
      ctx.rewrites.push({ table: t, tab, row: 1, col: at[f.key].col, value: f.label });
    });
    columnMoves(t, tab, at, ctx);

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





  function addColumns(t, tab, at, ctx) {
    const header = ctx.headers[tab];
    SCHEMAS[t].fields.filter(f => f.since && !at[f.key]).forEach(f => {
      const id = header.indexOf(ID);
      const col = id === header.length - 1 ? id : header.length;
      header.splice(col, 0, f.label);
      ctx.adds.push({ table: t, tab, col, field: f });
    });
  }



  function addColumnRequests(sheetId, { col, field }) {
    const nf = numberFormat(field);
    return [
      { insertDimension: { range: { sheetId, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 }, inheritFromBefore: col > 0 } },
      { updateCells: {
        start: { sheetId, rowIndex: 0, columnIndex: col },
        rows: [{ values: [{ userEnteredValue: { stringValue: field.label } }] }],
        fields: 'userEnteredValue',
      } },
      ...(nf ? [{ repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
        cell: { userEnteredFormat: { numberFormat: nf } },
        fields: 'userEnteredFormat.numberFormat',
      } }] : []),
    ];
  }




  const MOVES = [
    { before: 3, table: 'trades', key: 'settle', after: ['fee', 'tax'] },
    { before: 4, table: 'snapshots', key: 'avgCost', after: ['totalCost'] },
  ];


  function columnMoves(t, tab, at, ctx) {
    MOVES.filter(m => m.table === t && ctx.version < m.before && at[m.key]).forEach(m => {
      const last = Math.max(...m.after.map(k => at[k]?.col ?? -1));
      if (at[m.key].col < last) ctx.moves.push({ table: t, tab, from: at[m.key].col, to: last + 1 });
    });
  }

  const metaValue = (values, name) => Number((values || []).find(r => String(r?.[0] ?? '').trim() === name)?.[1]);


  function metaVersion(values) {
    const v = metaValue(values, 'version');
    return v > 0 ? v : 1;
  }










  function fromValues(byTitle, knownMembers = []) {
    const ctx = {
      members: [], newMembers: [], problems: [], idFixes: [], addIdHeader: [], rowOf: {}, headers: {}, broken: [],
      version: metaVersion(byTitle[META.title]), rewrites: [], moves: [], adds: [],
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
    const { problems, newMembers, idFixes, addIdHeader, rowOf, headers, broken, version, rewrites, moves, adds } = ctx;
    const alertCheck = metaValue(byTitle[META.title], 'alertCheck') > 0 ? metaValue(byTitle[META.title], 'alertCheck') : null;
    const alertScript = metaValue(byTitle[META.title], 'alertScript') || 0;
    return { data, problems, newMembers, idFixes, addIdHeader, rowOf, headers, broken, version, rewrites, moves, adds, alertCheck, alertScript };
  }


  const problemText = p => `${p.tab}${p.row ? `第 ${p.row} 列` : ''}：${p.msg}`;


  const allTabs = () => [...TABLES.map(t => TAB[t]), MEMBERS];


  function createBody(title = '股票記錄簿') {
    return {
      properties: { title, locale: 'zh_TW', timeZone: 'Asia/Taipei' },
      sheets: [
        ...allTabs().map(s => ({ properties: { sheetId: s.sheetId, title: s.title, gridProperties: { frozenRowCount: 1 } } })),
        { properties: { sheetId: META.sheetId, title: META.title, hidden: true } },
      ],
    };
  }


  const PER_SHARE = new Set(['cash', 'stock', 'discount']);

  function numberFormat(f) {
    if (f.type === 'date') return { type: 'DATE', pattern: 'yyyy/mm/dd' };
    if (f.type === 'number') {
      if (PER_SHARE.has(f.key)) return null;
      return { type: 'NUMBER', pattern: f.digits ? '#,##0.00##' : '#,##0' };
    }
    return { type: 'TEXT' };
  }

  const defaultIds = () => Object.fromEntries(allTabs().map(s => [s.title, s.sheetId]));




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


  const metaValues = () => [['version', VERSION]];



  const PRICES = { title: U.site === 'stockbook' ? '_股價' : `_股價_${U.site}` };
  const priceValues = codes => [['代號', '現價', '成交時間'], ...codes.map(c => [`'${c}`, `=GOOGLEFINANCE("TPE:${c}","price")`, `=GOOGLEFINANCE("TPE:${c}","tradetime")`])];


  function tradeTime(v) {
    if (typeof v !== 'number' || !(v > 0)) return '';
    const d = new Date(Math.round((v - 25569) * 86400000));
    if (isNaN(d)) return '';
    const min = d.getUTCHours() * 60 + d.getUTCMinutes();
    const day = d.getUTCDay();
    return day >= 1 && day <= 5 && min >= 9 * 60 && min <= 14 * 60 + 35 ? d.toISOString().slice(0, 16).replace('T', ' ') : '';
  }


  const readRanges = () => [MEMBERS.title, ...TABLES.map(t => TAB[t].title)];

  return {
    VERSION, ID, MEMBERS, META, PRICES, TAB,
    toSerial, fromSerial, colLetter,
    encodeRow, toValues, fromValues, problemText,
    createBody, setupRequests, addColumnRequests, metaValues, priceValues, tradeTime, readRanges,
  };
})();
