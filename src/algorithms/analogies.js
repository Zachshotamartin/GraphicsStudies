/** Multiscale, causal image analogies after Hertzmann et al. (2001). */
import { seededRandom } from '../quilting.js';

function validateImage(image, name) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 4 || image.height < 4 || image.width > 256 || image.height > 256 || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new RangeError(`${name} must be a 4–256px RGBA image.`);
}
const clamp = (value, max) => Math.max(0, Math.min(max, value));
const luminance = image => {
  const data = new Float32Array(image.width * image.height);
  for (let i = 0; i < data.length; i++) data[i] = (0.2126 * image.data[i * 4] + 0.7152 * image.data[i * 4 + 1] + 0.0722 * image.data[i * 4 + 2]) / 255;
  return { ...image, luminance: data };
};
function reduce(image) {
  const weights = [1, 4, 6, 4, 1], temp = new Float32Array(image.data.length);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) for (let c = 0; c < 4; c++) {
    let value = 0;
    for (let k = -2; k <= 2; k++) value += image.data[(y * image.width + clamp(x + k, image.width - 1)) * 4 + c] * weights[k + 2];
    temp[(y * image.width + x) * 4 + c] = value / 16;
  }
  const width = Math.ceil(image.width / 2), height = Math.ceil(image.height / 2), data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
    let value = 0;
    for (let k = -2; k <= 2; k++) value += temp[(clamp(y * 2 + k, image.height - 1) * image.width + x * 2) * 4 + c] * weights[k + 2];
    data[(y * width + x) * 4 + c] = value / 16;
  }
  return { width, height, data };
}
function pyramid(image, levels) {
  const result = [luminance(image)];
  while (result.length < levels) result.push(luminance(reduce(result[result.length - 1])));
  return result;
}
function featureLayout(hasCoarse) {
  const features = [];
  const add = (kind, radius, causal, strength, rgb) => {
    const samples = [];
    let total = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (causal && !(dy < 0 || (dy === 0 && dx < 0))) continue;
      const weight = Math.exp(-(dx * dx + dy * dy) / Math.max(1, radius * radius));
      samples.push({ dx, dy, weight }); total += weight;
    }
    for (const sample of samples) for (let channel = 0; channel < (rgb ? 3 : 1); channel++) features.push({ ...sample, kind, channel: rgb ? channel : -1, weight: sample.weight / total * strength / (rgb ? 3 : 1), causal });
  };
  add('guide', 2, false, 1, false);
  // A small center-color feature disambiguates equally bright regions of different hues.
  add('guide', 0, false, 0.12, true);
  add('filtered', 2, true, 0.8, true);
  if (hasCoarse) {
    add('coarseGuide', 1, false, 0.5, false);
    add('coarseFiltered', 1, false, 0.5, true);
  }
  return features;
}
function featureValue(images, descriptor, x, y) {
  const image = images[descriptor.kind];
  if (descriptor.kind.startsWith('coarse')) { x = Math.floor(x / 2); y = Math.floor(y / 2); }
  const sx = clamp(x + descriptor.dx, image.width - 1), sy = clamp(y + descriptor.dy, image.height - 1), index = sy * image.width + sx;
  return descriptor.channel < 0 ? image.luminance[index] : image.data[index * 4 + descriptor.channel] / 255;
}

/**
 * Learn A→A' from paired examples and synthesize B' in causal scan order.
 * The source search uses bounded seeded candidates and shrinking random search instead
 * of the paper's ANN tree. Coherence candidates use already-synthesized neighbors.
 * Each output pixel is copied from A'; no predefined image filter is applied to B.
 */
export function* analogize({ source, filtered, target, levels = 3, coherence = 0.5, candidates = 64, seed = 42 } = {}) {
  validateImage(source, 'Source A'); validateImage(filtered, "Filtered example A'"); validateImage(target, 'Target B');
  if (source.width !== filtered.width || source.height !== filtered.height) throw new RangeError('A and A′ must have the same dimensions and aligned content.');
  if (!Number.isInteger(levels) || levels < 1 || levels > 4) throw new RangeError('Use 1–4 pyramid levels.');
  if (!Number.isFinite(coherence) || coherence < 0 || coherence > 8) throw new RangeError('Coherence must be between 0 and 8.');
  if (!Number.isInteger(candidates) || candidates < 8 || candidates > 256) throw new RangeError('Search candidates must be 8–256.');
  const actualLevels = Math.min(levels, Math.max(1, Math.floor(Math.log2(Math.min(source.width, source.height, target.width, target.height))) - 1));
  const sources = pyramid(source, actualLevels), examples = pyramid(filtered, actualLevels), targets = pyramid(target, actualLevels);
  const random = seededRandom(seed), results = new Array(actualLevels), mappings = new Array(actualLevels);
  const totalPixels = targets.reduce((sum, image) => sum + image.width * image.height, 0);
  let completedPixels = 0, finalFrame;
  for (let levelIndex = actualLevels - 1; levelIndex >= 0; levelIndex--) {
    const a = sources[levelIndex], ap = examples[levelIndex], b = targets[levelIndex];
    const coarse = levelIndex < actualLevels - 1;
    const data = new Uint8ClampedArray(b.width * b.height * 4), result = { width: b.width, height: b.height, data };
    const mapping = new Int32Array(b.width * b.height).fill(-1);
    const layout = featureLayout(coarse), dimensions = layout.length;
    const sourceImages = { guide: a, filtered: ap, coarseGuide: sources[levelIndex + 1], coarseFiltered: examples[levelIndex + 1] };
    const targetImages = { guide: b, filtered: result, coarseGuide: targets[levelIndex + 1], coarseFiltered: results[levelIndex + 1] };
    const sourceFeatures = new Float32Array(a.width * a.height * dimensions);
    const buckets = Array.from({ length: 32 }, () => []);
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      const p = y * a.width + x;
      buckets[Math.min(31, Math.floor(a.luminance[p] * 32))].push(p);
      for (let k = 0; k < dimensions; k++) sourceFeatures[p * dimensions + k] = featureValue(sourceImages, layout[k], x, y);
    }
    const nearBuckets = buckets.map((_, index) => {
      const values = [];
      for (let j = Math.max(0, index - 2); j <= Math.min(31, index + 2); j++) values.push(...buckets[j]);
      return values;
    });
    const query = new Float32Array(dimensions), weights = new Float32Array(dimensions);
    for (let y = 0; y < b.height; y++) {
      for (let x = 0; x < b.width; x++) {
        const q = y * b.width + x;
        for (let k = 0; k < dimensions; k++) {
          const descriptor = layout[k];
          // Outside-image causal samples must not read an uninitialized current pixel.
          const available = !descriptor.causal || (x + descriptor.dx >= 0 && x + descriptor.dx < b.width && y + descriptor.dy >= 0);
          weights[k] = available ? descriptor.weight : 0;
          query[k] = available ? featureValue(targetImages, descriptor, x, y) : 0;
        }
        const distance = (p, cutoff = Infinity) => {
          let sum = 0, offset = p * dimensions;
          for (let k = 0; k < dimensions; k++) {
            const difference = query[k] - sourceFeatures[offset++];
            sum += difference * difference * weights[k];
            if (sum > cutoff) return sum;
          }
          return sum;
        };
        let best = Math.min(a.height - 1, Math.floor(y * a.height / b.height)) * a.width + Math.min(a.width - 1, Math.floor(x * a.width / b.width));
        let bestDistance = distance(best);
        const consider = p => {
          if (p < 0 || p >= a.width * a.height || p === best) return;
          const d = distance(p, bestDistance);
          if (d < bestDistance) { best = p; bestDistance = d; }
        };
        if (coarse) {
          const previous = mappings[levelIndex + 1], previousTarget = targets[levelIndex + 1], previousSource = sources[levelIndex + 1];
          const p = previous[Math.floor(y / 2) * previousTarget.width + Math.floor(x / 2)];
          const sx = clamp((p % previousSource.width) * 2 + x % 2, a.width - 1), sy = clamp(Math.floor(p / previousSource.width) * 2 + y % 2, a.height - 1);
          consider(sy * a.width + sx);
        }
        const nearby = nearBuckets[Math.min(31, Math.floor(b.luminance[q] * 32))];
        for (let attempt = 0; attempt < candidates; attempt++) {
          const p = nearby.length && attempt % 4 !== 0 ? nearby[Math.floor(random() * nearby.length)] : Math.floor(random() * a.width * a.height);
          consider(p);
        }
        for (let span = Math.max(a.width, a.height); span >= 1; span = Math.floor(span / 2)) {
          const sx = clamp(best % a.width + Math.floor((random() * 2 - 1) * span), a.width - 1);
          const sy = clamp(Math.floor(best / a.width) + Math.floor((random() * 2 - 1) * span), a.height - 1);
          consider(sy * a.width + sx);
        }
        let coherent = -1, coherentDistance = Infinity;
        for (let dy = -2; dy <= 0; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (!(dy < 0 || dx < 0) || x + dx < 0 || x + dx >= b.width || y + dy < 0) continue;
          const neighbor = mapping[(y + dy) * b.width + x + dx];
          if (neighbor < 0) continue;
          const sx = neighbor % a.width - dx, sy = Math.floor(neighbor / a.width) - dy;
          if (sx < 0 || sx >= a.width || sy < 0 || sy >= a.height) continue;
          const p = sy * a.width + sx, d = distance(p, coherentDistance);
          if (d < coherentDistance) { coherent = p; coherentDistance = d; }
        }
        // Distances here are squared, so square the paper's norm-space tolerance.
        const tolerance = (1 + coherence * 2 ** -levelIndex) ** 2;
        if (coherent >= 0 && coherentDistance <= bestDistance * tolerance) best = coherent;
        mapping[q] = best;
        data.set(ap.data.subarray(best * 4, best * 4 + 4), q * 4);
      }
      if (y % 8 === 7 || y === b.height - 1) {
        finalFrame = { ...result, data: data.slice(), mapping: mapping.slice(), sourceWidth: a.width, sourceHeight: a.height, progress: (completedPixels + (y + 1) * b.width) / totalPixels, level: actualLevels - levelIndex, levels: actualLevels, candidates };
        yield finalFrame;
      }
    }
    results[levelIndex] = luminance(result); mappings[levelIndex] = mapping;
    completedPixels += b.width * b.height;
  }
  return finalFrame;
}
