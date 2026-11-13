



const Forecasts = (() => {
  const NAME = 'forecast';
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();


  let data = typeof FORECAST_LIST !== 'undefined' ? FORECAST_LIST : null;



  const file = U.dataFile(NAME, {
    preset: data,
    lazy: true,
    set: next => { data = next; },
  });
  const load = file.load;


  const need = file.check;


  function get(code) {
    const r = data?.rows[key(code)];
    return r ? { cash: r[0], fy: r[1], decided: r[2] === 1, unknown: r[2] === 2 } : null;
  }


  const waiting = () => file.waiting('下載不了股利預估（連上網路後會再試）', '股利預估下載中…');

  return { need, load, get, waiting, ready: file.ready, onChange: file.onChange };
})();
