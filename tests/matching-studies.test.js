import test from 'node:test';
import assert from 'node:assert/strict';
import { completeImage } from '../src/algorithms/patchmatch.js';
import { analogize } from '../src/algorithms/analogies.js';
import { deform, mapPoint } from '../src/algorithms/deformation.js';

const image = (width, height, pixel) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...pixel(x, y), 255], (y * width + x) * 4);
  return { width, height, data };
};
const exhaust = generator => {
  let last = -1, next;
  do {
    next = generator.next();
    if (!next.done) { assert.ok(next.value.progress >= last && next.value.progress <= 1); last = next.value.progress; }
  } while (!next.done);
  assert.equal(next.value.progress, 1);
  return next.value;
};
const near = (actual, expected, tolerance = 1e-7) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < tolerance, `${actual} ≠ ${expected}`));

test('completion with no mask is an exact immutable copy', () => {
  const source = image(16, 16, (x, y) => [x * 16, y * 16, x ^ y]);
  const output = exhaust(completeImage({ source }));
  assert.deepEqual(output.data, source.data); assert.notEqual(output.data, source.data);
  assert.equal(output.maskedCount, 0);
});
test('completion ignores erased content, preserves known pixels and votes only from intact donors', () => {
  const clean = image(32, 32, () => [34, 110, 73]), source = { ...clean, data: clean.data.slice() };
  const mask = new Uint8Array(32 * 32);
  for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) {
    mask[y * 32 + x] = 1; source.data.set([255, 0, 240, 255], (y * 32 + x) * 4);
  }
  const before = source.data.slice(), options = { source, mask, patchSize: 5, iterations: 4, seed: 29 };
  const result = exhaust(completeImage(options));
  assert.deepEqual(source.data, before);
  assert.deepEqual(result.data, clean.data);
  for (let i = 0; i < mask.length; i++) assert.equal(mask[result.mapping[i]], 0);
  assert.deepEqual(result, exhaust(completeImage(options)));
});
test('PatchMatch propagates a repeated pattern into a hole, improving a nearest-known fill', () => {
  const source = image(48, 32, (x, y) => { const v = ((x % 8) < 4) !== ((y % 8) < 4) ? 210 : 40; return [v, v + 10, v - 10]; });
  const mask = new Uint8Array(source.width * source.height);
  for (let y = 11; y < 21; y++) for (let x = 19; x < 29; x++) mask[y * source.width + x] = 1;
  const run = completeImage({ source, mask, patchSize: 7, iterations: 8, seed: 7 });
  const first = run.next().value, last = exhaust(run);
  const error = data => mask.reduce((sum, m, i) => sum + (m ? (source.data[i * 4] - data[i * 4]) ** 2 : 0), 0);
  assert.ok(error(last.data) < error(first.data) * 0.35, `completion error ${error(last.data)} vs initialization ${error(first.data)}`);
  for (let i = 0; i < mask.length; i++) if (!mask[i]) assert.deepEqual(last.data.subarray(i * 4, i * 4 + 4), source.data.subarray(i * 4, i * 4 + 4));
});
test('completion rejects holes without any intact source patch and malformed inputs', () => {
  const source = image(16, 16, () => [10, 20, 30]);
  for (const change of [{ mask: new Uint8Array(256).fill(1) }, { mask: new Uint8Array(3) }, { patchSize: 4 }, { iterations: 100 }, { source: { ...source, data: [] } }]) assert.throws(() => exhaust(completeImage({ source, ...change })), RangeError);
});
test('paired image analogies responds to the target and to the supplied filtered example', () => {
  const source = image(24, 24, (x, y) => { const v = Math.round((x + y) / 46 * 255); return [v, v, v]; });
  const filtered = image(24, 24, (x, y) => { const v = source.data[(y * 24 + x) * 4] / 255; return [240 * v, 180 * (1 - v), 90]; });
  const target = image(24, 24, x => x < 12 ? [20, 20, 20] : [230, 230, 230]);
  const options = { source, filtered, target, levels: 3, coherence: 0.1, candidates: 48, seed: 44 };
  const result = exhaust(analogize(options));
  let left = 0, right = 0;
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (x < 12) left += result.data[(y * 24 + x) * 4]; else right += result.data[(y * 24 + x) * 4];
  assert.ok(right > left * 3, `target structure not preserved: ${left}, ${right}`);
  assert.deepEqual(result, exhaust(analogize(options)));
  const otherFiltered = image(24, 24, () => [13, 67, 181]);
  const other = exhaust(analogize({ ...options, filtered: otherFiltered }));
  for (let i = 0; i < other.data.length; i += 4) assert.deepEqual([...other.data.subarray(i, i + 4)], [13, 67, 181, 255]);
  const flipped = image(24, 24, x => x < 12 ? [230, 230, 230] : [20, 20, 20]);
  assert.notDeepEqual(result.data, exhaust(analogize({ ...options, target: flipped })).data);
  for (let i = 0; i < result.mapping.length; i++) assert.deepEqual(result.data.subarray(i * 4, i * 4 + 4), filtered.data.subarray(result.mapping[i] * 4, result.mapping[i] * 4 + 4));
});
test('analogies builds successive Gaussian levels and exactly reproduces a self-paired identity', () => {
  const source = image(24, 24, (x, y) => [x * 10, y * 10, (x * 37 + y * 17) % 256]);
  const run = analogize({ source, filtered: source, target: source, levels: 3, coherence: 0.5, candidates: 8 });
  const levels = new Set(); let step;
  do { step = run.next(); levels.add(step.value.width); } while (!step.done);
  assert.deepEqual([...levels], [6, 12, 24]);
  assert.deepEqual(step.value.data, source.data);
  assert.throws(() => exhaust(analogize({ source, filtered: image(16, 24, () => [0, 0, 0]), target: source })), RangeError);
});
test('MLS has exact pins, identity, translation and consistent duplicate handles', () => {
  for (const mode of ['rigid', 'similarity', 'affine']) {
    const handles = [{ from: [0, 0], to: [5, 7] }, { from: [20, 0], to: [25, 7] }, { from: [0, 20], to: [5, 27] }];
    for (const p of handles) near(mapPoint(p.from, handles, { mode }), p.to);
    near(mapPoint([7.2, 6.3], handles, { mode }), [12.2, 13.3]);
    near(mapPoint([7, 8], [], { mode }), [7, 8]);
    near(mapPoint([7, 8], [handles[0], handles[0]], { mode }), [12, 15]);
    near(mapPoint([8, 9], handles.map(p => ({ ...p, to: p.from })), { mode }), [8, 9]);
  }
  assert.throws(() => mapPoint([1, 1], [{ from: [0, 0], to: [1, 1] }, { from: [0, 0], to: [2, 2] }]), RangeError);
});
test('MLS affine reproduces shear, similarity reproduces scale and rigid preserves rotation', () => {
  const points = [[0, 0], [20, 0], [0, 20], [20, 20]];
  const affine = ([x, y]) => [2 * x + 0.3 * y + 4, -0.2 * x + 0.8 * y + 7];
  near(mapPoint([7, 9], points.map(from => ({ from, to: affine(from) })), { mode: 'affine' }), affine([7, 9]));
  const similarity = ([x, y]) => [-2 * y + 30, 2 * x + 4];
  near(mapPoint([7, 9], points.map(from => ({ from, to: similarity(from) })), { mode: 'similarity' }), similarity([7, 9]));
  const rigid = ([x, y]) => [-y + 30, x + 4];
  near(mapPoint([7, 9], points.map(from => ({ from, to: rigid(from) })), { mode: 'rigid' }), rigid([7, 9]));
  for (const mode of ['rigid', 'similarity', 'affine']) assert.ok(mapPoint([3, 8], [{ from: [0, 0], to: [0, 1] }, { from: [10, 0], to: [10, 2] }], { mode }).every(Number.isFinite));
});
test('forward MLS raster is byte-exact for identity and integer translation, with transparent uncovered pixels', () => {
  const source = image(24, 24, (x, y) => [x * 10, y * 10, (x + y) * 5]);
  assert.deepEqual(deform({ source }).data, source.data);
  const output = deform({ source, handles: [{ from: [10, 10], to: [13, 12] }] });
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const pixel = output.data.subarray((y * 24 + x) * 4, (y * 24 + x) * 4 + 4);
    if (x < 3 || y < 2) assert.equal(pixel[3], 0);
    else assert.deepEqual(pixel, source.data.subarray(((y - 2) * 24 + x - 3) * 4, ((y - 2) * 24 + x - 3) * 4 + 4));
  }
});
