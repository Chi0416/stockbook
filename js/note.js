// 說明的小泡泡：「說明」點了在那一行下面跳出來（像 tooltip，背景不變暗、不蓋住整頁）；點哪裡都會關，再點一次「說明」也是關
//   Note.line(那一行, 標題, 內容)：一行字＋右邊「說明」，內容放在「說明」後面的 <template>，每一頁不用自己接點擊
//   Note.btn(標題, 內容)：只有「說明」（例如接在除權息「即將除權息」的標題後面）
//   點旁邊只是關掉，不會順便點到後面的股票；底下的分頁、上面的子分頁照常切換
//   泡泡裡的「調整」（KD 標記、星星條件）照樣能點：app.js 先關掉泡泡再打開設定
const Note = (() => {
  const btn = (title, body) => `<button type="button" class="intro-more" data-act="note" aria-expanded="false" aria-label="說明：${U.esc(title)}">說明</button>` +
    `<template class="note-body">${body}</template>`;
  const html = {
    btn,
    line: (line, title, body) => `<div class="list-intro one"><span>${line}</span>${btn(title, body)}</div>`,
  };
  // 測試（沒有畫面，或只有假的 document）時只產生 HTML
  if (typeof document === 'undefined' || !document.body) return { ...html, close() {}, el: null };

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.append(tip);
  let anchor = null; // 目前打開的是哪一個「說明」
  let openY = 0;
  let scroller = null; // 在 sheet 裡打開的：sheet 捲動的那一層
  let openTop = 0;

  function close() {
    if (!anchor) return;
    tip.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
    anchor = null;
  }

  // 放在「說明」下面、右邊對齊，小箭頭指著「說明」；下面放不下（例如現金單最下面那一行）改放上面
  //   上下都放不下（說明很長、「說明」在畫面中間，例如大盤的融資融券）：放在空間比較大的那一邊，泡泡裡面可以捲（.tip-body）
  //   詳細頁（sheet）裡的「說明」：泡泡放進那個 sheet，才會蓋在 sheet 上面；位置照 sheet 算，sheet 裡面往下滑也會關
  function open(b) {
    const host = b.closest('dialog[open]');
    (host || document.body).append(tip);
    tip.innerHTML = `<div class="tip-body">${b.nextElementSibling?.innerHTML || ''}</div>`;
    tip.hidden = false;
    anchor = b;
    b.setAttribute('aria-expanded', 'true');
    const r = b.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = tip.offsetWidth;
    let h = tip.offsetHeight;
    const left = Math.max(12, Math.min(r.right + 4 - w, vw - w - 12));
    const box = host?.getBoundingClientRect();
    const bottom = box ? box.bottom : innerHeight - (document.querySelector('.tabbar')?.offsetHeight || 0);
    const roomBelow = bottom - r.bottom - 16; // 和「說明」隔 8px，和邊緣再留 8px
    const roomAbove = r.top - (box ? box.top : 0) - 16;
    const below = h <= roomBelow || (h > roomAbove && roomBelow >= roomAbove);
    const room = below ? roomBelow : roomAbove;
    if (h > room) {
      tip.firstElementChild.style.maxHeight = `${Math.max(100, room)}px`;
      h = tip.offsetHeight;
    }
    const at = { x: box ? -box.left : scrollX, y: box ? -box.top : scrollY };
    tip.classList.toggle('above', !below);
    tip.style.left = `${left + at.x}px`;
    tip.style.top = `${(below ? r.bottom + 8 : r.top - 8 - h) + at.y}px`;
    tip.style.setProperty('--arrow', `${r.left + r.width / 2 - left}px`);
    openY = scrollY;
    scroller = host?.querySelector('.sheet-body') || null;
    openTop = scroller?.scrollTop ?? 0;
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act="note"]');
    if (b) {
      e.stopPropagation();
      const same = b === anchor;
      close();
      if (!same) open(b);
      return;
    }
    if (!anchor) return;
    if (tip.contains(e.target)) {
      if (!e.target.closest('button, a')) close(); // 泡泡裡的「調整」交給 app.js
      return;
    }
    close();
    // 底下的分頁、上面的子分頁、sheet 最上面的「關閉」、上一檔／下一檔照常點得到
    if (!e.target.closest('.tabbar, .subtabs, .sheet-head, .kl-nav')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  // Esc 先只關泡泡（不連 sheet 一起關）
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !anchor) return;
    e.preventDefault();
    close();
  });
  // 往下滑（頁面或 sheet 裡面）、轉橫向、列表重畫（「說明」不見了）、sheet 關掉時關掉
  addEventListener('scroll', () => { if (anchor && (Math.abs(scrollY - openY) > 40 || !anchor.isConnected)) close(); }, { passive: true });
  document.addEventListener('scroll', e => {
    if (anchor && scroller && e.target === scroller && (Math.abs(scroller.scrollTop - openTop) > 40 || !anchor.isConnected)) close();
  }, { capture: true, passive: true });
  document.addEventListener('close', e => { if (anchor && e.target.contains?.(anchor)) close(); }, true);
  addEventListener('resize', close);

  return { ...html, close, el: tip };
})();
