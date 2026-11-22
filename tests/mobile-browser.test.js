/* Optional browser regression suite. Start the static site on port 8000 first.
   Requires Playwright with Chromium. HTTPS is blocked to keep the test offline
   and prevent test scenes from reaching the production Firebase board.
   Overrides: MOBILE_TEST_URL, CHROMIUM_PATH, CHROMIUM_ARGS (JSON array). */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const base = process.env.MOBILE_TEST_URL || 'http://127.0.0.1:8000';
const desktopBaseline = '5127d3e0b4f9ef1d515b81cde4a3ec6b767bea09';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
    headless: true,
  });
  try {
    const errors = [];
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('#loader')?.classList.contains('done') || !document.querySelector('#loader'));
    await page.locator('#mapDrawer').evaluate(el => el.classList.add('hidden'));

    // Include a short portrait viewport, representative of a visible keyboard.
    for (const [width, height] of [[320, 568], [360, 640], [390, 844], [390, 400], [430, 932], [768, 1024], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'no horizontal overflow');
      for (const id of ['btnMaps', 'btnCal', 'btnList', 'btnMobileMore']) {
        const rect = await page.locator('#' + id).boundingBox();
        assert(rect.x >= 0 && rect.x + rect.width <= width + 0.5 && rect.height >= 44, id + ' fits and is touch-sized');
      }
      await page.locator('#btnList').click();
      let rect = await page.locator('#sidebar').boundingBox();
      assert(rect && rect.x >= 0 && rect.x + rect.width <= width + 0.5, 'sidebar fits');
      await page.locator('#mobileSidebarClose').click();
      for (const [opener, drawer, closer] of [['btnMaps', 'mapDrawer', 'drawerClose'], ['btnCal', 'calDrawer', 'calClose']]) {
        await page.locator('#' + opener).click();
        rect = await page.locator('#' + drawer).boundingBox();
        assert(rect && rect.y >= 0 && rect.y + rect.height <= height + 0.5 && rect.width <= width, drawer + ' fits');
        await page.locator('#' + closer).click();
      }
      await page.locator('#btnMobileMore').click();
      await page.locator('#btnLive').click();
      rect = await page.locator('#liveModal .modal-card').boundingBox();
      assert(rect && rect.y >= 0 && rect.y + rect.height <= height + 0.5, 'live dialog fits');
      await page.locator('#liveClose').click();
      console.log(`PASS layout ${width}x${height}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#btnList').click();
    await page.locator('[data-tab="chars"]').click();
    await page.locator('#btnAddCast').click();
    assert(await page.locator('#pop').isVisible());
    assert(!await page.locator('#sidebar').isVisible());
    await page.locator('#pop input').fill('Mobile tester');
    await page.locator('#pop .pbtn').click();
    assert(await page.evaluate(() => curData().characters.some(c => c.name === 'Mobile tester')));
    console.log('PASS mobile roster editor');

    await page.evaluate(() => { const p = addPing(500, 500); p.label = 'Phone scene'; renderAll(); });
    await page.locator('#btnList').click();
    await page.locator('[data-tab="pings"]').click();
    await page.locator('#pingList .ping-name').filter({ hasText: 'Phone scene' }).click();
    const rect = await page.locator('#pop').boundingBox();
    assert(rect.x >= 0 && rect.x + rect.width <= 390 && rect.y >= 110, 'scene editor fits');
    assert(!await page.locator('#sidebar').isVisible(), 'scene list clears the editor');
    assert.notEqual(await page.evaluate(() => document.activeElement.className), 'pop-input', 'opening a scene does not summon the keyboard');
    await page.locator('#pop .x').click();
    console.log('PASS scene editor fits and no keyboard autofocus');

    const original = await page.evaluate(() => { mode = 'ping'; return { z: view.z, count: curData().pings.length }; });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 350, id: 1 }, { x: 220, y: 350, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 70, y: 350, id: 1 }, { x: 250, y: 350, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert(await page.evaluate(z => view.z > z, original.z));
    assert.equal(await page.evaluate(() => curData().pings.length), original.count);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 350, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.equal(await page.evaluate(() => curData().pings.length), original.count);
    console.log('PASS real pinch/cancel gestures without accidental scene creation');

    const desktop = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await desktop.route('https://**/*', route => route.abort());
    await desktop.goto(base);
    await desktop.waitForTimeout(1400);
    const baseline = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await baseline.route('https://**/*', route => route.abort());
    for (const name of ['index.html', 'app.js', 'styles.css']) {
      const text = execFileSync('git', ['show', desktopBaseline + ':' + name], {
        encoding: 'utf8', cwd: path.resolve(__dirname, '..'),
      });
      await baseline.route(name === 'index.html' ? base + '/' : '**/' + name, route => route.fulfill({
        body: text,
        contentType: name.endsWith('css') ? 'text/css' : name.endsWith('js') ? 'text/javascript' : 'text/html',
      }));
    }
    await baseline.goto(base);
    await baseline.waitForTimeout(1400);
    for (const id of ['topbar', 'modeGroup', 'btnMaps', 'btnCal', 'btnUndo', 'btnList', 'btnLive', 'sidebar', 'viewport']) {
      assert.deepEqual(await desktop.locator('#' + id).boundingBox(), await baseline.locator('#' + id).boundingBox(), 'unchanged desktop geometry: ' + id);
    }
    console.log('PASS desktop geometry matches original');

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForFunction(() => !matchMedia('(max-width:900px)').matches && document.querySelector('#mobileToolsBody').children.length === 0);
    assert.equal(await page.locator('#topbar #btnLive').count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => matchMedia('(max-width:900px)').matches && document.querySelector('#mobileToolsBody').children.length === 9);
    assert.equal(await page.locator('#mobileToolsBody #btnLive').count(), 1);
    console.log('PASS breakpoint restores controls without duplicates');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
