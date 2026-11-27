




const Screens = (() => {
  const NAME = 'screen';
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();


  let data = typeof SCREEN_LIST !== 'undefined' ? SCREEN_LIST : null;
  const cache = new Map();

  const file = U.dataFile(NAME, {
    preset: data,
    lazy: true,
    set: next => { data = next; },
  });
  const load = file.load;


  const need = file.check;


  function get(code) {
    const c = key(code);
    if (!data?.rows[c]) return null;
    if (!cache.has(c)) cache.set(c, Object.fromEntries(data.fields.map((f, i) => [f, data.rows[c][i] ?? null])));
    return cache.get(c);
  }


  const waiting = () => file.waiting('下載不了篩選的資料（連上網路後會再試）', '篩選的資料下載中…');

  return {
    need, load, get, waiting,
    ready: file.ready,
    date: () => data?.date || '',
    onChange: file.onChange,
  };
})();
