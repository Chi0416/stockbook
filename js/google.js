



const Google = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const TOKEN_KEY = U.key('google.token');
  const STATE_KEY = U.key('google.state');
  const AFTER_KEY = U.key('google.after');
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  const DRIVE = 'https://www.googleapis.com/drive/v3';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };


  class GoogleError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  const ERRORS = {
    popup_failed_to_open: '登入視窗打不開',
    popup_closed: '登入視窗被關掉了',
    access_denied: '沒有允許存取，所以無法連結',
    not_loaded: 'Google 登入元件下載中，請等幾秒再按一次（沒有網路的話，連上網路再試）',
  };
  const errorText = code => ERRORS[code] || `Google 登入失敗（${code}）`;



  let token = null;
  try { token = JSON.parse(store.get(TOKEN_KEY)); } catch (_) {}


  const hasToken = () => !!token && token.expiresAt > Date.now() + 60000;

  function saveToken(accessToken, expiresIn) {
    token = { accessToken, expiresAt: Date.now() + Number(expiresIn) * 1000 };
    store.set(TOKEN_KEY, JSON.stringify(token));
  }

  function clearToken() {
    token = null;
    store.del(TOKEN_KEY);
  }

  const tokenEmail = () => token?.email || '';
  function setTokenEmail(email) {
    if (!token) return;
    token.email = email;
    store.set(TOKEN_KEY, JSON.stringify(token));
  }


  let client = null;
  let waiting = null;

  const ready = () => !!window.google?.accounts?.oauth2;




  const GSI = 'https://accounts.google.com/gsi/client';
  let loading = false;
  function load() {
    const parent = typeof document !== 'undefined' && (document.head || document.body);
    if (loading || ready() || !parent?.appendChild) return;
    loading = true;
    const s = document.createElement('script');
    s.src = GSI;
    s.async = true;
    s.onerror = () => { loading = false; s.remove(); };
    parent.appendChild(s);
  }

  function settle(err) {
    const w = waiting;
    waiting = null;
    if (w) err ? w.reject(err) : w.resolve();
  }




  function requestToken({ hint = '', choose = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!ready()) {
        load();
        reject(new GoogleError(errorText('not_loaded'), 'not_loaded'));
        return;
      }
      if (!client) {
        client = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.googleClientId,
          scope: SCOPE,
          callback(r) {
            if (r.error) return settle(new GoogleError(errorText(r.error), r.error));
            if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
              return settle(new GoogleError('沒有勾選存取雲端硬碟的權限，請再試一次並允許', 'scope'));
            }
            saveToken(r.access_token, r.expires_in);
            settle();
          },
          error_callback(e) {
            settle(new GoogleError(errorText(e.type), e.type));
          },
        });
      }
      settle(new GoogleError('已重新開始登入', 'superseded'));
      waiting = { resolve, reject };
      client.requestAccessToken(choose || !hint
        ? { prompt: 'select_account', ...(hint ? { login_hint: hint } : {}) }
        : { prompt: '', login_hint: hint });
    });
  }


  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');


  function redirectLogin({ hint = '', after = '' } = {}) {
    const state = (typeof crypto !== 'undefined' && crypto.randomUUID?.()) || U.uid();
    store.set(STATE_KEY, state);
    store.set(AFTER_KEY, after);
    const p = new URLSearchParams({
      client_id: CONFIG.googleClientId,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: SCOPE,
      include_granted_scopes: 'true',
      state,
    });
    if (hint) p.set('login_hint', hint);
    else p.set('prompt', 'select_account');
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
  }


  function consumeRedirect() {
    if (!/(^#|&)(access_token|error)=/.test(location.hash)) return null;
    const h = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    const expected = store.get(STATE_KEY);
    const after = store.get(AFTER_KEY) || '';
    store.del(STATE_KEY);
    store.del(AFTER_KEY);
    if (h.get('error')) return { error: errorText(h.get('error')) };
    if (!expected || h.get('state') !== expected) return { error: '登入後跳回來時對不上原本的頁面，請再試一次' };
    if (!(h.get('scope') || '').split(' ').includes(SCOPE)) return { error: '沒有勾選存取雲端硬碟的權限，請再試一次並允許' };
    saveToken(h.get('access_token'), h.get('expires_in'));
    return { after };
  }


  async function api(url, { method = 'GET', body } = {}) {
    if (!hasToken()) throw new GoogleError('需要重新連線 Google', 'need_login');
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      throw new GoogleError('連不上網路，請確認網路後再試一次', 'network');
    }
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) {}
    if (res.status === 401) {
      clearToken();
      throw new GoogleError('需要重新連線 Google', 'need_login');
    }
    if (!res.ok) {
      const msg = json.error?.message || text.slice(0, 120);
      throw new GoogleError(`Google 回應錯誤（${res.status}）：${msg}`, res.status === 404 ? 'not_found' : res.status === 403 ? 'forbidden' : 'api');
    }
    return json;
  }




  function signOut() {
    const t = token;
    clearToken();
    if (!t) return Promise.resolve();
    if (!ready()) {
      const revoke = fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ token: t.accessToken }) });
      return Promise.race([revoke.catch(() => {}), new Promise(r => setTimeout(r, 3000))]).then(() => {});
    }
    return new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      const done = () => { clearTimeout(timer); resolve(); };
      try { google.accounts.oauth2.revoke(t.accessToken, done); } catch (_) { done(); }
    });
  }

  return { SHEETS, DRIVE, ready, load, hasToken, tokenEmail, setTokenEmail, clearToken, requestToken, redirectLogin, consumeRedirect, api, signOut };
})();
