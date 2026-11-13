









const OVERVIEW = {
  title: '總覽',
  subtitle() {
    const today = U.today();
    return `今天 ${U.fmtDate(today)} ${U.weekday(today)}`;
  },
};




function fitKpis(el) {
  if (!el.offsetWidth) return;
  const nums = [...el.querySelectorAll('.kpi b')];
  nums.forEach(b => { b.style.fontSize = ''; });
  const groups = new Map();
  nums.forEach(b => {
    const key = b.closest('.kpi-row') || b;
    groups.set(key, [...(groups.get(key) || []), b]);
  });
  const tooWide = b => b.scrollWidth > b.clientWidth;
  groups.forEach(group => {

    let scale = Math.min(...group.map(b => (tooWide(b) ? b.clientWidth / b.scrollWidth : 1)));
    const base = group.map(b => parseFloat(getComputedStyle(b).fontSize));
    for (let k = 0; scale < 1 && k < 4; k++) {
      group.forEach((b, j) => { b.style.fontSize = `${Math.floor(base[j] * scale * 10) / 10}px`; });
      if (!group.some(tooWide)) break;
      scale *= 0.95;
    }
  });
}

function watchKpis(el) {
  let fittedWidth = 0;
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (el.offsetWidth === fittedWidth) return;
      fittedWidth = el.offsetWidth;
      fitKpis(el);
    }).observe(el);
  }
  document.fonts?.addEventListener?.('loadingdone', () => fitKpis(el));
}

function createOverview(hooks) {
  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = '<div class="kpis"></div>';

  const kpisEl = el.querySelector('.kpis');


  kpisEl.addEventListener('click', e => {
    const row = e.target.closest('.up-row[data-code]');
    if (!row) return;
    const list = [...new Set([...kpisEl.querySelectorAll('.up-row[data-code]')].map(n => n.dataset.code))];
    hooks.openStock(row.dataset.code, list);
  });

  kpisEl.addEventListener('click', e => {
    if (e.target.closest('.kpi.ix')) hooks.openTaiex?.();
  });

  kpisEl.addEventListener('click', e => {
    if (!e.target.closest('[data-act="upcoming"]')) return;
    Upcoming.toggle();
    render();
    kpisEl.querySelector('[data-act="upcoming"]')?.focus({ preventScroll: true });
  });


  const money = n => Privacy.num(U.fmtNum(Math.round(n)));
  const byPayDate = (a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0);
  const sumNet = rows => rows.reduce((s, r) => s + (r.net ?? 0), 0);
  const missingNote = rows => {
    const n = rows.filter(r => r.net === null).length;
    return n ? `<span class="kpi-sub warn">另有 ${n} 筆算不出來，未計入</span>` : '';
  };



  const two = n => U.fmtNum(U.round(n, 2), 2);
  const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${two(Math.abs(n))}`;
  function indexCard() {
    const list = Market.indices();
    if (!list.length) return '';
    const rows = list.map(r => {
      const cls = r.change > 0 ? ' gain' : r.change < 0 ? ' loss' : '';
      return `
        <span class="ix-name">${U.esc(r.name)}</span>
        <span class="ix-num">${two(r.close)}</span>
        <span class="ix-num${cls}">${signed(r.change)}</span>
        <span class="ix-num${cls}">${r.pct === null ? '' : `${signed(r.pct)}%`}</span>`;
    }).join('');
    return `
      <div class="kpi wide ix">
        <small>${U.esc(Market.indexLine(list))}</small>
        <button type="button" class="trend-hint ix-hint" aria-label="大盤走勢">走勢<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
        <div class="ix-list">${rows}</div>
      </div>`;
  }

  function render() {
    const today = U.today();
    const year = today.slice(0, 4);
    const yearAgo = `${+year - 1}${today.slice(4)}`;
    const divs = VIEWS.cashDividends.rows();
    const paid = divs.filter(r => r.payDate && r.payDate <= today);
    const thisYear = paid.filter(r => r.payDate.startsWith(`${year}-`));
    const last12 = paid.filter(r => r.payDate > yearAgo);
    const upcoming = divs.filter(r => r.payDate > today).sort(byPayDate);
    const next = upcoming.filter(r => r.payDate === upcoming[0]?.payDate);

    let nextTile;
    if (next.length) {
      const first = next[0];
      const amount = next.some(r => r.net !== null) ? money(sumNet(next)) : '—';

      const count = new Set(next.map(r => r.id)).size;
      const who = `${first.code} ${first.name}${count > 1 ? ` 等 ${count} 筆` : ''}`;

      nextTile = `
        <div class="kpi wide">
          <small>下一筆入帳</small>
          <b>${amount}</b>
          <span class="kpi-sub">${U.esc(U.fmtDate(first.payDate))} ${U.weekday(first.payDate)}</span>
          <span class="kpi-sub">${U.esc(who)}</span>
          ${missingNote(next)}
        </div>`;
    } else {
      nextTile = `
        <div class="kpi wide">
          <small>下一筆入帳</small>
          <b>—</b>
          <span class="kpi-sub">沒有待發放的股利</span>
        </div>`;
    }

    kpisEl.innerHTML = `
      ${indexCard()}
      <div class="kpi">
        <small>今年現金股利</small>
        <b>${money(sumNet(thisYear))}</b>
        <span class="kpi-sub">${year} 年已發放</span>
        ${missingNote(thisYear)}
      </div>
      <div class="kpi">
        <small>月平均股息</small>
        <b>${money(sumNet(last12) / 12)}</b>
        <span class="kpi-sub">近 12 個月 ÷ 12</span>
        ${missingNote(last12)}
      </div>
      ${nextTile}
      ${Upcoming.cardHTML(Holdings.all(today))}`;
    fitKpis(kpisEl);
  }
  watchKpis(kpisEl);


  let stale = false;
  function refresh() {
    if (el.hidden) {
      stale = true;
      return;
    }
    stale = false;
    render();
  }
  function shown() {
    if (stale) refresh();
  }


  return { el, refresh, reset: refresh, changed: refresh, shown };
}
