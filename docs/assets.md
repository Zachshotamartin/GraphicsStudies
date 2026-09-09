# Images and reproducibility

Each study owns a distinct source set. Source photographs were generated as input material; published outputs are computed by the actual algorithms used in the live workers. No output is an AI illustration of what the algorithm is supposed to produce.

| Study | Exclusive input set | What the comparison demonstrates |
| --- | --- | --- |
| Image quilting | `foliage.webp`, `quilting-slate.webp` | A 256px material sample expanded to 1024px with near-full patches; straight versus minimum-error seams. |
| Texture transfer | `pebbles.webp`, `transfer-fabric.webp`, `bust.webp` | An anonymous sculpture reconstructed from light/dark material patches. The sculpture does not depict a real person. |
| Weighted stippling | `stippling-shell.webp` | Spiral shell ridges resolved with 8,000 individual ink circles by default. SVG retains their geometry. |
| Painterly rendering | `harbor.webp` | Harbor forms reconstructed by ordered, curved strokes at multiple scales. |
| Seam carving | `seam-balloons.webp` | Balloons retain their shape while empty sky is removed; ordinary resizing at the same output width provides a baseline. |
| PatchMatch | `patchmatch-gravel.webp` | A red bottle and its contact shadow are masked, then filled from surrounding gravel patches without resizing. |
| Moving least squares | `deformation-leaf.webp` | Pins on the fan and stem deform a ginkgo leaf through local transformations. |
| Space colonization | Procedural attraction volume | Same seed/canopy, with and without an obstacle. The obstacle also excludes attraction points, so their exact positions can differ. |
| Stable Fluids | Procedural dye injections | Same emitters, seed 42, and 110 steps; only viscosity changes from 0.0001 to 0.003. |
| Hybrid images | `fox.webp`, `owl.webp` | Fox supplies low spatial frequencies, owl supplies high frequencies. |
| HDR tone mapping | `lebombo.hdr` | Plain exposure and bilateral tone mapping of the same floating-point radiance. |
| Image Analogies | `analogies-courtyard.webp`, `analogies-engraved.png`, `analogies-arcade.webp` | Registered A/A′ pair and a different B teach a photo-to-engraving relationship. B′ is synthesized by analogy. |

The original foliage, pebbles, and bust were generated September 8, 2026 and saved at 512px. Harbor, fox and owl are 768px inputs from the same date. Eight dedicated replacement/additional sources were generated September 9, 2026 using the built-in image-generation tool, then resized to a 768px maximum edge and encoded as WebP. Their complete prompts are in [source-prompts-2026-09-09.json](source-prompts-2026-09-09.json). The old shared landscape, painted harbor exemplar, and foliage-transfer output have been retired from the source and gallery sets.

## Algorithm outputs

Run `npm run examples` while the standalone server is active. `scripts/generate-examples.mjs` imports the same modules as the live workers, computes each result, saves PNG and WebP files, and records effective parameters in `web/assets/experiment-examples.json`. The unchanged original foliage and pebble examples retain their settings in `web/assets/examples.json`.

`src/experiments/catalog.js` stores normalized mask regions and subject-specific pins; `sample-inputs.js` converts them to pixel coordinates for both the lab and exports. Uploaded photographs start with an empty mask and generic pins, so default-subject annotations are never applied to an unrelated upload. The completion rectangle includes the entire bottle and its short shadow. The carving rectangles protect both balloons and baskets. The leaf example moves a pin on the right lobe while retaining the other anchors.

`engraveExample()` creates only A′ using registered Sobel contours and tone-controlled hatching. The live input is a lossless PNG at the same dimensions as A's working image. The engraving filter is never applied to B to fabricate B′: `analogize()` synthesizes it by matching the A/A′ relationship. The WebP A′ is only a gallery preview. The default example uses 256px, three pyramid levels, coherence 0.1, and 128 search candidates. Synthesis artifacts remain possible and are described in the interface.

All published PNGs preserve the computed pixels. WebP previews use lossy compression; browser rasterization/encoding can introduce small differences between platforms. The mask overlays and uniform-resize baseline are explanatory diagnostic images, clearly labeled, not algorithm results.

## HDR attribution

`lebombo.hdr` is **Lebombo by Greg Zaal**, from [Poly Haven](https://polyhaven.com/a/lebombo), [CC0](https://polyhaven.com/license). Source: [1K RGBE](https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/lebombo_1k.hdr). This is real floating-point radiance. `hdr-exposure` is a direct sRGB exposure preview; `hdr-tone-mapping-result` is the bilateral base/detail result, not an LDR image relabeled as HDR.
