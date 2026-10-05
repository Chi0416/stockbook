// 和 Google 試算表同步：試算表是正本，這台裝置上存的是副本
//   連結：第一次登入時找這個 App 之前建立的試算表；沒有就建立一份，寫入這台裝置的資料
//   同步：確認試算表還在（不見了就用這台裝置的資料重建）→ 讀回全部分頁 →
//         以試算表的資料為主、疊上這台裝置還沒送出的修改 → 把修改寫回試算表
//         寫回時用 id 找到那一列再改，不靠列號；長輩手動輸入、沒有 id 的列會補上 id
//   時機：打開 App、從背景切回來、修改資料後（等幾秒一起送），登入還有效就自動同步
//         登入過期時，修改資料的那一下順便跳出 Google 視窗；沒成功就顯示「同步」按鈕讓使用者按
//   登出：先同步一次，確定試算表已經有這台裝置的全部資料，才清掉這台裝置上的資料（換帳號時不會混在一起）
const Sync = (() => {
  const CLOUD_KEY = 'stockbook.cloud';
  const MARK = 'stockbook'; // 試算表上的標記（雲端硬碟的 appProperties），用來找回這份試算表
  const MASS_DELETE = 5; // 試算表裡一次少了這麼多筆時，先問使用者再跟著刪除
  const TABLES = Object.keys(SCHEMAS);
  const api = Google.api;
  const enc = encodeURIComponent;

  // 'title'!A1 的寫法（分頁名稱用單引號包起來，中文名稱也沒問題）；沒有 ref 時是整個分頁
  const a1 = (title, ref = '') => `'${title.replace(/'/g, "''")}'${ref ? `!${ref}` : ''}`;
  const titleOf = t => (t === 'members' ? Sheet.MEMBERS.title : Sheet.TAB[t].title);
  const countRecords = d => TABLES.reduce((n, t) => n + (d[t]?.length || 0), 0);

  // ---------- 連結狀態：{ email, spreadsheetId, url, lastSyncAt } ----------
  let cloud = null;
  try { cloud = JSON.parse(localStorage.getItem(CLOUD_KEY)); } catch (_) {}

  function saveCloud() {
    try {
      if (cloud) localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud));
      else localStorage.removeItem(CLOUD_KEY);
    } catch (_) {}
  }

  // ---------- 狀態與通知畫面 ----------
  let running = false;
  let again = false;
  let error = '';
  let offline = false; // 上次同步時沒有網路（連上後自動再同步）
  let problems = [];
  let problemsAt = 0; // 這次打開 App 後，最近一次檢查試算表內容的時間（訊息匣用來判斷問題解決了沒）
  let okAt = 0;       // 這次打開 App 後，最近一次同步成功的時間
  let incomplete = []; // 上次同步時試算表缺欄位、沒辦法寫回去的表：這幾張表 App 裡的資料比試算表完整
  let lastRunAt = 0;
  let timer = null;
  let autoLoginTried = false;
  let loggingOut = false;
  let idleWaiters = []; // 等同步跑完的人（登出用）
  // notify：重要的事留在訊息匣（{ title, body }）；onLogout：登出、清掉資料之後（app.js 重新載入頁面）
  let hooks = { onData() {}, onStatus() {}, toast() {}, notify() {}, onLogout() {} };

  function state() {
    return {
      linked: !!cloud,
      email: cloud?.email || '',
      url: cloud?.url || '',
      lastSyncAt: cloud?.lastSyncAt || null,
      running,
      error,
      offline,
      problems,
      problemsAt,
      okAt,
      loggingOut,
      needLogin: !!cloud && !Google.hasToken(),
      pending: Store.pendingCount(),
    };
  }

  const emit = () => hooks.onStatus(state());

  // ---------- 找到、建立試算表 ----------
  async function findSpreadsheet() {
    const q = `appProperties has { key='${MARK}' and value='1' } and trashed=false`
      + " and mimeType='application/vnd.google-apps.spreadsheet'";
    const r = await api(`${Google.DRIVE}/files?q=${enc(q)}&orderBy=createdTime&fields=files(id)`);
    return r.files?.[0]?.id || null;
  }

  // 試算表的網址和各分頁的 id；在垃圾桶裡或找不到時回傳 null
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

  // 清空每個分頁後寫入全部資料（建立試算表、匯入資料後用）
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
    // 先標記再寫資料：中途失敗時，下次還找得到這份試算表
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

  // 被刪掉或改名的分頁補建回來（含格式），之後當作空分頁寫入這台裝置的資料
  async function ensureTabs(meta) {
    const need = Sheet.readRanges().filter(t => meta.sheetIds[t] === undefined);
    if (!need.length) return;
    const r = await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
      method: 'POST',
      body: { requests: need.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) },
    });
    r.replies.forEach(x => { meta.sheetIds[x.addSheet.properties.title] = x.addSheet.properties.sheetId; });
    await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
      method: 'POST',
      body: { requests: Sheet.setupRequests(Object.fromEntries(need.map(t => [t, meta.sheetIds[t]]))) },
    });
  }

  // 找到這次要同步的試算表（每次都重新確認：分頁可能被刪、試算表可能被丟到垃圾桶）
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
    const titles = Sheet.readRanges();
    const ranges = titles.map(t => `ranges=${enc(a1(t))}`).join('&');
    const r = await api(`${Google.SHEETS}/${meta.id}/values:batchGet?${ranges}`
      + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
    return Object.fromEntries(titles.map((t, i) => [t, r.valueRanges[i].values || []]));
  }

  // ---------- 讀回、合併、寫回 ----------
  // 試算表裡一次少了很多筆（可能是不小心選取一大片刪掉）：先問要跟著刪除，還是保留並寫回試算表
  //   選保留時，這幾筆標成待同步並加進這次的快照，接下來和其他修改一起寫回去
  function keepOrDelete(parsed, skip, snap) {
    const pending = new Set(snap.items.map(i => `${i.table}:${i.id}`));
    const gone = TABLES.filter(t => !skip.includes(t)).flatMap(t => {
      const remote = new Set(parsed.data[t].map(r => r.id));
      return Store.list(t, 'all')
        .filter(r => !remote.has(r.id) && !pending.has(`${t}:${r.id}`))
        .map(r => ({ table: t, id: r.id }));
    });
    if (gone.length < MASS_DELETE) return;
    const lines = TABLES.map(t => [t, gone.filter(g => g.table === t).length])
      .filter(([, n]) => n).map(([t, n]) => `${SCHEMAS[t].title} ${n} 筆`).join('、');
    const del = confirm(`試算表裡少了 ${gone.length} 筆資料（${lines}），可能是在試算表或其他裝置上刪除了。\n\n`
      + '按「確定」：這台裝置也跟著刪除。\n按「取消」：保留這些資料，並寫回試算表。');
    hooks.notify({
      title: `試算表裡少了 ${gone.length} 筆資料`,
      body: `${lines}。你選擇：${del ? '這台裝置也跟著刪除' : '保留，並寫回試算表'}。`,
    });
    if (del) return;
    Store.markPending(gone);
    const items = new Map(Store.pendingSnapshot().items.map(i => [`${i.table}:${i.id}`, i]));
    gone.forEach(g => snap.items.push(items.get(`${g.table}:${g.id}`)));
  }

  // 回傳這次處理到的表；缺欄位的表不處理，修改留在待同步清單
  async function exchange(meta, snap) {
    const byTitle = await pull(meta);
    const parsed = Sheet.fromValues(byTitle, Store.members());
    problems = parsed.problems;
    problemsAt = Date.now();

    // 整個分頁是空的（剛補建或被清空）：用這台裝置的資料整張寫回去；缺欄位的表先不動
    const empty = ['members', ...TABLES].filter(t => !byTitle[titleOf(t)].length);
    const skip = [...new Set([...parsed.broken, ...empty])];
    keepOrDelete(parsed, skip, snap);
    Store.mergeRemote(parsed.data, skip);
    hooks.onData();

    const local = Store.exportPayload();
    const all = Sheet.toValues(local);
    const writes = [];
    const appends = {};
    const deletes = [];
    const done = ['members', ...TABLES].filter(t => !parsed.broken.includes(t) || empty.includes(t));
    incomplete = ['members', ...TABLES].filter(t => !done.includes(t));

    empty.forEach(t => writes.push({ range: a1(titleOf(t), 'A1'), values: all[titleOf(t)] }));
    const handled = t => done.includes(t) && !empty.includes(t);

    parsed.addIdHeader.forEach(({ tab, col }) => writes.push({ range: a1(tab, `${Sheet.colLetter(col)}1`), values: [[Sheet.ID]] }));
    parsed.idFixes.forEach(({ tab, row, col, id }) => writes.push({ range: a1(tab, `${Sheet.colLetter(col)}${row}`), values: [[id]] }));

    const memberRow = (m, header) => header.map(h => (h === '名稱' ? m.name : h === Sheet.ID ? m.id : null));
    const rowValues = (t, rec, header) => (t === 'members' ? memberRow(rec, header) : Sheet.encodeRow(t, rec, local.members, header));
    const overwritten = new Set(); // 這次用這台裝置的版本整列寫回的列
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

    // 試算表裡打了新的成員名字：補到「成員」分頁
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
    // 在 App 裡改好、這次整列寫回的資料，試算表上原本看不懂的地方已經不算問題了
    problems = problems.filter(p => !(p.row && overwritten.has(`${p.tab}:${p.row}`)));

    // 順序：先改既有的列（不影響列號）→ 由下往上刪（前面的列號才不會跑掉）→ 最後才新增
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
    // 新增的列最後才加：可能插在中間（試算表裡有空白列時），之後就不能再依列號操作
    for (const [title, rows] of Object.entries(appends)) {
      await api(`${Google.SHEETS}/${meta.id}/values/${enc(a1(title, 'A1'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: { values: rows },
      });
    }
    return done;
  }

  // ---------- 同步一次 ----------
  // 登入過期時不跳出視窗（要使用者點按鈕），只更新狀態；manual 為 true 時完成後提示
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
    try {
      let meta = await locate();
      if (!meta) {
        // 試算表被刪掉或丟進垃圾桶：不小心的話重建；想重新開始的話取消連結
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
      } else if (snap.full) {
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
    } catch (e) {
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

  // ---------- 連結 ----------
  async function link() {
    running = true;
    emit();
    try {
      const about = await api(`${Google.DRIVE}/about?fields=user(emailAddress)`);
      const email = about.user.emailAddress;
      const local = Store.exportPayload();
      let meta = null;
      const found = await findSpreadsheet();
      if (found) meta = await info(found);

      // 雲端還沒有資料時，這台裝置的資料會寫過去：先確認是這個帳號（例如之前留著別人的資料）
      const localCount = countRecords(local);
      const upload = () => !localCount || confirm(`這台裝置上有 ${localCount} 筆資料，會存到 ${email} 的 Google 試算表。\n\n`
        + '按「確定」：存過去並連結。\n按「取消」：先不連結。');
      if (!meta) {
        if (!upload()) return;
        meta = await createSpreadsheet(local);
        Store.clearAllPending();
      } else {
        await ensureTabs(meta);
        const parsed = Sheet.fromValues(await pull(meta), local.members);
        const remoteCount = countRecords(parsed.data);
        if (!remoteCount) {
          if (!upload()) return;
          await writeAll(meta.id, local);
          Store.clearAllPending();
        } else {
          if (localCount) {
            const lines = TABLES.map(t => `${SCHEMAS[t].title} ${parsed.data[t].length} 筆`).join('、');
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
      hooks.toast('已連結 Google 帳號');
    } catch (e) {
      hooks.toast(`連結失敗：${e.message || e}`, 'error');
    } finally {
      running = false;
      emit();
    }
    // 補上長輩手動輸入的資料缺的 id 等
    if (cloud) await run();
  }

  // ---------- 按鈕 ----------
  // 必須在使用者點擊的當下呼叫：登入過期時要先跳出 Google 視窗
  function login(after) {
    return Google.requestToken({ hint: cloud?.email || '' }).then(
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
    return Google.hasToken() ? run({ manual: true }) : login('sync');
  }

  // 彈出視窗在某些手機上不能用時，改成整頁跳轉登入
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
    return Google.signOut();
  }

  // ---------- 登出 ----------
  // 等目前的同步（和排在後面的那一次）都跑完
  const idle = () => (running ? new Promise(fn => idleWaiters.push(fn)) : Promise.resolve());

  // 不能登出的原因（試算表還沒有這台裝置的全部資料）；可以登出時回傳空字串
  //   ok：這次同步成功了
  function logoutBlocker(ok) {
    const lines = [];
    if (!ok) {
      lines.push(offline ? '目前沒有網路，連上網路後再按一次「登出」。'
        : error ? `同步失敗：${error}\n請稍後再按一次「登出」。`
        : '還沒同步完成，請再按一次「登出」。');
    } else if (incomplete.length) {
      // 缺欄位的表沒辦法寫回試算表（見 exchange）；改回標題的說明在 problems 裡
      const tabs = incomplete.map(titleOf);
      const fix = problems.filter(p => tabs.includes(p.tab) && p.row === 1).map(Sheet.problemText);
      lines.push(`試算表的標題被改過，「${tabs.join('」「')}」的資料沒辦法寫回試算表：`,
        ...(fix.length ? fix : ['請到「訊息」看要改回哪個標題']), '改回來之後，再按一次「登出」。');
    } else if (Store.pendingCount()) {
      lines.push(`還有 ${Store.pendingCount()} 筆沒有同步完成，請再按一次「登出」。`);
    }
    return lines.length ? `還不能登出：要先確定試算表裡有這台裝置的全部資料，登出才不會遺失。\n\n${lines.join('\n')}` : '';
  }

  // 必須在使用者點擊的當下呼叫：登入過期時要先跳出 Google 視窗（第一個 await 之前）
  async function logout() {
    if (!cloud || loggingOut) return;
    loggingOut = true;
    emit();
    let wiped = false;
    try {
      if (!Google.hasToken()) await Google.requestToken({ hint: cloud.email });
      wiped = await finishLogout();
    } catch (e) {
      if (e.code === 'popup_failed_to_open') hooks.toast('登入視窗打不開，請先用「改用整頁登入」同步，再按「登出」', 'error');
      else if (e.code !== 'popup_closed' && e.code !== 'superseded') hooks.toast(e.message || String(e), 'error');
    } finally {
      // 清掉資料之後不再更新畫面（訊息匣會把舊的訊息寫回去），交給 app.js 重新載入頁面
      if (wiped) hooks.onLogout();
      else {
        loggingOut = false;
        emit();
      }
    }
  }

  // 回傳是否已經清掉資料
  async function finishLogout() {
    autoLoginTried = false;
    clearTimeout(timer);
    await idle();
    const start = Date.now();
    await run();
    await idle();
    if (!cloud) return false; // 同步時發現試算表不見了、選擇取消連結：資料留在這台裝置
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

  // 資料改了：登入有效就等幾秒後一起送出；過期了，趁這次點擊（儲存、刪除）跳出 Google 視窗
  //   每次打開 App 只自動跳一次，被關掉或失敗就改顯示「同步」按鈕，不一直打擾
  function changed() {
    if (!cloud) return;
    emit();
    if (Google.hasToken()) {
      schedule();
      return;
    }
    if (autoLoginTried || !Google.ready()) return;
    autoLoginTried = true;
    Google.requestToken({ hint: cloud.email }).then(() => { autoLoginTried = false; run(); }, () => emit());
  }

  // ---------- 啟動 ----------
  function init(h) {
    hooks = { ...hooks, ...h };
    Store.onChange(changed);

    const back = Google.consumeRedirect();
    if (back?.error) hooks.toast(back.error, 'error');
    else if (back?.after === 'link') link();
    else if (cloud) run({ manual: back?.after === 'sync' });

    // 從背景切回來時抓一次最新資料（長輩可能在試算表裡改過），也更新「上次同步是幾小時前」的提示
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      emit();
      if (cloud && Google.hasToken() && Date.now() - lastRunAt > 30000) run();
    });
    // 網路恢復時馬上同步
    window.addEventListener('online', () => { if (cloud && Google.hasToken()) run(); });
    emit();
  }

  return { init, state, startLink, syncNow, loginByRedirect, logout };
})();
