// 進入點：分頁、列表、表單、Google 雲端硬碟同步、訊息匣、家庭成員、資料備份
//   底部 4 格：總覽｜記帳｜股利｜行情；記帳、股利、行情一格裡有好幾頁，在標題下面左右切換（見 GROUPS）
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
  const PAGES = { overview: OVERVIEW, ...SCHEMAS, ...VIEWS, yield: YIELD_PAGE, kd: KD_PAGE, eps: EPS_PAGE, stars: STARS_PAGE };
  const lists = {};
  let current = 'overview';

  lists.overview = createOverview();
  $('panels').appendChild(lists.overview.el);
  Object.entries({ ...SCHEMAS, ...VIEWS }).forEach(([key, page]) => {
    if (page.noList) return; // 觀察清單畫在行情的每一頁（見 market.js）
    const formKey = page.source || key;
    lists[key] = createList(key, page, { openForm: id => Form.open(formKey, id) });
    $('panels').appendChild(lists[key].el);
  });
  // 行情：每個指標一頁，加上把星星加起來的★ 星星；點卡片打開那一檔的詳細頁（見 market.js、detail.js）
  const MARKET = ['yield', 'kd', 'eps', 'stars'];
  const openStock = code => Detail.open(code);
  lists.yield = createMarket(YIELD_PAGE, { openStock });
  lists.kd = createMarket(KD_PAGE, { openStock });
  lists.eps = createMarket(EPS_PAGE, { openStock });
  lists.stars = createMarket(STARS_PAGE, { openStock });
  $('panels').append(lists.yield.el, lists.kd.el, lists.eps.el, lists.stars.el);
  const refreshMarket = () => MARKET.forEach(k => lists[k].refresh());

  // 新增、修改、刪除之後（表單、詳細頁的加入觀察清單）：相關的頁面重畫
  function onChanged(key, rec) {
    // 觀察清單：切到行情（不在行情時切到第一頁），剛加的那一檔閃一下；總覽的即將除權息也有觀察清單
    if (key === 'watch') {
      if (rec && !MARKET.includes(current)) showTab(MARKET[0]);
      MARKET.forEach(k => (k === current ? lists[k].changed(rec) : lists[k].refresh()));
      lists.overview.refresh();
      return;
    }
    lists[key].changed(rec);
    // 持股、自己記的除權息變了，行情跟著重算
    refreshMarket();
    // 推算頁面跟著重算；正在看的那頁順便標亮剛改的那筆
    Object.entries(VIEWS).forEach(([v, view]) => {
      if (view.source === key && current === v) lists[v].changed(rec);
      else lists[v].refresh();
    });
    lists.overview.refresh();
  }
  Form.init({ toast, onChanged });
  Detail.init({ toast, onChanged });

  // ---------- 分頁 ----------
  // 底部的每一格（key）和裡面的頁（pages：[頁面, 上方切換的名稱]）；只有一頁的不顯示上方切換
  //   點底部的另一格時一律先顯示第一頁（記帳先顯示交易明細，免得把交易記成快照）；點目前這一格只捲回最上面
  const GROUPS = [
    { key: 'overview', label: '總覽', pages: [['overview', '總覽']] },
    { key: 'book', label: '記帳', pages: [['trades', '交易明細'], ['snapshots', '庫存快照']] },
    { key: 'income', label: '股利', pages: [['cashDividends', '股利'], ['dividends', '除權息']] },
    { key: 'market', label: '行情', pages: [['yield', '殖利率'], ['kd', 'KD'], ['eps', 'EPS'], ['stars', '★ 星星']] },
  ];
  // 以前的頁面（殖利率分成庫存、觀察兩頁）：記在這台裝置的上次那一頁換成新的
  const OLD = { yieldHeld: 'yield', yieldWatch: 'yield' };
  const groupOf = key => GROUPS.find(g => g.key === key || g.pages.some(([k]) => k === key));
  // 新增按鈕：這一頁新增到哪張表、按鈕上寫什麼（手機上也寫出來）；總覽沒有新增按鈕
  const ADD = {
    trades: ['trades', '交易'], snapshots: ['snapshots', '快照'],
    cashDividends: ['dividends', '除權息'], dividends: ['dividends', '除權息'],
    yield: ['watch', '觀察'], kd: ['watch', '觀察'], eps: ['watch', '觀察'], stars: ['watch', '觀察'],
  };
  const tabBtns = [...document.querySelectorAll('.tabbar [data-tab]')];
  const subtabsEl = $('subtabs');
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

  // key：底部的一格（book）或其中一頁（snapshots）；訊息匣也會直接指定某一頁
  //   有兩頁的格子：標題寫格子的名稱（記帳），下面切換是哪一頁
  function showTab(key) {
    key = OLD[key] || key;
    const group = groupOf(key) || GROUPS[0];
    if (group.key === key) key = group.pages[0][0];
    if (!lists[key]) key = 'overview';
    current = key;
    $('page-title').textContent = group.pages.length > 1 ? group.label : PAGES[key].title;
    renderSubtitle();
    if (subtabsEl) { // 瀏覽器還拿著舊版 index.html 時沒有這一塊
      subtabsEl.hidden = group.pages.length < 2;
      subtabsEl.innerHTML = group.pages.length < 2 ? '' : group.pages.map(([k, label]) =>
        `<button type="button" role="tab" data-page="${k}" aria-selected="${k === key}">${label}</button>`).join('');
    }
    const add = ADD[key];
    addBtn.disabled = !add;
    if (add) {
      addWhat.textContent = add[1];
      addBtn.setAttribute('aria-label', `新增${add[1]}`);
    }
    tabBtns.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === group.key)));
    Object.entries(lists).forEach(([k, l]) => { l.el.hidden = k !== key; });
    try { localStorage.setItem(TAB_KEY, key); } catch (_) {}
  }

  tabBtns.forEach(b => b.addEventListener('click', () => {
    if (groupOf(current).key !== b.dataset.tab) showTab(b.dataset.tab);
    window.scrollTo(0, 0);
  }));
  subtabsEl?.addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.dataset.page === current) return;
    showTab(btn.dataset.page);
    window.scrollTo(0, 0);
  });
  addBtn.addEventListener('click', () => { if (ADD[current]) Form.open(ADD[current][0], null); });

  const refreshAll = () => {
    Object.values(lists).forEach(l => l.refresh());
    Detail.refresh();
  };

  // ---------- 看哪些成員：在設定的「家庭成員」勾選（見 storage.js 的檢視範圍） ----------
  //   沒有勾全家時，標題下面一條提示「只顯示 爸爸、小明 ›」，點一下打開設定的家庭成員
  const scopeBar = $('scope-bar');

  function renderScopeBar() {
    scopeBar.hidden = Store.scope === 'all';
    scopeBar.querySelector('.scope-names').textContent = Store.shown().map(id => Store.memberName(id)).join('、');
  }

  scopeBar.addEventListener('click', () => openMenu('members'));

  // ---------- 家庭成員管理 ----------
  //   兩位以上成員時每一位前面有勾選框，最上面一列是「全家」；只有一位成員時不用勾
  const memberListEl = $('member-list');

  function renderMembers() {
    const members = Store.members();
    const many = members.length > 1;
    const shown = Store.shown();
    const box = (id, on) => (many ? `<input type="checkbox" data-show="${U.esc(id)}"${on ? ' checked' : ''}>` : '');
    const all = many ? `
        <li>
          <label class="member-pick">${box('all', Store.scope === 'all')}
            <span class="member-info"><b>全家</b><small>打勾的成員才會顯示在各頁</small></span></label>
        </li>` : '';
    memberListEl.innerHTML = all + members.map(m => {
      const counts = Object.entries(Store.memberCounts(m.id))
        .map(([t, n]) => `${SCHEMAS[t].title} ${n}`).join(' · ');
      return `
        <li>
          <label class="member-pick">${box(m.id, shown.includes(m.id))}
            <span class="member-info"><b>${U.esc(m.name)}</b><small>${U.esc(counts)}</small></span></label>
          <button type="button" class="text-btn" data-act="rename" data-id="${U.esc(m.id)}">改名</button>
          ${many ? `<button type="button" class="text-btn danger" data-act="remove" data-id="${U.esc(m.id)}">刪除</button>` : ''}
        </li>`;
    }).join('');
  }

  // 勾選：勾全家就每個人都勾；每個人都勾了自動變成全家（見 storage.js）；至少要留一位
  memberListEl.addEventListener('change', e => {
    const box = e.target.closest('[data-show]');
    if (!box) return;
    const id = box.dataset.show;
    const ids = new Set(Store.shown());
    if (id === 'all' && !box.checked) {
      box.checked = true;
      toast('要隱藏某位成員，取消勾選那一位就好');
      return;
    }
    if (id !== 'all') {
      if (box.checked) ids.add(id);
      else ids.delete(id);
      if (!ids.size) {
        box.checked = true;
        toast('至少要勾一位成員', 'error');
        return;
      }
    }
    Store.setScope(id === 'all' ? 'all' : [...ids]);
    renderMembers();
    renderScopeBar();
    refreshAll();
  });

  // 問名字：空白時回傳 null；和其他成員重複、不合規則（見 schema.js）時寫出原因再問一次
  function askName(message, current = '', exceptId = null) {
    let ask = message;
    let value = current;
    for (;;) {
      const name = (prompt(ask, value) ?? '').trim();
      if (!name) return null;
      const error = memberNameError(name)
        || (Store.members().some(m => m.name === name && m.id !== exceptId) ? `已經有「${name}」了` : '');
      if (!error) return name;
      ask = `${error}\n\n${message}`;
      value = name;
    }
  }

  function membersChanged() {
    renderMembers();
    renderScopeBar();
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

  // section：打開後直接捲到哪一段（'members' 家庭成員、'kd' KD 標記、'stars' 星星條件）
  function openMenu(section) {
    renderMembers();
    renderKdMarks();
    renderStars();
    renderBackupInfo();
    if (!menu.open) menu.showModal();
    const head = { members: 'members-head', kd: 'kd-head', stars: 'stars-head' }[section];
    if (head && $(head)) $(head).scrollIntoView({ block: 'start' });
  }

  $('btn-menu').addEventListener('click', () => openMenu());
  menu.querySelector('[data-act="close"]').addEventListener('click', () => menu.close());
  menu.addEventListener('click', e => { if (e.target === menu) menu.close(); }); // 點背景關閉

  // ---------- KD 標記（見 kd.js）：K 值低於下限綠色、高於上限紅色；KD 頁說明裡的「調整」打開這一段 ----------
  const kdLow = $('kd-low');
  const kdHigh = $('kd-high');
  function renderKdMarks() {
    if (!kdLow || !kdHigh) return; // 瀏覽器還拿著舊版 index.html
    const opts = (list, v) => list.map(n => `<option value="${n}"${n === v ? ' selected' : ''}>${n}</option>`).join('');
    kdLow.innerHTML = opts(KD.LOWS, KD.low);
    kdHigh.innerHTML = opts(KD.HIGHS, KD.high);
  }
  [kdLow, kdHigh].forEach(sel => sel?.addEventListener('change', () => KD.set(+kdLow.value, +kdHigh.value)));
  // 下限也是星星條件（低檔），星星跟著變
  KD.onChange(m => {
    refreshMarket();
    Detail.refresh();
    renderStars();
    toast(`KD：低於 ${m.low} 綠色、高於 ${m.high} 紅色`);
  });
  $('panels').addEventListener('click', e => { if (e.target.closest('[data-act="kd-marks"]')) openMenu('kd'); });

  // ---------- 星星條件（見 stars.js）：打勾的條件達標就給一顆 ★；★ 星星頁說明裡的「調整」打開這一段 ----------
  const starsSet = document.querySelector('.stars-set');
  const starYield = $('star-yield');
  const starCross = $('star-cross');
  const starEps = $('star-eps');
  function renderStars() {
    if (!starsSet || !starYield || !starCross || !starEps) return; // 瀏覽器還拿著舊版 index.html
    starsSet.querySelectorAll('[data-star]').forEach(box => { box.checked = Stars.isOn(box.dataset.star); });
    starYield.innerHTML = Stars.YIELDS.map(n => `<option value="${n}"${n === Stars.yieldMin ? ' selected' : ''}>${n}%</option>`).join('');
    starYield.disabled = !Stars.isOn('yield');
    starCross.innerHTML = Stars.CROSS_AT.map(([v, label]) => `<option value="${v}"${v === Stars.crossAt ? ' selected' : ''}>${label}</option>`).join('');
    starCross.disabled = !Stars.isOn('golden');
    starEps.innerHTML = Stars.EPS_AHEADS.map(n => `<option value="${n}"${n === Stars.epsAhead ? ' selected' : ''}>${n ? `${n}% 以上` : '超過就算'}</option>`).join('');
    starEps.disabled = !Stars.isOn('eps');
  }
  starsSet?.addEventListener('change', () => {
    const off = [...starsSet.querySelectorAll('[data-star]')].filter(box => !box.checked).map(box => box.dataset.star);
    Stars.set({ off, yieldMin: +starYield.value, crossAt: starCross.value, epsAhead: +starEps.value });
  });
  Stars.onChange(() => {
    refreshMarket();
    Detail.refresh();
    renderStars();
    const on = Stars.on();
    toast(on.length ? `星星條件：${on.map(x => x.short).join('、')}` : '星星條件都沒有打勾');
  });
  $('panels').addEventListener('click', e => { if (e.target.closest('[data-act="stars-set"]')) openMenu('stars'); });

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
    renderScopeBar();
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
    } else if (st.liveStopped) {
      // 開盤時間登入過期：現價不會每 5 分鐘自動更新（見 sync.js 的 livePrices），按「同步」重新登入
      text = '登入過期，現價不會自動更新';
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

  renderScopeBar();
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
      } else if (a.type === 'announce-apply') {
        // 除權息和公告不一樣：改成公告的數字（會照常同步到試算表）
        if (!Store.get('dividends', a.id)) {
          toast('這筆資料已經不在了');
          return;
        }
        Store.update('dividends', a.id, a.values);
        refreshAll();
        toast('已改成公告的數字');
      } else if (a.type === 'announce-keep') {
        // 保留我的、勾選的不用記：記在這台裝置，之後不再問（見 announced.js）
        Announced.keep(a.keys);
        Inbox.checkData();
        toast(a.skip ? `這 ${a.keys.length} 筆不用記，之後不再提醒` : '好，保留你記的');
      } else if (a.type === 'announce-add') {
        // 還沒記的除權息：加入勾選的（基準日股數自動推算）
        a.rows.forEach(r => Store.add('dividends',
          { code: r.code, name: r.name, exDate: r.exDate, payDate: r.payDate, cash: r.cash, stock: r.stock, baseShares: {} }));
        refreshAll();
        toast(`已加入 ${a.rows.length} 筆除權息`);
      }
    },
  });
  // 資料有變動就重新核對（庫存快照對不上、股利算不出來、沒填代號）
  Inbox.checkData();
  Store.onChange(() => Inbox.checkData());

  // 公告的除權息（見 announced.js）：打開時下載，從背景切回來、網路恢復時再檢查；下載到新的就重畫、比對公告
  if (typeof Announced !== 'undefined' && Announced.load) {
    Announced.onChange(() => {
      refreshAll();
      Inbox.checkData();
    });
    Announced.load();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) Announced.refresh(); });
    window.addEventListener('online', () => Announced.refresh());
  }

  // 收盤價和 KD（見 market.js）：和公告的除權息一樣，打開時下載，從背景切回來、網路恢復時再檢查；下載到新的就重畫總覽和行情
  Market.onChange(() => {
    lists.overview.refresh();
    refreshMarket();
    Detail.refresh();
  });
  Market.load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Market.refresh(); });
  window.addEventListener('online', () => Market.refresh());

  // EPS（見 eps.js）：和收盤價一樣，打開時下載，從背景切回來、網路恢復時再檢查；下載到新的就重畫行情（EPS 頁、星星）
  Eps.onChange(() => {
    refreshMarket();
    Detail.refresh();
  });
  Eps.load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Eps.refresh(); });
  window.addEventListener('online', () => Eps.refresh());

  // 試算表的資料讀回來之後，全部重畫
  Sync.init({
    toast,
    notify: Inbox.add,
    onData() {
      renderScopeBar();
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
    // 讀回新的股價：持股總覽、殖利率、星星（殖利率的星星）重畫（KD 頁只用收盤價，不用重畫）
    onPrices() {
      lists.overview.refresh();
      lists.yield.refresh();
      lists.stars.refresh();
      Detail.refresh();
    },
    // 登出：這台裝置的資料已經清掉，重新載入頁面，畫面和記在記憶體裡的東西全部從空白開始
    onLogout() {
      try { sessionStorage.setItem(LOGOUT_KEY, '1'); } catch (_) {}
      location.reload();
    },
  });
})();
