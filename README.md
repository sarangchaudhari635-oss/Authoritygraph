# AuthorityGraph

**Know who controls your Solana protocol before that control becomes a security incident.**




> **Project status:** Hackathon MVP scaffold. Token-mint analysis and upgradeable-program authority decoding are implemented as initial checks, but the system has not been independently audited. Findings are indicators for review, not proof that a configuration is exploitable or unsafe.

## Problem

Solana projects can have security exposure outside the program logic itself. Examples include an upgrade authority controlled by one key, a token mint authority that remains active, or a freeze authority that is not documented. Teams may not have a single, understandable inventory of these powers and the accounts that control them.

AuthorityGraph aims to answer:
- Which privileged controls are present?
- Which address currently holds each direct authority?
- What evidence supports each finding?
- Which permissions may represent a single point of failure?
- What should the team review next?

## Product principles

1. **Evidence before scores.** Every finding should show the account, authority, source, and time of observation.
2. **Read-only by default.** The MVP never signs transactions, moves funds, changes authorities, or connects to a wallet to execute actions.
3. **Explain uncertainty.** A direct authority is not the same as a fully resolved control chain. PDA ownership, multisig membership, and off-chain key custody require separate analysis.
4. **No automatic accusation.** An active authority can be intentional. The product describes risk and context rather than declaring every privileged setting a vulnerability.
5. **Solana-specific value.** Focus on program upgrade authority, SPL Token mint/freeze authority, and concentration of direct control.

## MVP scope

### Included
- Analyze a Solana program address.
- Determine whether the account is executable.
- Detect the upgradeable BPF loader and decode the associated ProgramData account where the on-chain layout is recognized.
- Report the direct upgrade authority when available, or explain that the program is immutable / unsupported / could not be verified.
- Analyze classic SPL Token and Token-2022 mint accounts.
- Report mint authority and freeze authority status.
- Identify repeated direct authority addresses across supported findings.
- Render a dashboard with findings, severity labels, evidence, and next steps.
- Use a configurable Solana RPC endpoint.
- Validate input and return structured errors.

### Explicitly out of scope for the first MVP
- Transaction simulation or wallet-drainer detection.
- Smart-contract source-code auditing.
- Full PDA derivation or recursive authority resolution.
- Automated remediation or transaction signing.
- Claiming that a wallet is controlled by a person or organization.
- Guaranteed exploitability judgments.
- Full treasury / Squads multisig membership decoding unless a separate verified adapter is added.
- AI-generated security verdicts. Rule-based findings are easier to test and explain for the first version.

## Repository structure

```text
authoritygraph/
├── apps/
│   ├── api/                 # Express + TypeScript API
│   └── web/                 # React + Vite dashboard
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PRODUCT_PLAN.md
│   ├── THREAT_MODEL.md
│   ├── SECURITY_RULES.md
│   ├── API.md
│   ├── VALIDATION_PLAN.md
│   ├── COMPETITIVE_RESEARCH.md
│   └── DEMO_SCRIPT.md
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.base.json
├── TECHSTACK.md
└── README.md
```

## Quick start

### Requirements
- Node.js 20 or newer
- npm 10 or newer
- A Solana RPC URL. Public devnet/mainnet endpoints can have rate limits; use a provider endpoint for reliable demos.

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the API

```bash
cp .env.example apps/api/.env
```

Set `SOLANA_RPC_URL` in `apps/api/.env`. The default in `.env.example` is Solana mainnet-beta. For demo testing, choose a cluster and use known addresses from that same cluster.

### 3. Start the app

```bash
npm run dev
```

- Web dashboard: http://localhost:5173
- API health check: http://localhost:4000/api/health

### 4. Try an analysis

Open the dashboard and submit a program ID or SPL token mint address. You can also call the API directly:

```bash
curl -X POST http://localhost:4000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address":"REPLACE_WITH_SOLANA_ADDRESS","kind":"auto"}'
```

Supported `kind` values: `auto`, `program`, `mint`.

## API behavior

- `GET /api/health` returns service health and configured cluster label.
- `POST /api/analyze` accepts an address and analysis kind.
- The API uses server-side RPC access. Never expose a private RPC key in frontend source.
- A valid address may still be an account type that the current analyzer does not support. The API should explain that instead of inventing a finding.

See [`docs/API.md`](docs/API.md).

## Security and accuracy notes

- The analyzer reads public on-chain data. It does not need a wallet connection.
- Never paste seed phrases or private keys into this project. The app has no legitimate use for them.
- Do not describe a finding as a confirmed vulnerability unless there is independently verified exploit evidence.
- RPC data can be stale, incomplete, or rate-limited. The UI must display analysis time and errors.
- The ProgramData decoder should be checked against official Solana loader layouts and known accounts before relying on it for consequential decisions.
- This is not an audit, legal opinion, or substitute for a professional security review.

## Development commands

```bash
npm run dev
npm run build
npm run typecheck
npm run test
```

## Hackathon submission checklist

- [ ] Confirm the current Colosseum submission requirements and deadline in the official Arena dashboard.
- [ ] Test with at least 3 known program accounts and 3 known token mints, including edge cases.
- [ ] Capture screenshots showing evidence and uncertainty handling.
- [ ] Record a short demo with a real account and a deliberately chosen test case.
- [ ] Publish setup instructions and architecture decisions.
- [ ] Disclose pre-existing code, dependencies, and any use of AI tools according to the event rules.
- [ ] Ask Solana builders to review the usefulness of the report; do not invent traction.
- [ ] Include known limitations in the submission.

## Roadmap

1. **MVP:** Program upgrade authority + token mint/freeze authority + evidence report.
2. **Reliability:** More fixtures, decoder tests, RPC retries/timeouts, and reproducible findings.
3. **Control relationships:** Carefully resolve known multisig and PDA patterns with explicit confidence labels.
4. **Change monitoring:** Store snapshots and alert when a privileged authority changes.
5. **Team workflow:** Exportable reports, review status, and policy baselines.
6. **Commercial validation:** Test paid monitoring with protocol teams and auditors before adding more features.

## License

No license has been selected yet. Add a license before accepting external contributions or presenting the repository as open source.
