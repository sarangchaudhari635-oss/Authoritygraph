# Contributing

## Before contributing
- Read `README.md`, `docs/ARCHITECTURE.md`, and `docs/THREAT_MODEL.md`.
- Never add private keys, seed phrases, or RPC credentials to source control.
- Do not change a rule's meaning without updating its documentation and tests.

## Development
```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
```

## Security-sensitive changes
Every decoder or rule change should include:
- A known fixture or reproducible test
- A description of evidence used
- Failure behavior for unsupported data
- Documentation of assumptions and limitations

Prefer `unknown` over a guessed security conclusion.
