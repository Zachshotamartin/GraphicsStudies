/** Normalized sample annotations shared by the live lab and reproducible exports. */
export function sampleMask(source, regions = []) {
  const { width, height } = source, mask = new Uint8Array(width * height);
  for (const [left, top, right, bottom] of regions) {
    for (let y = Math.max(0, Math.floor(top * height)); y < Math.min(height, Math.ceil(bottom * height)); y++) {
      for (let x = Math.max(0, Math.floor(left * width)); x < Math.min(width, Math.ceil(right * width)); x++) mask[y * width + x] = 1;
    }
  }
  return mask;
}
export function sampleHandles(source, pins = null) {
  return (pins ?? [[.18,.18],[.82,.18],[.18,.82],[.82,.82],[.5,.5]]).map(([x,y]) => ({
    from: [x * (source.width - 1), y * (source.height - 1)],
    to: [x * (source.width - 1), y * (source.height - 1)],
  }));
}
