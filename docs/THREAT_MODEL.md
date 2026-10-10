# Threat Model

## Assets to protect
- Integrity of reported findings
- Availability of the public demo
- RPC provider credentials
- User trust and security decision quality
- Repository and deployment integrity

## Threat actors and failure modes
- Malicious user submits oversized or malformed requests.
- RPC provider is unavailable, stale, rate-limited, or misconfigured.
- Account data uses an unsupported or unexpected layout.
- A UI bug presents an unknown result as safe.
- An analyst mistakes a direct authority for the final human controller.
- A report is used as an audit guarantee despite stated limitations.
- Secrets are accidentally committed or bundled into frontend code.

## MVP mitigations
- Zod request validation and JSON body size limit.
- Public-key parsing before RPC calls.
- Timeouts and bounded response sizes where practical.
- Explicit `unsupported` outcomes for unknown layouts.
- No "safe" verdict based solely on absence of supported findings.
- Show cluster and observation time.
- Keep RPC credentials server-side.
- No private-key, seed-phrase, or wallet-signing functionality.
- Add rate limiting before exposing the API publicly.
- Keep logs free of secrets.

## Security assumptions
- The RPC endpoint returns account data for the configured cluster.
- The initial loader decoder matches the deployed loader layout.
- SPL Token decoding library supports the account owner and mint version.

Each assumption must be verified with tests and fixtures. If it cannot be verified, report uncertainty.

## Out of scope
- Browser extension security
- Custody and key management
- Program source-code audit
- Exploit detection across arbitrary transactions
- Protection against a compromised RPC provider

## Responsible wording
Say: "The account currently records this direct authority."
Do not say: "This wallet belongs to the founder" or "This protocol is safe."
Say: "This configuration may deserve review."
Do not say: "This is exploitable" without separate evidence.
