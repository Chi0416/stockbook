
const Events = (() => {
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const byExDesc = (a, b) => (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0);

  const OWN_NOTE = '* 手動登記，並非系統紀錄';
  const ownMark = '<span class="own-mark" title="手動登記，並非系統紀錄">*</span>';





  function list(code, own) {
    const c = key(code);
    if (!c) return [];
    const mine = (own ? own.filter(d => key(d.code) === c) : Announced.recorded(c))
      .filter(d => d.exDate && typeof d.cash === 'number' && d.cash > 0);
    const pub = Announced.forCode(c).filter(r => r.cash !== 0);
    const list = pub.map(r => {
      const m = r.cash == null ? mine.find(d => Announced.sameEvent(d, r)) : null;
      return { exDate: r.exDate, payDate: r.payDate, cash: m ? m.cash : r.cash, stock: r.stock || 0, own: !!m };
    });
    mine.filter(d => !pub.some(r => Announced.sameEvent(d, r)))
      .forEach(d => list.push({ exDate: d.exDate, payDate: d.payDate || '', cash: d.cash, stock: d.stock || 0, own: true }));
    return list.sort(byExDesc);
  }






  function tableHTML(rows, empty) {
    if (!rows.length) return `<p class="note muted">${empty}</p>`;
    const num = v => (v ? U.fmtNum(v) : '—');
    const body = rows.map(r => {
      const cash = typeof r.cash === 'number';
      return `
        <tr>
          <td>${U.esc(U.fmtDate(r.exDate))}${r.own ? ownMark : ''}</td>
          <td class="num">${cash ? U.fmtNum(r.cash) : '待公告'}</td>
          <td class="num">${num(r.stock)}</td>
          <td class="num total">${cash ? U.fmtNum(U.round(r.cash + (r.stock || 0), 4)) : '—'}</td>
        </tr>`;
    }).join('');
    return `
      <div class="card static detail-card">
        <div class="ev-notes">
          <span class="card-note">都是每股（元）；公告資料只有近 13 個月</span>
          ${rows.some(r => r.own) ? `<span class="card-note">${OWN_NOTE}</span>` : ''}
        </div>
        <table class="ev-table">
          <thead><tr><th>除權息日期</th><th class="num">現金股利</th><th class="num">股票股利</th><th class="num">合計</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  return { list, tableHTML, ownMark, OWN_NOTE };
})();
