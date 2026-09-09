import { getExperiment } from "./catalog.js";
import { sampleMask, sampleHandles } from "./sample-inputs.js";
import { drawImage, drawTree, svgStipples, drawStroke } from "./render.js";
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const sourceName = (study) =>
  study.source === "lebombo" ? "hdr-exposure" : study.source;
export function experimentMarkup({ id, assetsBase = "/assets/studies" } = {}) {
  const s = getExperiment(id);
  if (!s) throw new Error("Unknown study.");
  const controls = s.controls
    .map(
      (c) =>
        `<label>${escape(c.label)}${c.values ? `<select data-param="${c.key}">${c.values.map((v) => `<option ${v === c.value ? "selected" : ""}>${escape(v)}</option>`).join("")}</select>` : `<output data-value="${c.key}">${c.value}</output><input data-param="${c.key}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}">`}</label>`,
    )
    .join("");
  const source = s.source
    ? `<figure><div class="experiment-lab__surface"><img data-input-preview src="${assetsBase}/${sourceName(s)}.webp" alt="${s.id === "image-analogies" ? "A · source photograph" : "Source image"}"><canvas data-input hidden aria-label="Source image ${["patchmatch", "seam-carving"].includes(id) ? "mask editor" : ""}"></canvas></div><figcaption data-source-caption>${s.id === "image-analogies" ? "A · source photograph" : s.id === "hdr-tone-mapping" ? "Plain exposure · HDR source" : s.id === "hybrid-images" ? "First image · low-frequency source" : "Source image"}</figcaption></figure>`
    : "";
  const upload = s.source
    ? `<label>${id === "hdr-tone-mapping" ? "Upload HDR source" : id === "image-analogies" ? "Upload A" : "Upload source"}<input data-upload="source" type="file" accept="${id === "hdr-tone-mapping" ? ".hdr" : "image/png,image/jpeg,image/webp"}"></label>`
    : "";
  const other = s.other
    ? `<label>${id === "image-analogies" ? "Upload B" : "Upload second image"}<input data-upload="other" type="file" accept="image/png,image/jpeg,image/webp"></label>`
    : "";
  const filtered =
    id === "image-analogies"
      ? '<label>Upload A′ (aligned with A)<input data-upload="filtered" type="file" accept="image/png,image/jpeg,image/webp"></label>'
      : "";
  return `<div class="experiment-lab__controls">${controls}${upload}${other}${filtered}<div class="experiment-lab__actions"><button type="button" data-run>${id === "stable-fluids" ? "Start simulation" : id === "tree-growth" ? "Grow tree" : "Run experiment"}</button><button type="button" data-cancel disabled>Cancel</button><button type="button" data-reset>Reset</button></div>${["seam-carving", "patchmatch"].includes(id) ? '<button type="button" data-clear-mask>Clear mask</button>' : ""}${id === "image-deformation" ? '<fieldset class="experiment-lab__pins"><legend>Selected pin</legend><label>Pin<select data-pin-select aria-label="Selected pin"></select></label><label>Horizontal position<input data-pin-x type="range" min="0" max="100" value="50"></label><label>Vertical position<input data-pin-y type="range" min="0" max="100" value="50"></label><button type="button" data-add-pin>Add center pin</button><button type="button" data-delete-pin>Remove selected pin</button></fieldset>' : ""}<small>All processing stays in your browser. Image uploads are resized to a ${s.size}px preview${id === "image-analogies" ? " and paired inputs must have matching proportions" : ""}.</small></div><div class="experiment-lab__stage"><p class="experiment-lab__hint">${s.hint}</p><div class="experiment-lab__images ${s.source ? "" : "experiment-lab__images--single"}">${source}${id === "image-analogies" ? `<figure><div class="experiment-lab__surface"><img data-filtered-preview src="${assetsBase}/${s.filtered}.${s.filteredExtension || "webp"}" alt="A′ · registered engraving"><canvas data-filtered-canvas hidden></canvas></div><figcaption>A′ · registered engraving</figcaption></figure><figure><div class="experiment-lab__surface"><img data-other-preview src="${assetsBase}/${s.other}.webp" alt="B · new photograph"><canvas data-other-canvas hidden></canvas></div><figcaption>B · new photograph</figcaption></figure>` : ""}<figure><div class="experiment-lab__surface"><img data-result-preview src="${assetsBase}/${id}-result.webp" alt="Precomputed ${escape(s.title)} example"><canvas data-result hidden aria-label="${escape(s.title)} result"></canvas></div><figcaption data-caption>Computed example · run to make your own</figcaption></figure></div><div class="experiment-lab__tools"><button type="button" data-download disabled>Download PNG</button>${id === "stippling" ? '<button type="button" data-svg disabled>Download SVG</button>' : ""}${id === "painterly-rendering" ? '<button type="button" data-replay disabled>Replay strokes</button>' : ""}${id === "stable-fluids" ? '<button type="button" data-pause disabled>Pause</button>' : ""}${id === "tree-growth" ? '<button type="button" data-skeleton aria-pressed="false">Skeleton</button><button type="button" data-attractors aria-pressed="false">Remaining attraction points</button><button type="button" data-orbit="-1">Rotate left</button><button type="button" data-orbit="1">Rotate right</button>' : ""}${id === "hdr-tone-mapping" ? '<button type="button" data-view="result">Tone mapped</button><button type="button" data-view="base">Base layer</button><button type="button" data-view="detailLayer">Detail layer</button>' : ""}${id === "hybrid-images" ? '<button type="button" data-view="result">Combined</button><button type="button" data-view="low">Low frequency</button><button type="button" data-view="high">High frequency</button>' : ""}${id === "patchmatch" ? '<button type="button" data-mapping aria-pressed="false">Source correspondences</button>' : ""}</div><progress max="1" value="0" aria-label="Experiment progress" hidden></progress><p class="experiment-lab__status" role="status" aria-live="polite" data-status>Ready when you are.</p><p class="experiment-lab__error" role="alert" data-error hidden></p><div class="experiment-lab__extra" data-extra></div><p class="experiment-lab__notice">Worker processing · local inputs · downloadable output</p></div>`;
}

async function readImage(url, size) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("The sample image could not be loaded.");
  return blobImage(await response.blob(), size);
}
async function blobImage(blob, size) {
  if (blob.size > 12 * 1024 * 1024)
    throw new Error("Choose an image smaller than 12 MB.");
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40000000)
      throw new Error("Choose an image smaller than 40 megapixels.");
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height)),
      width = Math.max(1, Math.round(bitmap.width * scale)),
      height = Math.max(1, Math.round(bitmap.height * scale)),
      canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}
function save(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountExperiment(
  host,
  {
    id,
    assetsBase = "/assets/studies",
    workerFactory = () =>
      new Worker(new URL("./worker.js", import.meta.url), { type: "module" }),
  } = {},
) {
  const s = getExperiment(id);
  if (!s) throw new Error("Unknown study.");
  host.classList.add("experiment-lab");
  host.dataset.study = id;
  if (!host.querySelector("[data-run]"))
    host.innerHTML = experimentMarkup({ id, assetsBase });
  const $ = (selector) => host.querySelector(selector),
    $$ = (selector) => [...host.querySelectorAll(selector)],
    input = $("[data-input]"),
    canvas = $("[data-result]"),
    status = $("[data-status]"),
    error = $("[data-error]"),
    progress = $("progress"),
    params = Object.fromEntries(s.controls.map((c) => [c.key, c.value]));
  let source = null,
    other = null,
    filtered = null,
    hdrBuffer = null,
    mask = null,
    protectMask = null,
    worker = null,
    result = null,
    running = false,
    disposed = false,
    loading = null,
    loadVersion = 0,
    replayFrame = 0,
    deformTimer = 0,
    pointer = null,
    handles = [],
    selected = 0,
    view = "result",
    mapping = false,
    runEpoch = 0,
    customA = false,
    fluidPaused = false;
  const treeView = {
    yaw: 0.5,
    pitch: 0.25,
    skeleton: false,
    attractors: false,
  };
  const abort = new AbortController(),
    on = (target, event, fn) =>
      target?.addEventListener(event, fn, { signal: abort.signal });
  function message(text) {
    if (status.textContent !== text) status.textContent = text;
  }
  function fail(reason) {
    error.hidden = false;
    error.textContent = reason;
    message("Adjust the inputs and try again.");
    setRunning(false);
  }
  function setRunning(value) {
    running = value;
    $("[data-run]").disabled = value;
    $("[data-cancel]").disabled = !value;
    progress.hidden = !value;
    host.dataset.running = String(value);
  }
  function stop() {
    fluidPaused = false;
    if ($("[data-pause]")) $("[data-pause]").textContent = "Pause";
    runEpoch++;
    worker?.terminate();
    worker = null;
    cancelAnimationFrame(replayFrame);
    clearTimeout(deformTimer);
    setRunning(false);
    $("[data-pause]")?.setAttribute("disabled", "");
  }
  function present(image) {
    drawImage(canvas, image);
    canvas.hidden = false;
    $("[data-result-preview]").hidden = true;
  }
  function presentResult() {
    if (!result) return;
    if (id === "tree-growth") {
      drawTree(canvas, result, treeView);
      canvas.hidden = false;
      $("[data-result-preview]").hidden = true;
      return;
    }
    if (mapping && result.mapping) {
      const d = new Uint8ClampedArray(result.width * result.height * 4);
      for (let i = 0; i < result.mapping.length; i++) {
        const k = result.mapping[i];
        d.set(
          [
            ((k % source.width) / source.width) * 255,
            (Math.floor(k / source.width) / source.height) * 255,
            140,
            255,
          ],
          i * 4,
        );
      }
      present({ ...result, data: d });
      return;
    }
    present(view === "result" ? result : result[view] || result);
  }
  function showInput() {
    if (!source || !input) return;
    drawImage(input, source);
    input.hidden = false;
    $("[data-input-preview]").hidden = true;
    if (mask) {
      const ctx = input.getContext("2d"),
        d = ctx.getImageData(0, 0, input.width, input.height);
      for (let i = 0; i < mask.length; i++) {
        const protect = protectMask?.[i];
        if (mask[i] || protect) {
          const c = protect ? [163, 220, 146] : [233, 127, 97];
          for (let k = 0; k < 3; k++)
            d.data[i * 4 + k] = d.data[i * 4 + k] * 0.45 + c[k] * 0.55;
        }
      }
      ctx.putImageData(d, 0, 0);
    }
  }
  function showPins() {
    if (!source) return;
    presentResult();
    if (!result) present(source);
    const ctx = canvas.getContext("2d");
    for (let i = 0; i < handles.length; i++) {
      const h = handles[i];
      ctx.strokeStyle = "rgba(244,241,222,.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(...h.from);
      ctx.lineTo(...h.to);
      ctx.stroke();
      ctx.fillStyle = i === selected ? "#ffb68e" : "#d9e8c5";
      ctx.strokeStyle = "#19362b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(...h.to, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const picker = $("[data-pin-select]");
    picker.innerHTML = handles
      .map((_, i) => `<option value="${i}">Pin ${i + 1}</option>`)
      .join("");
    picker.value = selected;
    const pin = handles[selected];
    if (pin) {
      $("[data-pin-x]").value = (100 * pin.to[0]) / source.width;
      $("[data-pin-y]").value = (100 * pin.to[1]) / source.height;
    }
  }
  function initSource() {
    if (!source) return;
    mask = sampleMask(source, customA ? [] : s.maskRegions);
    protectMask = sampleMask(source, customA ? [] : s.protectRegions);
    if (id === "image-deformation") {
      handles = sampleHandles(source, customA ? null : s.pins);
      selected = Math.min(s.examplePin?.index ?? 4, handles.length - 1);
      result = null;
      showPins();
    }
    showInput();
  }
  async function ensureInputs() {
    if (loading) return loading;
    const version = loadVersion;
    loading = (async () => {
      if (s.source === "lebombo" && !hdrBuffer) {
        const response = await fetch(`${assetsBase}/lebombo.hdr`);
        if (!response.ok)
          throw new Error("The HDR sample could not be loaded.");
        const buffer = await response.arrayBuffer();
        if (version !== loadVersion) return;
        hdrBuffer = buffer;
      } else if (s.source && s.source !== "lebombo" && !source) {
        const image = await readImage(`${assetsBase}/${s.source}.webp`, s.size);
        if (version !== loadVersion) return;
        source = image;
        initSource();
      }
      if (s.other && !other) {
        const image = await readImage(`${assetsBase}/${s.other}.webp`, s.size);
        if (version !== loadVersion) return;
        other = image;
      }
      if (id === "image-analogies" && !filtered && !customA) {
        const image = await readImage(
          `${assetsBase}/${s.filtered}.${s.filteredExtension || "webp"}`,
          s.size,
        );
        if (version !== loadVersion) return;
        filtered = image;
      }
      if (disposed || version !== loadVersion) return;
      const extra = $("[data-extra]");
      extra.replaceChildren();
      if (id === "image-analogies") {
        for (const [im, key] of [
          [filtered, "filtered"],
          [other, "other"],
        ]) {
          if (!im) continue;
          drawImage($(`[data-${key}-canvas]`), im);
          $(`[data-${key}-canvas]`).hidden = false;
          $(`[data-${key}-preview]`).hidden = true;
        }
      }
      for (const [im, label] of id === "image-analogies"
        ? []
        : other
          ? [[other, "Second image · high-frequency source"]]
          : []) {
        if (!im) continue;
        const figure = document.createElement("figure"),
          c = document.createElement("canvas"),
          caption = document.createElement("figcaption");
        drawImage(c, im);
        caption.textContent = label;
        figure.append(c, caption);
        extra.append(figure);
      }
    })();
    try {
      await loading;
    } finally {
      loading = null;
    }
  }
  function finish(next) {
    result = next;
    presentResult();
    if (id === "image-deformation") showPins();
    $("[data-download]").disabled = false;
    const svg = $("[data-svg]");
    if (svg) svg.disabled = !next.points;
    const replay = $("[data-replay]");
    if (replay) replay.disabled = !next.strokes;
    $("[data-caption]").textContent =
      id === "tree-growth"
        ? `${next.nodes.length.toLocaleString()} branches · seed ${params.seed}`
        : `Computed locally · ${next.width} × ${next.height}`;
    if (id === "hybrid-images") {
      const figure = document.createElement("figure"),
        c = document.createElement("canvas"),
        caption = document.createElement("figcaption");
      c.dataset.distance = "";
      drawImage(c, next);
      caption.textContent = "Distance preview";
      figure.append(c, caption);
      $("[data-extra]").append(figure);
    }
  }
  async function run() {
    stop();
    error.hidden = true;
    setRunning(true);
    message("Preparing inputs…");
    const version = loadVersion,
      epoch = runEpoch;
    try {
      await ensureInputs();
      if (disposed || version !== loadVersion || epoch !== runEpoch) return;
      worker = workerFactory();
      const start = performance.now();
      worker.onmessage = ({ data: m }) => {
        if (disposed) return;
        if (m.type === "error") {
          stop();
          fail(m.message);
          return;
        }
        if (m.type === "input") {
          source = m.image;
          showInput();
          return;
        }
        if (m.type === "paused") {
          fluidPaused = m.paused;
          $("[data-pause]").textContent = m.paused ? "Resume" : "Pause";
          message(
            m.paused
              ? "Paused. Export the current frame or resume."
              : "Running · drag to stir the dye.",
          );
          return;
        }
        if (m.type === "progress") {
          progress.value = m.result.progress || 0;
          message(
            `${m.result.stage || "Computing"} · ${Math.round((m.result.progress || 0) * 100)}%`,
          );
          if (m.result.data) present(m.result);
          else if (m.result.nodes) {
            drawTree(canvas, m.result, treeView);
            canvas.hidden = false;
            $("[data-result-preview]").hidden = true;
          }
          return;
        }
        if (m.type === "frame") {
          result = m.result;
          present(result);
          $("[data-download]").disabled = false;
          $("[data-pause]").disabled = false;
          progress.hidden = true;
          message(fluidPaused ? "Paused. Export the current frame or resume." : "Running · drag to stir the dye.");
          $("[data-caption]").textContent =
            `Live simulation · ${m.result.grid || 80} × ${m.result.grid || 80} solver · ${m.result.width} × ${m.result.height} dye`;
          return;
        }
        if (m.type === "done") {
          setRunning(false);
          progress.value = 1;
          finish(m.result);
          message(
            `Finished in ${((performance.now() - start) / 1000).toFixed(2)}s. Change a control to compare another result.`,
          );
          worker.terminate();
          worker = null;
        }
      };
      worker.onerror = () => {
        stop();
        fail("The processing worker could not load. Refresh and try again.");
      };
      const args = {
        ...params,
        source,
        other,
        filtered,
        mask,
        protectMask,
        removeMask: mask,
        handles: handles.map((h) => ({ from: [...h.from], to: [...h.to] })),
      };
      if (id === "hybrid-images")
        args.alignment = {
          x: params.alignX,
          y: params.alignY,
          scale: params.alignScale,
        };
      if (id === "image-analogies") {
        args.target = other;
        if (!filtered)
          throw new Error(
            "Upload the matching A′ image for your custom A first.",
          );
        if (
          source.width !== filtered.width ||
          source.height !== filtered.height
        )
          throw new Error(
            "A and A′ must have the same proportions and dimensions.",
          );
      }
      if (id === "seam-carving")
        args.targetWidth = Math.round(source.width * params.widthRatio);
      if (id === "stable-fluids")
        args.mobile = matchMedia("(max-width:750px)").matches;
      if (id === "tree-growth")
        args.obstacles =
          params.obstacle === "on" ? [{ x: 0.35, y: 1.2, z: 0, r: 0.3 }] : [];
      if (id === "hdr-tone-mapping") args.buffer = hdrBuffer;
      worker.postMessage({ type: "run", id, params: args });
      message("Computing…");
    } catch (reason) {
      stop();
      fail(reason.message);
    }
  }
  const scheduleDeform = () => {
    clearTimeout(deformTimer);
    deformTimer = setTimeout(() => {
      if (!disposed) run();
    }, 40);
  };
  on($("[data-run]"), "click", run);
  on($("[data-cancel]"), "click", () => {
    stop();
    message("Stopped. The last preview is kept.");
  });
  on($("[data-reset]"), "click", () => {
    loadVersion++;
    stop();
    loading = null;
    source = other = filtered = hdrBuffer = result = null;
    customA = false;
    view = "result";
    mapping = false;
    paramsChangedReset();
    canvas.hidden = true;
    $("[data-result-preview]").hidden = false;
    $("[data-caption]").textContent = "Computed example · run to make your own";
    $("[data-extra]").replaceChildren();
    $("[data-download]").disabled = true;
    for (const button of $$("[data-svg],[data-replay]")) button.disabled = true;
    error.hidden = true;
    ensureInputs().catch((e) => fail(e.message));
    message("Sample inputs and controls restored.");
  });
  function paramsChangedReset() {
    for (const c of s.controls) {
      params[c.key] = c.value;
      const el = $(`[data-param="${c.key}"]`);
      el.value = c.value;
      const output = $(`[data-value="${c.key}"]`);
      if (output) output.textContent = c.value;
    }
  }
  for (const el of $$("[data-param]"))
    on(el, "input", () => {
      const key = el.dataset.param;
      params[key] = el.type === "range" ? Number(el.value) : el.value;
      const out = $(`[data-value="${key}"]`);
      if (out) out.textContent = el.value;
      if (id === "stable-fluids" && running)
        worker?.postMessage({
          type: "params",
          params: { viscosity: params.viscosity, diffusion: params.diffusion },
        });
      if (id === "image-deformation") scheduleDeform();
      else if (!running)
        message("Controls changed. Run the experiment to update the result.");
    });
  for (const el of $$("[data-upload]"))
    on(el, "change", async () => {
      const file = el.files?.[0];
      if (!file) return;
      stop();
      error.hidden = true;
      loadVersion++;
      loading = null;
      try {
        if (s.source === "lebombo") {
          if (file.size > 32 * 1024 * 1024)
            throw new Error("Choose an HDR file smaller than 32 MB.");
          hdrBuffer = await file.arrayBuffer();
          source = null;
        } else {
          const image = await blobImage(file, s.size);
          if (el.dataset.upload === "source") {
            source = image;
            customA = true;
            initSource();
            if (id === "image-analogies") {
              filtered = null;
              customA = true;
            }
          } else if (el.dataset.upload === "other") other = image;
          else filtered = image;
        }
        await ensureInputs();
        message("Image loaded. Run to compute a new result.");
      } catch (e) {
        fail(e.message);
      }
    });
  on($("[data-clear-mask]"), "click", () => {
    mask?.fill(0);
    protectMask?.fill(0);
    showInput();
    message("Mask cleared. Paint the source to mark a region.");
  });
  on($("[data-download]"), "click", () => {
    if (!result) return;
    const out = document.createElement("canvas");
    if (result.nodes) drawTree(out, result, treeView);
    else drawImage(out, result);
    out.toBlob((blob) => blob && save(blob, `${id}.png`), "image/png");
  });
  on(
    $("[data-svg]"),
    "click",
    () =>
      result?.points &&
      save(
        new Blob([svgStipples(result)], { type: "image/svg+xml" }),
        "stippling.svg",
      ),
  );
  on($("[data-pause]"), "click", () => worker?.postMessage({ type: "pause" }));
  for (const button of $$("[data-view]"))
    on(button, "click", () => {
      view = button.dataset.view;
      presentResult();
    });
  on($("[data-mapping]"), "click", (event) => {
    mapping = !mapping;
    event.currentTarget.setAttribute("aria-pressed", mapping);
    presentResult();
  });
  for (const key of ["skeleton", "attractors"])
    on($(`[data-${key}]`), "click", (event) => {
      treeView[key] = !treeView[key];
      event.currentTarget.setAttribute("aria-pressed", treeView[key]);
      presentResult();
    });
  for (const button of $$("[data-orbit]"))
    on(button, "click", () => {
      treeView.yaw += Number(button.dataset.orbit) * 0.25;
      presentResult();
    });
  on($("[data-replay]"), "click", () => {
    if (!result?.strokes) return;
    cancelAnimationFrame(replayFrame);
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f5f3e7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let index = 0;
    const step = () => {
      for (
        let i = 0;
        i < Math.max(1, Math.ceil(result.strokes.length / 180)) &&
        index < result.strokes.length;
        i++
      )
        drawStroke(ctx, result.strokes[index++]);
      if (index < result.strokes.length)
        replayFrame = requestAnimationFrame(step);
      else presentResult();
    };
    step();
  });
  function position(event, target) {
    const rect = target.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * target.width,
      ((event.clientY - rect.top) / rect.height) * target.height,
    ];
  }
  function paintMask(x, y) {
    const radius = params.brush || 12;
    for (
      let yy = Math.max(0, Math.floor(y - radius));
      yy < Math.min(source.height, y + radius);
      yy++
    )
      for (
        let xx = Math.max(0, Math.floor(x - radius));
        xx < Math.min(source.width, x + radius);
        xx++
      )
        if ((xx - x) ** 2 + (yy - y) ** 2 <= radius ** 2) {
          const p = yy * source.width + xx;
          mask[p] =
            params.maskMode === "protect" || params.maskMode === "erase"
              ? 0
              : 1;
          protectMask[p] = params.maskMode === "protect" ? 1 : 0;
        }
    showInput();
  }
  if (["patchmatch", "seam-carving"].includes(id)) {
    input.dataset.interactive = "";
    input.tabIndex = 0;
    let maskCursor = [0.5, 0.5];
    on(input, "keydown", (e) => {
      if (!source) return;
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[e.key];
      if (direction) {
        e.preventDefault();
        maskCursor = maskCursor.map((v, i) =>
          Math.max(0, Math.min(1, v + direction[i] * 0.03)),
        );
        paintMask(maskCursor[0] * source.width, maskCursor[1] * source.height);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        paintMask(maskCursor[0] * source.width, maskCursor[1] * source.height);
      }
    });
    on(input, "pointerdown", (e) => {
      if (!source) return;
      pointer = e.pointerId;
      input.setPointerCapture(pointer);
      paintMask(...position(e, input));
    });
    on(input, "pointermove", (e) => {
      if (pointer === e.pointerId) paintMask(...position(e, input));
    });
    on(input, "pointerup", () => {
      pointer = null;
      message("Mask updated. Run to apply it.");
    });
    on(input, "pointercancel", () => {
      pointer = null;
    });
  }
  if (id === "image-deformation") {
    canvas.dataset.interactive = "";
    on(canvas, "pointerdown", (e) => {
      if (!handles.length) return;
      const p = position(e, canvas);
      selected = handles
        .map((h, i) => ({ i, d: Math.hypot(h.to[0] - p[0], h.to[1] - p[1]) }))
        .sort((a, b) => a.d - b.d)[0].i;
      pointer = e.pointerId;
      canvas.setPointerCapture(pointer);
      showPins();
    });
    on(canvas, "pointermove", (e) => {
      if (pointer !== e.pointerId) return;
      handles[selected].to = position(e, canvas);
      showPins();
      scheduleDeform();
    });
    on(canvas, "pointerup", () => {
      pointer = null;
      scheduleDeform();
    });
    on(canvas, "pointercancel", () => {
      pointer = null;
    });
    const add = (p) => {
      if (handles.length >= 16) return;
      handles.push({ from: [...p], to: [...p] });
      selected = handles.length - 1;
      showPins();
    };
    on(canvas, "dblclick", (e) => add(position(e, canvas)));
    on(
      $("[data-add-pin]"),
      "click",
      () => source && add([source.width / 2, source.height / 2]),
    );
    on($("[data-delete-pin]"), "click", () => {
      if (handles.length <= 1) return;
      handles.splice(selected, 1);
      selected = Math.max(0, selected - 1);
      scheduleDeform();
    });
    on($("[data-pin-select]"), "change", (e) => {
      selected = Number(e.target.value);
      showPins();
    });
    for (const [axis, key] of [
      [0, "x"],
      [1, "y"],
    ])
      on($(`[data-pin-${key}]`), "input", (e) => {
        if (!handles[selected]) return;
        handles[selected].to[axis] =
          (Number(e.target.value) / 100) *
          (axis ? source.height : source.width);
        showPins();
        scheduleDeform();
      });
  }
  if (id === "tree-growth") {
    canvas.dataset.interactive = "";
    on(canvas, "pointerdown", (e) => {
      pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    on(canvas, "pointermove", (e) => {
      if (pointer?.id !== e.pointerId) return;
      treeView.yaw += (e.clientX - pointer.x) * 0.012;
      treeView.pitch = Math.max(
        -0.3,
        Math.min(0.8, treeView.pitch + (e.clientY - pointer.y) * 0.006),
      );
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      presentResult();
    });
    on(canvas, "pointerup", () => {
      pointer = null;
    });
    on(canvas, "pointercancel", () => {
      pointer = null;
    });
  }
  if (id === "stable-fluids") {
    canvas.dataset.interactive = "";
    canvas.tabIndex = 0;
    on(canvas, "keydown", (e) => {
      const force = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        " ": [0.4, -0.6],
        Enter: [0.4, -0.6],
      }[e.key];
      if (!force) return;
      e.preventDefault();
      worker?.postMessage({
        type: "inject",
        x: 0.5,
        y: 0.5,
        vx: force[0],
        vy: force[1],
        color: {
          mint: [166, 220, 186],
          coral: [242, 130, 95],
          gold: [226, 191, 100],
        }[params.dye],
      });
    });
    const inject = (e) => {
      const [x, y] = position(e, canvas),
        now = performance.now(),
        nx = Math.max(0, Math.min(1, x / canvas.width)),
        ny = Math.max(0, Math.min(1, y / canvas.height)),
        dt = Math.max(0.016, (now - (pointer?.time || now)) / 1000),
        color = {
          mint: [166, 220, 186],
          coral: [242, 130, 95],
          gold: [226, 191, 100],
        }[params.dye];
      worker?.postMessage({
        type: "inject",
        x: nx,
        y: ny,
        vx: Math.max(-3, Math.min(3, (nx - (pointer?.x ?? nx)) / dt)),
        vy: Math.max(-3, Math.min(3, (ny - (pointer?.y ?? ny)) / dt)),
        color,
      });
      pointer = { id: e.pointerId, x: nx, y: ny, time: now };
    };
    on(canvas, "pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      inject(e);
    });
    on(canvas, "pointermove", (e) => {
      if (pointer?.id === e.pointerId) inject(e);
    });
    on(canvas, "pointerup", () => {
      pointer = null;
    });
    on(canvas, "pointercancel", () => {
      pointer = null;
    });
  }
  ensureInputs().catch((e) => {
    if (!disposed) fail(e.message);
  });
  return () => {
    disposed = true;
    loadVersion++;
    abort.abort();
    stop();
  };
}
