








const Contract = (() => {
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = v => typeof v === 'string';
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const bool = v => typeof v === 'boolean';
  const date = v => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const orNull = f => v => v === null || f(v);
  const oneOf = (...list) => v => list.includes(v);
  const either = (...fs) => v => fs.some(f => f(v));

  const tuple = (fs, min = fs.length) => v => Array.isArray(v) && v.length >= min && v.length <= fs.length && v.every((x, i) => fs[i](x));
  const listOf = f => v => Array.isArray(v) && v.every(f);

  const mapOf = (f, keyOk = str) => v => isObj(v) && Object.entries(v).every(([k, x]) => keyOk(k) && f(x));
  const year = k => /^\d{4}$/.test(k);



  const SPEC = {

    prices: {
      top: d => str(d.date) && isObj(d.rows),
      fields: {
        date,
        complete: bool,
        index: mapOf(o => isObj(o) && date(o.date) && num(o.close) && num(o.change)),
        rows: mapOf(tuple([num, date], 1)),
        months: mapOf(mapOf(num), date),
      },
    },

    dividends: {
      top: d => str(d.updated) && Array.isArray(d.rows),
      fields: {
        updated: date,
        per: mapOf(oneOf(12, 4, 2)),
        rows: listOf(tuple([str, str, date, either(date, oneOf('', null)), orNull(num), orNull(num)])),
      },
    },

    eps: {
      top: d => str(d.updated) && isObj(d.rows),
      fields: {
        updated: date,
        rows: mapOf(o => isObj(o) && mapOf(tuple([orNull(num), orNull(num), orNull(num), orNull(num)], 1), year)(o.eps)
          && (o.div === undefined || mapOf(tuple([num, num, num]), year)(o.div))
          && (o.at === undefined || date(o.at))),
      },
    },

    kd: {
      top: d => str(d.date) && isObj(d.rows),
      fields: { date, rows: mapOf(tuple([orNull(num), orNull(num), orNull(num), orNull(num)])) },
    },

    candles: {
      top: d => Array.isArray(d.days) && isObj(d.rows),
      fields: {
        date,
        days: listOf(date),
        rows: mapOf(listOf(either(oneOf(null), num, tuple([num, num, num, num, num, orNull(num), orNull(num)], 5)))),
      },
    },

    taiex: {
      top: d => Array.isArray(d.days) && d.days.length > 0,
      fields: {
        date,
        days: listOf(tuple([date, num, num, num, num, orNull(num)], 5)),
        intraday: isObj,
        chips: listOf(tuple([date, num, num, num, num])),
        margin: listOf(tuple([date, num, num, num, num])),
        ratio: listOf(tuple([date, num])),
        cost: isObj,
      },
    },

    etf: {
      top: d => isObj(d.etfs),
      fields: {
        etfs: mapOf(o => isObj(o) && str(o.name) && str(o.source) && date(o.date) && str(o.url) && listOf(tuple([str, num]))(o.holdings)),
      },
    },



    yield: {
      top: d => isObj(d.rows),
      fields: {
        date,
        updated: date,
        rows: mapOf(tuple([orNull(num), orNull(num), orNull(num), orNull(num), orNull(num), orNull(num), orNull(num), orNull(num), orNull(num), orNull(num)], 6)),
      },
    },

    ma: {
      top: d => Array.isArray(d.days) && isObj(d.rows),
      fields: {
        date,
        a: listOf(listOf(num)),
        days: listOf(date),
        rows: mapOf(either(tuple([oneOf(null), num]), v => Array.isArray(v) && v.length === 12 && num(v[0]))),
      },
    },

    forecast: {
      top: d => isObj(d.rows),
      fields: { date, updated: date, rows: mapOf(tuple([orNull(num), orNull(num), oneOf(0, 1, 2)])) },
    },

    epsdetail: {
      top: d => isObj(d.rows),
      fields: {
        date,
        updated: date,

        season: v => isObj(v) && num(v.year) && [1, 2, 3, 4].includes(v.q) && num(v.ahead),
        rows: mapOf(v => Array.isArray(v) && v.length === 21),
      },
    },

    screen: {
      top: d => isObj(d.rows) && Array.isArray(d.fields),
      fields: {
        date,
        updated: date,
        fields: listOf(str),
        rows: (v, d) => mapOf(r => Array.isArray(r) && r.length === d.fields.length && r.every(orNull(num)))(v),
      },
    },
  };

  const names = Object.keys(SPEC);
  const spec = name => {
    if (!Object.hasOwn(SPEC, name)) throw new Error(`合約裡沒有 ${name} 這種資料`);
    return SPEC[name];
  };


  const valid = name => {
    const { top } = spec(name);
    return data => isObj(data) && !!top(data);
  };


  function problems(name, data) {
    const { top, fields } = spec(name);
    if (!isObj(data)) return [`${name}：不是物件`];
    const out = [];
    if (!top(data)) out.push(`${name}：最外層不對`);
    for (const [k, check] of Object.entries(fields)) {
      const v = data[k];
      if (v === undefined) { out.push(`${name}.${k}：沒有`); continue; }
      if (check(v, data)) continue;

      const items = Array.isArray(v) ? v.map((x, i) => [i, x]) : isObj(v) ? Object.entries(v) : [];
      const bad = items.find(([key, x]) => {
        try { return !check(Array.isArray(v) ? [x] : { [key]: x }, data); } catch (_) { return true; }
      });
      out.push(bad ? `${name}.${k}[${bad[0]}]：${JSON.stringify(bad[1])?.slice(0, 160)}` : `${name}.${k}：格式不對`);
    }
    return out.slice(0, 5);
  }

  return { names, valid, problems };
})();
