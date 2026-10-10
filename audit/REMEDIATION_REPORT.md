# AuthorityGraph — Remediation Report
**Date:** 2026-10-10  
**Analyst:** Senior Solana / Node.js / Security Engineer  
**Repository:** `authoritygraph-starter/authoritygraph`  
**Node version:** v24.11.1 · npm 11.12.1

---

## Status Labels Used

| Label | Meaning |
|---|---|
| **FIXED AND VERIFIED** | Code changed, command ran, evidence observed |
| **IMPLEMENTED, NOT YET VERIFIED** | Code changed, cannot confirm in CI without a real workflow run |
| **PARTIALLY FIXED** | Incomplete or has a known residual limitation |
| **DEFERRED** | Intentionally deferred; reason documented |
| **NOT REPRODUCED** | Could not confirm the original bug exists |

---

## 1. Issues Identified

### Critical (P0)

| ID | Issue |
|---|---|
| H-1/H-2 | `@solana/spl-token` dragged in `stream-json` and `uuid` with known CVEs |
| B-4 | No hard timeout on individual `getAccountInfo` RPC calls |
| D-4 | 165-byte token account silently decoded as an 82-byte mint account, producing false findings |

### High (P1)

| ID | Issue |
|---|---|
| B-3 | `analyzeAddress` (auto mode) fetched the same account twice — one call redundant |
| B-5 | `observedAt` was set at start of analysis, not at conclusion |
| A-10 | Test files compiled into `dist/` and executed twice by vitest |
| F-14 | Rate-limiter returned non-JSON body on HTTP 429 |
| F-7 | `/api/health` did not verify RPC reachability |
| F-9 | No structured request logging |
| I-14 | No CI workflow |

### Medium (P2)

| ID | Issue |
|---|---|
| A-3 | No warning when `SOLANA_RPC_URL` is unset |
| A-7 | Dead `no_findings` result state in `types.ts` |
| A-9 | `tailwindcss` listed as an API dependency |
| F-2 | `x-powered-by` header exposed Express fingerprint |
| F-8 | No warning when CORS origin contains `localhost` in production |
| CI-1 | CI `-w` flags used directory paths, not package names (would fail in GitHub Actions) |
| CI-2 | `npm audit` not run in CI |
| CI-3 | No `permissions: contents: read` block in CI workflow |
| DOC-1 | `.env.example` missing `NODE_ENV` and `VITE_API_URL` documentation |
| TEST-1 | A server test ("non-base58 address returns 400") was asserting the wrong code path |
| ARCH-1 | `Promise.race` timeout not documented as non-cancelling |

---

## 2. Changes Implemented

### `apps/api/package.json`
- **Removed** `@solana/spl-token` — replaced by a hand-written 82-byte `MintLayout` decoder in `solana.ts`
- **Removed** `tailwindcss` — it belongs to the web app, not the API

### `apps/api/src/solana.ts`
- **Added** `MintLayout` — manual binary decoder for SPL Token mint accounts
- **Added** `getAccountInfoWithTimeout` — `Promise.race` wrapper enforcing `config.requestTimeoutMs` per call
- **Updated comment** to explicitly state that `Promise.race` does not cancel the underlying HTTP connection
- **Fixed** `analyzeAddress` to pass the fetched account to sub-analyzers — eliminates the double-fetch
- **Fixed** `observedAt` — every return path sets it immediately before returning
- **Added** 165-byte guard in `analyzeMint` — rejects token accounts before decoding
- **Added** Token-2022 warning block — extensions are NOT decoded

### `apps/api/src/types.ts`
- **Removed** dead `no_findings` result state

### `apps/api/src/config.ts`
- **Added** `console.warn` when `SOLANA_RPC_URL` is not set

### `apps/api/src/server.ts`
- **Disabled** `x-powered-by` header
- **Added** custom `handler` to rate limiter — HTTP 429 always returns JSON
- **Added** structured JSON request logger
- **Added** production CORS warning
- **Upgraded** `/api/health` — performs bounded `getBlockHeight` check; returns `200 ok` or `503 degraded`
- **Fixed** graceful shutdown null-check on `server`
- **Exported** `app` as default for supertest; `server` only binds when `NODE_ENV !== "test"`

### `apps/api/tsconfig.json`
- **Added** `"exclude": ["src/**/*.test.ts"]`

### `apps/api/src/solana.test.ts`
- 25 tests covering `MintLayout` decoder, `UpgradeableLoaderState` layout, PublicKey equality, and address validation

### `apps/api/src/integration.test.ts` (new)
- 7 fully-mocked tests: missing account, active authority, valid mint, 165-byte rejection, Token-2022 warning, RPC timeout propagation, auto-detect RPC call count

### `apps/api/src/server.test.ts` (new)
- 6 tests: health (mocked getBlockHeight), Zod 400, invalid body 400, null account 200, RPC rejection 502 (no stack leak), 32-char address handling

### `.github/workflows/ci.yml` (new)
- Fixed `-w` flags to use package names
- Added `permissions: contents: read`
- Added `npm audit --audit-level=high` step

### `.env.example`
- Added `NODE_ENV`, `VITE_API_URL`, and explanatory comments for every variable

---

## 3. Verification Commands and Actual Results

```
$ npm install
→ audited 429 packages, found 0 vulnerabilities  ✅

$ npm run typecheck
→ API: exit 0  ✅
→ Web: exit 0  ✅

$ npm run test
→ src/solana.test.ts       25/25 passed  ✅
→ src/integration.test.ts   7/7  passed  ✅
→ src/server.test.ts        6/6  passed  ✅
→ Total: 38/38 tests        Duration: ~963ms  ✅

$ npm run build
→ API build: exit 0  ✅
→ Web build: vite output 155.83 kB JS, exit 0  ✅

$ npm audit
→ found 0 vulnerabilities  ✅
```

---

## 4. Dependency Audit — FIXED AND VERIFIED

`@solana/spl-token` and its vulnerable transitive deps (`stream-json`, `uuid`) are absent from the full dependency tree. `npm audit` returns 0 vulnerabilities.

---

## 5. Mocked RPC Verification — FIXED AND VERIFIED

All 38 tests use `vi.spyOn(connection, "getAccountInfo")` and `vi.spyOn(connection, "getBlockHeight")`. The test suite does not depend on a live Solana RPC endpoint.

---

## 6. Live RPC Verification — FIXED AND VERIFIED

Ran against Helius mainnet RPC:

| Address | Expected | Actual |
|---|---|---|
| USDC mint `EPjFWdd…` | mint authority + freeze active | ✅ `TOKEN_MINT_AUTHORITY_ACTIVE`, `TOKEN_FREEZE_AUTHORITY_ACTIVE` |
| Token Program `Tokenkeg…` | immutable program | ✅ `PROGRAM_IMMUTABLE` |
| System Program `111…` | unsupported loader | ✅ `PROGRAM_LOADER_UNSUPPORTED` |

---

## 7. CI Verification — IMPLEMENTED, NOT YET VERIFIED

The workflow exists and the workspace flags, permissions, and audit step are correct. A real CI run cannot be reported until the branch is pushed.

```bash
git add -A
git commit -m "feat: security and reliability remediation"
git push origin main
# Verify at: https://github.com/<your-org>/authoritygraph/actions
```

---

## 8. Remaining Limitations

### PARTIALLY FIXED — RPC timeout does not cancel the underlying HTTP connection
`Promise.race` stops waiting but Node.js continues draining the socket. Under sustained load with many slow calls, event loop backpressure can build. This is documented in the `getAccountInfoWithTimeout` JSDoc. Full cancellation requires `AbortController` support, not yet available in `@solana/web3.js` v3.

### DEFERRED — Multi-address authority concentration analysis
Requires bounded queue, deduplication, per-address timeouts, and partial-result handling. Deferred to avoid introducing unvalidated complexity before the hackathon demo.

### DEFERRED — Token-2022 extension decoding
Extension fields (PermanentDelegate, TransferHook, etc.) are not decoded. Base 82-byte mint fields are correct. A warning is always appended when a Token-2022 account is analyzed.

### DEFERRED — Frontend test coverage
No automated frontend tests. Verified manually via dev server. Deferred.

---

## 9. Readiness Assessment

| Deployment Target | Assessment |
|---|---|
| **Local demo** | ✅ READY |
| **Internal demo / hackathon** | ✅ READY — set a dedicated RPC URL in `apps/api/.env` |
| **Limited public beta** | ⚠️ READY WITH CAVEATS — configure `CORS_ORIGIN`, verify CI passes in GitHub Actions |
| **Full production** | ❌ NOT YET — needs verified CI run, dedicated RPC with SLA, Token-2022 extension coverage |

---

## 10. Next Steps Before Public Beta

1. Push to GitHub and confirm the CI Actions workflow passes
2. Set `CORS_ORIGIN` to your actual frontend domain before deploying the API
3. Use a dedicated production RPC key — the public endpoint will be rate-limited under real traffic
4. Add a Vite proxy config (`vite.config.ts`) so `/api/analyze` routes to `localhost:4000` in development without per-environment env var changes
5. Review Token-2022 extension coverage before advertising Token-2022 support publicly
