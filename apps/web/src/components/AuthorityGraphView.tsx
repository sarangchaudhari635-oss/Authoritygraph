import { useState } from "react";
import { GitBranch, Shield, Key, Users, AlertCircle, Info, ExternalLink } from "lucide-react";
import type { AuthorityControlGraph, GraphNode } from "../types";

const short = (val: string) => (val.length > 16 ? `${val.slice(0, 6)}...${val.slice(-4)}` : val);

export function AuthorityGraphView({ graph }: { graph?: AuthorityControlGraph }) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="sc-empty">
        No authority control graph available for this asset.
      </div>
    );
  }

  // Position nodes nicely: Target on right/center, Authorities on left
  const targetNode = graph.nodes.find(n => n.role === "target") || graph.nodes[0];
  const authorityNodes = graph.nodes.filter(n => n.id !== targetNode.id);

  const width = 720;
  const height = Math.max(260, authorityNodes.length * 85 + 40);

  const targetX = width - 180;
  const targetY = height / 2;

  // Node coordinate mapping
  const coords = new Map<string, { x: number; y: number }>();
  coords.set(targetNode.id, { x: targetX, y: targetY });

  authorityNodes.forEach((node, idx) => {
    const spacing = height / (authorityNodes.length + 1);
    const y = spacing * (idx + 1);
    const x = 160;
    coords.set(node.id, { x, y });
  });

  function getNodeIcon(type: GraphNode["type"]) {
    switch (type) {
      case "squads-multisig":
        return <Users size={14} className="text-amber" />;
      case "direct-key":
        return <Key size={14} className="text-blue" />;
      case "program":
        return <GitBranch size={14} className="text-purple" />;
      case "mint":
        return <Shield size={14} className="text-green" />;
      case "unresolved":
      case "unknown-program-owned":
      default:
        return <AlertCircle size={14} className="text-muted" />;
    }
  }

  return (
    <div className="ag-graph-wrapper">
      <div className="ag-graph-header">
        <div className="sc-eyebrow">
          <GitBranch size={13} /> DIRECTED CONTROL GRAPH
        </div>
        <span className="sc-mono sc-muted" style={{ fontSize: "11px" }}>
          {graph.nodes.length} nodes · {graph.edges.length} control paths
        </span>
      </div>

      <div className="ag-graph-container">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="ag-graph-svg"
          style={{ width: "100%", height: `${height}px` }}
        >
          <defs>
            <linearGradient id="edgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(255, 154, 156, 0.7)" />
              <stop offset="100%" stopColor="rgba(104, 220, 191, 0.7)" />
            </linearGradient>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="16"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(104, 220, 191, 0.85)" />
            </marker>
          </defs>

          {/* Render directed edges */}
          {graph.edges.map((edge, idx) => {
            const start = coords.get(edge.from);
            const end = coords.get(edge.to);
            if (!start || !end) return null;

            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const pathD = `M ${start.x} ${start.y} C ${start.x + dx * 0.4} ${start.y}, ${end.x - dx * 0.4} ${end.y}, ${end.x} ${end.y}`;

            return (
              <g key={`edge-${idx}`}>
                <path
                  d={pathD}
                  className="ag-edge-line"
                  stroke="url(#edgeGrad)"
                  strokeWidth="2"
                  fill="none"
                  markerEnd="url(#arrow)"
                />
                <rect
                  x={midX - 45}
                  y={midY - 10}
                  width="90"
                  height="20"
                  rx="4"
                  className="ag-edge-label-bg"
                />
                <text
                  x={midX}
                  y={midY + 4}
                  textAnchor="middle"
                  className="ag-edge-label-text"
                >
                  {edge.label}
                </text>
              </g>
            );
          })}

          {/* Render nodes */}
          {graph.nodes.map(node => {
            const pos = coords.get(node.id);
            if (!pos) return null;
            const isSelected = selectedNode?.id === node.id;
            const isTarget = node.role === "target";
            const nodeWidth = isTarget ? 170 : 155;
            const nodeHeight = 52;

            return (
              <g
                key={node.id}
                transform={`translate(${pos.x - nodeWidth / 2}, ${pos.y - nodeHeight / 2})`}
                className={`ag-node-group ${isSelected ? "selected" : ""} ${isTarget ? "target" : ""}`}
                onClick={() => setSelectedNode(node)}
                style={{ cursor: "pointer" }}
              >
                <rect
                  width={nodeWidth}
                  height={nodeHeight}
                  rx="10"
                  className={`ag-node-rect ${isTarget ? "target-rect" : ""} ${isSelected ? "selected-rect" : ""}`}
                />
                <text x="14" y="22" className="ag-node-title">
                  {node.role.replace("-", " ").toUpperCase()}
                </text>
                <text x="14" y="38" className="ag-node-addr sc-mono">
                  {short(node.address)}
                </text>
                <circle
                  cx={nodeWidth - 20}
                  cy={26}
                  r="10"
                  className="ag-node-badge-bg"
                />
                <text
                  x={nodeWidth - 20}
                  y={30}
                  textAnchor="middle"
                  className="ag-node-badge-text"
                >
                  {node.type === "squads-multisig" ? "M" : node.type === "direct-key" ? "K" : "A"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected Node Details Drawer */}
      {selectedNode && (
        <div className="ag-node-drawer">
          <div className="ag-node-drawer-head">
            <div className="ag-drawer-title-row">
              {getNodeIcon(selectedNode.type)}
              <strong>{selectedNode.label}</strong>
              <span className={`pill pill-${selectedNode.type}`}>
                {selectedNode.type.toUpperCase()}
              </span>
            </div>
            <button
              type="button"
              className="ag-drawer-close"
              onClick={() => setSelectedNode(null)}
            >
              ×
            </button>
          </div>
          <div className="ag-drawer-body">
            <div className="ag-drawer-field">
              <span className="sc-muted">Address:</span>
              <code className="sc-mono">{selectedNode.address}</code>
            </div>
            {selectedNode.details && Object.entries(selectedNode.details).map(([k, v]) => (
              <div className="ag-drawer-field" key={k}>
                <span className="sc-muted">{k}:</span>
                <span>{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
