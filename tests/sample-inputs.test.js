import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { experiments } from '../src/experiments/catalog.js';
import { sampleMask, sampleHandles } from '../src/experiments/sample-inputs.js';
import { labMarkup } from '../src/lab.js';

const assetURL = name => new URL(`../web/assets/${name}`, import.meta.url);
const filename = name => name === 'lebombo' ? 'lebombo.hdr' : `${name}.webp`;
function patchStudyAssets(mode) {
  const html = labMarkup({ mode, assetsBase: '/assets' });
  const textures = html.match(/<select name="texture">([\s\S]*?)<\/select>/)?.[1];
  assert.ok(textures, `The ${mode} playground must expose its texture selection.`);
  const names = new Set([...textures.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]).filter(name => name !== 'upload'));
  for (const match of html.matchAll(/<img\b(?=[^>]*\bdata-input=)[^>]*\bsrc="\/assets\/([^"/]+)\.webp"/g)) names.add(match[1]);
  return names;
}

test('every image study owns a distinct, present source image set, including quilting and transfer presets', async () => {
  const owners = new Map(), imageHashes = new Map();
  const groups = [
    ...experiments.map(study => ({ id: study.id, names: [study.source, study.other, study.filtered].filter(Boolean) })),
    { id: 'image-quilting', names: [...patchStudyAssets('quilting')] },
    { id: 'texture-transfer', names: [...patchStudyAssets('transfer')] },
  ];
  for (const { id, names } of groups) {
    assert.equal(new Set(names).size, names.length, `${id} must use separate source/example images for separate input roles.`);
    for (const name of names) {
      assert.match(name, /^[a-z0-9-]+$/, `${id}: asset names must remain local filenames.`);
      assert.ok(!owners.has(name), `${id} reuses ${name}, already owned by ${owners.get(name)}.`);
      owners.set(name, id);
      const path = assetURL(filename(name));
      assert.ok((await stat(path)).size > 100, `${id}: missing or empty source ${name}.`);
      const digest = createHash('sha256').update(await readFile(path)).digest('hex');
      assert.ok(!imageHashes.has(digest), `${id}: ${name} is a renamed duplicate of ${imageHashes.get(digest)}.`);
      imageHashes.set(digest, `${id}/${name}`);
    }
  }
  assert.ok(patchStudyAssets('quilting').size >= 2, 'Quilting retains a choice of its own textures.');
  assert.ok(patchStudyAssets('transfer').size >= 3, 'Transfer retains its own textures and target.');
});

test('catalog masks stay normalized and cover the same intended rectangles across preview sizes', () => {
  for (const study of experiments) for (const key of ['maskRegions', 'protectRegions']) {
    const regions = study[key] || [];
    for (const region of regions) {
      assert.equal(region.length, 4, `${study.id}/${key}`);
      assert.ok(region.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
      assert.ok(region[0] < region[2] && region[1] < region[3]);
    }
    for (const source of [{ width: 384, height: 256 }, { width: 512, height: 512 }, { width: 97, height: 61 }]) {
      const mask = sampleMask(source, regions);
      assert.ok(mask instanceof Uint8Array);
      assert.equal(mask.length, source.width * source.height);
      assert.ok(mask.every(value => value === 0 || value === 1));
      if (!regions.length) assert.ok(mask.every(value => value === 0));
      for (const [left, top, right, bottom] of regions) {
        const x = Math.floor((left + right) * 0.5 * source.width), y = Math.floor((top + bottom) * 0.5 * source.height);
        assert.equal(mask[y * source.width + x], 1, `${study.id}: annotated object center is not masked.`);
      }
      const corners = [0, source.width - 1, (source.height - 1) * source.width, mask.length - 1];
      if (regions.every(([l, t, r, b]) => l > 0 && t > 0 && r < 1 && b < 1)) for (const corner of corners) assert.equal(mask[corner], 0, `${study.id}: the annotation wrapped into an unrelated corner.`);
    }
  }
});

test('mask annotations clip safely at image boundaries and return independent editable arrays', () => {
  const source = { width: 10, height: 6 };
  const regions = [[-1, -1, 0.2, 0.5], [0.8, 0.5, 2, 2]], before = JSON.stringify(regions);
  const first = sampleMask(source, regions), second = sampleMask(source, regions);
  assert.equal(first.reduce((sum, value) => sum + value, 0), 12);
  assert.equal(first[0], 1); assert.equal(first[59], 1); assert.equal(first[25], 0);
  first.fill(0);
  assert.equal(second.reduce((sum, value) => sum + value, 0), 12);
  assert.equal(JSON.stringify(regions), before);
});

test('deformation sample handles and the published move stay inside the source at every supported shape', () => {
  const study = experiments.find(item => item.id === 'image-deformation');
  assert.ok(study.pins.length >= 3);
  assert.equal(new Set(study.pins.map(point => point.join(','))).size, study.pins.length);
  for (const point of [...study.pins, study.examplePin.to]) {
    assert.equal(point.length, 2);
    assert.ok(point.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  }
  assert.ok(Number.isInteger(study.examplePin.index) && study.examplePin.index >= 0 && study.examplePin.index < study.pins.length);
  assert.notDeepEqual(study.pins[study.examplePin.index], study.examplePin.to, 'The published deformation must actually move a pin.');
  const before = JSON.stringify(study.pins);
  for (const source of [{ width: 8, height: 8 }, { width: 384, height: 384 }, { width: 512, height: 128 }]) {
    const handles = sampleHandles(source, study.pins);
    assert.equal(handles.length, study.pins.length);
    for (const handle of handles) {
      assert.deepEqual(handle.from, handle.to);
      assert.ok(handle.from[0] >= 0 && handle.from[0] <= source.width - 1);
      assert.ok(handle.from[1] >= 0 && handle.from[1] <= source.height - 1);
      const original = handle.from.slice(); handle.to[0] += 1;
      assert.deepEqual(handle.from, original, 'Dragging a handle must not mutate its source anchor.');
    }
  }
  assert.equal(JSON.stringify(study.pins), before);
  const centered = sampleHandles({ width: 101, height: 51 }, [[0.5, 0.5]])[0];
  assert.deepEqual(centered.from, [50, 25]);
});
