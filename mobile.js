/* Phone/tablet shell. Original controls are moved, never cloned, so their
   handlers and state survive resizing. Desktop DOM order is restored exactly. */
(() => {
  'use strict';
  const mq = window.matchMedia('(max-width: 900px)');
  const tools = document.getElementById('mobileTools');
  const body = document.getElementById('mobileToolsBody');
  const more = document.getElementById('btnMobileMore');
  const sidebar = document.getElementById('sidebar');
  const list = document.getElementById('btnList');
  const maps = document.getElementById('mapDrawer');
  const calendar = document.getElementById('calDrawer');
  const search = document.querySelector('.tb-search');
  const moved = [];
  let mobile = false;
  const setList = open => {
    sidebar.classList.toggle('closed', !open);
    list.classList.toggle('active', open);
    list.setAttribute('aria-expanded', String(open));
  };
  const closeTools = () => {
    tools.classList.add('hidden'); more.setAttribute('aria-expanded', 'false');
  };
  const closeDrawers = () => {
    maps.classList.add('hidden'); calendar.classList.add('hidden');
  };
  window.MobileUI = {
    prepareEditor() {
      if (!mobile) return;
      closeTools(); closeDrawers(); setList(false);
    }
  };
  const relocate = (el, parent) => {
    const anchor = document.createComment('desktop control position');
    el.before(anchor); moved.push({ el, anchor }); parent.appendChild(el);
  };
  const applyLayout = () => {
    if (mobile === mq.matches) return;
    mobile = mq.matches;
    closeTools();
    if (mobile) {
      for (const id of ['btnUndo', 'btnRedo', 'btnLabels', 'btnShot', 'btnExport', 'btnImport', 'btnTheme', 'btnLive', 'btnHelp']) {
        const el = document.getElementById(id);
        relocate(el, body);
      }
      relocate(search, sidebar);
      sidebar.insertBefore(search, document.getElementById('sideTabs'));
      setList(false);
    } else {
      for (const { el, anchor } of moved) { anchor.replaceWith(el); }
      moved.length = 0;
      setList(true);
    }
    closePop();
    // Refit to the new usable map size, rather than keeping desktop offsets.
    requestAnimationFrame(() => fitView(false));
  };
  for (const [id, label] of [['btnUndo', 'UNDO'], ['btnRedo', 'REDO'], ['btnTheme', 'THEME'], ['btnHelp', 'HELP']]) {
    const span = document.createElement('span'); span.className = 'mobile-only'; span.textContent = label;
    document.getElementById(id).appendChild(span);
  }
  list.setAttribute('aria-controls', 'sidebar');
  list.setAttribute('aria-expanded', String(!sidebar.classList.contains('closed')));
  more.addEventListener('click', () => {
    const open = tools.classList.contains('hidden');
    if (open) {
      closeDrawers(); setList(false); closePop(); tools.classList.remove('hidden');
      more.setAttribute('aria-expanded', 'true');
    } else closeTools();
  });
  document.getElementById('mobileToolsClose').addEventListener('click', () => { closeTools(); more.focus(); });
  document.getElementById('mobileSidebarClose').addEventListener('click', () => { setList(false); list.focus(); });
  list.addEventListener('click', () => {
    list.setAttribute('aria-expanded', String(!sidebar.classList.contains('closed')));
    if (mobile) { closeTools(); closeDrawers(); closePop(); }
  });
  for (const [id, other] of [['btnMaps', calendar], ['btnCal', maps]]) {
    document.getElementById(id).addEventListener('click', () => {
      if (!mobile) return;
      closeTools(); setList(false); closePop(); other.classList.add('hidden');
    });
  }
  body.addEventListener('click', e => {
    if (e.target.closest('button')) closeTools();
  });
  document.getElementById('modeGroup').addEventListener('click', () => {
    if (mobile) { closeTools(); closeDrawers(); setList(false); }
  });
  document.addEventListener('pointerdown', e => {
    if (!mobile || !e.target.closest('#viewport') || e.target.closest('#pop')) return;
    const overlay = !tools.classList.contains('hidden') || !sidebar.classList.contains('closed')
      || !maps.classList.contains('hidden') || !calendar.classList.contains('hidden');
    if (overlay) {
      closeTools(); closeDrawers(); setList(false);
      e.preventDefault(); e.stopPropagation();
    }
  }, true);
  document.addEventListener('keydown', e => {
    if (mobile && e.key === 'Escape') { closeTools(); closeDrawers(); setList(false); }
  });
  const size = () => {
    document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height || window.innerHeight}px`);
  };
  let lastWidth = document.documentElement.clientWidth;
  window.visualViewport?.addEventListener('resize', size);
  window.addEventListener('resize', () => {
    size();
    const width = document.documentElement.clientWidth;
    if (mobile && width !== lastWidth) requestAnimationFrame(() => fitView(false));
    lastWidth = width;
  });
  mq.addEventListener('change', applyLayout);
  size(); applyLayout();
})();
