const range = (key, label, min, max, step, value) => ({
  key,
  label,
  min,
  max,
  step,
  value,
});
const select = (key, label, values, value) => ({ key, label, values, value });
export const experiments = [
  {
    id: "stippling",
    title: "Weighted stippling",
    category: "Rendering",
    source: "stippling-shell",
    size: 512,
    paper: "https://lhf.impa.br/cursos/rr/p37-secord.pdf",
    citation: "Adrian Secord · 2002",
    description:
      "Thousands of dots settle into an image. Darker regions attract more ink; weighted Voronoi cells keep the distribution even.",
    controls: [
      range("count", "Dots", 500, 20000, 500, 8000),
      range("iterations", "Relaxation passes", 1, 30, 1, 16),
      range("seed", "Seed", 1, 100, 1, 42),
    ],
    hint: "Start with 8,000 dots or raise the count to 20,000 for finer detail. Download SVG to inspect individual dots at any scale.",
    method: [
      "Sample an initial point distribution according to image darkness.",
      "Assign image samples to their nearest point, forming Voronoi cells with squared-darkness centroid weights.",
      "Move points toward weighted centroids and size each ink circle from its cell’s local darkness; repeat to refine.",
    ],
    limit:
      "Raster-sampled weighted Lloyd relaxation with exact nearest-site queries. This is a bounded preview, not an analytic continuous Voronoi integration.",
  },
  {
    id: "painterly-rendering",
    title: "Painterly rendering",
    category: "Rendering",
    source: "harbor",
    size: 384,
    paper:
      "https://mrl.cs.nyu.edu/publications/painterly98/hertzmann-siggraph98.pdf",
    citation: "Aaron Hertzmann · 1998",
    description:
      "Repaint a photograph with curved strokes, starting with broad shapes and returning for smaller details.",
    controls: [
      range("brushSize", "Largest brush", 4, 28, 1, 12),
      range("detail", "Detail", 0, 1, 0.05, 0.65),
      range("seed", "Seed", 1, 100, 1, 42),
    ],
    hint: "Run a painting, then replay its strokes in the order they were laid down.",
    method: [
      "Blur the reference at each brush scale.",
      "Find areas where the canvas differs from the reference, and seed strokes there.",
      "Follow image-gradient tangents to bend strokes along forms; refine with smaller brushes.",
    ],
    limit:
      "A multiscale curved-stroke study with a software rasterizer. It does not simulate wet paint, pigment, or a physical bristle brush.",
  },
  {
    id: "seam-carving",
    title: "Seam carving",
    category: "Image editing",
    source: "seam-balloons",
    protectRegions: [[0.095, 0.22, 0.275, 0.58], [0.72, 0.235, 0.91, 0.585]],
    size: 384,
    paper:
      "https://cs.brown.edu/courses/cs016/static/files/docs/seamcarving_original_paper.pdf",
    citation: "Shai Avidan & Ariel Shamir · 2007",
    description:
      "Make an image narrower by removing low-energy paths through it, with painted masks to protect the parts that matter.",
    controls: [
      range("widthRatio", "Output width", 0.4, 1, 0.05, 0.7),
      range("brush", "Mask brush", 3, 40, 1, 14),
      select(
        "maskMode",
        "Paint mode",
        ["protect", "remove", "erase"],
        "protect",
      ),
    ],
    hint: "Paint on the source to protect a subject or mark an area for removal. Green protects; coral attracts seams. Keyboard: focus the source and use arrows to move and paint.",
    method: [
      "Measure local image gradients to build an energy map.",
      "Use dynamic programming to find the lowest-energy connected top-to-bottom seam.",
      "Remove it, update the image and masks, then find the next seam.",
    ],
    limit:
      "Uses backward gradient energy and removes vertical seams. Large changes can bend straight lines or distort faces; a protection mask cannot guarantee an undistorted result.",
  },
  {
    id: "patchmatch",
    title: "PatchMatch completion",
    category: "Image editing",
    source: "patchmatch-gravel",
    maskRegions: [[0.56, 0.48, 0.65, 0.725]],
    size: 256,
    paper: "https://gfx.cs.princeton.edu/pubs/Barnes_2009_PAR/",
    citation: "Barnes, Shechtman, Finkelstein & Goldman · 2009",
    description:
      "Paint out an object and let matching patches from elsewhere in the image fill the gap.",
    controls: [
      range("iterations", "Refinement passes", 1, 10, 1, 6),
      range("patchSize", "Patch width", 3, 13, 2, 7),
      range("brush", "Mask brush", 3, 35, 1, 10),
      range("seed", "Seed", 1, 100, 1, 42),
    ],
    hint: "The red bottle and its shadow are masked already. Add to the coral mask, or clear it and paint another region. Keyboard: focus the source and use arrows to move and paint.",
    method: [
      "Initialize a random field of candidate patches outside the hole.",
      "Alternate neighbor propagation with progressively smaller random searches.",
      "Reconstruct missing pixels from the matched patches and refine, while keeping known pixels unchanged.",
    ],
    limit:
      "A single-image completion loop built around PatchMatch. It can copy texture and nearby structure; it cannot invent a missing object or reconstruct a large unknown scene.",
  },
  {
    id: "image-deformation",
    title: "Moving least squares",
    category: "Image editing",
    source: "deformation-leaf",
    pins: [[0.5, 0.89], [0.5, 0.56], [0.19, 0.49], [0.35, 0.16], [0.66, 0.17], [0.85, 0.48]],
    examplePin: { index: 4, to: [0.77, 0.29] },
    size: 384,
    paper: "https://people.engr.tamu.edu/schaefer/research/mls.pdf",
    citation: "Schaefer, McPhail & Warren · 2006",
    description:
      "Pin an image in place, pull one point, and watch the surrounding shape bend through a field of local transformations.",
    controls: [
      select(
        "mode",
        "Local transform",
        ["rigid", "similarity", "affine"],
        "rigid",
      ),
      range("alpha", "Pin influence", 0.5, 3, 0.25, 1),
      select("boundary", "Image border", ["fixed", "free"], "fixed"),
    ],
    hint: "Drag a pin to deform the image. Double-click to add one. The selected pin also has keyboard-accessible position controls.",
    method: [
      "Give nearby control points more influence than distant ones.",
      "Solve a weighted rigid, similarity, or affine transformation separately at each mesh vertex.",
      "Warp a triangle mesh forward and resample its pixels, keeping control points interpolated.",
    ],
    limit:
      "The continuous deformation is approximated by a triangulated image mesh. The fixed-border option anchors the image edge; free borders can reveal transparent regions. Extreme crossed pins can still fold the mesh.",
  },
  {
    id: "tree-growth",
    title: "Space-colonization trees",
    category: "Simulation",
    source: null,
    size: 640,
    paper: "https://algorithmicbotany.org/papers/colonization.egwnp2007.html",
    citation: "Runions, Lane & Prusinkiewicz · 2007",
    description:
      "Grow a branching tree toward a cloud of attraction points. Its shape emerges from competition for space.",
    controls: [
      select(
        "canopy",
        "Canopy",
        ["round", "columnar", "spreading", "conical"],
        "round",
      ),
      range("count", "Attraction points", 300, 2000, 100, 1200),
      range("seed", "Seed", 1, 100, 1, 42),
      select("obstacle", "Avoid obstacle", ["off", "on"], "off"),
    ],
    hint: "Drag the tree to orbit it. Changing the seed, canopy, or attraction points automatically grows a new tree.",
    method: [
      "Seed a three-dimensional canopy volume with attraction points.",
      "Grow each branch toward the average direction of nearby unclaimed points.",
      "Remove reached points and thicken parent branches according to their descendants.",
    ],
    limit:
      "A geometric growth model, not a botanical or light-transport simulation. Branch competition and spherical obstacles shape the canopy; leaves are simplified for the preview.",
  },
  {
    id: "stable-fluids",
    title: "Stable Fluids",
    category: "Simulation",
    source: null,
    size: 320,
    paper:
      "https://www.dgp.toronto.edu/public_user/stam/reality/Research/pdf/ns.pdf",
    citation: "Jos Stam · 1999",
    description:
      "Stir colored dye through a two-dimensional fluid. Diffusion, advection, and pressure projection evolve the field.",
    controls: [
      range("viscosity", "Viscosity", 0, 0.003, 0.0001, 0.0001),
      range("diffusion", "Dye diffusion", 0, 0.001, 0.00005, 0),
      select("dye", "Dye color", ["mint", "coral", "gold"], "mint"),
    ],
    hint: "Start the simulation, then drag across the canvas to inject dye and momentum. Pause to inspect a frame. Keyboard: focus the canvas and press arrows to stir.",
    method: [
      "Inject forces and dye, then diffuse them across the grid.",
      "Trace backward through the velocity field to advect quantities.",
      "Solve for pressure and subtract its gradient to reduce divergence.",
    ],
    limit:
      "A bounded two-dimensional grid with closed walls and numerical dissipation. Stability does not mean perfect accuracy or conservation; this is not a three-dimensional water renderer.",
  },
  {
    id: "hybrid-images",
    title: "Hybrid images",
    category: "Perception",
    source: "fox",
    other: "owl",
    size: 384,
    paper: "https://doi.org/10.1145/1141911.1141919",
    citation: "Oliva, Torralba & Schyns · 2006",
    description:
      "Combine the fine detail of one image with the broad structure of another. What you see changes with viewing distance.",
    controls: [
      range("sigma", "Frequency cutoff", 2, 18, 0.5, 7),
      range("detail", "High-frequency strength", 0, 2, 0.1, 1),
      range("alignX", "Horizontal alignment", -0.3, 0.3, 0.01, 0),
      range("alignY", "Vertical alignment", -0.3, 0.3, 0.005, 0.055),
      range("alignScale", "Second image scale", 0.7, 1.3, 0.02, 0.84),
    ],
    hint: "Compare the large result with the small distance preview. Align the eyes before adjusting the frequency cutoff.",
    method: [
      "Low-pass filter the first image with a Gaussian kernel.",
      "Subtract a Gaussian-blurred version from the second to isolate high frequencies.",
      "Align and add the two frequency bands, then inspect the result at different sizes.",
    ],
    limit:
      "Perception depends on alignment, contrast, display size, and viewing distance. Not every pair produces a convincing switch.",
  },
  {
    id: "hdr-tone-mapping",
    title: "HDR tone mapping",
    category: "Rendering",
    source: "lebombo",
    size: 384,
    paper: "https://people.csail.mit.edu/fredo/PUBLI/Siggraph2002/",
    citation: "Frédo Durand & Julie Dorsey · 2002",
    description:
      "Compress a high-dynamic-range photograph for a regular display while preserving detail in its bright and dark regions.",
    controls: [
      range("contrast", "Base contrast", 2, 50, 1, 12),
      range("detail", "Detail strength", 0, 2, 0.1, 1),
      range("exposure", "Exposure", -3, 3, 0.25, 0),
      range("range", "Edge sensitivity", 0.1, 1, 0.05, 0.4),
      range("spatial", "Spatial radius", 2, 12, 1, 6),
    ],
    hint: "Compare the tone-mapped image with a plain exposure, or inspect the separated base and detail layers. Upload a Radiance .hdr file.",
    method: [
      "Decode RGBE pixels into linear floating-point radiance.",
      "Separate log intensity into an edge-preserving bilateral base and a detail residual.",
      "Compress only the base, reintroduce detail and color ratios, then encode for an sRGB display.",
    ],
    limit:
      "Uses a direct, spatially sampled bilateral filter at preview resolution rather than the paper’s accelerated implementation. Sample HDR: Lebombo by Greg Zaal, Poly Haven, CC0.",
  },
  {
    id: "image-analogies",
    title: "Image Analogies",
    category: "Image editing",
    source: "analogies-courtyard",
    filtered: "analogies-engraved",
    filteredExtension: "png",
    other: "analogies-arcade",
    size: 256,
    paper: "https://mrl.cs.nyu.edu/publications/image-analogies/",
    citation: "Hertzmann, Jacobs, Oliver, Curless & Salesin · 2001",
    description:
      "Learn a photo-to-engraving relationship from an aligned example pair, then synthesize the treatment on a different architectural photograph.",
    controls: [
      range("levels", "Pyramid levels", 1, 4, 1, 3),
      range("coherence", "Spatial coherence", 0, 2, 0.1, 0.1),
      range("candidates", "Search candidates", 16, 128, 16, 128),
      range("seed", "Seed", 1, 100, 1, 42),
    ],
    hint: "A and A′ must be an aligned pair. The sample A′ is a registered engraving of the courtyard; B is a separate arcade photograph.",
    method: [
      "Build matched Gaussian pyramids for A, A′, and the new image B.",
      "Compare source appearance and already-synthesized neighborhoods to find candidate correspondences.",
      "Choose between appearance matches and coherent neighbor predictions, then copy pixels from A′ into B′.",
    ],
    limit:
      "A small, bounded multiresolution synthesis study with sampled search. It does not use a neural network or infer semantic style; patch artifacts are visible, especially across unrelated scenes.",
  },
];
export const getExperiment = (id) => experiments.find((item) => item.id === id);
