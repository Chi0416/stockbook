



const EPS_SHEET = (() => {
  const fmt = v => (typeof v === 'number' ? U.fmtNum(v, 2) : '—');
  const money = v => U.fmtNum(U.round(v, 2));
  const pct = v => (typeof v === 'number' ? `${U.fmtNum(v, 2)}%` : '—');
  const int = v => U.fmtNum(Math.round(v));
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
  const head = (title, tip, extra = '') => `<h3 class="section-head"><span class="sec-name">${title}</span>${extra}${Note.btn(title, tip)}</h3>`;
  const lineHTML = lines => (lines[0] ? `<span class="card-note">${U.esc(lines[0])}</span>` : '');
  const moreHTML = lines => lines.slice(1).map(n => `<p>${U.esc(n)}</p>`).join('');

  const yearName = y => {
    const now = Number(U.today().slice(0, 4));
    return y === now ? '今年' : y === now - 1 ? '去年' : `${y} 年`;
  };
  const qName = q => (q === 4 ? '全年' : `第 ${q} 季`);
  const HIGH_YIELD = 15;


  function epsNotes(e) {
    const out = [];
    const upTo = `到第 ${e.q} 季`;
    const prevName = yearName(e.year - 1);
    if (e.last === null) {
      out.push(`沒有${prevName}全年的 EPS（${e.year} 年才上市、上櫃的常這樣），算不出達成率`);
    } else if (e.last <= 0) {
      out.push(`${prevName}全年虧損（${fmt(e.last)}），算不出達成率${e.now > 0 ? `；${yearName(e.year)}${upTo}已經賺 ${fmt(e.now)}` : ''}`);
    } else {
      const how = e.ahead > 0 ? `超前 ${e.ahead}%` : e.ahead < 0 ? `落後 ${-e.ahead}%` : '剛好跟上';
      out.push(`進度 ${e.pace}%（${upTo}，每季 25%），${how}${e.pct > 100 ? `；已經超過${prevName}全年` : ''}`);
      if (e.low) out.push(`${prevName}全年只賺 ${fmt(e.last)}，基期很低，達成率容易很誇張，參考就好`);
    }
    if (e.same !== null) {
      const g = e.growth === null ? (e.same < 0 ? '（虧損）' : '')
        : `，${yearName(e.year)}${e.growth >= 0 ? '多' : '少'} ${U.fmtNum(Math.abs(Math.round(e.growth)))}%`;
      out.push(`${prevName}同期（${upTo}）${fmt(e.same)}${g}`);
    }
    return out;
  }


  function epsHTML(e) {
    const tone = e.ahead > 0 ? 'up' : e.ahead < 0 ? 'down' : '';
    const lines = epsNotes(e);
    const at = e.at ? `${qName(e.q)}財報 ${md(e.at)} 公布` : '';
    const tip = moreHTML(lines) +
      '<p>達成率看今年到目前賺的是去年全年的幾成；長條上的刻度是進度（每過一季 25%），超過進度紅色、落後綠色</p>' +
      (at ? '<p>標題右邊的公布日期是每天晚上更新資料時第一次抓到的那天</p>' : '') +
      '<p>最下面一排是近 5 年每一年的 EPS，新的在左邊</p>';
    const bar = e.pct === null ? '' : `<span class="eps-bar ${tone}" aria-hidden="true"><span class="eps-fill" style="width:${Math.max(0, Math.min(100, e.pct))}%"></span><span class="eps-pace" style="left:${e.pace}%"></span></span>`;
    const years = [...e.years].reverse().map(y => cell(`${y.year}`, `${fmt(y.eps)}${y.q < 4 ? `<small>到第 ${y.q} 季</small>` : ''}`, y.eps < 0 ? 'down' : '')).join('');
    return `
      ${head('EPS', tip, at ? `<span class="sec-meta">${U.esc(at)}</span>` : '')}
      <div class="card static detail-card eps-card">
        <span class="card-grid">
          ${cell('達成率', e.pct === null ? '—' : `${e.pct}%`, `strong ${tone}`)}
          ${cell(`${yearName(e.year)}到第 ${e.q} 季`, fmt(e.now))}
          ${cell(`${yearName(e.year - 1)}全年`, fmt(e.last))}
          ${cell('預估全年 EPS', fmt(e.est))}
        </span>
        ${bar}
        ${lineHTML(lines)}
        <span class="card-grid eps-years">${years}</span>
      </div>`;
  }



  function yieldHTML(code) {
    const y = Yields.get(code);
    const close = Market.get(code);
    const notes = [];
    if (!y) notes.push(Yields.waiting() || '公告資料裡沒有這檔（上櫃 ETF、興櫃沒有資料）');
    else if (y.year === null) notes.push('今年、去年都沒有配息');
    else if (y.ycount < y.per) notes.push(`${y.year} 年到目前公告 ${y.ycount} 次（${y.freq}），還沒配完時殖利率會偏低`);
    if (!close) notes.push('沒有收盤價，算不出殖利率');
    const tip = moreHTML(notes) +
      '<p>由左到右：收盤價、這一年公告的每股現金股利，算出<b>殖利率</b>；只算公告的除權息，還沒除息的也算</p>' +
      '<p><b>暴力年化</b>是照最近一次配的金額估一整年：紅色是最近一次配得比近一年平均多，綠色是比較少</p>';
    const tone = !y || y.ya === null ? '' : y.trend > 0 ? ' up' : y.trend < 0 ? ' down' : '';
    const paid = y && y.year !== null ? `${U.fmtNum(U.round(y.ysum, 3))} 元<small>${y.freq}</small>` : '—';
    return `
      ${head('殖利率', tip)}
      <div class="card static detail-card yield-card">
        <span class="card-grid">
          ${cell(close ? `${md(close.date)} 收盤價` : '收盤價', close ? U.fmtNum(U.round(close.close, 2), 2) : '—')}
          ${cell(y && y.year !== null ? `${y.year} 年配息` : '配息', paid, 'paid')}
          ${cell('殖利率', pct(y?.yy), 'strong')}
          ${cell('暴力年化', pct(y?.ya), `strong${tone}`)}
        </span>
        ${lineHTML(notes)}
      </div>`;
  }


  function fcReason(e) {
    const name = yearName(e.year);
    const part = e.decided === null ? '' : `已決議 ${money(e.decided)} 元`;
    if (e.payout === null) return `估不出股利（近幾年沒有賺錢又決議配息的資料）${part ? `；${part}` : ''}`;
    if (e.wild) return `近 ${e.used.length} 年配的比賺的多很多（配息率 ${int(e.payout)}%，多半是拿公積來配），估不準，不估${part ? `；${part}` : ''}`;
    if (e.est <= 0) return `${name}到目前虧損，照這樣估不會配現金${part ? `；${part}` : ''}`;
    return `近 ${e.used.length} 年都沒配現金股利`;
  }



  function fcHTML(e) {
    const name = yearName(e.year);
    const tipEnd = '<p>只是推算，不一定照這樣配；年配的通常隔年夏天除息</p>';
    if (!e.done && (e.payout === null || e.est <= 0 || e.cash === 0)) {
      return `${head('股利預估', tipEnd)}<p class="note muted">${U.esc(fcReason(e))}</p>`;
    }
    const rows = [...e.used].reverse().map(y => `
      <span>${y.year}</span><span>${fmt(y.eps)}</span><span>${money(y.cash)} 元</span><span>${int(y.ratio)}%</span>`).join('');
    const lines = [];
    if (e.done) {
      lines.push(`${name}賺的錢已經決議每股配 ${money(e.decided)} 元，不用估了`);
    } else if (e.wild) {
      lines.push(fcReason(e));
    } else {
      lines.push(`預估每股配 = ${fmt(e.est)} × ${int(e.payout)}% ≈ ${money(e.cash)} 元`);
      if (e.decided !== null) lines.push(`已經決議 ${money(e.decided)} 元（${e.decidedQ === 2 ? '上半年' : `到第 ${e.decidedQ} 季`}），預估的是全年`);
      if (e.fy >= HIGH_YIELD) lines.push('預估殖利率特別高：多半是今年 EPS 衝很高（可能有一次性的收入），參考就好');
    }
    return `
      ${head('股利預估', moreHTML(lines) + tipEnd)}
      <div class="card static detail-card eps-card">
        <span class="card-grid">
          ${cell(e.q === 4 ? `${name}全年 EPS` : '預估全年 EPS', fmt(e.est))}
          ${e.payout === null ? '' : cell('配息率', `${int(e.payout)}%`)}
          ${cell(e.done ? '已決議每股配' : '預估每股配', e.done ? `${money(e.decided)} 元` : e.cash === null ? '—' : `${money(e.cash)} 元`, 'strong')}
          ${cell(e.done ? '殖利率' : '預估殖利率', pct(e.fy), 'strong')}
        </span>
        ${rows ? `<span class="fc-years"><small>年度</small><small>EPS</small><small>每股配現金</small><small>配息率</small>${rows}</span>` : ''}
        ${lineHTML(lines)}
      </div>`;
  }

  return code => {
    const e = EpsDetails.get(code);

    const eps = e ? epsHTML(e) : EpsDetails.ready() ? '' : `${head('EPS', '<p>資料下載好了才看得到</p>')}<p class="note muted">${U.esc(EpsDetails.waiting())}</p>`;
    return `${eps}${e ? fcHTML(e) : ''}${yieldHTML(code)}`;
  };
})();
