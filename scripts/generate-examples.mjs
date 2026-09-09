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
  const { sampleMask, sampleHandles } = await import("/src/experiments/sample-inputs.js");
  const { engraveExample } = await import("/src/algorithms/engraving-example.js");
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
  const overlay = (source,mask,color) => {
    const data = source.data.slice();
    for (let i=0;i<mask.length;i++) if(mask[i]) for(let c=0;c<3;c++) data[i*4+c]=data[i*4+c]*.5+color[c]*.5;
    return {width:source.width,height:source.height,data};
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
  for (const s of experiments) {
    const params = Object.fromEntries(s.controls.map((c) => [c.key, c.value])),
      source =
        s.source && s.source !== "lebombo"
          ? await read(s.source, s.size)
          : null;
    let result;
    let resultParams = { ...params, size: s.size, ...(s.source ? {source:s.source} : {}), ...(s.other ? {other:s.other} : {}) };
    if (s.id === "stippling") result = final(stipple({ ...params, source }));
    if (s.id === "painterly-rendering") result = final(paint({ ...params, source }));
    if (s.id === "seam-carving") {
      const protectMask = sampleMask(source, s.protectRegions);
      const targetWidth = Math.round(source.width * params.widthRatio);
      result = final(carve({ source, targetWidth, protectMask }));
      resultParams = { ...resultParams, source: s.source, protectRegions: s.protectRegions, targetWidth };
      const original = document.createElement("canvas"), resized = document.createElement("canvas");
      drawImage(original, source);
      resized.width = targetWidth; resized.height = source.height;
      const ctx = resized.getContext("2d"); ctx.drawImage(original,0,0,targetWidth,source.height);
      encode(`${s.id}-resized`, { width: targetWidth, height: source.height, data:ctx.getImageData(0,0,targetWidth,source.height).data }, { method:"uniform resize", source:s.source,targetWidth });
      encode(`${s.id}-mask`, overlay(source, protectMask, [118,205,125]), { source:s.source,protectRegions:s.protectRegions });
    }
    if (s.id === "patchmatch") {
      const mask = sampleMask(source, s.maskRegions);
      result = final(completeImage({ ...params, source, mask }));
      resultParams = { ...resultParams, source:s.source,maskRegions:s.maskRegions };
      encode(`${s.id}-mask`, overlay(source,mask,[244,125,103]), { source:s.source,maskRegions:s.maskRegions });
    }
    if (s.id === "image-deformation") {
      const handles = sampleHandles(source,s.pins);
      handles[s.examplePin.index].to = s.examplePin.to.map((v,i)=>v*([source.width,source.height][i]-1));
      result = deform({ ...params, source, handles });
      resultParams = { ...resultParams,source:s.source,handles };
    }
    if (s.id === "tree-growth") {
      resultParams = {
        seed: 42,
        count: params.count,
        canopy: "round",
        width: 1.55,
        height: 2,
        trunkHeight: 0.52,
        segmentLength: 0.055,
        influenceRadius: 0.28,
        killRadius: 0.095,
        iterations: 180,
        tropism: 0.045,
        leaves: true,
        obstacles: [],
      };
      result = final(growTree(resultParams));
      const obstructedParams = {
        ...resultParams,
        obstacles: [{ x: 0.35, y: 1.2, z: 0, r: 0.3 }],
      };
      encode(
        `${s.id}-alternate`,
        final(growTree(obstructedParams)),
        obstructedParams,
      );
    }
    if (s.id === "stable-fluids") {
      resultParams = {
        grid: 80,
        dyeResolution: 256,
        steps: 110,
        seed: 42,
        viscosity: 0.0001,
        diffusion: 0,
        decay: 0.18,
        damping: 0.07,
        iterations: 60,
      };
      result = final(fluidDemo(resultParams));
      const viscousParams = { ...resultParams, viscosity: 0.003 };
      encode(
        `${s.id}-alternate`,
        final(fluidDemo(viscousParams)),
        viscousParams,
      );
    }
    if (s.id === "hybrid-images")
      result = hybrid({
        ...params,
        source,
        other: await read(s.other, s.size),
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
      const filtered = engraveExample({ source });
      encode(s.filtered,filtered,{source:s.source,preparation:"registered Sobel contours and tone-controlled hatching"});
      result = final(analogize({ ...params, source, filtered, target:await read(s.other,s.size) }));
      resultParams = { ...resultParams,source:s.source,filtered:s.filtered,target:s.other };
    }
    encode(`${s.id}-result`, result, resultParams);
  }
  const { synthesize } = await import("/src/quilting.js");
  for (const [name, texture, isTransfer] of [["transfer-fabric-result","transfer-fabric",true],["quilting-slate-result","quilting-slate",false]]) {
    const source = await read(texture,256), target = isTransfer ? await read("bust",256) : undefined;
    const options = isTransfer ? {size:256,patchSize:36,overlap:6,candidateCount:384,structure:.75,passes:3,seed:"42",method:"cut"} : {size:1024,patchSize:240,overlap:41,candidateCount:384,passes:1,seed:"42",method:"cut"};
    const result = await synthesize({...options,source,target});
    encode(name,result,{...options,source:texture,...(isTransfer?{target:"bust"}:{})});
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
