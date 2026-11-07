// 股票搜尋：表單的「股票」欄（代號和證券合成一格，見 form.js）打字時的候選，以及打完之後認出是哪一檔
//   own：自己記過的 [{ code, name }]，最近的在前；清單是 stocklist.js 的 STOCK_LIST（瀏覽器還拿著舊版程式時沒有）
//   比對不分大小寫、全形半形
const StockSearch = (() => {
  const norm = s => U.toHalf(s ?? '').trim();
  const codeKey = s => norm(s).toUpperCase();

  // 清單依代號排好（物件裡 2330 這種純數字的代號會排在 0050 前面，所以另外排）
  let sorted = null;
  function listed() {
    if (!sorted) {
      const names = typeof STOCK_LIST !== 'undefined' ? STOCK_LIST.names : {};
      sorted = Object.keys(names).sort().map(code => ({ code, name: names[code] }));
    }
    return sorted;
  }

  // 打字時的候選，最多 limit 個：自己記過的在前（代號開頭相同或名稱裡有這幾個字）
  //   接著是清單：代號完全相同 → 代號開頭相同 → 名稱開頭相同 → 名稱裡有這幾個字
  //   同一類裡越短越前面（越接近打的字）：代號比長度（4 碼的個股在 6 碼的 ETF 前面），名稱比字數（「玉山」先列玉山金）
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
      // listed() 已經依代號排好，sort 是穩定排序，長度一樣時維持代號順序
      const hits = listed().filter(p => !seen.has(p.code) && match(p)).sort(order);
      for (const p of hits.slice(0, limit - out.length)) {
        out.push(p);
        seen.add(p.code);
      }
    }
    return out;
  }

  // 代號對到哪一檔：先找自己記過的（沿用自己的寫法），再找清單
  function byCode(code, own) {
    const c = codeKey(code);
    const o = own.find(p => codeKey(p.code) === c);
    const l = listed().find(p => p.code === c);
    if (o) return { code: o.code, name: o.name || l?.name || '' };
    return l ? { ...l } : null;
  }

  // 打完的文字是哪一檔，認不出來回傳 null：
  //   代號（2330）
  //   「代號 名稱」（00999A 新ETF）：代號認得的話用認得的名稱，清單裡沒有的就用打的名稱（剛上市的 ETF、已經下市的股票）
  //   完整的名稱（台積電），只對得到一檔時
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
