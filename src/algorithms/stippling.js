/** Weighted centroidal Voronoi stippling after Secord (2002).
 * Voronoi regions are integrated on a bounded raster grid, not polygon-clipped.
 */
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function validate(source) {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height)
    || source.width < 8 || source.height < 8 || source.width > 512 || source.height > 512
    || !(source.data instanceof Uint8ClampedArray || source.data instanceof Uint8Array)
    || source.data.length !== source.width * source.height * 4) throw new RangeError('Use an RGBA image between 8 and 512 pixels per side.');
}
function randomGenerator(seed) {
  let a = 2166136261;
  for (const c of String(seed)) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  return () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function treeFor(points, indices, depth = 0) {
  if (!indices.length) return null;
  const axis = depth % 2 ? 'y' : 'x';
  indices.sort((a, b) => points[a][axis] - points[b][axis]);
  const middle = indices.length >> 1;
  return { index: indices[middle], axis, left: treeFor(points, indices.slice(0, middle), depth + 1), right: treeFor(points, indices.slice(middle + 1), depth + 1) };
}
function nearest(tree, points, x, y) {
  let index = -1, distance = Infinity;
  function visit(node) {
    if (!node) return;
    const p = points[node.index], dx = x - p.x, dy = y - p.y, d = dx * dx + dy * dy;
    if (d < distance) { distance = d; index = node.index; }
    const delta = node.axis === 'x' ? dx : dy;
    visit(delta < 0 ? node.left : node.right);
    if (delta * delta <= distance) visit(delta < 0 ? node.right : node.left);
  }
  visit(tree);
  return { index, distance };
}
function background(width, height, paper) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...paper, 255], i);
  return data;
}
function drawPoints(points, width, height, paper, ink) {
  const data = background(width, height, paper);
  const pixels = [], coverage = [];
  for (const { x, y, r } of points) {
    pixels.length = 0; coverage.length = 0;
    let coveredArea = 0;
    for (let py = Math.max(0, Math.floor(y - r - 1)); py <= Math.min(height - 1, Math.ceil(y + r + 1)); py++) {
      for (let px = Math.max(0, Math.floor(x - r - 1)); px <= Math.min(width - 1, Math.ceil(x + r + 1)); px++) {
        const fringe = r < 0.25 ? 0.75 : 0.5;
        const alpha = clamp(r + fringe - Math.hypot(px + 0.5 - x, py + 0.5 - y), 0, 1);
        if (alpha > 0) { pixels.push((py * width + px) * 4); coverage.push(alpha); coveredArea += alpha; }
      }
    }
    // Normalize the antialiasing footprint to the disk's area. A fixed opacity
    // ramp or minimum radius would make many subpixel dots artificially dark.
    const areaScale = Math.min(1, Math.PI * r * r / coveredArea);
    for (let i = 0; i < pixels.length; i++) {
      const offset = pixels[i], alpha = coverage[i] * areaScale;
      for (let c = 0; c < 3; c++) data[offset + c] = data[offset + c] * (1 - alpha) + ink[c] * alpha;
    }
  }
  return data;
}
function colorValid(color) { return Array.isArray(color) && color.length === 3 && color.every(c => Number.isFinite(c) && c >= 0 && c <= 255); }

/** Yields independent RGBA previews and returns the final points for SVG export. */
export function* stipple({ source, count = 8000, iterations = 16, seed = 42, paper = [245, 243, 231], ink = [27, 44, 40] } = {}) {
  validate(source);
  if (!Number.isInteger(count) || count < 8 || count > 20000 || !Number.isInteger(iterations) || iterations < 1 || iterations > 30
    || !colorValid(paper) || !colorValid(ink)) throw new RangeError('Use 8–20000 dots, 1–30 iterations, and RGB colors.');
  const { width, height } = source, random = randomGenerator(seed);
  const actualCount = Math.min(count, width * height);
  // Target twelve quadrature samples per site, preserving image proportions.
  // High dot counts may use the entire source raster (up to 512 × 512).
  const scale = Math.min(1, Math.max(112 / Math.max(width, height), Math.sqrt(actualCount * 12 / (width * height))));
  const sw = Math.min(width, Math.max(8, Math.ceil(width * scale))), sh = Math.min(height, Math.max(8, Math.ceil(height * scale)));
  const samples = [], cdf = [];
  let mass = 0, darkness = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const sx = (x + 0.5) * width / sw, sy = (y + 0.5) * height / sh;
    const i = (Math.min(height - 1, Math.floor(sy)) * width + Math.min(width - 1, Math.floor(sx))) * 4;
    const lum = (0.2126 * source.data[i] + 0.7152 * source.data[i + 1] + 0.0722 * source.data[i + 2]) / 255;
    const d = (1 - lum) * source.data[i + 3] / 255;
    // Desired site density is proportional to darkness. Squaring the centroid
    // weight compensates for the square-root density law of planar CVTs.
    mass += d; darkness += d;
    samples.push({ x: sx, y: sy, weight: d * d, darkness: d }); cdf.push(mass);
  }
  if (mass < 1e-8) {
    const result = { width, height, data: background(width, height, paper), points: [], paper, ink, iterations: 0, energy: 0, progress: 1, requestedCount: count, actualCount: 0, sampleWidth: sw, sampleHeight: sh };
    yield result; return result;
  }
  const sampleArea = width * height / samples.length;
  const radius = Math.sqrt(width * height * (darkness / samples.length) / (Math.PI * actualCount));
  function samplePoint() {
    const target = random() * mass;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = lo + hi >> 1; if (cdf[mid] <= target) lo = mid + 1; else hi = mid; }
    const sample = samples[lo];
    return { x: clamp(sample.x + (random() - 0.5) * width / sw, 0.25, width - 0.25), y: clamp(sample.y + (random() - 0.5) * height / sh, 0.25, height - 0.25), r: radius };
  }
  const points = Array.from({ length: actualCount }, samplePoint);
  let energy = 0, result;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const tree = treeFor(points, points.map((_, i) => i));
    const mx = new Float64Array(actualCount), my = new Float64Array(actualCount), weights = new Float64Array(actualCount);
    const cellSamples = new Uint32Array(actualCount), cellDarkness = new Float64Array(actualCount);
    energy = 0;
    for (const sample of samples) {
      const near = nearest(tree, points, sample.x, sample.y), i = near.index;
      cellSamples[i]++; cellDarkness[i] += sample.darkness;
      mx[i] += sample.x * sample.weight; my[i] += sample.y * sample.weight; weights[i] += sample.weight;
      energy += near.distance * sample.weight;
    }
    let movement = 0;
    for (let i = 0; i < points.length; i++) {
      if (weights[i] <= 1e-12) continue;
      const x = mx[i] / weights[i], y = my[i] / weights[i];
      movement += Math.hypot(x - points[i].x, y - points[i].y);
      points[i].x = x; points[i].y = y;
      // Integrate desired ink independently of the squared centroid weights.
      // A dark cell needs enough overlapping circle area to close packing gaps;
      // lighter cells preserve separated dots and their actual local tone.
      const tone = cellDarkness[i] / cellSamples[i];
      const packing = 1 + 0.28 * Math.pow(Math.max(0, (tone - 0.75) / 0.25), 4);
      points[i].r = Math.sqrt(cellDarkness[i] * sampleArea * packing / Math.PI);
    }
    result = { width, height, data: drawPoints(points, width, height, paper, ink), points: points.map(p => ({ ...p })), paper, ink, iterations: iteration + 1, energy: energy / mass, movement: movement / actualCount, progress: (iteration + 1) / iterations, sampleWidth: sw, sampleHeight: sh, requestedCount: count, actualCount };
    yield result;
  }
  return result;
}
