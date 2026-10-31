// 資料存放：瀏覽器 localStorage，另可匯出／匯入 data.json
//   家庭成員：交易明細與庫存快照每筆記上成員 id（member 欄位），除權息全家共用
//   檢視範圍（scope）：'all'（全家）或勾選的成員 id 陣列（設定裡勾選）；list() 預設只回傳目前範圍內的資料
//   連結 Google 試算表時（見 sync.js）：試算表是正本，這裡是副本
//     每次修改都記在待同步清單（哪張表的哪一筆、新增修改或刪除），同步成功後清掉
//     onChange() 註冊的函式在每次修改後立刻呼叫（還在使用者點擊的當下，可以跳出登入視窗），參數是改了哪張表（成員是 'members'，整份換掉是 null）
//   資料版本：每次資料有變就加 1；memo() 依版本記住算好的結果（持股推算、依代號分好的資料），資料沒變就用上一次的
const Store = (() => {
  const KEY = 'stockbook.v1';
  const SCOPE_KEY = 'stockbook.member';
  const SYNC_KEY = 'stockbook.sync';
  const TABLES = Object.keys(SCHEMAS);
  const MEMBER_TABLES = TABLES.filter(t => SCHEMAS[t].fields.some(f => f.type === 'member'));
  const PER_MEMBER = TABLES.flatMap(t => SCHEMAS[t].fields.filter(f => f.type === 'perMember').map(f => [t, f.key]));
  const DEFAULT_MEMBER = { id: 'me', name: '我' }; // 舊資料沒有成員時，全部歸到這位
  let available = true;

  function blank() {
    const d = { version: 1, lastExportAt: null, members: [{ ...DEFAULT_MEMBER }] };
    TABLES.forEach(t => { d[t] = []; });
    return d;
  }

  // 日期欄位只留看得懂的日期（YYYY-MM-DD）：匯入的 data.json 可能被改過，不合格的當成沒填（null），
  //   不會原樣畫到畫面上；寫法和試算表讀回來的一樣（見 sheet.js 的 decode）
  const DATE_FIELDS = Object.fromEntries(TABLES.map(t => [t, SCHEMAS[t].fields.filter(f => f.type === 'date').map(f => f.key)]));
  const cleanDate = v => (v == null || v === '' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : U.parseDate(String(v)));
  function cleanDates(t, r) {
    DATE_FIELDS[t].forEach(k => { if (k in r) r[k] = cleanDate(r[k]); });
    return r;
  }

  // 整理結構（確保每張表是陣列、每筆有 id、舊格式轉成新格式）；內容只檢查日期
  function normalize(d) {
    const out = blank();
    if (d && typeof d === 'object') {
      if (Array.isArray(d.members)) {
        const members = d.members
          .filter(m => m && typeof m === 'object' && m.id)
          .map(m => ({ id: String(m.id), name: String(m.name ?? '').trim() || '未命名' }));
        if (members.length) out.members = members;
      }
      TABLES.forEach(t => {
        if (Array.isArray(d[t])) {
          const migrate = SCHEMAS[t].migrate || (r => r);
          out[t] = d[t]
            .filter(r => r && typeof r === 'object')
            .map(r => cleanDates(t, migrate({ ...r, id: r.id || U.uid() })));
        }
      });
      if (d.lastExportAt) out.lastExportAt = d.lastExportAt;
    }
    // 沒有成員的資料歸給第一位；成員清單裡找不到的 id 補一位「未命名」，不讓資料消失
    const known = new Set(out.members.map(m => m.id));
    MEMBER_TABLES.forEach(t => {
      out[t].forEach(r => {
        if (!r.member) r.member = out.members[0].id;
        else if (!known.has(r.member)) {
          known.add(r.member);
          out.members.push({ id: r.member, name: '未命名' });
        }
      });
    });
    return out;
  }

  function load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      available = false;
      return blank();
    }
    if (!raw) return blank();
    try {
      return normalize(JSON.parse(raw));
    } catch (e) {
      // 資料損毀時先另存原始內容，避免被覆蓋
      try { localStorage.setItem(`${KEY}.broken.${Date.now()}`, raw); } catch (_) {}
      alert('瀏覽器內的資料無法讀取，已另存一份原始內容，目前以空白資料開始。');
      return blank();
    }
  }

  function persist() {
    if (!available) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
      return true;
    } catch (e) {
      alert(`儲存失敗：${e.message}\n請先匯出 data.json 備份。`);
      return false;
    }
  }

  let data = load();

  // ---------- 待同步清單 ----------
  // pending：{ 表（含 members）: { id: { del, v } } }，v 是遞增的版本號
  //   同步開始時先拍一份快照，結束後只清掉版本號沒變的（同步途中又改過的留到下一次）
  // full：匯入資料後整份要重寫
  function loadSync() {
    try {
      const s = JSON.parse(localStorage.getItem(SYNC_KEY));
      if (s && typeof s.pending === 'object') return { pending: s.pending, v: s.v || 0, full: !!s.full };
    } catch (_) {}
    return { pending: {}, v: 0, full: false };
  }
  let sync = loadSync();

  function mark(table, id, del = false) {
    (sync.pending[table] ||= {})[id] = { del, v: ++sync.v };
  }

  // 成員改名或刪除時，寫著這位成員名字的資料也要重寫（試算表的成員欄和基準日股數寫的是名字）
  function markMemberRefs(id) {
    MEMBER_TABLES.forEach(t => data[t].filter(r => r.member === id).forEach(r => mark(t, r.id)));
    PER_MEMBER.forEach(([t, key]) => data[t].filter(r => r[key] && id in r[key]).forEach(r => mark(t, r.id)));
  }

  // 資料版本：data 裡的東西一改就加 1（包括同步讀回來、整份換掉），memo 記的結果跟著作廢
  let version = 0;
  let memoVersion = -1;
  const memos = new Map();
  const bump = () => { version++; };

  const listeners = [];
  const changed = table => {
    bump();
    listeners.forEach(fn => fn(table));
  };

  // ---------- 檢視範圍 ----------
  //   'all' 是全家（之後新增的成員也算在內）；只勾某幾位時是 id 陣列，之後新增的成員不會自動勾上
  //   整理：拿掉已經刪除的成員；沒勾任何人或每個人都勾了，都當成全家
  //   這台裝置記住（不同步）；舊版存的是一個 id 字串，讀進來當成只勾那一位
  function cleanScope(s) {
    if (s === 'all') return 'all';
    const ids = data.members.map(m => m.id);
    const picked = ids.filter(id => (Array.isArray(s) ? s : [s]).includes(id));
    return picked.length && picked.length < ids.length ? picked : 'all';
  }
  let scope = 'all';
  try {
    const raw = localStorage.getItem(SCOPE_KEY) || 'all';
    scope = cleanScope(raw.startsWith('[') ? JSON.parse(raw) : raw);
  } catch (_) {}

  function setScope(s) {
    scope = cleanScope(s);
    try { localStorage.setItem(SCOPE_KEY, scope === 'all' ? 'all' : JSON.stringify(scope)); } catch (_) {}
  }

  // 檢視範圍裡的成員 id；s 可以是 'all'、一位成員的 id 或 id 陣列，省略時用目前的檢視範圍
  const idsOf = (s = scope) => (s === 'all' ? data.members.map(m => m.id) : Array.isArray(s) ? s : [s]);

  return {
    get available() { return available; },
    get scope() { return scope; },
    setScope,
    shown: idsOf,
    get version() { return version; },

    // 依資料版本記住算好的結果：同一個 name、key，資料沒改過就回傳上一次 fn() 的結果，改過就重算
    //   name 分開不同的東西，key 是同一個東西的不同參數（哪幾位成員、哪一天）；回傳的東西大家共用，用的地方不能修改
    memo(name, key, fn) {
      if (memoVersion !== version) {
        memos.clear();
        memoVersion = version;
      }
      let m = memos.get(name);
      if (!m) memos.set(name, (m = new Map()));
      if (!m.has(key)) m.set(key, fn());
      return m.get(key);
    },

    // 合計卡片上的範圍說明：全家、一兩位寫名字（爸爸、小明）、三位以上寫人數；只有一位成員時不用寫
    scopeLabel() {
      if (data.members.length < 2) return '';
      if (scope === 'all') return '全家';
      return scope.length > 2 ? `${scope.length} 位成員` : scope.map(id => this.memberName(id)).join('、');
    },

    // member 省略時用目前的檢視範圍；可以是 'all'（全家）、一位成員的 id 或 id 陣列；除權息等共用的表不分成員
    list(table, member = scope) {
      if (member === 'all' || !MEMBER_TABLES.includes(table)) return data[table];
      const ids = idsOf(member);
      return data[table].filter(r => ids.includes(r.member));
    },

    add(table, rec) {
      const r = { id: U.uid(), ...rec };
      data[table].push(r);
      mark(table, r.id);
      persist();
      changed(table);
      return r;
    },

    update(table, id, rec) {
      const i = data[table].findIndex(r => r.id === id);
      if (i < 0) return;
      data[table][i] = { ...data[table][i], ...rec, id };
      mark(table, id);
      persist();
      changed(table);
    },

    // 一次新增好幾筆（App 自動記的帳戶紀錄）：已經有同一個 id 的不加；只存一次、通知一次
    addMany(table, recs) {
      const have = new Set(data[table].map(r => r.id));
      const add = recs.filter(r => !have.has(r.id)).map(rec => ({ id: U.uid(), ...rec }));
      if (!add.length) return;
      add.forEach(r => { data[table].push(r); mark(table, r.id); });
      persist();
      changed(table);
    },

    // 一次改好幾筆（App 自動補的資料，例如庫存快照的收盤價）：changes 是 [{ id, values }]，只存一次、通知一次
    updateMany(table, changes) {
      let n = 0;
      changes.forEach(({ id, values }) => {
        const i = data[table].findIndex(r => r.id === id);
        if (i < 0) return;
        data[table][i] = { ...data[table][i], ...values, id };
        mark(table, id);
        n++;
      });
      if (!n) return;
      persist();
      changed(table);
    },

    remove(table, id) {
      data[table] = data[table].filter(r => r.id !== id);
      mark(table, id, true);
      persist();
      changed(table);
    },

    // 一筆資料（table 可以是 'members'）
    get(table, id) {
      return (table === 'members' ? data.members : data[table]).find(r => r.id === id);
    },

    // ---------- 家庭成員 ----------
    members() {
      return data.members;
    },

    memberName(id) {
      return data.members.find(m => m.id === id)?.name ?? '';
    },

    // 新增記錄時預設的成員：只勾一位成員就用那位；只有一位成員時直接用那位
    defaultMember() {
      const ids = idsOf();
      return ids.length === 1 ? ids[0] : '';
    },

    // 各表屬於這位成員的筆數，例如 { trades: 3, snapshots: 8 }
    memberCounts(id) {
      return Object.fromEntries(MEMBER_TABLES.map(t => [t, data[t].filter(r => r.member === id).length]));
    },

    addMember(name) {
      const m = { id: U.uid(), name };
      data.members.push(m);
      mark('members', m.id);
      persist();
      changed('members');
      return m;
    },

    renameMember(id, name) {
      const m = data.members.find(x => x.id === id);
      if (!m) return;
      m.name = name;
      mark('members', id);
      markMemberRefs(id);
      persist();
      changed('members');
    },

    // 連同這位成員的交易明細與庫存快照一起刪除；至少要留一位成員
    removeMember(id) {
      if (data.members.length < 2) return;
      markMemberRefs(id);
      MEMBER_TABLES.forEach(t => data[t].filter(r => r.member === id).forEach(r => mark(t, r.id, true)));
      mark('members', id, true);
      data.members = data.members.filter(m => m.id !== id);
      MEMBER_TABLES.forEach(t => { data[t] = data[t].filter(r => r.member !== id); });
      persist();
      setScope(scope); // 從勾選裡拿掉；沒有人勾了回到全家
      changed('members');
    },

    // ---------- 匯出／匯入 ----------
    exportPayload() {
      const p = { app: 'stockbook', version: 1, exportedAt: new Date().toISOString(), members: data.members };
      TABLES.forEach(t => { p[t] = data[t]; });
      return p;
    },

    lastExportAt() {
      return data.lastExportAt;
    },

    markExported() {
      data.lastExportAt = new Date().toISOString();
      persist();
    },

    // 匯入前先數：檔案裡看不懂的日期（匯入後會變成沒填，見 cleanDate），確認視窗裡提醒
    badDates(obj) {
      const bad = [];
      TABLES.forEach(t => (Array.isArray(obj?.[t]) ? obj[t] : []).forEach(r => DATE_FIELDS[t].forEach(k => {
        if (r && typeof r === 'object' && r[k] != null && r[k] !== '' && cleanDate(r[k]) === null) bad.push(String(r[k]));
      })));
      return bad;
    },

    // 檔案裡至少要有一張表才算是備份檔；回傳整理後的資料或 null
    parseImport(obj) {
      if (!obj || typeof obj !== 'object' || !TABLES.some(t => Array.isArray(obj[t]))) return null;
      return normalize(obj);
    },

    // 登出：清掉這台裝置上記錄簿存的所有東西（資料、待同步清單、成員、訊息匣、登入資訊、壞掉時留的備份）
    //   之後由 app.js 重新載入頁面
    wipe() {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        keys.filter(k => k.startsWith('stockbook.')).forEach(k => localStorage.removeItem(k));
      } catch (_) {}
      data = blank();
      sync = { pending: {}, v: 0, full: false };
      scope = 'all';
      bump();
    },

    replaceAll(parsed) {
      const lastExportAt = data.lastExportAt;
      data = normalize(parsed);
      data.lastExportAt = lastExportAt;
      sync = { pending: {}, v: sync.v, full: true };
      persist();
      setScope(scope); // 拿掉已經不在的成員
      changed(null);
    },

    // ---------- 同步（sync.js 使用） ----------
    onChange(fn) {
      listeners.push(fn);
    },

    // 還沒同步的筆數；匯入後整份要重寫時是全部的筆數
    pendingCount() {
      if (sync.full) return TABLES.reduce((n, t) => n + data[t].length, 0);
      return Object.values(sync.pending).reduce((n, ids) => n + Object.keys(ids).length, 0);
    },

    pendingSnapshot() {
      const items = Object.entries(sync.pending).flatMap(([table, ids]) =>
        Object.entries(ids).map(([id, p]) => ({ table, id, del: p.del, v: p.v })));
      return { full: sync.full, items };
    },

    // 同步成功後清掉快照裡、之後沒有再改過的項目；tables 有給時只清這幾張表
    clearPending(snap, tables = null) {
      snap.items.forEach(({ table, id, v }) => {
        if (tables && !tables.includes(table)) return;
        if (sync.pending[table]?.[id]?.v === v) delete sync.pending[table][id];
      });
      if (snap.full && !tables) sync.full = false;
      persist();
    },

    // 標成要寫回試算表（試算表裡被刪掉、但使用者選擇保留的資料）
    markPending(items) {
      items.forEach(({ table, id }) => mark(table, id));
      persist();
    },

    // 沒有連結時清掉待同步清單（見 sync.js 的 init）：只寫待同步那一份，資料不動
    dropPending() {
      sync = { pending: {}, v: sync.v, full: false };
      try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (_) {}
    },

    // 以試算表的資料為主，疊上還沒同步的修改；keep 裡的表（試算表那邊缺分頁或缺欄位）整張保留這裡的資料
    //   回傳資料有沒有變：和這台裝置原本的一模一樣時（大部分的同步都是）不換、不存，資料版本也不變，畫面不用重畫
    mergeRemote(remote, keep = []) {
      const out = normalize(remote);
      ['members', ...TABLES].forEach(t => {
        if (keep.includes(t)) { out[t] = data[t]; return; }
        Object.entries(sync.pending[t] || {}).forEach(([id, p]) => {
          const i = out[t].findIndex(r => r.id === id);
          if (p.del) {
            if (i >= 0) out[t].splice(i, 1);
            return;
          }
          const local = this.get(t, id);
          if (!local) return;
          if (i >= 0) out[t][i] = local;
          else out[t].push(local);
        });
      });
      out.lastExportAt = data.lastExportAt;
      const next = normalize(out);
      if (JSON.stringify(next) === JSON.stringify(data)) return false;
      data = next;
      bump();
      persist();
      setScope(scope); // 拿掉已經不在的成員
      return true;
    },

    // 改用試算表的資料（連結時選了雲端那一份），這台裝置的修改全部放棄
    loadRemote(remote) {
      const lastExportAt = data.lastExportAt;
      data = normalize(remote);
      data.lastExportAt = lastExportAt;
      sync = { pending: {}, v: sync.v, full: false };
      bump();
      persist();
      setScope(scope); // 拿掉已經不在的成員
    },
  };
})();
