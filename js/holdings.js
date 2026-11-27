












const Holdings = (() => {
  const num = v => Number(v) || 0;
  const codeOf = r => String(r.code ?? '').trim().toUpperCase();
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const signed = t => (/買/.test(t.type) ? num(t.shares) : /賣/.test(t.type) ? -num(t.shares) : 0);


  function group(rows, keyOf) {
    const m = new Map();
    rows.forEach(r => {
      const k = keyOf(r);
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    });
    return m;
  }

  const byMember = (rows, inner) => new Map([...group(rows, r => r.member)].map(([m, list]) => [m, group(list, inner)]));

  const index = () => Store.memo('holdings', 'index', () => {
    const trades = Store.list('trades', 'all');
    const snaps = Store.list('snapshots', 'all');
    return {
      dividends: group(Store.list('dividends'), codeOf),
      trades: byMember(trades, codeOf),
      memberTrades: group(trades, t => t.member),
      snaps: group(snaps, s => s.member),
      snapRows: byMember(snaps, s => JSON.stringify([s.date, codeOf(s)])),
    };
  });
  const dividendsOf = code => index().dividends.get(code) || [];
  const tradesOf = (member, code) => index().trades.get(member)?.get(code) || [];
  const memberTrades = member => index().memberTrades.get(member) || [];
  const snapsOf = member => index().snaps.get(member) || [];
  const snapRows = (member, date, code) => index().snapRows.get(member)?.get(JSON.stringify([date, code])) || [];

  const remember = (name, args, fn) => {
    const memo = Store.memo('holdings', name, () => new Map());
    const key = JSON.stringify(args);
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key);
  };





  function eventsFor(member, code, inRange, edit) {
    const dividends = dividendsOf(code);
    const trades = edit
      ? [...tradesOf(member, code).filter(t => t.id !== edit.skip), edit.add]
      : tradesOf(member, code);
    return [
      ...dividends
        .filter(d => num(d.cash) > 0 && inRange(d.exDate))
        .map(d => ({ date: d.exDate, cash: d })),
      ...trades
        .filter(t => inRange(t.date))
        .map(t => ({ date: t.date, trade: t })),
      ...dividends
        .filter(d => num(d.stock) > 0 && d.exDate < d.payDate && inRange(d.payDate))
        .map(d => ({ date: d.payDate, stock: d })),
    ].sort(byDate);
  }


  function bonusShares(member, code, d) {
    const manual = d.baseShares?.[member];
    const held = typeof manual === 'number' ? manual : position(member, code, d.exDate).shares;
    return Math.floor(held * num(d.stock) / 10);
  }


  function snapDateBefore(member, date, inclusive) {
    return snapsOf(member).reduce((best, s) => {
      const ok = inclusive ? s.date <= date : s.date < date;
      return ok && (!best || s.date > best) ? s.date : best;
    }, null);
  }




  function position(member, code, date, inclusive = false) {
    return remember('position', [member, code, date, inclusive], () => positionAt(member, code, date, inclusive));
  }

  function positionAt(member, code, date, inclusive) {
    const snapDate = snapDateBefore(member, date, inclusive);
    const { rows, base, shares, cost, name, bought, sold, bonus } = walk(member, code, snapDate, date, inclusive);

    const changed = bought > 0 || sold > 0 || bonus > 0;
    const formula = (snapDate ? `${U.fmtDate(snapDate)} 快照 ${U.fmtNum(base)}` : '從 0 開始') +
      (bought ? ` + 買進 ${U.fmtNum(bought)}` : '') +
      (sold ? ` − 賣出 ${U.fmtNum(sold)}` : '') +
      (bonus ? ` + 配股 ${U.fmtNum(bonus)}` : '');

    return { member, code, name, shares, cost, snapDate, found: rows.length > 0 || changed, changed, formula };
  }






  function walk(member, code, start, date, inclusive, edit) {
    const inRange = d => (!start || d > start) && (inclusive ? d <= date : d < date);

    const rows = start ? snapRows(member, start, code) : [];
    const base = rows.reduce((t, s) => t + num(s.shares), 0);
    let shares = base;
    let cost = rows.reduce((t, s) => t + num(s.totalCost), 0);
    let name = rows.length ? rows[0].name : '';
    let bought = 0;
    let sold = 0;
    let bonus = 0;
    let paid = cost;
    let got = 0;
    let divs = 0;
    const sales = [];

    eventsFor(member, code, inRange, edit).forEach(e => {
      if (e.cash) {

        const manual = e.cash.baseShares?.[member];
        const held = typeof manual === 'number' ? manual : shares;
        if (held > 0) {
          const cash = Math.round(U.round(num(e.cash.cash) * held));
          cost -= cash;
          divs += cash;
        }
      } else if (e.trade) {
        const t = e.trade;
        const n = num(t.shares);
        if (!name) name = t.name;
        if (/買/.test(t.type)) {
          shares += n;
          bought += n;
          cost += num(t.settle);
          paid += num(t.settle);
        } else if (/賣/.test(t.type)) {
          const before = cost;
          cost = shares > 0 ? Math.round(cost * Math.max(shares - n, 0) / shares) : 0;
          sales.push({ trade: t, held: shares, cost: before - cost });
          shares -= n;
          sold += n;
          got += num(t.settle);
        }
      } else {
        const add = bonusShares(member, code, e.stock);
        shares += add;
        bonus += add;
      }
    });

    return { rows, base, shares, cost, name, bought, sold, bonus, paid, got, divs, sales };
  }














  function segmentWhy(member, code, start) {
    const next = [...new Set(snapsOf(member).map(s => s.date))].filter(d => !start || d > start).sort()[0];
    if (!next) return '';
    const c = checkOf(member).find(x => x.code === code && x.date === next);
    if (c?.status === 'diff') return `這段期間的買賣和 ${U.fmtDate(next)} 的庫存快照對不上，成本算不準`;
    if (c?.status === 'partial') return `${U.fmtDate(next)} 第一期庫存快照之前的買進還沒補齊，成本算不準`;
    return '';
  }


  function judge(s, why) {
    const t = s.trade;
    const reason = typeof t.settle !== 'number' ? '應收付金額空白，算不出損益'
      : s.held < num(t.shares) ? '賣出的股數比當時的持股多，前面的買進可能沒記'
      : why;
    return reason ? { pl: null, cost: null, why: reason } : { pl: Math.round(t.settle) - s.cost, cost: s.cost, why: '' };
  }



  function realized(member, code) {
    return remember('realized', [member, code], () => {
      const out = new Map();
      const sells = tradesOf(member, code).filter(t => signed(t) < 0);
      group(sells, t => snapDateBefore(member, t.date, false)).forEach((list, start) => {
        const end = list.reduce((d, t) => (t.date > d ? t.date : d), list[0].date);
        const why = segmentWhy(member, code, start);
        walk(member, code, start, end, true).sales.forEach(s => out.set(s.trade.id, judge(s, why)));
      });
      return out;
    });
  }


  const sale = t => (t && signed(t) < 0 ? realized(t.member, codeOf(t)).get(t.id) || null : null);



  function preview(t) {
    const code = codeOf(t);
    if (!t.member || !t.date || !code || signed(t) >= 0) return null;
    const add = { ...t, id: Symbol('preview') };
    const start = snapDateBefore(t.member, t.date, false);
    const s = walk(t.member, code, start, t.date, true, { skip: t.id, add }).sales.find(x => x.trade === add);
    return s ? judge(s, segmentWhy(t.member, code, start)) : null;
  }






  function cashflow(member, code, date) {
    return remember('cashflow', [member, code, date], () => {
      const since = checkOf(member)
        .filter(c => c.code === code && c.status !== 'ok' && c.date <= date)
        .reduce((best, c) => (!best || c.date > best ? c.date : best), null);
      const { paid, got, divs } = walk(member, code, since, date, true);
      return { paid, got, divs, since };
    });
  }




  function positionBack(member, code, exDate) {
    const snaps = snapsOf(member);
    const snapDate = snaps.reduce((best, s) => (s.date >= exDate && (!best || s.date < best) ? s.date : best), null);
    if (!snapDate) return null;
    const inWindow = d => d >= exDate && d <= snapDate;

    const rows = snapRows(member, snapDate, code);
    const base = rows.reduce((t, s) => t + num(s.shares), 0);
    let bought = 0;
    let sold = 0;
    tradesOf(member, code).forEach(t => {
      if (!inWindow(t.date)) return;
      if (/買/.test(t.type)) bought += num(t.shares);
      else if (/賣/.test(t.type)) sold += num(t.shares);
    });
    const bonus = dividendsOf(code).some(d => num(d.stock) > 0 && inWindow(d.payDate));

    const changed = bought > 0 || sold > 0;
    const formula = `${U.fmtDate(snapDate)} 快照 ${U.fmtNum(base)}` +
      (bought ? ` − 期間買進 ${U.fmtNum(bought)}` : '') +
      (sold ? ` + 期間賣出 ${U.fmtNum(sold)}` : '');
    return { member, code, shares: base - bought + sold, snapDate, bonus, found: rows.length > 0 || changed, changed, formula };
  }







  function entitled(member, code, exDate, manual) {
    if (typeof manual === 'number') return { member, found: true, shares: manual, basis: '基準日股數為手動輸入' };

    const negative = p => ({ member, found: true, shares: p.shares, error: `股數算出來是負的（${p.formula}），請檢查資料` });
    const fwd = position(member, code, exDate, false);
    const back = fwd.snapDate ? null : positionBack(member, code, exDate);
    if (back) {
      if (!back.found) return { member, found: false, snapDate: back.snapDate };
      if (back.bonus) {
        return {
          member, found: true, shares: null,
          error: `除權息日到 ${U.fmtDate(back.snapDate)} 快照之間有配股，無法往回推算，請在除權息手動填基準日股數`,
        };
      }
      if (back.shares < 0) return negative(back);
      return {
        member, found: true, shares: back.shares,
        basis: back.changed
          ? `股數 = ${back.formula}（往回推算）`
          : `股數依 ${U.fmtDate(back.snapDate)} 快照往回推算（期間沒有買賣紀錄）`,
      };
    }

    if (!fwd.found) return { member, found: false, snapDate: fwd.snapDate };
    if (fwd.shares < 0) return negative(fwd);
    return {
      member, found: true, shares: fwd.shares,
      basis: fwd.changed ? `股數 = ${fwd.formula}` : `股數依 ${U.fmtDate(fwd.snapDate)} 庫存快照`,
    };
  }




  function memberAll(member, date) {
    return remember('memberAll', [member, date], () => memberAt(member, date));
  }

  function memberAt(member, date) {
    const snapDate = snapDateBefore(member, date, true);
    const recs = [
      ...(snapDate ? snapsOf(member).filter(s => s.date === snapDate) : []),
      ...memberTrades(member).filter(t => (!snapDate || t.date > snapDate) && t.date <= date),
    ];
    if (!snapDate && !recs.length) return null;
    const codes = new Set(recs.map(codeOf));
    const missingCode = codes.has('') ? recs.filter(r => !codeOf(r)).length : 0;
    codes.delete('');
    return {
      snapDate,
      missingCode,
      positions: [...codes].map(c => position(member, c, date, true)).filter(p => p.shares !== 0),
    };
  }




  function all(date) {
    return remember('all', [date, Store.scope], () => allAt(date));
  }

  function allAt(date) {
    const ids = Store.shown();
    if (Store.scope !== 'all' && ids.length === 1) return memberAll(ids[0], date);
    const each = ids.map(id => memberAll(id, date)).filter(Boolean);
    if (!each.length) return null;

    const merged = new Map();
    each.forEach(h => h.positions.forEach(p => {
      const cur = merged.get(p.code) || { code: p.code, name: '', shares: 0, cost: 0, parts: [] };
      cur.name = cur.name || p.name;
      cur.shares += p.shares;
      cur.cost += p.cost;
      cur.parts.push(p);
      merged.set(p.code, cur);
    }));
    const dates = new Set(each.map(h => h.snapDate));
    return {
      snapDate: dates.size === 1 ? each[0].snapDate : null,
      mixed: dates.size > 1,
      missingCode: each.reduce((n, h) => n + h.missingCode, 0),
      positions: [...merged.values()].filter(p => p.shares !== 0 || p.parts.some(x => x.shares < 0)),
    };
  }


  function heldCodes(date) {
    const codes = Store.members().flatMap(m =>
      (memberAll(m.id, date)?.positions || []).filter(p => p.shares > 0).map(p => p.code));
    return [...new Set(codes)].sort();
  }




  function ledger(code, date) {
    const c = String(code ?? '').trim().toUpperCase();
    const rows = Store.shown().flatMap(member => tradesOf(member, c)
      .filter(t => signed(t) !== 0 && t.date <= date)
      .map(t => ({
        kind: /買/.test(t.type) ? 'buy' : 'sell', member, date: t.date, type: t.type, shares: num(t.shares),
        price: typeof t.price === 'number' ? t.price : null, amount: typeof t.settle === 'number' ? t.settle : null,
        sale: signed(t) < 0 ? realized(member, c).get(t.id) || null : null,
      })));
    return rows.sort((a, b) => byDate(b, a));
  }



  function snaps(code, date) {
    const c = String(code ?? '').trim().toUpperCase();
    const rows = Store.shown().flatMap(member => snapsOf(member)
      .filter(s => codeOf(s) === c && s.date <= date)
      .map(s => ({
        member, date: s.date, type: s.type || '', shares: num(s.shares),
        price: num(s.shares) ? num(s.totalCost) / num(s.shares) : null, amount: num(s.totalCost),
      })));
    return rows.sort((a, b) => byDate(b, a));
  }








  function checkMember(member) {
    const snaps = snapsOf(member);
    const dates = [...new Set(snaps.map(s => s.date))].sort();
    const sum = rows => rows.reduce((t, s) => t + num(s.shares), 0);
    return dates.flatMap((date, k) => {
      const prev = k ? dates[k - 1] : null;
      const inRange = d => (!prev || d > prev) && d <= date;
      const rowsAt = (d, code) => snapRows(member, d, code);
      const trades = memberTrades(member).filter(t => inRange(t.date));
      const codes = new Set([...snaps.filter(s => s.date === date || s.date === prev), ...trades].map(codeOf));
      codes.delete('');

      return [...codes].map(code => {
        const now = rowsAt(date, code);
        const before = prev ? rowsAt(prev, code) : [];
        const base = sum(before);
        let bought = 0;
        let sold = 0;
        let bonus = 0;
        eventsFor(member, code, inRange).forEach(e => {
          if (e.stock) bonus += bonusShares(member, code, e.stock);
          else if (!e.trade) return;
          else if (signed(e.trade) > 0) bought += signed(e.trade);
          else sold -= signed(e.trade);
        });
        const expected = base + bought - sold + bonus;
        const actual = sum(now);
        const status = !prev && !bought && !sold ? 'nohistory'
          : expected === actual ? 'ok'
          : !prev && expected < actual ? 'partial'
          : 'diff';
        const formula = (prev ? `${U.fmtDate(prev)} 快照 ${U.fmtNum(base)}` : '從 0 開始') +
          (bought ? ` + 買進 ${U.fmtNum(bought)}` : '') +
          (sold ? ` − 賣出 ${U.fmtNum(sold)}` : '') +
          (bonus ? ` + 配股 ${U.fmtNum(bonus)}` : '');
        const name = (now[0] || before[0] || trades.find(t => codeOf(t) === code) || {}).name || '';
        return { member, date, prevDate: prev, code, name, expected, actual, status, formula, recId: now[0]?.id ?? null };
      });
    });
  }

  const checkOf = member => remember('checkMember', [member], () => checkMember(member));



  function check(scope = Store.scope) {
    const ids = Store.shown(scope);
    return remember('check', ids, () => ids.flatMap(checkOf));
  }


  const snapDate = (member, date) => snapDateBefore(member, date, true);

  return { codeOf, position, cashflow, entitled, memberAll, all, heldCodes, ledger, snaps, check, snapDate, sale, preview };
})();
