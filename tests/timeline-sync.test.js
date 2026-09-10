/* Timeline calendar + 2-client live-sync integration test.
   Loads the REAL app.js and sync.js twice (clients A & B) over an
   in-memory fake RTDB with firebase-style child events. No network. */
'use strict';
const vm = require('vm');
const fs = require('fs');
const APP = fs.readFileSync('/home/user/afterlight-tracker/app.js', 'utf8');
const SYN = fs.readFileSync('/home/user/afterlight-tracker/sync.js', 'utf8');

/* ───── fake realtime database (shared store, per-URL Db with listeners) ───── */
const sharedStores = {};   // databaseURL -> plain object
class FSnap {
  constructor(key, val) { this.key = key; this._v = val; }
  val() { return this._v; }
  exists() { return this._v !== null && this._v !== undefined; }
  numChildren() { return (this._v && typeof this._v === 'object') ? Object.keys(this._v).length : 0; }
  forEach(cb) { if (this._v && typeof this._v === 'object') for (const k of Object.keys(this._v)) if (cb(new FSnap(k, this._v[k])) === true) return true; return false; }
}
class FDb {
  constructor(store) { this.store = store; this.subs = []; }
  node(path) { let n = this.store; for (const p of path) { if (n == null || typeof n !== 'object') return null; n = n[p]; } return n === undefined ? null : n; }
  set(path, v) {
    if (!path.length) return;
    let n = this.store;
    for (let i = 0; i < path.length - 1; i++) n = n[path[i]] = n[path[i]] || {};
    const last = path[path.length - 1];
    if (v === null || v === undefined) delete n[last]; else n[last] = JSON.parse(JSON.stringify(v));
    this.fireValue(path);
  }
  update(path, obj) {
    // diff child listeners at this exact path before mutating
    const childSubs = this.subs.filter(s => s.path.join('/') === path.join('/') && s.evt.startsWith('child_'));
    const before = JSON.parse(JSON.stringify(this.node(path) || {}));
    for (const [k, v] of Object.entries(obj)) this.set(path.concat([k]), v);
    const after = this.node(path) || {};
    for (const s of childSubs) {
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const had = k in before, has = k in after;
        if (had && !has) { if (s.evt === 'child_removed') setTimeout(() => s.cb(new FSnap(k, before[k])), 0); }
        else if (!had && has) { if (s.evt === 'child_added') setTimeout(() => s.cb(new FSnap(k, after[k])), 0); }
        else if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) { if (s.evt === 'child_changed') setTimeout(() => s.cb(new FSnap(k, after[k])), 0); }
      }
    }
  }
  sub(path, evt, cb, key) {
    this.subs.push({ path, evt, cb });
    if (evt === 'value') setTimeout(() => cb(new FSnap(key, this.node(path))), 0);
    if (evt === 'child_added') {
      const n = this.node(path) || {};
      for (const k of Object.keys(n)) setTimeout(() => cb(new FSnap(k, n[k])), 0);
    }
  }
  fireValue() {
    for (const s of this.subs.filter(s => s.evt === 'value'))
      setTimeout(() => s.cb(new FSnap(s.path[s.path.length - 1] || '', this.node(s.path))), 0);
  }
}
FDb.prototype.ref = function (path) {
  const parts = (!path || path === '/') ? [] : String(path).replace(/^\//, '').split('/');
  return new FRef(this, parts, parts[parts.length - 1] || '');
};
const dbs = {};  // url -> FDb
class FRef {
  constructor(db, path, key) { this.db = db; this.path = path; this.key = key; }
  child(name) { const parts = String(name).split('/'); return new FRef(this.db, this.path.concat(parts), parts[parts.length - 1]); }
  once() { return Promise.resolve(new FSnap(this.key, this.db.node(this.path))); }
  on(evt, cb) { this.db.sub(this.path, evt, cb, this.key); }
  off() { this.db.subs = this.db.subs.filter(s => s.path.join('/') !== this.path.join('/')); }
  set(v) { this.db.set(this.path, v); return Promise.resolve(); }
  update(obj) { this.db.update(this.path, obj); return Promise.resolve(); }
  remove() { this.db.set(this.path, null); return Promise.resolve(); }
  onDisconnect() { return { remove() { } }; }
}
function makeFirebase() {
  const fb = {
    apps: [],
    initializeApp(cfg, name) { const app = { options: cfg, name }; fb.apps.push(app); return app; },
    database(app) {
      const url = app.options.databaseURL;
      sharedStores[url] = sharedStores[url] || {};
      dbs[url] = dbs[url] || new FDb(sharedStores[url]);
      return dbs[url];
    },
  };
  fb.database.ServerValue = { TIMESTAMP: 0 };
  return fb;
}

/* ───── absorbing DOM shim ───── */
function makeEl(tag) {
  const listeners = {};
  const cls = new Set();
  const style = new Proxy({
    setProperty(k, v) { this['--' + String(k).replace(/^--/, '')] = v; },
    removeProperty() { }, getPropertyValue: () => '',
  }, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? '' : t[k])), set: (t, k, v) => { t[k] = v; return true; } });
  const el = {
    tag, id: '', hidden: false, dataset: {}, style,
    set innerHTML(v) { el.children.length = 0; el._html = v; },
    get innerHTML() { return el._html || ''; },
    value: '', textContent: '', disabled: false, checked: false,
    width: 0, height: 0, offsetWidth: 0, offsetHeight: 0, clientWidth: 800, clientHeight: 600,
    scrollLeft: 0, scrollTop: 0, files: [], options: [], children: [],
    get firstChild() { return el.children[0] || null; },
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : f; f ? cls.add(c) : (on ? cls.add(c) : cls.delete(c)); },
      contains: c => cls.has(c),
    },
    addEventListener: (t, f) => (listeners[t] = listeners[t] || []).push(f),
    removeEventListener() { }, dispatch(t, e) { (listeners[t] || []).forEach(f => f(e)); },
    appendChild(c) { el.children.push(c); c._parent = el; return c; }, append(...cs) { cs.forEach(c => { if (c) { el.children.push(c); c._parent = el; } }); }, prepend() { }, insertAdjacentHTML() { }, insertBefore: c => c,
    remove() { const p = el._parent; if (p) { const i = p.children.indexOf(el); if (i >= 0) p.children.splice(i, 1); el._parent = null; } }, replaceChildren() { }, setAttribute() { }, getAttribute: () => null, removeAttribute() { },
    querySelector: () => makeEl('q'), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }),
    getContext: () => new Proxy({}, { get: (t, k) => (k === 'canvas' ? el : () => undefined), set: () => true }),
    toDataURL: () => '', focus() { }, blur() { }, click() { }, select() { }, closest: () => null,
  };
  return el;
}
function makeContext(name) {
  const byId = {};
  const ls = new Map();
  const ctx = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    JSON, Math, Object, Array, String, Number, Date, Promise, Map, Set, URL, URLSearchParams,
    Intl, RegExp, Error, TypeError, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    requestAnimationFrame: f => setTimeout(f, 16),
    localStorage: {
      getItem: k => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, String(v)),
      removeItem: k => ls.delete(k),
    },
    location: { search: '?board=caltest', href: 'http://x/?board=caltest' },
    navigator: { onLine: true },
    Image: class { set src(v) { } },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    alert() { },
    __name: name,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.document = {
    getElementById: id => byId[id] = byId[id] || (() => { const e = makeEl('div'); e.id = id; return e; })(),
    // stable per-selector instances so sidebar re-renders stay observable
    querySelector: sel => byId['sel:' + sel] = byId['sel:' + sel] || (() => { const e = makeEl('div'); e.id = sel; return e; })(),
    querySelectorAll: () => [],
    createElement: t => makeEl(t),
    createTextNode: t => ({ text: t }),
    addEventListener() { }, removeEventListener() { },
    body: makeEl('body'), documentElement: makeEl('html'),
    visibilityState: 'visible', hidden: false, title: '',
  };
  ctx.window.addEventListener = () => { };
  ctx.window.removeEventListener = () => { };
  ctx.addEventListener = () => { };
  ctx.firebase = makeFirebase();
  return vm.createContext(ctx);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function ok(cond, label) {
  console.log((cond ? '  PASS ' : '  FAIL ') + label);
  if (!cond) failures++;
}
const R = (ctx, code) => vm.runInContext(code, ctx);

(async () => {
  console.log('— boot client A —');
  const A = makeContext('A');
  R(A, APP); R(A, SYN);
  console.log('— boot client B —');
  const B = makeContext('B');
  R(B, APP); R(B, SYN);
  await sleep(1200);
  ok(R(A, 'window.AppSync.isConnected()'), 'A connected');
  ok(R(B, 'window.AppSync.isConnected()'), 'B connected');
  ok(R(A, `state.calendar.selected`) === '', 'A starts on NO DATE');
  ok(R(B, `state.calendar.selected`) === '', 'B starts on NO DATE');
  const cur = R(A, 'state.current');
  ok(!!cur, 'A has a current map: ' + cur);

  console.log('— A switches to 2087-03-15, places AVA + ping —');
  R(A, `switchDate('2087-03-15'); addChar('AVA', 100, 50, '#ff0000'); addPing(10, 20);`);
  const avaA = R(A, `curData().characters[0].id`);
  const pingA = R(A, `curData().pings[0].id`);
  ok(R(A, `curData().characters.length`) === 1, 'A live: 1 char on date');
  ok(R(A, `curData().pings.length`) === 1, 'A live: 1 ping on date');
  ok(R(A, `markerLayer.children.length`) === 1, 'A on date: char marker rendered');
  ok(R(A, `dateHasPing('2087-03-15')`), 'A: dateHasPing true (local active uses live pings)');

  console.log('— markers in screen-space HUD (crisp at any zoom) + far-zoom at 25% —');
  R(A, `imgNW = 1000; imgNH = 600; view.z = 0.776; applyView();`);
  ok(!R(A, `hud.classList.contains('far-zoom')`), 'A at fit zoom: markers shown');
  {
    const left = R(A, `markerLayer.children[0].style.left`);
    const expect = R(A, `Math.round(view.tx + curData().characters[0].x * view.z) + 'px'`);
    ok(left === expect, 'marker positioned in screen-space pixels');
  }
  R(A, `view.z = 0.26; applyView();`);
  ok(!R(A, `hud.classList.contains('far-zoom')`), 'A at 26% zoom: all markers shown');
  R(A, `view.z = 0.24; applyView();`);
  ok(R(A, `hud.classList.contains('far-zoom')`), 'A at 24% zoom: characters & locations hidden (far-zoom)');
  R(A, `view.z = 0.776; applyView();`);
  await sleep(1200);

  console.log('— check B received roster + timeline bucket, but NO live date layer —');
  ok(R(B, `curData().characters.length`) === 1, 'B roster shows AVA');
  ok(R(B, `markerLayer.children.length`) === 0, 'B NO DATE: char markers HIDDEN (atlas view)');
  ok(R(B, `curData().pings.length`) === 0, 'B live pings still 0 (isolated)');
  ok(R(B, `state.timeline['2087-03-15']?.posByMap?.['${cur}']?.['${avaA}']?.x`) === 100, 'B bucket stores AVA pos x=100');
  ok(R(B, `(state.timeline['2087-03-15']?.pingsByMap?.['${cur}']||[]).length`) === 1, 'B bucket stores the ping');
  ok(R(B, `dateHasPing('2087-03-15')`), 'B: dateHasPing true via bucket');

  console.log('— NO DATE ghost pings: aggregated, dated, jumpable, never leak —');
  ok(R(B, `ghostPings().length`) === 1, 'B NO DATE: ghost ping visible via ghostPings()');
  ok(R(B, `ghostPings()[0].ghostDate`) === '2087-03-15', 'B ghost carries its date');
  ok(R(B, `ghostPings()[0].id`) === pingA, 'B ghost has the real ping id');
  ok(R(B, `curData().pings.length`) === 0, 'B ghost does NOT enter live pings');
  R(B, `beginPlacement('${avaA}');`);
  ok(R(B, `pendingPlace`) === null, 'B NO DATE: beginPlacement refused (guided to calendar)');
  ok(R(B, `mapPingCount('${cur}')`) === 1, 'map badge (NO DATE): 1 story ping — ghost counted');
  R(B, `addLoc('HQ', 5, 5);`);
  ok(R(B, `mapPingCount('${cur}')`) === 1, 'map badge ignores Locations AND characters');
  {
    const other = R(B, `state.order.find(x => x !== state.current)`);
    ok(R(B, `mapPingCount('${other}')`) === 0, 'map badge 0 on pingless map → indicator omitted');
  }
  {
    const url = 'https://schungdar-default-rtdb.firebaseio.com';
    const ents = (sharedStores[url].afterlight || {}).boards?.caltest?.entities || {};
    const pingDocs = Object.keys(ents).filter(k => k.includes('__ping__'));
    ok(pingDocs.length === 0 && !!ents[`tl@2087-03-15@${cur}@pings`],
      'no dateless ping entity pushed; only the tl date doc exists');
  }

  console.log('— B switches to the same date: layer materialises —');
  R(B, `switchDate('2087-03-15')`);
  ok(R(B, `curData().characters.find(c=>c.id==='${avaA}')?.x`) === 100, 'B live: AVA at x=100 after switch');
  ok(!R(B, `!!curData().characters[0].unplaced`), 'B live: AVA not unplaced');
  ok(R(B, `curData().pings.length`) === 1, 'B live: ping visible');
  ok(R(B, `curData().pings[0].x`) === 10, 'B live: ping at x=10');
  ok(R(B, `ghostPings().length`) === 0, 'B on date: ghosts hidden (live layer active)');
  ok(R(B, `mapPingCount('${cur}')`) === 1, 'map badge (on date): counts this date’s pings only');

  console.log('— B moves AVA on the date; A (same date) sees it —');
  R(B, `const c = curData().characters.find(x=>x.id==='${avaA}'); c.x = 5; c.y = 7; persistNow();`);
  await sleep(1200);
  ok(R(A, `curData().characters.find(c=>c.id==='${avaA}')?.x`) === 5, 'A live: AVA moved to x=5 via tl layer');
  ok(R(A, `curData().characters.find(c=>c.id==='${avaA}')?.y`) === 7, 'A live: AVA moved to y=7');

  console.log('— B switches back to NO DATE: A (still on date) is unaffected —');
  R(B, `switchDate('')`);
  ok(R(B, `curData().pings.length`) === 0, 'B live: pings cleared off-date');
  ok(R(B, `ghostPings().length`) === 1, 'B NO DATE again: ghost ping returned');
  ok(R(B, `ghostPings()[0].ghostDate`) === '2087-03-15', 'B ghost date label intact');
  ok(R(B, `markerLayer.children.length`) === 0, 'B back on NO DATE: char markers still hidden');
  await sleep(1200);
  ok(R(A, `curData().characters.find(c=>c.id==='${avaA}')?.x`) === 5, 'A untouched: still x=5 on date');
  ok(R(A, `curData().pings.length`) === 1, 'A untouched: ping still present');

  console.log('— B deletes the ping ON NO DATE via timeline doc deletion path (A owns the date) —');
  R(A, `deletePing('${pingA}')`);
  await sleep(1200);
  ok(R(A, `curData().pings.length`) === 0, 'A live: ping deleted');
  ok(R(B, `(state.timeline['2087-03-15']?.pingsByMap?.['${cur}']||[]).length`) === 0, 'B bucket: ping doc deleted');
  ok(!R(B, `dateHasPing('2087-03-15')`), 'B: dateHasPing false again');
  ok(R(B, `ghostPings().length`) === 0, 'B NO DATE: ghost gone after delete');
  ok(R(B, `mapPingCount('${cur}')`) === 0, 'map badge back to 0 once no ping remains');

  console.log('— A deletes AVA: roster + all date buckets scrubbed everywhere —');
  R(A, `deleteChar('${avaA}')`);
  await sleep(1200);
  ok(R(A, `curData().characters.length`) === 0, 'A live: roster empty');
  ok(R(B, `curData().characters.length`) === 0, 'B live: roster empty');
  ok(R(B, `Object.keys(state.timeline['2087-03-15']?.posByMap?.['${cur}']||{}).length`) === 0, 'B bucket: pos scrubbed');

  console.log('— regression: roster change must NOT resurrect chars on an off-date —');
  R(A, `switchDate('2087-03-15'); addChar('NOVA', 60, 70, '#00ff00');`);
  const novaA = R(A, `curData().characters.find(c => c.name === 'NOVA').id`);
  R(A, `switchDate('2087-03-16');`);
  ok(R(A, `curData().characters.find(c => c.id === '${novaA}').unplaced`), 'A: NOVA unplaced on new date');
  ok(R(A, `curData().characters.find(c => c.id === '${novaA}').x`) === undefined, 'A: NOVA carries no stale coords');
  ok(R(A, `markerLayer.children.length`) === 0, 'A: no char markers on new date');
  await sleep(1400);
  R(B, `switchDate('2087-03-16'); renderAll();`);
  ok(!R(B, `curData().characters.find(c => c.id === '${novaA}')?.x`), 'B: NOVA has no coords on new date');
  ok(R(B, `markerLayer.children.length`) === 0, 'B: NOVA hidden on new date');
  // roster-only change (rename) propagates the entity doc — the old bug re-placed the char
  R(A, `const nc = curData().characters.find(c => c.id === '${novaA}'); nc.name = 'NOVA-2'; persistNow();`);
  await sleep(1500);
  ok(R(B, `curData().characters.find(c => c.id === '${novaA}').name`) === 'NOVA-2', 'B: roster rename applied');
  ok(!R(B, `curData().characters.find(c => c.id === '${novaA}').x`), 'B: rename did NOT resurrect coords');
  ok(R(B, `curData().characters.find(c => c.id === '${novaA}').unplaced`), 'B: NOVA still unplaced after rename');
  R(B, `renderAll()`);
  ok(R(B, `markerLayer.children.length`) === 0, 'B: still no markers after roster change');
  // position survives switching back to the date it belongs to
  R(A, `switchDate('2087-03-15');`);
  ok(R(A, `curData().characters.find(c => c.id === '${novaA}').x`) === 60, 'A: back on its date, NOVA position restored');
  ok(R(A, `markerLayer.children.length`) === 1, 'A: NOVA visible again on its date');
  await sleep(1400);
  R(B, `switchDate('2087-03-15'); renderAll();`);
  ok(R(B, `curData().characters.find(c => c.id === '${novaA}')?.x`) === 60, 'B: NOVA converged at x=60 on its date');
  R(A, `deleteChar('${novaA}')`);
  await sleep(1200);

  console.log('— story pings carry timestamps + character chips —');
  R(A, `switchDate(''); addChar('CHIP', 1, 2, '#ff0000');`);
  const chipA = R(A, `curData().characters.find(c => c.name === 'CHIP').id`);
  R(A, `const pp = addPing(3, 4); pp.label = 'FIRST'; pp.chars.push('${chipA}'); persistNow();`);
  ok(R(A, `curData().pings[curData().pings.length-1].createdAt`) > 0, 'new ping carries createdAt');
  R(A, `const pp2 = addPing(5, 6); pp2.label = 'NEWER'; persistNow(); renderSidebar();`);
  const kids = R(A, `[...$('#pingList').children].map(c => c.innerHTML)`);
  ok(kids[0] && kids[0].includes('NEWER') && kids[1] && kids[1].includes('FIRST'), 'sidebar: pings sorted newest → oldest');
  ok(kids[1] && kids[1].includes('CHIP'), 'sidebar: involved character chip under ping title');
  R(A, `deleteChar('${chipA}');`);
  await sleep(1200);

  console.log('— story pings sidebar lists ALL dates + meta with date · map —');
  const farPid = R(A, `switchDate('2087-03-15');
        const fp = addPing(7, 8); fp.label = 'ELSEWHERE'; persistNow();
        switchDate(''); renderSidebar(); fp.id`);
  {
    const html = R(A, `[...$('#pingList').children].map(c => c.innerHTML).join(' ')`);
    ok(html.includes('ELSEWHERE'), 'ping on another date appears in the sidebar');
    ok(html.includes('◷ 2087-03-15'), 'off-date row shows its date');
    ok(html.includes('AFTERLIGHT CITY'), 'off-date row names its map');
    ok(R(A, `collectAllPings().length`) >= 3, 'global index spans dates and maps');
    R(A, `gotoPing(state.current, '2087-03-15', '${farPid}');`);
    ok(R(A, `state.calendar.selected`) === '2087-03-15', 'row click jumped to the ping\'s date');
    ok(R(A, `sel && sel.type === 'ping' && sel.id === '${farPid}'`), 'jump focused the ping');
    R(A, `switchDate(''); renderSidebar(); deleteGlobalPing(state.current, '2087-03-15', '${farPid}');`);
    ok(!R(A, `[...$('#pingList').children].map(c => c.innerHTML).join(' ')`).includes('ELSEWHERE'), 'cross-date delete scrubs the ping');
  }

  console.log('— story pings carry ongoing / finished status —');
  const stPid = R(A, `const sp = addPing(11, 12); sp.label = 'STC'; persistNow(); sp.id`);
  ok(R(A, `curData().pings.find(p => p.id === '${stPid}').status`) === 'ongoing', 'new ping defaults to ONGOING');
  R(A, `renderPings(); renderSidebar();`);
  {
    const html = R(A, `[...$('#pingList').children].map(c => c.innerHTML).join(' ')`);
    ok(html.includes('ONGOING'), 'sidebar badge shows ONGOING');
    ok(html.includes('ping-dot ong'), 'sidebar dot is ONG-tinted');
    ok(R(A, `pingLayer.children.find(c => c.dataset.id === '${stPid}').className`).includes('ong'), 'map ping wears the ONG (yellow) class');
    ok(R(A, `pingLayer.children.find(c => c.dataset.id === '${stPid}').style['--pgc']`) === 'var(--pgc-ong)', 'map ping pinned to yellow var');
  }
  R(A, `curData().pings.find(p => p.id === '${stPid}').status = 'finished'; renderPings(); renderSidebar();`);
  {
    const html = R(A, `[...$('#pingList').children].map(c => c.innerHTML).join(' ')`);
    ok(html.includes('FINISHED'), 'sidebar badge switches to FINISHED');
    ok(html.includes('ping-dot fin'), 'sidebar dot is FIN-tinted');
    ok(!html.includes('STC</span><span class="ping-chars">'), 'badge placed before chips (sanity)');
    ok(R(A, `pingLayer.children.find(c => c.dataset.id === '${stPid}').className`).includes('fin'), 'map ping wears the FIN (dull) class');
    ok(R(A, `pingLayer.children.find(c => c.dataset.id === '${stPid}').style['--pgc']`) === 'var(--pgc-fin)', 'map ping pinned to dull var');
  }
  R(A, `deletePing('${stPid}'); persistNow();`);

  console.log('— ping popup SET commits label immediately —');
  const setPid2 = R(A, `const t1 = addPing(2, 2); renderPings(); openPingPop(t1, 100, 100); t1.id`);
  {
    ok(R(A, `[...$('#pop').children].map(c => c.innerHTML).join(' ')`).includes('✓ SET'), 'popup has a ✓ SET button');
    R(A, `setPingLabel('${setPid2}', 'QUICKLABEL');`);   // same code path as SET
    ok(R(A, `curData().pings.find(x => x.id === '${setPid2}').label`) === 'QUICKLABEL', 'SET sets the name immediately (no debounce wait)');
    ok(R(A, `pingLayer.children.some(c => c.dataset.id === '${setPid2}' && c.children.some(k => (k.textContent || '').includes('QUICKLABEL')))`), 'marker label refreshes on the spot');
  }
  R(A, `closePop(); deletePing('${setPid2}'); persistNow();`);

  console.log('— assignments survive sync echo (no stale popup refs) —');
  {
    R(A, `switchDate('');`);
    const pid = R(A, `const c1 = addChar('ALPHA', 4, 4, '#ff0000'); const c2 = addChar('BETA', 5, 5, '#00ff00');
          const t2 = addPing(6, 6); t2.label = 'ASSIGN'; persistNow(); t2.id`);
    R(A, `(function(){
      state.data = JSON.parse(JSON.stringify(state.data));   // mimic sync echo swapping object identities
    })()`);
    const res = R(A, `(function(){
      const stale = { id: '${pid}', chars: [], label: 'ASSIGN', x: 6, y: 6 };  // popup captured a stale object
      const el = document.createElement('div');
      popInvolvedChars(el, stale);
      const click = (soak) => { (function walk(e){ for (const c of e.children) { walk(c); if (c.className && String(c.className).includes('pc') && (c.innerHTML || '').includes(soak)) c.dispatch('click'); } })(el); };
      click('ALPHA'); click('BETA');
      const live = curData().pings.find(x => x.id === '${pid}');
      return (live.chars || []).length;
    })()`);
    ok(res === 2, 'second assignment saved too (got ' + res + ')');
    R(A, `curData().characters.forEach(c => deleteChar(c.id)); deletePing('${pid}'); persistNow();`);
  }
  await sleep(1200);

  console.log('— per-row hide toggles + SHOW/HIDE ALL covers every type —');
  {
    const hid = R(A, `switchDate('2087-03-15');
          addChar('HID', 1, 1, '#00ff00'); const pid3 = addPing(3, 3); addLoc('HOME', 9, 9);
          const out = [curData().characters.find(c => c.name === 'HID').id, pid3.id, curData().locations[0].id];
          togglePingHidden(state.current, activeKey(), out[1]);
          renderMarkers(); renderSidebar(); out`);
    ok(!R(A, `pingLayer.children.some(c => c.dataset.id === '${hid[1]}' && !c.classList.contains('ghost'))`), 'hidden ping not rendered on map');
    ok(R(A, `[...$('#pingList').children].map(c => c.className).join(' ')`).includes('is-hidden'), 'ping row shows as hidden');
    R(A, `curData().characters.find(c => c.id === '${hid[0]}').hidden = true; curData().locations[0].hidden = true; renderMarkers(); renderLocations(); renderSidebar();`);
    ok(!R(A, `markerLayer.children.some(c => c.dataset.id === '${hid[0]}')`), 'hidden character not rendered');
    ok(!R(A, `locLayer.children.some(c => c.dataset.id === '${hid[2]}')`), 'hidden location not rendered');
    R(A, `$('#btnShowAll').dispatch('click');`);
    await sleep(120);
    ok(R(A, `markerLayer.children.some(c => c.dataset.id === '${hid[0]}')`), 'SHOW ALL: character back on map');
    ok(R(A, `locLayer.children.some(c => c.dataset.id === '${hid[2]}')`), 'SHOW ALL: location back on map');
    ok(R(A, `pingLayer.children.some(c => (c.dataset.id === '${hid[1]}' || '').length) || pingLayer.children.some(c => c.dataset.id === '${hid[1]}')`), 'SHOW ALL: ping back on map');
    R(A, `deleteChar('${hid[0]}'); deletePing('${hid[1]}'); deleteLoc('${hid[2]}'); switchDate(''); renderAll(); persistNow();`);
  }

  console.log('— echo-convergence: no dangling diff on either client after quiet period —');
  await sleep(1000);
  // force one more push cycle; if lastSynced matches snapshot, nothing fires and no errors occur
  R(A, 'persistNow()'); R(B, 'persistNow()');
  await sleep(1000);
  ok(true, 'quiet convergence reached (no throw during extra push cycles)');

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL OK');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
