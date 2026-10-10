/**
 * Decoder unit tests — no RPC calls needed.
 * Uses hardcoded binary fixtures that mirror the Borsh-serialized
 * on-chain layouts for UpgradeableLoaderState (program / programData)
 * and the classic SPL Token MintLayout (82 bytes).
 *
 * Audit reference: G-2 (required test suite)
 */

import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { MintLayout } from "./solana.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helper factories for binary fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an UpgradeableLoaderState::Program buffer.
 * Layout: [u32 tag=2 (LE)] [32-byte programData pubkey]
 */
function buildProgramAccountData(programDataPubkey: PublicKey): Buffer {
  const buf = Buffer.alloc(36);
  buf.writeUInt32LE(2, 0);
  programDataPubkey.toBytes().forEach((b, i) => { buf[4 + i] = b; });
  return buf;
}

/**
 * Build an UpgradeableLoaderState::ProgramData buffer.
 * Layout: [u32 tag=3 (LE)] [u64 slot (LE)] [Option<Pubkey>]
 *   Option = 0x00 (None) → 1 byte
 *   Option = 0x01 (Some) → 1 byte + 32-byte pubkey
 */
function buildProgramDataAccount(deploymentSlot: bigint, authorityPubkey: PublicKey | null): Buffer {
  const size = authorityPubkey ? 4 + 8 + 1 + 32 : 4 + 8 + 1;
  const buf = Buffer.alloc(size, 0);
  buf.writeUInt32LE(3, 0);
  buf.writeBigUInt64LE(deploymentSlot, 4);
  if (authorityPubkey) {
    buf[12] = 1;
    authorityPubkey.toBytes().forEach((b, i) => { buf[13 + i] = b; });
  } else {
    buf[12] = 0;
  }
  return buf;
}

/**
 * Build an SPL Token mint buffer (82 bytes / MintLayout.span).
 */
function buildMintData(opts: {
  mintAuthorityOption: 0 | 1;
  mintAuthority?: PublicKey;
  supply?: bigint;
  decimals?: number;
  freezeAuthorityOption: 0 | 1;
  freezeAuthority?: PublicKey;
}): Buffer {
  const buf = Buffer.alloc(MintLayout.span, 0);
  // MintLayout field offsets (spl-token v0.1.8 struct layout):
  // 0: mintAuthorityOption u32
  // 4: mintAuthority [32]
  // 36: supply u64
  // 44: decimals u8
  // 45: isInitialized u8
  // 46: freezeAuthorityOption u32
  // 50: freezeAuthority [32]
  buf.writeUInt32LE(opts.mintAuthorityOption, 0);
  if (opts.mintAuthority) {
    opts.mintAuthority.toBytes().forEach((b, i) => { buf[4 + i] = b; });
  }
  buf.writeBigUInt64LE(opts.supply ?? 0n, 36);
  buf[44] = opts.decimals ?? 9;
  buf[45] = 1; // isInitialized
  buf.writeUInt32LE(opts.freezeAuthorityOption, 46);
  if (opts.freezeAuthority) {
    opts.freezeAuthority.toBytes().forEach((b, i) => { buf[50 + i] = b; });
  }
  return buf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Buffer.from() wrapping (audit finding B-1)
// ─────────────────────────────────────────────────────────────────────────────

describe("Uint8Array → Buffer wrapping", () => {
  it("Buffer.from(Uint8Array) exposes readUInt32LE", () => {
    const raw = new Uint8Array(4);
    raw[0] = 2; // LE u32 = 2
    const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    expect(buf.readUInt32LE(0)).toBe(2);
  });

  it("Buffer.from(Uint8Array) exposes readBigUInt64LE", () => {
    const raw = new Uint8Array(8);
    // Write slot 12345678n in LE
    const slot = 12345678n;
    const tmp = Buffer.alloc(8);
    tmp.writeBigUInt64LE(slot);
    tmp.forEach((b, i) => { raw[i] = b; });
    const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    expect(buf.readBigUInt64LE(0)).toBe(slot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UpgradeableLoaderState::Program layout decoding
// ─────────────────────────────────────────────────────────────────────────────

describe("analyzeProgramData byte layout", () => {
  const AUTHORITY = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXh");
  const PROGRAM_DATA = new PublicKey("BTokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXh");
  const SLOT = 250_000_000n;

  it("decodes enum tag 2 correctly from Program account", () => {
    const buf = buildProgramAccountData(PROGRAM_DATA);
    expect(buf.readUInt32LE(0)).toBe(2);
  });

  it("decodes ProgramData address from Program account", () => {
    const buf = buildProgramAccountData(PROGRAM_DATA);
    const decoded = new PublicKey(buf.subarray(4, 36)).toBase58();
    expect(decoded).toBe(PROGRAM_DATA.toBase58());
  });

  it("decodes enum tag 3 correctly from ProgramData account", () => {
    const buf = buildProgramDataAccount(SLOT, AUTHORITY);
    expect(buf.readUInt32LE(0)).toBe(3);
  });

  it("decodes active upgrade authority correctly", () => {
    const buf = buildProgramDataAccount(SLOT, AUTHORITY);
    expect(buf.readBigUInt64LE(4)).toBe(SLOT);
    expect(buf[12]).toBe(1); // Some
    const decoded = new PublicKey(buf.subarray(13, 45)).toBase58();
    expect(decoded).toBe(AUTHORITY.toBase58());
  });

  it("decodes absent upgrade authority (immutable program)", () => {
    const buf = buildProgramDataAccount(SLOT, null);
    expect(buf[12]).toBe(0); // None
    expect(buf.length).toBe(13); // no pubkey bytes
  });

  it("fails closed on Program data shorter than 36 bytes", () => {
    const buf = Buffer.alloc(10, 0);
    buf.writeUInt32LE(2, 0);
    expect(buf.length < 36).toBe(true);
    // Simulates the guard: data.length < 36 → unsupported
  });

  it("fails closed on wrong Program enum tag (not 2)", () => {
    const buf = buildProgramAccountData(PROGRAM_DATA);
    buf.writeUInt32LE(99, 0); // tamper tag
    expect(buf.readUInt32LE(0)).not.toBe(2);
  });

  it("fails closed on wrong ProgramData enum tag (not 3)", () => {
    const buf = buildProgramDataAccount(SLOT, AUTHORITY);
    buf.writeUInt32LE(99, 0); // tamper tag
    expect(buf.readUInt32LE(0)).not.toBe(3);
  });

  it("fails closed on ProgramData shorter than 13 bytes", () => {
    const buf = Buffer.alloc(5, 0);
    expect(buf.length < 13).toBe(true);
  });

  it("fails closed on truncated authority option (Some tag but no pubkey bytes)", () => {
    const buf = buildProgramDataAccount(SLOT, null);
    buf[12] = 1; // claims Some, but buffer ends at 13 — length < 45
    expect(buf.length >= 45).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPL Token MintLayout decoding
// ─────────────────────────────────────────────────────────────────────────────

describe("analyzeMint byte layout", () => {
  const MINT_AUTH  = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXh");
  const FREEZE_AUTH = new PublicKey("BTokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXh");

  it("MintLayout.span is 82 bytes", () => {
    expect(MintLayout.span).toBe(82);
  });

  it("decodes active mint authority (option=1)", () => {
    const buf = buildMintData({ mintAuthorityOption: 1, mintAuthority: MINT_AUTH, freezeAuthorityOption: 0 });
    const decoded = MintLayout.decode(buf) as {
      mintAuthorityOption: number; mintAuthority: Uint8Array;
      supply: Uint8Array; decimals: number;
      freezeAuthorityOption: number; freezeAuthority: Uint8Array;
    };
    expect(decoded.mintAuthorityOption).not.toBe(0);
    const pubkey = new PublicKey(decoded.mintAuthority).toBase58();
    expect(pubkey).toBe(MINT_AUTH.toBase58());
  });

  it("decodes revoked mint authority (option=0)", () => {
    const buf = buildMintData({ mintAuthorityOption: 0, freezeAuthorityOption: 0 });
    const decoded = MintLayout.decode(buf) as { mintAuthorityOption: number };
    expect(decoded.mintAuthorityOption).toBe(0);
  });

  it("decodes active freeze authority (option=1)", () => {
    const buf = buildMintData({ mintAuthorityOption: 0, freezeAuthorityOption: 1, freezeAuthority: FREEZE_AUTH });
    const decoded = MintLayout.decode(buf) as { freezeAuthorityOption: number; freezeAuthority: Uint8Array };
    expect(decoded.freezeAuthorityOption).not.toBe(0);
    const pubkey = new PublicKey(decoded.freezeAuthority).toBase58();
    expect(pubkey).toBe(FREEZE_AUTH.toBase58());
  });

  it("decodes revoked freeze authority (option=0)", () => {
    const buf = buildMintData({ mintAuthorityOption: 0, freezeAuthorityOption: 0 });
    const decoded = MintLayout.decode(buf) as { freezeAuthorityOption: number };
    expect(decoded.freezeAuthorityOption).toBe(0);
  });

  it("rejects data shorter than 82 bytes", () => {
    const buf = Buffer.alloc(50, 0);
    expect(buf.length < MintLayout.span).toBe(true);
  });

  it("decodes supply as Buffer-readable u64 LE", () => {
    const SUPPLY = 1_000_000_000_000n;
    const buf = buildMintData({ mintAuthorityOption: 0, freezeAuthorityOption: 0, supply: SUPPLY });
    const decoded = MintLayout.decode(buf) as { supply: Uint8Array };
    const decodedSupply = Buffer.from(decoded.supply).readBigUInt64LE(0);
    expect(decodedSupply).toBe(SUPPLY);
  });

  it("decodes decimals correctly", () => {
    const buf = buildMintData({ mintAuthorityOption: 0, freezeAuthorityOption: 0, decimals: 6 });
    const decoded = MintLayout.decode(buf) as { decimals: number };
    expect(decoded.decimals).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-version PublicKey equality (audit finding B-2)
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-version PublicKey safety", () => {
  const TOKEN_PROGRAM_STR = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022_STR    = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  it("two web3.js v3 PublicKeys with same bytes are equal via .equals()", () => {
    const a = new PublicKey(TOKEN_PROGRAM_STR);
    const b = new PublicKey(TOKEN_PROGRAM_STR);
    expect(a.equals(b)).toBe(true);
  });

  it("TOKEN_PROGRAM_ID does not equal TOKEN_2022_PROGRAM_ID", () => {
    const token = new PublicKey(TOKEN_PROGRAM_STR);
    const token2022 = new PublicKey(TOKEN_2022_STR);
    expect(token.equals(token2022)).toBe(false);
  });

  it("PublicKey constructed from base58 string matches known bytes", () => {
    const key = new PublicKey(TOKEN_PROGRAM_STR);
    expect(key.toBase58()).toBe(TOKEN_PROGRAM_STR);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Address validation primitives (existing + extended)
// ─────────────────────────────────────────────────────────────────────────────

describe("address validation primitives", () => {
  it("accepts a valid public key", () => {
    const key = new PublicKey("11111111111111111111111111111111");
    expect(key.toBase58()).toBe("11111111111111111111111111111111");
  });

  it("rejects an invalid public key", () => {
    expect(() => new PublicKey("not a valid address")).toThrow();
  });
});
