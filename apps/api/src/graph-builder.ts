/**
 * Authority Control Graph Builder
 *
 * Constructs a normalized, directed control graph representing
 * the administrative relationships discovered during analysis.
 *
 * Every relationship is traceable to observed on-chain facts.
 * Unresolved or unsupported authorities are explicitly represented
 * as unresolved nodes, never omitted or assumed safe.
 */

import type {
  AnalysisResponse,
  AuthorityControlGraph,
  GraphNode,
  GraphEdge
} from "./types.js";

export function buildAuthorityControlGraph(analysis: AnalysisResponse): AuthorityControlGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const addedNodeIds = new Set<string>();

  function addNode(node: GraphNode) {
    if (!addedNodeIds.has(node.id)) {
      addedNodeIds.add(node.id);
      nodes.push(node);
    }
  }

  // 1. Root target node
  const targetLabel = analysis.kind === "program"
    ? `Program: ${analysis.address.slice(0, 6)}...${analysis.address.slice(-4)}`
    : analysis.kind === "mint"
      ? `Mint: ${analysis.address.slice(0, 6)}...${analysis.address.slice(-4)}`
      : `Target: ${analysis.address.slice(0, 6)}...${analysis.address.slice(-4)}`;

  addNode({
    id: analysis.address,
    label: targetLabel,
    role: "target",
    type: analysis.kind === "program" ? "program" : analysis.kind === "mint" ? "mint" : "unresolved",
    address: analysis.address,
    details: {
      kind: analysis.kind,
      result: analysis.result,
      observedAt: analysis.observedAt
    }
  });

  // 2. Extract authority findings
  for (const finding of analysis.findings) {
    // Program upgrade authority
    if (finding.id === "PROGRAM_UPGRADE_AUTHORITY_ACTIVE") {
      const authAddress = finding.evidence[0]?.observedValue;
      if (authAddress && authAddress !== "null") {
        const authType = finding.authorityType ?? "unresolved";
        const authNodeId = `auth:upgrade:${authAddress}`;
        
        addNode({
          id: authNodeId,
          label: `Upgrade Authority: ${authAddress.slice(0, 4)}...${authAddress.slice(-4)}`,
          role: "upgrade-authority",
          type: authType,
          address: authAddress,
          details: {
            authorityType: authType,
            findingId: finding.id,
            severity: finding.severity
          }
        });

        edges.push({
          from: authNodeId,
          to: analysis.address,
          label: "Upgrades",
          relation: "UPGRADE_AUTHORITY_OF",
          evidence: finding.evidence[0]?.detail ?? "Upgradeable BPF Loader ProgramData authority"
        });
      }
    }

    // SPL Token mint authority
    if (finding.id === "TOKEN_MINT_AUTHORITY_ACTIVE") {
      const authAddress = finding.evidence[0]?.observedValue;
      if (authAddress && authAddress !== "null") {
        const authType = finding.authorityType ?? "direct-key";
        const authNodeId = `auth:mint:${authAddress}`;

        addNode({
          id: authNodeId,
          label: `Mint Authority: ${authAddress.slice(0, 4)}...${authAddress.slice(-4)}`,
          role: "mint-authority",
          type: authType,
          address: authAddress,
          details: {
            authorityType: authType,
            findingId: finding.id,
            severity: finding.severity
          }
        });

        edges.push({
          from: authNodeId,
          to: analysis.address,
          label: "Mints Tokens",
          relation: "MINT_AUTHORITY_OF",
          evidence: finding.evidence[0]?.detail ?? "SPL Token MintLayout mintAuthority field"
        });
      }
    }

    // SPL Token freeze authority
    if (finding.id === "TOKEN_FREEZE_AUTHORITY_ACTIVE") {
      const authAddress = finding.evidence[0]?.observedValue;
      if (authAddress && authAddress !== "null") {
        const authType = finding.authorityType ?? "direct-key";
        const authNodeId = `auth:freeze:${authAddress}`;

        addNode({
          id: authNodeId,
          label: `Freeze Authority: ${authAddress.slice(0, 4)}...${authAddress.slice(-4)}`,
          role: "freeze-authority",
          type: authType,
          address: authAddress,
          details: {
            authorityType: authType,
            findingId: finding.id,
            severity: finding.severity
          }
        });

        edges.push({
          from: authNodeId,
          to: analysis.address,
          label: "Freezes Accounts",
          relation: "FREEZE_AUTHORITY_OF",
          evidence: finding.evidence[0]?.detail ?? "SPL Token MintLayout freezeAuthority field"
        });
      }
    }
  }

  // 3. Token-2022 Extensions authorities
  if (analysis.extensions) {
    for (const ext of analysis.extensions) {
      if (ext.authority) {
        const extNodeId = `auth:ext:${ext.typeCode}:${ext.authority}`;
        addNode({
          id: extNodeId,
          label: `${ext.name} Authority: ${ext.authority.slice(0, 4)}...${ext.authority.slice(-4)}`,
          role: "extension-authority",
          type: "direct-key",
          address: ext.authority,
          details: {
            extensionTypeCode: ext.typeCode,
            extensionName: ext.name,
            parseStatus: ext.parseStatus,
            ...ext.fields
          }
        });

        edges.push({
          from: extNodeId,
          to: analysis.address,
          label: `Controls ${ext.name}`,
          relation: "EXTENSION_AUTHORITY_OF",
          evidence: `Token-2022 TLV extension #${ext.typeCode} (${ext.name})`
        });
      }
    }
  }

  return { nodes, edges };
}
