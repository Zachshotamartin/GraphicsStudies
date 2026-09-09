# Growth, flow, and spatial-frequency studies

These are actual numerical implementations. Example images are produced from the same modules used by the browser playgrounds. No pretrained models or external computation services are required.

## Space-colonization trees

Reference: Adam Runions, Brendan Lane and Przemyslaw Prusinkiewicz, [Modeling Trees with a Space Colonization Algorithm (2007)](https://algorithmicbotany.org/papers/colonization.egwnp2007.html).

`src/algorithms/trees.js` exports `growTree(options)`, a synchronous generator. Consume its yields for progress and its final return value for the completed graph. The algorithm distributes seeded attraction points inside a crown volume, assigns each point to its nearest branch node within an influence radius, averages the attraction directions, grows one segment per influenced node, and removes points reached within a kill radius. A spatial hash accelerates the nearest-node queries.

```js
const generator = growTree({ seed: 42, canopy: 'round', count: 1200 });
let result;
do {
  result = generator.next();
  renderTree(result.value);
} while (!result.done);
```

The root is at `(0,0,0)`, Y is up, and the default height is 2 world units. Default width is 1.55. All presets use this coordinate system, so an orbit camera can remain stable while parameters change.

Parameters:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `seed` | `42` | Deterministic attraction sampling and leaf arrangement |
| `count` | `1200` | Attraction points; 32–5000 |
| `canopy` | `'round'` | `'round'`, `'spreading'`, `'columnar'`, or `'conical'` |
| `width`, `height` | `1.55`, `2` | Crown size and total tree height |
| `trunkHeight` | `0.52` | Lower boundary of the crown; spreading crowns start higher |
| `segmentLength` | `0.055` | Length of each growth step |
| `influenceRadius` | `0.28` | Maximum distance at which a point attracts a branch |
| `killRadius` | `0.095` | Distance within which a point has been reached |
| `tropism` | `0.045` | Small upward bias; may be negative |
| `iterations` | `180` | Maximum growth iterations |
| `obstacles` | `[]` | Spherical exclusions `{x,y,z,r}`, up to 16 |
| `leaves` | `true` | Include attached leaf geometry descriptors |

Each snapshot contains `nodes`, `leaves`, remaining `attractors`, `progress`, `iteration`, `consumed`, `total`, `complete`, `exhausted`, and the crown dimensions/obstacles. A node has `{x,y,z,parent,radius}`. Parents always precede children; the root's parent is -1. Leaf descriptors have `{x,y,z,angle,tilt,scale,tone,node}`. The optional `tone` in `[0,1]` selects a renderer palette; it is not a lighting calculation. Snapshots own their arrays and objects, so earlier frames do not mutate when growth continues.

Branch thickness follows a pipe-model approximation: terminal cross-sectional contributions accumulate toward the root. Obstacle checks test entire branch segments, with clearance for the thickest branch, rather than testing just endpoints. Obstacles also repel nearby growth directions. Targets trapped behind an obstacle may remain unreached. The result reports this honestly through `consumed/total`; progress reaching 1 means the run finished, not that all attraction points were consumed.

Implementation additions to the paper's growth mechanism include explicit spherical obstacles, a small directional persistence term, four sampling volumes, and deterministic decorative leaves. This is a procedural branching study, not a species-accurate botanical simulator. There is no wind, bark mesh, pruning system, or self-collision solution; the renderer creates the branch/leaf appearance from the returned graph. Branch growth is capped at 12,000 nodes.

## Stable fluids

Reference: Jos Stam, [Stable Fluids (1999)](https://www.dgp.toronto.edu/public_user/stam/reality/Research/pdf/ns.pdf).

`src/algorithms/fluids.js` exports `StableFluid`, `seedFluid`, and `fluidDemo`. The simulator uses a staggered MAC grid: horizontal and vertical velocities live on cell faces, dye and pressure at cell centers. An implicit diffusion step handles viscosity. Semi-Lagrangian advection traces characteristics backward with a midpoint velocity sample and bilinear reconstruction. Pressure projection solves the discrete Neumann Poisson system using conjugate gradients, accelerated by an incomplete Cholesky preconditioner, then subtracts the pressure gradient.

```js
const fluid = new StableFluid(80, { dyeResolution: 192, viscosity: 0.00004, diffusion: 0.000005 });
fluid.addDye(0.45, 0.5, [67, 181, 171], 1, 0.05);
fluid.addForce(0.45, 0.5, 0.2, -0.1, 0.07);
fluid.step(1 / 60);
const rgba = fluid.image();
```

Pointer positions `(x,y)` and brush radii use `[0,1]` domain coordinates, independent of canvas resolution. RGB colors use 0–255. Velocity impulses use domain widths per second; call them with pointer deltas converted to domain units, not raw browser pixels. The solver caps accumulated velocities and dye concentrations to prevent an input burst from producing unusable values.

| API | Result or action |
| --- | --- |
| `new StableFluid(grid=96, params={})` | Square simulation grid, 16–192 cells per side |
| `addForce(x,y,vx,vy,radius=.06)` | Smooth compact velocity impulse |
| `addDye(x,y,rgb,amount=1,radius=.045)` | Add transported RGB concentrations |
| `step(dt=1/60, params={})` | Advance seconds, return diagnostics |
| `project(iterations)` | Pressure projection; returns before/after RMS divergence |
| `velocityAt(x,y)` | Bilinearly sampled velocity, useful for vector overlays |
| `image({background,exposure})` | New `{width,height,data}` RGBA image |
| `diagnostics()` | Finite-value check, divergence RMS/max, projection statistics, ink mass, kinetic energy, simulated seconds |
| `reset()` | Clear velocities, dye, pressure, and elapsed time |
| `seedFluid(fluid,time,{seed,strength})` | Three moving colored emitters for the continuous demo |
| `fluidDemo({grid,steps,seed,...params})` | Deterministic generator of computed example frames |

Default parameters are `viscosity=.00004`, `diffusion=.000005`, `decay=.18`, `damping=.07`, and `iterations=60`. Decay and damping are exponential rates per second; setting either to zero disables it. Pause by not calling `step`, not by resetting the instance. On reset, return the visual to the empty fluid state or restart the deterministic emitters. Pointer interaction should inject both momentum and dye, so movement visibly changes the flow.

Optional constructor parameter `dyeResolution` stores and transports dye on a denser grid while interpolating the coarser velocity field. It defaults to `grid` and can be increased up to 512. For example, 80 velocity cells and 192 dye pixels retain sharper colored traces without a 192-cell pressure solve. Output image dimensions follow `dyeResolution`. This is actual higher-resolution dye advection, not an image sharpening effect. It still costs more than equal-resolution dye, so 64/128 is a useful mobile pairing. It is fixed at construction time; reconstruct the simulator to change resolution.

The outer domain is closed. Normal face velocities are fixed to zero, and negative tangential ghost values impose no-slip walls. Dye diffusion has a no-flux boundary. `step` caps unusually long UI gaps at .15 seconds and substeps at .035 seconds; this avoids a tab returning from the background from suddenly simulating minutes of time.

This is a 2D visual fluid study. The solver is numerically dissipative, the pressure solve is approximate, and semi-Lagrangian transport does not exactly preserve scalar mass. It is not a physically certified CFD tool or a water-surface/free-boundary solver. No vorticity confinement or turbulence synthesis is secretly added. Run it in a worker, preferably at 30 visual frames/second with a 64–96 cell grid. Grid resolution and device speed materially affect cost; do not run a 192-cell grid on every animation frame by default. `image()` maps dye concentration to visible emission with an exponential exposure curve; this visualization is distinct from the simulation equations.

## Hybrid images

Reference: Aude Oliva, Antonio Torralba and Philippe G. Schyns, [Hybrid Images (2006)](https://doi.org/10.1145/1141911.1141919). [Full paper](https://pages.cs.wisc.edu/~dyer/cs534/papers/OlivaTorralb_Hybrid_Siggraph06.pdf).

`src/algorithms/hybrid.js` exports `hybrid(options)` and `gaussianRGB`. A hybrid is formed by adding a Gaussian low-pass version of one image to the signed high-pass residual of another:

`hybrid = Gaussian(source, sigma) + detail * (alignedOther - Gaussian(alignedOther, highSigma))`

The Gaussian is separable, has a normalized three-sigma kernel, and uses mirrored boundary sampling. The high-frequency image is fitted uniformly to cover the output aspect ratio, then transformed about its center with bilinear sampling. Alpha is composited against neutral gray before filtering, which avoids dark transparent fringes. Pixels beyond an alignment transform extend the nearest edge value.

```js
const result = hybrid({
  source, other, sigma: 6, highSigma: 4.2, detail: 1,
  alignment: { x: 0, y: 0, scale: 1 },
});
```

Both inputs are `{width,height,data}` RGBA bytes, 2–1024 pixels per dimension. Output dimensions follow `source`. Sigma is in output pixels, not source-image percentages. `highSigma` defaults to `sigma*.7`. Detail strength is 0–4. Alignment translations are fractions of output width/height; scale is .25–4. Optional `grayscale:true` uses luminance for both inputs.

The main return value is `{width,height,data}` plus `low`, `high`, and `aligned` RGBA image objects. `high` is centered on gray 128 for display; the true signed residual is returned separately in `highValues`. `lowValues` contains the unclipped low-pass values. The combination is clipped only when converted to output bytes. A small displayed thumbnail of the same result supplies the far-view demonstration; do not generate a different image for the far view.

This implementation operates on display RGB, not radiometrically linear HDR data. Pair choice and alignment are important: two unaligned subjects do not automatically produce a strong perceptual switch. The controls exist to make that dependency visible. There is no semantic detection, automatic eye matching, or learned image mixing.

## Validation

`node --test tests/simulation-studies.test.js` checks deterministic tree growth, connected parent ordering, 3D extent, taper, crown control, whole-segment obstacle clearance and immutable progress; fluid pressure divergence reduction, closed/no-slip boundaries, finite positive transported dye, fixed-point rest, diffusion, exact no-flow decay and deterministic emitters; and Gaussian constants/symmetry, zero high-pass constants, input preservation, alignment and frequency-control changes.

Algorithm tests are numerical. Browser integration still needs to verify actual rendering, drag coordinates, worker cleanup, pausing, control labels and mobile layout in the consuming site.
