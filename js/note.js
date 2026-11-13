




const Note = (() => {
  const btn = (title, body) => `<button type="button" class="intro-more" data-act="note" aria-expanded="false" aria-label="說明：${U.esc(title)}">說明</button>` +
    `<template class="note-body">${body}</template>`;
  const html = {
    btn,
    line: (line, title, body) => `<div class="list-intro one"><span>${line}</span>${btn(title, body)}</div>`,
  };

  if (typeof document === 'undefined' || !document.body) return { ...html, close() {}, el: null };

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  document.body.append(tip);
  let anchor = null;
  let openY = 0;
  let scroller = null;
  let openTop = 0;

  function close() {
    if (!anchor) return;
    tip.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
    anchor = null;
  }




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
    const roomBelow = bottom - r.bottom - 16;
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
      if (!e.target.closest('button, a')) close();
      return;
    }
    close();

    if (!e.target.closest('.tabbar, .subtabs, .sheet-head, .kl-nav')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !anchor) return;
    e.preventDefault();
    close();
  });

  addEventListener('scroll', () => { if (anchor && (Math.abs(scrollY - openY) > 40 || !anchor.isConnected)) close(); }, { passive: true });
  document.addEventListener('scroll', e => {
    if (anchor && scroller && e.target === scroller && (Math.abs(scroller.scrollTop - openTop) > 40 || !anchor.isConnected)) close();
  }, { capture: true, passive: true });
  document.addEventListener('close', e => { if (anchor && e.target.contains?.(anchor)) close(); }, true);
  addEventListener('resize', close);

  return { ...html, close, el: tip };
})();
