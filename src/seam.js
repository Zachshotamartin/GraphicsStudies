/** Exact top-to-bottom minimum-cost path with 8-connected steps. */
export function minimumErrorCut(cost, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || cost.length !== width * height) throw new RangeError('Invalid error map dimensions');
  const cumulative = new Float64Array(cost.length);
  const parent = new Int32Array(cost.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!Number.isFinite(cost[i]) || cost[i] < 0) throw new RangeError('Error costs must be finite and nonnegative');
    let best = x;
    if (y) {
      const previous = (y - 1) * width;
      for (let candidate = Math.max(0, x - 1); candidate <= Math.min(width - 1, x + 1); candidate++) {
        if (cumulative[previous + candidate] < cumulative[previous + best]) best = candidate;
      }
      cumulative[i] = cost[i] + cumulative[previous + best];
    } else cumulative[i] = cost[i];
    parent[i] = best;
  }
  let x = 0;
  const last = (height - 1) * width;
  for (let i = 1; i < width; i++) if (cumulative[last + i] < cumulative[last + x]) x = i;
  const total = cumulative[last + x];
  const path = new Int32Array(height);
  for (let y = height - 1; y >= 0; y--) { path[y] = x; x = parent[y * width + x]; }
  return { path, cost: total };
}
