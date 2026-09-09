/** Hole completion with the randomized propagation/search core of Barnes et al. (2009). */
import { seededRandom } from '../quilting.js';

function validate(source, mask, patchSize, iterations) {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 8 || source.height < 8 || source.width > 256 || source.height > 256 || !(source.data instanceof Uint8ClampedArray) || source.data.length !== source.width * source.height * 4) throw new RangeError('Completion needs an 8–256px RGBA image.');
  if (mask != null && (!(mask instanceof Uint8Array || mask instanceof Uint8ClampedArray) || mask.length !== source.width * source.height)) throw new RangeError('Mask needs one byte per pixel; nonzero means erase.');
  if (!Number.isInteger(patchSize) || patchSize < 3 || patchSize > 15 || patchSize % 2 !== 1 || patchSize > Math.min(source.width, source.height)) throw new RangeError('Patch size must be an odd number between 3 and 15 that fits the source.');
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 12) throw new RangeError('Use 1–12 completion iterations.');
}

/**
 * Single-scale patch-search/voting completion. Known pixels remain byte-identical.
 * `mapping` identifies the donor of the strongest vote at each pixel. Reconstructed
 * colors are weighted votes from overlapping patches, not necessarily that one donor.
 * `nnf` is the source patch center for every active output patch center, -1 otherwise.
 */
export function* completeImage({ source, mask, iterations = 5, patchSize = 7, seed = 42 } = {}) {
  validate(source, mask, patchSize, iterations);
  const { width, height } = source, count = width * height, radius = patchSize >> 1;
  const erased = mask ? Uint8Array.from(mask, value => value ? 1 : 0) : new Uint8Array(count);
  const data = source.data.slice(), mapping = Int32Array.from({ length: count }, (_, i) => i);
  const maskedCount = erased.reduce((sum, value) => sum + value, 0);
  if (!maskedCount) return { width, height, data, mapping, progress: 1, iteration: 0, maskedCount: 0, patchSize };
  if (maskedCount === count) throw new RangeError('Keep some source pixels so the hole has surrounding context.');
  const random = seededRandom(seed);
  const integral = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += erased[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = row + integral[y * (width + 1) + x + 1];
    }
  }
  const holesIn = (x0, y0, x1, y1) => integral[(y1 + 1) * (width + 1) + x1 + 1] - integral[y0 * (width + 1) + x1 + 1] - integral[(y1 + 1) * (width + 1) + x0] + integral[y0 * (width + 1) + x0];
  const donors = [], valid = new Uint8Array(count), active = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nearHole = holesIn(Math.max(0, x - radius), Math.max(0, y - radius), Math.min(width - 1, x + radius), Math.min(height - 1, y + radius));
    if (nearHole) active.push(y * width + x);
    else if (x >= radius && x < width - radius && y >= radius && y < height - radius) {
      valid[y * width + x] = 1; donors.push(y * width + x);
    }
  }
  if (!donors.length) throw new RangeError('No intact patch fits outside the mask. Use a smaller brush or patch size.');

  // Initialize holes from their nearest known pixel, never from the erased object's colors.
  const queue = new Int32Array(count), visited = new Uint8Array(count);
  let tail = 0;
  for (let i = 0; i < count; i++) if (!erased[i]) { queue[tail++] = i; visited[i] = 1; }
  for (let head = 0; head < tail; head++) {
    const i = queue[head], x = i % width, y = Math.floor(i / width);
    for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
      if (n < 0 || visited[n]) continue;
      visited[n] = 1; queue[tail++] = n; mapping[n] = mapping[i];
      data.set(source.data.subarray(mapping[n] * 4, mapping[n] * 4 + 4), n * 4);
    }
  }
  const nnf = new Int32Array(count).fill(-1), distances = new Float64Array(count);
  for (const i of active) nnf[i] = donors[Math.floor(random() * donors.length)];
  const candidate = (x, y) => x >= radius && x < width - radius && y >= radius && y < height - radius && valid[y * width + x] ? y * width + x : -1;
  let missingWeight = 0.2;
  const distance = (target, donor, cutoff = Infinity) => {
    const tx = target % width, ty = Math.floor(target / width), sx = donor % width, sy = Math.floor(donor / width);
    let error = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (tx + dx < 0 || tx + dx >= width || ty + dy < 0 || ty + dy >= height) continue;
      const p = (ty + dy) * width + tx + dx, q = ((sy + dy) * width + sx + dx) * 4;
      const weight = erased[p] ? missingWeight : 1;
      for (let c = 0; c < 3; c++) error += weight * (data[p * 4 + c] - source.data[q + c]) ** 2;
      if (error > cutoff) return error;
    }
    return error;
  };
  const frame = (iteration, meanPatchError = 0) => ({ width, height, data: data.slice(), mapping: mapping.slice(), nnf: nnf.slice(), progress: iteration / iterations, iteration, maskedCount, patchSize, meanPatchError });
  yield frame(0);
  let meanPatchError = 0;
  for (let iteration = 0; iteration < iterations; iteration++) {
    missingWeight = 0.2 + 0.8 * iteration / Math.max(1, iterations - 1);
    const reverse = iteration % 2 === 1, direction = reverse ? -1 : 1;
    for (const i of active) distances[i] = distance(i, nnf[i]);
    for (let a = 0; a < active.length; a++) {
      const i = active[reverse ? active.length - 1 - a : a], x = i % width, y = Math.floor(i / width);
      let best = nnf[i], bestDistance = distances[i];
      const tryDonor = donor => {
        if (donor < 0 || donor === best) return;
        const d = distance(i, donor, bestDistance);
        if (d < bestDistance) { best = donor; bestDistance = d; }
      };
      // Copy neighboring offsets, shifted by one target pixel, in alternating scan directions.
      const horizontal = x - direction, vertical = y - direction;
      if (horizontal >= 0 && horizontal < width) {
        const neighbor = nnf[y * width + horizontal];
        if (neighbor >= 0) tryDonor(candidate(neighbor % width + direction, Math.floor(neighbor / width)));
      }
      if (vertical >= 0 && vertical < height) {
        const neighbor = nnf[vertical * width + x];
        if (neighbor >= 0) tryDonor(candidate(neighbor % width, Math.floor(neighbor / width) + direction));
      }
      tryDonor(donors[Math.floor(random() * donors.length)]);
      for (let span = Math.max(width, height); span >= 1; span = Math.floor(span / 2)) {
        const bx = best % width, by = Math.floor(best / width);
        const minX = Math.max(radius, bx - span), maxX = Math.min(width - radius - 1, bx + span);
        const minY = Math.max(radius, by - span), maxY = Math.min(height - radius - 1, by + span);
        const sx = minX + Math.floor(random() * (maxX - minX + 1));
        const sy = minY + Math.floor(random() * (maxY - minY + 1));
        tryDonor(candidate(sx, sy));
      }
      nnf[i] = best; distances[i] = bestDistance;
    }
    const sums = new Float64Array(count * 3), weights = new Float64Array(count), strongest = new Float64Array(count);
    meanPatchError = 0;
    for (const i of active) {
      const donor = nnf[i], tx = i % width, ty = Math.floor(i / width), sx = donor % width, sy = Math.floor(donor / width);
      const normalizedError = distances[i] / (patchSize * patchSize * 3);
      meanPatchError += normalizedError;
      const confidence = 1 / (1 + normalizedError / 200);
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const p = y * width + x;
        if (!erased[p]) continue;
        const q = (sy + dy) * width + sx + dx;
        const weight = confidence / (1 + (dx * dx + dy * dy) / (radius * radius));
        for (let c = 0; c < 3; c++) sums[p * 3 + c] += source.data[q * 4 + c] * weight;
        weights[p] += weight;
        if (weight > strongest[p]) { strongest[p] = weight; mapping[p] = q; }
      }
    }
    for (let i = 0; i < count; i++) if (erased[i] && weights[i]) {
      for (let c = 0; c < 3; c++) data[i * 4 + c] = sums[i * 3 + c] / weights[i];
      data[i * 4 + 3] = 255;
    }
    meanPatchError /= active.length;
    yield frame(iteration + 1, meanPatchError);
  }
  return frame(iterations, meanPatchError);
}
