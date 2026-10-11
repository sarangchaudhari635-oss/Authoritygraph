/**
 * Token-2022 Extension TLV Parser Tests
 *
 * Tests use handcrafted binary buffers that match the documented on-chain layouts.
 * All fixtures are clearly labeled as synthetic.
 *
 * Layout reference: spl-token-2022 extension/mod.rs
 *   Base mint: 82 bytes
 *   Account type byte: 1 byte (offset 82; value 2 for Mint)
 *   Extensions: TLV list starting at offset 83
 *     [u16 LE type][u16 LE length][<length> bytes data]
 */

import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  parseToken2022Extensions,
  extensionsToFindings,
  EXTENSION_TYPES
} from "./token2022.js";

// ── Fixture helpers ──────────────────────────────────────────────────────────

/** Build a minimal Token-2022 mint buffer with extensions appended */
function buildToken2022Buffer(extensions: Buffer[]): Buffer {
  const baseMint = Buffer.alloc(82, 0);
  // Set isInitialized byte at offset 45
  baseMint[45] = 1;
  const accountTypeByte = Buffer.from([2]); // Mint account type
  return Buffer.concat([baseMint, accountTypeByte, ...extensions]);
}

/** Build a TLV entry */
function buildTlv(typeCode: number, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(typeCode, 0);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
}

/** Build a PermanentDelegate TLV with a real or null delegate */
function buildPermanentDelegate(delegate: PublicKey | null): Buffer {
  const data = Buffer.alloc(32, 0);
  if (delegate) {
    delegate.toBytes().forEach((b, i) => { data[i] = b; });
  }
  return buildTlv(12, data);
}

/** Build a DefaultAccountState TLV */
function buildDefaultAccountState(state: 0 | 1 | 2): Buffer {
  const data = Buffer.from([state]);
  return buildTlv(6, data);
}

/** Build a MintCloseAuthority TLV */
function buildMintCloseAuthority(auth: PublicKey | null): Buffer {
  const data = Buffer.alloc(32, 0);
  if (auth) {
    auth.toBytes().forEach((b, i) => { data[i] = b; });
  }
  return buildTlv(3, data);
}

/** Build a NonTransferable TLV (no data) */
function buildNonTransferable(): Buffer {
  return buildTlv(9, Buffer.alloc(0));
}

/** Build a TransferHook TLV */
function buildTransferHook(authority: PublicKey | null, program: PublicKey | null): Buffer {
  const data = Buffer.alloc(64, 0);
  if (authority) {
    authority.toBytes().forEach((b, i) => { data[i] = b; });
  }
  if (program) {
    program.toBytes().forEach((b, i) => { data[32 + i] = b; });
  }
  return buildTlv(14, data);
}

const AUTHORITY_PUBKEY = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXh");
const PROGRAM_PUBKEY   = new PublicKey("BTokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXh");
const MINT_ADDRESS     = "11111111111111111111111111111111";

// ── Test suites ──────────────────────────────────────────────────────────────

describe("parseToken2022Extensions — base cases", () => {
  it("returns empty extensions for a classic 82-byte mint (no extension data)", () => {
    const buf = Buffer.alloc(82, 0);
    buf[45] = 1;
    const { extensions, warnings } = parseToken2022Extensions(buf);
    expect(extensions).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("returns empty extensions for a Token-2022 mint with no extension payload (only 83 bytes)", () => {
    const buf = buildToken2022Buffer([]);
    const { extensions, warnings } = parseToken2022Extensions(buf);
    expect(extensions).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("warns about incorrect account type byte", () => {
    const baseMint = Buffer.alloc(82, 0);
    const accountTypeByte = Buffer.from([3]); // Account type, not Mint
    const paddedData = Buffer.alloc(4, 0); // ensure at least TLV_HEADER_SIZE bytes
    const buf = Buffer.concat([baseMint, accountTypeByte, paddedData]);
    const { warnings } = parseToken2022Extensions(buf);
    expect(warnings.some(w => w.includes("account-type byte"))).toBe(true);
  });

  it("returns no extensions for buffer shorter than 84 bytes (below extension start)", () => {
    const buf = Buffer.alloc(83, 0);
    buf[45] = 1;
    buf[82] = 2; // account type = Mint
    const { extensions } = parseToken2022Extensions(buf);
    expect(extensions).toHaveLength(0);
  });
});

describe("parseToken2022Extensions — PermanentDelegate (type 12)", () => {
  it("parses a PermanentDelegate with a real delegate", () => {
    const tlv = buildPermanentDelegate(AUTHORITY_PUBKEY);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    expect(extensions).toHaveLength(1);
    const ext = extensions[0];
    expect(ext.typeCode).toBe(12);
    expect(ext.name).toBe("PermanentDelegate");
    expect(ext.parseStatus).toBe("parsed");
    expect(ext.authority).toBe(AUTHORITY_PUBKEY.toBase58());
    expect(ext.findingId).toBe("TOKEN_2022_PERMANENT_DELEGATE");
  });

  it("parses a PermanentDelegate with null delegate (all-zero bytes)", () => {
    const tlv = buildPermanentDelegate(null);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const ext = extensions[0];
    expect(ext.authority).toBeNull();
    expect(ext.findingId).toBeUndefined();
  });

  it("marks PermanentDelegate as unsupported when data is truncated to < 32 bytes", () => {
    // Build a TLV with only 16 bytes of data (too short for a pubkey)
    const shortData = Buffer.alloc(16, 0);
    const tlv = buildTlv(12, shortData);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    expect(extensions[0].parseStatus).toBe("unsupported");
  });
});

describe("parseToken2022Extensions — DefaultAccountState (type 6)", () => {
  it("parses DefaultAccountState=Frozen (state code 2)", () => {
    const tlv = buildDefaultAccountState(2);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const ext = extensions[0];
    expect(ext.typeCode).toBe(6);
    expect(ext.parseStatus).toBe("parsed");
    expect(ext.fields?.stateCode).toBe(2);
    expect(ext.fields?.defaultState).toBe("Frozen");
    expect(ext.findingId).toBe("TOKEN_2022_DEFAULT_FROZEN");
  });

  it("parses DefaultAccountState=Initialized (state code 1, no finding)", () => {
    const tlv = buildDefaultAccountState(1);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const ext = extensions[0];
    expect(ext.fields?.stateCode).toBe(1);
    expect(ext.findingId).toBeUndefined();
  });

  it("parses DefaultAccountState=Uninitialized (state code 0)", () => {
    const tlv = buildDefaultAccountState(0);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    expect(extensions[0].fields?.stateCode).toBe(0);
  });
});

describe("parseToken2022Extensions — MintCloseAuthority (type 3)", () => {
  it("parses MintCloseAuthority with a real authority", () => {
    const tlv = buildMintCloseAuthority(AUTHORITY_PUBKEY);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const ext = extensions[0];
    expect(ext.typeCode).toBe(3);
    expect(ext.parseStatus).toBe("parsed");
    expect(ext.authority).toBe(AUTHORITY_PUBKEY.toBase58());
    expect(ext.findingId).toBe("TOKEN_2022_MINT_CLOSE_AUTHORITY");
  });

  it("parses MintCloseAuthority with null authority", () => {
    const tlv = buildMintCloseAuthority(null);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    expect(extensions[0].authority).toBeNull();
  });
});

describe("parseToken2022Extensions — NonTransferable (type 9)", () => {
  it("detects NonTransferable extension", () => {
    const tlv = buildNonTransferable();
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const ext = extensions[0];
    expect(ext.typeCode).toBe(9);
    expect(ext.name).toBe("NonTransferable");
    expect(ext.parseStatus).toBe("parsed");
    expect(ext.fields?.nonTransferable).toBe(true);
    expect(ext.findingId).toBe("TOKEN_2022_NON_TRANSFERABLE");
  });
});

describe("parseToken2022Extensions — TransferHook (type 14)", () => {
  it("parses TransferHook with authority and program", () => {
    const tlv = buildTransferHook(AUTHORITY_PUBKEY, PROGRAM_PUBKEY);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const ext = extensions[0];
    expect(ext.typeCode).toBe(14);
    expect(ext.parseStatus).toBe("parsed");
    expect(ext.authority).toBe(AUTHORITY_PUBKEY.toBase58());
    expect(ext.fields?.programId).toBe(PROGRAM_PUBKEY.toBase58());
    expect(ext.findingId).toBe("TOKEN_2022_TRANSFER_HOOK");
  });

  it("marks TransferHook unsupported when data is too short", () => {
    const shortData = Buffer.alloc(10, 0);
    const tlv = buildTlv(14, shortData);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    expect(extensions[0].parseStatus).toBe("unsupported");
  });
});

describe("parseToken2022Extensions — unknown extension type", () => {
  it("detects an unknown extension type code without crashing", () => {
    // Use type code 255 (unknown)
    const tlv = buildTlv(255, Buffer.alloc(8, 0xAA));
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].typeCode).toBe(255);
    expect(extensions[0].parseStatus).toBe("unsupported");
    expect(extensions[0].name).toContain("Unknown");
  });

  it("detects a known but unimplemented extension (e.g., CpiGuard type 11)", () => {
    const tlv = buildTlv(11, Buffer.alloc(1, 0));
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    expect(extensions[0].parseStatus).toBe("detected");
    expect(extensions[0].name).toBe("CpiGuard");
  });
});

describe("parseToken2022Extensions — multiple extensions", () => {
  it("parses multiple extensions in sequence", () => {
    const tlv1 = buildPermanentDelegate(AUTHORITY_PUBKEY);
    const tlv2 = buildDefaultAccountState(2);
    const tlv3 = buildNonTransferable();
    const buf = buildToken2022Buffer([tlv1, tlv2, tlv3]);
    const { extensions } = parseToken2022Extensions(buf);
    expect(extensions).toHaveLength(3);
    expect(extensions[0].typeCode).toBe(12); // PermanentDelegate
    expect(extensions[1].typeCode).toBe(6);  // DefaultAccountState
    expect(extensions[2].typeCode).toBe(9);  // NonTransferable
  });
});

describe("parseToken2022Extensions — truncated TLV header", () => {
  it("stops gracefully when TLV header is truncated (< 4 bytes remaining)", () => {
    const baseMint = Buffer.alloc(82, 0);
    baseMint[45] = 1;
    const accountTypeByte = Buffer.from([2]);
    // Only 2 bytes after account type byte — not enough for TLV header
    const truncated = Buffer.alloc(2, 0);
    const buf = Buffer.concat([baseMint, accountTypeByte, truncated]);
    const { extensions } = parseToken2022Extensions(buf);
    // Should return empty without throwing
    expect(extensions).toHaveLength(0);
  });

  it("reports detected (not parsed) when TLV data is truncated", () => {
    // TLV says data length is 32, but only 10 bytes follow
    const header = Buffer.alloc(4);
    header.writeUInt16LE(12, 0); // PermanentDelegate
    header.writeUInt16LE(32, 2); // claims 32 bytes
    const shortData = Buffer.alloc(10, 0); // only 10 bytes actual
    const baseMint = Buffer.alloc(82, 0);
    baseMint[45] = 1;
    const accountTypeByte = Buffer.from([2]);
    const buf = Buffer.concat([baseMint, accountTypeByte, header, shortData]);
    const { extensions } = parseToken2022Extensions(buf);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].parseStatus).toBe("detected");
  });
});

describe("EXTENSION_TYPES map completeness", () => {
  it("includes all standard extension type codes 0-23", () => {
    for (let i = 0; i <= 23; i++) {
      expect(EXTENSION_TYPES[i]).toBeDefined();
    }
  });
});

describe("extensionsToFindings — finding generation", () => {
  it("generates PERMANENT_DELEGATE finding for active delegate", () => {
    const tlv = buildPermanentDelegate(AUTHORITY_PUBKEY);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const findings = extensionsToFindings(extensions, MINT_ADDRESS);
    expect(findings.some(f => f.id === "TOKEN_2022_PERMANENT_DELEGATE")).toBe(true);
    const f = findings.find(f => f.id === "TOKEN_2022_PERMANENT_DELEGATE")!;
    expect(f.severity).toBe("high");
    expect(f.status).toBe("present");
    expect(f.evidence[0].observedValue).toBe(AUTHORITY_PUBKEY.toBase58());
  });

  it("generates PERMANENT_DELEGATE_NULL finding when delegate is all-zero", () => {
    const tlv = buildPermanentDelegate(null);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const findings = extensionsToFindings(extensions, MINT_ADDRESS);
    expect(findings.some(f => f.id === "TOKEN_2022_PERMANENT_DELEGATE_NULL")).toBe(true);
    expect(findings.find(f => f.id === "TOKEN_2022_PERMANENT_DELEGATE_NULL")!.severity).toBe("info");
  });

  it("generates DEFAULT_FROZEN finding when state is Frozen", () => {
    const tlv = buildDefaultAccountState(2);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const findings = extensionsToFindings(extensions, MINT_ADDRESS);
    expect(findings.some(f => f.id === "TOKEN_2022_DEFAULT_FROZEN")).toBe(true);
    expect(findings.find(f => f.id === "TOKEN_2022_DEFAULT_FROZEN")!.severity).toBe("medium");
  });

  it("does not generate DEFAULT_FROZEN finding when state is Initialized", () => {
    const tlv = buildDefaultAccountState(1);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const findings = extensionsToFindings(extensions, MINT_ADDRESS);
    expect(findings.some(f => f.id === "TOKEN_2022_DEFAULT_FROZEN")).toBe(false);
  });

  it("generates MINT_CLOSE_AUTHORITY finding when close authority is set", () => {
    const tlv = buildMintCloseAuthority(AUTHORITY_PUBKEY);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const findings = extensionsToFindings(extensions, MINT_ADDRESS);
    expect(findings.some(f => f.id === "TOKEN_2022_MINT_CLOSE_AUTHORITY")).toBe(true);
    expect(findings.find(f => f.id === "TOKEN_2022_MINT_CLOSE_AUTHORITY")!.severity).toBe("medium");
  });

  it("generates NON_TRANSFERABLE finding", () => {
    const tlv = buildNonTransferable();
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const findings = extensionsToFindings(extensions, MINT_ADDRESS);
    expect(findings.some(f => f.id === "TOKEN_2022_NON_TRANSFERABLE")).toBe(true);
  });

  it("generates TRANSFER_HOOK finding when hook program is set", () => {
    const tlv = buildTransferHook(AUTHORITY_PUBKEY, PROGRAM_PUBKEY);
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const findings = extensionsToFindings(extensions, MINT_ADDRESS);
    expect(findings.some(f => f.id === "TOKEN_2022_TRANSFER_HOOK")).toBe(true);
    expect(findings.find(f => f.id === "TOKEN_2022_TRANSFER_HOOK")!.severity).toBe("high");
    expect(findings.find(f => f.id === "TOKEN_2022_TRANSFER_HOOK")!.evidence[0].observedValue)
      .toBe(PROGRAM_PUBKEY.toBase58());
  });

  it("does not generate finding for unknown extension type", () => {
    const tlv = buildTlv(255, Buffer.alloc(8, 0));
    const buf = buildToken2022Buffer([tlv]);
    const { extensions } = parseToken2022Extensions(buf);
    const findings = extensionsToFindings(extensions, MINT_ADDRESS);
    // No finding, but extension is still reported in the extensions array
    expect(findings).toHaveLength(0);
    expect(extensions).toHaveLength(1);
  });

  it("all generated findings have required fields (id, title, severity, status, evidence, recommendation)", () => {
    const tlvs = [
      buildPermanentDelegate(AUTHORITY_PUBKEY),
      buildDefaultAccountState(2),
      buildMintCloseAuthority(AUTHORITY_PUBKEY),
      buildNonTransferable(),
      buildTransferHook(AUTHORITY_PUBKEY, PROGRAM_PUBKEY),
    ];
    const buf = buildToken2022Buffer(tlvs);
    const { extensions } = parseToken2022Extensions(buf);
    const findings = extensionsToFindings(extensions, MINT_ADDRESS);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.id).toBeTruthy();
      expect(f.title).toBeTruthy();
      expect(["critical","high","medium","low","info","unknown"]).toContain(f.severity);
      expect(["present","absent","unknown"]).toContain(f.status);
      expect(Array.isArray(f.evidence)).toBe(true);
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.recommendation).toBeTruthy();
    }
  });
});
