// Google 登入與 API
//   權限只要 drive.file：只能存取這個 App 自己建立的檔案，碰不到使用者雲端硬碟裡的其他檔案
//   登入用 Google 的彈出視窗；彈出視窗打不開時改成整頁跳轉到 Google，登入後帶著權杖跳回來
//   權杖有效 1 小時，存在這台裝置；過期後要使用者點一下才能重新取得（瀏覽器只允許點擊時跳出視窗）
const Google = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const TOKEN_KEY = 'stockbook.google.token';
  const STATE_KEY = 'stockbook.google.state';
  const AFTER_KEY = 'stockbook.google.after';
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  const DRIVE = 'https://www.googleapis.com/drive/v3';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };

  // code：need_login（要重新登入）、network、not_found、popup_closed、popup_failed_to_open 等
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

  // ---------- 權杖 ----------
  //   email：這個權杖是哪個 Google 帳號的（同步前核對過才知道，見 sync.js 的 checkAccount）
  let token = null; // { accessToken, expiresAt, email }
  try { token = JSON.parse(store.get(TOKEN_KEY)); } catch (_) {}

  // 剩不到 1 分鐘就當作過期，避免同步到一半失效
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

  // ---------- 彈出視窗登入 ----------
  let client = null;
  let waiting = null; // { resolve, reject }

  const ready = () => !!window.google?.accounts?.oauth2;

  // Google 登入元件（Google Identity Services）用到才下載：沒連結的人不用多載一支外部程式
  //   連結了的打開 App 就載入（見 sync.js 的 init：登入過期時要在點擊的當下跳出視窗，不能等下載）
  //   還沒連結的打開設定時載入（「連結 Google 帳號」在設定裡，見 app.js 的 openMenu）；整頁跳轉登入不需要它
  const GSI = 'https://accounts.google.com/gsi/client';
  let loading = false;
  function load() {
    const parent = typeof document !== 'undefined' && (document.head || document.body);
    if (loading || ready() || !parent?.appendChild) return;
    loading = true;
    const s = document.createElement('script');
    s.src = GSI;
    s.async = true;
    s.onerror = () => { loading = false; s.remove(); }; // 沒有網路：下次打開設定、重新整理時再試
    parent.appendChild(s);
  }

  function settle(err) {
    const w = waiting;
    waiting = null;
    if (w) err ? w.reject(err) : w.resolve();
  }

  // 一定要在使用者點擊的當下呼叫（中間不能有 await），否則瀏覽器會擋掉彈出視窗
  // hint：上次登入的帳號（不用再選帳號）；沒有時讓使用者選帳號
  // choose：一定讓使用者選帳號（上次選錯帳號時），hint 的那個排在前面
  function requestToken({ hint = '', choose = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!ready()) {
        load(); // 還沒下載、或上次下載失敗：現在開始，下次按就好
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

  // ---------- 整頁跳轉登入（彈出視窗打不開時） ----------
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

  // after：跳回來之後要接著做的事（'link' 或 'sync'）
  function redirectLogin({ hint = '', after = '' } = {}) {
    const state = (typeof crypto !== 'undefined' && crypto.randomUUID?.()) || U.uid(); // 跳回來時核對是不是這次發出的登入，用猜不到的亂數
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

  // 從 Google 跳回來時網址 # 後面帶著權杖或錯誤；回傳 { after } 或 { error }，不是跳回來的回傳 null
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

  // ---------- API ----------
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

  // 取消連結、登出：撤銷這次的授權，下次連結時會重新詢問
  //   回傳的 Promise 在 Google 回覆後完成（最多等 3 秒），登出時等它再清資料、重新載入頁面
  //   登入元件沒載入時（例如用整頁跳轉登入的）直接請 Google 撤銷；這個網址不回 CORS，看不到成功沒有
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
