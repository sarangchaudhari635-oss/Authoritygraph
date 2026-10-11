/**
 * Token-2022 Extension TLV Parser
 *
 * The Token-2022 program (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb) appends
 * extensions after a 1-byte account-type discriminator that itself follows the
 * base 82-byte SPL Mint layout.
 *
 * Layout of a Token-2022 mint account:
 *   [0..82)   — base mint layout (identical to classic SPL Token)
 *   [82]      — account type discriminator (1 = Uninitialized, 2 = Mint, 3 = Account)
 *   [83..)    — zero or more TLV extensions:
 *                 [u16 LE type] [u16 LE length] [<length> bytes data]
 *
 * Reference:
 *   https://github.com/solana-labs/solana-program-library/blob/master/token/program-2022/src/extension/mod.rs
 *
 * IMPORTANT: This parser is fail-closed. Unknown extensions are detected (type
 * and length are read) but their data is not interpreted. Truncated TLV entries
 * cause parsing to stop with a warning. We never treat an unparsed extension as safe.
 */

import { PublicKey } from "@solana/web3.js";
import type { Token2022Extension, Finding, Severity } from "./types.js";

// Known extension type codes from spl-token-2022 ExtensionType enum
export const EXTENSION_TYPES: Record<number, string> = {
  0:  "Uninitialized",
  1:  "TransferFeeConfig",
  2:  "TransferFeeAmount",
  3:  "MintCloseAuthority",
  4:  "ConfidentialTransferMint",
  5:  "ConfidentialTransferAccount",
  6:  "DefaultAccountState",
  7:  "ImmutableOwner",
  8:  "MemoTransfer",
  9:  "NonTransferable",
  10: "InterestBearingConfig",
  11: "CpiGuard",
  12: "PermanentDelegate",
  13: "NonTransferableAccount",
  14: "TransferHook",
  15: "TransferHookAccount",
  16: "ConfidentialTransferFeeConfig",
  17: "ConfidentialTransferFeeAmount",
  18: "MetadataPointer",
  19: "TokenMetadata",
  20: "GroupPointer",
  21: "TokenGroup",
  22: "GroupMemberPointer",
  23: "TokenGroupMember",
};

/** Byte offset where extensions begin in a Token-2022 mint account */
const EXTENSION_START_OFFSET = 83; // 82 bytes base + 1 byte account type
/** TLV header size: 2 bytes type (u16 LE) + 2 bytes length (u16 LE) */
const TLV_HEADER_SIZE = 4;

function tryDecodePubkey(buf: Buffer, offset: number): string | null {
  if (buf.length < offset + 32) return null;
  const bytes = buf.subarray(offset, offset + 32);
  if (bytes.every(b => b === 0)) return null;
  try {
    return new PublicKey(bytes).toBase58();
  } catch {
    return null;
  }
}

function parseSingleExtension(
  buf: Buffer,
  offset: number
): { ext: Token2022Extension & { limitations?: string[] }; nextOffset: number } | null {
  if (buf.length < offset + TLV_HEADER_SIZE) return null;

  const typeCode = buf.readUInt16LE(offset);
  const dataLength = buf.readUInt16LE(offset + 2);
  const dataStart = offset + TLV_HEADER_SIZE;
  const nextOffset = dataStart + dataLength;
  const name = EXTENSION_TYPES[typeCode] ?? `Unknown(${typeCode})`;

  if (buf.length < nextOffset) {
    return {
      ext: {
        typeCode,
        name,
        parseStatus: "detected",
        limitations: [
          `Extension data truncated: expected ${dataLength} bytes at offset ${dataStart}, buffer ends at ${buf.length}.`
        ]
      },
      nextOffset: buf.length
    };
  }

  const data = buf.subarray(dataStart, nextOffset);
  let ext: Token2022Extension & { limitations?: string[] };

  switch (typeCode) {
    case 12: { // PermanentDelegate
      if (data.length < 32) {
        ext = { typeCode, name, parseStatus: "unsupported", limitations: ["Data too short (expected 32 bytes)."] };
        break;
      }
      const delegate = tryDecodePubkey(Buffer.from(data), 0);
      ext = {
        typeCode, name, parseStatus: "parsed",
        authority: delegate,
        fields: { delegate: delegate ?? null },
        findingId: delegate ? "TOKEN_2022_PERMANENT_DELEGATE" : undefined
      };
      break;
    }
    case 3: { // MintCloseAuthority
      if (data.length < 32) {
        ext = { typeCode, name, parseStatus: "unsupported", limitations: ["Data too short (expected 32 bytes)."] };
        break;
      }
      const closeAuth = tryDecodePubkey(Buffer.from(data), 0);
      ext = {
        typeCode, name, parseStatus: "parsed",
        authority: closeAuth,
        fields: { closeAuthority: closeAuth ?? null },
        findingId: closeAuth ? "TOKEN_2022_MINT_CLOSE_AUTHORITY" : undefined
      };
      break;
    }
    case 6: { // DefaultAccountState
      if (data.length < 1) {
        ext = { typeCode, name, parseStatus: "unsupported", limitations: ["Data too short (expected 1 byte)."] };
        break;
      }
      const stateCode = data[0];
      const stateNames: Record<number, string> = { 0: "Uninitialized", 1: "Initialized", 2: "Frozen" };
      const stateName = stateNames[stateCode] ?? `Unknown(${stateCode})`;
      ext = {
        typeCode, name, parseStatus: "parsed",
        fields: { defaultState: stateName, stateCode },
        findingId: stateCode === 2 ? "TOKEN_2022_DEFAULT_FROZEN" : undefined
      };
      break;
    }
    case 1: { // TransferFeeConfig
      if (data.length < 64) {
        ext = { typeCode, name, parseStatus: "unsupported", limitations: ["Data too short for authority fields (expected >= 64 bytes)."] };
        break;
      }
      const feeConfigAuth = tryDecodePubkey(Buffer.from(data), 0);
      const withdrawAuth = tryDecodePubkey(Buffer.from(data), 32);
      // newer_transfer_fee: epoch(8) + max_fee(8) + basis_points(2) at offset 64+8+8 = 80
      let feeBps: number | null = null;
      if (data.length >= 82) {
        feeBps = Buffer.from(data).readUInt16LE(80);
      }
      ext = {
        typeCode, name, parseStatus: "parsed",
        authority: feeConfigAuth,
        fields: {
          transferFeeConfigAuthority: feeConfigAuth ?? null,
          withheldAmountAuthority: withdrawAuth ?? null,
          feeBasisPoints: feeBps
        },
        findingId: "TOKEN_2022_TRANSFER_FEE"
      };
      break;
    }
    case 14: { // TransferHook
      if (data.length < 64) {
        ext = { typeCode, name, parseStatus: "unsupported", limitations: ["Data too short (expected 64 bytes)."] };
        break;
      }
      const hookAuth = tryDecodePubkey(Buffer.from(data), 0);
      const hookProgram = tryDecodePubkey(Buffer.from(data), 32);
      ext = {
        typeCode, name, parseStatus: "parsed",
        authority: hookAuth,
        fields: { authority: hookAuth ?? null, programId: hookProgram ?? null },
        findingId: hookProgram ? "TOKEN_2022_TRANSFER_HOOK" : undefined
      };
      break;
    }
    case 10: { // InterestBearingConfig
      if (data.length < 32) {
        ext = { typeCode, name, parseStatus: "unsupported", limitations: ["Data too short."] };
        break;
      }
      const rateAuth = tryDecodePubkey(Buffer.from(data), 0);
      let currentRate: number | null = null;
      // Layout: rateAuth(32) + init_timestamp(8) + pre_update_avg(2) + last_update_ts(8) + current_rate(2)
      if (data.length >= 52) {
        currentRate = Buffer.from(data).readInt16LE(50);
      }
      ext = {
        typeCode, name, parseStatus: "parsed",
        authority: rateAuth,
        fields: { rateAuthority: rateAuth ?? null, currentRateBps: currentRate }
      };
      break;
    }
    case 9:  // NonTransferable (no data payload)
      ext = { typeCode, name, parseStatus: "parsed", fields: { nonTransferable: true }, findingId: "TOKEN_2022_NON_TRANSFERABLE" };
      break;
    case 7:  // ImmutableOwner (no data payload)
      ext = { typeCode, name, parseStatus: "parsed", fields: { immutableOwner: true } };
      break;
    case 18: { // MetadataPointer
      if (data.length < 64) {
        ext = { typeCode, name, parseStatus: "detected" };
        break;
      }
      const metaAuth = tryDecodePubkey(Buffer.from(data), 0);
      const metaAddr = tryDecodePubkey(Buffer.from(data), 32);
      ext = {
        typeCode, name, parseStatus: "parsed",
        authority: metaAuth,
        fields: { authority: metaAuth ?? null, metadataAddress: metaAddr ?? null }
      };
      break;
    }
    case 4:  // ConfidentialTransferMint (ZK, complex layout)
      ext = {
        typeCode, name, parseStatus: "detected",
        limitations: ["ConfidentialTransfer uses zero-knowledge proofs. Full parsing not supported; presence reported only."]
      };
      break;
    default:
      ext = {
        typeCode, name,
        parseStatus: typeCode in EXTENSION_TYPES ? "detected" : "unsupported",
        limitations: [
          typeCode in EXTENSION_TYPES
            ? `Extension "${name}" is recognized but full parsing is not implemented. Presence reported only.`
            : `Extension type code ${typeCode} is not recognized. Presence reported only.`
        ]
      };
      break;
  }

  return { ext, nextOffset };
}

export function parseToken2022Extensions(buf: Buffer | Uint8Array): {
  extensions: (Token2022Extension & { limitations?: string[] })[];
  warnings: string[];
} {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const extensions: (Token2022Extension & { limitations?: string[] })[] = [];
  const warnings: string[] = [];

  if (data.length <= EXTENSION_START_OFFSET) {
    return { extensions, warnings };
  }

  const accountTypeByte = data[82];
  if (accountTypeByte !== 2) {
    warnings.push(
      `Token-2022 account-type byte at offset 82 is ${accountTypeByte} (expected 2 for Mint). ` +
      "Extension parsing may be unreliable."
    );
  }

  let offset = EXTENSION_START_OFFSET;
  const MAX_EXTENSIONS = 32;
  let count = 0;

  while (offset < data.length && count < MAX_EXTENSIONS) {
    const result = parseSingleExtension(data, offset);
    if (!result) break;
    const { ext, nextOffset } = result;
    if (ext.typeCode !== 0) extensions.push(ext);
    if (nextOffset <= offset) break;
    offset = nextOffset;
    count++;
  }

  if (count >= MAX_EXTENSIONS) {
    warnings.push("Extension parsing stopped at safety limit (32). Additional extensions may exist.");
  }

  return { extensions, warnings };
}

export function extensionsToFindings(
  extensions: (Token2022Extension & { limitations?: string[] })[],
  mintAddress: string
): Finding[] {
  const findings: Finding[] = [];

  for (const ext of extensions) {
    switch (ext.typeCode) {
      case 12: { // PermanentDelegate
        const delegate = ext.authority;
        if (delegate) {
          findings.push({
            id: "TOKEN_2022_PERMANENT_DELEGATE",
            title: "Permanent delegate is configured",
            severity: "high" as Severity,
            status: "present",
            summary:
              "A permanent delegate is configured. The delegate can transfer or burn tokens from " +
              "any token account without the holder's consent.",
            evidence: [{
              source: "Token-2022 PermanentDelegate extension (type 12)",
              accountAddress: mintAddress,
              observedValue: delegate,
              detail: "Decoded 32-byte delegate address from TLV extension."
            }],
            recommendation:
              "Verify the purpose and custody of the permanent delegate address. " +
              "This authority can move or burn any holder's balance.",
            limitations: ["This does not determine whether the delegate is a multisig or governance PDA."]
          });
        } else if (ext.parseStatus === "parsed") {
          findings.push({
            id: "TOKEN_2022_PERMANENT_DELEGATE_NULL",
            title: "Permanent delegate extension present but delegate is null",
            severity: "info" as Severity,
            status: "absent",
            summary: "The PermanentDelegate extension is present but no delegate address is set (all-zero).",
            evidence: [{
              source: "Token-2022 PermanentDelegate extension (type 12)",
              accountAddress: mintAddress,
              observedValue: "null",
              detail: "Extension parsed; delegate field is all-zero bytes."
            }],
            recommendation: "Confirm whether a delegate was revoked or was never set.",
            limitations: []
          });
        }
        break;
      }
      case 6: { // DefaultAccountState
        const stateCode = ext.fields?.stateCode as number | undefined;
        const stateName = ext.fields?.defaultState as string | undefined;
        if (stateCode === 2) {
          findings.push({
            id: "TOKEN_2022_DEFAULT_FROZEN",
            title: "New token accounts are frozen by default",
            severity: "medium" as Severity,
            status: "present",
            summary:
              "DefaultAccountState is set to Frozen. Every new token account starts frozen " +
              "and cannot transfer tokens until thawed by the freeze authority.",
            evidence: [{
              source: "Token-2022 DefaultAccountState extension (type 6)",
              accountAddress: mintAddress,
              observedValue: `AccountState=${stateName}`,
              detail: "Decoded 1-byte state from TLV extension."
            }],
            recommendation:
              "Confirm whether this is an intended allowlist mechanism or an undisclosed restriction.",
            limitations: ["The freeze authority that can thaw accounts is reported in the base mint fields."]
          });
        } else if (stateCode !== undefined && stateCode !== 1 && stateCode !== 0) {
          findings.push({
            id: "TOKEN_2022_DEFAULT_ACCOUNT_STATE_UNUSUAL",
            title: "Unusual default account state configured",
            severity: "unknown" as Severity,
            status: "present",
            summary: `DefaultAccountState has an unrecognized state value: ${stateName}.`,
            evidence: [{
              source: "Token-2022 DefaultAccountState extension (type 6)",
              accountAddress: mintAddress,
              observedValue: `AccountState=${stateName}(${stateCode})`,
              detail: "Decoded 1-byte state; value is not a known AccountState variant."
            }],
            recommendation: "Inspect the extension data manually.",
            limitations: ["Unknown state values may indicate a newer protocol version or data corruption."]
          });
        }
        break;
      }
      case 3: { // MintCloseAuthority
        const closeAuth = ext.authority;
        if (closeAuth) {
          findings.push({
            id: "TOKEN_2022_MINT_CLOSE_AUTHORITY",
            title: "Mint close authority is configured",
            severity: "medium" as Severity,
            status: "present",
            summary:
              "A mint close authority is configured. This address can close (destroy) the mint account " +
              "and reclaim its rent lamports, rendering all token accounts inoperable.",
            evidence: [{
              source: "Token-2022 MintCloseAuthority extension (type 3)",
              accountAddress: mintAddress,
              observedValue: closeAuth,
              detail: "Decoded 32-byte authority from TLV extension."
            }],
            recommendation:
              "Verify the purpose of the mint close authority. Closing the mint requires zero supply. " +
              "Confirm it is appropriately secured.",
            limitations: ["The mint can only be closed when total supply is zero."]
          });
        }
        break;
      }
      case 1: { // TransferFeeConfig
        const feeBps = ext.fields?.feeBasisPoints;
        const feeAuth = ext.fields?.transferFeeConfigAuthority;
        findings.push({
          id: "TOKEN_2022_TRANSFER_FEE",
          title: "Transfer fee configuration is present",
          severity: "low" as Severity,
          status: "present",
          summary:
            "A transfer fee extension is configured. A percentage of each transfer is withheld " +
            "and collectable by the fee authority.",
          evidence: [{
            source: "Token-2022 TransferFeeConfig extension (type 1)",
            accountAddress: mintAddress,
            observedValue: feeBps !== null && feeBps !== undefined
              ? `${feeBps} basis points (${(Number(feeBps) / 100).toFixed(2)}%)`
              : "fee basis points not decoded",
            detail: `TransferFeeConfigAuthority=${feeAuth ?? "not parsed"}.`
          }],
          recommendation:
            "Confirm the fee rate and the authority that can update it. Verify disclosure to holders.",
          limitations: ["Fee rates can be changed by the fee config authority."]
        });
        break;
      }
      case 14: { // TransferHook
        const hookProgram = ext.fields?.programId as string | null | undefined;
        if (hookProgram) {
          findings.push({
            id: "TOKEN_2022_TRANSFER_HOOK",
            title: "Transfer hook program is configured",
            severity: "high" as Severity,
            status: "present",
            summary:
              "A transfer hook program executes on every token transfer and can enforce " +
              "arbitrary logic, including blocking transfers or applying additional charges.",
            evidence: [{
              source: "Token-2022 TransferHook extension (type 14)",
              accountAddress: mintAddress,
              observedValue: hookProgram,
              detail: `TransferHook programId decoded from TLV extension. Authority=${ext.authority ?? "none"}.`
            }],
            recommendation:
              "Audit the transfer hook program before interacting with this token. " +
              "The hook program can block, modify, or charge fees on every transfer.",
            limitations: [
              "This reports the hook program ID only. The hook program logic must be audited separately.",
              "The hook program itself may be upgradeable."
            ]
          });
        }
        break;
      }
      case 9: { // NonTransferable
        findings.push({
          id: "TOKEN_2022_NON_TRANSFERABLE",
          title: "Token is marked non-transferable",
          severity: "medium" as Severity,
          status: "present",
          summary:
            "The NonTransferable extension is present. Tokens cannot be transferred between accounts.",
          evidence: [{
            source: "Token-2022 NonTransferable extension (type 9)",
            accountAddress: mintAddress,
            observedValue: "NonTransferable=true",
            detail: "Presence of the NonTransferable extension flag (no data payload)."
          }],
          recommendation: "Confirm whether non-transferability is an intended soul-bound or credential token design.",
          limitations: []
        });
        break;
      }
      default:
        break;
    }
  }

  return findings;
}
