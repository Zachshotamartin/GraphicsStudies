# Images and reproducibility

The foliage, river-pebble texture and anonymous sculpture photographs were generated specifically as input material on September 8, 2026. The sculpture does not depict a real person. These images are not photographs of completed algorithm output.

- `foliage.webp`: flat macro of densely overlapping small leaves; varied forest/sage tones, visible veins and gaps; even diffuse lighting.
- `pebbles.webp`: flat macro of tightly packed smooth river stones, from charcoal to ivory; varied gray tones and fine surface detail; no perspective or selective focus.
- `bust.webp`: anonymous classical ivory sculpture, curly hair, head and shoulders centered, dark background, soft upper-left light.

Inputs are 512px WebP. The demo samples the texture to 256px and target to the output dimensions. `quilting-result.webp`, `quilting-straight.webp`, `transfer-result.webp` and `transfer-foliage.webp` were computed with this repository’s `synthesize()` implementation, then encoded as WebP for display. They are not AI-generated result mockups. Exact settings are recorded in `web/assets/examples.json`. Compression affects the published previews; downloadable PNGs retain the generated pixel values.

The quilting previews are 1024 × 1024 exports from a 256 × 256 working texture, using 240px patches, 41px overlaps, 384 candidate limit and seed 42. Transfer previews retain their separate 256px output, 36px initial patch and three-pass settings.

## Expanded experiments

Four additional input photographs were generated for this collection on September 8, 2026 and resized to a768px maximum edge:

- `landscape.webp`: coastal meadow, wind-shaped pine at the left, sea cliffs, red wildflowers, small orange cone in the lower-right grass. The cone provides a clearly visible PatchMatch removal target; the pine provides a seam-carving subject.
- `harbor.webp`: Mediterranean harbor, terracotta houses and cypresses at the left, blue wooden boat in the foreground, clear sea and warm daylight. A separate scene is needed to test whether Image Analogies responds to a new target.
- `fox.webp`: front-facing fox, detailed orange fur and white cheeks on a pale neutral background.
- `owl.webp`: front-facing barn owl, pale heart-shaped face and fine feather detail on a matching neutral background. Alignment remains an explicit hybrid-image control; the generated faces are not assumed to be registered automatically.

These are source material, not algorithm-output illustrations. `harbor-painted` is computed by the curved-stroke renderer and provides the registered A′ input for Image Analogies.

`lebombo.hdr` is **Lebombo by Greg Zaal**, from [Poly Haven](https://polyhaven.com/a/lebombo), [CC0](https://polyhaven.com/license). Source file: [1K RGBE](https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/lebombo_1k.hdr). This is real floating-point radiance from a high-dynamic-range photograph. `hdr-exposure` is a direct sRGB exposure preview; `hdr-tone-mapping-result` is the output of this repository’s bilateral base/detail algorithm. It is not an LDR image relabeled as HDR.

Run `npm run examples` while the standalone server is active. The script invokes each actual algorithm, saves both PNG and WebP outputs, and records parameters in `web/assets/experiment-examples.json`. It also makes alternative seeded tree and fluid outputs. These are identical modules to the portfolio’s live workers. The deformation example shifts the center pin12% right and7% up. The completion mask covers the cone at roughly76% of image width and65% of height. Inputs, seeds, controls and code determine the examples; browser rasterization/encoding may introduce small differences between platforms.
