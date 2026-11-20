



const VolPrices = (() => {
  const NAME = 'volprice';
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();


  let data = typeof VOLPRICE_LIST !== 'undefined' ? VOLPRICE_LIST : null;


  const file = U.dataFile(NAME, {
    preset: data,
    lazy: true,
    set: next => { data = next; },
  });
  const load = file.load;


  const need = file.check;







  function get(code) {
    const r = data?.rows[key(code)];
    if (!r) return null;
    const out = {};
    data.fields.forEach((f, i) => { out[f] = r[i]; });
    return out;
  }


  const waiting = () => file.waiting('下載不了量價資料（連上網路後會再試）', '量價資料下載中…');


  const windowDays = () => (typeof data?.window === 'number' ? data.window : null);

  return { need, load, get, waiting, ready: file.ready, date: () => (data ? data.date : ''), window: windowDays, onChange: file.onChange };
})();
