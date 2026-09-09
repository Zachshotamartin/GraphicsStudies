import test from 'node:test';
import assert from 'node:assert/strict';
import { engraveExample } from '../src/algorithms/engraving-example.js';
import { analogize } from '../src/algorithms/analogies.js';
const image = (width, height, pixel) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
};
const mean = result => result.data.reduce((sum, value, i) => sum + (i % 4 === 0 ? value : 0), 0) / (result.width * result.height);
const finish = generator => { let next; do { next = generator.next(); } while (!next.done); return next.value; };

test('engraving is deterministic, registered, preserves alpha and does not mutate its source', () => {
  const source = image(31, 23, (x, y) => [x * 7, y * 9, (x * 11 + y * 13) % 256, x % 4 === 0 ? 90 : 255]);
  const before = source.data.slice(), output = engraveExample({ source });
  assert.equal(output.width, source.width); assert.equal(output.height, source.height);
  assert.deepEqual(engraveExample({ source }), output); assert.deepEqual(source.data, before);
  for (let i = 3; i < source.data.length; i += 4) assert.equal(output.data[i], source.data[i]);
});
test('white highlights stay unmarked paper while darker tones acquire structured ink', () => {
  const white = engraveExample({ source: image(48, 48, () => [255, 255, 255, 255]) });
  for (let i = 0; i < white.data.length; i += 4) assert.deepEqual([...white.data.subarray(i, i + 4)], [247, 244, 234, 255]);
  const medium = engraveExample({ source: image(48, 48, () => [128, 128, 128, 255]) });
  const dark = engraveExample({ source: image(48, 48, () => [20, 20, 20, 255]) });
  assert.ok(mean(white) > mean(medium) + 20);
  assert.ok(mean(medium) > mean(dark) + 40);
  const tones = new Set(); for (let i = 0; i < medium.data.length; i += 4) tones.add(medium.data[i]);
  assert.ok(tones.size > 10, 'Fine antialiased hatching must vary within a constant midtone.');
});
test('an architectural boundary produces contours at the original position, without displacement', () => {
  const source = image(64, 32, x => x < 32 ? [220, 220, 220, 255] : [40, 40, 40, 255]);
  const edged = engraveExample({ source, hatchStrength: 0, edgeStrength: 1 });
  const plain = engraveExample({ source, hatchStrength: 0, edgeStrength: 0 });
  const difference = Array.from({ length: 64 }, (_, x) => {
    let result = 0; for (let y = 0; y < 32; y++) result += plain.data[(y * 64 + x) * 4] - edged.data[(y * 64 + x) * 4]; return result;
  });
  const strongest = difference.indexOf(Math.max(...difference));
  assert.ok(strongest === 31 || strongest === 32, `Contour drifted to column ${strongest}`);
  assert.ok(difference[strongest] > 1000);
  for (let x = 0; x < 64; x++) if (Math.abs(x - 31.5) > 3) assert.equal(difference[x], 0);
});
test('ink spacing changes the exemplar and invalid dimensions/options fail before processing', () => {
  const source = image(32, 32, () => [100, 100, 100, 255]);
  assert.notDeepEqual(engraveExample({ source, hatchSpacing: 3 }).data, engraveExample({ source, hatchSpacing: 7 }).data);
  for (const change of [{ hatchSpacing: 0 }, { edgeStrength: NaN }, { hatchStrength: 2 }, { ink: [0, 0, 300] }, { source: { ...source, data: [] } }]) assert.throws(() => engraveExample({ source, ...change }), RangeError);
});
test('the registered exemplar works with genuine analogy synthesis rather than filtering B directly', () => {
  const source = image(32, 24, (x, y) => { const value = (x > 8 && x < 13 && y > 5) || (x > 21 && x < 26 && y > 5) ? 35 : 205; return [value, value, value, 255]; });
  const target = image(32, 24, (x, y) => { const value = x > 12 && x < 20 && y > 3 ? 45 : 200; return [value, value, value, 255]; });
  const filtered = engraveExample({ source }), output = finish(analogize({ source, filtered, target, candidates: 32, levels: 2, coherence: 0.25 }));
  for (let i = 0; i < output.mapping.length; i++) assert.deepEqual(output.data.subarray(i * 4, i * 4 + 4), filtered.data.subarray(output.mapping[i] * 4, output.mapping[i] * 4 + 4));
  assert.notDeepEqual(output.data, engraveExample({ source: target }).data, 'B′ must be synthesized through A/A′ correspondences, not run through the exemplar filter.');
  let facade = 0, doorway = 0;
  for (let y = 8; y < 24; y++) { facade += output.data[(y * 32 + 4) * 4]; doorway += output.data[(y * 32 + 16) * 4]; }
  assert.ok(facade > doorway + 400, 'The synthesized image should retain the target doorway.');
});
