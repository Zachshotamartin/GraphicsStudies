import test from 'node:test';
import assert from 'node:assert/strict';
import { stipple } from '../src/algorithms/stippling.js';
import { paint } from '../src/algorithms/painterly.js';
import { carve, minimumVerticalSeam, transposeImage } from '../src/algorithms/seam-carving.js';

function image(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...fn(x, y), 255], (y * width + x) * 4);
  return { width, height, data };
}
function finish(iterator) {
  const frames = []; let step = iterator.next();
  while (!step.done) { frames.push(step.value); step = iterator.next(); }
  return { result: step.value, frames };
}
function validOutput(result) {
  assert.equal(result.data.length, result.width * result.height * 4);
  for (let i = 3; i < result.data.length; i += 4) assert.equal(result.data[i], 255);
}
function monotonic(frames) {
  let last = 0;
  for (const frame of frames) { assert.ok(frame.progress > last); assert.ok(frame.progress <= 1); last = frame.progress; validOutput(frame); }
  assert.equal(last, 1);
}

test('weighted Voronoi relaxation moves dots to the weighted centroids and decreases quantization energy', () => {
  const source = image(80, 64, x => x < 40 ? [20, 20, 20] : [235, 235, 235]);
  const { result, frames } = finish(stipple({ source, count: 140, iterations: 10, seed: 12 }));
  monotonic(frames); validOutput(result);
  assert.equal(result.points.length, 140);
  assert.ok(result.points.filter(p => p.x < 40).length > 105, 'Dark regions must receive substantially more sites.');
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].energy <= frames[i - 1].energy + 1e-7, 'Lloyd relaxation must reduce the sampled distortion.');
  assert.ok(frames.at(-1).energy < frames[0].energy * 0.8);
  assert.ok(result.points.every(p => p.x >= 0 && p.y >= 0 && p.x < 80 && p.y < 64 && p.r > 0));
  assert.notDeepEqual(frames[0].data, result.data, 'Saved progress frames must not mutate to the final state.');
});
test('stippling is deterministic, respects blank/transparent inputs, and never mutates the source', () => {
  const source = image(48, 48, (x, y) => [x * 5, y * 5, 30]), original = source.data.slice();
  const options = { source, count: 90, iterations: 3 };
  assert.deepEqual(finish(stipple(options)).result, finish(stipple(options)).result);
  assert.notDeepEqual(finish(stipple(options)).result.data, finish(stipple({ ...options, seed: 7 })).result.data);
  assert.deepEqual(source.data, original);
  const white = image(16, 16, () => [255, 255, 255]);
  assert.equal(finish(stipple({ source: white })).result.points.length, 0);
  const clear = image(16, 16, () => [0, 0, 0]);
  for (let i = 3; i < clear.data.length; i += 4) clear.data[i] = 0;
  assert.equal(finish(stipple({ source: clear })).result.points.length, 0);
});
test('dense stippling retains every requested site with an appropriately resolved integration grid', () => {
  const source = image(512, 512, (x, y) => [x % 256, y % 256, (x + y) % 256]);
  const defaults = finish(stipple({ source, iterations: 2 })).result;
  assert.equal(defaults.points.length, 8000);
  assert.equal(defaults.requestedCount, 8000);
  assert.equal(defaults.actualCount, 8000);
  assert.ok(defaults.sampleWidth * defaults.sampleHeight >= 8000 * 12);
  const options = { source, count: 20000, iterations: 3, seed: 91 };
  const { result, frames } = finish(stipple(options));
  monotonic(frames);
  assert.equal(result.points.length, 20000);
  assert.equal(result.actualCount, result.requestedCount);
  assert.ok(result.sampleWidth * result.sampleHeight >= 20000 * 12);
  assert.ok(result.sampleWidth <= 512 && result.sampleHeight <= 512);
  assert.ok(result.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.r) && p.r > 0 && p.x >= 0 && p.x < 512 && p.y >= 0 && p.y < 512));
  assert.ok(new Set(result.points.map(p => p.r)).size > 10, 'Cell-integrated ink areas must adapt to the local image, not impose a global dot radius.');
  assert.deepEqual(result.ink, [27, 44, 40], 'Local tone uses ink area, not gray-colored dots.');
  const repeat = finish(stipple(options)).result;
  assert.deepEqual(result.points, repeat.points);
  assert.deepEqual(result.data, repeat.data);
});
test('integration preserves aspect ratio and caps tiny inputs explicitly without a radius floor', () => {
  const source = image(256, 64, () => [245, 245, 245]);
  const result = finish(stipple({ source, count: 8000, iterations: 2 })).result;
  assert.equal(result.points.length, 8000);
  assert.equal(result.sampleWidth, 256);
  assert.equal(result.sampleHeight, 64);
  const tiny = finish(stipple({ source: image(16, 16, () => [245, 245, 245]), count: 20000, iterations: 2 })).result;
  assert.equal(tiny.requestedCount, 20000);
  assert.equal(tiny.actualCount, 256);
  assert.equal(tiny.points.length, 256);
  assert.ok(tiny.points.every(p => p.r < 0.25), 'Very light, small inputs need subpixel dots, not a fixed minimum footprint.');
});
test('more dots improve spatial detail without making a light input artificially darker', () => {
  const source = image(192, 192, () => [250, 250, 250]);
  const settings = { source, iterations: 5, paper: [255, 255, 255], ink: [0, 0, 0] };
  const sparse = finish(stipple({ ...settings, count: 500 })).result;
  const dense = finish(stipple({ ...settings, count: 8000 })).result;
  const coverage = result => result.data.reduce((total, value, i) => i % 4 === 0 ? total + (255 - value) / 255 : total, 0) / (result.width * result.height);
  const expected = 1 - 250 / 255;
  assert.ok(Math.abs(coverage(sparse) - expected) < expected * 0.2);
  assert.ok(Math.abs(coverage(dense) - expected) < expected * 0.2);
  assert.ok(Math.abs(coverage(dense) - coverage(sparse)) < expected * 0.15);
  assert.ok(dense.energy < sparse.energy / 8, 'A denser set must sample the image substantially more precisely.');
  const averageArea = result => result.points.reduce((sum, point) => sum + Math.PI * point.r ** 2, 0) / result.points.length;
  assert.ok(averageArea(dense) < averageArea(sparse) / 14);
});
test('dark scenes retain black backgrounds, bright lights, thin structures and stable tone across dot counts', () => {
  const source = image(256, 256, (x, y) => {
    const lamp = Math.hypot(x - 76, y - 76) < 22;
    const frame = x > 45 && x < 214 && Math.abs(y - 178) < 3;
    const v = lamp || frame ? 245 : 12;
    return [v, v, v];
  });
  const region = (result, left, top, right, bottom) => {
    let sum = 0;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) sum += result.data[(y * result.width + x) * 4] / 255;
    return sum / ((right - left) * (bottom - top));
  };
  const outputs = [2000, 8000].map(count => finish(stipple({ source, count, iterations: 12, paper: [255, 255, 255], ink: [0, 0, 0] })).result);
  for (const output of outputs) {
    const sky = region(output, 20, 15, 236, 40), light = region(output, 65, 65, 87, 87), line = region(output, 80, 177, 180, 180);
    assert.ok(sky < 0.16, `A near-black sky must remain dark, not a gray dot field (${sky}).`);
    assert.ok(light > 0.8 && light - sky > 0.7, `Bright interiors must stay bright and distinct (${light}, ${sky}).`);
    assert.ok(line > 0.7 && line - sky > 0.6, `Thin illuminated structures must remain legible (${line}, ${sky}).`);
    assert.ok(output.points.every(point => Number.isFinite(point.r) && point.r > 0));
  }
  assert.ok(Math.abs(region(outputs[0], 20, 15, 236, 40) - region(outputs[1], 20, 15, 236, 40)) < 0.06, 'Density must improve detail without materially shifting the background tone.');
});
test('the stippled tonal ramp follows local darkness instead of compressing every tone toward gray', () => {
  const levels = [12, 64, 128, 192, 245];
  const source = image(250, 100, x => { const value = levels[Math.floor(x / 50)]; return [value, value, value]; });
  const result = finish(stipple({ source, count: 3000, iterations: 12, paper: [255, 255, 255], ink: [0, 0, 0] })).result;
  const means = levels.map((_, band) => {
    let sum = 0;
    for (let y = 10; y < 90; y++) for (let x = band * 50 + 10; x < band * 50 + 40; x++) sum += result.data[(y * 250 + x) * 4] / 255;
    return sum / (80 * 30);
  });
  means.forEach((mean, i) => {
    assert.ok(Math.abs(mean - levels[i] / 255) < 0.1, `Band ${i} should preserve its local tone (${mean}).`);
    if (i) assert.ok(mean - means[i - 1] > 0.1, 'Adjacent tones must remain meaningfully separated.');
  });
});
test('painterly rendering makes curved, multiscale strokes with a reproducible replay record', () => {
  const source = image(96, 96, (x, y) => { const r = Math.hypot(x - 48, y - 48); return [Math.min(255, r * 5), Math.min(255, r * 3), 90]; });
  const original = source.data.slice(), options = { source, brushSize: 10, detail: 0.75, seed: 4 };
  const { result, frames } = finish(paint(options));
  monotonic(frames); validOutput(result);
  assert.equal(new Set(result.strokes.map(s => s.radius)).size, 3);
  const curved = result.strokes.find(s => {
    if (s.controlPoints.length < 4) return false;
    const [a, b, c] = s.controlPoints;
    return Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 0.2;
  });
  assert.ok(curved, 'Isophotes of the radial image must make curved paths, not just random straight marks.');
  for (const s of result.strokes) {
    assert.equal(s.color.length, 3);
    assert.ok(s.color.every(c => Number.isInteger(c) && c >= 0 && c <= 255));
    assert.ok(s.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x < 96 && y >= 0 && y < 96));
  }
  assert.deepEqual(result, finish(paint(options)).result);
  assert.notDeepEqual(result.data, finish(paint({ ...options, seed: 44 })).result.data);
  assert.deepEqual(source.data, original);
});
test('painterly detail reveals smaller structures and solid sources remain solid', () => {
  const source = image(96, 96, (x, y) => { const v = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? 220 : 30; return [v, v, v]; });
  const low = finish(paint({ source, detail: 0 })).result, high = finish(paint({ source, detail: 1 })).result;
  const error = out => out.data.reduce((sum, v, i) => i % 4 === 3 ? sum : sum + (v - source.data[i]) ** 2, 0);
  assert.ok(error(high) < error(low), 'Higher detail must retain finer image structure in this fixture.');
  const solid = finish(paint({ source: image(64, 64, () => [36, 81, 123]) })).result;
  for (let i = 0; i < solid.data.length; i += 4) for (let c = 0; c < 3; c++) assert.ok(Math.abs(solid.data[i + c] - [36, 81, 123][c]) <= 1);
});
test('seam dynamic programming finds the exact optimum, including negative removal costs', () => {
  const energy = new Float64Array([4, 7, 2, 3, -5, 8, 9, 1, 6, 7, -2, 3]);
  let best = Infinity;
  const walk = (x, y, cost) => {
    cost += energy[y * 3 + x];
    if (y === 3) { best = Math.min(best, cost); return; }
    for (let next = Math.max(0, x - 1); next <= Math.min(2, x + 1); next++) walk(next, y + 1, cost);
  };
  for (let x = 0; x < 3; x++) walk(x, 0, 0);
  const seam = minimumVerticalSeam(energy, 3, 4);
  assert.equal(seam.cost, best);
  for (let y = 1; y < 4; y++) assert.ok(Math.abs(seam.path[y] - seam.path[y - 1]) <= 1);
  assert.equal(seam.path.reduce((sum, x, y) => sum + energy[y * 3 + x], 0), best);
});
test('carving removes pixels rather than resampling, preserves order and yields immutable previews', () => {
  const source = image(48, 32, (x, y) => [x * 5, y * 7, (x + y) % 255]), copy = source.data.slice();
  const { result, frames } = finish(carve({ source, targetWidth: 30 }));
  monotonic(frames); validOutput(result);
  assert.equal(result.width, 30); assert.equal(result.height, 32); assert.equal(result.removed, 18);
  assert.equal(result.seamMap.reduce((sum, v) => sum + v, 0), 18 * 32);
  for (let y = 0; y < 32; y++) {
    let previous = -1;
    for (let x = 0; x < 30; x++) {
      const i = (y * 30 + x) * 4, sx = result.data[i] / 5;
      assert.ok(sx > previous); previous = sx;
      assert.deepEqual(result.data.subarray(i, i + 4), source.data.subarray((y * 48 + sx) * 4, (y * 48 + sx) * 4 + 4));
    }
  }
  assert.deepEqual(source.data, copy);
  assert.notEqual(frames[0].data.length, result.data.length);
});
test('protect/remove masks follow every seam; protection wins on overlap', () => {
  const source = image(48, 32, x => x >= 20 && x < 26 ? [220, 20, 30] : [60, 60, 60]);
  const mask = new Uint8Array(48 * 32);
  for (let y = 0; y < 32; y++) for (let x = 20; x < 26; x++) mask[y * 48 + x] = 1;
  const original = mask.slice();
  const removed = finish(carve({ source, targetWidth: 42, removeMask: mask })).result;
  assert.equal(removed.markedRemoved, 6 * 32);
  assert.equal(removed.removeMask.reduce((s, v) => s + v, 0), 0);
  assert.ok(removed.data.every((v, i) => i % 4 === 3 || v === 60));
  const protectedResult = finish(carve({ source, targetWidth: 30, protectMask: mask, removeMask: mask })).result;
  assert.equal(protectedResult.protectedRemoved, 0);
  assert.equal(protectedResult.markedRemoved, 0);
  assert.equal(protectedResult.protectMask.reduce((s, v) => s + v, 0), 6 * 32);
  assert.equal(protectedResult.data.filter((v, i) => i % 4 === 0 && v === 220).length, 6 * 32);
  assert.deepEqual(mask, original);
});
test('horizontal and two-axis carving transpose images/masks correctly and support unchanged output', () => {
  const source = image(40, 32, (x, y) => [x * 5, y * 7, 80]);
  assert.deepEqual(transposeImage(transposeImage(source)), source);
  const horizontal = finish(carve({ source, targetWidth: 40, targetHeight: 24 })).result;
  const transposed = finish(carve({ source: transposeImage(source), targetWidth: 24 })).result;
  assert.deepEqual(horizontal.data, transposeImage(transposed).data);
  const mask = new Uint8Array(40 * 32); mask[12 * 40 + 20] = 1;
  const both = finish(carve({ source, targetWidth: 28, targetHeight: 20, protectMask: mask })).result;
  assert.equal(both.width, 28); assert.equal(both.height, 20); assert.equal(both.protectMask.length, 560);
  assert.equal(both.protectMask.reduce((s, v) => s + v, 0), 1);
  assert.equal(both.protectedRemoved, 0);
  assert.equal(both.seamMap.reduce((s, v) => s + v, 0), 40 * 32 - 28 * 20);
  assert.deepEqual(finish(carve({ source, targetWidth: 40 })).result.data, source.data);
});
test('unsafe inputs fail before long work starts', () => {
  const source = image(32, 32, () => [0, 0, 0]);
  for (const change of [{ count: 20001 }, { iterations: 31 }, { paper: [-1, 2, 3] }, { source: { ...source, data: [] } }]) assert.throws(() => finish(stipple({ source, ...change })), RangeError);
  for (const change of [{ brushSize: 0 }, { detail: NaN }, { source: { width: 513, height: 32, data: [] } }]) assert.throws(() => finish(paint({ source, ...change })), RangeError);
  for (const change of [{ targetWidth: 12 }, { targetWidth: 33 }, { targetHeight: NaN }, { removeMask: new Uint8Array(3) }]) assert.throws(() => finish(carve({ source, ...change })), RangeError);
  assert.throws(() => minimumVerticalSeam([NaN], 1, 1), RangeError);
});
