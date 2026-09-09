# Local validation

No GitHub Actions workflow is needed to run these checks. Algorithm unit tests use Node's built-in test runner. Browser checks are explicitly opt-in and run on the developer's machine.

## Algorithm checks

Run `npm test` to test the geometry, sampling, patch matching, synthesis, simulation, and image-processing implementations. The browser script detects Node's test-runner context and exits before importing Playwright, so the normal test suite remains dependency-free.

## Interactive browser checks

Start the standalone study site with `npm start`. Then run:

```sh
node tests/browser-studies.mjs
STUDIES_BROWSER=webkit node tests/browser-studies.mjs
```

The script uses the optional Playwright development dependency installed by `npm install`. Override `PLAYWRIGHT_MODULE` with an absolute path or importable module name on another machine. It accepts `STUDIES_BROWSER=chromium|firefox|webkit`, `STUDIES_URL` (default `http://127.0.0.1:5182`), and `STUDIES_QA_DIR` (default `/tmp/graphics-studies-browser-qa`). Install the selected browser through Playwright if it is not already available.

The test launches the actual shared experiment UI and module workers. It waits for completed processing rather than accepting the precomputed result image as evidence. It checks:

- All ten experiments produce actual nonempty, varied result pixels.
- PNG downloads have valid signatures and the same dimensions as their computed canvases; stippling also produces an SVG with circles.
- Seam-carving controls change the output width, and protection masks paint visibly.
- PatchMatch masks paint and affect reconstruction; correspondence visualization changes the canvas.
- MLS pointer dragging changes the downloaded image itself, beyond the pin overlay; keyboard position inputs and adding/removing pins work.
- Tree orbit changes rendered pixels and the skeleton toggle updates its pressed state.
- Fluid injection changes pixels, pause freezes successive frames, and resume/cancel work.
- HDR and hybrid component views differ from the combined result.
- A local PNG upload changes input/output dimensions; malformed images produce a handled error.
- Canceling during deliberately delayed input loading cannot restart the computation when the file arrives.
- Reset disables previously available output actions such as SVG export.
- All ten layouts fit a 390px viewport without horizontal document overflow.
- No uncaught page errors or failed network requests occur.

## Verified runs

On September 8, 2026, the full interactive suite passed in Chromium and WebKit using the local standalone site, including actual 256px Image Analogies synthesis and local upload/download operations. Results and screenshots are written to the selected local QA directory; these are execution artifacts rather than committed success snapshots.

These checks do not establish an external-device performance guarantee or perfect visual quality for arbitrary uploaded images. Each study documents algorithmic limitations, and previews deliberately bound the workload.
