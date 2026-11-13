











const Sync = (() => {
  const CLOUD_KEY = U.key('cloud');
  const MARK = 'stockbook';
  const MASS_DELETE = 5;
  const LIST_MAX = 10;
  const TABLES = Object.keys(SCHEMAS);
  const api = Google.api;
  const enc = encodeURIComponent;


  const a1 = (title, ref = '') => `'${title.replace(/'/g, "''")}'${ref ? `!${ref}` : ''}`;
  const titleOf = t => (t === 'members' ? Sheet.MEMBERS.title : Sheet.TAB[t].title);
  const countRecords = d => TABLES.reduce((n, t) => n + (d[t]?.length || 0), 0);
  const MAIN = U.site === 'stockbook';
  const readOnly = t => !MAIN && !SCHEMAS[t]?.siteWrites;
  const titleReadOnly = title => readOnly(['members', ...TABLES].find(t => titleOf(t) === title));


  let cloud = null;
  try { cloud = JSON.parse(localStorage.getItem(CLOUD_KEY)); } catch (_) {}

  function saveCloud() {
    try {
      if (cloud) localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud));
      else localStorage.removeItem(CLOUD_KEY);
    } catch (_) {}
  }


  let running = false;
  let again = false;
  let error = '';
  let offline = false;
  let problems = [];
  let problemsAt = 0;
  let okAt = 0;
  let incomplete = [];
  let lastRunAt = 0;
  let timer = null;
  let autoLoginTried = false;
  let loggingOut = false;
  let idleWaiters = [];


  const ALERT_KEY = U.key('alertCheck');
  const ALERT_SCRIPT_KEY = U.key('alertScript');
  let alertCheck = null;
  let alertScript = 0;
  try {
    alertCheck = Number(localStorage.getItem(ALERT_KEY)) || null;
    alertScript = Number(localStorage.getItem(ALERT_SCRIPT_KEY)) || 0;
  } catch (_) {}


  let hooks = { onData() {}, onStatus() {}, toast() {}, notify() {}, onLogout() {}, onPrices() {} };

  function state() {
    return {
      linked: !!cloud,
      email: cloud?.email || '',
      url: cloud?.url || '',
      lastSyncAt: cloud?.lastSyncAt || null,
      running,
      error,

      offline: offline && (Google.hasToken() || !navigator.onLine),
      problems,
      problemsAt,
      okAt,
      loggingOut,
      needLogin: !!cloud && !Google.hasToken(),
      liveStopped: liveStopped(),
      pending: Store.pendingCount(),
    };
  }

  const emit = () => hooks.onStatus(state());

  function setAlertCheck(v, script = 0) {
    alertCheck = v;
    alertScript = script;
    try {
      if (v) localStorage.setItem(ALERT_KEY, String(v));
      else localStorage.removeItem(ALERT_KEY);
      if (script) localStorage.setItem(ALERT_SCRIPT_KEY, String(script));
      else localStorage.removeItem(ALERT_SCRIPT_KEY);
    } catch (_) {}
  }


  async function findSpreadsheet() {
    const q = `appProperties has { key='${MARK}' and value='1' } and trashed=false`
      + " and mimeType='application/vnd.google-apps.spreadsheet'";
    const r = await api(`${Google.DRIVE}/files?q=${enc(q)}&orderBy=createdTime&fields=files(id)`);
    return r.files?.[0]?.id || null;
  }


  async function info(id) {
    try {
      const f = await api(`${Google.DRIVE}/files/${id}?fields=trashed`);
      if (f.trashed) return null;
      const s = await api(`${Google.SHEETS}/${id}?fields=spreadsheetUrl,sheets.properties(sheetId,title)`);
      const sheetIds = Object.fromEntries(s.sheets.map(x => [x.properties.title, x.properties.sheetId]));
      return { id, url: s.spreadsheetUrl, sheetIds };
    } catch (e) {
      if (e.code === 'not_found') return null;
      throw e;
    }
  }


  async function writeAll(id, data) {
    const values = Sheet.toValues(data);
    const titles = Object.keys(values);
    await api(`${Google.SHEETS}/${id}/values:batchClear`, {
      method: 'POST',
      body: { ranges: titles.map(t => a1(t)) },
    });
    await api(`${Google.SHEETS}/${id}/values:batchUpdate`, {
      method: 'POST',
      body: {
        valueInputOption: 'RAW',
        data: [
          ...titles.map(t => ({ range: a1(t, 'A1'), values: values[t] })),
          { range: a1(Sheet.META.title, 'A1'), values: Sheet.metaValues() },
        ],
      },
    });
  }

  async function createSpreadsheet(data) {
    const s = await api(Google.SHEETS, { method: 'POST', body: Sheet.createBody() });

    await api(`${Google.DRIVE}/files/${s.spreadsheetId}?fields=id`, {
      method: 'PATCH',
      body: { appProperties: { [MARK]: '1' } },
    });
    await api(`${Google.SHEETS}/${s.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: { requests: Sheet.setupRequests() },
    });
    await writeAll(s.spreadsheetId, data);
    return info(s.spreadsheetId);
  }



  async function ensureTabs(meta) {
    const need = Sheet.readRanges().filter(t => meta.sheetIds[t] === undefined && !titleReadOnly(t));
    const noMeta = MAIN && meta.sheetIds[Sheet.META.title] === undefined;
    if (!need.length && !noMeta) return;
    const r = await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
      method: 'POST',
      body: {
        requests: [
          ...need.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })),
          ...(noMeta ? [{ addSheet: { properties: { title: Sheet.META.title, hidden: true } } }] : []),
        ],
      },
    });
    r.replies.forEach(x => { meta.sheetIds[x.addSheet.properties.title] = x.addSheet.properties.sheetId; });
    if (!need.length) return;
    await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
      method: 'POST',
      body: { requests: Sheet.setupRequests(Object.fromEntries(need.map(t => [t, meta.sheetIds[t]]))) },
    });
  }


  async function locate() {
    let meta = cloud.spreadsheetId ? await info(cloud.spreadsheetId) : null;
    if (!meta) {
      const id = await findSpreadsheet();
      if (id) meta = await info(id);
    }
    if (!meta) return null;
    await ensureTabs(meta);
    cloud.spreadsheetId = meta.id;
    cloud.url = meta.url;
    saveCloud();
    return meta;
  }

  async function pull(meta) {

    const all = [...Sheet.readRanges(), Sheet.META.title];
    const titles = all.filter(t => meta.sheetIds[t] !== undefined);
    const ranges = titles.map(t => `ranges=${enc(a1(t))}`).join('&');
    const r = await api(`${Google.SHEETS}/${meta.id}/values:batchGet?${ranges}`
      + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
    const got = Object.fromEntries(titles.map((t, i) => [t, r.valueRanges[i].values || []]));
    return Object.fromEntries(all.map(t => [t, got[t] || []]));
  }




  function describe(t, r) {
    const { code, title, badge } = SCHEMAS[t].card || {};
    const date = SCHEMAS[t].fields.find(f => f.type === 'date');
    const who = r.member && Store.members().length > 1 ? Store.memberName(r.member) : '';
    const text = [who, date && U.fmtDate(r[date.key]), badge && r[badge], code && r[code], title && r[title]].filter(Boolean).join(' ');
    return `${titleOf(t)}：${text}`;
  }




  function keepOrDelete(parsed, skip, snap) {
    const pending = new Set(snap.items.map(i => `${i.table}:${i.id}`));
    const gone = TABLES.filter(t => !skip.includes(t) && !readOnly(t)).flatMap(t => {
      const remote = new Set(parsed.data[t].map(r => r.id));
      return Store.list(t, 'all')
        .filter(r => !remote.has(r.id) && !pending.has(`${t}:${r.id}`))
        .map(r => ({ table: t, id: r.id, text: describe(t, r) }));
    });
    if (!gone.length) return;
    const shown = gone.slice(0, LIST_MAX).map(g => g.text);
    if (gone.length > LIST_MAX) shown.push(`…等 ${gone.length} 筆`);
    const undo = '不小心刪的話，可以在試算表的「檔案 → 版本記錄」找回來，下次同步就會回來。';
    if (gone.length < MASS_DELETE) {
      hooks.notify({
        title: `試算表刪了 ${gone.length} 筆，這台也跟著刪了`,
        body: `在試算表或其他裝置上刪掉的：\n${shown.join('\n')}\n${undo}`,
        action: { type: 'sheet' },
      });
      return;
    }
    const lines = TABLES.map(t => [t, gone.filter(g => g.table === t).length])
      .filter(([, n]) => n).map(([t, n]) => `${titleOf(t)} ${n} 筆`).join('、');
    const del = confirm(`試算表裡少了 ${gone.length} 筆資料（${lines}），可能是在試算表或其他裝置上刪除了。\n\n`
      + '按「確定」：這台裝置也跟著刪除。\n按「取消」：保留這些資料，並寫回試算表。');
    hooks.notify({
      title: `試算表裡少了 ${gone.length} 筆資料`,
      body: `${lines}。你選擇：${del ? '這台裝置也跟著刪除' : '保留，並寫回試算表'}。\n${shown.join('\n')}${del ? `\n${undo}` : ''}`,
      action: del ? { type: 'sheet' } : null,
    });
    if (del) return;
    Store.markPending(gone);
    const items = new Map(Store.pendingSnapshot().items.map(i => [`${i.table}:${i.id}`, i]));
    gone.forEach(g => snap.items.push(items.get(`${g.table}:${g.id}`)));
  }


  async function exchange(meta, snap) {
    const byTitle = await pull(meta);
    const parsed = Sheet.fromValues(byTitle, Store.members());


    const ids = [
      ...parsed.addIdHeader.filter(({ tab }) => !titleReadOnly(tab)).map(({ tab, col }) => ({ range: a1(tab, `${Sheet.colLetter(col)}1`), values: [[Sheet.ID]] })),
      ...parsed.idFixes.filter(({ tab }) => !titleReadOnly(tab)).map(({ tab, row, col, id }) => ({ range: a1(tab, `${Sheet.colLetter(col)}${row}`), values: [[id]] })),
    ];
    if (ids.length) {
      await api(`${Google.SHEETS}/${meta.id}/values:batchUpdate`, {
        method: 'POST',
        body: { valueInputOption: 'RAW', data: ids },
      });
    }
    problems = parsed.problems.filter(p => !titleReadOnly(p.tab));
    problemsAt = Date.now();
    setAlertCheck(parsed.alertCheck, parsed.alertScript);



    const empty = ['members', ...TABLES].filter(t => !readOnly(t) && !byTitle[titleOf(t)].length);
    problems = problems.filter(p => !empty.some(t => titleOf(t) === p.tab));
    const skip = [...new Set([...parsed.broken, ...empty])];
    keepOrDelete(parsed, skip, snap);
    hooks.onData(Store.mergeRemote(parsed.data, skip));

    const local = Store.exportPayload();
    const all = empty.length ? Sheet.toValues(local) : {};
    const writes = [];
    const appends = {};
    const deletes = [];
    const done = ['members', ...TABLES].filter(t => !parsed.broken.includes(t) || empty.includes(t));
    incomplete = ['members', ...TABLES].filter(t => !done.includes(t));

    empty.forEach(t => writes.push({ range: a1(titleOf(t), 'A1'), values: all[titleOf(t)] }));
    const handled = t => !readOnly(t) && done.includes(t) && !empty.includes(t);

    const memberRow = (m, header) => header.map(h => (h === '名稱' ? m.name : h === Sheet.ID ? m.id : null));
    const rowValues = (t, rec, header) => (t === 'members' ? memberRow(rec, header) : Sheet.encodeRow(t, rec, local.members, header));
    const overwritten = new Set();
    const put = (t, rec) => {
      const title = titleOf(t);
      const header = parsed.headers[title];
      const row = parsed.rowOf[title]?.[rec.id];
      const values = rowValues(t, rec, header);
      if (row) {
        writes.push({ range: a1(title, `A${row}`), values: [values] });
        overwritten.add(`${title}:${row}`);
      } else {
        (appends[title] ||= []).push(values);
      }
    };


    if (handled('members')) parsed.newMembers.forEach(m => put('members', m));

    snap.items.forEach(({ table: t, id, del }) => {
      if (!handled(t)) return;
      const title = titleOf(t);
      if (del) {
        const row = parsed.rowOf[title]?.[id];
        if (row) deletes.push({ sheetId: meta.sheetIds[title], row });
        return;
      }
      const rec = Store.get(t, id);
      if (rec) put(t, rec);
    });

    problems = problems.filter(p => !(p.row && overwritten.has(`${p.tab}:${p.row}`)));


    parsed.rewrites
      .filter(c => handled(c.table) && !overwritten.has(`${c.tab}:${c.row}`))
      .forEach(c => writes.push({ range: a1(c.tab, `${Sheet.colLetter(c.col)}${c.row}`), values: [[c.value]] }));


    const adds = parsed.adds.filter(a => handled(a.table));
    if (adds.length) {
      await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
        method: 'POST',
        body: { requests: adds.flatMap(a => Sheet.addColumnRequests(meta.sheetIds[a.tab], a)) },
      });
    }


    if (writes.length) {
      await api(`${Google.SHEETS}/${meta.id}/values:batchUpdate`, {
        method: 'POST',
        body: { valueInputOption: 'RAW', data: writes },
      });
    }
    if (deletes.length) {
      deletes.sort((a, b) => b.row - a.row);
      await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
        method: 'POST',
        body: {
          requests: deletes.map(d => ({
            deleteDimension: { range: { sheetId: d.sheetId, dimension: 'ROWS', startIndex: d.row - 1, endIndex: d.row } },
          })),
        },
      });
    }

    for (const [title, rows] of Object.entries(appends)) {
      await api(`${Google.SHEETS}/${meta.id}/values/${enc(a1(title, 'A1'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: { values: rows },
      });
    }


    const moves = parsed.moves.filter(m => handled(m.table));
    if (moves.length) {
      await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
        method: 'POST',
        body: {
          requests: moves.map(m => ({
            moveDimension: {
              source: { sheetId: meta.sheetIds[m.tab], dimension: 'COLUMNS', startIndex: m.from, endIndex: m.from + 1 },
              destinationIndex: m.to,
            },
          })),
        },
      });
    }
    if (MAIN && parsed.version < Sheet.VERSION && TABLES.every(t => done.includes(t))) {
      await api(`${Google.SHEETS}/${meta.id}/values:batchUpdate`, {
        method: 'POST',
        body: { valueInputOption: 'RAW', data: [{ range: a1(Sheet.META.title, 'A1'), values: Sheet.metaValues() }] },
      });
    }
    return done;
  }









  let lastCode = '';
  let wrongAccount = false;
  let wrongNoticed = '';
  const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  async function checkAccount() {
    if (!Google.tokenEmail()) {
      const about = await api(`${Google.DRIVE}/about?fields=user(emailAddress)`);
      Google.setTokenEmail(about.user.emailAddress);
    }
    const got = Google.tokenEmail();
    wrongAccount = false;
    if (sameEmail(got, cloud.email)) return;
    try {
      await api(`${Google.DRIVE}/files/${enc(cloud.spreadsheetId)}?fields=id`);
      cloud.email = got;
      saveCloud();
      return;
    } catch (e) {
      if (e.code !== 'not_found' && e.code !== 'forbidden') throw e;
    }
    wrongAccount = true;
    Google.clearToken();
    const msg = `現在登入的是 ${got}，這台裝置連結的是 ${cloud.email}，請重新登入、選 ${cloud.email}`;
    if (wrongNoticed !== got) {
      wrongNoticed = got;
      hooks.notify({ title: '登入的 Google 帳號不對', body: `${msg}。沒有寫進 ${got} 的雲端硬碟，這台裝置的資料也沒有動。` });
    }
    const e = new Error(msg);
    e.code = 'wrong_account';
    throw e;
  }

  async function run({ manual = false } = {}) {
    if (!cloud) return;
    if (running) { again = true; return; }
    if (!Google.hasToken()) { emit(); return; }
    running = true;
    error = '';
    offline = false;
    lastRunAt = Date.now();
    emit();
    const snap = Store.pendingSnapshot();
    lastCode = '';
    try {
      await checkAccount();
      let meta = await locate();
      if (!meta && !MAIN) {
        error = '找不到試算表，要先到記帳的網站連結 Google 帳號';
        return;
      }
      if (!meta) {

        const rebuild = confirm('雲端的「股票記錄簿」試算表找不到了，可能被刪除或丟進垃圾桶。\n\n'
          + '按「確定」：用這台裝置的資料重新建立一份。\n按「取消」：取消連結，這台裝置的資料會保留。');
        if (!rebuild) {
          disconnect();
          hooks.toast('已取消連結');
          hooks.notify({ title: '已取消連結', body: '雲端的試算表不見了，你選擇取消連結。這台裝置的資料還在，之後可以再連結。' });
          return;
        }
        meta = await createSpreadsheet(Store.exportPayload());
        Store.clearPending(snap);
        problems = [];
        incomplete = [];
        problemsAt = Date.now();
        cloud.spreadsheetId = meta.id;
        cloud.url = meta.url;
        hooks.toast('已用這台裝置的資料重新建立試算表');
        hooks.notify({ title: '已重新建立試算表', body: '雲端的試算表不見了，已用這台裝置的資料重新建立一份。' });
      } else if (snap.full && MAIN) {
        await writeAll(meta.id, Store.exportPayload());
        Store.clearPending(snap);
        problems = [];
        incomplete = [];
        problemsAt = Date.now();
      } else {
        Store.clearPending(snap, await exchange(meta, snap));
      }
      cloud.lastSyncAt = new Date().toISOString();
      saveCloud();
      okAt = Date.now();
      if (manual) hooks.toast('已同步');

      try { await refreshPrices(meta, manual); } catch (_) {}
    } catch (e) {
      lastCode = e.code || 'error';
      if (e.code === 'network') offline = true;
      else if (e.code !== 'need_login') error = e.message || String(e);
      if (manual && offline) hooks.toast('目前沒有網路，連上後會自動同步');
      else if (manual && error) hooks.toast(`同步失敗：${error}`, 'error');
    } finally {
      running = false;
      emit();
      if (again) {
        again = false;
        run();
      }
      if (!running) idleWaiters.splice(0).forEach(fn => fn());
    }
  }

  function schedule(ms = 3000) {
    clearTimeout(timer);
    timer = setTimeout(() => run(), ms);
  }


  async function link() {
    running = true;
    emit();
    try {
      const about = await api(`${Google.DRIVE}/about?fields=user(emailAddress)`);
      const email = about.user.emailAddress;
      Google.setTokenEmail(email);
      const snap = Store.pendingSnapshot();
      const local = Store.exportPayload();
      let meta = null;
      const found = await findSpreadsheet();
      if (found) meta = await info(found);


      const localCount = countRecords(local);
      const upload = () => !localCount || confirm(`這台裝置上有 ${localCount} 筆資料，會存到 ${email} 的 Google 試算表。\n\n`
        + '按「確定」：存過去並連結。\n按「取消」：先不連結。');
      if (!meta && !MAIN) {
        hooks.toast('這個帳號還沒有記錄簿，要先到記帳的網站連結 Google 帳號', 'error');
        return;
      }
      if (!meta) {
        if (!upload()) return;
        meta = await createSpreadsheet(local);
        Store.clearPending(snap);
      } else {
        await ensureTabs(meta);
        const parsed = Sheet.fromValues(await pull(meta), local.members);
        const remoteCount = countRecords(parsed.data);
        if (!MAIN) {

          Store.mergeRemote(parsed.data);
          hooks.onData();
        } else if (!remoteCount) {
          if (!upload()) return;
          await writeAll(meta.id, local);
          Store.clearPending(snap);
        } else {
          if (localCount) {
            const lines = TABLES.map(t => `${titleOf(t)} ${parsed.data[t].length} 筆`).join('、');
            const ok = confirm(`你的 Google 雲端硬碟裡已經有一份記錄簿（${lines}）。\n\n`
              + `按「確定」改用雲端的資料，這台裝置目前的 ${localCount} 筆資料會被取代（建議先匯出 data.json 備份）。\n`
              + '按「取消」先不連結。');
            if (!ok) return;
            hooks.notify({ title: '已改用雲端的資料', body: `連結時雲端已經有資料（${lines}），這台裝置原本的 ${localCount} 筆資料被取代了。` });
          }
          Store.loadRemote(parsed.data);
          hooks.onData();
        }
      }
      cloud = { email, spreadsheetId: meta.id, url: meta.url, lastSyncAt: new Date().toISOString() };
      saveCloud();
      Google.load();
      hooks.toast('已連結 Google 帳號');
    } catch (e) {
      hooks.toast(`連結失敗：${e.message || e}`, 'error');
    } finally {
      running = false;
      emit();
    }

    if (cloud) await run();
  }



  function login(after) {
    return Google.requestToken({ hint: cloud?.email || '', choose: wrongAccount }).then(
      () => {
        autoLoginTried = false;
        return after === 'link' ? link() : run({ manual: true });
      },
      e => {
        if (e.code === 'popup_failed_to_open') {
          Google.redirectLogin({ hint: cloud?.email || '', after });
          return;
        }
        if (e.code !== 'popup_closed' && e.code !== 'superseded') hooks.toast(e.message, 'error');
        emit();
      },
    );
  }

  const startLink = () => login('link');

  function syncNow() {
    if (Google.hasToken()) return run({ manual: true });
    if (!navigator.onLine) {
      noNetwork();
      hooks.toast('目前沒有網路，連上網路後再按「同步」');
      return Promise.resolve();
    }
    return login('sync');
  }


  function noNetwork() {
    offline = true;
    emit();
  }


  function loginByRedirect() {
    Google.redirectLogin({ hint: cloud?.email || '', after: cloud ? 'sync' : 'link' });
  }

  function disconnect() {
    cloud = null;
    error = '';
    offline = false;
    problems = [];
    incomplete = [];
    saveCloud();
    clearPrices();
    setAlertCheck(null);

    if (!MAIN) {
      Google.clearToken();
      return Promise.resolve();
    }
    return Google.signOut();
  }










  const PRICES_KEY = U.key('prices');
  const PRICE_EVERY = 5 * 60000;
  const PRICE_RETRY = 4000;
  let prices = null;
  try { prices = JSON.parse(localStorage.getItem(PRICES_KEY)); } catch (_) {}
  let priceKey = '';
  let priceWrittenAt = 0;
  let priceTimer = null;
  let priceMeta = null;
  let pricing = null;

  function savePrices() {
    try {
      if (prices) localStorage.setItem(PRICES_KEY, JSON.stringify(prices));
      else localStorage.removeItem(PRICES_KEY);
    } catch (_) {}
  }

  function clearPrices() {
    clearTimeout(priceTimer);
    prices = null;
    priceKey = '';
    priceWrittenAt = 0;
    priceMeta = null;
    savePrices();
  }


  function refreshPrices(meta, force) {
    priceMeta = meta;
    if (!pricing) pricing = updatePrices(meta, force).finally(() => { pricing = null; });
    return pricing;
  }


  function priceCodes() {
    const alerted = Store.list('alerts', 'all').map(r => U.toHalf(r.code ?? '').trim().toUpperCase());
    const held = U.site === 'stockbook' ? Holdings.heldCodes(U.today()) : [];
    return [...new Set([...held, ...alerted])].filter(c => /^[0-9A-Z]+$/.test(c)).sort();
  }

  async function updatePrices(meta, force = false) {
    const codes = priceCodes();
    const key = codes.join(',');
    if (!force && key === priceKey && Date.now() - priceWrittenAt < PRICE_EVERY) return;
    const title = Sheet.PRICES.title;
    if (meta.sheetIds[title] === undefined) {
      const r = await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
        method: 'POST',
        body: { requests: [{ addSheet: { properties: { title, hidden: true } } }] },
      });
      meta.sheetIds[title] = r.replies[0].addSheet.properties.sheetId;
    }
    await api(`${Google.SHEETS}/${meta.id}/values:batchClear`, { method: 'POST', body: { ranges: [a1(title)] } });
    await api(`${Google.SHEETS}/${meta.id}/values:batchUpdate`, {
      method: 'POST',
      body: { valueInputOption: 'USER_ENTERED', data: [{ range: a1(title, 'A1'), values: Sheet.priceValues(codes) }] },
    });
    priceKey = key;
    priceWrittenAt = Date.now();
    await readPrices(meta.id, codes, 0);
  }

  async function readPrices(id, codes, tries) {
    const r = await api(`${Google.SHEETS}/${id}/values:batchGet?ranges=${enc(a1(Sheet.PRICES.title))}&valueRenderOption=UNFORMATTED_VALUE`);
    const got = new Map((r.valueRanges[0].values || []).slice(1).map(([c, v, t]) => [String(c ?? '').trim().toUpperCase(), { v, t }]));
    const old = prices?.quotes || {};
    const oldTimes = prices?.times || {};
    const stillLoading = v => /^loading/i.test(String(v ?? ''));
    const quotes = {};
    const times = {};
    const kept = {};
    let loading = false;
    codes.forEach(c => {
      const { v, t } = got.get(c) || {};
      if (typeof v === 'number') {
        quotes[c] = v;
        const time = Sheet.tradeTime(t);
        if (time) times[c] = time;
        if (stillLoading(t)) loading = true;
      } else if (v === undefined || v === '' || stillLoading(v)) {
        loading = true;
        if (c in old) {
          quotes[c] = old[c];
          if (oldTimes[c]) times[c] = oldTimes[c];
          const was = prices?.kept?.[c] || prices?.at;
          if (was) kept[c] = was;
        }
      } else quotes[c] = null;
    });
    const fresh = codes.some(c => typeof got.get(c)?.v === 'number');
    prices = { at: fresh ? new Date().toISOString() : prices?.at || null, quotes, times, kept };
    savePrices();
    hooks.onPrices();
    if (loading && tries < 3) {
      clearTimeout(priceTimer);
      priceTimer = setTimeout(() => {
        if (cloud?.spreadsheetId === id) readPrices(id, codes, tries + 1).catch(() => {});
      }, PRICE_RETRY);
    }
  }






  const LIVE_CHECK = 30000;
  const LIVE_FROM = 9 * 60;
  const LIVE_TO = 14 * 60;
  let liveTriedAt = 0;
  let liveWasStopped = false;


  function trading() {
    const t = new Date(Date.now() + 8 * 3600e3);
    const day = t.getUTCDay();
    const min = t.getUTCHours() * 60 + t.getUTCMinutes();
    return day >= 1 && day <= 5 && min >= LIVE_FROM && min < LIVE_TO;
  }


  const liveStopped = () => !!cloud && !Google.hasToken() && trading() && priceCodes().length > 0;



  const LATE_AFTER = 30;
  let lateShown = 0;
  function priceLate() {
    if (!cloud || !prices?.at || !trading()) return 0;
    const twDay = ms => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
    if (twDay(Date.parse(prices.at)) !== twDay(Date.now())) return 0;
    const min = (Date.now() - Date.parse(prices.at)) / 60000;
    return min >= LATE_AFTER ? Math.floor(min / 10) * 10 : 0;
  }

  function livePrices() {
    if (priceLate() !== lateShown) {
      lateShown = priceLate();
      hooks.onPrices();
    }
    if (liveStopped() !== liveWasStopped) {
      liveWasStopped = !liveWasStopped;
      emit();
    }
    if (!cloud || !priceMeta || running || loggingOut || document.hidden || !Google.hasToken() || !trading()) return null;

    if (!priceCodes().length) return null;
    if (Date.now() - Math.max(priceWrittenAt, liveTriedAt) < PRICE_EVERY) return null;
    liveTriedAt = Date.now();
    return refreshPrices(priceMeta, true).catch(() => {});
  }



  const idle = () => (running ? new Promise(fn => idleWaiters.push(fn)) : Promise.resolve());



  function logoutBlocker(ok) {
    const lines = [];
    if (!ok) {
      lines.push(offline ? '目前沒有網路，連上網路後再按一次「登出」。'
        : error ? `同步失敗：${error}\n請稍後再按一次「登出」。`
        : '還沒同步完成，請再按一次「登出」。');
    } else if (incomplete.length) {

      const tabs = incomplete.map(titleOf);
      const fix = problems.filter(p => tabs.includes(p.tab) && p.row === 1).map(Sheet.problemText);
      lines.push(`試算表的標題被改過，「${tabs.join('」「')}」的資料沒辦法寫回試算表：`,
        ...(fix.length ? fix : ['請到「訊息」看要改回哪個標題']), '改回來之後，再按一次「登出」。');
    } else if (Store.pendingCount()) {
      lines.push(`還有 ${Store.pendingCount()} 筆沒有同步完成，請再按一次「登出」。`);
    }
    return lines.length ? `還不能登出：要先確定試算表裡有這台裝置的全部資料，登出才不會遺失。\n\n${lines.join('\n')}` : '';
  }


  async function logout() {
    if (!cloud || loggingOut) return;
    loggingOut = true;
    emit();
    let wiped = false;
    try {
      if (!Google.hasToken()) await Google.requestToken({ hint: cloud.email, choose: wrongAccount });
      wiped = await finishLogout();
    } catch (e) {
      if (e.code === 'popup_failed_to_open') hooks.toast('登入視窗打不開，請先用「改用整頁登入」同步，再按「登出」', 'error');
      else if (e.code !== 'popup_closed' && e.code !== 'superseded') hooks.toast(e.message || String(e), 'error');
    } finally {

      if (wiped) hooks.onLogout();
      else {
        loggingOut = false;
        emit();
      }
    }
  }


  async function finishLogout() {
    autoLoginTried = false;
    clearTimeout(timer);
    await idle();
    const start = Date.now();
    await run();
    await idle();
    if (!cloud) return false;

    if (lastCode === 'wrong_account') {
      if (confirm(`登入的不是 ${cloud.email}，沒辦法確認試算表裡有這台裝置的全部資料，所以不能登出。\n\n`
        + '按「確定」：只取消連結，這台裝置的資料留著，不會寫到任何雲端硬碟（之後可以再連結）。\n'
        + `按「取消」：先不動，之後用 ${cloud.email} 再試。`)) {
        await disconnect();
        hooks.toast('已取消連結，這台裝置的資料還在');
      }
      return false;
    }
    const blocker = logoutBlocker(okAt >= start && !error && !offline);
    if (blocker) {
      alert(blocker);
      return false;
    }
    if (!confirm(`登出後，這台裝置上的記錄簿資料會清除。\n資料都存在 ${cloud.email} 的 Google 試算表裡，下次登入會再抓回來。\n\n確定登出？`)) return false;
    await disconnect();
    Store.wipe();
    return true;
  }



  function changed() {
    if (!cloud) return;
    if (Google.hasToken()) {
      emit();
      schedule();
      return;
    }
    if (!navigator.onLine) {
      noNetwork();
      return;
    }
    emit();
    if (!Google.ready()) Google.load();
    if (autoLoginTried || !Google.ready()) return;
    autoLoginTried = true;
    Google.requestToken({ hint: cloud.email, choose: wrongAccount }).then(() => { autoLoginTried = false; run(); }, () => emit());
  }


  function init(h) {
    hooks = { ...hooks, ...h };
    Store.onChange(changed);
    if (cloud) Google.load();

    if (!cloud && Store.pendingCount()) Store.dropPending();

    const back = Google.consumeRedirect();
    if (back?.error) hooks.toast(back.error, 'error');
    else if (back?.after === 'link') link();
    else if (cloud) run({ manual: back?.after === 'sync' });


    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      emit();
      if (cloud && Google.hasToken() && Date.now() - lastRunAt > 30000) run();
    });

    window.addEventListener('online', () => {
      if (cloud && Google.hasToken()) run();
      else emit();
    });
    setInterval(livePrices, LIVE_CHECK);
    emit();
  }

  return { init, state, linked: () => !!cloud, prices: () => prices, priceLate, alertCheck: () => alertCheck, alertScript: () => alertScript, startLink, syncNow, loginByRedirect, logout };
})();
