/** Gaussian frequency hybrids, after Oliva, Torralba & Schyns (2006).
 * Images are RGBA byte buffers. All operations allocate new buffers.
 */
function imageInput(image, label) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
      || image.width < 2 || image.height < 2 || image.width > 1024 || image.height > 1024
      || image.data?.length !== image.width * image.height * 4) {
    throw new RangeError(`${label} must be a 2–1024 pixel RGBA image.`);
  }
  for (const value of image.data) {
    if (!Number.isFinite(value) || value < 0 || value > 255) throw new RangeError(`${label} contains invalid pixels.`);
  }
  return image;
}

function parameter(value, low, high, name) {
  if (!Number.isFinite(value) || value < low || value > high) throw new RangeError(`${name} must be between ${low} and ${high}.`);
  return value;
}

function reflected(index, size) {
  const period = 2 * size;
  let i = ((index % period) + period) % period;
  if (i >= size) i = period - i - 1;
  return i;
}

/** Separable Gaussian with a normalized 3-sigma kernel and mirrored boundaries. */
export function gaussianRGB(values, width, height, sigma) {
  parameter(sigma, 0.2, 80, 'Gaussian sigma');
  if (values.length !== width * height * 3) throw new RangeError('Expected interleaved RGB values.');
  const radius = Math.ceil(3 * sigma);
  const kernel = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    kernel[k + radius] = Math.exp(-0.5 * (k / sigma) ** 2);
    sum += kernel[k + radius];
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const temporary = new Float32Array(values.length);
  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      for (let k = -radius; k <= radius; k++) {
        const from = (y * width + reflected(x + k, width)) * 3;
        const weight = kernel[k + radius];
        for (let c = 0; c < 3; c++) temporary[at + c] += values[from + c] * weight;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      for (let k = -radius; k <= radius; k++) {
        const from = (reflected(y + k, height) * width + x) * 3;
        const weight = kernel[k + radius];
        for (let c = 0; c < 3; c++) output[at + c] += temporary[from + c] * weight;
      }
    }
  }
  return output;
}

function opaqueRGB(image, grayscale) {
  const values = new Float32Array(image.width * image.height * 3);
  for (let p = 0; p < image.width * image.height; p++) {
    const alpha = image.data[p * 4 + 3] / 255;
    const gray = 0.2126 * image.data[p * 4] + 0.7152 * image.data[p * 4 + 1] + 0.0722 * image.data[p * 4 + 2];
    for (let c = 0; c < 3; c++) values[p * 3 + c] = alpha * (grayscale ? gray : image.data[p * 4 + c]) + (1 - alpha) * 128;
  }
  return values;
}

function rgba(values, width, height, offset = 0) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    for (let c = 0; c < 3; c++) data[p * 4 + c] = values[p * 3 + c] + offset;
    data[p * 4 + 3] = 255;
  }
  return { width, height, data };
}

/**
 * source supplies broad structure; other supplies sharp detail.
 * sigma is in output pixels; highSigma defaults to sigma*0.7.
 * alignment x/y are fractions of output width/height, scale is around the center.
 * Outside the transformed detail image, edge pixels are extended.
 */
export function hybrid({ source, other, sigma = 6, highSigma = sigma * 0.7, detail = 1,
  alignment = {}, grayscale = false } = {}) {
  imageInput(source, 'Low-frequency source');
  imageInput(other, 'High-frequency source');
  parameter(sigma, 0.3, 80, 'Low-frequency blur');
  parameter(highSigma, 0.2, 80, 'High-frequency blur');
  parameter(detail, 0, 4, 'Detail strength');
  const { x = 0, y = 0, scale = 1 } = alignment;
  parameter(x, -1, 1, 'Horizontal alignment');
  parameter(y, -1, 1, 'Vertical alignment');
  parameter(scale, 0.25, 4, 'Alignment scale');
  const { width, height } = source;
  const base = opaqueRGB(source, grayscale);
  const otherValues = opaqueRGB(other, grayscale);
  const aligned = new Float32Array(base.length);
  // Uniform cover fitting avoids stretching the facial features used for alignment.
  const fit = Math.max(width / other.width, height / other.height) * scale;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const sx = Math.max(0, Math.min(other.width - 1, (px + 0.5 - width * (0.5 + x)) / fit + other.width / 2 - 0.5));
      const sy = Math.max(0, Math.min(other.height - 1, (py + 0.5 - height * (0.5 + y)) / fit + other.height / 2 - 0.5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, other.width - 1), y1 = Math.min(y0 + 1, other.height - 1);
      const tx = sx - x0, ty = sy - y0;
      const at = (py * width + px) * 3;
      for (let c = 0; c < 3; c++) {
        const top = otherValues[(y0 * other.width + x0) * 3 + c] * (1 - tx) + otherValues[(y0 * other.width + x1) * 3 + c] * tx;
        const bottom = otherValues[(y1 * other.width + x0) * 3 + c] * (1 - tx) + otherValues[(y1 * other.width + x1) * 3 + c] * tx;
        aligned[at + c] = top * (1 - ty) + bottom * ty;
      }
    }
  }
  const low = gaussianRGB(base, width, height, sigma);
  const blurredDetail = gaussianRGB(aligned, width, height, highSigma);
  const high = new Float32Array(base.length);
  const combined = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    high[i] = aligned[i] - blurredDetail[i];
    combined[i] = low[i] + detail * high[i];
  }
  return {
    ...rgba(combined, width, height),
    low: rgba(low, width, height), high: rgba(high, width, height, 128),
    aligned: rgba(aligned, width, height),
    // Signed samples are available for inspection without throwing away negative detail.
    highValues: high, lowValues: low,
    sigma, highSigma, detail,
  };
}
