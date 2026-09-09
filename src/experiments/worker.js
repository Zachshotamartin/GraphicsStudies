import { stipple } from "../algorithms/stippling.js";
import { paint } from "../algorithms/painterly.js";
import { carve } from "../algorithms/seam-carving.js";
import { completeImage } from "../algorithms/patchmatch.js";
import { analogize } from "../algorithms/analogies.js";
import { deform } from "../algorithms/deformation.js";
import { growTree } from "../algorithms/trees.js";
import { StableFluid, seedFluid } from "../algorithms/fluids.js";
import { hybrid } from "../algorithms/hybrid.js";
import { toneMap, decodeRadiance, exposurePreview } from "../algorithms/hdr.js";
const methods = {
  stippling: stipple,
  "painterly-rendering": paint,
  "seam-carving": carve,
  patchmatch: completeImage,
  "image-analogies": analogize,
  "tree-growth": growTree,
  "hdr-tone-mapping": toneMap,
};
let fluid = null,
  timer = null,
  paused = false,
  fluidParams = {},
  frame = 0,
  lastFluidTick = 0,
  lastFluidInput = 0;
function fluidFrame() {
  const image = fluid.image();
  postMessage(
    {
      type: "frame",
      result: {
        ...image,
        progress: 1,
        frame: ++frame,
        grid: fluid.grid,
        diagnostics: fluid.diagnostics(),
        params: {
          viscosity: fluid.params.viscosity,
          diffusion: fluid.params.diffusion,
        },
      },
    },
    [image.data.buffer],
  );
}
function loop() {
  if (!fluid || paused) return;
  const started = performance.now();
  try {
    const dt = Math.max(
      1 / 120,
      Math.min(0.05, (started - lastFluidTick) / 1000),
    );
    lastFluidTick = started;
    if (started - lastFluidInput > 2000)
      seedFluid(fluid, fluid.elapsed, {
        seed: fluidParams.seed ?? 42,
        strength: 0.25 * dt * 60,
      });
    fluid.step(dt, fluidParams);
    fluidFrame();
    // Account for solve time and show every computed frame, rather than halving the output cadence.
    timer = setTimeout(
      loop,
      Math.max(0, 1000 / 30 - (performance.now() - started)),
    );
  } catch (error) {
    paused = true;
    clearTimeout(timer);
    postMessage({ type: "error", message: error.message });
  }
}
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "pause" && fluid) {
      paused = !paused;
      clearTimeout(timer);
      if (!paused) {
        lastFluidTick = performance.now() - 1000 / 30;
        loop();
      }
      postMessage({ type: "paused", paused });
      return;
    }
    if (m.type === "params" && fluid) {
      const updates = {};
      for (const key of ["viscosity", "diffusion", "decay", "damping"])
        if (m.params?.[key] !== undefined) updates[key] = m.params[key];
      fluid.step(0, updates);
      fluidParams = { ...fluidParams, ...updates };
      postMessage({
        type: "params",
        params: {
          viscosity: fluid.params.viscosity,
          diffusion: fluid.params.diffusion,
        },
      });
      return;
    }
    if (m.type === "inject" && fluid) {
      // Pointer capture can report locations beyond the canvas while a drag is held.
      const x = Math.max(0, Math.min(1, m.x)),
        y = Math.max(0, Math.min(1, m.y));
      fluid.addForce(x, y, m.vx, m.vy, 0.055);
      fluid.addDye(x, y, m.color, 1.2, 0.055);
      lastFluidInput = performance.now();
      if (paused) fluidFrame();
      return;
    }
    if (m.type !== "run") return;
    const { id, params } = m;
    let result;
    if (id === "stable-fluids") {
      clearTimeout(timer);
      fluidParams = params;
      fluid = new StableFluid(params.mobile ? 64 : 80, {
        ...params,
        dyeResolution: params.mobile ? 128 : 192,
      });
      frame = 0;
      paused = false;
      for (let i = 0; i < 28; i++) {
        seedFluid(fluid, fluid.elapsed, { seed: params.seed ?? 42 });
        fluid.step(1 / 60, params);
      }
      lastFluidInput = performance.now();
      lastFluidTick = lastFluidInput - 1000 / 30;
      fluidFrame();
      loop();
      return;
    }
    if (id === "hdr-tone-mapping" && params.buffer) {
      params.source = decodeRadiance(params.buffer, 384);
      postMessage({
        type: "input",
        image: exposurePreview(params.source, params.exposure),
      });
    }
    if (id === "image-deformation") result = deform(params);
    else if (id === "hybrid-images") result = hybrid(params);
    else {
      const generator = methods[id]?.(params);
      if (!generator) throw new Error("Unknown experiment.");
      let step = generator.next();
      while (!step.done) {
        postMessage({ type: "progress", result: step.value });
        await new Promise((resolve) => setTimeout(resolve, 0));
        step = generator.next();
      }
      result = step.value;
    }
    postMessage({ type: "done", result });
  } catch (error) {
    postMessage({
      type: "error",
      message: error?.message || "The experiment could not finish.",
    });
  }
};
