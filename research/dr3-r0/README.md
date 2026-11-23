# DR3-R0 / A0 — CPU analytic falsification preflight (RESEARCH ONLY)

> **Status 23 Nov 2026:** research execution authorized in [Issue #73](https://github.com/netkeep80/fgm-platform/issues/73). **No renderer backend selection, no normative acceptance, no production code, no main merge.**

## Authority, exact source and pre-registration

- Approved plan: [DR3-A–H index](https://github.com/netkeep80/fgm-platform/issues/54#issuecomment-7053636697), [DR3-E R0 cases/measurements](https://github.com/netkeep80/fgm-platform/issues/56#issuecomment-7053590542), [DR3-D/E1 16 events and R0-21](https://github.com/netkeep80/fgm-platform/issues/56#issuecomment-7053810653).
- Author separately authorized execution in [Issue #73](https://github.com/netkeep80/fgm-platform/issues/73). [Pre-registered A0 experiment before reported run](https://github.com/netkeep80/fgm-platform/issues/73#issuecomment-7094989831).
- BASE main: `59f11fc44078c66759b77e7dcdc7809df3ba60f3`; TREE `f4aa18098ade371bf427ae2612edd84e15878ea6`.
- First frozen research script commit: `262bf2b1acd132157f1587546648c9b1c7b6707f`; research file `r0-preflight.mjs` SHA-256 `0346d142ac04d9b84239e52f8faaee815c272a9f85d9d81128472e7d2ab1c9ef`; Git blob `5ca658c4d11142d99a6d48bb89bea9d1054f9af9`.
- Seven-box synthetic fixture SHA-256 `7becb398c34e776c180963ce947dcf2f7a91894c0f96ff392daf2e81401a9d1a`.
- Runtime: Linux x86-64 container, AMD EPYC 9V74 (5 logical CPUs visible), Node.js v22.16.0, **GPU unavailable**. One pre-reg run; host load and p95 confidence **not controlled**.

## Reproduction

From repository root, on the **research branch** (not main):

```sh
node research/dr3-r0/r0-preflight.mjs
```

Check exit status 0, six `PASS` records, no `FAIL`, and machine-readable `R0_PREFLIGHT_JSON` final line. No npm dependencies or private UFO assets are required. A preliminary debugging pilot occurred before preregistration and **is excluded** from the measured data below.

## Design of the preflight

Independent **O-H** global ray vs axis-aligned box intersection using slab intervals; candidate uses separately implemented six global surface-plane intersections, associates hits with 1/8/64 deterministic spatial buckets and merges by world-ray `t` then priority/instance/face. **This candidate does not perform real partial FGM extraction, true localized clipping or certified culling**: it computes the global primitive faces first. Thus it checks order-independent first-hit composition of supported analytic surfaces, **not** scalability of independent regional geometry or an implementation of E2 cached sprites.

Orthographic rays: parallel for each yaw/pitch, fixed global subpixel lattice (40×40×4 spp for 9 orientations + 48×48×4 spp baseline). Depth tolerance 1e-9; hit/instance/face exact. No normal/UV, textures, R05 pixel parity, shadows, game LOS, real CSG or arbitrary FGM solver.

## Pre-registered execution results

| Probe | Actual observation | Narrow interpretation |
|---|---|---|
| 9 viewpoints × 40×40 × 4 spp × 1/8/64 | 172,800 sample-candidate comparisons, **0 mismatches** | Analytic world-face hit/depth/semantic ID for the chosen finite fixture |
| Baseline 48×48 × 4 spp × 1/8/64 | **27,648 comparisons, 0 mismatches**; 4,277 hit samples / 4,939 misses | Same class; not independent FGM fragmentation |
| Deliberately wrong clipped-box physical cap | True exit `t=1.5`, wrong cap `t=0.5` | Negative control: cell clip planes must not become object surfaces |
| Integer pan and fractional pan reuse | Exact 1-pixel shift: **0** disagreements; 0.5-pixel naive reuse: **278** disagreements | Phase compatibility cannot be assumed for fractional pan |
| Hidden previously nonvisible contributor | Winner `old` → `new`, earlier visible-only cache would be stale | Requires scene revision/conservative candidate dependency |
| Offscreen anchor, actual overhang intersects ray | `anchor_x=4`, visible hit `overhang`; anchor-only cull loses it | Negative control for R0-21; not a proof of certified culling |
| Opaque texture tick vs cutout | Opaque tick preserves hit; removing opaque front reveals `rear` | Conceptual cutout visibility counterexample, not a UV/alpha sampler implementation |

**CPU exploratory timing (48×48 × 1 spp; 11 runs each, first two discarded):**

| Algorithm (not E0/E2) | p50 | p95 | min–max |
|---|---:|---:|---:|
| Global slab oracle O-H | 1.309 ms | 1.524 ms | 1.226–1.524 ms |
| Independent face enumeration + 8-region bucket merge | 14.312 ms | 15.732 ms | 13.496–15.732 ms |

These **do not compare actual renderer implementations**. The second path does more arithmetic and allocations. A slower result here is **not** evidence to reject cached sprites, nor is a zero-error sample evidence that cached sprites or RVI will be efficient. No GPU, VRAM measurements, predeclared adoption speedup or confidence bounds exist. Recorded local pre-reg execution log SHA-256 `b02d75fcb9f576aae3456afa5aab154ee2faf773b6f4a88bc90cf4971879a38c`; JSON-line SHA-256 `510442810e09d94de4f1584da88e1d2d524639e3751395e1ca6bce3f05e19967`.

## Case coverage (a preflight observation is not a full R0 case PASS)

| Case(s) | A0 state | Remaining independent obligation |
|---|---|---|
| R0-01 / 03 / 04 / 06 / 09 / 10 | **PARTIAL_ANALYTIC** | True semantic prototype/instance registry, CSG/material priority at same-depth, full two-floor visible pick, free ortho and calibrated R05, real per-cell FGM extraction/UV/normals |
| R0-05 | **NEGATIVE_CONTROL_ONLY** | Actual serialized nested FGM-0 CSG/subtraction and global Core semantic oracle |
| R0-11 / 12 | **NEGATIVE_CONTROL_ONLY** | Per-instance opaque sampler, animated material, subpixel cutout and recomposition |
| R0-15 | **NEGATIVE_CONTROL_ONLY** | UserChangeSet and formally certified incremental dependency closure |
| R0-18 | **PARTIAL_ANALYTIC** | Cold/warm actual sprite shift and phase keys with proper resource updates |
| R0-21 | **NEGATIVE_CONTROL_ONLY** | Rotated/tall overhang across MapBlock and floors, subpixel and certified conservative 3D bounds |
| R0-02 / 07 / 08 / 13 / 14 / 16 / 17 / 19 / 20 | **NOT_RUN** | Block boundary, thin wall/AA, true fractal, moving door/light, 50×50, real FGM-0/R07, GPU loss, UV/mips/atlas |
| 16 DR3-D/E1 cache events | **NOT_RUN AS COLD/WARM MATRIX** | Full 16×6 state matrix needs actual instrumented L0–L5 cache and fresh oracle |

**R0-E0…E5: NOT_RUN.** **O-F actual serialized FGM-0: NOT_RUN. O-G independent triangle oracle: NOT_RUN. O-X authentic source/game: NOT_RUN.** **G0: PARTIAL_ANALYTIC only; G1/G2/G3/G4: PENDING.**

## Next independent research phases (not approved as backend or Production)

1. **R0-B:** same serialized supported FGM-0 through actual Core and separate certified ray/triangle oracle; R07-derived mesh; negative unknown bounds; true boundary fragments, CSG and counterexamples R0-02/05/07/17/21.
2. **R0-C:** measured matched E0/E2/E3/E4/E5 comparisons at fixed device, view/lattice/quality, actual WebGPU capability, tracked CPU/GPU memory and cold/warm/orbit churn; certify optional pruning before claiming RVI gain.
3. **R0-D:** all 16 DR3-D/E1 events fresh vs warm selective L0–L5 replay, invalidation traces (incl new occluders, cutout, GPU loss and stale epochs), UV/normal/filter/lighting and source/game separation.
4. **Independent scientific READ-ONLY audit** of exact research artifacts and primary measurements, then **separate** author backend decision; never infer approval from this preflight.

### COMPLEXITY_DELTA

No production complexity added: all new files under `research/dr3-r0/` only, no change to RendererSession/Core/WASM, Studio, workflow, requirements, Pages, public assets or source-game data. Proposed optional octree/cache and GPU ABI remain unchosen. Scientific debt is explicit, not hidden.
