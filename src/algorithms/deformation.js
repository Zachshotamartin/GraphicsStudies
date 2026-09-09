/** Point-handle moving least squares after Schaefer, McPhail & Warren (2006). */
const EPSILON = 1e-10;

function prepare(handles = [], { mode = 'rigid', alpha = 1 } = {}) {
  if (!['affine', 'similarity', 'rigid'].includes(mode)) throw new RangeError('Unknown deformation mode.');
  if (!Number.isFinite(alpha) || alpha < 0.1 || alpha > 4) throw new RangeError('Weight exponent must be between 0.1 and 4.');
  if (!Array.isArray(handles) || handles.length > 32) throw new RangeError('Use at most 32 handles.');
  const points = [];
  for (const handle of handles) {
    if (!handle || !['from', 'to'].every(key => Array.isArray(handle[key]) && handle[key].length === 2 && handle[key].every(v => Number.isFinite(v) && Math.abs(v) <= 65536))) throw new RangeError('Handles need finite from/to pixel coordinates.');
    const existing = points.find(p => p.from[0] === handle.from[0] && p.from[1] === handle.from[1]);
    if (existing) {
      if (existing.to[0] !== handle.to[0] || existing.to[1] !== handle.to[1]) throw new RangeError('One source pin cannot have two destinations.');
    } else points.push({ from: [...handle.from], to: [...handle.to] });
  }
  const weights = new Float64Array(points.length);
  const mapper = (x, y) => {
    if (!points.length) return [x, y];
    if (points.length === 1) return [x + points[0].to[0] - points[0].from[0], y + points[0].to[1] - points[0].from[1]];
    let closest = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = (points[i].from[0] - x) ** 2 + (points[i].from[1] - y) ** 2;
      if (d < EPSILON) return [...points[i].to];
      weights[i] = d;
      closest = Math.min(closest, d);
    }
    let total = 0, px = 0, py = 0, qx = 0, qy = 0;
    for (let i = 0; i < points.length; i++) {
      // Rescaling every weight by the same factor preserves the least-squares solution.
      const w = (closest / weights[i]) ** alpha;
      weights[i] = w; total += w;
      px += w * points[i].from[0]; py += w * points[i].from[1];
      qx += w * points[i].to[0]; qy += w * points[i].to[1];
    }
    px /= total; py /= total; qx /= total; qy /= total;
    let xx = 0, xy = 0, yy = 0, ux = 0, uy = 0, vx = 0, vy = 0;
    for (let i = 0; i < points.length; i++) {
      const w = weights[i], ax = points[i].from[0] - px, ay = points[i].from[1] - py;
      const bx = points[i].to[0] - qx, by = points[i].to[1] - qy;
      xx += w * ax * ax; xy += w * ax * ay; yy += w * ay * ay;
      ux += w * ax * bx; uy += w * ay * bx;
      vx += w * ax * by; vy += w * ay * by;
    }
    const dx = x - px, dy = y - py, determinant = xx * yy - xy * xy;
    if (mode === 'affine' && determinant > EPSILON * (xx + yy) ** 2) {
      const a = (yy * ux - xy * uy) / determinant;
      const b = (xx * uy - xy * ux) / determinant;
      const c = (yy * vx - xy * vy) / determinant;
      const d = (xx * vy - xy * vx) / determinant;
      return [qx + a * dx + b * dy, qy + c * dx + d * dy];
    }
    // Collinear affine handles have no unique affine solve; use its similarity counterpart.
    const dot = ux + vy, cross = vx - uy;
    const denominator = mode === 'rigid' ? Math.hypot(dot, cross) : xx + yy;
    if (denominator <= EPSILON) return [qx + dx, qy + dy];
    const a = dot / denominator, b = cross / denominator;
    return [qx + a * dx - b * dy, qy + b * dx + a * dy];
  };
  return { mapper, points, mode };
}

/** Evaluate the forward deformation in pixel coordinates. Control points interpolate exactly. */
export function mapPoint(point, handles = [], options = {}) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) throw new RangeError('Point must have two finite coordinates.');
  return prepare(handles, options).mapper(point[0], point[1]);
}

function sample(image, x, y, output, index) {
  x = Math.max(0, Math.min(image.width - 1, x)); y = Math.max(0, Math.min(image.height - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const offsets = [(y0 * image.width + x0) * 4, (y0 * image.width + x1) * 4, (y1 * image.width + x0) * 4, (y1 * image.width + x1) * 4];
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  let alpha = 0;
  for (let i = 0; i < 4; i++) alpha += image.data[offsets[i] + 3] * weights[i];
  output[index + 3] = alpha;
  for (let c = 0; c < 3; c++) {
    let value = 0;
    for (let i = 0; i < 4; i++) value += image.data[offsets[i] + c] * image.data[offsets[i] + 3] * weights[i];
    output[index + c] = alpha > EPSILON ? value / alpha : 0;
  }
}

/**
 * Deform a textured triangular grid using forward MLS, then bilinearly sample its texture.
 * Unlike a swapped-handle inverse approximation this mesh uses the actual forward map.
 * With a free border, uncovered pixels are transparent. A fixed border constrains the
 * perimeter mesh vertices in place; interior vertices still follow MLS.
 * Folded triangles draw in grid order; extreme folds are
 * deliberately not claimed to be injective or physically collision-free.
 */
export function deform({ source, handles = [], mode = 'rigid', alpha = 1, gridStep = 3, boundary = 'free' } = {}) {
  if (!source || !Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 2 || source.height < 2 || source.width > 512 || source.height > 512 || !(source.data instanceof Uint8ClampedArray) || source.data.length !== source.width * source.height * 4) throw new RangeError('Use a 2–512px RGBA image.');
  if (!Number.isInteger(gridStep) || gridStep < 1 || gridStep > 16) throw new RangeError('Grid step must be 1–16 pixels.');
  if (!['free', 'fixed'].includes(boundary)) throw new RangeError('Image boundary must be free or fixed.');
  const { mapper, points } = prepare(handles, { mode, alpha });
  const { width, height } = source;
  const onBorder = (x, y) => x >= 0 && x <= width - 1 && y >= 0 && y <= height - 1 && (Math.abs(x) < EPSILON || Math.abs(y) < EPSILON || Math.abs(x - width + 1) < EPSILON || Math.abs(y - height + 1) < EPSILON);
  if (boundary === 'fixed') {
    for (const point of points) {
      if (onBorder(...point.from) && Math.hypot(point.to[0] - point.from[0], point.to[1] - point.from[1]) > EPSILON) throw new RangeError('A pin on the fixed image border cannot move. Select a pin inside the image or change Image border to free.');
    }
  }
  if (points.every(p => p.from[0] === p.to[0] && p.from[1] === p.to[1])) return { width, height, data: source.data.slice(), mode, boundary, progress: 1, vertices: 0, triangles: 0 };
  const axis = (length, dimension) => {
    const values = new Set([0, length - 1]);
    for (let n = gridStep; n < length - 1; n += gridStep) values.add(n);
    for (const p of points) if (p.from[dimension] > 0 && p.from[dimension] < length - 1) values.add(p.from[dimension]);
    return [...values].sort((a, b) => a - b);
  };
  const xs = axis(width, 0), ys = axis(height, 1);
  // Pin the mesh perimeter itself rather than painting over uncovered corners.
  // Interior vertices (including every interior control pin) retain the actual MLS map.
  const vertices = ys.flatMap(y => xs.map(x => ({ x, y, destination: boundary === 'fixed' && onBorder(x, y) ? [x, y] : mapper(x, y) })));
  const data = new Uint8ClampedArray(width * height * 4);
  const triangle = (a, b, c) => {
    const [ax, ay] = a.destination, [bx, by] = b.destination, [cx, cy] = c.destination;
    const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (!Number.isFinite(area) || Math.abs(area) < EPSILON) return;
    const minX = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), maxX = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.ceil(Math.min(ay, by, cy))), maxY = Math.min(height - 1, Math.floor(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / area;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / area, w = 1 - u - v;
      if (u >= -EPSILON && v >= -EPSILON && w >= -EPSILON) sample(source, u * a.x + v * b.x + w * c.x, u * a.y + v * b.y + w * c.y, data, (y * width + x) * 4);
    }
  };
  for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
    const i = y * xs.length + x;
    triangle(vertices[i], vertices[i + 1], vertices[i + xs.length]);
    triangle(vertices[i + 1], vertices[i + xs.length + 1], vertices[i + xs.length]);
  }
  return { width, height, data, mode, boundary, progress: 1, vertices: vertices.length, triangles: (xs.length - 1) * (ys.length - 1) * 2 };
}
