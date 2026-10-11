import { describe, it, expect } from "vitest";
import { buildAuthorityControlGraph } from "./graph-builder.js";
import type { AnalysisResponse } from "./types.js";

describe("Authority Control Graph Builder", () => {
  it("builds a directed graph for a program with active upgrade authority", () => {
    const analysis: AnalysisResponse = {
      address: "Prog111111111111111111111111111111111111111",
      kind: "program",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Program with active upgrade authority",
      findings: [
        {
          id: "PROGRAM_UPGRADE_AUTHORITY_ACTIVE",
          title: "Program has active upgrade authority",
          severity: "high",
          status: "present",
          summary: "Upgrade authority is active",
          recommendation: "Verify custody",
          authorityType: "squads-multisig",
          evidence: [
            {
              source: "Solana RPC account data",
              accountAddress: "ProgData11111111111111111111111111111111111",
              observedValue: "Auth111111111111111111111111111111111111111",
              detail: "ProgramData=ProgData; deploymentSlot=100; authorityType=squads-multisig."
            }
          ]
        }
      ],
      warnings: []
    };

    const graph = buildAuthorityControlGraph(analysis);

    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBe(1);

    const targetNode = graph.nodes.find(n => n.id === analysis.address);
    expect(targetNode).toBeDefined();
    expect(targetNode?.role).toBe("target");
    expect(targetNode?.type).toBe("program");

    const authNode = graph.nodes.find(n => n.address === "Auth111111111111111111111111111111111111111");
    expect(authNode).toBeDefined();
    expect(authNode?.role).toBe("upgrade-authority");
    expect(authNode?.type).toBe("squads-multisig");

    const edge = graph.edges[0];
    expect(edge.from).toBe(authNode?.id);
    expect(edge.to).toBe(targetNode?.id);
    expect(edge.relation).toBe("UPGRADE_AUTHORITY_OF");
  });

  it("builds a directed graph for a token with mint, freeze, and Token-2022 extension authorities", () => {
    const analysis: AnalysisResponse = {
      address: "Mint111111111111111111111111111111111111111",
      kind: "mint",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Token with mint, freeze, and permanent delegate",
      findings: [
        {
          id: "TOKEN_MINT_AUTHORITY_ACTIVE",
          title: "Mint authority is active",
          severity: "medium",
          status: "present",
          summary: "Can mint tokens",
          recommendation: "Confirm issuance",
          authorityType: "direct-key",
          evidence: [
            {
              source: "Solana RPC account data",
              observedValue: "MintAuth1111111111111111111111111111111111",
              detail: "supply=1000"
            }
          ]
        },
        {
          id: "TOKEN_FREEZE_AUTHORITY_ACTIVE",
          title: "Freeze authority is active",
          severity: "medium",
          status: "present",
          summary: "Can freeze accounts",
          recommendation: "Confirm policy",
          authorityType: "direct-key",
          evidence: [
            {
              source: "Solana RPC account data",
              observedValue: "FreezeAuth11111111111111111111111111111111",
              detail: "Token program=Tokenz"
            }
          ]
        }
      ],
      extensions: [
        {
          typeCode: 13,
          name: "PermanentDelegate",
          parseStatus: "parsed",
          authority: "PermDel11111111111111111111111111111111111",
          fields: { delegate: "PermDel11111111111111111111111111111111111" }
        }
      ],
      warnings: []
    };

    const graph = buildAuthorityControlGraph(analysis);

    // Target (1) + MintAuth (1) + FreezeAuth (1) + PermanentDelegate (1) = 4 nodes
    expect(graph.nodes.length).toBe(4);
    expect(graph.edges.length).toBe(3);

    const edgeRelations = graph.edges.map(e => e.relation);
    expect(edgeRelations).toContain("MINT_AUTHORITY_OF");
    expect(edgeRelations).toContain("FREEZE_AUTHORITY_OF");
    expect(edgeRelations).toContain("EXTENSION_AUTHORITY_OF");
  });

  it("handles empty or immutable program without hanging edges", () => {
    const analysis: AnalysisResponse = {
      address: "ProgImmutable1111111111111111111111111111111",
      kind: "program",
      cluster: "mainnet-beta",
      observedAt: "2026-10-11T12:00:00Z",
      result: "findings",
      summary: "Program is immutable",
      findings: [
        {
          id: "PROGRAM_IMMUTABLE",
          title: "Program is immutable",
          severity: "info",
          status: "absent",
          summary: "No upgrade authority",
          recommendation: "Keep records",
          evidence: [{ source: "Solana RPC", observedValue: "upgradeAuthority=null", detail: "immutable" }]
        }
      ],
      warnings: []
    };

    const graph = buildAuthorityControlGraph(analysis);
    expect(graph.nodes.length).toBe(1);
    expect(graph.nodes[0].role).toBe("target");
    expect(graph.edges.length).toBe(0);
  });
});
