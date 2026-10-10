# AuthorityGraph Product Plan

## 1. Executive summary

AuthorityGraph is a read-only security posture tool for Solana protocols. It inventories selected direct privileged authorities and produces an evidence-backed report that teams can use before launch and during ongoing operations.

The first version deliberately avoids trying to be a universal security scanner. It focuses on a small number of high-value control surfaces:
- Upgrade authority for supported upgradeable programs
- Mint authority for classic SPL Token and Token-2022 mints
- Freeze authority for classic SPL Token and Token-2022 mints
- Repeated direct authority addresses across analyzed objects

## 2. Problem statement

Protocol teams may have several programs, tokens, and treasury accounts, with permissions distributed across different interfaces and owners. Security reviews can be difficult to repeat consistently, especially for small teams without dedicated security engineering staff.

The product hypothesis is that teams need a simple inventory that answers:
1. What privileged controls exist?
2. Which on-chain address is recorded as the direct authority?
3. What evidence supports this conclusion?
4. Which permissions deserve review because they are concentrated or poorly documented?
5. What changed since the last review? (later phase)

This is a hypothesis, not a proven market gap. Validate it with target users and compare existing products before claiming novelty.

## 3. Target users

### Primary early adopter
Small Solana protocol teams preparing a launch, token issuance, or major upgrade.

### Secondary users
- Independent Solana security auditors
- Launch platforms and incubators
- Treasury / operations teams that need a repeatable permission inventory

### Buyer and user distinction
A security engineer may use the tool, while a founder, CTO, or protocol operations lead may approve payment. The MVP must make technical evidence useful to both.

## 4. Jobs to be done

- Before launch: "Show me the privileged controls for this program and token."
- During review: "Give me evidence I can share with my cofounder or auditor."
- After a change: "Tell me whether a critical authority changed since the last approved snapshot." (future)
- For an auditor: "Reduce manual account lookups and create a reproducible inventory." (future)

## 5. Value proposition

"An understandable, evidence-backed inventory of who can change critical Solana program and token settings."

Avoid claims like "prevents all hacks," "guarantees safety," or "finds every hidden authority."

## 6. MVP requirements

### Functional
- Accept a program ID or token mint address.
- Detect supported account type or accept explicit type selection.
- Read on-chain account metadata via RPC.
- Decode supported program upgrade authority data.
- Decode token mint and freeze authorities for SPL Token and Token-2022.
- Display direct authority, rule status, evidence, recommendation, and limitations.
- Clearly label unsupported account types and RPC failures.
- Record observation timestamp and cluster label.
- Provide a health endpoint.

### Non-functional
- Read-only. No transaction signing.
- Fail closed on unknown binary layouts.
- No private keys or seed phrases.
- Server-side RPC credentials.
- Explain every finding.
- Responsive interface.
- Clear errors for invalid address, missing account, unsupported account, RPC outage, and rate limits.

## 7. MVP success criteria

Technical:
- 100% correct decoding on the verified fixture set.
- Unknown / malformed account layouts return unsupported, not guessed results.
- No private credentials in frontend bundles or repository.
- Reproducible local setup from README.

Product:
- At least 5 target users interviewed if feasible.
- At least 3 target users attempt a scan and explain what they would do with the output.
- Record observed usability problems and requested features without representing interest as paid demand.
- Ask whether the same information is already available through existing tools.

Hackathon:
- Live end-to-end demo.
- One clear problem and user persona.
- Short technical architecture explanation.
- Honest competitor comparison and limitations.
- No fabricated traction or unsupported security claims.

## 8. Non-goals

- Auditing program source code.
- Predicting future exploits.
- Wallet-drainer detection.
- Transaction simulation.
- Automatic authority revocation.
- Signing transactions or custodying assets.
- Full recursive authority graph across every protocol and PDA.
- Complete multisig policy analysis.
- AI-driven verdicts.

## 9. Product roadmap

### Phase 0: Hackathon MVP
- Program upgrade authority
- SPL Token / Token-2022 mint and freeze authorities
- Findings UI and evidence
- Known fixtures and decoder tests
- Demo and submission

### Phase 1: Reliability
- More loader and token edge cases
- Rate limiting, timeouts, retries, structured logs
- Report export
- Stronger test fixtures
- Versioned rules and confidence labels

### Phase 2: Project inventory
- Multiple addresses per project
- Saved snapshots
- Change detection
- Team review status
- Notifications for material authority changes

### Phase 3: Authority relationships
- Verified adapters for supported multisig systems
- PDA relationship analysis with explicit proof and limitations
- Ownership / authority graph across project assets
- Policy baseline and exceptions

### Phase 4: Commercial product
- Team workspaces
- Scheduled scans and alerts
- API for launchpads / auditors
- Audit evidence exports
- Billing and usage controls

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Existing products already provide similar inventory | Interview users and benchmark alternatives before asserting a gap |
| Incorrect binary decoding | Validate official layouts and known fixtures; fail closed |
| False positives from active permissions | Describe configuration, not automatic vulnerability |
| RPC rate limits | Use configurable provider, timeout, caching later |
| PDA / multisig misinterpretation | Report direct authority only until verified adapter exists |
| Security liability | Explicit limitations, evidence, tests, no guarantee language |
| Hackathon time is short | Cut features, not verification |
| No willingness to pay | Test pricing and buying process with real teams |

## 11. Business model hypotheses

- Free single-address scans for discovery
- Paid continuous monitoring per protocol
- Auditor team plans for report management
- API-based pricing for launchpads and ecosystem platforms

Do not treat these as validated. Conduct customer interviews and willingness-to-pay tests before committing to a pricing model.

## 12. Questions to validate with users

1. How do you currently inventory upgrade and token authorities?
2. How often is that inventory reviewed?
3. What mistakes or delays have happened in the process?
4. Which existing products do you already use?
5. What evidence do investors, auditors, or users ask you to provide?
6. Would a saved snapshot and change alert solve a real recurring problem?
7. Who owns the budget for this workflow?
8. What would make this tool trustworthy enough to use?
