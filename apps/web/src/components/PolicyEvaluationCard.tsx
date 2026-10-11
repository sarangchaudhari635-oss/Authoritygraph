import { useState } from "react";
import { CheckCircle2, XCircle, HelpCircle, MinusCircle, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import type { PolicyEvaluation, PolicyRuleResult } from "../types";

export function PolicyEvaluationCard({ policy }: { policy?: PolicyEvaluation }) {
  const [expanded, setExpanded] = useState(false);

  if (!policy) return null;

  const passCount = policy.rules.filter(r => r.status === "PASS").length;
  const failCount = policy.rules.filter(r => r.status === "FAIL").length;
  const unknownCount = policy.rules.filter(r => r.status === "UNKNOWN").length;
  const naCount = policy.rules.filter(r => r.status === "NOT_APPLICABLE").length;

  function renderStatusIcon(status: PolicyRuleResult["status"]) {
    switch (status) {
      case "PASS":
        return <CheckCircle2 size={16} className="text-green" />;
      case "FAIL":
        return <XCircle size={16} className="text-red" />;
      case "UNKNOWN":
        return <HelpCircle size={16} className="text-amber" />;
      case "NOT_APPLICABLE":
      default:
        return <MinusCircle size={16} className="text-muted" />;
    }
  }

  return (
    <div className={`ag-policy-card ag-policy-${policy.status.toLowerCase()}`}>
      <div className="ag-policy-header" onClick={() => setExpanded(!expanded)} style={{ cursor: "pointer" }}>
        <div className="ag-policy-title-block">
          <div className="sc-eyebrow">
            <ShieldCheck size={13} /> SECURITY POLICY & DRIFT EVALUATION
          </div>
          <h3>{policy.policyName}</h3>
          <p className="ag-policy-summary">{policy.summary}</p>
        </div>

        <div className="ag-policy-badge-block">
          <span className={`ag-status-badge status-${policy.status.toLowerCase()}`}>
            {policy.status}
          </span>
          <div className="ag-policy-counts sc-mono">
            {passCount > 0 && <span className="count-pass">{passCount} PASS</span>}
            {failCount > 0 && <span className="count-fail">{failCount} FAIL</span>}
            {unknownCount > 0 && <span className="count-unk">{unknownCount} UNK</span>}
            {naCount > 0 && <span className="count-na">{naCount} N/A</span>}
          </div>
          <button type="button" className="ag-expand-btn">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="ag-policy-rules-list">
          <div className="sc-section-title" style={{ marginTop: "12px", marginBottom: "8px" }}>
            <span>EVALUATION BREAKDOWN</span>
            <span>{policy.rules.length} RULES</span>
          </div>

          {policy.rules.map(rule => (
            <div key={rule.ruleId} className={`ag-rule-item rule-status-${rule.status.toLowerCase()}`}>
              <div className="ag-rule-icon">{renderStatusIcon(rule.status)}</div>
              <div className="ag-rule-body">
                <div className="ag-rule-head">
                  <strong>{rule.name}</strong>
                  <span className={`pill pill-${rule.status.toLowerCase()}`}>
                    {rule.status}
                  </span>
                </div>
                <p className="ag-rule-reason">{rule.reason}</p>
                {rule.evidence && (
                  <div className="ag-rule-evidence sc-mono">
                    <small>Evidence: {rule.evidence}</small>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
