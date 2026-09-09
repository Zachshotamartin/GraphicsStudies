import test from 'node:test';
import assert from 'node:assert/strict';
import { growTree } from '../src/algorithms/trees.js';
import { StableFluid, fluidDemo } from '../src/algorithms/fluids.js';
import { gaussianRGB, hybrid } from '../src/algorithms/hybrid.js';

function finish(generator) {
  let next;
  do { next = generator.next(); } while (!next.done);
  return next.value;
}

function picture(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set([...pixel(x, y), 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

test('colonization builds a deterministic connected 3D graph with tapered branches', () => {
  const options = { count: 320, iterations: 120, seed: 'museum-tree' };
  const tree = finish(growTree(options));
  assert.deepEqual(tree, finish(growTree(options)));
  assert.notDeepEqual(tree.nodes, finish(growTree({ ...options, seed: 'other-tree' })).nodes);
  assert.ok(tree.nodes.length > 100 && tree.leaves.length > 100);
  assert.ok(tree.consumed > tree.total * 0.7);
  assert.equal(tree.nodes[0].parent, -1);
  for (let i = 1; i < tree.nodes.length; i++) {
    const node = tree.nodes[i];
    assert.ok(node.parent >= 0 && node.parent < i);
    const parent = tree.nodes[node.parent];
    const length = Math.hypot(node.x - parent.x, node.y - parent.y, node.z - parent.z);
    assert.ok(Math.abs(length - 0.055) < 1e-8);
    assert.ok(node.radius <= parent.radius + 1e-8);
    assert.ok(node.y >= 0 && node.y <= 2.055);
    assert.ok(Math.abs(node.x) < 0.85 && Math.abs(node.z) < 0.85);
  }
  assert.ok(Math.max(...tree.nodes.map((node) => node.z)) > 0.4);
  assert.ok(Math.min(...tree.nodes.map((node) => node.z)) < -0.4);
  assert.equal(tree.progress, 1);
  assert.equal(tree.complete, true);
});

test('colonization canopy shapes change the growth envelope and sphere obstacles block entire segments', () => {
  const options = { count: 400, seed: 21 };
  const round = finish(growTree(options));
  const column = finish(growTree({ ...options, canopy: 'columnar' }));
  const span = (tree) => Math.max(...tree.nodes.map((p) => p.x)) - Math.min(...tree.nodes.map((p) => p.x));
  assert.ok(span(column) < span(round) * 0.8);
  const obstacle = { x: 0.28, y: 1.25, z: 0.12, r: 0.24 };
  const tree = finish(growTree({ ...options, obstacles: [obstacle] }));
  assert.ok(tree.nodes.length > 80);
  for (const node of tree.nodes.slice(1)) {
    const parent = tree.nodes[node.parent];
    const dx = node.x - parent.x, dy = node.y - parent.y, dz = node.z - parent.z;
    const t = Math.max(0, Math.min(1, ((obstacle.x - parent.x) * dx + (obstacle.y - parent.y) * dy + (obstacle.z - parent.z) * dz) / (dx * dx + dy * dy + dz * dz)));
    const distance = Math.hypot(parent.x + dx * t - obstacle.x, parent.y + dy * t - obstacle.y, parent.z + dz * t - obstacle.z);
    assert.ok(distance >= obstacle.r + Math.max(node.radius, parent.radius) - 1e-8);
  }
  assert.throws(() => finish(growTree({ obstacles: [{ x: 0, y: 0, z: 0, r: 0.3 }] })), /root/);
  assert.throws(() => finish(growTree({ count: Infinity })), /count/);
});

test('colonization progress snapshots remain independent as the generator continues', () => {
  const generator = growTree({ count: 100 });
  const initial = generator.next().value;
  const frozen = structuredClone(initial);
  let lastProgress = 0, next;
  do {
    next = generator.next();
    assert.ok(next.value.progress >= lastProgress);
    lastProgress = next.value.progress;
  } while (!next.done);
  assert.deepEqual(initial, frozen);
});

test('MAC pressure projection sharply reduces divergence and enforces closed no-slip walls', () => {
  const fluid = new StableFluid(40);
  fluid.addForce(0.5, 0.5, 1.1, -0.6, 0.2);
  const { before, after } = fluid.project();
  assert.ok(before > 1);
  assert.ok(after < before * 0.001, `${before} -> ${after}`);
  for (let i = 0; i < 40; i++) {
    assert.equal(fluid.u[i * 41], 0); assert.equal(fluid.u[i * 41 + 40], 0);
    assert.equal(fluid.v[i], 0); assert.equal(fluid.v[1600 + i], 0);
    const t = (i + 0.5) / 40;
    assert.ok(Math.abs(fluid.velocityAt(0, t).y) < 1e-7);
    assert.ok(Math.abs(fluid.velocityAt(t, 0).x) < 1e-7);
  }
});

test('fluid dye is transported, stays finite and nonnegative, and rest is a fixed point', () => {
  const rest = new StableFluid(32);
  const initial = rest.image();
  rest.step(0.5);
  assert.deepEqual(rest.image(), initial);
  const fluid = new StableFluid(32, { diffusion: 0, decay: 0 });
  fluid.addDye(0.5, 0.5, [250, 120, 20], 1, 0.08);
  const centroid = () => {
    let total = 0, moment = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const mass = fluid.dye[0][y * 32 + x]; total += mass; moment += mass * (x + 0.5) / 32;
    }
    return moment / total;
  };
  const before = centroid();
  fluid.addForce(0.5, 0.5, 1, 0, 0.2);
  for (let step = 0; step < 20; step++) fluid.step(1 / 60);
  assert.ok(centroid() > before + 0.035);
  const diagnostics = fluid.diagnostics();
  assert.equal(diagnostics.finite, true);
  assert.ok(diagnostics.inkMass > 0);
  assert.ok(diagnostics.divergence.rms < 0.001);
  for (const channel of fluid.dye) for (const value of channel) assert.ok(value >= 0 && value <= 16);
  const result = fluid.image();
  assert.equal(result.data.length, 32 * 32 * 4);
  fluid.reset();
  assert.deepEqual(fluid.image(), initial);
});

test('fluid diffusion and decay controls change ink, and seeded demos reproduce', () => {
  const sharp = new StableFluid(24, { diffusion: 0, decay: 0 });
  const blurred = new StableFluid(24, { diffusion: 0.015, decay: 0 });
  for (const fluid of [sharp, blurred]) fluid.addDye(0.5, 0.5, [255, 100, 0], 1, 0.1);
  for (let step = 0; step < 12; step++) { sharp.step(1 / 60); blurred.step(1 / 60); }
  assert.ok(Math.max(...blurred.dye[0]) < Math.max(...sharp.dye[0]) * 0.6);
  const mass = sharp.diagnostics().inkMass;
  sharp.step(0.1, { decay: 2 });
  assert.ok(Math.abs(sharp.diagnostics().inkMass / mass - Math.exp(-0.2)) < 1e-6);
  const a = finish(fluidDemo({ grid: 24, steps: 18, seed: 42 }));
  const b = finish(fluidDemo({ grid: 24, steps: 18, seed: 42 }));
  const c = finish(fluidDemo({ grid: 24, steps: 18, seed: 1 }));
  assert.deepEqual(a, b); assert.notDeepEqual(a.data, c.data);
  assert.throws(() => sharp.addForce(0.5, 0.5, NaN, 0), /velocity/);
  assert.throws(() => sharp.step(NaN), /Time step/);
});

test('high-resolution dye follows the coarse velocity field without changing normalized coordinates', () => {
  const fluid = new StableFluid(24, { dyeResolution: 72, diffusion: 0, decay: 0 });
  fluid.addDye(0.5, 0.5, [255, 0, 0], 1, 0.05);
  fluid.addForce(0.5, 0.5, 0.5, -0.2, 0.15);
  for (let i = 0; i < 8; i++) fluid.step(1 / 60);
  const image = fluid.image();
  assert.equal(image.width, 72);
  assert.equal(image.data.length, 72 * 72 * 4);
  assert.equal(fluid.u.length, 24 * 25);
  assert.equal(fluid.diagnostics().finite, true);
  assert.ok(fluid.diagnostics().inkMass > 0);
  assert.throws(() => new StableFluid(32, { dyeResolution: 16 }), /Dye resolution/);
});

test('higher viscosity dissipates more motion under the same initial impulse and simulation time', () => {
  const low = new StableFluid(32, { viscosity: 0.0001, diffusion: 0, decay: 0, damping: 0 });
  const high = new StableFluid(32, { viscosity: 0.003, diffusion: 0, decay: 0, damping: 0 });
  for (const fluid of [low, high]) {
    fluid.addForce(0.5, 0.5, 1.2, -0.6, 0.2);
    fluid.addDye(0.5, 0.5, [100, 220, 140], 1, 0.05);
    for (let frame = 0; frame < 24; frame++) fluid.step(1 / 60);
  }
  const slow = high.diagnostics(), quick = low.diagnostics();
  assert.equal(slow.elapsed, quick.elapsed);
  assert.ok(slow.finite && quick.finite);
  assert.ok(slow.kineticEnergy < quick.kineticEnergy * 0.85);
  assert.ok(slow.divergence.rms < 0.001 && quick.divergence.rms < 0.001);
  assert.notDeepEqual(high.image().data, low.image().data);
});

test('Gaussian filtering preserves constants and spreads an impulse symmetrically', () => {
  const constant = new Float32Array(9 * 9 * 3).fill(80);
  for (const value of gaussianRGB(constant, 9, 9, 2)) assert.ok(Math.abs(value - 80) < 0.0001);
  const impulse = new Float32Array(9 * 9 * 3);
  impulse[(4 * 9 + 4) * 3] = 255;
  const smooth = gaussianRGB(impulse, 9, 9, 1);
  assert.ok(smooth[(4 * 9 + 4) * 3] < 255);
  assert.ok(smooth[(4 * 9 + 4) * 3] > smooth[(4 * 9 + 3) * 3]);
  assert.equal(smooth[(4 * 9 + 3) * 3], smooth[(4 * 9 + 5) * 3]);
});

test('hybrid high-pass of a constant is zero, low pass preserves color, and inputs stay unchanged', () => {
  const source = picture(32, 32, (x, y) => [x * 7, y * 7, 90]);
  const other = picture(32, 32, () => [130, 130, 130]);
  const originals = structuredClone([source, other]);
  const output = hybrid({ source, other, sigma: 3 });
  for (const value of output.highValues) assert.ok(Math.abs(value) < 0.0001);
  assert.deepEqual(output.data, output.low.data);
  assert.deepEqual([source, other], originals);
  assert.deepEqual(output, hybrid({ source, other, sigma: 3 }));
});

test('hybrid detail strength, alignment and filter width produce distinct frequency results', () => {
  const source = picture(40, 40, (x, y) => [60 + x * 3, 70 + y * 3, 120]);
  const other = picture(40, 40, (x, y) => [(x > 12 && x < 28 && y > 8 && y < 30) ? 220 : 40, (x + y) % 4 < 2 ? 170 : 70, 100]);
  const base = hybrid({ source, other, sigma: 4, detail: 0 });
  const detailed = hybrid({ source, other, sigma: 4, detail: 1 });
  const shifted = hybrid({ source, other, sigma: 4, alignment: { x: 0.15, y: -0.05, scale: 1.1 } });
  const blurred = hybrid({ source, other, sigma: 10 });
  assert.deepEqual(base.data, base.low.data);
  assert.notDeepEqual(detailed.data, base.data);
  assert.notDeepEqual(shifted.data, detailed.data);
  assert.notDeepEqual(blurred.data, detailed.data);
  const gray = hybrid({ source, other, grayscale: true });
  for (let p = 0; p < 40 * 40; p++) assert.equal(gray.data[p * 4], gray.data[p * 4 + 1]);
  assert.throws(() => hybrid({ source, other, sigma: 0 }), /blur/);
  assert.throws(() => hybrid({ source, other, alignment: { scale: 0 } }), /scale/);
});
