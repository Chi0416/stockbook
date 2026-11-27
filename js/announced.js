









const Announced = (() => {
  const DAY = 86400000;
  const NAME = 'dividends';
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();


  let data = typeof DIVIDEND_LIST !== 'undefined' ? DIVIDEND_LIST : null;

  let cache = null;
  let byCode = null;
  function rows() {
    if (!cache) {
      cache = (data ? data.rows : []).map(([code, name, exDate, payDate, cash, stock]) => ({ code, name, exDate, payDate, cash, stock }));
      byCode = new Map();
      cache.forEach(r => {
        if (!byCode.has(r.code)) byCode.set(r.code, []);
        byCode.get(r.code).push(r);
      });
    }
    return cache;
  }




  const file = U.dataFile(NAME, {
    preset: data,
    set: next => { data = next; cache = null; },
  });
  const load = file.load;


  const refresh = file.check;

  const sameEvent = (a, b) => key(a.code) === key(b.code) && !!a.exDate && !!b.exDate &&
    Math.abs(Date.parse(a.exDate) - Date.parse(b.exDate)) <= 7 * DAY;


  function byKey(rows) {
    const m = new Map();
    rows.forEach(d => {
      const k = key(d.code);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(d);
    });
    return m;
  }

  const recorded = code => Store.memo('announced', 'recorded', () => byKey(Store.list('dividends', 'all'))).get(key(code)) || [];


  function forCode(code, recorded = []) {
    const c = key(code);
    if (!c) return [];
    rows();
    return (byCode.get(c) || [])
      .filter(r => !recorded.some(d => sameEvent(d, r)))
      .sort((a, b) => (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0));
  }



  function per(code) {
    const c = key(code);
    if (!c || !data?.per) return null;
    rows();
    return byCode.has(c) ? data.per[c] || 1 : null;
  }


  const KEEP = U.key('announceKeep');
  let kept = null;
  function keptSet() {
    if (!kept) {
      try { kept = new Set(JSON.parse(localStorage.getItem(KEEP)) || []); } catch (_) { kept = new Set(); }
    }
    return kept;
  }

  function keep(keys) {
    const set = keptSet();
    [].concat(keys).forEach(k => set.add(k));
    kept = new Set([...set].slice(-500));
    try { localStorage.setItem(KEEP, JSON.stringify([...kept])); } catch (_) {}
  }
  const isKept = k => keptSet().has(k);
  const same = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-9;
  const FIELDS = ['exDate', 'payDate', 'cash', 'stock'];
  const differs = (d, r, k) => (/Date$/.test(k) ? d[k] !== r[k] : !same(d[k], r[k]));



  function diffs(recorded = []) {
    return recorded.flatMap(d => {
      const r = forCode(d.code).find(x => x.cash != null && sameEvent(d, x));
      const fields = r ? FIELDS.filter(k => differs(d, r, k)) : [];
      if (!fields.length) return [];
      const key = `diff:${d.id}:${FIELDS.map(k => r[k]).join(':')}`;
      return isKept(key) ? [] : [{ key, record: d, announced: r, fields }];
    });
  }




  function missing({ recorded = [], codes = [], held, today }) {
    const [y, m, dd] = today.split('-');
    const since = `${+y - 1}-${m}-${dd}`;
    const want = new Set(codes.map(key));
    const mine = byKey(recorded);
    return rows()
      .filter(r => r.cash != null && r.exDate >= since && want.has(r.code))
      .filter(r => !(mine.get(key(r.code)) || []).some(d => sameEvent(d, r)) && !isKept(`missing:${r.code}:${r.exDate}`))
      .filter(r => held(r.code, r.exDate))
      .sort((a, b) => (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0));
  }

  return {
    forCode, per, sameEvent, recorded, diffs, missing, keep, isKept, load, refresh,
    updated: () => (data ? data.updated : ''),
    state: file.state,
    ready: file.ready,
    onChange: file.onChange,
  };
})();
