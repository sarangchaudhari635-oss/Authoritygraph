/**
 * Historical Snapshot Store & Configuration Change Detection
 *
 * Implements persistent observation snapshots and deterministic
 * configuration drift detection for Solana accounts.
 *
 * Distinguishes genuine on-chain authority changes from temporary RPC errors,
 * unparsed data, or unsupported formats.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  AnalysisResponse,
  Snapshot,
  SnapshotComparison,
  ChangeEvent,
  ChangeEventType,
  Severity
} from "./types.js";

// Default storage directory inside the api workspace
const DEFAULT_STORAGE_DIR = path.resolve(process.cwd(), "data", "snapshots");

export class SnapshotStore {
  private storageDir: string;

  constructor(customStorageDir?: string) {
    this.storageDir = customStorageDir || DEFAULT_STORAGE_DIR;
    this.ensureDir();
  }

  private ensureDir(): void {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch {
      // Best-effort directory creation
    }
  }

  private getFilePath(address: string): string {
    // Sanitize address to prevent path traversal
    const safeAddress = address.replace(/[^a-zA-Z0-9]/g, "");
    return path.join(this.storageDir, `${safeAddress}.json`);
  }

  /**
   * Compute deterministic hash of parsed authority state
   */
  public computeStateHash(analysis: AnalysisResponse): string {
    const hash = crypto.createHash("sha256");
    const dataToHash = {
      address: analysis.address,
      kind: analysis.kind,
      cluster: analysis.cluster,
      result: analysis.result,
      findings: analysis.findings.map(f => ({
        id: f.id,
        status: f.status,
        authority: f.evidence[0]?.observedValue ?? null
      })),
      extensions: analysis.extensions?.map(e => ({
        typeCode: e.typeCode,
        authority: e.authority,
        fields: e.fields
      }))
    };
    hash.update(JSON.stringify(dataToHash));
    return hash.digest("hex");
  }

  /**
   * Extract normalized authority map from analysis
   */
  public extractAuthorities(analysis: AnalysisResponse): Snapshot["authorities"] {
    const authorities: Snapshot["authorities"] = {};

    for (const finding of analysis.findings) {
      if (finding.id === "PROGRAM_UPGRADE_AUTHORITY_ACTIVE") {
        authorities.upgradeAuthority = finding.evidence[0]?.observedValue ?? null;
      } else if (finding.id === "PROGRAM_IMMUTABLE") {
        authorities.upgradeAuthority = null;
      } else if (finding.id === "TOKEN_MINT_AUTHORITY_ACTIVE") {
        authorities.mintAuthority = finding.evidence[0]?.observedValue ?? null;
      } else if (finding.id === "TOKEN_MINT_AUTHORITY_REVOKED") {
        authorities.mintAuthority = null;
      } else if (finding.id === "TOKEN_FREEZE_AUTHORITY_ACTIVE") {
        authorities.freezeAuthority = finding.evidence[0]?.observedValue ?? null;
      } else if (finding.id === "TOKEN_FREEZE_AUTHORITY_REVOKED") {
        authorities.freezeAuthority = null;
      }
    }

    if (analysis.extensions && analysis.extensions.length > 0) {
      authorities.extensions = {};
      for (const ext of analysis.extensions) {
        authorities.extensions[ext.name] = ext.authority ?? null;
      }
    }

    return authorities;
  }

  /**
   * Save a snapshot for an address.
   * If the state is unchanged from the last snapshot, updates the observation
   * timestamp of the latest snapshot or avoids unnecessary duplication.
   */
  public saveSnapshot(analysis: AnalysisResponse): { snapshot: Snapshot; isNew: boolean } {
    this.ensureDir();
    const filePath = this.getFilePath(analysis.address);
    const existing = this.getSnapshots(analysis.address);
    const accountDataHash = this.computeStateHash(analysis);

    const authorities = this.extractAuthorities(analysis);
    const squadsFinding = analysis.findings.find(f => f.authorityType === "squads-multisig");
    let multisig: Snapshot["multisig"] | undefined;

    if (squadsFinding) {
      const thresholdMatch = squadsFinding.evidence[0]?.detail.match(/threshold=(\d+)/i);
      const membersMatch = squadsFinding.evidence[0]?.detail.match(/members=(\d+)/i);
      multisig = {
        threshold: thresholdMatch ? parseInt(thresholdMatch[1], 10) : undefined,
        memberCount: membersMatch ? parseInt(membersMatch[1], 10) : undefined
      };
    }

    const latest = existing[existing.length - 1];
    if (latest && latest.accountDataHash === accountDataHash) {
      // Deduplication: state is unchanged. Return existing snapshot with isNew=false
      return { snapshot: latest, isNew: false };
    }

    const snapshotId = `snap_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const newSnapshot: Snapshot = {
      id: snapshotId,
      address: analysis.address,
      cluster: analysis.cluster,
      observedAt: analysis.observedAt || new Date().toISOString(),
      accountDataHash,
      kind: analysis.kind,
      summary: analysis.summary,
      authorities,
      multisig,
      findingsCount: analysis.findings.length,
      analysis
    };

    existing.push(newSnapshot);

    // Keep at most 50 snapshots per address to bound storage
    const trimmed = existing.slice(-50);
    try {
      fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2), "utf8");
    } catch (err) {
      console.warn(`[SnapshotStore] Failed to write snapshot for ${analysis.address}:`, err);
    }

    return { snapshot: newSnapshot, isNew: true };
  }

  /**
   * Retrieve all snapshots for an address, chronological order.
   */
  public getSnapshots(address: string): Snapshot[] {
    const filePath = this.getFilePath(address);
    if (!fs.existsSync(filePath)) return [];

    try {
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content) as Snapshot[];
    } catch {
      return [];
    }
  }

  /**
   * Compare two snapshots and detect configuration changes
   */
  public compare(prev: Snapshot, curr: Snapshot): SnapshotComparison {
    const changes: ChangeEvent[] = [];
    const timestamp = curr.observedAt;

    // 1. Upgrade Authority comparison
    if (prev.authorities.upgradeAuthority !== curr.authorities.upgradeAuthority) {
      const oldVal = prev.authorities.upgradeAuthority ?? null;
      const newVal = curr.authorities.upgradeAuthority ?? null;

      if (oldVal !== null && newVal === null) {
        changes.push({
          type: "PROGRAM_IMMUTABILITY_CHANGED",
          field: "upgradeAuthority",
          previousValue: oldVal,
          currentValue: null,
          severity: "info",
          description: `Program upgrade authority was removed. Program transitioned from upgradeable (${oldVal}) to immutable.`,
          timestamp
        });
      } else if (oldVal === null && newVal !== null) {
        changes.push({
          type: "AUTHORITY_ADDED",
          field: "upgradeAuthority",
          previousValue: null,
          currentValue: newVal,
          severity: "critical",
          description: `Program upgrade authority was introduced: ${newVal}. Program is now upgradeable.`,
          timestamp
        });
      } else {
        changes.push({
          type: "AUTHORITY_CHANGED",
          field: "upgradeAuthority",
          previousValue: oldVal,
          currentValue: newVal,
          severity: "critical",
          description: `Program upgrade authority changed from ${oldVal} to ${newVal}.`,
          timestamp
        });
      }
    }

    // 2. Mint Authority comparison
    if (prev.authorities.mintAuthority !== curr.authorities.mintAuthority) {
      const oldVal = prev.authorities.mintAuthority ?? null;
      const newVal = curr.authorities.mintAuthority ?? null;

      if (oldVal !== null && newVal === null) {
        changes.push({
          type: "AUTHORITY_REMOVED",
          field: "mintAuthority",
          previousValue: oldVal,
          currentValue: null,
          severity: "info",
          description: `Token mint authority was revoked. Supply is now fixed.`,
          timestamp
        });
      } else if (oldVal === null && newVal !== null) {
        changes.push({
          type: "AUTHORITY_ADDED",
          field: "mintAuthority",
          previousValue: null,
          currentValue: newVal,
          severity: "high",
          description: `Token mint authority was activated: ${newVal}. Additional tokens can now be minted.`,
          timestamp
        });
      } else {
        changes.push({
          type: "AUTHORITY_CHANGED",
          field: "mintAuthority",
          previousValue: oldVal,
          currentValue: newVal,
          severity: "high",
          description: `Token mint authority changed from ${oldVal} to ${newVal}.`,
          timestamp
        });
      }
    }

    // 3. Freeze Authority comparison
    if (prev.authorities.freezeAuthority !== curr.authorities.freezeAuthority) {
      const oldVal = prev.authorities.freezeAuthority ?? null;
      const newVal = curr.authorities.freezeAuthority ?? null;

      if (oldVal !== null && newVal === null) {
        changes.push({
          type: "AUTHORITY_REMOVED",
          field: "freezeAuthority",
          previousValue: oldVal,
          currentValue: null,
          severity: "info",
          description: `Freeze authority was revoked. Token accounts can no longer be frozen by an admin.`,
          timestamp
        });
      } else if (oldVal === null && newVal !== null) {
        changes.push({
          type: "AUTHORITY_ADDED",
          field: "freezeAuthority",
          previousValue: null,
          currentValue: newVal,
          severity: "high",
          description: `Freeze authority was granted to ${newVal}. Token accounts may be frozen.`,
          timestamp
        });
      } else {
        changes.push({
          type: "AUTHORITY_CHANGED",
          field: "freezeAuthority",
          previousValue: oldVal,
          currentValue: newVal,
          severity: "high",
          description: `Freeze authority changed from ${oldVal} to ${newVal}.`,
          timestamp
        });
      }
    }

    // 4. Multisig threshold comparison
    if (prev.multisig?.threshold !== curr.multisig?.threshold) {
      const oldThresh = prev.multisig?.threshold ?? null;
      const newThresh = curr.multisig?.threshold ?? null;
      changes.push({
        type: "MULTISIG_THRESHOLD_CHANGED",
        field: "multisigThreshold",
        previousValue: oldThresh,
        currentValue: newThresh,
        severity: (newThresh !== null && oldThresh !== null && newThresh < oldThresh) ? "high" : "medium",
        description: `Multisig threshold changed from ${oldThresh} to ${newThresh}.`,
        timestamp
      });
    }

    // 5. Multisig member count comparison
    if (prev.multisig?.memberCount !== curr.multisig?.memberCount) {
      const oldMembers = prev.multisig?.memberCount ?? null;
      const newMembers = curr.multisig?.memberCount ?? null;
      changes.push({
        type: "MULTISIG_MEMBERS_CHANGED",
        field: "multisigMembers",
        previousValue: oldMembers,
        currentValue: newMembers,
        severity: "medium",
        description: `Multisig member count changed from ${oldMembers} to ${newMembers}.`,
        timestamp
      });
    }

    // 6. Token-2022 extension changes
    const prevExts = prev.authorities.extensions || {};
    const currExts = curr.authorities.extensions || {};
    const allExtKeys = new Set([...Object.keys(prevExts), ...Object.keys(currExts)]);

    for (const extName of allExtKeys) {
      const prevVal = prevExts[extName] ?? null;
      const currVal = currExts[extName] ?? null;

      if (prevVal !== currVal) {
        changes.push({
          type: "EXTENSION_CHANGED",
          field: `extension:${extName}`,
          previousValue: prevVal,
          currentValue: currVal,
          severity: extName === "PermanentDelegate" ? "critical" : "medium",
          description: `Token-2022 ${extName} authority changed from ${prevVal} to ${currVal}.`,
          timestamp
        });
      }
    }

    return {
      targetAddress: curr.address,
      previousSnapshotId: prev.id,
      currentSnapshotId: curr.id,
      previousObservedAt: prev.observedAt,
      currentObservedAt: curr.observedAt,
      hasChanges: changes.length > 0,
      changes
    };
  }
}

export const defaultSnapshotStore = new SnapshotStore();
