# Bilateral HDR tone mapping

Based on Frédo Durand and Julie Dorsey, *Fast Bilateral Filtering for the Display of High-Dynamic-Range Images*, SIGGRAPH2002. [Paper and implementation notes](https://people.csail.mit.edu/fredo/PUBLI/Siggraph2002/).

`decodeRadiance` decodes RGBE scanlines, including modern run-length encoding, into linear RGB floats. It supports Y-major orientations, rejects malformed runs and legacy repeat markers, bounds source dimensions to16MP, and area-averages into a preview no larger than512px. Float64 accumulation prevents overflow while downsampling valid high radiance; the returned values use Float32.

`toneMap` computes intensity `(20R+40G+B)/61`, separates its base10 logarithm into a bilateral base and detail residual, and scales only the base contrast. Output preserves source color/intensity ratios, restores detail, applies exposure, and encodes sRGB. The base and residual can be inspected separately. `exposurePreview` provides a plain exposure baseline.

The original paper accelerates bilateral filtering using a piecewise-linear intensity approximation. This version uses a direct bilateral filter with a bounded, spatially sampled window. The center is always included, even when a fractional radius and sampling stride would otherwise skip it. The UI operates at384px; this is not a full-resolution production HDR pipeline. EXR, color profiles and alternate Radiance encodings are outside this implementation’s scope.

Tests cover exact RGBE values, truncated files, downsampling overflow, invalid allocation parameters, constant and black inputs, exposure response, chromatic ordering, contrast compression, and finite internal metadata for a one-pixel image with fractional filter radius.
