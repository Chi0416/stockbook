







const PatternBars = (() => {
  const NAME = 'patternbars';
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  let data = typeof PATTERN_BARS !== 'undefined' ? PATTERN_BARS : null;
  const memo = new Map();
  const file = U.dataFile(NAME, { preset: data, lazy: true, set: next => { data = next; memo.clear(); } });

  function bars(code) {
    const c = key(code);
    if (memo.has(c)) return memo.get(c);
    const r = data?.rows[c];
    if (!r) return null;
    const list = (rows, dates) => rows.map(([open, high, low, close], i) => ({ date: dates[dates.length - rows.length + i], open, high, low, close }));
    const out = { d: list(r.d, r.dd || data.days), w: list(r.w, r.wd || data.weeks), ma: r.ma };
    memo.set(c, out);
    return out;
  }
  const waiting = () => file.waiting('下載不了形態的 K 線（連上網路後會再試）', '形態的 K 線下載中…');
  return { need: file.check, load: file.load, bars, waiting, onChange: file.onChange };
})();


const Patterns = (() => {
  const NAME = 'pattern';
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  let data = typeof PATTERN_LIST !== 'undefined' ? PATTERN_LIST : null;
  const file = U.dataFile(NAME, { preset: data, lazy: true, set: next => { data = next; } });

  const get = code => data?.rows[key(code)] || null;
  const waiting = () => file.waiting('下載不了形態資料（連上網路後會再試）', '形態資料下載中…');

  const onChange = fn => {
    file.onChange(fn);
    PatternBars.onChange(fn);
  };

  return {
    need: file.check, needBars: PatternBars.need, load: file.load, get, bars: PatternBars.bars, waiting, barsWaiting: PatternBars.waiting, onChange,
    ready: file.ready, date: () => (data ? data.date : ''),
  };
})();
