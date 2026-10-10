# API Reference

Base URL in local development: `http://localhost:4000`

## GET `/api/health`

Returns service health and configured cluster label.

Example:
```json
{
  "status": "ok",
  "service": "authoritygraph-api",
  "cluster": "mainnet-beta",
  "timestamp": "2026-10-10T12:00:00.000Z"
}
```

## POST `/api/analyze`

Request:
```json
{
  "address": "BASE58_SOLANA_ADDRESS",
  "kind": "auto"
}
```

`kind` is one of:
- `auto`
- `program`
- `mint`

Success response shape:
```json
{
  "address": "...",
  "kind": "mint",
  "cluster": "mainnet-beta",
  "observedAt": "...",
  "result": "findings",
  "summary": "...",
  "findings": [
    {
      "id": "TOKEN_MINT_AUTHORITY_ACTIVE",
      "title": "Mint authority is active",
      "severity": "medium",
      "status": "present",
      "summary": "...",
      "evidence": [
        {
          "source": "Solana RPC account data",
          "accountAddress": "...",
          "observedValue": "...",
          "detail": "..."
        }
      ],
      "recommendation": "..."
    }
  ],
  "warnings": []
}
```

Possible HTTP errors:
- `400 INVALID_REQUEST`: request body failed schema validation.
- `400 INVALID_ADDRESS`: address could not be parsed.
- `502 ANALYSIS_FAILED`: RPC or analysis failure.
- `404 NOT_FOUND`: unknown route.

A successful HTTP response can still have `result: "unsupported"`. This means the account was read but could not be safely analyzed by the current adapters.
