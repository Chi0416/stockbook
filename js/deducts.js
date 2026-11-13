


const Deducts = (() => {
  const NAME = 'ma';
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();


  let data = typeof DEDUCT_LIST !== 'undefined' ? DEDUCT_LIST : null;



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
    if (r[0] === null) return { days: r[1] };
    const deducts = [];
    for (let i = 0; i < r[7].length; i += 2) deducts.push({ date: data.days[r[7][i]], close: r[7][i + 1] });
    return { ma: r[0], dir: r[1], low: r[2], high: r[3], slope: r[4], ma5: r[5], prev: r[6], deducts, prevDir: r[8], w5: r[9], b: r[10], b5: r[11] };
  }



  function assume(code, p) {
    const k = get(code);
    if (!k?.b || !(p > 0)) return null;
    const line = (a, b) => b.map((v, i) => a[i] * p + v);
    const proj = line(data.a[0], k.b);
    const proj5 = line(data.a[1], k.b5);
    return { price: p, ma: proj[0], ma5: proj5[0], chg: U.round(proj[0] - k.prev, 4), dir: Math.sign(p - k.deducts[0].close), dir5: Math.sign(p - k.w5), proj, proj5 };
  }


  const waiting = () => file.waiting('下載不了扣抵資料（連上網路後會再試）', '扣抵資料下載中…');

  return { need, load, get, assume, waiting, ready: file.ready, date: () => (data ? data.date : ''), onChange: file.onChange };
})();
