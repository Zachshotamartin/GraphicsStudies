# Stippling, painting, and content-aware resizing

These modules are deterministic, dependency-free ES modules. They run in Node or a browser worker. Each accepts an RGBA `source` (`width`, `height`, and a `Uint8ClampedArray`), yields independent RGBA progress frames, and returns an RGBA result. Inputs are limited to 8–512 pixels on each side; callers should downsample larger uploads before starting.

## Weighted Voronoi stippling

**Research:** Adrian Secord, [Weighted Voronoi Stippling](https://lhf.impa.br/cursos/rr/p37-secord.pdf), NPAR 2002, [DOI](https://doi.org/10.1145/508530.508537).

`stipple({source, count:8000, iterations:16, seed:42, paper:[245,243,231], ink:[27,44,40]})`

- Seed sites from the source's luminance-derived darkness distribution using a cumulative density table and a reproducible pseudorandom generator.
- Build an exact nearest-neighbor k-d tree for the sites on every iteration.
- Assign raster samples to their nearest site and integrate their positions with weight `rho = darkness²`. This implementation chooses the squared density to compensate for planar CVTs' approximate square-root relationship between centroid weight and site density. Initialization remains proportional to linear darkness.
- Move every nonempty site to its weighted centroid (Lloyd relaxation). Empty sampled cells retain their sites, avoiding random jumps during relaxation.
- Integrate **linear** darkness separately within each sampled cell to determine its ink area. Set the radius from that area, independently of the squared centroid weight. The darkest cells receive a bounded circle-packing correction so they can close the gaps between overlapping disks rather than stopping at mid-gray.
- Render antialiased circular ink marks on paper. Their raster footprints are normalized to the disk area, so subpixel dots do not accumulate an artificially dark fringe. Output `points:[{x,y,r}]` supports a genuine SVG drawing with one consistent ink color and locally adjusted radii. All contrast comes from these circles; there is no image layer or contrast filter behind them.

The quadrature grid targets twelve samples per site, preserves the source aspect ratio, and is bounded by the full source raster (up to 512 × 512). A square 512px source uses 310 × 310 samples for 8000 sites and 490 × 490 for 20000 sites. Thin or small images use their full raster when twelve samples per site are unavailable. This approximates the continuous weighted integral; it does not compute explicit Voronoi polygon boundaries. `energy` reports the squared-distance integral weighted by `darkness²`, normalized by total linear darkness, before each iteration's centroid update. Its decrease is tested. All-white/transparent images return blank paper, not arbitrary dots.

Controls: 8–20000 requested dots, with 8000 as the default, 1–30 iterations, and seed. Site count is capped only to the source pixel count for tiny inputs; a 512 × 512 input retains all 20000 sites. `requestedCount` and `actualCount` make that cap explicit. Progress is emitted once per iteration. The result includes the final sites, colors, actual iteration count and integration-grid dimensions.

For cell `i`, the ink-area target is `sum(darkness) × sampleArea`. The circle-packing factor is one through 75% darkness, then rises smoothly to at most 1.28 at black. This is a documented tonal-rendering adaptation to Secord's centroid-relaxation method, not a claim to reproduce the paper's exact mark-sizing scheme. It preserves light and middle tones while letting dark marks overlap. Because circles, sampled cells, and raster pixels do not tile identically, exact photographic tone is not guaranteed; the implementation tests regional contrast and bounded error instead.

Increasing the count makes smaller, more closely spaced marks without a fixed minimum radius. Raster antialiasing conserves each disk's area before overlap; the pale-input regression compares 500-dot and 8000-dot renderings, both approximately 1.96% ink for a 250/255 source. Additional tests cover a five-step tonal ramp and a dark scene with bright circular lights and a thin illuminated beam. SVG retains subpixel circles even where an 8-bit raster cannot represent their smallest tonal contribution.

On one local Node22 run, a 512 × 512 shell photo at 5000 dots and thirty passes took 1.30 seconds. The same settings on a synthetic night fixture took 1.67 seconds; the dark region retained over 92% ink coverage while bright lights remained approximately 95% paper. The previous global-area scaling produced a gray background instead. These are fixture-specific measurements, not cross-device performance guarantees; the synthetic scene is a regression fixture, not a claim to have processed a visitor's unavailable original photograph.

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
