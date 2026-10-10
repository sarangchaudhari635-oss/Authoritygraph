import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { connection, analyzeAddress, analyzeProgram, analyzeMint, MintLayout } from "./solana.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

describe("Analyzer Integration with Mocked RPC", () => {
  let mockGetAccountInfo: any;

  beforeEach(() => {
    mockGetAccountInfo = vi.spyOn(connection, "getAccountInfo");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("analyzeProgram - returns unsupported for non-existent account", async () => {
    mockGetAccountInfo.mockResolvedValueOnce(null);
    const res = await analyzeProgram("11111111111111111111111111111111");
    expect(res.result).toBe("unsupported");
    expect(res.summary).toContain("No account was found");
  });

  it("analyzeProgram - handles active upgrade authority", async () => {
    // Setup program account
    const progData = Buffer.alloc(36);
    progData.writeUInt32LE(2, 0); // Program tag
    const programDataKey = new PublicKey("22222222222222222222222222222222222222222222");
    programDataKey.toBytes().forEach((b, i) => { progData[4 + i] = b; });
    
    // Setup programData account
    const pdData = Buffer.alloc(45);
    pdData.writeUInt32LE(3, 0); // ProgramData tag
    pdData.writeBigUInt64LE(123n, 4); // slot
    pdData[12] = 1; // Some
    const authKey = new PublicKey("33333333333333333333333333333333333333333333");
    authKey.toBytes().forEach((b, i) => { pdData[13 + i] = b; });

    mockGetAccountInfo
      .mockResolvedValueOnce({
        executable: true,
        owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        data: progData
      })
      .mockResolvedValueOnce({
        executable: false,
        owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
        data: pdData
      });

    const res = await analyzeProgram("11111111111111111111111111111111");
    expect(res.result).toBe("findings");
    expect(res.findings.some(f => f.id === "PROGRAM_UPGRADE_AUTHORITY_ACTIVE")).toBe(true);
  });

  it("analyzeMint - handles valid mint", async () => {
    const mintData = Buffer.alloc(MintLayout.span);
    mintData[45] = 1; // initialized
    
    mockGetAccountInfo.mockResolvedValueOnce({
      executable: false,
      owner: TOKEN_PROGRAM_ID,
      data: mintData
    });

    const res = await analyzeMint("11111111111111111111111111111111");
    expect(res.result).toBe("findings");
    expect(res.findings.length).toBeGreaterThan(0);
  });

  it("analyzeMint - rejects token account (165 bytes) falsely submitted as mint", async () => {
    const tokenData = Buffer.alloc(165);
    mockGetAccountInfo.mockResolvedValueOnce({
      executable: false,
      owner: TOKEN_PROGRAM_ID,
      data: tokenData
    });

    const res = await analyzeMint("11111111111111111111111111111111");
    expect(res.result).toBe("unsupported");
    expect(res.summary).toContain("token account");
  });

  it("analyzeAddress auto-detects program", async () => {
    const progData = Buffer.alloc(36);
    progData.writeUInt32LE(2, 0); // Program tag
    
    mockGetAccountInfo.mockResolvedValue({
      executable: true,
      owner: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      data: progData
    });

    const res = await analyzeAddress("11111111111111111111111111111111", "auto");
    expect(res.kind).toBe("program");
    // Fails closed because program data isn't complete in this mock, but we verified the path
    expect(res.result).toBe("unsupported"); 
  });
});
