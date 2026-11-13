




const Candles = (() => {
  const NAME = 'candles';
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();


  let data = typeof CANDLE_LIST !== 'undefined' ? CANDLE_LIST : null;



  const file = U.dataFile(NAME, {
    preset: data,
    lazy: true,
    set: next => { data = next; },
  });
  const load = file.load;


  const need = file.check;





  const num = v => (typeof v === 'number' ? v : null);
  function get(code) {
    if (!data) return null;
    const row = data.rows[key(code)] || [];
    return row.map((v, i) => {
      const date = data.days[i];
      if (v === null || !date) return null;
      return Array.isArray(v)
        ? { date, open: v[0], high: v[1], low: v[2], close: v[3], vol: num(v[4]), k: num(v[5]), d: num(v[6]) }
        : { date, open: null, high: null, low: null, close: v, vol: null, k: null, d: null };
    }).filter(x => x && typeof x.close === 'number');
  }


  const raw = code => (data ? { row: data.rows[key(code)] || [], days: data.days } : null);


  const waiting = () => file.waiting('下載不了 K 線資料（連上網路後會再試）', 'K 線資料下載中…');

  return { need, load, get, raw, waiting, ready: file.ready, date: () => (data ? data.date : ''), onChange: file.onChange };
})();
