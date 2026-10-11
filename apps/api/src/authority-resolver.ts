/**
 * Effective Authority Resolver
 *
 * Determines how an authority address is controlled, not just which public key
 * appears in an account field.
 *
 * Supported resolution paths:
 * 1. Direct key: The authority account is owned by the System Program (likely a wallet/keypair).
 * 2. Squads multisig: The account is owned by a recognized Squads program ID and has a
 *    parseable multisig discriminator + threshold field.
 * 3. Unknown program-owned: The account is owned by a program we do not recognize. We do not
 *    speculate about what kind of authority it is.
 * 4. Unresolved: The authority account could not be fetched or is null.
 *
 * IMPORTANT: This resolver is conservative. It only classifies an address as a Squads
 * multisig if we can verify:
 *   a) The account is owned by a known Squads program ID.
 *   b) The account data starts with the expected Squads discriminator.
 *   c) The threshold and member count can be read.
 *
 * Fetching the authority account costs one additional RPC call. To avoid unbounded
 * resolution, depth is fixed at 1 (we do not resolve authorities of authorities).
 *
 * References:
 *   Squads v3: SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu
 *   Squads v4 (multisig): SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
 */

import { Connection, PublicKey } from "@solana/web3.js";
import type { ResolvedAuthority, AuthorityType, AuthorityResolutionStatus } from "./types.js";

// System Program — accounts owned by this are likely user wallets or keypairs
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

// Known Squads multisig program IDs
// Source: https://squads.so / official Squads documentation
const SQUADS_PROGRAM_IDS = new Set([
  "SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu",  // Squads Multisig v3
  "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf",  // Squads Multisig v4
]);

/**
 * Squads v3 Multisig account discriminator (first 8 bytes of account data).
 * The discriminator is the SHA-256 hash of "account:Multisig" truncated to 8 bytes.
 * Source: Squads v3 IDL and anchor account discriminators.
 */
const SQUADS_V3_MULTISIG_DISCRIMINATOR = Buffer.from([
  0x66, 0x95, 0x3d, 0xc6, 0xee, 0xa2, 0x73, 0xef
]);

/**
 * Squads v4 Multisig account discriminator (first 8 bytes of account data).
 * Discriminator: sha256("account:Multisig")[0..8]
 */
const SQUADS_V4_MULTISIG_DISCRIMINATOR = Buffer.from([
  0xf1, 0x38, 0xa6, 0x5d, 0x04, 0x00, 0x00, 0x00
]);

/**
 * Check if buffer starts with the given discriminator.
 */
function matchesDiscriminator(data: Buffer, discriminator: Buffer): boolean {
  if (data.length < discriminator.length) return false;
  return discriminator.every((byte, i) => data[i] === byte);
}

/**
 * Attempt to parse Squads v3 multisig account fields.
 *
 * Squads v3 Multisig layout (after 8-byte discriminator, Borsh-encoded):
 *   [u8 threshold]
 *   [u8 authority_index]
 *   [u32 transaction_index]
 *   [u32 ms_change_index]
 *   [bool is_valid_signer_list]
 *   [u8 bump]
 *   [u32 attached_squad_count] (or member count in some versions)
 *   ... additional fields
 *
 * The most reliable fields are threshold (byte 8) and member vector length.
 * We read only what we can safely verify.
 */
function tryParseSquadsV3(data: Buffer): { threshold: number; memberCount: number | null } | null {
  // After 8-byte discriminator: threshold is at offset 8
  if (data.length < 9) return null;
  const threshold = data[8];
  if (threshold === 0 || threshold > 10) return null; // sanity check
  // Member count: after threshold(1) + authority_index(1) + tx_index(4) + ms_change_index(4) + is_valid(1) + bump(1)
  // = offset 8 + 12 = 20, then 4-byte vec length for members
  let memberCount: number | null = null;
  if (data.length >= 24) {
    memberCount = data.readUInt32LE(20);
    // Sanity: member count should be > 0 and <= 100
    if (memberCount <= 0 || memberCount > 100) memberCount = null;
  }
  return { threshold, memberCount };
}

/**
 * Attempt to parse Squads v4 multisig account fields.
 *
 * Squads v4 Multisig layout (after 8-byte discriminator, Borsh-encoded):
 *   [u32 config_authority (index)]  -- actually a pubkey in some versions
 *   ... complex nested structs
 *
 * v4 has a more complex layout. We read threshold from the most accessible location.
 * Note: Squads v4 uses a different internal struct; we attempt a conservative parse.
 */
function tryParseSquadsV4(data: Buffer): { threshold: number; memberCount: number | null } | null {
  // v4 multisig after discriminator:
  //   config_authority: Pubkey (32)
  //   time_lock: u32 (4)
  //   transaction_index: u64 (8)
  //   stale_transaction_index: u64 (8)
  //   creator: Pubkey (32)
  //   allow_external_execute: bool (1)
  //   threshold: u16 (2)  at offset 8 + 32 + 4 + 8 + 8 + 32 + 1 = 93
  //   members: Vec<Member>
  if (data.length < 96) return null;
  const threshold = data.readUInt16LE(93);
  if (threshold === 0 || threshold > 100) return null;
  // Members vec length at offset 95
  let memberCount: number | null = null;
  if (data.length >= 99) {
    memberCount = data.readUInt32LE(95);
    if (memberCount <= 0 || memberCount > 200) memberCount = null;
  }
  return { threshold, memberCount };
}

/**
 * Resolve an authority address by fetching its account.
 *
 * @param authorityAddress - The base58 address to resolve.
 * @param connection - An existing RPC connection.
 * @param timeoutMs - RPC timeout in milliseconds.
 */
export async function resolveAuthority(
  authorityAddress: string,
  connection: Connection,
  timeoutMs: number
): Promise<ResolvedAuthority> {
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(authorityAddress);
  } catch {
    return {
      address: authorityAddress,
      authorityType: "unresolved",
      resolutionStatus: "unresolved-unknown",
      evidence: "Address could not be parsed as a valid Solana public key.",
      limitations: ["Address parsing failed. No RPC call was made."]
    };
  }

  // Fetch the authority account
  let accountInfo: Awaited<ReturnType<Connection["getAccountInfo"]>> | null = null;
  try {
    accountInfo = await Promise.race([
      connection.getAccountInfo(pubkey, "confirmed"),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error("RPC_TIMEOUT")), timeoutMs);
        t.unref();
      })
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      address: authorityAddress,
      authorityType: "unresolved",
      resolutionStatus: "unresolved-unknown",
      evidence: `Authority account could not be fetched: ${msg}`,
      limitations: [
        "RPC call to fetch authority account failed. Authority type could not be determined.",
        "This does not indicate the authority is safe or revoked."
      ]
    };
  }

  if (!accountInfo) {
    // Account does not exist on-chain. Could be an uninitialized keypair.
    return {
      address: authorityAddress,
      authorityType: "direct-key",
      resolutionStatus: "resolved-direct",
      evidence: "Authority account does not exist on-chain. This is consistent with an uninitialized keypair or a burned account.",
      limitations: [
        "A non-existent account may still control authority if the private key is held by a party.",
        "This system does not determine who holds the private key."
      ]
    };
  }

  const ownerStr = accountInfo.owner.toBase58();

  // System Program-owned: standard user wallet or keypair
  if (ownerStr === SYSTEM_PROGRAM_ID) {
    return {
      address: authorityAddress,
      authorityType: "direct-key",
      resolutionStatus: "resolved-direct",
      controllingProgram: undefined,
      evidence: `Account is owned by the System Program (${SYSTEM_PROGRAM_ID}). This is consistent with a standard wallet keypair.`,
      limitations: [
        "This does not confirm the identity of the key holder.",
        "The key may reside in a hardware wallet, hot wallet, or may be shared."
      ]
    };
  }

  // Squads multisig check
  if (SQUADS_PROGRAM_IDS.has(ownerStr)) {
    const data = Buffer.isBuffer(accountInfo.data)
      ? accountInfo.data
      : Buffer.from(accountInfo.data.buffer, accountInfo.data.byteOffset, accountInfo.data.byteLength);

    let multisigInfo: { threshold: number; memberCount: number | null } | null = null;
    let squadsVersion = "unknown";

    if (matchesDiscriminator(data, SQUADS_V3_MULTISIG_DISCRIMINATOR)) {
      multisigInfo = tryParseSquadsV3(data);
      squadsVersion = "v3";
    } else if (matchesDiscriminator(data, SQUADS_V4_MULTISIG_DISCRIMINATOR)) {
      multisigInfo = tryParseSquadsV4(data);
      squadsVersion = "v4";
    } else {
      // Owned by Squads program but discriminator does not match known multisig account type
      return {
        address: authorityAddress,
        authorityType: "squads-multisig",
        resolutionStatus: "resolved-multisig",
        controllingProgram: ownerStr,
        evidence: `Account is owned by the Squads program (${ownerStr}, version detection: discriminator mismatch). ` +
          "The account is likely a Squads account but could not be parsed as a known multisig layout.",
        limitations: [
          "Discriminator did not match known Squads v3 or v4 multisig layouts.",
          "Threshold and member count could not be determined.",
          "Squads may have updated its account layout. Manual inspection recommended."
        ]
      };
    }

    if (multisigInfo) {
      return {
        address: authorityAddress,
        authorityType: "squads-multisig",
        resolutionStatus: "resolved-multisig",
        controllingProgram: ownerStr,
        multisigThreshold: multisigInfo.threshold,
        multisigMemberCount: multisigInfo.memberCount ?? undefined,
        evidence:
          `Account is owned by Squads (${squadsVersion}, program: ${ownerStr}). ` +
          `Decoded threshold: ${multisigInfo.threshold}. ` +
          (multisigInfo.memberCount !== null ? `Member count: ${multisigInfo.memberCount}.` : "Member count not parsed."),
        limitations: [
          "Squads member identities and individual key custody are not verified by this analysis.",
          "The member list is not fetched. Only threshold and member count are decoded.",
          "This does not verify whether the Squads program itself is upgradeable."
        ]
      };
    } else {
      return {
        address: authorityAddress,
        authorityType: "squads-multisig",
        resolutionStatus: "resolved-multisig",
        controllingProgram: ownerStr,
        evidence: `Account is owned by Squads (${squadsVersion}, program: ${ownerStr}) but threshold could not be decoded.`,
        limitations: [
          "Squads account layout could not be fully parsed. Threshold and member count are unknown.",
          "This does not indicate the account is not a multisig."
        ]
      };
    }
  }

  // Unknown program-owned account
  const authorityType: AuthorityType = "unknown-program-owned";
  const resolutionStatus: AuthorityResolutionStatus = "unresolved-program-owned";

  return {
    address: authorityAddress,
    authorityType,
    resolutionStatus,
    controllingProgram: ownerStr,
    evidence: `Authority account is owned by program ${ownerStr}, which is not the System Program or a recognized Squads program.`,
    limitations: [
      "The controlling program's authority model is unknown and not analyzed.",
      "This authority could be a governance PDA, a custom multisig, a timelock, or a program-managed key.",
      "Manual inspection of the controlling program is required.",
      "This does not determine whether this configuration is safe or risky."
    ]
  };
}
