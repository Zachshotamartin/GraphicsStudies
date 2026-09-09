/**
 * Stable Fluids (Stam, 1999), on a 2D staggered MAC grid.
 * Implicit diffusion, midpoint semi-Lagrangian transport, pressure projection.
 * Velocity is in domain widths/second. Pointer positions/radii are normalized.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function numeric(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be ${min}–${max}.`);
  return value;
}

function readParameters(values = {}) {
  return {
    viscosity: numeric(values.viscosity ?? 0.00004, 0, 0.025, 'Viscosity'),
    diffusion: numeric(values.diffusion ?? 0.000005, 0, 0.025, 'Dye diffusion'),
    decay: numeric(values.decay ?? 0.18, 0, 5, 'Dye decay'),
    damping: numeric(values.damping ?? 0.07, 0, 5, 'Velocity damping'),
    iterations: Math.round(numeric(values.iterations ?? 60, 8, 160, 'Pressure iterations')),
  };
}

function sample(field, width, height, x, y, reflectX = false, reflectY = false) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const value = (sx, sy) => {
    let sign = 1;
    if (sx < 0) { sx = -sx - 1; if (reflectX) sign = -sign; }
    if (sx >= width) { sx = 2 * width - sx - 1; if (reflectX) sign = -sign; }
    if (sy < 0) { sy = -sy - 1; if (reflectY) sign = -sign; }
    if (sy >= height) { sy = 2 * height - sy - 1; if (reflectY) sign = -sign; }
    return field[clamp(sy, 0, height - 1) * width + clamp(sx, 0, width - 1)] * sign;
  };
  return (value(x0, y0) * (1 - tx) + value(x0 + 1, y0) * tx) * (1 - ty)
    + (value(x0, y0 + 1) * (1 - tx) + value(x0 + 1, y0 + 1) * tx) * ty;
}

export class StableFluid {
  constructor(grid = 96, parameters = {}) {
    numeric(grid, 16, 192, 'Fluid grid');
    if (!Number.isInteger(grid)) throw new RangeError('Fluid grid must be an integer.');
    this.grid = grid;
    this.dyeGrid = numeric(parameters.dyeResolution ?? grid, grid, 512, 'Dye resolution');
    if (!Number.isInteger(this.dyeGrid)) throw new RangeError('Dye resolution must be an integer.');
    this.params = readParameters(parameters);
    this.u = new Float32Array((grid + 1) * grid);
    this.v = new Float32Array(grid * (grid + 1));
    this.dye = Array.from({ length: 3 }, () => new Float32Array(this.dyeGrid * this.dyeGrid));
    this.temporaryU = new Float32Array(this.u.length);
    this.temporaryV = new Float32Array(this.v.length);
    this.temporaryDye = new Float32Array(this.dyeGrid * this.dyeGrid);
    this.backtraceX = new Float32Array(this.dyeGrid * this.dyeGrid);
    this.backtraceY = new Float32Array(this.dyeGrid * this.dyeGrid);
    this.pressure = new Float64Array(grid * grid);
    this.rhs = new Float64Array(grid * grid);
    this.residual = new Float64Array(grid * grid);
    this.direction = new Float64Array(grid * grid);
    this.product = new Float64Array(grid * grid);
    this.preconditioned = new Float64Array(grid * grid);
    this.factor = new Float64Array(grid * grid);
    this.forward = new Float64Array(grid * grid);
    // IC(0) preconditioner: retain the grid's lower/left sparse pattern.
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
      const at = y * grid + x;
      let diagonal = (x > 0 ? 1 : 0) + (x < grid - 1 ? 1 : 0) + (y > 0 ? 1 : 0) + (y < grid - 1 ? 1 : 0);
      if (x > 0) diagonal -= 1 / this.factor[at - 1] ** 2;
      if (y > 0) diagonal -= 1 / this.factor[at - grid] ** 2;
      this.factor[at] = Math.sqrt(Math.max(diagonal, 0.001));
    }
    this.elapsed = 0;
    this.projection = { before: 0, after: 0, iterations: 0 };
  }

  reset() {
    for (const array of [this.u, this.v, ...this.dye, this.pressure]) array.fill(0);
    this.elapsed = 0;
    this.projection = { before: 0, after: 0, iterations: 0 };
  }

  addForce(x, y, vx, vy, radius = 0.06) {
    numeric(x, 0, 1, 'Force x'); numeric(y, 0, 1, 'Force y');
    numeric(vx, -20, 20, 'Force velocity x'); numeric(vy, -20, 20, 'Force velocity y');
    numeric(radius, 0.005, 0.4, 'Force radius');
    const n = this.grid;
    const minX = Math.max(0, Math.floor((x - radius) * n));
    const maxX = Math.min(n, Math.ceil((x + radius) * n));
    const minY = Math.max(0, Math.floor((y - radius) * n));
    const maxY = Math.min(n, Math.ceil((y + radius) * n));
    for (let j = minY; j <= maxY; j++) for (let i = minX; i <= maxX; i++) {
      if (i > 0 && i < n && j < n) {
        const d2 = ((i / n - x) ** 2 + ((j + 0.5) / n - y) ** 2) / radius ** 2;
        if (d2 < 1) this.u[j * (n + 1) + i] = clamp(this.u[j * (n + 1) + i] + vx * (1 - d2) ** 2, -8, 8);
      }
      if (j > 0 && j < n && i < n) {
        const d2 = (((i + 0.5) / n - x) ** 2 + (j / n - y) ** 2) / radius ** 2;
        if (d2 < 1) this.v[j * n + i] = clamp(this.v[j * n + i] + vy * (1 - d2) ** 2, -8, 8);
      }
    }
  }

  addDye(x, y, color = [100, 210, 180], amount = 1, radius = 0.045) {
    numeric(x, 0, 1, 'Dye x'); numeric(y, 0, 1, 'Dye y');
    numeric(amount, 0, 12, 'Dye amount'); numeric(radius, 0.005, 0.4, 'Dye radius');
    if (!color || color.length !== 3) throw new RangeError('Dye color needs three RGB channels.');
    const rgb = Array.from(color, (value) => numeric(value, 0, 255, 'Dye color') / 255);
    const n = this.dyeGrid;
    for (let j = Math.max(0, Math.floor((y - radius) * n)); j < Math.min(n, Math.ceil((y + radius) * n)); j++) {
      for (let i = Math.max(0, Math.floor((x - radius) * n)); i < Math.min(n, Math.ceil((x + radius) * n)); i++) {
        const d2 = (((i + 0.5) / n - x) ** 2 + ((j + 0.5) / n - y) ** 2) / radius ** 2;
        if (d2 >= 1) continue;
        const weight = (1 - d2) ** 2 * amount;
        for (let channel = 0; channel < 3; channel++) {
          const at = j * n + i;
          this.dye[channel][at] = Math.min(16, this.dye[channel][at] + rgb[channel] * weight);
        }
      }
    }
  }

  velocityAt(x, y, u = this.u, v = this.v) {
    const n = this.grid;
    return {
      x: sample(u, n + 1, n, clamp(x, 0, 1) * n, clamp(y, 0, 1) * n - 0.5, false, true),
      y: sample(v, n, n + 1, clamp(x, 0, 1) * n - 0.5, clamp(y, 0, 1) * n, true, false),
    };
  }

  _laplacian(input, output) {
    const n = this.grid;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = y * n + x;
      let degree = 0, neighbors = 0;
      if (x > 0) { degree++; neighbors += input[at - 1]; }
      if (x < n - 1) { degree++; neighbors += input[at + 1]; }
      if (y > 0) { degree++; neighbors += input[at - n]; }
      if (y < n - 1) { degree++; neighbors += input[at + n]; }
      output[at] = degree * input[at] - neighbors;
    }
  }

  _precondition() {
    const n = this.grid;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const at = y * n + x;
      let value = this.residual[at];
      if (x > 0) value += this.forward[at - 1] / this.factor[at - 1];
      if (y > 0) value += this.forward[at - n] / this.factor[at - n];
      this.forward[at] = value / this.factor[at];
    }
    for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
      const at = y * n + x;
      let value = this.forward[at];
      if (x < n - 1) value += this.preconditioned[at + 1] / this.factor[at];
      if (y < n - 1) value += this.preconditioned[at + n] / this.factor[at];
      this.preconditioned[at] = value / this.factor[at];
    }
  }

  /** Removes divergence by solving a Neumann pressure system with conjugate gradients. */
  project(iterations = this.params.iterations) {
    numeric(iterations, 1, 200, 'Projection iterations');
    const n = this.grid, size = n * n;
    let mean = 0, before = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const divergence = (this.u[y * (n + 1) + x + 1] - this.u[y * (n + 1) + x]
        + this.v[(y + 1) * n + x] - this.v[y * n + x]) * n;
      const at = y * n + x;
      this.rhs[at] = -divergence / (n * n); mean += this.rhs[at]; before += divergence * divergence;
    }
    mean /= size;
    let rr = 0;
    this.pressure.fill(0);
    for (let i = 0; i < size; i++) {
      this.rhs[i] -= mean;
      this.residual[i] = this.rhs[i];
      rr += this.residual[i] ** 2;
    }
    const initialResidual = rr;
    this._precondition();
    this.direction.set(this.preconditioned);
    let rz = 0;
    for (let i = 0; i < size; i++) rz += this.residual[i] * this.preconditioned[i];
    let performed = 0;
    for (let iteration = 0; iteration < iterations && rr > Math.max(1e-18, initialResidual * 1e-9); iteration++) {
      this._laplacian(this.direction, this.product);
      let denom = 0;
      for (let i = 0; i < size; i++) denom += this.direction[i] * this.product[i];
      if (denom <= 1e-24) break;
      const alpha = rz / denom;
      let next = 0;
      for (let i = 0; i < size; i++) {
        this.pressure[i] += alpha * this.direction[i];
        this.residual[i] -= alpha * this.product[i];
        next += this.residual[i] ** 2;
      }
      this._precondition();
      let nextRz = 0;
      for (let i = 0; i < size; i++) nextRz += this.residual[i] * this.preconditioned[i];
      const beta = nextRz / Math.max(rz, 1e-30);
      for (let i = 0; i < size; i++) this.direction[i] = this.preconditioned[i] + beta * this.direction[i];
      rz = nextRz;
      rr = next; performed++;
    }
    for (let y = 0; y < n; y++) for (let x = 1; x < n; x++) this.u[y * (n + 1) + x] -= n * (this.pressure[y * n + x] - this.pressure[y * n + x - 1]);
    for (let y = 1; y < n; y++) for (let x = 0; x < n; x++) this.v[y * n + x] -= n * (this.pressure[y * n + x] - this.pressure[(y - 1) * n + x]);
    this._walls();
    const after = this.divergence();
    this.projection = { before: Math.sqrt(before / size), after: after.rms, iterations: performed };
    return this.projection;
  }

  _walls() {
    const n = this.grid;
    for (let i = 0; i < n; i++) {
      this.u[i * (n + 1)] = 0; this.u[i * (n + 1) + n] = 0;
      this.v[i] = 0; this.v[n * n + i] = 0;
    }
  }

  _diffuse(field, previous, width, height, amount, axis) {
    if (amount === 0) return;
    previous.set(field);
    const contraction = 4 * amount / (1 + 4 * amount);
    const sweeps = clamp(Math.ceil(Math.log(1e-5) / Math.log(contraction)), 2, 20);
    for (let iteration = 0; iteration < sweeps; iteration++) {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const at = y * width + x;
        if ((axis === 'u' && (x === 0 || x === width - 1)) || (axis === 'v' && (y === 0 || y === height - 1))) {
          field[at] = 0; continue;
        }
        let total = 0, degree = 0;
        if (x > 0) { total += field[at - 1]; degree++; } else if (axis === 'v') degree++;
        if (x < width - 1) { total += field[at + 1]; degree++; } else if (axis === 'v') degree++;
        if (y > 0) { total += field[at - width]; degree++; } else if (axis === 'u') degree++;
        if (y < height - 1) { total += field[at + width]; degree++; } else if (axis === 'u') degree++;
        // A mirrored negative ghost adds another diagonal term at no-slip walls.
        if (axis === 'v' && (x === 0 || x === width - 1)) degree++;
        if (axis === 'u' && (y === 0 || y === height - 1)) degree++;
        field[at] = (previous[at] + amount * total) / (1 + amount * degree);
      }
    }
  }

  _advectVelocity(dt) {
    const n = this.grid, oldU = this.temporaryU, oldV = this.temporaryV;
    oldU.set(this.u); oldV.set(this.v);
    const trace = (x, y) => {
      const a = this.velocityAt(x, y, oldU, oldV);
      const b = this.velocityAt(x - dt * a.x * 0.5, y - dt * a.y * 0.5, oldU, oldV);
      return { x: clamp(x - dt * b.x, 0, 1), y: clamp(y - dt * b.y, 0, 1) };
    };
    for (let y = 0; y < n; y++) for (let x = 1; x < n; x++) {
      const back = trace(x / n, (y + 0.5) / n);
      this.u[y * (n + 1) + x] = sample(oldU, n + 1, n, back.x * n, back.y * n - 0.5, false, true);
    }
    for (let y = 1; y < n; y++) for (let x = 0; x < n; x++) {
      const back = trace((x + 0.5) / n, y / n);
      this.v[y * n + x] = sample(oldV, n, n + 1, back.x * n - 0.5, back.y * n, true, false);
    }
    this._walls();
  }

  _advectDye(dt) {
    const n = this.dyeGrid;
    const decay = Math.exp(-this.params.decay * dt);
    // The same characteristics transport all three color channels.
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const px = (x + 0.5) / n, py = (y + 0.5) / n;
      const a = this.velocityAt(px, py);
      const b = this.velocityAt(px - dt * a.x * 0.5, py - dt * a.y * 0.5);
      this.backtraceX[y * n + x] = clamp(px - dt * b.x, 0.5 / n, 1 - 0.5 / n) * n - 0.5;
      this.backtraceY[y * n + x] = clamp(py - dt * b.y, 0.5 / n, 1 - 0.5 / n) * n - 0.5;
    }
    for (const channel of this.dye) {
      this.temporaryDye.set(channel);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const at = y * n + x;
        channel[at] = Math.max(0, sample(this.temporaryDye, n, n, this.backtraceX[at], this.backtraceY[at]) * decay);
      }
    }
  }

  /** dt in seconds. Large UI frame gaps are capped at 0.15 s and substepped. */
  step(dt = 1 / 60, parameters = {}) {
    numeric(dt, 0, 10, 'Time step');
    this.params = readParameters({ ...this.params, ...parameters });
    if (dt === 0) return this.diagnostics();
    const elapsed = Math.min(dt, 0.15);
    const steps = Math.ceil(elapsed / 0.035), subdt = elapsed / steps;
    const n = this.grid;
    for (let i = 0; i < steps; i++) {
      const amount = this.params.viscosity * subdt * n * n;
      this._diffuse(this.u, this.temporaryU, n + 1, n, amount, 'u');
      this._diffuse(this.v, this.temporaryV, n, n + 1, amount, 'v');
      this.project();
      this._advectVelocity(subdt);
      this.project();
      const damping = Math.exp(-this.params.damping * subdt);
      for (let index = 0; index < this.u.length; index++) this.u[index] *= damping;
      for (let index = 0; index < this.v.length; index++) this.v[index] *= damping;
      for (const channel of this.dye) this._diffuse(channel, this.temporaryDye, this.dyeGrid, this.dyeGrid, this.params.diffusion * subdt * this.dyeGrid ** 2, 'dye');
      this._advectDye(subdt);
    }
    this.elapsed += elapsed;
    return this.diagnostics();
  }

  divergence() {
    const n = this.grid;
    let sum = 0, max = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const value = (this.u[y * (n + 1) + x + 1] - this.u[y * (n + 1) + x]
        + this.v[(y + 1) * n + x] - this.v[y * n + x]) * n;
      sum += value * value; max = Math.max(max, Math.abs(value));
    }
    return { rms: Math.sqrt(sum / (n * n)), max };
  }

  diagnostics() {
    let finite = true, mass = 0, kineticEnergy = 0;
    for (const field of [this.u, this.v]) for (const value of field) { finite &&= Number.isFinite(value); kineticEnergy += value * value; }
    for (const channel of this.dye) for (const value of channel) { finite &&= Number.isFinite(value); mass += value; }
    return { finite, divergence: this.divergence(), projection: { ...this.projection },
      inkMass: mass / (this.dyeGrid * this.dyeGrid), kineticEnergy: kineticEnergy / (2 * this.grid * this.grid), elapsed: this.elapsed };
  }

  image({ background = [13, 23, 27], exposure = 1.9 } = {}) {
    if (!background || background.length !== 3) throw new RangeError('Background needs three RGB channels.');
    for (const value of background) numeric(value, 0, 255, 'Background color');
    numeric(exposure, 0.1, 8, 'Exposure');
    const data = new Uint8ClampedArray(this.dyeGrid * this.dyeGrid * 4);
    for (let at = 0; at < this.dyeGrid * this.dyeGrid; at++) {
      for (let c = 0; c < 3; c++) data[at * 4 + c] = background[c] + (255 - background[c]) * (1 - Math.exp(-this.dye[c][at] * exposure));
      data[at * 4 + 3] = 255;
    }
    return { width: this.dyeGrid, height: this.dyeGrid, data };
  }
}

/** Deterministic, continuous source for the exhibit and its computed example. */
export function seedFluid(fluid, time, { strength = 1, seed = 42 } = {}) {
  numeric(time, 0, 1e8, 'Emitter time'); numeric(strength, 0, 4, 'Emitter strength');
  const phase = (Number(seed) || 0) * 0.037;
  const colors = [[67, 181, 171], [231, 126, 70], [160, 138, 216]];
  for (let emitter = 0; emitter < 3; emitter++) {
    const angle = time * (0.76 + emitter * 0.08) + emitter * Math.PI * 2 / 3 + phase;
    const radius = 0.24 + Math.sin(time * 0.61 + emitter) * 0.055;
    const x = 0.5 + Math.cos(angle) * radius;
    const y = 0.5 + Math.sin(angle) * radius;
    fluid.addForce(x, y, -Math.sin(angle) * 0.11 * strength, Math.cos(angle) * 0.11 * strength, 0.09);
    fluid.addDye(x, y, colors[emitter], 0.26 * strength, 0.055);
  }
}

export function* fluidDemo({ grid = 96, steps = 180, seed = 42, ...parameters } = {}) {
  numeric(steps, 1, 900, 'Demo steps');
  const fluid = new StableFluid(grid, parameters);
  for (let step = 0; step < steps; step++) {
    seedFluid(fluid, step / 60, { seed });
    fluid.step(1 / 60);
    if (step % 12 === 0) yield { ...fluid.image(), progress: step / steps, diagnostics: fluid.diagnostics() };
  }
  return { ...fluid.image(), progress: 1, diagnostics: fluid.diagnostics() };
}
