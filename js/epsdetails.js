



const EpsDetails = (() => {
  const NAME = 'epsdetail';
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();


  let data = typeof EPS_DETAIL_LIST !== 'undefined' ? EPS_DETAIL_LIST : null;



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
    return {
      year: r[0], q: r[1], now: r[2], last: r[3], same: r[4], pct: r[5], pace: r[6], ahead: r[7], est: r[8], growth: r[9], at: r[10], low: !!r[11],
      years: r[12].map(([year, eps, q]) => ({ year, eps, q })),
      payout: r[13], wild: !!r[14], cash: r[15], fy: r[16], decided: r[17], decidedQ: r[18], done: !!r[19],
      used: r[20].map(([year, eps, cash, ratio]) => ({ year, eps, cash, ratio })),
    };
  }


  const season = () => (data && typeof data.season?.q === 'number' ? data.season : null);


  const waiting = () => file.waiting('下載不了 EPS（連上網路後會再試）', 'EPS 下載中…');

  return { need, load, get, season, waiting, updated: () => (data && typeof data.updated === 'string' ? data.updated : ''), ready: file.ready, onChange: file.onChange };
})();
