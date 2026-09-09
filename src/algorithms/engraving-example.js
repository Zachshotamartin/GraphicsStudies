/**
 * Registered engraving-style example preparation for Image Analogies.
 * This deterministic filter makes A′ from A. It is NOT the analogies algorithm:
 * B′ must still be synthesized from the independent A / A′ / B inputs.
 */
const clamp = value => Math.max(0, Math.min(1, value));
const smoothstep = (low, high, value) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};
const OVER = (under, over) => 1 - (1 - under) * (1 - over);
function checkColor(color, name) {
  if (!Array.isArray(color) || color.length !== 3 || color.some(value => !Number.isFinite(value) || value < 0 || value > 255)) throw new RangeError(`${name} needs three RGB values between 0 and 255.`);
}
function lineCoverage(coordinate, spacing, width) {
  const phase = ((coordinate % spacing) + spacing) % spacing;
  const distance = Math.min(phase, spacing - phase);
  return 1 - smoothstep(Math.max(0, width / 2 - 0.45), width / 2 + 0.45, distance);
}

/**
 * Turn a photograph into aligned dark contours and fine tonal hatching.
 * The photo is never rescaled, shifted, or warped. Transparent source pixels are
 * composited onto white for analysis; their original alpha is retained in A′.
 */
export function engraveExample({
  source,
  hatchSpacing = Math.max(3, (source?.width || 256) / 60),
  edgeStrength = 0.9,
  hatchStrength = 0.6,
  paper = [247, 244, 234],
  ink = [32, 37, 35],
} = {}) {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 4 || source.height < 4 || source.width > 2048 || source.height > 2048 || !(source.data instanceof Uint8ClampedArray) || source.data.length !== source.width * source.height * 4) throw new RangeError('Use a 4–2048px RGBA source image.');
  if (!Number.isFinite(hatchSpacing) || hatchSpacing < 2 || hatchSpacing > 64) throw new RangeError('Hatch spacing must be between 2 and 64 pixels.');
  for (const [value, name] of [[edgeStrength, 'Edge strength'], [hatchStrength, 'Hatch strength']]) if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1.`);
  checkColor(paper, 'Paper'); checkColor(ink, 'Ink');
  const { width, height } = source, count = width * height;
  const luminance = new Float32Array(count), horizontal = new Float32Array(count), blurred = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const alpha = source.data[i * 4 + 3] / 255;
    const value = (0.2126 * source.data[i * 4] + 0.7152 * source.data[i * 4 + 1] + 0.0722 * source.data[i * 4 + 2]) / 255;
    luminance[i] = alpha * value + 1 - alpha;
  }
  // A small separable Gaussian suppresses photograph noise without moving features.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    horizontal[i] = (luminance[y * width + Math.max(0, x - 1)] + 2 * luminance[i] + luminance[y * width + Math.min(width - 1, x + 1)]) / 4;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    blurred[i] = (horizontal[Math.max(0, y - 1) * width + x] + 2 * horizontal[i] + horizontal[Math.min(height - 1, y + 1) * width + x]) / 4;
  }
  const gx = new Float32Array(count), gy = new Float32Array(count), gradient = new Float32Array(count);
  const at = (x, y) => blurred[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    gx[i] = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 4;
    gy[i] = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 4;
    gradient[i] = Math.hypot(gx[i], gy[i]);
  }
  const data = new Uint8ClampedArray(count * 4), diagonal = Math.SQRT1_2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, darkness = 1 - blurred[i];
    const first = lineCoverage((x + y) * diagonal, hatchSpacing, 0.7 + darkness * 0.45);
    const second = lineCoverage((x - y) * diagonal + hatchSpacing * 0.31, hatchSpacing * 1.19, 0.7 + darkness * 0.35);
    const third = lineCoverage(y + hatchSpacing * 0.21, hatchSpacing * 0.9, 0.65);
    let coverage = 0.07 * darkness * darkness;
    coverage = OVER(coverage, first * smoothstep(0.08, 0.62, darkness) * hatchStrength);
    coverage = OVER(coverage, second * smoothstep(0.42, 0.85, darkness) * hatchStrength * 0.82);
    coverage = OVER(coverage, third * smoothstep(0.74, 0.99, darkness) * hatchStrength * 0.7);
    // Deep recesses retain a modest solid tone so doorways remain legible when reduced.
    coverage = OVER(coverage, smoothstep(0.76, 1, darkness) * 0.48 * hatchStrength);
    const magnitude = gradient[i];
    let contour = 0;
    if (magnitude > 0.025) {
      const dx = Math.round(gx[i] / magnitude), dy = Math.round(gy[i] / magnitude);
      const before = gradient[Math.max(0, Math.min(height - 1, y - dy)) * width + Math.max(0, Math.min(width - 1, x - dx))];
      const after = gradient[Math.max(0, Math.min(height - 1, y + dy)) * width + Math.max(0, Math.min(width - 1, x + dx))];
      // Nonmaximum suppression keeps strong architectural contours approximately one pixel wide.
      if (magnitude >= before && magnitude >= after) contour = smoothstep(0.035, 0.23, magnitude) * edgeStrength;
    }
    coverage = OVER(coverage, contour);
    for (let channel = 0; channel < 3; channel++) data[i * 4 + channel] = paper[channel] * (1 - coverage) + ink[channel] * coverage;
    data[i * 4 + 3] = source.data[i * 4 + 3];
  }
  return { width, height, data, progress: 1, treatment: 'registered-engraving', hatchSpacing, edgeStrength, hatchStrength };
}
