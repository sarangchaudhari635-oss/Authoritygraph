import { describe, it, expect } from "vitest";
import {
  evaluatePolicy,
  DEFAULT_BASELINE_POLICY,
  STRICT_IMMUTABILITY_POLICY
} from "./policy-engine.js";
import type { AnalysisResponse, SecurityPolicy } from "./types.js";

describe("Security Policy and Drift Engine", () => {
  it("evaluates immutable program under strict immutability policy as PASS", () => {
    const analysis: AnalysisResponse = {
      address: "Prog111111111111111111111111111111111111111",
      kind: "program",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Immutable program",
      findings: [
        {
          id: "PROGRAM_IMMUTABLE",
          title: "Program is immutable",
          severity: "info",
          status: "absent",
          summary: "No upgrade authority",
          recommendation: "Keep records",
          evidence: [{ source: "Solana RPC", observedValue: "upgradeAuthority=null", detail: "ProgramData=PD1; deploymentSlot=5." }]
        }
      ],
      warnings: []
    };

    const evaluation = evaluatePolicy(analysis, STRICT_IMMUTABILITY_POLICY);
    expect(evaluation.status).toBe("PASS");
    const immRule = evaluation.rules.find(r => r.ruleId === "require-immutable-program");
    expect(immRule?.status).toBe("PASS");
  });

  it("evaluates upgradeable program under strict immutability policy as FAIL", () => {
    const analysis: AnalysisResponse = {
      address: "Prog111111111111111111111111111111111111111",
      kind: "program",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Upgradeable program",
      findings: [
        {
          id: "PROGRAM_UPGRADE_AUTHORITY_ACTIVE",
          title: "Upgrade authority active",
          severity: "high",
          status: "present",
          summary: "Has upgrade authority",
          recommendation: "Verify custody",
          evidence: [{ source: "Solana RPC", observedValue: "UpgradeAuth1111111111111111111111111111111", detail: "Active" }]
        }
      ],
      warnings: []
    };

    const evaluation = evaluatePolicy(analysis, STRICT_IMMUTABILITY_POLICY);
    expect(evaluation.status).toBe("FAIL");
    const immRule = evaluation.rules.find(r => r.ruleId === "require-immutable-program");
    expect(immRule?.status).toBe("FAIL");
  });

  it("evaluates whitelisted upgrade authorities correctly", () => {
    const approvedAuth = "ApprovedAuth11111111111111111111111111111";
    const customPolicy: SecurityPolicy = {
      id: "whitelist-policy",
      name: "Whitelisted Upgrade Authority",
      description: "Only approved multisig can upgrade",
      rules: {
        approvedUpgradeAuthorities: [approvedAuth]
      }
    };

    const passAnalysis: AnalysisResponse = {
      address: "Prog111111111111111111111111111111111111111",
      kind: "program",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Program with approved auth",
      findings: [
        {
          id: "PROGRAM_UPGRADE_AUTHORITY_ACTIVE",
          title: "Upgrade authority active",
          severity: "high",
          status: "present",
          summary: "Upgrade auth",
          recommendation: "",
          evidence: [{ source: "Solana RPC", observedValue: approvedAuth, detail: "Detail" }]
        }
      ],
      warnings: []
    };

    const passEval = evaluatePolicy(passAnalysis, customPolicy);
    expect(passEval.status).toBe("PASS");

    const failAnalysis: AnalysisResponse = {
      ...passAnalysis,
      findings: [
        {
          id: "PROGRAM_UPGRADE_AUTHORITY_ACTIVE",
          title: "Upgrade authority active",
          severity: "high",
          status: "present",
          summary: "Upgrade auth",
          recommendation: "",
          evidence: [{ source: "Solana RPC", observedValue: "RogueAuth11111111111111111111111111111111", detail: "Detail" }]
        }
      ]
    };

    const failEval = evaluatePolicy(failAnalysis, customPolicy);
    expect(failEval.status).toBe("FAIL");
  });

  it("evaluates Token-2022 PermanentDelegate presence as FAIL under baseline policy", () => {
    const analysis: AnalysisResponse = {
      address: "TokenMint11111111111111111111111111111111",
      kind: "mint",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Token with PermanentDelegate",
      findings: [
        {
          id: "TOKEN_FREEZE_AUTHORITY_REVOKED",
          title: "Freeze authority revoked",
          severity: "info",
          status: "absent",
          summary: "",
          recommendation: "",
          evidence: [{ source: "Solana RPC", observedValue: "null", detail: "Revoked" }]
        }
      ],
      extensions: [
        {
          typeCode: 13,
          name: "PermanentDelegate",
          parseStatus: "parsed",
          authority: "Delegate111111111111111111111111111111111",
          fields: { delegate: "Delegate111111111111111111111111111111111" }
        }
      ],
      warnings: []
    };

    const evaluation = evaluatePolicy(analysis, DEFAULT_BASELINE_POLICY);
    expect(evaluation.status).toBe("FAIL");
    const permRule = evaluation.rules.find(r => r.ruleId === "disallow-permanent-delegate");
    expect(permRule?.status).toBe("FAIL");
  });

  it("evaluates Squads multisig threshold compliance", () => {
    const multisigPolicy: SecurityPolicy = {
      id: "multisig-policy",
      name: "Multisig Threshold Policy",
      description: "Requires minimum threshold 3",
      rules: {
        minMultisigThreshold: 3
      }
    };

    const analysisLowThreshold: AnalysisResponse = {
      address: "Prog111111111111111111111111111111111111111",
      kind: "program",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Program with Squads multisig",
      findings: [
        {
          id: "PROGRAM_UPGRADE_AUTHORITY_ACTIVE",
          title: "Upgrade authority is a Squads multisig",
          severity: "high",
          status: "present",
          summary: "",
          recommendation: "",
          authorityType: "squads-multisig",
          evidence: [{ source: "Solana RPC", observedValue: "Squads11111111111111111111111111111111111", detail: "Squads threshold=1; members=3." }]
        }
      ],
      warnings: []
    };

    const evalLow = evaluatePolicy(analysisLowThreshold, multisigPolicy);
    expect(evalLow.status).toBe("FAIL");

    const analysisCompliant: AnalysisResponse = {
      ...analysisLowThreshold,
      findings: [
        {
          id: "PROGRAM_UPGRADE_AUTHORITY_ACTIVE",
          title: "Upgrade authority is a Squads multisig",
          severity: "high",
          status: "present",
          summary: "",
          recommendation: "",
          authorityType: "squads-multisig",
          evidence: [{ source: "Solana RPC", observedValue: "Squads11111111111111111111111111111111111", detail: "Squads threshold=3; members=5." }]
        }
      ]
    };

    const evalCompliant = evaluatePolicy(analysisCompliant, multisigPolicy);
    expect(evalCompliant.status).toBe("PASS");
  });

  it("returns UNKNOWN when unsupported program loader prevents verification", () => {
    const analysis: AnalysisResponse = {
      address: "Prog111111111111111111111111111111111111111",
      kind: "program",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "unsupported",
      summary: "Unsupported loader",
      findings: [
        {
          id: "PROGRAM_LOADER_UNSUPPORTED",
          title: "Loader unsupported",
          severity: "unknown",
          status: "unknown",
          summary: "Unknown loader",
          recommendation: "",
          evidence: [{ source: "Solana RPC", observedValue: "CustomLoader1111111111111111111111111111", detail: "Custom loader" }]
        }
      ],
      warnings: []
    };

    const evaluation = evaluatePolicy(analysis, STRICT_IMMUTABILITY_POLICY);
    expect(evaluation.status).toBe("UNKNOWN");
    const immRule = evaluation.rules.find(r => r.ruleId === "require-immutable-program");
    expect(immRule?.status).toBe("UNKNOWN");
  });
});
