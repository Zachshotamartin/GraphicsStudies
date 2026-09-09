/** Coarse-to-fine curved brush painting after Hertzmann (1998).
 * Each layer uses a Gaussian reference, error-driven seeds and isophote strokes.
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
function blurRGB(source, sigma) {
  const { width: w, height: h, data } = source, radius = Math.ceil(2.5 * sigma), kernel = new Float64Array(2 * radius + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); kernel[i + radius] = v; total += v; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
  const horizontal = new Float32Array(w * h * 3), output = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let d = -radius; d <= radius; d++) {
    const from = (y * w + clamp(x + d, 0, w - 1)) * 4, to = (y * w + x) * 3, weight = kernel[d + radius], alpha = data[from + 3] / 255;
    for (let c = 0; c < 3; c++) horizontal[to + c] += (data[from + c] * alpha + 245 * (1 - alpha)) * weight;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let d = -radius; d <= radius; d++) {
    const from = (clamp(y + d, 0, h - 1) * w + x) * 3, to = (y * w + x) * 3, weight = kernel[d + radius];
    for (let c = 0; c < 3; c++) output[to + c] += horizontal[from + c] * weight;
  }
  return output;
}
function gradients(rgb, width, height) {
  const gray = new Float32Array(width * height), gx = new Float32Array(gray.length), gy = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) gray[i] = rgb[i * 3] * 0.2126 + rgb[i * 3 + 1] * 0.7152 + rgb[i * 3 + 2] * 0.0722;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, xm = Math.max(0, x - 1), xp = Math.min(width - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(height - 1, y + 1);
    gx[i] = gray[ym * width + xp] + 2 * gray[y * width + xp] + gray[yp * width + xp] - gray[ym * width + xm] - 2 * gray[y * width + xm] - gray[yp * width + xm];
    gy[i] = gray[yp * width + xm] + 2 * gray[yp * width + x] + gray[yp * width + xp] - gray[ym * width + xm] - 2 * gray[ym * width + x] - gray[ym * width + xp];
  }
  return { gx, gy };
}
function sample(field, x, y, w, h) {
  x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  return (field[y0 * w + x0] * (1 - fx) + field[y0 * w + x1] * fx) * (1 - fy) + (field[y1 * w + x0] * (1 - fx) + field[y1 * w + x1] * fx) * fy;
}
function distance(rgb, index, color) { return Math.hypot(rgb[index] - color[0], rgb[index + 1] - color[1], rgb[index + 2] - color[2]); }
function splinePoints(control, radius, width, height) {
  if (control.length < 2) return control.map(p => [...p]);
  const points = [];
  for (let i = 0; i + 1 < control.length; i++) {
    const a = control[Math.max(0, i - 1)], b = control[i], c = control[i + 1], d = control[Math.min(control.length - 1, i + 2)];
    const steps = Math.max(2, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / Math.max(0.7, radius * 0.35)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const p = [0, 1].map(k => 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3));
      points.push([clamp(p[0], 0, width - 1), clamp(p[1], 0, height - 1)]);
    }
  }
  points.push([...control[control.length - 1]]);
  return points;
}
function makeStroke(x, y, radius, reference, canvas, grad, w, h, firstLayer, random) {
  const index = (Math.round(y) * w + Math.round(x)) * 3, color = Array.from(reference.subarray(index, index + 3), Math.round), controlPoints = [[x, y]];
  let lastDx = 0, lastDy = 0;
  const direction = random() < 0.5 ? -1 : 1;
  for (let step = 0; step < 12; step++) {
    const px = Math.round(x), py = Math.round(y), at = (py * w + px) * 3, ci = (py * w + px) * 4;
    if (!firstLayer && step >= 3 && distance(reference, at, [canvas[ci], canvas[ci + 1], canvas[ci + 2]]) < distance(reference, at, color)) break;
    let dx = -sample(grad.gy, x, y, w, h) * direction, dy = sample(grad.gx, x, y, w, h) * direction;
    let norm = Math.hypot(dx, dy);
    if (norm < 0.015) break;
    dx /= norm; dy /= norm;
    if (dx * lastDx + dy * lastDy < 0) { dx = -dx; dy = -dy; }
    if (step) { dx = dx * 0.72 + lastDx * 0.28; dy = dy * 0.72 + lastDy * 0.28; norm = Math.hypot(dx, dy); dx /= norm; dy /= norm; }
    const nx = x + radius * dx, ny = y + radius * dy;
    if (nx < 0 || ny < 0 || nx > w - 1 || ny > h - 1) break;
    x = nx; y = ny; lastDx = dx; lastDy = dy; controlPoints.push([x, y]);
  }
  return { points: splinePoints(controlPoints, radius, w, h), controlPoints, radius, color };
}
function drawStroke(data, width, height, stroke) {
  for (const [x, y] of stroke.points) {
    const r = stroke.radius;
    for (let py = Math.max(0, Math.floor(y - r - 1)); py <= Math.min(height - 1, Math.ceil(y + r + 1)); py++) for (let px = Math.max(0, Math.floor(x - r - 1)); px <= Math.min(width - 1, Math.ceil(x + r + 1)); px++) {
      const alpha = clamp(r + 0.5 - Math.hypot(px - x, py - y), 0, 1), i = (py * width + px) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * (1 - alpha) + stroke.color[c] * alpha;
    }
  }
}
/** Returns flattened curved paths, constant RGB colors and brush radii for replay/export. */
export function* paint({ source, brushSize = 12, detail = 0.55, seed = 42 } = {}) {
  validate(source);
  if (!Number.isFinite(brushSize) || brushSize < 4 || brushSize > 28 || !Number.isFinite(detail) || detail < 0 || detail > 1) throw new RangeError('Brush radius must be 4–28 pixels and detail must be 0–1.');
  const { width, height } = source, random = randomGenerator(seed), canvas = new Uint8ClampedArray(width * height * 4), paper = [245, 243, 231];
  for (let i = 0; i < canvas.length; i += 4) canvas.set([...paper, 255], i);
  const radii = [...new Set([brushSize, brushSize / 2, Math.max(1.5, brushSize * (0.31 - detail * 0.18))])];
  const threshold = 72 - detail * 57, strokes = [];
  let result;
  for (let layer = 0; layer < radii.length; layer++) {
    const radius = radii[layer], reference = blurRGB(source, Math.max(0.6, radius * 0.45)), grad = gradients(reference, width, height);
    const grid = Math.max(2, Math.floor(radius * 1.2)), planned = [];
    for (let y = 0; y < height; y += grid) for (let x = 0; x < width; x += grid) {
      const xmax = Math.min(width, x + grid), ymax = Math.min(height, y + grid);
      let sum = 0, largest = -1, sx = Math.min(width - 1, x + Math.floor(grid / 2)), sy = Math.min(height - 1, y + Math.floor(grid / 2));
      for (let py = y; py < ymax; py++) for (let px = x; px < xmax; px++) {
        const i = py * width + px, error = distance(reference, i * 3, [canvas[i * 4], canvas[i * 4 + 1], canvas[i * 4 + 2]]);
        sum += error;
        if (layer && error > largest) { largest = error; sx = px; sy = py; }
      }
      if (!layer || sum / ((xmax - x) * (ymax - y)) > threshold) planned.push(makeStroke(sx, sy, radius, reference, canvas, grad, width, height, layer === 0, random));
    }
    for (let i = planned.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [planned[i], planned[j]] = [planned[j], planned[i]]; }
    for (let i = 0; i < planned.length; i++) {
      drawStroke(canvas, width, height, planned[i]); strokes.push(planned[i]);
      if ((i + 1) % Math.max(1, Math.ceil(planned.length / 5)) === 0 || i + 1 === planned.length) {
        result = { width, height, data: canvas.slice(), progress: (layer + (i + 1) / planned.length) / radii.length, layer: layer + 1, layers: radii.length, radius, strokeCount: strokes.length, paper };
        yield result;
      }
    }
    if (!planned.length) {
      result = { width, height, data: canvas.slice(), progress: (layer + 1) / radii.length, layer: layer + 1, layers: radii.length, radius, strokeCount: strokes.length, paper };
      yield result;
    }
  }
  return { ...result, data: canvas, progress: 1, strokes, radii, paper, strokeCount: strokes.length };
}
