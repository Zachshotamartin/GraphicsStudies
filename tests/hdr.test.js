import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeRadiance,
  toneMap,
  exposurePreview,
} from "../src/algorithms/hdr.js";
const finish = (g) => {
  let r;
  do {
    r = g.next();
  } while (!r.done);
  return r.value;
};
test("Radiance flat RGBE decodes linear values and orientation", () => {
  const header = new TextEncoder().encode(
    "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n",
  );
  const bytes = new Uint8Array(header.length + 8);
  bytes.set(header);
  bytes.set([128, 64, 32, 129, 64, 128, 32, 130], header.length);
  const image = decodeRadiance(bytes);
  assert.deepEqual([...image.data], [1, 0.5, 0.25, 1, 2, 0.5]);
  assert.equal(image.width, 2);
  assert.throws(
    () => decodeRadiance(bytes.subarray(0, bytes.length - 2)),
    /Incomplete/,
  );
});
test("Tone mapping compresses HDR while preserving chromatic ratios and finite output", () => {
  const data = new Float32Array(32 * 16 * 3);
  for (let i = 0; i < 512; i++) {
    const value = i % 32 < 16 ? 0.001 : 80;
    data.set([value, value * 0.5, value * 0.25], i * 3);
  }
  const result = finish(toneMap({ source: { width: 32, height: 16, data } }));
  assert.ok(result.compression < 1);
  assert.equal(result.data.length, 2048);
  assert.ok(
    result.data[0] > exposurePreview({ width: 32, height: 16, data }).data[0],
  );
  assert.ok(result.data[0] > result.data[1]);
  assert.ok(result.data.every(Number.isFinite));
});
test("Constant and black radiance stay finite; exposure changes brightness", () => {
  const source = { width: 8, height: 8, data: new Float32Array(192).fill(0.1) };
  const a = finish(toneMap({ source, exposure: -2 })),
    b = finish(toneMap({ source, exposure: 0 }));
  assert.ok(a.data[0] < b.data[0]);
  const black = finish(
    toneMap({ source: { ...source, data: new Float32Array(192) } }),
  );
  assert.equal(black.data[0], 0);
  assert.throws(() => finish(toneMap({ source, range: NaN })), /finite/);
});
test("HDR downsampling never overflows float accumulation and bounds preview allocation", () => {
  const header = new TextEncoder().encode(
      "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8\n",
    ),
    bytes = new Uint8Array(header.length + 32);
  bytes.set(header);
  bytes.fill(255, header.length);
  const image = decodeRadiance(bytes, 1);
  assert.ok(image.data.every(Number.isFinite));
  assert.ok(image.data[0] > 1e38);
  assert.throws(() => decodeRadiance(bytes, 0), /preview/);
  assert.throws(() => decodeRadiance(bytes, 1.5), /preview/);
});
test("Bilateral sampling includes its center for fractional spatial radii and tiny images", () => {
  const image = finish(
    toneMap({
      source: { width: 1, height: 1, data: new Float32Array([1, 0.5, 0.25]) },
      spatial: 9.5,
    }),
  );
  assert.ok(Number.isFinite(image.compression));
  assert.ok(Number.isFinite(image.dynamicRange));
  assert.ok(image.data[0] > 0);
});
