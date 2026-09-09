// Durand & Dorsey (2002): edge-preserving base/detail tone mapping.
// Direct bilateral filtering at preview resolution, rather than their accelerated approximation.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const srgb = (v) =>
  Math.round(
    255 *
      clamp(
        v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055,
        0,
        1,
      ),
  );

export function decodeRadiance(buffer, maxSize = 512) {
  if (!Number.isInteger(maxSize) || maxSize < 1 || maxSize > 512)
    throw new Error("HDR preview size must be an integer from 1 to 512.");
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let offset = 0;
  const line = () => {
    let s = "";
    while (offset < bytes.length) {
      const b = bytes[offset++];
      if (b === 10) break;
      s += String.fromCharCode(b);
    }
    return s.trim();
  };
  if (!/^#\?(RADIANCE|RGBE)$/.test(line()))
    throw new Error("Choose a Radiance .hdr RGBE file.");
  let header = "";
  for (let s = line(); s; s = line()) {
    header += s + "\n";
    if (offset >= bytes.length) throw new Error("Incomplete HDR header.");
    if (offset > 65536) throw new Error("HDR header is too long.");
  }
  if (!header.includes("FORMAT=32-bit_rle_rgbe"))
    throw new Error("Only RGBE Radiance data is supported.");
  const dimensions = /^([+-])Y (\d+) ([+-])X (\d+)$/.exec(line());
  if (!dimensions)
    throw new Error(
      "Unsupported HDR orientation. Use a Y-major Radiance image.",
    );
  const h = Number(dimensions[2]),
    w = Number(dimensions[4]);
  if (!w || !h || w * h > 16000000)
    throw new Error("HDR images must be smaller than 16 megapixels.");
  const scale = Math.min(1, maxSize / Math.max(w, h)),
    width = Math.max(1, Math.round(w * scale)),
    height = Math.max(1, Math.round(h * scale));
  const data = new Float64Array(width * height * 3),
    counts = new Uint32Array(width * height),
    row = new Uint8Array(w * 4);
  const read = () => {
    if (offset >= bytes.length) throw new Error("Incomplete HDR pixel data.");
    return bytes[offset++];
  };
  for (let y = 0; y < h; y++) {
    const a = read(),
      b = read(),
      c = read(),
      d = read();
    if (w >= 8 && w <= 32767 && a === 2 && b === 2 && (c & 128) === 0) {
      if (((c << 8) | d) !== w) throw new Error("Invalid HDR scanline width.");
      for (let channel = 0; channel < 4; channel++) {
        let x = 0;
        while (x < w) {
          const n = read();
          if (!n) throw new Error("Invalid HDR run.");
          const length = n > 128 ? n - 128 : n;
          if (x + length > w) throw new Error("Invalid HDR run length.");
          if (n > 128) {
            const value = read();
            for (let j = 0; j < length; j++) row[x++ * 4 + channel] = value;
          } else
            for (let j = 0; j < length; j++) row[x++ * 4 + channel] = read();
        }
      }
    } else {
      row.set([a, b, c, d], 0);
      for (let i = 4; i < row.length; i++) row[i] = read();
      // Legacy repeat-marker encoding is rejected rather than silently producing bad radiance.
      for (let i = 0; i < row.length; i += 4)
        if (row[i] === 1 && row[i + 1] === 1 && row[i + 2] === 1)
          throw new Error(
            "Legacy HDR repeat encoding is unsupported. Re-export as modern RGBE.",
          );
    }
    for (let x = 0; x < w; x++) {
      const sx = dimensions[3] === "+" ? x : w - 1 - x,
        sy = dimensions[1] === "-" ? y : h - 1 - y;
      const p =
        Math.min(height - 1, Math.floor((sy * height) / h)) * width +
        Math.min(width - 1, Math.floor((sx * width) / w));
      const k = x * 4,
        f = row[k + 3] ? Math.pow(2, row[k + 3] - 136) : 0;
      for (let j = 0; j < 3; j++) data[p * 3 + j] += row[k + j] * f;
      counts[p]++;
    }
  }
  for (let p = 0; p < counts.length; p++)
    for (let j = 0; j < 3; j++) data[p * 3 + j] /= Math.max(1, counts[p]);
  return { width, height, data: new Float32Array(data) };
}

export function exposurePreview(source, exposure = 0) {
  const { width, height, data: rgb } = source,
    data = new Uint8ClampedArray(width * height * 4),
    gain = 2 ** exposure;
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = srgb(rgb[i * 3 + c] * gain);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

export function* toneMap({
  source,
  contrast = 12,
  detail = 1,
  exposure = 0,
  range = 0.4,
  spatial = 6,
}) {
  const { width, height, data: rgb } = source || {};
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 512 * 512 ||
    rgb?.length !== width * height * 3
  )
    throw new Error("Tone mapping needs a bounded linear RGB image.");
  if (![contrast, detail, exposure, range, spatial].every(Number.isFinite))
    throw new Error("Tone mapping controls must be finite.");
  contrast = clamp(contrast, 2, 100);
  detail = clamp(detail, 0, 2);
  exposure = clamp(exposure, -6, 6);
  range = clamp(range, 0.05, 2);
  spatial = clamp(spatial, 1, 12);
  const n = width * height,
    log = new Float32Array(n),
    base = new Float32Array(n),
    luminance = new Float32Array(n),
    radius = Math.ceil(spatial * 2),
    step = Math.max(1, Math.floor(radius / 8));
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3],
      g = rgb[i * 3 + 1],
      b = rgb[i * 3 + 2];
    if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0))
      throw new Error("Radiance must contain finite, nonnegative values.");
    luminance[i] = Math.max(1e-8, (20 * r + 40 * g + b) / 61);
    log[i] = Math.log10(luminance[i]);
  }
  const offsets = [[0, 0, 1]];
  for (let dy = -radius; dy <= radius; dy += step)
    for (let dx = -radius; dx <= radius; dx += step)
      offsets.push([
        dx,
        dy,
        Math.exp(-(dx * dx + dy * dy) / (2 * spatial * spatial)),
      ]);
  let minimum = Infinity,
    maximum = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      let sum = 0,
        weight = 0;
      for (const [dx, dy, sw] of offsets) {
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        const q = yy * width + xx,
          d = log[q] - log[p],
          w = sw * Math.exp((-d * d) / (2 * range * range));
        sum += log[q] * w;
        weight += w;
      }
      base[p] = sum / weight;
      minimum = Math.min(minimum, base[p]);
      maximum = Math.max(maximum, base[p]);
    }
    if (y % 16 === 0)
      yield {
        progress: (0.9 * y) / height,
        stage: "Separating illumination and detail",
      };
  }
  const compression = Math.min(
      1,
      Math.log10(contrast) / Math.max(1e-6, maximum - minimum),
    ),
    data = new Uint8ClampedArray(n * 4),
    baseImage = new Uint8ClampedArray(n * 4),
    detailImage = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const residual = log[i] - base[i],
      out =
        10 ** ((base[i] - maximum) * compression + residual * detail) *
        2 ** exposure;
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] = srgb((rgb[i * 3 + c] / luminance[i]) * out);
      baseImage[i * 4 + c] = srgb(10 ** ((base[i] - maximum) * compression));
      detailImage[i * 4 + c] = clamp(128 + residual * 100, 0, 255);
    }
    data[i * 4 + 3] = baseImage[i * 4 + 3] = detailImage[i * 4 + 3] = 255;
  }
  return {
    width,
    height,
    data,
    base: { width, height, data: baseImage },
    detailLayer: { width, height, data: detailImage },
    progress: 1,
    compression,
    dynamicRange: 10 ** (maximum - minimum),
  };
}
