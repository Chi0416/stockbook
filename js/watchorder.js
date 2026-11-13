




const WatchOrder = (() => {
  const KEY = U.key('watchOrder');
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const listeners = [];
  let saved = null;

  function load() {
    if (saved) return saved;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (_) {}
    saved = Array.isArray(saved) ? [...new Set(saved.filter(c => typeof c === 'string').map(key).filter(Boolean))] : [];
    return saved;
  }
  function persist(codes) {
    saved = codes;
    try { localStorage.setItem(KEY, JSON.stringify(codes)); } catch (_) {}
  }


  const byCode = (a, b) => U.isIndex(b) - U.isIndex(a) || (a < b ? -1 : a > b ? 1 : 0);


  function arrange(codes) {
    const all = [...new Set(codes.map(key).filter(Boolean))];
    const has = new Set(all);
    const kept = load().filter(c => has.has(c));
    const done = new Set(kept);
    const out = [...kept, ...all.filter(c => !done.has(c)).sort(byCode)];
    if (out.length !== saved.length || out.some((c, i) => c !== saved[i])) persist(out);
    return out;
  }


  function rank(codes) {
    return new Map(arrange(codes).map((c, i) => [c, i]));
  }


  function sort(rows) {
    const at = rank(rows.map(r => r.code));
    return rows.slice().sort((a, b) => at.get(key(a.code)) - at.get(key(b.code)));
  }


  function set(codes) {
    persist([...new Set(codes.map(key).filter(Boolean))]);
    listeners.forEach(fn => fn());
  }

  function onChange(fn) {
    listeners.push(fn);
  }


  if (typeof Store !== 'undefined' && Store.onChange) {
    Store.onChange(table => {
      if (table === 'watch' || table === null) arrange(Store.list('watch', 'all').map(r => r.code));
    });
  }

  return { arrange, rank, sort, set, onChange };
})();
