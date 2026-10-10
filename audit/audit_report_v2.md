# AuthorityGraph — Pre-Deployment Technical Audit v2

**Date:** 2026-10-10
**Auditor:** Senior Solana / Backend / Security Engineering Review
**Codebase:** `apps/api` + `apps/web` monorepo
**Node:** v24.11.1 · npm: 11.12.1
**Audit basis:** Full source read + all commands executed and verified

---

> [!IMPORTANT]
> This is a **clean-state audit** produced after the previous round of P0/P1/P2 fixes have been applied. All previously identified runtime crash bugs are resolved. The three mandatory commands now pass with exit code 0. This report identifies the remaining gaps, residual risks, and missing product capabilities.

---

## Commands Run and Observed Results

| Command | Exit Code | Key Observations |
|---|---|---|
| `node --version` | **0** | v24.11.1 — satisfies `engines.node >= 20` ✅ |
| `npm --version` | **0** | 11.12.1 ✅ |
| `npm install` | **0** | 457 packages, up to date ✅ |
| `npm run typecheck` | **0** | Zero errors across both workspaces ✅ |
| `npm run test` | **0** | **50/50 tests pass** (25 src + 25 dist double-run; 0 web with `--passWithNoTests`) ✅ |
| `npm run build` | **0** | API: `dist/server.js` + 4 other `.js` files; Web: Vite bundle 156 kB ✅ |
| `npm audit` | **1** | 5 moderate vulnerabilities — no fix available (stream-json, uuid via `@solana/spl-token` v0.1.8) ⚠️ |
| RPC live call | **Not run** | No live RPC call was performed — credentials vary per environment |

---

## Section A — Project Structure and Configuration

### A-1 ✅ Workspace layout is correct
All source files referenced by imports exist. npm workspaces correctly define `apps/api` and `apps/web`. `tsconfig.base.json` extends correctly. `dist/` output exists and contains all five expected `.js` files (`config.js`, `server.js`, `solana.js`, `solana.test.js`, `types.js`).

### A-2 ✅ .gitignore correctly excludes secrets
`.env` and `.env.*` are excluded. `node_modules/` and `dist/` are excluded. `!.env.example` is correctly excepted. No credentials found in committed files.

### A-3 ⚠️ No automated setup guard for missing `SOLANA_RPC_URL`
`config.ts` line 10 silently falls back to `https://api.mainnet-beta.solana.com` when `SOLANA_RPC_URL` is absent. A clean-checkout user who skips `cp .env.example apps/api/.env` will silently use the public mainnet endpoint, which is heavily rate-limited.

**Fix:** Add a startup warning in `config.ts`:
```ts
if (!process.env.SOLANA_RPC_URL) {
  console.warn("[AuthorityGraph] SOLANA_RPC_URL not set — using public mainnet endpoint (may be rate-limited).");
}
```

### A-4 ✅ Production build succeeds
`npm run build` exits 0. `dist/server.js` is present and begins with valid ESM imports (confirmed by file inspection).

### A-5 ✅ Test suite passes at workspace level
`npm run test` exits 0. API: 50 tests pass. Web: exits 0 via `--passWithNoTests`.

### A-6 ⚠️ No ESLint, no Prettier, no pre-commit hooks
No linting configuration exists in either workspace. Acceptable for a hackathon.

### A-7 ⚠️ `"no_findings"` result value is dead code
`types.ts` line 27 defines `"no_findings"` as a valid `result` value. No code path in `solana.ts` ever emits it. `baseResponse()` always sets `result: "findings"`. This confuses API consumers.

**Fix:** Either emit `"no_findings"` when all findings have `status: "absent"`, or remove it from the union type.

### A-8 ✅ Constants are correctly positioned below all imports
The previous ordering issue (constants between import blocks) has been resolved.

### A-9 ⚠️ `tailwindcss` is a production dependency in `apps/api/package.json`
`apps/api/package.json` line 19 lists `"tailwindcss": "4.3.3"` under `dependencies`. Tailwind is a build-time CSS tool — it should not be in the API's runtime dependencies at all (the API serves JSON, not HTML).

**Fix:** Remove `tailwindcss` from `apps/api/package.json` entirely.

### A-10 ⚠️ `solana.test.ts` is compiled into `dist/` and run twice
The `tsconfig.json` include pattern `src/**/*.ts` includes `solana.test.ts`. The compiled `dist/solana.test.js` is then picked up by `vitest run`, causing all 25 tests to run twice (50 total). This is confusing and wastes CI time.

**Fix:** Add to `apps/api/tsconfig.json`:
```json
{ "exclude": ["src/**/*.test.ts"] }
```

### A-11 🔴 No automated mechanism to create `apps/api/.env`
The README instructs the user to manually run `cp .env.example apps/api/.env`. On CI or a fresh machine, forgetting this step causes silent failure. No `postinstall` script or CI step handles this.

---

## Section B — Solana RPC Integration

### B-1 ✅ FIXED — Uint8Array → Buffer wrapping
All `info.data` usages are now wrapped with `Buffer.from(info.data.buffer, info.data.byteOffset, info.data.byteLength)` before any `readUInt32LE()` or `readBigUInt64LE()` calls. This resolves the web3.js v3 `AccountInfo<Uint8Array>` incompatibility that previously crashed every program analysis.

**Verified by:** 2 unit tests in `solana.test.ts` + TypeScript compile pass.

### B-2 ✅ FIXED — `TOKEN_PROGRAM_ID.equals()` cross-version crash
`TOKEN_PROGRAM_ID` is now constructed from web3.js v3 `PublicKey` directly in `solana.ts`:
```ts
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
```
The spl-token v0.1.8 `TOKEN_PROGRAM_ID` import (which bundled a conflicting web3.js v1 `PublicKey` that caused `.equals()` to crash) has been removed.

**Verified by:** 3 unit tests in `cross-version PublicKey safety` describe block.

### B-3 ⚠️ TOCTOU race in `auto` mode — comment is misleading, double-fetch still occurs
The comment in `solana.ts` line 279 claims the first `getAccountInfo` result is "passed into sub-analyzers," but the implementation actually discards the first call's result:

```ts
// auto branch — fetches once here:
const info = await connection.getAccountInfo(key, "confirmed");

// Then calls analyzeProgram, which fetches AGAIN internally:
if (info.executable) return analyzeProgram(key.toBase58());
```

`analyzeProgram` line 75: `const info = await connection.getAccountInfo(key, "confirmed");` — second fetch.

Auto mode uses 2–3 RPC calls per analysis instead of 1–2. The comment is incorrect.

**Severity for MVP:** Low. Not a correctness issue. Fix in Phase 1 by passing `info` as a parameter to the sub-analyzers.

### B-4 ⚠️ `confirmTransactionInitialTimeout` does not timeout `getAccountInfo`
`config.ts` sets `requestTimeoutMs: 12000` passed to `Connection` as `confirmTransactionInitialTimeout`. This option only applies to `sendAndConfirmTransaction`, not to `getAccountInfo`. The `res.setTimeout(15000)` in `server.ts` handles this at the HTTP layer, but the underlying RPC socket call has no independent timeout.

**Fix (Phase 1):** Wrap each `getAccountInfo` call in `Promise.race([call, timeoutPromise(12000)])`.

### B-5 ⚠️ `observedAt` is set before RPC calls complete
`baseResponse()` line 51 sets `observedAt: new Date().toISOString()` before any RPC call is made. For a slow RPC, this timestamp may be 2–15 seconds before the data was actually read.

### B-6 ✅ Cluster and commitment level are correct
`"confirmed"` commitment is used consistently. The cluster label is read from env and included in every response. RPC URL is server-side only.

### B-7 ✅ Public key validated before any RPC call
`analyzeAddress` constructs `new PublicKey(address)` before any RPC call, rejecting invalid base58 input early with `400 INVALID_ADDRESS`.

---

## Section C — Program Upgrade-Authority Analysis

### C-1 ✅ FIXED — Buffer wrapping resolves all program analysis crashes
Program analysis now correctly:
- Wraps `info.data` → `Buffer` before `readUInt32LE(0)` enum tag check
- Wraps `programDataInfo.data` → `pdData` before `readUInt32LE(0)` and `readBigUInt64LE(4)`

### C-2 ✅ Loader variant enum values are correct and verified

| Field | Value | Verified |
|---|---|---|
| `UpgradeableLoaderState::Program` variant | `2` | ✅ |
| `UpgradeableLoaderState::ProgramData` variant | `3` | ✅ |
| Enum tag encoding | 4-byte LE u32 | ✅ |
| Deployment slot | 8-byte LE u64 at offset 4 | ✅ |
| Authority option discriminant | 1 byte at offset 12 | ✅ |
| Authority pubkey | 32 bytes at offset 13 | ✅ |

**Verified by:** `buildProgramDataAccount` fixture tests; 10 tests in `analyzeProgramData byte layout`.

### C-3 ✅ BPF Loader Upgradeable program ID is correct
`LoaderV3Program.programId` resolves to `BPFLoaderUpgradeab1e11111111111111111111111` — confirmed by live Node.js invocation.

### C-4 ✅ Fail-closed behavior is correct
All truncated/malformed/unexpected layout conditions return `result: "unsupported"`. No authority conclusion is fabricated.

### C-5 ✅ `decodePubkey` signature corrected
Now accepts `Uint8Array` instead of `Buffer`, resolving TypeScript TS2345. Runtime behavior is correct since `Uint8Array.subarray()` exists natively.

### C-6 ⚠️ No end-to-end test for `analyzeProgram` with mocked RPC
All current tests verify binary layout decoding in isolation. No test calls `analyzeProgram()` directly with a mocked `connection.getAccountInfo()`. A wiring bug (e.g., wrong buffer slice offset) would not be caught by the current suite.

**Required before demo:** See G-2 for the required test skeleton.

### C-7 ⚠️ PROGRAM_IMMUTABLE limitation text could be stronger
The finding says `"This is consistent with an immutable program"` but does not note that the account owner (not just the absent authority field) determines loader semantics. Acceptable for MVP given the existing disclaimers.

---

## Section D — SPL Token and Token-2022 Analysis

### D-1 ✅ FIXED — `info.owner.equals()` crash resolved
Both `isToken` and `isToken2022` checks now use web3.js v3 `PublicKey` instances. `.equals()` is safe.

### D-2 ✅ MintLayout decode is correct
`MintLayout.span = 82` bytes — confirmed by live Node.js check. Decode correctly surfaces `mintAuthorityOption`, `freezeAuthorityOption`, `supply`, and `decimals`. Verified by 8 unit tests.

### D-3 ✅ Token-2022 extension disclaimer added
When `isToken2022` is true, a prominent warning is appended to `response.warnings` naming specific extensions (PermanentDelegate, TransferHook, DefaultAccountState, InterestBearingConfig) that are not decoded.

### D-4 ⚠️ Token account submitted as `kind: "mint"` — silently decodes garbage
A token account is 165 bytes; a mint is 82 bytes. If a token account address is submitted with `kind: "mint"`:
- The length check `info.data.length < MintLayout.span` passes (165 > 82)
- `MintLayout.decode(info.data.slice(0, 82))` runs on unrelated bytes
- The result may produce nonsensical authority addresses as valid findings

**Fix (P1):** Before calling `MintLayout.decode`, check if `info.data.length === 165` and emit `WRONG_ACCOUNT_TYPE`.

### D-5 ⚠️ No end-to-end test for `analyzeMint` with mocked RPC
Same gap as C-6. Required before demo.

---

## Section E — Authority Relationships and Risk Rules

### E-1 ❌ MISSING — No multi-address or cross-address authority concentration analysis
`POST /api/analyze` accepts exactly one address and returns findings in isolation. There is no batch endpoint, no project-level grouping, and no logic to detect that the same authority controls multiple programs or tokens.

This is the second listed item in the README's MVP scope:
> "Identify repeated direct authority addresses across supported findings."

**Assessment:** No implementation exists. Confirmed by full source read. This is Phase 2 per the product plan. Confirm whether it is required for the hackathon submission.

### E-2 ✅ Findings correctly distinguish status from severity
`status` (present/absent/unknown) and `severity` (high/medium/info/etc.) are separate fields with consistent values across all code paths.

### E-3 ✅ No automatic "safe" verdict
No code path emits a verdict that the analyzed object is safe. `warnings` always includes a disclaimer. Consistent with the product's stated principle.

### E-4 ⚠️ `"critical"` severity is defined but never emitted
`types.ts` includes `"critical"` in the `Severity` union. No finding currently emits it. The UI should not render an empty "critical" bucket.

### E-5 ⚠️ Authority addresses are not labeled by account type
When an upgrade authority is reported, the `observedValue` is a raw base58 address with no indication of whether it is a wallet, PDA, or multisig. The `limitations` field partially addresses this with a text disclaimer. Acceptable for MVP.

---

## Section F — API Completeness and Reliability

### F-1 ✅ FIXED — Rate limiting implemented
`express-rate-limit` v8.7.1 applied to `/api/analyze` at 30 requests/minute per IP.

### F-2 ✅ FIXED — `X-Powered-By` header disabled
`app.disable("x-powered-by")` present at `server.ts` line 11.

### F-3 ✅ FIXED — Per-request 15-second timeout on `/api/analyze`
`res.setTimeout(15000, ...)` correctly returns 504 JSON if the RPC call hangs. `if (!res.headersSent)` guard prevents double-send.

### F-4 ✅ Input validation is solid
Zod validates address (min 32, max 44 chars), kind enum, and body size (32 kB). Invalid JSON returns 400. Empty body returns 400.

### F-5 ✅ No internal detail leaks in 502 response
The catch block uses generic messages. Stack traces are not serialized to responses.

### F-6 ⚠️ No `helmet` middleware
No CSP, X-Frame-Options, HSTS, or X-Content-Type-Options beyond the X-Powered-By removal. Low risk for a pure JSON API.

### F-7 ⚠️ Health endpoint has no RPC reachability check
`GET /api/health` returns `{ status: "ok" }` unconditionally. A load balancer will see the service as healthy even when the RPC provider is unreachable.

**Fix (Phase 1):** Perform a lightweight `getVersion()` call; if it fails, return `{ status: "degraded", rpc: false }` with HTTP 503.

### F-8 ⚠️ CORS single-origin — may break in production
`corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173"`. In production, `CORS_ORIGIN` must be set. No runtime warning if the local default is used in production.

### F-9 ⚠️ No structured logging or request IDs
`console.log` only. No request ID, duration, or error context per request.

### F-10 ✅ FIXED — Graceful shutdown implemented
`SIGTERM` and `SIGINT` handlers call `server.close()` with a 10-second forced exit. In-flight requests complete before exit.

### F-11 ⚠️ `/api/health` has no rate limit
The limiter is mounted only on `/api/analyze`. The health endpoint is unprotected. Acceptable for a health check.

### F-12 ⚠️ In-memory rate-limit store
The default `MemoryStore` resets on process restart and does not synchronize across multiple instances. Acceptable for a single-process MVP.

### F-13 ⚠️ No API versioning
No `/v1/` prefix. Breaking changes later will require a new route namespace.

### F-14 🔴 Rate-limit 429 response format is not guaranteed JSON
The `message` option in `express-rate-limit` is an object `{ error: "RATE_LIMITED", message: "..." }`, but Express Rate Limit v8 may not set `Content-Type: application/json` on the 429 response automatically. A client parsing the response as JSON may fail.

**Fix — add an explicit handler:**
```ts
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "RATE_LIMITED",
      message: "Too many requests. Please wait before retrying."
    });
  }
});
```

---

## Section G — Testing and Correctness

### G-1 Current test coverage summary

| Test area | Count | Status |
|---|---|---|
| Uint8Array → Buffer wrapping | 2 | ✅ |
| Program account enum tag (tag=2) | 2 | ✅ |
| ProgramData enum tag (tag=3) | 1 | ✅ |
| Active upgrade authority decode | 1 | ✅ |
| Absent upgrade authority (immutable) | 1 | ✅ |
| Program data too short | 1 | ✅ |
| Wrong Program enum tag | 1 | ✅ |
| Wrong ProgramData enum tag | 1 | ✅ |
| ProgramData too short | 1 | ✅ |
| Truncated authority option | 1 | ✅ |
| MintLayout.span = 82 | 1 | ✅ |
| Active mint authority decode | 1 | ✅ |
| Revoked mint authority | 1 | ✅ |
| Active freeze authority | 1 | ✅ |
| Revoked freeze authority | 1 | ✅ |
| Mint data too short | 1 | ✅ |
| Supply decoded as u64 LE | 1 | ✅ |
| Decimals decoded correctly | 1 | ✅ |
| web3.js v3 `.equals()` same key | 1 | ✅ |
| TOKEN_PROGRAM_ID ≠ TOKEN_2022 | 1 | ✅ |
| PublicKey round-trips base58 | 1 | ✅ |
| Valid public key accepted | 1 | ✅ |
| Invalid public key rejected | 1 | ✅ |
| `analyzeProgram()` end-to-end (mocked RPC) | 0 | ❌ |
| `analyzeMint()` end-to-end (mocked RPC) | 0 | ❌ |
| `POST /api/analyze` route tests | 0 | ❌ |
| RPC failure / 502 handling | 0 | ❌ |
| `result: "unsupported"` branches | 0 | ❌ |
| Web app | 0 | ⚠️ expected |

**25 unique tests pass. 5 critical integration test areas are entirely missing.**

### G-2 Required integration tests (before demo)

```typescript
import { vi } from "vitest";
import { connection } from "./solana.js";

// ─── analyzeProgram integration ───
describe("analyzeProgram integration", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns unsupported when account not found (null info)", async () => {
    vi.spyOn(connection, "getAccountInfo").mockResolvedValue(null);
    // call analyzeProgram via analyzeAddress(addr, "program")
    // assert result === "unsupported"
  });

  it("returns unsupported for non-executable account", async () => {
    vi.spyOn(connection, "getAccountInfo").mockResolvedValue({
      executable: false, owner: /* system program */, data: new Uint8Array(0), lamports: 0, rentEpoch: 0n
    });
    // assert result === "unsupported", finding ACCOUNT_NOT_EXECUTABLE
  });

  it("returns PROGRAM_IMMUTABLE when optionTag=0", async () => {
    // Mock two calls: Program account data (tag=2 + pdAddress), then ProgramData (tag=3, option=0)
    // assert finding.id === "PROGRAM_IMMUTABLE"
  });

  it("returns PROGRAM_UPGRADE_AUTHORITY_ACTIVE when optionTag=1", async () => {
    // Mock: tag=2 Program + tag=3 ProgramData with authority pubkey
    // assert finding.id === "PROGRAM_UPGRADE_AUTHORITY_ACTIVE"
  });
});

// ─── analyzeMint integration ───
describe("analyzeMint integration", () => {
  it("returns TOKEN_MINT_AUTHORITY_ACTIVE for active mint authority");
  it("returns TOKEN_MINT_AUTHORITY_REVOKED for revoked mint authority");
  it("adds Token-2022 warning when owner is TOKEN_2022_PROGRAM_ID");
  it("returns unsupported for non-token-program owner");
});

// ─── POST /api/analyze route ───
describe("POST /api/analyze", () => {
  it("returns 400 for missing address");
  it("returns 400 for address shorter than 32 chars");
  it("returns 400 for address longer than 44 chars");
  it("returns 400 for invalid kind");
  it("returns 429 when rate limit is exceeded");
  it("returns 502 when getAccountInfo throws");
});
```

### G-3 Test double-run from compiled `dist/solana.test.js`
As noted in A-10, both `src/solana.test.ts` and `dist/solana.test.js` are discovered and run, causing 50 reported results for 25 unique tests.

---

## Section H — Security Review

### H-1 ⚠️ `@solana/spl-token` v0.1.8 bundles vulnerable `stream-json ≤3.5.0`
**Severity:** Moderate
**CVEs:** GHSA-mjw6-4jj6-33hc (prototype pollution), GHSA-528h-pc64-c93x (DoS), GHSA-hqr4-qq8f-hg3x (DoS)
**Path:** `@solana/spl-token` → `jayson` → `stream-json`
**No npm fix available.**

**Mitigation options (in order of preference):**
1. **Accept for hackathon** — document the accepted risk.
2. **Remove `@solana/spl-token` entirely** and implement the 82-byte `MintLayout` decode manually. Only `MintLayout` is used from this package. This eliminates the entire CVE chain with ~30 lines of code.
3. **Upgrade to spl-token ≥0.2.0** — dropped `jayson`, but requires verifying compatibility with web3.js v3.

### H-2 ⚠️ `uuid < 11.1.1` — missing bounds check
**CVE:** GHSA-w5hq-g745-h8pq. Same dependency chain as H-1. Resolved by removing `@solana/spl-token`.

### H-3 ✅ No private key or wallet functionality
Confirmed by full source read. No signing, no seed phrases, no wallet connections.

### H-4 ✅ RPC URL is server-side only
`SOLANA_RPC_URL` is never returned in any response or accessible to the frontend.

### H-5 ✅ No misleading "safe" verdict
The product correctly describes configuration without declaring anything safe or exploitable.

### H-6 ✅ Error messages do not expose stack traces
The `catch` block in `server.ts` uses generic messages. Stack traces are not serialized to responses.

### H-7 ✅ Body size is bounded (32 kB)
`express.json({ limit: "32kb" })` prevents large-body attacks.

### H-8 ⚠️ In-memory rate-limit store does not synchronize across processes
See F-12. For a single-process MVP this is acceptable.

---

## Section I — Deployment Readiness

| Check | Status | Detail |
|---|---|---|
| `npm run build` succeeds | ✅ PASS | Exit 0; `dist/server.js` present and valid |
| `npm run typecheck` passes | ✅ PASS | Zero errors across both workspaces |
| `npm run test` passes | ✅ PASS | 50/50 (25 unique × 2 due to double-run) |
| Production start command | ✅ | `npm start` → `node dist/server.js` |
| Output directory configured | ✅ | `dist/` in `tsconfig.json` |
| `.env.example` documented | ✅ | Covers all required vars |
| `.env` excluded from git | ✅ | `.gitignore` correct |
| CORS configurable | ✅ | `CORS_ORIGIN` env var |
| API rate limiting | ✅ DONE | 30 req/min per IP |
| Security headers | ⚠️ PARTIAL | `X-Powered-By` removed; no `helmet` |
| Request timeout (HTTP layer) | ✅ DONE | 15-second `res.setTimeout` |
| Request timeout (RPC layer) | ❌ MISSING | `confirmTransactionInitialTimeout` does not cover `getAccountInfo` |
| Health endpoint | ⚠️ PARTIAL | Returns ok; no RPC reachability check |
| Structured logging | ❌ MISSING | `console.log` only |
| Graceful shutdown | ✅ DONE | `SIGTERM`/`SIGINT` handlers |
| `tailwindcss` in API deps | ⚠️ WRONG | Should not be in API `dependencies` |
| Test file compiled to `dist/` | ⚠️ QUIRK | Runs tests twice |
| Live fixture verification | ❌ NOT RUN | No mainnet/devnet fixture test performed |
| `"no_findings"` dead code | ⚠️ | Confuses API consumers |
| 429 JSON format guarantee | 🔴 RISK | Content-Type not guaranteed for rate-limit responses |
| Startup env guard | ⚠️ MISSING | Silently uses public RPC fallback |
| Integration tests | ❌ MISSING | No mocked-RPC route or function tests |
| CI/CD pipeline | ❌ MISSING | No GitHub Actions workflow |

---

## Capability Matrix

| # | Capability | Intended | Status | Evidence | Missing Work | Priority | Effort |
|---|---|---|---|---|---|---|---|
| 1 | Single-address analysis | POST /api/analyze | ✅ Working | All commands pass | Integration tests | **P0** | 2h |
| 2 | Program upgrade-authority | Decode ProgramData | ✅ Implemented | Buffer fix applied | Mocked RPC tests | **P0** | 1h |
| 3 | SPL Token authority | Decode mint layout | ✅ Implemented | PublicKey fix applied | Mocked RPC tests | **P0** | 1h |
| 4 | Token-2022 support | Decode T22 mint | ⚠️ Base fields only + disclaimer | D-3 | Extension decoding | **P1** | 4h |
| 5 | Multi-address inventory | Batch analyze | ❌ Missing | E-1 | New batch endpoint + logic | **P2** | 1 day |
| 6 | Authority concentration | Cross-address repeats | ❌ Missing | E-1 | Aggregate logic over results | **P2** | 4h |
| 7 | Evidence-backed findings | Per-finding evidence[] | ✅ Implemented | solana.ts | — | done | — |
| 8 | Unsupported account handling | result: unsupported | ✅ Implemented | solana.ts | — | done | — |
| 9 | Historical snapshots | Stored past analyses | ❌ Not started | roadmap | DB + snapshot model | **P3** | 3 days |
| 10 | Authority-change detection | Diff snapshots | ❌ Not started | roadmap | Requires #9 | **P3** | 2 days |
| 11 | Report export | PDF/JSON download | ❌ Not started | roadmap | Export endpoint | **P2** | 4h |
| 12 | Monitoring/alerts | Change alerts | ❌ Not started | roadmap | Requires #9, #10 | **P4** | — |
| 13 | Auth/team workspaces | User accounts | ❌ Not started | roadmap | Intentionally deferred | **P4** | — |
| 14 | API documentation | OpenAPI/Swagger | ⚠️ Partial | docs/API.md | No machine-readable spec | **P2** | 2h |
| 15 | Automated tests | Unit + integration | ⚠️ 25 unit tests only | G-1 | Mocked-RPC integration tests | **P0** | 2h |
| 16 | Deployment automation | CI/CD | ❌ Not started | — | GitHub Actions workflow | **P2** | 2h |

---

## Prioritized Fix Queue

### 🔴 P0 — Fix before public demo

**Fix 1 — Guarantee 429 responses are JSON** (`server.ts`)
```ts
handler: (req, res) => {
  res.status(429).json({ error: "RATE_LIMITED", message: "Too many requests. Please wait before retrying." });
}
```

**Fix 2 — Write integration tests** (`solana.test.ts`)
Use `vi.spyOn(connection, "getAccountInfo")` to mock RPC. Cover all branches of `analyzeProgram`, `analyzeMint`, and the `POST /api/analyze` route.

**Fix 3 — Remove `tailwindcss` from `apps/api/package.json` dependencies**

**Fix 4 — Exclude test files from `tsconfig.json`**
```json
{ "exclude": ["src/**/*.test.ts"] }
```

**Fix 5 — Add startup warning for missing `SOLANA_RPC_URL`** (`config.ts`)

### 🟡 P1 — Fix before sustained public use

**Fix 6 — Eliminate real TOCTOU double-fetch** — Refactor `analyzeProgram` and `analyzeMint` to accept an optional pre-fetched `AccountInfo` parameter.

**Fix 7 — Per-`getAccountInfo` RPC timeout** — Use `AbortController` or `Promise.race` at the RPC call level.

**Fix 8 — Health endpoint RPC check** — Lightweight `getVersion()` call; return 503 if it fails.

**Fix 9 — Resolve `"no_findings"` dead code** — Emit it or remove it.

**Fix 10 — Token account vs. mint detection** — Check `info.data.length === 165` before `MintLayout.decode`.

### 🟢 Phase 1 — Quality

**Fix 11 — Remove `@solana/spl-token` CVE chain** — Implement `MintLayout` manually to eliminate `jayson`/`stream-json` vulnerabilities.

**Fix 12 — Add structured request logging** — At minimum: method, path, status, and duration per response.

**Fix 13 — Add GitHub Actions CI** — `npm install`, `npm run typecheck`, `npm run test`, `npm run build` on every push.

---

## Verification Checklist

```bash
# Must all pass:
npm run typecheck   # ✅ currently exits 0
npm run test        # ✅ currently exits 0 (fix double-run first)
npm run build       # ✅ currently exits 0

# Live fixture tests (manual — must be run and results recorded):
curl -X POST http://localhost:4000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address":"metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s","kind":"program"}'
# → Expected: result: "findings", finding: PROGRAM_UPGRADE_AUTHORITY_ACTIVE

curl -X POST http://localhost:4000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address":"So11111111111111111111111111111111111111112","kind":"mint"}'
# → Expected: result: "findings", TOKEN_MINT_AUTHORITY_REVOKED + TOKEN_FREEZE_AUTHORITY_REVOKED

# Rate-limit test (must return 429 on the 31st request):
# Run 31 POST requests to /api/analyze and verify the 31st returns Content-Type: application/json + 429
```

---

## Summary

The codebase is in a **significantly improved state** after the previous fix round. All three previously failing commands now pass. The two runtime-crash bugs that blocked every real analysis have been resolved with correct implementations and supporting unit tests.

**What is genuinely ready:**
- TypeScript compiles clean with zero errors
- Build succeeds and produces a valid `dist/server.js`
- 25 unique decoder unit tests pass
- Rate limiting, request timeout, and graceful shutdown are implemented
- Security fundamentals are correct: no credentials in frontend, no signed transactions, fail-closed decoding, no "safe" verdicts

**What blocks a credible public demo:**
1. No integration tests with mocked RPC — a wiring bug would go undetected
2. 429 JSON `Content-Type` is not guaranteed (F-14)
3. Test file compiled into `dist/` causes confusing double-run (A-10)
4. `tailwindcss` in production API dependencies (A-9)
5. No live fixture verification has been performed or documented

**What is correctly deferred to later phases:**
- Multi-address batch analysis and authority concentration detection
- Historical snapshots and change detection
- Token-2022 extension decoding beyond base mint fields
- Authentication and team workspaces
