/** Local-only browser smoke tests. No workflow or CI runner is required. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
// This opt-in integration script must not make the dependency-free unit suite load Playwright.
if (process.env.NODE_TEST_CONTEXT) process.exit(0);
const playwright = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
import { experiments } from '../src/experiments/catalog.js';

const base = process.env.STUDIES_URL || 'http://127.0.0.1:5182';
const destination = process.env.STUDIES_QA_DIR || '/tmp/graphics-studies-browser-qa';
await fs.mkdir(destination, { recursive: true });
const engine = process.env.STUDIES_BROWSER || 'chromium';
if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('STUDIES_BROWSER must be chromium, firefox, or webkit.');
const browser = await playwright[engine].launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [], networkErrors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => { if (!request.failure()?.errorText.includes('ERR_ABORTED')) networkErrors.push(`${request.url()}: ${request.failure()?.errorText}`); });
const resultCanvas = () => page.locator('[data-result]');
const status = () => page.locator('[data-status]');
const imageState = canvas => canvas.evaluate(element => {
  const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
  let hash = 2166136261, opaque = 0;
  const colors = new Set();
  for (let i = 0; i < data.length; i += 4) {
    hash = Math.imul(hash ^ data[i], 16777619); hash = Math.imul(hash ^ data[i + 1], 16777619); hash = Math.imul(hash ^ data[i + 2], 16777619);
    if (data[i + 3]) opaque++;
    if (i % 16 === 0) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
  }
  return { width: element.width, height: element.height, hash: hash >>> 0, opaque, colors: colors.size };
});
async function ready(id) {
  await page.goto(`${base}/?study=${id}`, { waitUntil: 'networkidle' });
  await page.locator('.experiment-lab [data-run]').waitFor({ timeout: 10000 });
  if (experiments.find(s => s.id === id).source && id !== 'hdr-tone-mapping') await page.locator('[data-input]').waitFor({ state: 'visible', timeout: 15000 });
}
async function finished() {
  await page.waitForFunction(() => {
    const error = document.querySelector('[data-error]');
    if (error && !error.hidden) return true;
    return document.querySelector('[data-status]')?.textContent.startsWith('Finished in');
  }, { timeout: 90000 });
  const error = page.locator('[data-error]');
  assert.ok(await error.isHidden(), await error.textContent());
  assert.match(await status().textContent(), /^Finished in/);
  await page.waitForFunction(() => !document.querySelector('[data-result]').hidden);
}
async function run() { await page.locator('[data-run]').click(); await finished(); return imageState(resultCanvas()); }
async function setRange(selector, value) {
  await page.locator(selector).evaluate((element, v) => { element.value = v; element.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
}
async function downloadPNG() {
  const promise = page.waitForEvent('download');
  await page.locator('[data-download]').click();
  const download = await promise, path = await download.path(), bytes = await fs.readFile(path);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.ok(width > 0 && height > 0);
  return { width, height, bytes: bytes.length, digest: createHash('sha256').update(bytes).digest('hex') };
}
async function drag(canvas, from, to, steps = 8) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps }); await page.mouse.up();
}
try {
  for (const experiment of experiments) {
    const id = experiment.id, started = Date.now();
    await ready(id);
    if (id === 'stable-fluids') {
      await page.locator('[data-run]').click();
      await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.startsWith('Running'));
      const first = await imageState(resultCanvas());
      await drag(resultCanvas(), [.2, .5], [.75, .35], 14);
      await page.waitForTimeout(180);
      const injected = await imageState(resultCanvas());
      assert.notEqual(first.hash, injected.hash, 'Fluid did not react to injection.');
      await page.locator('[data-pause]').click(); await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.startsWith('Paused'));
      await page.waitForTimeout(100); const paused = await imageState(resultCanvas()); await page.waitForTimeout(160);
      assert.equal(paused.hash, (await imageState(resultCanvas())).hash, 'Fluid kept updating after pause.');
      assert.ok(paused.colors > 8);
      await downloadPNG();
      await page.locator('[data-pause]').click(); await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.startsWith('Running'));
      await page.locator('[data-cancel]').click();
      results.push({ id, ...paused, ms: Date.now() - started, interactions: 'injection, pause/resume, cancel, PNG' });
      continue;
    }
    const output = await run();
    assert.ok(output.opaque > output.width * output.height * .15, `${id}: result mostly empty.`);
    assert.ok(output.colors > 8, `${id}: output has insufficient variation.`);
    const download = await downloadPNG();
    assert.equal(download.width, output.width); assert.equal(download.height, output.height);
    if (id === 'seam-carving') {
      const input = await imageState(page.locator('[data-input]'));
      assert.equal(output.width, Math.round(input.width * .7));
      await drag(page.locator('[data-input]'), [.15, .2], [.23, .6]);
      assert.notEqual(input.hash, (await imageState(page.locator('[data-input]'))).hash, 'Protection brush did not paint.');
      await setRange('[data-param="widthRatio"]', .6);
      const narrower = await run(); assert.equal(narrower.width, Math.round(input.width * .6));
      await page.locator('[data-clear-mask]').click();
    }
    if (id === 'patchmatch') {
      await page.locator('[data-clear-mask]').click();
      const clean = await imageState(page.locator('[data-input]'));
      await drag(page.locator('[data-input]'), [.42, .65], [.5, .7]);
      assert.notEqual(clean.hash, (await imageState(page.locator('[data-input]'))).hash, 'Erase mask did not paint.');
      const completed = await run(); assert.notEqual(completed.hash, clean.hash, 'Mask completion did not change output.');
      await page.locator('[data-mapping]').click();
      assert.notEqual(completed.hash, (await imageState(resultCanvas())).hash, 'Source correspondence inspection did not render.');
    }
    if (id === 'image-deformation') {
      await drag(resultCanvas(), [.5, .5], [.67, .37], 8); await page.waitForTimeout(120); await finished();
      assert.notEqual(output.hash, (await imageState(resultCanvas())).hash, 'Dragging a deformation pin did not change pixels.');
      assert.notEqual(download.digest, (await downloadPNG()).digest, 'Dragging only moved overlay pins without recomputing the actual export.');
      await setRange('[data-pin-x]', 70); await page.waitForTimeout(120); await finished();
      const pins = await page.locator('[data-pin-select] option').count();
      await page.locator('[data-add-pin]').click(); assert.equal(await page.locator('[data-pin-select] option').count(), pins + 1);
      await page.locator('[data-delete-pin]').click(); await page.waitForTimeout(120); await finished();
      assert.equal(await page.locator('[data-pin-select] option').count(), pins);
    }
    if (id === 'tree-growth') {
      await drag(resultCanvas(), [.5, .5], [.75, .55]);
      assert.notEqual(output.hash, (await imageState(resultCanvas())).hash, 'Tree orbit did not change camera.');
      await page.locator('[data-skeleton]').click();
      assert.equal(await page.locator('[data-skeleton]').getAttribute('aria-pressed'), 'true');
    }
    if (id === 'hybrid-images') {
      await page.locator('[data-view="low"]').click(); assert.notEqual(output.hash, (await imageState(resultCanvas())).hash);
      await page.locator('[data-view="high"]').click(); assert.notEqual(output.hash, (await imageState(resultCanvas())).hash);
      const uploaded = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 100; c.height = 100; const g = c.getContext('2d'); g.fillStyle = '#ac3d39'; g.fillRect(0, 0, 100, 100); return c.toDataURL().split(',')[1]; });
      await page.locator('[data-upload="source"]').setInputFiles({ name: 'local-test.png', mimeType: 'image/png', buffer: Buffer.from(uploaded, 'base64') });
      await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.startsWith('Image loaded'));
      await page.locator('[data-view="result"]').click();
      assert.equal((await run()).width, 100);
      await page.locator('[data-upload="source"]').setInputFiles({ name: 'malformed.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
      await page.locator('[data-error]').waitFor({ state: 'visible' });
    }
    if (id === 'hdr-tone-mapping') {
      await page.locator('[data-view="base"]').click(); assert.notEqual(output.hash, (await imageState(resultCanvas())).hash);
      await page.locator('[data-view="detailLayer"]').click(); assert.notEqual(output.hash, (await imageState(resultCanvas())).hash);
    }
    if (id === 'stippling') {
      const downloadEvent = page.waitForEvent('download'); await page.locator('[data-svg]').click();
      const exported = await downloadEvent, svg = await fs.readFile(await exported.path(), 'utf8'); assert.match(svg, /<svg/); assert.equal((svg.match(/<circle/g)||[]).length,8000);
      await setRange('[data-param="count"]', 20000); await setRange('[data-param="iterations"]', 30);
      await page.locator('[data-run]').click(); await page.locator('[data-cancel]').click();
      assert.match(await status().textContent(), /^Stopped/); assert.equal(await page.locator('[data-run]').isEnabled(), true);
      await page.locator('[data-reset]').click();
      assert.equal(await page.locator('[data-svg]').isDisabled(), true, 'Reset must disable the previous SVG export.');
    }
    await page.screenshot({ path: `${destination}/${id}.png`, fullPage: true });
    results.push({ id, ...output, download, ms: Date.now() - started });
    console.log(JSON.stringify(results.at(-1)));
  }
  // Cancellation during delayed sample loading must not resurrect a worker afterward.
  let release; const delayed = new Promise(resolve => { release = resolve; });
  await page.route('**/owl.webp', async route => { await delayed; await route.continue(); });
  await page.goto(`${base}/?study=hybrid-images`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-input]').waitFor({ state: 'visible' });
  await page.locator('[data-run]').click();
  await page.locator('[data-cancel]').click();
  release(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(150);
  assert.match(await status().textContent(), /^Stopped/, 'Delayed input restarted a canceled calculation.');
  await page.unroute('**/owl.webp');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const experiment of experiments) {
    await ready(experiment.id);
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(overflow.document <= overflow.viewport + 1, `${experiment.id}: mobile overflow ${JSON.stringify(overflow)}`);
  }
  assert.deepEqual(errors, [], 'Uncaught page errors');
  assert.deepEqual(networkErrors, [], 'Failed network requests');
  await fs.writeFile(`${destination}/results.json`, JSON.stringify({ base, engine, results, mobileWidths: [390], errors, networkErrors }, null, 2));
  console.log(`PASS: ${results.length} computed studies; masks, pins, fluid, tree, exports, upload, cancel, and 390px layouts.`);
} catch (error) {
  await page.screenshot({ path: `${destination}/failure.png`, fullPage: true });
  await fs.writeFile(`${destination}/failure.json`, JSON.stringify({ url: page.url(), message: error.message, stack: error.stack, status: await status().textContent().catch(() => ''), errors, networkErrors, results }, null, 2));
  throw error;
} finally { await browser.close(); }
