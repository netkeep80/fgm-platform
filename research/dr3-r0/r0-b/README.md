# DR3-R0-B — research-only B1 harness, candidate (not a result)

Scope [R2](https://github.com/netkeep80/fgm-platform/issues/73#issuecomment-7170869338), accepted [7171379063](https://github.com/netkeep80/fgm-platform/issues/73#issuecomment-7171379063), path permission [7171522565](https://github.com/netkeep80/fgm-platform/issues/73#issuecomment-7171522565). B1 point-only, B2/B3 NOT_RUN. BASE 0dee9d0a5362d1ed17cd266208ec116fe5f11b0e. No runtime changes. This initial candidate does not assert B-G02 PASS. F01–F05 fixtures and independent Fraction interpreter; sqrt admitted only for exact-square probes, not general sphere numeric coverage. Restricted fixture serialization, not full JCS implementation. C04 original raw hash and canonical/domain hashes tracked; reordered input separately tested. Resolver checks fixed descriptor and fixture source hash; failing resolution/sample and nonfinite result controls. No GPU, no ray, no performance result. P3-R0B-SCOPE-R2-01: B2 cap 16 expanded occurrences/contribution; B3 mandatory five-box native family with separate lattice domain; native 128-box import cap not research coverage, larger cases NOT_RUN. A0 numeric P3 separately open.

## Preregistration before measurement

On exact candidate checkout, use external fresh directories. Record compiler, flags, CMake, Python, exact Core and dependency source hashes (pinned nlohmann 3.12.0 SHA256 4b92eb0c06d10683f7447ce9406cb97cd4b453be18d7279320f7b2f025c10187; no unchecked alternative). Build root and standalone consumer without product CMake edits:
```sh
cmake -S . -B /tmp/r0b-root -DBUILD_TESTING=ON
cmake --build /tmp/r0b-root --config Release
cmake -S research/dr3-r0/r0-b -B /tmp/r0b-native -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/r0b-native --config Release
python research/dr3-r0/r0-b/run.py prepare --out /tmp/r0b-inputs
sha256sum /tmp/r0b-inputs/manifest.json /tmp/r0b-native/r0b_native_probe
```
Windows: corresponding external paths and Release executable. Publish exact HEAD/TREE, environment, build logs/commands, manifest and binary hashes in #73 before running. Confirm manifest source identities, fixture counts, exact expected outcomes and negative errors; inspect missing scope coverage and complete before B1 PASS. Execute only after separate receipt:
```sh
python research/dr3-r0/r0-b/run.py execute --out /tmp/r0b-inputs --binary /tmp/r0b-native/r0b_native_probe --manifest-sha <exact> --binary-sha <exact> --receipt <issue-comment-id>
```
Result written once, raw stdout/stderr for every probe. Check actual receipt externally; CLI receipt is traceability label, not a network authorization check. No automatic tolerance tuning. Standard CI is necessary governance evidence, not evidence this standalone harness ran. B1 independently reviewed before B2, B3. Full 21/16 ledger and mutants required by R2 before overall R0-B result. Do not promote this candidate to Ready until complete and independently accepted.
