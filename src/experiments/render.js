export function drawImage(canvas, image) {
  if (!image?.data) return;
  canvas.width = image.width;
  canvas.height = image.height;
  canvas
    .getContext("2d")
    .putImageData(
      new ImageData(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height,
      ),
      0,
      0,
    );
}
export function drawTree(
  canvas,
  tree,
  { yaw = 0.5, pitch = 0.25, attractors = false, skeleton = false } = {},
) {
  canvas.width = 720;
  canvas.height = 620;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#142420";
  ctx.fillRect(0, 0, 720, 620);
  const scale = 220,
    cosYaw = Math.cos(yaw),
    sinYaw = Math.sin(yaw),
    cosPitch = Math.cos(pitch),
    sinPitch = Math.sin(pitch);
  const project = (p) => {
    const x = p.x * cosYaw + p.z * sinYaw,
      z = -p.x * sinYaw + p.z * cosYaw,
      y = p.y - 1;
    return {
      x: 360 + x * scale,
      y: 330 - (y * cosPitch - z * sinPitch) * scale,
      z: y * sinPitch + z * cosPitch,
    };
  };
  const root = project({ x: 0, y: 0, z: 0 }),
    shadowRadius = Math.min(160, (tree.width || 1.55) * scale * 0.43);
  ctx.fillStyle = "#1d322a";
  ctx.beginPath();
  ctx.ellipse(
    root.x,
    root.y,
    shadowRadius,
    Math.max(2, shadowRadius * Math.abs(sinPitch)),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  const parts = [];
  for (const node of tree.nodes) {
    if (node.parent < 0) continue;
    const parent = tree.nodes[node.parent],
      a = project(parent),
      b = project(node);
    parts.push({
      kind: "branch",
      node,
      parent,
      a,
      b,
      depth: (a.z + b.z) * 0.5,
    });
  }
  if (!skeleton)
    for (const leaf of tree.leaves || []) {
      const p = project(leaf),
        angle = leaf.angle || 0,
        tilt = leaf.tilt || 0,
        length = (leaf.scale || 0.035) * 0.9;
      const long = {
        x: Math.cos(angle) * Math.cos(tilt) * length,
        y: Math.sin(tilt) * length,
        z: Math.sin(angle) * Math.cos(tilt) * length,
      };
      const cross = {
        x: -Math.sin(angle) * length * 0.42,
        y: 0,
        z: Math.cos(angle) * length * 0.42,
      };
      const a = project({
        x: leaf.x + long.x,
        y: leaf.y + long.y,
        z: leaf.z + long.z,
      });
      const b = project({
        x: leaf.x + cross.x,
        y: leaf.y + cross.y,
        z: leaf.z + cross.z,
      });
      parts.push({ kind: "leaf", leaf, p, a, b, depth: p.z });
    }
  for (const obstacle of tree.obstacles || []) {
    const p = project(obstacle);
    parts.push({ kind: "volume", p, radius: obstacle.r * scale, depth: p.z });
    // Three actual world-space great circles expose the exclusion sphere from every orbit.
    for (let plane = 0; plane < 3; plane++)
      for (let i = 0; i < 64; i++) {
        const point = (t) => {
          const c = Math.cos(t) * obstacle.r,
            s = Math.sin(t) * obstacle.r;
          return project({
            x: obstacle.x + (plane === 2 ? 0 : c),
            y: obstacle.y + (plane === 0 ? 0 : plane === 1 ? s : c),
            z: obstacle.z + (plane === 0 ? s : plane === 1 ? 0 : s),
          });
        };
        const a = point((i * Math.PI) / 32),
          b = point(((i + 1) * Math.PI) / 32);
        parts.push({ kind: "ring", a, b, depth: (a.z + b.z) * 0.5 });
      }
  }
  if (attractors)
    for (const point of tree.attractors || []) {
      const p = project(point);
      parts.push({ kind: "point", p, depth: p.z });
    }
  // Sorting every visible primitive together prevents rear foliage from covering a front branch.
  parts.sort((a, b) => a.depth - b.depth);
  ctx.lineCap = "round";
  for (const part of parts) {
    if (part.kind === "branch") {
      const { node, parent, a, b } = part;
      ctx.fillStyle = ctx.strokeStyle = skeleton
        ? "#c5d6b5"
        : `hsl(30 24% ${Math.max(29, Math.min(60, 38 + node.y * 5 + (node.x - node.z) * 6))}%)`;
      if (skeleton) {
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        continue;
      }
      const length = Math.hypot(b.x - a.x, b.y - a.y),
        nx = length ? (b.y - a.y) / length : 1,
        ny = length ? -(b.x - a.x) / length : 0;
      const r1 = Math.max(0.65, parent.radius * scale),
        r2 = Math.max(0.65, node.radius * scale);
      ctx.beginPath();
      ctx.moveTo(a.x + nx * r1, a.y + ny * r1);
      ctx.lineTo(b.x + nx * r2, b.y + ny * r2);
      ctx.lineTo(b.x - nx * r2, b.y - ny * r2);
      ctx.lineTo(a.x - nx * r1, a.y - ny * r1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(a.x, a.y, r1, 0, Math.PI * 2);
      ctx.arc(b.x, b.y, r2, 0, Math.PI * 2);
      ctx.fill();
    } else if (part.kind === "leaf") {
      const { leaf, p, a, b } = part;
      ctx.fillStyle = `hsl(${86 + (leaf.tone ?? 0.5) * 22} 30% ${42 + (leaf.tone ?? 0.5) * 17}%)`;
      ctx.save();
      ctx.transform(a.x - p.x, a.y - p.y, b.x - p.x, b.y - p.y, p.x, p.y);
      ctx.beginPath();
      ctx.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (part.kind === "volume") {
      ctx.fillStyle = "rgba(222,166,120,.045)";
      ctx.beginPath();
      ctx.arc(part.p.x, part.p.y, part.radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (part.kind === "ring") {
      ctx.strokeStyle = "rgba(232,177,131,.65)";
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(part.a.x, part.a.y);
      ctx.lineTo(part.b.x, part.b.y);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#dc9c78";
      ctx.fillRect(part.p.x - 1, part.p.y - 1, 2, 2);
    }
  }
  if (tree.obstacles?.length) {
    ctx.font = "13px ui-monospace,monospace";
    ctx.fillStyle = "#d9af8a";
    ctx.fillText("Wireframe sphere · excluded growth volume", 24, 598);
  }
}
export function svgStipples(result) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${result.width} ${result.height}" width="${result.width}" height="${result.height}"><rect width="100%" height="100%" fill="#f5f3e7"/><g fill="#1b2c28">${result.points.map((p) => `<circle cx="${p.x.toFixed(3)}" cy="${p.y.toFixed(3)}" r="${p.r.toFixed(3)}"/>`).join("")}</g></svg>`;
}
export function drawStroke(ctx, stroke) {
  const points = stroke.points;
  if (!points?.length) return;
  ctx.strokeStyle = `rgb(${stroke.color.slice(0, 3).join(",")})`;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = stroke.radius * 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
  if (points.length > 1) ctx.stroke();
  else {
    ctx.arc(...points[0], stroke.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
