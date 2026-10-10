# AuthorityGraph Tech Stack

## Stack summary

| Layer | Technology | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite | Fast iteration and typed UI |
| Styling | Tailwind CSS | Quick, consistent dashboard styling |
| API | Node.js + Express + TypeScript | Small, easy-to-debug service |
| Validation | Zod | Runtime validation at the API boundary |
| Solana RPC | `@solana/web3.js` | Read account state from Solana |
| SPL tokens | `@solana/spl-token` | Decode classic SPL Token and Token-2022 mints |
| HTTP | `fetch` / browser fetch | Simple API calls |
| Tests | Vitest | Unit and API tests |
| Local development | npm workspaces + concurrently | Run web and API from one command |
| Hosting | Any Node-compatible host + static frontend host | Keep the API RPC key server-side |

## Architecture choice

This MVP is a monorepo with two applications:
- `apps/api`: server-side RPC access and analysis rules.
- `apps/web`: client dashboard that calls the API.

The browser must not call a private RPC endpoint directly. RPC credentials, if used, belong in the API environment.

## Solana libraries

### `@solana/web3.js`
Used for:
- `Connection`
- `PublicKey`
- Reading account information
- Reading the cluster's current slot where available

### `@solana/spl-token`
Used for:
- Classic SPL Token program ID
- Token-2022 program ID
- `unpackMint` for mint authority and freeze authority fields

### Upgradeable program analysis
The API reads the executable program account. For the upgradeable BPF loader, the program account points to a ProgramData account. The initial adapter decodes the documented binary fields for the known loader layout. This code must be validated against current Solana documentation and real fixtures before the result is treated as authoritative.

Important: if the loader owner, account state, or data length is unexpected, return `unsupported` or `unverified`. Do not guess.

## Data model

An analysis response contains:
- Input address and detected account kind
- Cluster and observation timestamp
- Summary status
- Findings array
- Evidence for each finding
- Warnings and limitations

Each finding contains:
- Stable rule ID
- Title and explanation
- Severity (`critical`, `high`, `medium`, `low`, `info`, `unknown`)
- Status (`present`, `absent`, `unknown`)
- Evidence references
- Suggested next action
- Confidence / limitations

## Why no database in MVP?

The first version can be stateless. It avoids collecting user data and keeps deployment simple. Add PostgreSQL only when the product needs saved projects, historical snapshots, team membership, or alert subscriptions.

## Why no AI verdict in MVP?

Security findings should be deterministic and reproducible. AI can later help explain a verified finding in plain language, but must not create or change the underlying technical verdict. Any AI explanation should cite the rule and evidence used.

## Environment variables

| Variable | Required | Description |
|---|---:|---|
| `PORT` | No | API port, default 4000 |
| `SOLANA_RPC_URL` | Yes | RPC endpoint for the chosen cluster |
| `SOLANA_CLUSTER` | No | Human-readable cluster label |
| `CORS_ORIGIN` | No | Allowed frontend origin |
| `REQUEST_TIMEOUT_MS` | No | Timeout for analysis requests |

Never commit real RPC credentials or `.env` files.
