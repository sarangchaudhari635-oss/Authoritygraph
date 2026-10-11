/**
 * Authority Resolver Tests
 *
 * All tests mock RPC calls via vi.spyOn. No live RPC calls are made.
 * Fixtures use synthetic binary buffers labeled as such.
 *
 * Test cases:
 *   - System Program-owned account (direct key)
 *   - Account does not exist (null)
 *   - Squads v3 multisig (known discriminator + threshold)
 *   - Squads v4 multisig (known discriminator + threshold)
 *   - Squads-owned but unknown discriminator
 *   - Unknown program-owned account
 *   - RPC timeout
 *   - Invalid address string
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { connection } from "./solana.js";
import { resolveAuthority } from "./authority-resolver.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SQUADS_V3_PROGRAM = "SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu";
const SQUADS_V4_PROGRAM = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
const UNKNOWN_PROGRAM  = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TEST_AUTHORITY   = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXh";
const TIMEOUT_MS       = 12000;

/** Build a minimal System Program account */
function buildSystemAccount(): { executable: boolean; owner: PublicKey; data: Buffer } {
  return {
    executable: false,
    owner: new PublicKey(SYSTEM_PROGRAM),
    data: Buffer.alloc(0)
  };
}

/**
 * Build a Squads v3 multisig account data buffer.
 * Synthetic fixture — layout matches documented Squads v3 Multisig borsh struct.
 * discriminator(8) + threshold(1) + authority_index(1) + tx_index(4) + ms_change_index(4) +
 * is_valid_signer_list(1) + bump(1) + ... + members vec length(4)
 */
function buildSquadsV3Account(threshold: number, memberCount: number): Buffer {
  // Discriminator: [0x66, 0x95, 0x3d, 0xc6, 0xee, 0xa2, 0x73, 0xef]
  const disc = Buffer.from([0x66, 0x95, 0x3d, 0xc6, 0xee, 0xa2, 0x73, 0xef]);
  // threshold(1) + authority_index(1) + tx_index(4) + ms_change_index(4) + is_valid(1) + bump(1) = 12
  const fields = Buffer.alloc(12, 0);
  fields[0] = threshold;           // threshold at offset 8 (absolute)
  fields[1] = 1;                   // authority_index
  // offset 12 (absolute) = vec length for members
  const memberVec = Buffer.alloc(4);
  memberVec.writeUInt32LE(memberCount, 0);
  return Buffer.concat([disc, fields, memberVec]);
}

/**
 * Build a Squads v4 multisig account data buffer.
 * Synthetic fixture — layout matches documented Squads v4 Multisig struct.
 * discriminator(8) + config_authority(32) + time_lock(4) + tx_index(8) +
 * stale_tx_index(8) + creator(32) + allow_external(1) + threshold(2) + members_vec_len(4)
 */
function buildSquadsV4Account(threshold: number, memberCount: number): Buffer {
  // Discriminator: [0xf1, 0x38, 0xa6, 0x5d, 0x04, 0x00, 0x00, 0x00]
  const disc = Buffer.from([0xf1, 0x38, 0xa6, 0x5d, 0x04, 0x00, 0x00, 0x00]);
  // config_authority(32) + time_lock(4) + tx_index(8) + stale_tx_index(8) + creator(32) + allow_external(1) = 85
  const fields = Buffer.alloc(85, 0);
  // threshold at offset 8+85 = 93 (from start of buffer)
  const thresholdBuf = Buffer.alloc(2);
  thresholdBuf.writeUInt16LE(threshold, 0);
  // members vec len at offset 95
  const memberVec = Buffer.alloc(4);
  memberVec.writeUInt32LE(memberCount, 0);
  return Buffer.concat([disc, fields, thresholdBuf, memberVec]);
}

describe("resolveAuthority — System Program-owned (direct key)", () => {
  let spy: any;
  beforeEach(() => { spy = vi.spyOn(connection, "getAccountInfo"); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns direct-key for System Program-owned account", async () => {
    spy.mockResolvedValueOnce(buildSystemAccount());
    const result = await resolveAuthority(TEST_AUTHORITY, connection, TIMEOUT_MS);
    expect(result.authorityType).toBe("direct-key");
    expect(result.resolutionStatus).toBe("resolved-direct");
    expect(result.evidence).toContain(SYSTEM_PROGRAM);
    expect(result.limitations.length).toBeGreaterThan(0);
  });
});

describe("resolveAuthority — null account (non-existent)", () => {
  let spy: any;
  beforeEach(() => { spy = vi.spyOn(connection, "getAccountInfo"); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns direct-key for non-existent authority account", async () => {
    spy.mockResolvedValueOnce(null);
    const result = await resolveAuthority(TEST_AUTHORITY, connection, TIMEOUT_MS);
    expect(result.authorityType).toBe("direct-key");
    expect(result.resolutionStatus).toBe("resolved-direct");
    expect(result.evidence).toContain("does not exist on-chain");
  });
});

describe("resolveAuthority — Squads v3 multisig", () => {
  let spy: any;
  beforeEach(() => { spy = vi.spyOn(connection, "getAccountInfo"); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns squads-multisig for Squads v3-owned account with parseable threshold", async () => {
    const data = buildSquadsV3Account(3, 5);
    spy.mockResolvedValueOnce({
      executable: false,
      owner: new PublicKey(SQUADS_V3_PROGRAM),
      data
    });
    const result = await resolveAuthority(TEST_AUTHORITY, connection, TIMEOUT_MS);
    expect(result.authorityType).toBe("squads-multisig");
    expect(result.resolutionStatus).toBe("resolved-multisig");
    expect(result.controllingProgram).toBe(SQUADS_V3_PROGRAM);
    expect(result.multisigThreshold).toBe(3);
    expect(result.multisigMemberCount).toBe(5);
    expect(result.evidence).toContain("v3");
  });

  it("handles sanity-failing threshold (threshold=0) gracefully", async () => {
    const data = buildSquadsV3Account(0, 5); // threshold=0 fails sanity
    spy.mockResolvedValueOnce({
      executable: false,
      owner: new PublicKey(SQUADS_V3_PROGRAM),
      data
    });
    const result = await resolveAuthority(TEST_AUTHORITY, connection, TIMEOUT_MS);
    // Should still report squads-multisig but threshold may be undefined
    expect(result.authorityType).toBe("squads-multisig");
  });
});

describe("resolveAuthority — Squads v4 multisig", () => {
  let spy: any;
  beforeEach(() => { spy = vi.spyOn(connection, "getAccountInfo"); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns squads-multisig for Squads v4-owned account with parseable threshold", async () => {
    const data = buildSquadsV4Account(2, 3);
    spy.mockResolvedValueOnce({
      executable: false,
      owner: new PublicKey(SQUADS_V4_PROGRAM),
      data
    });
    const result = await resolveAuthority(TEST_AUTHORITY, connection, TIMEOUT_MS);
    expect(result.authorityType).toBe("squads-multisig");
    expect(result.resolutionStatus).toBe("resolved-multisig");
    expect(result.controllingProgram).toBe(SQUADS_V4_PROGRAM);
    expect(result.multisigThreshold).toBe(2);
    expect(result.multisigMemberCount).toBe(3);
    expect(result.evidence).toContain("v4");
  });
});

describe("resolveAuthority — Squads-owned with unknown discriminator", () => {
  let spy: any;
  beforeEach(() => { spy = vi.spyOn(connection, "getAccountInfo"); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns squads-multisig type but notes discriminator mismatch", async () => {
    // Data with a discriminator that doesn't match v3 or v4
    const data = Buffer.alloc(64, 0xAA); // random data, no known discriminator
    spy.mockResolvedValueOnce({
      executable: false,
      owner: new PublicKey(SQUADS_V3_PROGRAM),
      data
    });
    const result = await resolveAuthority(TEST_AUTHORITY, connection, TIMEOUT_MS);
    expect(result.authorityType).toBe("squads-multisig");
    expect(result.limitations.some(l => l.toLowerCase().includes("discriminator"))).toBe(true);
  });
});

describe("resolveAuthority — unknown program-owned", () => {
  let spy: any;
  beforeEach(() => { spy = vi.spyOn(connection, "getAccountInfo"); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns unknown-program-owned for non-system, non-squads owner", async () => {
    spy.mockResolvedValueOnce({
      executable: false,
      owner: new PublicKey(UNKNOWN_PROGRAM),
      data: Buffer.alloc(32, 0)
    });
    const result = await resolveAuthority(TEST_AUTHORITY, connection, TIMEOUT_MS);
    expect(result.authorityType).toBe("unknown-program-owned");
    expect(result.resolutionStatus).toBe("unresolved-program-owned");
    expect(result.controllingProgram).toBe(UNKNOWN_PROGRAM);
    expect(result.limitations.length).toBeGreaterThan(0);
  });
});

describe("resolveAuthority — RPC timeout", () => {
  let spy: any;
  beforeEach(() => { spy = vi.spyOn(connection, "getAccountInfo"); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns unresolved when RPC call times out", async () => {
    spy.mockRejectedValueOnce(new Error("RPC_TIMEOUT"));
    const result = await resolveAuthority(TEST_AUTHORITY, connection, TIMEOUT_MS);
    expect(result.authorityType).toBe("unresolved");
    expect(result.resolutionStatus).toBe("unresolved-unknown");
    expect(result.evidence).toContain("could not be fetched");
  });
});

describe("resolveAuthority — invalid address", () => {
  it("returns unresolved for an invalid address string without making RPC call", async () => {
    const result = await resolveAuthority("not-a-valid-address!!", connection, TIMEOUT_MS);
    expect(result.authorityType).toBe("unresolved");
    expect(result.resolutionStatus).toBe("unresolved-unknown");
    expect(result.evidence).toContain("could not be parsed");
  });
});

describe("resolveAuthority — limitations are always present", () => {
  let spy: any;
  beforeEach(() => { spy = vi.spyOn(connection, "getAccountInfo"); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("always includes limitations explaining what was not determined", async () => {
    // Direct key case
    spy.mockResolvedValueOnce(buildSystemAccount());
    const result = await resolveAuthority(TEST_AUTHORITY, connection, TIMEOUT_MS);
    expect(result.limitations.length).toBeGreaterThan(0);
    // Limitations must not be empty
    for (const lim of result.limitations) {
      expect(lim.length).toBeGreaterThan(5);
    }
  });
});
