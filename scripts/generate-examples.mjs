// Reproduce each published result with the same browser-compatible algorithm modules.
// Start `npm start`, then set PLAYWRIGHT_IMPORT if Playwright is installed elsewhere.
import fs from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_IMPORT || "@playwright/test"
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(
  process.env.STUDIES_URL || "http://127.0.0.1:5182/?study=quilting",
);
const records = await page.evaluate(async () => {
  const { experiments } = await import("/src/experiments/catalog.js");
  const { drawTree, drawImage } = await import("/src/experiments/render.js");
  const { stipple } = await import("/src/algorithms/stippling.js"),
    { paint } = await import("/src/algorithms/painterly.js"),
    { carve } = await import("/src/algorithms/seam-carving.js"),
    { completeImage } = await import("/src/algorithms/patchmatch.js"),
    { deform } = await import("/src/algorithms/deformation.js"),
    { analogize } = await import("/src/algorithms/analogies.js"),
    { growTree } = await import("/src/algorithms/trees.js"),
    { fluidDemo } = await import("/src/algorithms/fluids.js"),
    { hybrid } = await import("/src/algorithms/hybrid.js"),
    { decodeRadiance, toneMap, exposurePreview } = await import(
      "/src/algorithms/hdr.js"
    );
  const final = (g) => {
    let step;
    do {
      step = g.next();
    } while (!step.done);
    return step.value;
  };
  const read = async (name, size) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`/web/assets/${name}.webp`)).blob(),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(
      (bitmap.width / Math.max(bitmap.width, bitmap.height)) * size,
    );
    canvas.height = Math.round(
      (bitmap.height / Math.max(bitmap.width, bitmap.height)) * size,
    );
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return {
      width: canvas.width,
      height: canvas.height,
      data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    };
  };
  const output = [],
    encode = (name, result, params = {}) => {
      const canvas = document.createElement("canvas");
      if (result.nodes) drawTree(canvas, result);
      else drawImage(canvas, result);
      output.push({
        name,
        width: canvas.width,
        height: canvas.height,
        params,
        png: canvas.toDataURL("image/png").split(",")[1],
        webp: canvas.toDataURL("image/webp", 0.94).split(",")[1],
      });
    };
  const harbor = await read("harbor", 384),
    painted = final(
      paint({ source: harbor, brushSize: 12, detail: 0.65, seed: 42 }),
    );
  encode("harbor-painted", painted, { brushSize: 12, detail: 0.65, seed: 42 });
  for (const s of experiments) {
    const params = Object.fromEntries(s.controls.map((c) => [c.key, c.value])),
      source =
        s.source && s.source !== "lebombo"
          ? await read(s.source, s.size)
          : null;
    let result;
    if (s.id === "stippling") result = final(stipple({ ...params, source }));
    if (s.id === "painterly-rendering") result = painted;
    if (s.id === "seam-carving")
      result = final(
        carve({
          source,
          targetWidth: Math.round(source.width * params.widthRatio),
        }),
      );
    if (s.id === "patchmatch") {
      const mask = new Uint8Array(source.width * source.height);
      for (
        let y = Math.floor(source.height * 0.6);
        y < source.height * 0.7;
        y++
      )
        for (
          let x = Math.floor(source.width * 0.744);
          x < source.width * 0.792;
          x++
        )
          mask[y * source.width + x] = 1;
      result = final(completeImage({ ...params, source, mask }));
    }
    if (s.id === "image-deformation") {
      const handles = [
        [0.18, 0.18],
        [0.82, 0.18],
        [0.18, 0.82],
        [0.82, 0.82],
        [0.5, 0.5],
      ].map(([x, y]) => ({
        from: [x * source.width, y * source.height],
        to: [x * source.width, y * source.height],
      }));
      handles[4].to[0] += 0.12 * source.width;
      handles[4].to[1] -= 0.07 * source.height;
      result = deform({ ...params, source, handles });
    }
    if (s.id === "tree-growth") {
      result = final(growTree(params));
      encode(
        `${s.id}-alternate`,
        final(growTree({ ...params, canopy: "spreading", seed: 17 })),
        { ...params, canopy: "spreading", seed: 17 },
      );
    }
    if (s.id === "stable-fluids") {
      result = final(
        fluidDemo({
          ...params,
          grid: 80,
          dyeResolution: 256,
          steps: 110,
          seed: 42,
        }),
      );
      encode(
        `${s.id}-alternate`,
        final(
          fluidDemo({
            ...params,
            grid: 80,
            dyeResolution: 256,
            steps: 180,
            seed: 17,
          }),
        ),
        { grid: 80, steps: 180, seed: 17 },
      );
    }
    if (s.id === "hybrid-images")
      result = hybrid({
        ...params,
        source,
        other: await read("owl", s.size),
        alignment: {
          x: params.alignX,
          y: params.alignY,
          scale: params.alignScale,
        },
      });
    if (s.id === "hdr-tone-mapping") {
      const hdr = decodeRadiance(
        await (await fetch("/web/assets/lebombo.hdr")).arrayBuffer(),
        384,
      );
      encode("hdr-exposure", exposurePreview(hdr), { exposure: 0 });
      result = final(toneMap({ ...params, source: hdr }));
    }
    if (s.id === "image-analogies") {
      const c = document.createElement("canvas");
      c.width = source.width;
      c.height = source.height;
      const big = document.createElement("canvas");
      drawImage(big, painted);
      const ctx = c.getContext("2d");
      ctx.drawImage(big, 0, 0, c.width, c.height);
      const filtered = {
        width: c.width,
        height: c.height,
        data: ctx.getImageData(0, 0, c.width, c.height).data,
      };
      result = final(
        analogize({
          ...params,
          source,
          filtered,
          target: await read("landscape", s.size),
        }),
      );
    }
    encode(`${s.id}-result`, result, { ...params, size: s.size });
  }
  return output;
});
const assets = new URL("../web/assets/", import.meta.url);
for (const { name, png, webp, ...meta } of records) {
  await fs.writeFile(
    new URL(`${name}.png`, assets),
    Buffer.from(png, "base64"),
  );
  await fs.writeFile(
    new URL(`${name}.webp`, assets),
    Buffer.from(webp, "base64"),
  );
  console.log(name, `${meta.width}x${meta.height}`);
}
await fs.writeFile(
  new URL("experiment-examples.json", assets),
  JSON.stringify(
    {
      generatedBy: "scripts/generate-examples.mjs",
      examples: records.map(({ png, webp, ...data }) => data),
    },
    null,
    2,
  ) + "\n",
);
await browser.close();
