// 資料存放：瀏覽器 localStorage，另可匯出／匯入 data.json
//   家庭成員：交易明細與庫存快照每筆記上成員 id（member 欄位），除權息全家共用
//   檢視範圍（scope）：單一成員的 id，或 'all'（全家）；list() 預設只回傳目前範圍內的資料
const Store = (() => {
  const KEY = 'stockbook.v1';
  const SCOPE_KEY = 'stockbook.member';
  const TABLES = Object.keys(SCHEMAS);
  const MEMBER_TABLES = TABLES.filter(t => SCHEMAS[t].fields.some(f => f.type === 'member'));
  const DEFAULT_MEMBER = { id: 'me', name: '我' }; // 舊資料沒有成員時，全部歸到這位
  let available = true;

  function blank() {
    const d = { version: 1, lastExportAt: null, members: [{ ...DEFAULT_MEMBER }] };
    TABLES.forEach(t => { d[t] = []; });
    return d;
  }

  // 只整理結構（確保每張表是陣列、每筆有 id、舊格式轉成新格式），不檢查內容
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
            .map(r => migrate({ ...r, id: r.id || U.uid() }));
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
      return true;
    } catch (e) {
      alert(`儲存失敗：${e.message}\n請先匯出 data.json 備份。`);
      return false;
    }
  }

  let data = load();

  // ---------- 檢視範圍 ----------
  const validScope = s => s === 'all' || data.members.some(m => m.id === s);
  let scope = 'all';
  try { scope = localStorage.getItem(SCOPE_KEY) || 'all'; } catch (_) {}
  if (!validScope(scope)) scope = 'all';

  function setScope(s) {
    scope = validScope(s) ? s : 'all';
    try { localStorage.setItem(SCOPE_KEY, scope); } catch (_) {}
  }

  return {
    get available() { return available; },
    get scope() { return scope; },
    setScope,

    // member 省略時用目前的檢視範圍；'all' 為全家；除權息等共用的表不分成員
    list(table, member = scope) {
      if (member === 'all' || !MEMBER_TABLES.includes(table)) return data[table];
      return data[table].filter(r => r.member === member);
    },

    add(table, rec) {
      const r = { id: U.uid(), ...rec };
      data[table].push(r);
      persist();
      return r;
    },

    update(table, id, rec) {
      const i = data[table].findIndex(r => r.id === id);
      if (i < 0) return;
      data[table][i] = { ...data[table][i], ...rec, id };
      persist();
    },

    remove(table, id) {
      data[table] = data[table].filter(r => r.id !== id);
      persist();
    },

    // ---------- 家庭成員 ----------
    members() {
      return data.members;
    },

    memberName(id) {
      return data.members.find(m => m.id === id)?.name ?? '';
    },

    // 新增記錄時預設的成員：正在看某位成員就用那位；只有一位成員時直接用那位
    defaultMember() {
      if (scope !== 'all') return scope;
      return data.members.length === 1 ? data.members[0].id : '';
    },

    // 各表屬於這位成員的筆數，例如 { trades: 3, snapshots: 8 }
    memberCounts(id) {
      return Object.fromEntries(MEMBER_TABLES.map(t => [t, data[t].filter(r => r.member === id).length]));
    },

    addMember(name) {
      const m = { id: U.uid(), name };
      data.members.push(m);
      persist();
      return m;
    },

    renameMember(id, name) {
      const m = data.members.find(x => x.id === id);
      if (!m) return;
      m.name = name;
      persist();
    },

    // 連同這位成員的交易明細與庫存快照一起刪除；至少要留一位成員
    removeMember(id) {
      if (data.members.length < 2) return;
      data.members = data.members.filter(m => m.id !== id);
      MEMBER_TABLES.forEach(t => { data[t] = data[t].filter(r => r.member !== id); });
      persist();
      if (scope === id) setScope('all');
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

    // 檔案裡至少要有一張表才算是備份檔；回傳整理後的資料或 null
    parseImport(obj) {
      if (!obj || typeof obj !== 'object' || !TABLES.some(t => Array.isArray(obj[t]))) return null;
      return normalize(obj);
    },

    replaceAll(parsed) {
      const lastExportAt = data.lastExportAt;
      data = normalize(parsed);
      data.lastExportAt = lastExportAt;
      persist();
      if (!validScope(scope)) setScope('all');
    },
  };
})();
