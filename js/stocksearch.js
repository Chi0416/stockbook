


const StockSearch = (() => {
  const norm = s => U.toHalf(s ?? '').trim();
  const codeKey = s => norm(s).toUpperCase();


  let sorted = null;
  function listed() {
    if (!sorted) {
      const names = typeof STOCK_LIST !== 'undefined' ? STOCK_LIST.names : {};
      sorted = Object.keys(names).sort().map(code => ({ code, name: names[code] }));
    }
    return sorted;
  }




  function search(q, own = [], limit = 8) {
    const t = norm(q);
    if (!t) return [];
    const up = t.toUpperCase();
    const low = t.toLowerCase();
    const out = own.filter(p => codeKey(p.code).startsWith(up) || String(p.name).toLowerCase().includes(low)).slice(0, limit);
    const seen = new Set(out.map(p => codeKey(p.code)));
    const byCode = (a, b) => a.code.length - b.code.length;
    const byName = (a, b) => a.name.length - b.name.length;
    const tiers = [
      [p => p.code === up, byCode],
      [p => p.code.startsWith(up), byCode],
      [p => p.name.toLowerCase().startsWith(low), byName],
      [p => p.name.toLowerCase().includes(low), byName],
    ];
    for (const [match, order] of tiers) {
      if (out.length >= limit) break;

      const hits = listed().filter(p => !seen.has(p.code) && match(p)).sort(order);
      for (const p of hits.slice(0, limit - out.length)) {
        out.push(p);
        seen.add(p.code);
      }
    }
    return out;
  }


  function byCode(code, own) {
    const c = codeKey(code);
    const o = own.find(p => codeKey(p.code) === c);
    const l = listed().find(p => p.code === c);
    if (o) return { code: o.code, name: o.name || l?.name || '' };
    return l ? { ...l } : null;
  }





  function resolve(text, own = []) {
    const t = norm(text);
    if (!t) return null;
    const exact = byCode(t, own);
    if (exact) return exact;
    const m = t.match(/^(\d[0-9A-Za-z]{3,5})\s+(\S.*)$/);
    if (m) return byCode(m[1], own) || { code: m[1].toUpperCase(), name: m[2].trim() };
    const low = t.toLowerCase();
    for (const list of [own, listed()]) {
      const same = list.filter(p => String(p.name).toLowerCase() === low);
      const codes = new Set(same.map(p => codeKey(p.code)));
      if (codes.size === 1) return { code: same[0].code, name: same[0].name };
      if (codes.size > 1) return null;
    }
    return null;
  }

  return { search, resolve };
})();
