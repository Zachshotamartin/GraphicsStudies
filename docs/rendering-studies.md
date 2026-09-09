# Stippling, painting, and content-aware resizing

These modules are deterministic, dependency-free ES modules. They run in Node or a browser worker. Each accepts an RGBA `source` (`width`, `height`, and a `Uint8ClampedArray`), yields independent RGBA progress frames, and returns an RGBA result. Inputs are limited to 8–512 pixels on each side; callers should downsample larger uploads before starting.

## Weighted Voronoi stippling

**Research:** Adrian Secord, [Weighted Voronoi Stippling](https://lhf.impa.br/cursos/rr/p37-secord.pdf), NPAR 2002, [DOI](https://doi.org/10.1145/508530.508537).

`stipple({source, count:1800, iterations:16, seed:42, paper:[245,243,231], ink:[27,44,40]})`

- Seed sites from the source's luminance-derived darkness distribution using a cumulative density table and a reproducible pseudorandom generator.
- Build an exact nearest-neighbor k-d tree for the sites on every iteration.
- Assign raster samples to their nearest site and integrate their darkness-weighted positions.
- Move every nonempty site to its weighted centroid (Lloyd relaxation). Empty sampled cells retain their sites, avoiding random jumps during relaxation.
- Render antialiased circular ink marks on paper. Output `points:[{x,y,r}]` supports a genuine SVG drawing.

The quadrature grid scales with point count and is bounded to 192 samples on its longest side. This approximates the continuous weighted integral; it does not compute explicit Voronoi polygon boundaries. `energy` reports mean weighted squared distance before each iteration's centroid update. Its decrease is tested. Dot coverage is intentionally less than full tonal reconstruction to retain negative space between ink marks. All-white/transparent images return blank paper, not arbitrary dots.

Controls: 8–5000 requested dots (UI recommends at least200), 1–30 iterations, seed. Site count is capped to the integration sample count for tiny inputs. Progress is emitted once per iteration. The result includes the final sites, colors, actual iteration count and integration-grid dimensions.

## Painterly rendering

**Research:** Aaron Hertzmann, [Painterly Rendering with Curved Brush Strokes of Multiple Sizes](https://mrl.cs.nyu.edu/publications/painterly98/), SIGGRAPH 1998. [Paper](https://mrl.cs.nyu.edu/publications/painterly98/hertzmann-siggraph98.pdf).

`paint({source, brushSize:12, detail:0.55, seed:42})`

- Start with a constant paper canvas and work through three decreasing brush radii.
- Blur the source with a separable Gaussian matched to the current radius. Compute Sobel gradients of the reference luminance.
- Compare the current painting with this reference. Within each grid cell, place a stroke at the largest-error pixel when the cell's average error exceeds the detail-dependent threshold.
- Trace stroke controls perpendicular to the gradient (along isophotes), retaining direction continuity and filtering curvature. Stop at the image boundary, vanishing gradients, the length bound, or when continuing would paint over a better match.
- Render layers in seeded shuffled order. Curves use Catmull–Rom interpolation and antialiased circular brush stamps.

This is a multiscale curved-stroke implementation, not a photograph filter or painted image pasted behind an animation. The paper uses cubic B-splines; this implementation uses interpolating Catmull–Rom curves. It does not simulate bristle physics, wet paint or pigment mixing. Colors are constant along each stroke and edges are improved by finer passes rather than semantic segmentation.

Controls: initial brush radius4–28px, detail0–1, seed. The result provides `strokes:[{points,controlPoints,radius,color}]` in exact paint order; `points` are flattened curves suitable for SVG paths and progressive replay. Coarse preview frames report stroke count, layer and radius without retransmitting every accumulated path.

## Seam carving

**Research:** Shai Avidan and Ariel Shamir, [Seam Carving for Content-Aware Image Resizing](https://doi.org/10.1145/1276377.1276390), SIGGRAPH 2007. [Paper](https://cs.brown.edu/courses/cs016/static/files/docs/seamcarving_original_paper.pdf).

`carve({source, targetWidth, targetHeight, protectMask, removeMask})`

- Compute backward energy from absolute horizontal/vertical RGB derivatives, preserving chromatic boundaries as well as luminance boundaries.
- Find the globally minimum-cost connected vertical seam by dynamic programming and backtracking.
- Remove exactly one pixel from each row without resampling surviving pixels.
- Remove the corresponding pixels from both masks and the original-coordinate index map, then recompute energy for the next seam.
- For height reduction, transpose image and masks, use the same seam solver, then transpose back. Width reduction precedes height reduction.

Optional masks contain one byte per input pixel; zero is unmarked. Protect pixels receive a strong positive penalty and remove pixels a negative penalty. Protection wins when the masks overlap. Full-width protected bands can make an unprotected seam impossible; `protectedRemoved` explicitly counts unavoidable protected deletions instead of promising impossible preservation. `markedRemoved` counts removed brush pixels. `seamMap` marks all removed pixels in the original source coordinate space; returned masks use resized output coordinates.

Each output dimension may be40–100% of its source dimension. This study performs reduction, not enlargement. It uses the original backward-energy approach, not forward energy or automatic object recognition. Crowds, repeated patterns and rigid straight lines may distort even with mathematically optimal seams; brush guidance can help but is not a semantic guarantee. Preview dimensions shrink as seams are removed.

## Verification

`node --test tests/rendering-studies.test.js` covers decreasing weighted centroid energy; density response; deterministic seeds; white/transparent inputs; curved isophotes; multiscale detail response; solid-image fidelity; exact seam optimum including negative costs; pixel-order preservation; protection/removal conflict; mask propagation through both axes; immutable inputs/progress; and size limits.

On one local Node22 run with a320×320 sculpture photo: stippling1800sites/16iterations took262ms, painting3553strokes took548ms, and removing96vertical seams took199ms. These are individual local measurements, not cross-device performance claims. Cancellation should terminate the worker, and all three studies have bounded inputs.
