# AuthorityGraph — Repository Audit and Implementation Plan

**Audit Date:** 2026-10-11
**Baseline Tests:** 38/38 passing
**Baseline Build:** Passing

## Repository Audit Summary

### What Exists and Works

| Module | Status | Notes |
|---|---|---|
| Program upgrade authority (Loader v3) | Working | Correct 36-byte Program / 45-byte ProgramData decode |
| SPL Token mint/freeze authority | Working | Manual 82-byte MintLayout decoder, no CVE deps |
| Token-2022 base mint fields | Working | With extension warning |
| Fail-closed 165-byte token account guard | Working | Tested |
| Auto-detect routing (program/mint) | Working | Single-fetch, no TOCTOU |
| RPC timeout via Promise.race | Working | Documented non-cancelling limitation |
| Express rate limiting (30/min) | Working | JSON body on 429 |
| Zod request validation | Working | 32-44 char base58 |
| Health endpoint with RPC check | Working | Returns 200/503 |
| Error sanitization (no stack leak) | Working | Tested in server.test.ts |
| Graceful shutdown (SIGTERM/SIGINT) | Working | |
| CI workflow | Present | .github/workflows/ci.yml |

### Key Issues Found

#### P0 Correctness and Security

1. Token-2022 extension data is entirely unparsed — analyzeMint reads only the first 82 bytes. For Token-2022 mints with PermanentDelegate, TransferHook, DefaultAccountState etc., the system emits a warning but no findings. This means a token with a PermanentDelegate (which can drain any holder account) shows no relevant finding.
2. result no_findings is in the web types.ts but not in the API types.ts — type inconsistency between packages.
3. No Token-2022 extension TLV scanner — the 2-byte type/length header for extensions after byte 165 is not read at all.
4. Unsupported multisig detection — if an upgrade authority is a Squads multisig, the system reports the raw key with no context.

#### P1 Missing Core Features

5. No Token-2022 extension analyzer — PermanentDelegate, DefaultAccountState, TransferHook, TransferFee, MintCloseAuthority missing.
6. No effective authority resolver — cannot distinguish a direct key, Squads multisig, or governance PDA.
7. No historical snapshots — stateless by design, no change tracking.
8. No policy/drift evaluation.
9. No authority control graph in API response or UI.

#### P2 Quality and Architecture

10. Web types.ts diverges from API types.ts — web has no_findings result value, API does not.
11. server.test.ts assertion [200, 400] — permissive test for the 32-char address case.
12. No frontend tests — only passWithNoTests.
13. Findings icon is always ShieldAlert — no visual differentiation between severity levels.

## Implementation Phases & Completion Status

### Phase 1 (P0): Fix Type Inconsistency and Token-2022 Extension Detection — COMPLETED & VERIFIED
- [x] Fix web/types.ts to match API
- [x] Add Token-2022 extension TLV scanner (detect which extensions are present)
- [x] Emit a dedicated finding per detected extension type
- [x] Add comprehensive extension tests (30 tests in token2022.test.ts)

### Phase 2 (P1): Token-2022 Full Extension Analyzer — COMPLETED & VERIFIED
- [x] Implement TLV parser for all Token-2022 extension types (`token2022.ts`)
- [x] Add findings for PermanentDelegate, DefaultAccountState, TransferHook, TransferFee, MintCloseAuthority, InterestBearingConfig, NonTransferable
- [x] Update API & Web types to include extension data with parsed fields

### Phase 3 (P1): Effective Authority Resolver & Squads Analyzer — COMPLETED & VERIFIED
- [x] Detect Squads v3 & v4 multisig accounts by program ID and account discriminators (`authority-resolver.ts`)
- [x] Classify authority as direct-key / squads-multisig / unknown-program-owned / unresolved
- [x] Add authorityType to findings evidence and flag 1-of-N single-signer multisig risks
- [x] 10 unit tests in `authority-resolver.test.ts`

### Phase 4 (P2): Historical Snapshots and Change Detection — COMPLETED & VERIFIED
- [x] File-based persistence engine (`snapshot-store.ts`) with SHA-256 state hashing and deduplication
- [x] Snapshot compare endpoint `POST /api/compare` and history endpoints `GET /api/snapshots/:address` & `GET /api/snapshots/:address/history`
- [x] Deterministic change event generation (`AUTHORITY_CHANGED`, `PROGRAM_IMMUTABILITY_CHANGED`, `MULTISIG_THRESHOLD_CHANGED`, `EXTENSION_CHANGED`)
- [x] 5 unit tests in `snapshot-store.test.ts`

### Phase 5 (P2): Security Policy & Drift Engine — COMPLETED & VERIFIED
- [x] Policy definition schema (`policy-engine.ts`) supporting baseline and custom rules
- [x] Deterministic evaluation with explicit `PASS`, `FAIL`, `UNKNOWN`, and `NOT_APPLICABLE` states
- [x] Bounded rule checks: immutability, approved upgrade keys, freeze revocation, permanent delegate, minimum multisig threshold
- [x] 6 unit tests in `policy-engine.test.ts`

### Phase 6 (P3): Frontend Intelligence Dashboard — COMPLETED & VERIFIED
- [x] Interactive Directed Authority Control Graph (`AuthorityGraphView.tsx`) with SVG node/edge layout and details drawer
- [x] Security Policy & Drift card (`PolicyEvaluationCard.tsx`) with PASS/FAIL/UNKNOWN badges and rule breakdown
- [x] Token-2022 extension analysis section (`Token2022ExtensionsCard.tsx`)
- [x] Historical snapshot timeline and change diff card (`HistoryTimelineCard.tsx`)
- [x] Differentiated severity icons (critical, high, medium, low, info, unknown) and authority type pills
- [x] Frontend test suite in `apps/web/src/app.test.ts`

## Verification Summary
- **Typecheck:** 0 errors across `@authoritygraph/api` and `@authoritygraph/web`
- **Tests:** 98/98 tests passing (96 API, 2 Web)
- **Production Build:** Succeeded (Vite bundle 190.42 kB JS, 34.13 kB CSS)
- **Security Audit:** 0 vulnerabilities (`npm audit`)
