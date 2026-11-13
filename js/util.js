



if (typeof window !== 'undefined' && window.top && window.top !== window.self) {
  document.documentElement.style.display = 'none';
  throw new Error('這個網站不能內嵌在別的網頁裡');
}
const NUM_FORMATS = new Map();
const U = {


  site: (typeof document !== 'undefined' && document.documentElement?.dataset?.site) || 'stockbook',
  key(name) {
    return `${U.site}.${name}`;
  },


  isIndex(code) {
    return U.toHalf(code ?? '').trim().toUpperCase() === 'TAIEX';
  },

  pad2(n) {
    return String(n).padStart(2, '0');
  },



  zhuyinPending(s) {
    return /[\u3100-\u312F\u31A0-\u31BF\u02C7\u02CA\u02CB\u02D9]/.test(String(s));
  },


  toHalf(s) {
    return String(s).replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  },


  parseDate(s) {
    const t = U.toHalf(s).trim();
    const m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/) || t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return `${y}-${U.pad2(mo)}-${U.pad2(d)}`;
  },

  fmtDate(iso) {
    return iso ? String(iso).replace(/-/g, '/') : '';
  },


  today() {
    const d = new Date();
    return `${d.getFullYear()}-${U.pad2(d.getMonth() + 1)}-${U.pad2(d.getDate())}`;
  },


  parseNum(s) {
    const t = U.toHalf(s).replace(/[,\s]/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    return Number(t);
  },


  round(n, digits = 4) {
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  },



  fmtNum(n, minDigits = 0) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    let f = NUM_FORMATS.get(minDigits);
    if (!f) {
      f = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: minDigits, maximumFractionDigits: Math.max(minDigits, 4) });
      NUM_FORMATS.set(minDigits, f);
    }
    return f.format(n);
  },

  weekday(iso) {
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d) ? '' : `週${'日一二三四五六'[d.getDay()]}`;
  },


  display(f, v) {
    if (f.format) return f.format(v);
    if (f.type === 'date') return U.fmtDate(v);
    if (f.type === 'number') return U.fmtNum(v, f.digits || 0);
    return v ?? '';
  },

  fmtDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}/${U.pad2(d.getMonth() + 1)}/${U.pad2(d.getDate())} ${U.pad2(d.getHours())}:${U.pad2(d.getMinutes())}`;
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  },


  ticks(min, max) {
    if (max === min) return [min];
    const raw = (max - min) / 4;
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
    return out;
  },

  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },






  DATA_BASE: 'shared/',
  dataUrl(name) {
    return `${U.DATA_BASE}${name}.json`;
  },











  dataFile(name, { preset = null, lazy = false, valid = null, set }) {
    const AGAIN = 30 * 60000;
    const file = U.dataUrl(name);
    let has = !!preset;
    let state = has ? 'ready' : lazy ? 'idle' : 'loading';
    let text = '';
    let lastTry = 0;
    let pending = null;
    const listeners = [];

    function load(again = false) {
      if (pending) return again ? pending.then(() => load()) : pending;
      lastTry = Date.now();
      if (state === 'idle') state = 'loading';
      const get = async mode => {
        try {
          const res = await fetch(file, { cache: mode });
          return res.ok ? await res.text() : null;
        } catch (_) {
          return null;
        }
      };
      pending = (async () => {
        const got = (await get('no-cache')) ?? (await get('force-cache'));
        let changed = false;
        if (got !== null && got !== text) {
          try {
            const next = JSON.parse(got);
            if ((valid || Contract.valid(name))(next)) {
              set(next);
              has = true;
              text = got;
              state = 'ready';
              changed = true;
            }
          } catch (_) {}
        }
        if (!has && state !== 'failed') {
          state = 'failed';
          changed = true;
        }
        pending = null;
        if (changed) listeners.forEach(fn => fn());
        return changed;
      })();
      return pending;
    }

    return {
      load,
      check: () => (state !== 'ready' || Date.now() - lastTry >= AGAIN ? load() : Promise.resolve(false)),
      state: () => state,
      ready: () => state === 'ready',
      waiting: (failed, loading) => (state === 'ready' ? '' : state === 'failed' ? failed : loading),
      onChange: fn => listeners.push(fn),
    };
  },
};
