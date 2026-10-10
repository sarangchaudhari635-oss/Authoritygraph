# Validation Plan

## 1. Decoder validation

Before demoing as reliable, create a fixture table with:
- Known upgradeable program with active authority
- Known program with no upgrade authority, if available
- Executable program owned by another loader
- Non-executable account submitted as program
- Missing address
- Known SPL Token mint with mint authority
- Known SPL Token mint with revoked mint authority
- Known mint with freeze authority
- Token-2022 mint
- Token account submitted instead of mint
- Invalid base58 address
- Unexpected / truncated binary account data

For each fixture, record:
- Cluster
- Address
- Expected account type
- Expected direct authority
- Independent verification source
- Date checked
- Test result

Do not put private information in fixtures. Public addresses are fine.

## 2. Manual verification

For every decoder:
1. Read official Solana / SPL Token documentation.
2. Compare API output with an independent explorer or trusted RPC query.
3. Verify the raw account owner and executable flag.
4. Verify decoded authority values independently.
5. Confirm unsupported cases return no confident conclusion.
6. Repeat after dependency upgrades.

## 3. Product tests

Ask 3 to 5 Solana builders or security reviewers to:
- Analyze an address they know.
- Explain what each finding means.
- Identify missing context.
- Decide what they would do next.
- Compare the report with their current workflow.

Record the task completion and feedback. Do not report interviews as users, and do not report expressions of interest as revenue.

## 4. Release gate

Do not present the demo as production-ready until:
- Typecheck and tests pass.
- Known fixtures match expected results.
- Errors are understandable.
- Unknown layouts fail closed.
- The demo identifies its cluster and timestamp.
- Security claims and limitations are visible.
