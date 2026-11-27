






const Store = (() => {
  const KEY = U.key('v1');
  const SCOPE_KEY = U.key('member');
  const SYNC_KEY = U.key('sync');
  const TABLES = Object.keys(SCHEMAS);
  const MEMBER_TABLES = TABLES.filter(t => SCHEMAS[t].fields.some(f => f.type === 'member'));
  const PER_MEMBER = TABLES.flatMap(t => SCHEMAS[t].fields.filter(f => f.type === 'perMember').map(f => [t, f.key]));
  const DEFAULT_MEMBER = { id: 'me', name: '我' };
  let available = true;

  function blank() {
    const d = { version: 1, lastExportAt: null, members: [{ ...DEFAULT_MEMBER }] };
    TABLES.forEach(t => { d[t] = []; });
    return d;
  }



  const DATE_FIELDS = Object.fromEntries(TABLES.map(t => [t, SCHEMAS[t].fields.filter(f => f.type === 'date').map(f => f.key)]));
  const cleanDate = v => (v == null || v === '' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : U.parseDate(String(v)));
  function cleanDates(t, r) {
    DATE_FIELDS[t].forEach(k => { if (k in r) r[k] = cleanDate(r[k]); });
    return r;
  }


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





  function loadSync() {
    try {
      const s = JSON.parse(localStorage.getItem(SYNC_KEY));
      if (s && typeof s.pending === 'object') {

        const known = ['members', ...TABLES];
        const pending = Object.fromEntries(Object.entries(s.pending).filter(([t]) => known.includes(t)));
        return { pending, v: s.v || 0, full: !!s.full };
      }
    } catch (_) {}
    return { pending: {}, v: 0, full: false };
  }
  let sync = loadSync();

  function mark(table, id, del = false) {
    (sync.pending[table] ||= {})[id] = { del, v: ++sync.v };
  }


  function markMemberRefs(id) {
    MEMBER_TABLES.forEach(t => data[t].filter(r => r.member === id).forEach(r => mark(t, r.id)));
    PER_MEMBER.forEach(([t, key]) => data[t].filter(r => r[key] && id in r[key]).forEach(r => mark(t, r.id)));
  }


  let version = 0;
  let memoVersion = -1;
  const memos = new Map();
  const bump = () => { version++; };

  const listeners = [];
  const changed = table => {
    bump();
    listeners.forEach(fn => fn(table));
  };





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


  const idsOf = (s = scope) => (s === 'all' ? data.members.map(m => m.id) : Array.isArray(s) ? s : [s]);

  return {
    get available() { return available; },
    get scope() { return scope; },
    setScope,
    shown: idsOf,
    get version() { return version; },



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


    scopeLabel() {
      if (data.members.length < 2) return '';
      if (scope === 'all') return '全家';
      return scope.length > 2 ? `${scope.length} 位成員` : scope.map(id => this.memberName(id)).join('、');
    },


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


    addMany(table, recs) {
      const have = new Set(data[table].map(r => r.id));
      const add = recs.filter(r => !have.has(r.id)).map(rec => ({ id: U.uid(), ...rec }));
      if (!add.length) return;
      add.forEach(r => { data[table].push(r); mark(table, r.id); });
      persist();
      changed(table);
    },


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


    get(table, id) {
      return (table === 'members' ? data.members : data[table]).find(r => r.id === id);
    },


    members() {
      return data.members;
    },

    memberName(id) {
      return data.members.find(m => m.id === id)?.name ?? '';
    },


    defaultMember() {
      const ids = idsOf();
      return ids.length === 1 ? ids[0] : '';
    },


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


    removeMember(id) {
      if (data.members.length < 2) return;
      markMemberRefs(id);
      MEMBER_TABLES.forEach(t => data[t].filter(r => r.member === id).forEach(r => mark(t, r.id, true)));
      mark('members', id, true);
      data.members = data.members.filter(m => m.id !== id);
      MEMBER_TABLES.forEach(t => { data[t] = data[t].filter(r => r.member !== id); });
      persist();
      setScope(scope);
      changed('members');
    },


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


    badDates(obj) {
      const bad = [];
      TABLES.forEach(t => (Array.isArray(obj?.[t]) ? obj[t] : []).forEach(r => DATE_FIELDS[t].forEach(k => {
        if (r && typeof r === 'object' && r[k] != null && r[k] !== '' && cleanDate(r[k]) === null) bad.push(String(r[k]));
      })));
      return bad;
    },


    parseImport(obj) {
      if (!obj || typeof obj !== 'object' || !TABLES.some(t => Array.isArray(obj[t]))) return null;
      return normalize(obj);
    },



    wipe() {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        keys.filter(k => k.startsWith(`${U.site}.`)).forEach(k => localStorage.removeItem(k));
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
      setScope(scope);
      changed(null);
    },


    onChange(fn) {
      listeners.push(fn);
    },


    pendingCount() {
      if (sync.full) return TABLES.reduce((n, t) => n + data[t].length, 0);
      return Object.values(sync.pending).reduce((n, ids) => n + Object.keys(ids).length, 0);
    },

    pendingSnapshot() {
      const items = Object.entries(sync.pending).flatMap(([table, ids]) =>
        Object.entries(ids).map(([id, p]) => ({ table, id, del: p.del, v: p.v })));
      return { full: sync.full, items };
    },


    clearPending(snap, tables = null) {
      snap.items.forEach(({ table, id, v }) => {
        if (tables && !tables.includes(table)) return;
        if (sync.pending[table]?.[id]?.v === v) delete sync.pending[table][id];
      });
      if (snap.full && !tables) sync.full = false;
      persist();
    },


    markPending(items) {
      items.forEach(({ table, id }) => mark(table, id));
      persist();
    },


    dropPending() {
      sync = { pending: {}, v: sync.v, full: false };
      try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (_) {}
    },



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
      setScope(scope);
      return true;
    },


    loadRemote(remote) {
      const lastExportAt = data.lastExportAt;
      data = normalize(remote);
      data.lastExportAt = lastExportAt;
      sync = { pending: {}, v: sync.v, full: false };
      bump();
      persist();
      setScope(scope);
    },
  };
})();
