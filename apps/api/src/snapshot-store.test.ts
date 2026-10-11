import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SnapshotStore } from "./snapshot-store.js";
import type { AnalysisResponse, Snapshot } from "./types.js";

describe("Snapshot Store and Configuration Change Detection", () => {
  let tempDir: string;
  let store: SnapshotStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-snapshots-test-"));
    store = new SnapshotStore(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  const baseAnalysis: AnalysisResponse = {
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    kind: "mint",
    cluster: "mainnet-beta",
    observedAt: "2026-10-11T10:00:00.000Z",
    result: "findings",
    summary: "USDC Token Mint",
    findings: [
      {
        id: "TOKEN_MINT_AUTHORITY_ACTIVE",
        title: "Mint authority is active",
        severity: "medium",
        status: "present",
        summary: "Can mint tokens",
        recommendation: "",
        evidence: [{ source: "RPC", observedValue: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", detail: "Mint" }]
      },
      {
        id: "TOKEN_FREEZE_AUTHORITY_ACTIVE",
        title: "Freeze authority is active",
        severity: "medium",
        status: "present",
        summary: "Can freeze accounts",
        recommendation: "",
        evidence: [{ source: "RPC", observedValue: "7C4gPZNV9uqXZTahBamhkvSmCrqmAipj2RnvPNTitCqd", detail: "Freeze" }]
      }
    ],
    warnings: []
  };

  it("saves a snapshot and retrieves it", () => {
    const { snapshot, isNew } = store.saveSnapshot(baseAnalysis);
    expect(isNew).toBe(true);
    expect(snapshot.address).toBe(baseAnalysis.address);
    expect(snapshot.authorities.mintAuthority).toBe("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo");
    expect(snapshot.authorities.freezeAuthority).toBe("7C4gPZNV9uqXZTahBamhkvSmCrqmAipj2RnvPNTitCqd");

    const history = store.getSnapshots(baseAnalysis.address);
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(snapshot.id);
  });

  it("deduplicates identical subsequent snapshots", () => {
    const save1 = store.saveSnapshot(baseAnalysis);
    expect(save1.isNew).toBe(true);

    const save2 = store.saveSnapshot(baseAnalysis);
    expect(save2.isNew).toBe(false);
    expect(save2.snapshot.id).toBe(save1.snapshot.id);

    const history = store.getSnapshots(baseAnalysis.address);
    expect(history.length).toBe(1);
  });

  it("detects freeze authority revocation change between snapshots", () => {
    const prevSnapshot: Snapshot = {
      id: "snap-1",
      address: baseAnalysis.address,
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T10:00:00.000Z",
      accountDataHash: "hash-1",
      kind: "mint",
      summary: "Prior state",
      authorities: {
        mintAuthority: "MintAuth11111111111111111111111111111111",
        freezeAuthority: "FreezeAuth1111111111111111111111111111111"
      },
      findingsCount: 2,
      analysis: baseAnalysis
    };

    const currSnapshot: Snapshot = {
      id: "snap-2",
      address: baseAnalysis.address,
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T11:00:00.000Z",
      accountDataHash: "hash-2",
      kind: "mint",
      summary: "New state",
      authorities: {
        mintAuthority: "MintAuth11111111111111111111111111111111",
        freezeAuthority: null // Revoked!
      },
      findingsCount: 2,
      analysis: baseAnalysis
    };

    const diff = store.compare(prevSnapshot, currSnapshot);
    expect(diff.hasChanges).toBe(true);
    expect(diff.changes.length).toBe(1);

    const change = diff.changes[0];
    expect(change.type).toBe("AUTHORITY_REMOVED");
    expect(change.field).toBe("freezeAuthority");
    expect(change.previousValue).toBe("FreezeAuth1111111111111111111111111111111");
    expect(change.currentValue).toBeNull();
  });

  it("detects program transition from upgradeable to immutable", () => {
    const prevProg: Snapshot = {
      id: "snap-p1",
      address: "Prog111111111111111111111111111111111111111",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T10:00:00.000Z",
      accountDataHash: "hash-p1",
      kind: "program",
      summary: "Upgradeable",
      authorities: {
        upgradeAuthority: "Deployer11111111111111111111111111111111"
      },
      findingsCount: 1,
      analysis: { ...baseAnalysis, kind: "program" }
    };

    const currProg: Snapshot = {
      ...prevProg,
      id: "snap-p2",
      observedAt: "2026-10-11T12:00:00.000Z",
      accountDataHash: "hash-p2",
      authorities: {
        upgradeAuthority: null // Finalized
      }
    };

    const diff = store.compare(prevProg, currProg);
    expect(diff.hasChanges).toBe(true);
    expect(diff.changes.some(c => c.type === "PROGRAM_IMMUTABILITY_CHANGED")).toBe(true);
  });

  it("detects multisig threshold changes", () => {
    const prevMultisig: Snapshot = {
      id: "snap-m1",
      address: "Prog111111111111111111111111111111111111111",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T10:00:00.000Z",
      accountDataHash: "hash-m1",
      kind: "program",
      summary: "3-of-5 multisig",
      authorities: {
        upgradeAuthority: "Squads11111111111111111111111111111111111"
      },
      multisig: {
        threshold: 3,
        memberCount: 5
      },
      findingsCount: 1,
      analysis: { ...baseAnalysis, kind: "program" }
    };

    const currMultisig: Snapshot = {
      ...prevMultisig,
      id: "snap-m2",
      observedAt: "2026-10-11T13:00:00.000Z",
      accountDataHash: "hash-m2",
      multisig: {
        threshold: 1, // Degraded to single-signer!
        memberCount: 5
      }
    };

    const diff = store.compare(prevMultisig, currMultisig);
    expect(diff.hasChanges).toBe(true);
    const threshChange = diff.changes.find(c => c.type === "MULTISIG_THRESHOLD_CHANGED");
    expect(threshChange).toBeDefined();
    expect(threshChange?.previousValue).toBe(3);
    expect(threshChange?.currentValue).toBe(1);
    expect(threshChange?.severity).toBe("high");
  });
});
