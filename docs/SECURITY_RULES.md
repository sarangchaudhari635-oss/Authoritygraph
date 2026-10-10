# Security Rules (MVP)

Rules are deterministic observations. Severity is a prompt for review, not a probability of exploitation.

| Rule ID | Applies to | Condition | Initial severity | Meaning |
|---|---|---|---|---|
| `PROGRAM_UPGRADE_AUTHORITY_ACTIVE` | Upgradeable program | ProgramData records an upgrade authority | High | Code upgrade power exists; custody model must be reviewed |
| `PROGRAM_IMMUTABLE` | Upgradeable-loader program | ProgramData option contains no authority | Info | No upgrade authority is recorded in the decoded state |
| `PROGRAM_LOADER_UNSUPPORTED` | Executable program | Loader is outside supported adapter | Unknown | Authority model not analyzed |
| `TOKEN_MINT_AUTHORITY_ACTIVE` | SPL Token mint | Mint authority is non-null | Medium | Additional issuance is possible under current token state |
| `TOKEN_MINT_AUTHORITY_REVOKED` | SPL Token mint | Mint authority is null | Info | No mint authority is recorded |
| `TOKEN_FREEZE_AUTHORITY_ACTIVE` | SPL Token mint | Freeze authority is non-null | Medium | Freeze capability is recorded |
| `TOKEN_FREEZE_AUTHORITY_REVOKED` | SPL Token mint | Freeze authority is null | Info | No freeze authority is recorded |
| `ACCOUNT_NOT_EXECUTABLE` | Submitted program | Account executable flag is false | Info | Input is not an executable program account |

## Rule design principles
- Include observed values and source account.
- Separate status from severity.
- Avoid calling an active permission a vulnerability by default.
- Do not infer a multisig's signers from its address.
- Do not infer a PDA's controlling program without proof.
- Every rule should have a fixture and a test.
- Version rule IDs when semantics materially change.

## Known limitations
- This MVP does not enumerate every authority type in all Solana programs.
- It does not resolve indirect authorities or multisig thresholds.
- Token-2022 extensions can add behavior that is not represented by mint/freeze authority alone. Add extension-specific rules before claiming comprehensive Token-2022 coverage.
- ProgramData layout decoding must be verified against current official documentation and test fixtures.
