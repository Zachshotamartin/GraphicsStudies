# Images and reproducibility

The foliage, river-pebble texture and anonymous sculpture photographs were generated specifically as input material on September 8, 2026. The sculpture does not depict a real person. These images are not photographs of completed algorithm output.

- `foliage.webp`: flat macro of densely overlapping small leaves; varied forest/sage tones, visible veins and gaps; even diffuse lighting.
- `pebbles.webp`: flat macro of tightly packed smooth river stones, from charcoal to ivory; varied gray tones and fine surface detail; no perspective or selective focus.
- `bust.webp`: anonymous classical ivory sculpture, curly hair, head and shoulders centered, dark background, soft upper-left light.

Inputs are 512px WebP. The demo samples the texture to 256px and target to the output dimensions. `quilting-result.webp`, `quilting-straight.webp`, `transfer-result.webp` and `transfer-foliage.webp` were computed with this repository’s `synthesize()` implementation, then encoded as WebP for display. They are not AI-generated result mockups. Exact settings are recorded in `web/assets/examples.json`. Compression affects the published previews; downloadable PNGs retain the generated pixel values.

The quilting previews are 1024 × 1024 exports from a 256 × 256 working texture, using 240px patches, 41px overlaps, 384 candidate limit and seed 42. Transfer previews retain their separate 256px output, 36px initial patch and three-pass settings.
