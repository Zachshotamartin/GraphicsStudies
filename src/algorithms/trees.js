/** Seeded 3D space colonization after Runions, Lane & Prusinkiewicz (2007). */
function randomFrom(seed) {
  let state = 2166136261;
  for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ state >>> 15, state | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function bounded(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${label} must be ${min}–${max}.`);
  return value;
}

const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
const key = (x, y, z) => `${x},${y},${z}`;

function makeHash(nodes, size) {
  const cells = new Map();
  const insert = (index) => {
    const p = nodes[index];
    const cell = key(Math.floor(p.x / size), Math.floor(p.y / size), Math.floor(p.z / size));
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push(index);
  };
  for (let i = 0; i < nodes.length; i++) insert(i);
  return {
    insert,
    nearest(point, radius) {
      let best = radius * radius, found = -1;
      const x = Math.floor(point.x / size), y = Math.floor(point.y / size), z = Math.floor(point.z / size);
      const reach = Math.ceil(radius / size);
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            for (const index of cells.get(key(x + dx, y + dy, z + dz)) || []) {
              const d = distance2(point, nodes[index]);
              if (d < best) { best = d; found = index; }
            }
          }
        }
      }
      return { index: found, distance: Math.sqrt(best) };
    },
  };
}

/** Segment/sphere test used for every branch, including the initial trunk. */
function segmentClear(a, b, obstacles, clearance = 0.015) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const length2 = dx * dx + dy * dy + dz * dz;
  return obstacles.every((o) => {
    const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.y - a.y) * dy + (o.z - a.z) * dz) / Math.max(length2, 1e-12)));
    return distance2(o, { x: a.x + t * dx, y: a.y + t * dy, z: a.z + t * dz }) >= (o.r + clearance) ** 2;
  });
}

function normalize(x, y, z) {
  const d = Math.hypot(x, y, z);
  return d > 1e-9 ? { x: x / d, y: y / d, z: z / d } : { x: 0, y: 1, z: 0 };
}

/**
 * Coordinates are Y-up. Root is [0,0,0]; default height 2, width 1.55.
 * 'round', 'spreading', 'columnar', and 'conical' are distinct attraction volumes.
 * Obstacles are spheres {x,y,z,r}. Returned graph is immutable per snapshot.
 * A completed run can leave inaccessible attractors; completion is not a claim
 * that all growth targets were reached.
 */
export function* growTree({ seed = 42, count = 1200, width = 1.55, height = 2,
  canopy = 'round', trunkHeight = 0.52, segmentLength = 0.055,
  influenceRadius = 0.28, killRadius = 0.095, iterations = 180,
  tropism = 0.045, obstacles = [], leaves = true } = {}) {
  bounded(count, 32, 5000, 'Attraction point count');
  if (!Number.isInteger(count)) throw new RangeError('Attraction point count must be an integer.');
  bounded(width, 0.4, 3, 'Canopy width');
  bounded(height, 0.8, 3, 'Tree height');
  bounded(trunkHeight, 0.1, height * 0.75, 'Trunk height');
  bounded(segmentLength, 0.025, 0.15, 'Segment length');
  bounded(influenceRadius, segmentLength * 1.5, 1, 'Influence radius');
  bounded(killRadius, segmentLength * 0.7, influenceRadius * 0.8, 'Kill radius');
  bounded(iterations, 10, 400, 'Iterations');
  bounded(tropism, -0.25, 0.35, 'Upward tropism');
  if (!Number.isInteger(iterations)) throw new RangeError('Iterations must be an integer.');
  if (!['round', 'spreading', 'columnar', 'conical'].includes(canopy)) throw new RangeError('Unknown canopy shape.');
  if (!Array.isArray(obstacles) || obstacles.length > 16) throw new RangeError('Use up to 16 spherical obstacles.');
  obstacles = obstacles.map((o) => ({
    x: bounded(o.x, -4, 4, 'Obstacle x'), y: bounded(o.y, -1, 4, 'Obstacle y'),
    z: bounded(o.z, -4, 4, 'Obstacle z'), r: bounded(o.r, 0.01, 2, 'Obstacle radius'),
  }));
  if (obstacles.some((o) => Math.hypot(o.x, o.y, o.z) < o.r + 0.025)) throw new RangeError('An obstacle covers the tree root.');
  const random = randomFrom(seed);
  const crownBottom = canopy === 'spreading' ? trunkHeight + (height - trunkHeight) * 0.22 : trunkHeight;
  const centerY = (crownBottom + height) / 2;
  const radiusY = (height - crownBottom) / 2;
  const radiusX = width * (canopy === 'columnar' ? 0.30 : 0.50);
  const radiusZ = radiusX * (canopy === 'spreading' ? 0.82 : 1);
  const inCanopy = (p) => {
    const yn = (p.y - centerY) / radiusY;
    if (yn < -1 || yn > 1) return false;
    if (canopy === 'conical') {
      const taper = 0.08 + 0.92 * (height - p.y) / (height - crownBottom);
      return (p.x / (radiusX * taper)) ** 2 + (p.z / (radiusZ * taper)) ** 2 <= 1;
    }
    // Columnar crowns have rounded ends, rather than cylindrical flat caps.
    const exponent = canopy === 'columnar' ? 4 : 2;
    return (p.x / radiusX) ** 2 + (p.z / radiusZ) ** 2 + Math.abs(yn) ** exponent <= 1;
  };
  const attractors = [];
  for (let attempt = 0; attractors.length < count && attempt < count * 80; attempt++) {
    const p = { x: (random() * 2 - 1) * radiusX, y: crownBottom + random() * (height - crownBottom), z: (random() * 2 - 1) * radiusZ, alive: true };
    if (inCanopy(p) && obstacles.every((o) => distance2(p, o) > (o.r + 0.035) ** 2)) attractors.push(p);
  }
  if (attractors.length < 16) throw new RangeError('The obstacles leave too little space for a canopy.');
  const nodes = [{ x: 0, y: 0, z: 0, parent: -1, radius: 0.012 }];
  const directions = [{ x: 0, y: 1, z: 0 }];
  const total = attractors.length;
  let consumed = 0, iteration = 0, stopped = false;
  const snapshot = (progress, complete = false) => {
    const childCounts = new Uint16Array(nodes.length);
    const area = new Float64Array(nodes.length);
    for (let i = 1; i < nodes.length; i++) childCounts[nodes[i].parent]++;
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (childCounts[i] === 0) area[i] = 1;
      if (nodes[i].parent >= 0) area[nodes[i].parent] += area[i];
    }
    const maxRadius = 0.065;
    const rootArea = Math.max(1, area[0]);
    const graph = nodes.map((node, i) => ({ ...node, radius: Math.max(0.003, maxRadius * Math.sqrt(area[i] / rootArea)) }));
    const foliage = [];
    const leafRandom = randomFrom(`${seed}:leaves`);
    if (leaves) for (let i = 1; i < graph.length; i++) {
      if (childCounts[i] > 1 || graph[i].y < crownBottom + 0.09) continue;
      const amount = childCounts[i] === 0 ? 4 : 1;
      for (let j = 0; j < amount; j++) {
        const angle = leafRandom() * Math.PI * 2;
        const offset = 0.018 + leafRandom() * 0.025;
        const leaf = { x: graph[i].x + Math.cos(angle) * offset, y: graph[i].y + (leafRandom() - 0.2) * 0.035,
          z: graph[i].z + Math.sin(angle) * offset, angle, tilt: (leafRandom() - 0.5) * 1.6,
          scale: 0.028 + leafRandom() * 0.018, tone: leafRandom(), node: i };
        if (obstacles.every((o) => distance2(leaf, o) > (o.r + leaf.scale) ** 2)) foliage.push(leaf);
      }
    }
    return { nodes: graph, leaves: foliage, attractors: attractors.filter((a) => a.alive).map(({ x, y, z }) => ({ x, y, z })),
      progress, iteration, consumed, total, complete, exhausted: consumed === total,
      canopy, width, height, obstacles: obstacles.map((o) => ({ ...o })) };
  };
  // Establish a connected trunk until some targets can influence the growing tip.
  for (let step = 0; step < Math.ceil(height / segmentLength); step++) {
    const tip = nodes[nodes.length - 1];
    if (attractors.some((a) => distance2(a, tip) < influenceRadius ** 2)) break;
    const next = { x: tip.x, y: tip.y + segmentLength, z: tip.z, parent: nodes.length - 1, radius: 0.01 };
    if (!segmentClear(tip, next, obstacles, maxBranchClearance())) { stopped = true; break; }
    nodes.push(next); directions.push({ x: 0, y: 1, z: 0 });
  }
  function maxBranchClearance() { return 0.07; }
  yield snapshot(0);
  while (iteration < iterations && consumed < total && !stopped && nodes.length < 12000) {
    iteration++;
    const hash = makeHash(nodes, influenceRadius);
    const sums = new Map();
    for (const point of attractors) {
      if (!point.alive) continue;
      const near = hash.nearest(point, influenceRadius);
      if (near.index < 0) continue;
      if (near.distance <= killRadius) { point.alive = false; consumed++; continue; }
      if (!sums.has(near.index)) sums.set(near.index, { x: 0, y: 0, z: 0, count: 0 });
      const sum = sums.get(near.index), node = nodes[near.index];
      const dir = normalize(point.x - node.x, point.y - node.y, point.z - node.z);
      sum.x += dir.x; sum.y += dir.y; sum.z += dir.z; sum.count++;
    }
    let grown = 0;
    for (const [parent, sum] of sums) {
      const node = nodes[parent], previous = directions[parent];
      let dx = sum.x / sum.count + previous.x * 0.16;
      let dy = sum.y / sum.count + previous.y * 0.16 + tropism;
      let dz = sum.z / sum.count + previous.z * 0.16;
      // Near an obstacle, turn the growth direction outward before collision testing.
      for (const obstacle of obstacles) {
        const distance = Math.sqrt(distance2(node, obstacle));
        const reach = obstacle.r + influenceRadius * 0.65 + 0.07;
        if (distance < reach) {
          const outward = normalize(node.x - obstacle.x, node.y - obstacle.y, node.z - obstacle.z);
          const strength = 1.3 * (reach - distance) / (reach - obstacle.r);
          dx += outward.x * strength; dy += outward.y * strength; dz += outward.z * strength;
        }
      }
      const dir = normalize(dx, dy, dz);
      const next = { x: node.x + dir.x * segmentLength, y: node.y + dir.y * segmentLength,
        z: node.z + dir.z * segmentLength, parent, radius: 0.004 };
      if (next.y <= 0 || next.y > height + segmentLength || Math.abs(next.x) > radiusX + segmentLength || Math.abs(next.z) > radiusZ + segmentLength) continue;
      if (!segmentClear(node, next, obstacles, maxBranchClearance())) continue;
      // Avoid growing a duplicate segment every iteration from an already-used junction.
      if (hash.nearest(next, segmentLength * 0.66).index >= 0) continue;
      nodes.push(next); directions.push(dir); hash.insert(nodes.length - 1); grown++;
    }
    if (grown === 0) stopped = true;
    if (iteration % 4 === 0 || stopped || consumed === total) yield snapshot(Math.min(0.99, iteration / iterations));
  }
  return snapshot(1, true);
}
