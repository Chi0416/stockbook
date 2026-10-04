// 進入點：分頁、列表、表單、家庭成員、資料備份
(() => {
  const TAB_KEY = 'stockbook.tab';
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

  $('btn-menu').addEventListener('click', () => {
    renderMembers();
    renderBackupInfo();
    menu.showModal();
  });
  menu.querySelector('[data-act="close"]').addEventListener('click', () => menu.close());
  menu.addEventListener('click', e => { if (e.target === menu) menu.close(); }); // 點背景關閉

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
})();
