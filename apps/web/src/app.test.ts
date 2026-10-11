import { describe, it, expect } from "vitest";
import type { AnalysisResponse, AuthorityControlGraph, PolicyEvaluation } from "./types";

describe("Frontend Data Models & Contracts", () => {
  it("validates that an AnalysisResponse conforms to the frontend type contract", () => {
    const mockReport: AnalysisResponse = {
      address: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
      kind: "program",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Marinade Program Authority Posture",
      findings: [
        {
          id: "PROGRAM_UPGRADE_AUTHORITY_ACTIVE",
          title: "Program upgrade authority is a Squads multisig",
          severity: "high",
          status: "present",
          summary: "Upgrade authority active",
          recommendation: "Verify governance",
          authorityType: "squads-multisig",
          evidence: [
            {
              source: "Solana RPC account data",
              accountAddress: "PD11111111111111111111111111111111111111111",
              observedValue: "Squads111111111111111111111111111111111111",
              detail: "Squads threshold=3; members=5."
            }
          ]
        }
      ],
      warnings: [" पॉइंट-in-time observation"],
      graph: {
        nodes: [
          {
            id: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
            label: "Program: MarBms...7aD",
            role: "target",
            type: "program",
            address: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD"
          },
          {
            id: "auth:upgrade:Squads111111111111111111111111111111111111",
            label: "Upgrade Authority: Squa...1111",
            role: "upgrade-authority",
            type: "squads-multisig",
            address: "Squads111111111111111111111111111111111111"
          }
        ],
        edges: [
          {
            from: "auth:upgrade:Squads111111111111111111111111111111111111",
            to: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
            label: "Upgrades",
            relation: "UPGRADE_AUTHORITY_OF",
            evidence: "Loader ProgramData"
          }
        ]
      },
      policy: {
        policyId: "baseline-solana-security",
        policyName: "Baseline Solana Security",
        status: "PASS",
        summary: "All requirements passed",
        evaluatedAt: "2026-10-11T12:00:00Z",
        rules: [
          {
            ruleId: "min-multisig-threshold",
            name: "Multisig Threshold >= 2",
            status: "PASS",
            reason: "Threshold 3 >= 2"
          }
        ]
      }
    };

    expect(mockReport.address).toBe("MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD");
    expect(mockReport.findings[0].authorityType).toBe("squads-multisig");
    expect(mockReport.graph?.nodes.length).toBe(2);
    expect(mockReport.graph?.edges[0].relation).toBe("UPGRADE_AUTHORITY_OF");
    expect(mockReport.policy?.status).toBe("PASS");
  });

  it("handles Token-2022 extension structures in frontend models", () => {
    const report: AnalysisResponse = {
      address: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
      kind: "mint",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Token-2022 mint",
      findings: [],
      warnings: [],
      extensions: [
        {
          typeCode: 13,
          name: "PermanentDelegate",
          parseStatus: "parsed",
          authority: "Delegate111111111111111111111111111111111",
          fields: { delegate: "Delegate111111111111111111111111111111111" }
        },
        {
          typeCode: 1,
          name: "TransferFeeConfig",
          parseStatus: "parsed",
          authority: "FeeAuthority11111111111111111111111111111",
          fields: {
            feeBasisPoints: 50,
            maximumFee: "5000000000"
          }
        }
      ]
    };

    expect(report.extensions?.length).toBe(2);
    const permExt = report.extensions?.find(e => e.typeCode === 13);
    expect(permExt?.name).toBe("PermanentDelegate");
    expect(permExt?.authority).toBe("Delegate111111111111111111111111111111111");

    const feeExt = report.extensions?.find(e => e.typeCode === 1);
    expect(feeExt?.fields?.feeBasisPoints).toBe(50);
  });
});
