# Ten research studies

User-selected studies: weighted Voronoi stippling; painterly rendering; seam carving; PatchMatch completion; moving-least-squares image deformation; space-colonization trees; stable fluids; hybrid images; bilateral HDR tone mapping; image analogies.

All implemented in GraphicsStudies and imported by the portfolio, with actual browser playgrounds, algorithm-generated examples, citations and honest scope notes. Preserve quilting and transfer. No GitHub Actions in this repository. Publish via PRs and merge. Portfolio retains its minimal CI.

Completion checklist for each: dedicated pure algorithm module, deterministic fixtures/tests, working controls, usable defaults and real examples, responsive and keyboard-accessible UI, cancellation/cleanup where expensive, source attribution and implementation limits.

## Modules
- [x] Stippling: weighted centroidal Voronoi relaxation; SVG and PNG.
- [x] Painterly: coarse-to-fine curved strokes following isophotes.
- [x] Seam carving: energy, dynamic programming, protect/remove masks.
- [x] PatchMatch: randomized nearest-patch field and iterative hole reconstruction.
- [x] MLS: affine/similarity/rigid deformation with draggable and keyboard control handles.
- [x] Trees: seeded attraction points and 3D space colonization, branches/leaves and orbit controls.
- [x] Fluids: 2D grid diffusion, semi-Lagrangian advection, pressure projection, dye interaction.
- [x] Hybrid images: alignment, Gaussian low/high frequencies, scale preview.
- [x] HDR: real float radiance, bilateral base/detail split, compression/exposure.
- [x] Analogies: paired exemplar pyramids, appearance/coherence matching, coarse-to-fine synthesis.

## Release
- [x] Portfolio collection and ten routes; all source links.
- [x] Computed example generation and provenance.
- [x] Node tests, portfolio lint/build/unit and browser tests.
- [x] Mobile/desktop visual QA.

Release procedure: side repository PR and merge, then immutable portfolio package pin, PR and merge.
Verify the deployed routes or attach a completion monitor if the production build is still in progress.
