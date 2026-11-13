





const KD = (() => {
  const KEY = U.key('kdMarks');
  const LOWS = [10, 15, 20, 25, 30, 35, 40];
  const HIGHS = [60, 65, 70, 75, 80, 85, 90];
  const listeners = [];
  let marks = { low: 25, high: 75 };
  try {
    const m = JSON.parse(localStorage.getItem(KEY));
    if (LOWS.includes(m?.low) && HIGHS.includes(m?.high)) marks = { low: m.low, high: m.high };
  } catch (_) {}

  function set(low, high) {
    if (!LOWS.includes(low) || !HIGHS.includes(high)) return;
    marks = { low, high };
    try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch (_) {}
    listeners.forEach(fn => fn(marks));
  }


  const zone = v => (typeof v !== 'number' ? '' : v < marks.low ? 'low' : v > marks.high ? 'high' : '');


  function cross(m) {
    if (!m || [m.k, m.d, m.pk, m.pd].some(v => typeof v !== 'number')) return '';
    if (m.pk <= m.pd && m.k > m.d) return 'golden';
    if (m.pk >= m.pd && m.k < m.d) return 'dead';
    return '';
  }



  const crossAt = m => (cross(m) ? zone(m.d) || 'mid' : '');

  return {
    LOWS, HIGHS, set, zone, cross, crossAt,
    get low() { return marks.low; },
    get high() { return marks.high; },

    onChange: fn => listeners.push(fn),
  };
})();
