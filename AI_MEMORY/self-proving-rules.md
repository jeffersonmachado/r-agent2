# Self-Proving Rules

## GO_FINAL_HARDENED criteria

A release may be called `GO_FINAL_HARDENED` only when all are true:

- `system:validate` passed.
- `zip:release` produced approved ZIP and manifest.
- release gate is `GO`.
- QA Mesh canonical decision is `GO`.
- QA Waves required scope is green.
- replay integrity and tamper detection are green.
- package validation and contamination checks are green.
- runtime governance is `REAL_OK` when real runtime is required.
- final readiness/self-proving reports agree.
- `dist/` contains only approved release artifacts.

## Evidence required

- command logs/results
- browser validation summary
- route/runtime map
- QA Mesh report
- replay integrity report
- package validation report
- governance chain/signature
- release manifest
- cleanup/dist check

## Current status

Current canonical docs report `NO_GO`; therefore this workspace must not be labelled `GO_FINAL_HARDENED` until mesh blockers are resolved and validations rerun.

