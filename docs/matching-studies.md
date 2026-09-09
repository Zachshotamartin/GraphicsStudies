# Patch matching, image analogies, and deformation

These are independent, dependency-free browser/Node implementations. They compute their output from the provided pixel arrays. Screenshots and generated example photographs are input material, not substitute algorithm outputs. All coordinates are image pixels; images are `{ width, height, data: Uint8ClampedArray }` with RGBA channels.

## PatchMatch hole completion

**Reference:** Connelly Barnes, Eli Shechtman, Adam Finkelstein, and Dan Goldman, *PatchMatch: A Randomized Correspondence Algorithm for Structural Image Editing*, SIGGRAPH 2009. [Paper](https://gfx.cs.princeton.edu/pubs/Barnes_2009_PAR/patchmatch.pdf).

```js
import { completeImage } from './src/algorithms/patchmatch.js';
const frames = completeImage({ source, mask, patchSize: 7, iterations: 5, seed: 42 });
```

`mask` is one byte per source pixel. A nonzero byte marks an erased pixel; zero means preserve. Omitting the mask returns an exact copy. The generator yields an initialization frame and a frame after each search/voting iteration; its return value is the completed frame. Inputs are never modified.

The implementation builds an integral mask to exclude **all donor patches containing erased pixels**, then seeds a nearest-neighbor field for output patches that intersect the hole. Hole colors are initialized from nearest known pixels, so erased object colors cannot leak into the solution. Each iteration propagates neighboring patch offsets in alternating scan directions, then tests random candidates at exponentially shrinking radii. RGB patch error weights known context more heavily during early iterations. Overlapping matched patches cast confidence-weighted votes into the hole. Known pixels remain byte-identical throughout.

Every frame provides `width`, `height`, `data`, `progress`, `iteration`, `maskedCount`, and `patchSize`. `nnf` maps active target patch centers to source patch centers as linear pixel indices; inactive locations are -1. `mapping` identifies the source pixel casting the strongest vote at each output pixel. Since final colors average several overlapping votes, the strongest-vote map is an inspection aid, not a claim that every result pixel is copied from one location. `meanPatchError` is an internal current patch-distance measure, not a perceptual quality score or a guaranteed monotonic optimization objective.

**Bounds:** source dimensions 8–256; odd patch sizes 3–15; iterations 1–12. A mask with no intact donor patch is rejected with a clear error. The UI should show the selected region before running and allow changing it.

**Scope and limitations:** this is a single-resolution completion study of PatchMatch's randomized nearest-neighbor search, with patch voting. It does not implement the paper's entire multiscale structural editing system, bidirectional similarity optimization, user line constraints, retargeting, or perspective correction. Small texture holes work better than large regions containing unique objects or interrupted architecture. Patch voting can blur ambiguous regions. It is not a semantic/generative object-removal model.

## Image analogies

**Reference:** Aaron Hertzmann, Charles Jacobs, Nuria Oliver, Brian Curless, and David Salesin, *Image Analogies*, SIGGRAPH 2001. [Paper](https://mrl.cs.nyu.edu/publications/image-analogies/analogies-72dpi.pdf), [authors' project page](https://mrl.cs.nyu.edu/publications/image-analogies/).

```js
import { analogize } from './src/algorithms/analogies.js';
const frames = analogize({ source: A, filtered: Aprime, target: B,
  levels: 3, coherence: 0.5, candidates: 64, seed: 42 });
```

A and A′ must be spatially registered and have identical dimensions: a pixel in A corresponds to the same content in A′. B may have different dimensions. The generator synthesizes B′ from coarsest to finest Gaussian-pyramid levels, in causal scanline order. Every final pixel is a copy of a pixel from A′. There is no fixed filter applied directly to B, no neural model, and no training service.

The search descriptor combines:

- A/B luminance in a full 5×5 current-level neighborhood, plus a small RGB center feature to distinguish similarly bright colors.
- A′/already synthesized B′ RGB in the preceding half of that neighborhood; unknown future B′ pixels never participate.
- At levels above the coarsest, complete 3×3 neighborhoods in both source/target image pairs at the previous, coarser level.

Each neighborhood group is Gaussian weighted and normalized. Candidate search combines seeded random samples (including luminance-indexed candidates), a coarse-level prediction, and shrinking-radius search. A separate coherence search proposes locations implied by previously selected neighboring source coordinates. Its scale-dependent tolerance follows the paper's coherence-versus-appearance decision; the factor is squared because the implementation stores squared distances. Pixels are then copied from A′, and the process continues autoregressively.

Frames provide current-level `width`, `height`, `data`, `mapping`, `sourceWidth`, `sourceHeight`, monotonic overall `progress`, completed `level`, actual `levels`, and `candidates`. At intermediate pyramid levels these dimensions are smaller than the final result; `mapping` indexes the matching source level. The last frame has B's full dimensions and maps directly into full-resolution A′. Progress frames arrive every eight rows.

**Bounds:** all images 4–256 pixels per side; requested levels 1–4, automatically limited so the coarsest images retain at least a few pixels; candidates 8–256; coherence 0–8. Keep the browser default around 128–160 pixels and 64 candidates.

**Scope and limitations:** the causal multiscale paired-example model is implemented, but the paper's ANN tree is replaced by bounded randomized search. There is no steerable-filter descriptor, automatic luminance remapping, super-resolution mode, or claim to exactly reproduce the authors' results. Limited candidates may miss good matches. A single pair transfers local statistics; it does not understand subjects or reliably carry long, coherent artistic strokes between unrelated compositions. Registered, structurally rich exemplars with clear before/after changes are essential. Supplying unrelated images as A and A′ is not a valid training pair.

## Moving least squares deformation

**Reference:** Scott Schaefer, Travis McPhail, and Joe Warren, *Image Deformation Using Moving Least Squares*, SIGGRAPH 2006. [Paper](https://people.engr.tamu.edu/schaefer/research/mls.pdf).

```js
import { mapPoint, deform } from './src/algorithms/deformation.js';
const handles = [{ from: [30, 50], to: [42, 45] }, { from: [90, 50], to: [90, 50] }];
const position = mapPoint([60, 60], handles, { mode: 'rigid', alpha: 1 });
const result = deform({ source, handles, mode: 'rigid', alpha: 1, gridStep: 3 });
```

For every point, inverse-distance weights determine source and destination centroids. A local least-squares solve then produces an affine map, a similarity map (rotation plus uniform scale), or a rigid map (rotation without local scale). Exact control points return their exact destinations. Identity and single-handle translation are defined, as are duplicate identical pins. Contradictory destinations for one pin are rejected. Collinear affine pins cannot determine a unique affine transform; that case uses the similarity solution. Completely degenerate covariance safely falls back to centroid translation.

The image renderer applies the **forward** MLS map to a regular triangular grid, adding source pin coordinates to grid axes so pins fall on vertices. It rasterizes those forward-deformed triangles with barycentric texture coordinates and premultiplied-alpha bilinear pixel sampling. This avoids pretending that swapping source/destination pins gives an exact inverse deformation. Uncovered result pixels are transparent, and geometry outside the original-sized canvas is cropped.

**Bounds:** source 2–512 pixels per side; at most 32 handles; grid step 1–16; weight exponent 0.1–4. A smaller grid step samples the warp more accurately at greater cost. The result includes `vertices`, `triangles`, and `mode` alongside RGBA image data and `progress: 1`.

**Scope and limitations:** only point handles are implemented, not the paper's line-segment controls. The grid approximates the continuous map between vertices. Strong warps can fold over and overlap; later triangles draw over earlier ones, and no collision-free or invertible-map guarantee is made. Raster boundary antialiasing is not multisampled. The interface should use a transparent/checkered background and moderate initial handle movements.

## Validation

Run `node --test tests/matching-studies.test.js`.

The tests check known-pixel preservation, donor exclusion, erased-content independence, a quantitative repeated-pattern completion improvement, reproducibility, rejection of impossible inputs, paired-exemplar and target dependence, exact correspondence to A′, actual multiresolution progression, self-paired identity reconstruction, exact pin interpolation, translation, affine shear, similarity scaling, rigid rotation, degenerate handles, and forward image rasterization. They verify mathematical behavior rather than snapshots of one implementation.
