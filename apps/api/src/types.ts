export type Severity = "critical" | "high" | "medium" | "low" | "info" | "unknown";
export type FindingStatus = "present" | "absent" | "unknown";

export interface Evidence {
  source: string;
  accountAddress?: string;
  observedValue: string;
  detail: string;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  status: FindingStatus;
  summary: string;
  evidence: Evidence[];
  recommendation: string;
  limitations?: string[];
}

export interface AnalysisResponse {
  address: string;
  kind: "program" | "mint" | "unknown";
  cluster: string;
  observedAt: string;
  result: "findings" | "unsupported";
  summary: string;
  findings: Finding[];
  warnings: string[];
}
