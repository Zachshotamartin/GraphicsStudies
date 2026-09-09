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
  for (const { x, y, r } of points) {
    for (let py = Math.max(0, Math.floor(y - r - 1)); py <= Math.min(height - 1, Math.ceil(y + r + 1)); py++) {
      for (let px = Math.max(0, Math.floor(x - r - 1)); px <= Math.min(width - 1, Math.ceil(x + r + 1)); px++) {
        const alpha = clamp(r + 0.5 - Math.hypot(px + 0.5 - x, py + 0.5 - y), 0, 1), offset = (py * width + px) * 4;
        for (let c = 0; c < 3; c++) data[offset + c] = data[offset + c] * (1 - alpha) + ink[c] * alpha;
      }
    }
  }
  return data;
}
function colorValid(color) { return Array.isArray(color) && color.length === 3 && color.every(c => Number.isFinite(c) && c >= 0 && c <= 255); }

/** Yields independent RGBA previews and returns the final points for SVG export. */
export function* stipple({ source, count = 1800, iterations = 16, seed = 42, paper = [245, 243, 231], ink = [27, 44, 40] } = {}) {
  validate(source);
  if (!Number.isInteger(count) || count < 8 || count > 5000 || !Number.isInteger(iterations) || iterations < 1 || iterations > 30
    || !colorValid(paper) || !colorValid(ink)) throw new RangeError('Use 8–5000 dots, 1–30 iterations, and RGB colors.');
  const { width, height } = source, random = randomGenerator(seed);
  // Increase integration resolution with point count so high-count cells remain sampled.
  const longest = Math.min(192, Math.max(112, Math.ceil(Math.sqrt(count * 12))));
  const scale = Math.min(1, longest / Math.max(width, height));
  const sw = Math.max(8, Math.round(width * scale)), sh = Math.max(8, Math.round(height * scale));
  const samples = [], cdf = [];
  let mass = 0, darkness = 0;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const sx = (x + 0.5) * width / sw, sy = (y + 0.5) * height / sh;
    const i = (Math.min(height - 1, Math.floor(sy)) * width + Math.min(width - 1, Math.floor(sx))) * 4;
    const lum = (0.2126 * source.data[i] + 0.7152 * source.data[i + 1] + 0.0722 * source.data[i + 2]) / 255;
    const d = (1 - lum) * source.data[i + 3] / 255;
    // Linear darkness is the density being integrated, not a random placement mask.
    mass += d; darkness += d;
    samples.push({ x: sx, y: sy, weight: d }); cdf.push(mass);
  }
  if (mass < 1e-8) {
    const result = { width, height, data: background(width, height, paper), points: [], paper, ink, iterations: 0, energy: 0, progress: 1 };
    yield result; return result;
  }
  const actualCount = Math.min(count, sw * sh);
  const radius = clamp(Math.sqrt(width * height * (darkness / samples.length) * 0.42 / (Math.PI * actualCount)), 0.42, 5);
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
    energy = 0;
    for (const sample of samples) {
      if (sample.weight <= 0) continue;
      const near = nearest(tree, points, sample.x, sample.y), i = near.index;
      mx[i] += sample.x * sample.weight; my[i] += sample.y * sample.weight; weights[i] += sample.weight;
      energy += near.distance * sample.weight;
    }
    let movement = 0;
    for (let i = 0; i < points.length; i++) {
      if (weights[i] <= 1e-12) continue; // Empty sampled cells retain their sites; do not inject random jumps.
      const x = mx[i] / weights[i], y = my[i] / weights[i];
      movement += Math.hypot(x - points[i].x, y - points[i].y);
      points[i].x = x; points[i].y = y;
    }
    result = { width, height, data: drawPoints(points, width, height, paper, ink), points: points.map(p => ({ ...p })), paper, ink, iterations: iteration + 1, energy: energy / mass, movement: movement / actualCount, progress: (iteration + 1) / iterations, sampleWidth: sw, sampleHeight: sh };
    yield result;
  }
  return result;
}
