


const Yields = (() => {
  const NAME = 'yield';
  const FREQ = { 12: '月配', 4: '季配', 2: '半年配', 1: '年配' };
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();


  let data = typeof YIELD_LIST !== 'undefined' ? YIELD_LIST : null;



  const file = U.dataFile(NAME, {
    preset: data,
    set: next => { data = next; },
  });
  const load = file.load;

  const refresh = file.check;




  function get(code) {
    const r = data?.rows[key(code)];
    return r ? { sum: r[0], y: r[1], ya: r[2], trend: r[3], per: r[4], freq: FREQ[r[4]], count: r[5], short: r[5] > 0 && r[5] < r[4], year: r[6] ?? null, ysum: r[7] ?? null, yy: r[8] ?? null, ycount: r[9] ?? 0 } : null;
  }


  const waiting = () => file.waiting('下載不了殖利率（連上網路後會再試）', '殖利率還在下載');

  return { load, refresh, get, waiting, ready: file.ready, updated: () => (data ? data.updated : ''), onChange: file.onChange };
})();
