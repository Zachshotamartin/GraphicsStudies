/** Content-aware image reduction after Avidan and Shamir (2007).
 * Uses backward RGB-gradient energy, exact dynamic programming and propagated masks.
 */
function validate(source) {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height)
    || source.width < 8 || source.height < 8 || source.width > 512 || source.height > 512
    || !(source.data instanceof Uint8ClampedArray || source.data instanceof Uint8Array)
    || source.data.length !== source.width * source.height * 4) throw new RangeError('Use an RGBA image between 8 and 512 pixels per side.');
}
function validateMask(mask, size) {
  if (mask != null && (!(mask instanceof Uint8Array || mask instanceof Uint8ClampedArray) || mask.length !== size)) throw new RangeError('Masks must contain one byte per image pixel.');
}
/** RGB derivatives preserve chromatic boundaries even when their luminance matches. */
export function energyMap(source, protectMask, removeMask) {
  const { width: w, height: h, data } = source, energy = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, left = (y * w + Math.max(0, x - 1)) * 4, right = (y * w + Math.min(w - 1, x + 1)) * 4;
    const up = (Math.max(0, y - 1) * w + x) * 4, down = (Math.min(h - 1, y + 1) * w + x) * 4;
    for (let c = 0; c < 3; c++) energy[i] += Math.abs(data[right + c] - data[left + c]) + Math.abs(data[down + c] - data[up + c]);
    if (protectMask?.[i]) energy[i] += 1e9; // Protection wins when both brushes overlap.
    else if (removeMask?.[i]) energy[i] -= 1e6;
  }
  return energy;
}
/** An exact minimum-cost 8-connected vertical seam; negative mask costs are allowed. */
export function minimumVerticalSeam(energy, width, height) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || energy.length !== width * height || !energy.every(Number.isFinite)) throw new RangeError('Invalid seam energy grid.');
  let previous = Float64Array.from(energy.subarray ? energy.subarray(0, width) : energy.slice(0, width));
  const parent = new Int8Array(width * height);
  for (let y = 1; y < height; y++) {
    const current = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      let best = previous[x], from = x;
      if (x > 0 && previous[x - 1] < best) { best = previous[x - 1]; from = x - 1; }
      if (x + 1 < width && previous[x + 1] < best) { best = previous[x + 1]; from = x + 1; }
      parent[y * width + x] = from - x;
      current[x] = energy[y * width + x] + best;
    }
    previous = current;
  }
  let x = 0;
  for (let i = 1; i < width; i++) if (previous[i] < previous[x]) x = i;
  const cost = previous[x], path = new Int32Array(height);
  for (let y = height - 1; y >= 0; y--) { path[y] = x; x += parent[y * width + x]; }
  return { path, cost };
}
function transposePlane(data, width, height, channels, Type = data.constructor) {
  const result = new Type(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < channels; c++) result[(x * height + y) * channels + c] = data[(y * width + x) * channels + c];
  return result;
}
export function transposeImage(source) {
  return { width: source.height, height: source.width, data: transposePlane(source.data, source.width, source.height, 4) };
}
function removePlane(data, width, height, path, channels) {
  if (!data) return null;
  const output = new data.constructor((width - 1) * height * channels);
  for (let y = 0; y < height; y++) {
    const from = y * width * channels, to = y * (width - 1) * channels, split = path[y] * channels;
    output.set(data.subarray(from, from + split), to);
    output.set(data.subarray(from + split + channels, from + width * channels), to + split);
  }
  return output;
}

/** Shrinks either axis to at least 40% of its source size, width before height.
 * seamMap uses original source coordinates; returned masks use output coordinates.
 */
export function* carve({ source, targetWidth, targetHeight, protectMask = null, removeMask = null } = {}) {
  validate(source);
  const originalWidth = source.width, originalHeight = source.height, size = originalWidth * originalHeight;
  targetWidth ??= Math.round(originalWidth * 0.72); targetHeight ??= originalHeight;
  if (!Number.isInteger(targetWidth) || targetWidth < Math.ceil(originalWidth * 0.4) || targetWidth > originalWidth
    || !Number.isInteger(targetHeight) || targetHeight < Math.ceil(originalHeight * 0.4) || targetHeight > originalHeight) throw new RangeError('Output dimensions must be between 40% and 100% of the source.');
  validateMask(protectMask, size); validateMask(removeMask, size);
  let image = { width: originalWidth, height: originalHeight, data: new Uint8ClampedArray(source.data) };
  let protect = protectMask ? new Uint8Array(protectMask) : null, remove = removeMask ? new Uint8Array(removeMask) : null;
  let indices = Uint32Array.from({ length: size }, (_, i) => i);
  const seamMap = new Uint8Array(size), totalSeams = originalWidth - targetWidth + originalHeight - targetHeight;
  let removed = 0, protectedRemoved = 0, markedRemoved = 0, result, lastSeam = null;
  for (const axis of ['vertical', 'horizontal']) {
    if (axis === 'horizontal') {
      if (targetHeight === originalHeight) break;
      const { width, height } = image;
      indices = transposePlane(indices, width, height, 1);
      if (protect) protect = transposePlane(protect, width, height, 1);
      if (remove) remove = transposePlane(remove, width, height, 1);
      image = transposeImage(image);
    }
    const target = axis === 'vertical' ? targetWidth : targetHeight;
    while (image.width > target) {
      const { width, height } = image, { path, cost } = minimumVerticalSeam(energyMap(image, protect, remove), width, height);
      const originalPixels = new Uint32Array(height);
      for (let y = 0; y < height; y++) {
        const at = y * width + path[y], original = indices[at]; originalPixels[y] = original;
        seamMap[original] = 1;
        if (protect?.[at]) protectedRemoved++;
        if (remove?.[at]) markedRemoved++;
      }
      image = { width: width - 1, height, data: removePlane(image.data, width, height, path, 4) };
      indices = removePlane(indices, width, height, path, 1);
      protect = removePlane(protect, width, height, path, 1); remove = removePlane(remove, width, height, path, 1);
      removed++; lastSeam = { axis, path, originalPixels, cost };
      if (removed % Math.max(1, Math.floor(totalSeams / 24)) === 0 || image.width === target) {
        const frame = axis === 'horizontal' ? transposeImage(image) : image;
        result = { ...frame, data: frame.data.slice(), progress: removed / totalSeams, removed, totalSeams, lastSeam, seamMap: seamMap.slice(), originalWidth, originalHeight, protectedRemoved, markedRemoved };
        yield result;
      }
    }
    if (axis === 'horizontal') {
      const { width, height } = image;
      if (protect) protect = transposePlane(protect, width, height, 1);
      if (remove) remove = transposePlane(remove, width, height, 1);
      image = transposeImage(image);
    }
  }
  result = { ...image, progress: 1, removed, totalSeams, lastSeam, seamMap, originalWidth, originalHeight, protectedRemoved, markedRemoved, protectMask: protect, removeMask: remove };
  if (!totalSeams) yield result;
  return result;
}
