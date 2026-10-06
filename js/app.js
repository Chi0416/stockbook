// 進入點：分頁、列表、表單、Google 雲端硬碟同步、訊息匣、家庭成員、資料備份
(() => {
  const TAB_KEY = 'stockbook.tab';
  const LOGOUT_KEY = 'stockbook.loggedOut'; // 登出後重新載入頁面時顯示「已登出」（sessionStorage，登出清資料時不會被清掉）
  const $ = id => document.getElementById(id);

  // ---------- 提示訊息（有開啟的 sheet 時顯示在 sheet 上層） ----------
  const toastEl = $('toast');
  let toastTimer;
  function toast(msg, kind = '') {
    (document.querySelector('dialog[open]') || document.body).appendChild(toastEl);
    toastEl.textContent = msg;
    toastEl.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, kind === 'error' ? 3500 : 1800);
  }

  // ---------- 列表與表單 ----------
  // 持股總覽、資料表與推算頁面都有列表；推算頁面點卡片時開啟來源資料表的編輯表單
  const PAGES = { overview: OVERVIEW, ...SCHEMAS, ...VIEWS };
  const lists = {};
  let current = 'overview';

  lists.overview = createOverview();
  $('panels').appendChild(lists.overview.el);
  Object.entries({ ...SCHEMAS, ...VIEWS }).forEach(([key, page]) => {
    const formKey = page.source || key;
    lists[key] = createList(key, page, { openForm: id => Form.open(formKey, id) });
    $('panels').appendChild(lists[key].el);
  });

  Form.init({
    toast,
    onChanged(key, rec) {
      lists[key].changed(rec);
      // 推算頁面跟著重算；正在看的那頁順便標亮剛改的那筆
      Object.entries(VIEWS).forEach(([v, view]) => {
        if (view.source === key && current === v) lists[v].changed(rec);
        else lists[v].refresh();
      });
      lists.overview.refresh();
    },
  });

  // ---------- 分頁 ----------
  const tabBtns = [...document.querySelectorAll('.tabbar [data-tab]')];
  const addBtn = $('btn-add');
  const addWhat = addBtn.querySelector('.add-what');

  // 標題後面的小字（頁面有 subtitle() 才顯示，例如持股總覽的今天日期）
  function renderSubtitle() {
    const subEl = $('page-sub');
    if (!subEl) return; // 瀏覽器還拿著舊版 index.html 時不要讓整個頁面壞掉
    const sub = PAGES[current].subtitle ? PAGES[current].subtitle() : '';
    subEl.textContent = sub;
    subEl.hidden = !sub;
  }

  function showTab(key) {
    if (!lists[key]) key = 'overview';
    current = key;
    $('page-title').textContent = PAGES[key].title;
    renderSubtitle();
    // 只有資料表能新增：按鈕寫出會新增到哪一頁（手機上只顯示「新增」），其他頁面隱藏
    const table = SCHEMAS[key];
    addBtn.disabled = !table;
    if (table) {
      addWhat.textContent = table.title;
      addBtn.setAttribute('aria-label', `新增${table.title}`);
    }
    tabBtns.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === key)));
    Object.entries(lists).forEach(([k, l]) => { l.el.hidden = k !== key; });
    try { localStorage.setItem(TAB_KEY, key); } catch (_) {}
  }

  tabBtns.forEach(b => b.addEventListener('click', () => {
    showTab(b.dataset.tab);
    window.scrollTo(0, 0);
  }));
  addBtn.addEventListener('click', () => Form.open(current, null));

  const refreshAll = () => Object.values(lists).forEach(l => l.refresh());

  // ---------- 切換檢視的成員（全家／單一成員） ----------
  const memberSwitch = $('member-switch');

  function renderMemberSwitch() {
    const members = Store.members();
    memberSwitch.hidden = members.length < 2;
    memberSwitch.innerHTML = '<option value="all">全家</option>' +
      members.map(m => `<option value="${U.esc(m.id)}">${U.esc(m.name)}</option>`).join('');
    memberSwitch.value = Store.scope;
  }

  memberSwitch.addEventListener('change', () => {
    Store.setScope(memberSwitch.value);
    refreshAll();
    window.scrollTo(0, 0);
  });

  // ---------- 家庭成員管理 ----------
  const memberListEl = $('member-list');

  function renderMembers() {
    const members = Store.members();
    memberListEl.innerHTML = members.map(m => {
      const counts = Object.entries(Store.memberCounts(m.id))
        .map(([t, n]) => `${SCHEMAS[t].title} ${n}`).join(' · ');
      return `
        <li>
          <span class="member-info"><b>${U.esc(m.name)}</b><small>${U.esc(counts)}</small></span>
          <button type="button" class="text-btn" data-act="rename" data-id="${U.esc(m.id)}">改名</button>
          ${members.length > 1
            ? `<button type="button" class="text-btn danger" data-act="remove" data-id="${U.esc(m.id)}">刪除</button>` : ''}
        </li>`;
    }).join('');
  }

  // 問名字：空白或和其他成員重複時回傳 null
  function askName(message, current = '', exceptId = null) {
    const name = (prompt(message, current) ?? '').trim();
    if (!name) return null;
    if (Store.members().some(m => m.name === name && m.id !== exceptId)) {
      toast(`已經有「${name}」了`, 'error');
      return null;
    }
    return name;
  }

  function membersChanged() {
    renderMembers();
    renderMemberSwitch();
    renderBackupInfo();
    refreshAll();
  }

  $('btn-add-member').addEventListener('click', () => {
    const name = askName('新成員的名字（例如：爸爸、媽媽）');
    if (!name) return;
    Store.addMember(name);
    membersChanged();
    toast(`已新增「${name}」`);
  });

  memberListEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const old = Store.memberName(id);

    if (btn.dataset.act === 'rename') {
      const name = askName('新的名字', old, id);
      if (!name || name === old) return;
      Store.renameMember(id, name);
      membersChanged();
      toast('已改名');
      return;
    }

    const counts = Object.entries(Store.memberCounts(id)).filter(([, n]) => n > 0);
    const detail = counts.length
      ? `\n\n會一併刪除${counts.map(([t, n]) => ` ${n} 筆${SCHEMAS[t].title}`).join('、')}，無法復原，建議先匯出備份。`
      : '';
    if (!confirm(`確定刪除成員「${old}」？${detail}`)) return;
    Store.removeMember(id);
    membersChanged();
    toast(`已刪除「${old}」`);
  });

  // ---------- 資料備份 ----------
  const menu = $('menu-sheet');

  function renderBackupInfo() {
    $('stats').innerHTML = Object.entries(SCHEMAS).map(([k, s]) =>
      `<div><dt>${s.title}</dt><dd>${Store.list(k, 'all').length}</dd></div>`).join('');
    const t = Store.lastExportAt();
    $('last-export').textContent = t ? `上次匯出：${U.fmtDateTime(t)}` : '尚未匯出過備份';
  }

  function openMenu() {
    renderMembers();
    renderBackupInfo();
    if (!menu.open) menu.showModal();
  }

  $('btn-menu').addEventListener('click', openMenu);
  menu.querySelector('[data-act="close"]').addEventListener('click', () => menu.close());
  menu.addEventListener('click', e => { if (e.target === menu) menu.close(); }); // 點背景關閉

  // ---------- 隱藏金額（見 privacy.js）：設定選單的開關；總覽的眼睛在 overview.js ----------
  const hideSwitch = $('hide-amounts');
  if (hideSwitch) {
    hideSwitch.checked = Privacy.hidden;
    hideSwitch.addEventListener('change', () => Privacy.set(hideSwitch.checked));
  }
  Privacy.onChange(hidden => {
    if (hideSwitch) hideSwitch.checked = hidden;
    refreshAll();
    toast(hidden ? '已隱藏金額' : '已顯示金額');
  });

  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('btn-export').addEventListener('click', async () => {
    const json = JSON.stringify(Store.exportPayload(), null, 2);
    const file = new File([json], 'data.json', { type: 'application/json' });
    // 手機優先用分享選單（可「儲存到檔案」或傳到雲端），不支援時改成直接下載
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        if (e.name === 'AbortError') return;
        download(file);
      }
    } else {
      download(file);
    }
    Store.markExported();
    renderBackupInfo();
    toast('已匯出 data.json');
  });

  const fileInput = $('file-import');
  $('btn-import').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;

    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch (e) {
      toast('無法讀取：不是有效的 JSON 檔', 'error');
      return;
    }
    const parsed = Store.parseImport(obj);
    if (!parsed) {
      toast('檔案內容不是記錄簿的備份格式', 'error');
      return;
    }

    const lines = [
      `家庭成員：${Store.members().length} → ${parsed.members.length} 位（${parsed.members.map(m => m.name).join('、')}）`,
      ...Object.entries(SCHEMAS).map(([k, s]) => `${s.title}：${Store.list(k, 'all').length} → ${parsed[k].length} 筆`),
    ];
    if (!confirm(`匯入「${file.name}」會取代目前所有資料。\n\n${lines.join('\n')}\n\n確定匯入？`)) return;

    Store.replaceAll(parsed);
    renderMemberSwitch();
    Object.values(lists).forEach(l => l.reset());
    renderMembers();
    renderBackupInfo();
    toast('匯入完成');
  });

  // ---------- Google 雲端硬碟（同步的流程見 sync.js） ----------
  const cloudEl = $('cloud');
  const syncBar = $('sync-bar');
  const syncText = syncBar.querySelector('.sync-text');
  const syncBtn = syncBar.querySelector('.sync-btn');
  let syncAction = null;

  // 「3 小時前」；超過這麼久沒同步、登入又過期時，上方提示列提醒按「同步」
  const STALE = 60 * 60000;
  function ago(iso) {
    const min = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 60000));
    if (min < 60) return `${min} 分鐘前`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h} 小時前` : `${Math.floor(h / 24)} 天前`;
  }

  const offlineText = st => (st.pending
    ? `目前沒有網路，${st.pending} 筆資料會在連上網路後自動同步`
    : '目前沒有網路，連上後會自動同步');

  function syncStatusText(st) {
    if (st.running) return '同步中…';
    if (st.offline) return offlineText(st);
    if (st.error) return `同步失敗：${st.error}`;
    if (st.pending && st.needLogin) return `有 ${st.pending} 筆還沒同步，請按「同步」`;
    if (st.needLogin) return '登入已過期，按「同步」可以抓試算表的最新資料';
    if (st.pending) return `有 ${st.pending} 筆等待同步`;
    return '已是最新';
  }

  const redirectNote = '<p class="note muted">登入視窗打不開時，可以'
    + '<button type="button" class="link-btn" data-act="redirect">改用整頁登入</button>。</p>';

  function renderCloud(st) {
    if (!st.linked) {
      cloudEl.innerHTML = `
        <p class="note muted cloud-intro">連結後，資料會存到你自己的 Google 雲端硬碟（一份試算表）。手機和電腦登入同一個帳號，就能看到同一份資料，也可以直接用 Google 試算表查看、修改。</p>
        <button type="button" class="wide-btn primary" data-act="link" ${st.running ? 'disabled' : ''}>${st.running ? '連結中…' : '連結 Google 帳號'}</button>
        ${redirectNote}`;
      return;
    }
    cloudEl.innerHTML = `
      <ul class="member-list cloud-info">
        <li><span class="member-info"><small>帳號</small><b>${U.esc(st.email)}</b></span></li>
        <li><span class="member-info"><small>上次同步</small><b>${st.lastSyncAt ? U.fmtDateTime(st.lastSyncAt) : '—'}</b></span></li>
        <li><span class="member-info"><small>狀態</small><b class="${st.error ? 'warn' : ''}">${U.esc(syncStatusText(st))}</b></span></li>
      </ul>
      ${st.problems.length ? `
        <p class="note warn-text">試算表裡有 ${st.problems.length} 個地方看不懂，這幾筆可能會算錯。
          哪一列、哪一格請看<button type="button" class="link-btn" data-act="inbox">訊息</button>。</p>` : ''}
      <button type="button" class="wide-btn primary" data-act="sync" ${st.running ? 'disabled' : ''}>${st.running ? '同步中…' : '同步'}</button>
      ${st.url ? `<a class="wide-btn" href="${U.esc(st.url)}" target="_blank" rel="noopener">開啟試算表</a>` : ''}
      ${redirectNote}
      <button type="button" class="text-btn danger cloud-logout" data-act="logout" ${st.running || st.loggingOut ? 'disabled' : ''}>${st.loggingOut ? '登出中…' : '登出'}</button>
      <p class="note muted cloud-logout-note">登出會清除這台裝置上的資料，資料都還在試算表裡。要換別的 Google 帳號（例如幫家人記帳）時先登出。</p>`;
  }

  // 「同步」要在點擊的當下呼叫（登入過期時會跳出 Google 視窗）
  cloudEl.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'link') Sync.startLink();
    else if (act === 'sync') Sync.syncNow();
    else if (act === 'redirect') Sync.loginByRedirect();
    else if (act === 'logout') Sync.logout();
    else if (act === 'inbox') {
      menu.close();
      Inbox.open();
    }
  });

  // 畫面上方的提示列：只在需要使用者處理時出現；自動同步進行中不出現，免得一直閃
  function renderSyncBar(st) {
    let text = '';
    let btn = '';
    syncAction = null;
    if (!st.linked) {
      text = '';
    } else if (st.running) {
      if (syncBar.hidden) return;
      text = '同步中…';
    } else if (st.offline) {
      text = offlineText(st);
    } else if (st.error) {
      text = `同步失敗：${st.error}`;
      btn = '重試';
      syncAction = Sync.syncNow;
    } else if (st.pending && st.needLogin) {
      text = `有 ${st.pending} 筆還沒同步`;
      btn = '同步';
      syncAction = Sync.syncNow;
    } else if (st.needLogin && (!st.lastSyncAt || Date.now() - Date.parse(st.lastSyncAt) > STALE)) {
      // 登入過期就不會自動同步：試算表或其他裝置改過的資料，要按「同步」才看得到
      text = st.lastSyncAt ? `上次同步是 ${ago(st.lastSyncAt)}` : '還沒有同步過';
      btn = '同步';
      syncAction = Sync.syncNow;
    }
    syncBar.hidden = !text;
    syncText.textContent = text;
    syncBtn.hidden = !btn;
    syncBtn.textContent = btn;
  }

  syncBtn.addEventListener('click', () => { if (syncAction) syncAction(); });

  // ---------- 啟動 ----------
  if (!Store.available) {
    const banner = $('banner');
    banner.textContent = '這個瀏覽器目前不允許儲存資料（可能是無痕模式或隱私設定），輸入的資料關掉頁面後就會消失。';
    banner.hidden = false;
  }
  // 請瀏覽器盡量不要自動清掉這個網站的資料
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  renderMemberSwitch();
  refreshAll();
  // 換日後回到這個頁面（例如手機隔天從背景切回來）時全部重算：今天的日期、已入帳／待入帳都跟著變
  let renderedDay = U.today();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || U.today() === renderedDay) return;
    renderedDay = U.today();
    refreshAll();
    renderSubtitle();
  });
  let savedTab = 'overview';
  try { savedTab = localStorage.getItem(TAB_KEY) || 'overview'; } catch (_) {}
  showTab(savedTab);
  try {
    if (sessionStorage.getItem(LOGOUT_KEY)) {
      sessionStorage.removeItem(LOGOUT_KEY);
      toast('已登出，這台裝置上的資料已清除');
    }
  } catch (_) {}

  // ---------- 訊息匣（見 inbox.js） ----------
  // 點訊息：打開那一筆資料、打開試算表、切到相關頁面或同步
  Inbox.init({
    onAction(a) {
      if (a.type === 'record') {
        if (!Store.get(a.table, a.id)) {
          toast('這筆資料已經不在了');
          return;
        }
        showTab(a.table);
        Form.open(a.table, a.id);
      } else if (a.type === 'tab') {
        showTab(a.tab);
        window.scrollTo(0, 0);
      } else if (a.type === 'sheet') {
        const url = Sync.state().url;
        if (url) window.open(url, '_blank', 'noopener');
        else toast('還沒有連結 Google 試算表');
      } else if (a.type === 'sync') {
        Sync.syncNow();
      }
    },
  });
  // 資料有變動就重新核對（庫存快照對不上、股利算不出來、沒填代號）
  Inbox.checkData();
  Store.onChange(() => Inbox.checkData());

  // 試算表的資料讀回來之後，全部重畫
  Sync.init({
    toast,
    notify: Inbox.add,
    onData() {
      renderMemberSwitch();
      refreshAll();
      Inbox.checkData();
      if (menu.open) {
        renderMembers();
        renderBackupInfo();
      }
    },
    onStatus(st) {
      renderSyncBar(st);
      renderCloud(st);
      Inbox.syncStatus(st);
    },
    // 登出：這台裝置的資料已經清掉，重新載入頁面，畫面和記在記憶體裡的東西全部從空白開始
    onLogout() {
      try { sessionStorage.setItem(LOGOUT_KEY, '1'); } catch (_) {}
      location.reload();
    },
  });
})();
