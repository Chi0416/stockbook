




const Privacy = (() => {
  const KEY = U.key('hideAmounts');
  const MASK = '***';
  const listeners = [];
  let hidden = false;
  try { hidden = localStorage.getItem(KEY) === '1'; } catch (_) {}


  const num = s => (hidden && s !== '' && s != null ? MASK : s);




  const NUMBER = /(?<=^|\s)-?\d+(?:,\d{3})*(?:\.\d+)?(?=$|\s|[）),，、])/g;
  const keep = m => m === '0' || /^\d{4,}$/.test(m);
  const text = s => (hidden ? String(s ?? '').replace(NUMBER, m => (keep(m) ? m : MASK)) : s);

  function set(v) {
    hidden = !!v;
    try { localStorage.setItem(KEY, hidden ? '1' : '0'); } catch (_) {}
    listeners.forEach(fn => fn(hidden));
  }

  return {
    MASK,
    get hidden() { return hidden; },
    num,
    text,
    set,
    toggle: () => set(!hidden),

    onChange: fn => listeners.push(fn),
  };
})();
