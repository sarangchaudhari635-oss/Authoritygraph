export type Severity = "critical" | "high" | "medium" | "low" | "info" | "unknown";
export type FindingStatus = "present" | "absent" | "unknown";

/** How an authority is controlled. */
export type AuthorityType =
  | "direct-key"
  | "squads-multisig"
  | "unknown-program-owned"
  | "unresolved";

/** A detected Token-2022 extension (presence only or fully parsed). */
export interface Token2022Extension {
  /** Numeric extension type code from the Token-2022 TLV layout */
  typeCode: number;
  /** Human-readable extension name if recognized */
  name: string;
  /** Whether the extension was fully parsed or just detected */
  parseStatus: "parsed" | "detected" | "unsupported";
  /** Authority address extracted from the extension, if any */
  authority?: string | null;
  /** Additional decoded fields as key-value pairs */
  fields?: Record<string, string | number | boolean | null>;
  /** Finding generated from this extension, if any */
  findingId?: string;
}

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
  /** Authority classification when relevant */
  authorityType?: AuthorityType;
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
  /** Token-2022 extensions detected on this account, if applicable */
  extensions?: Token2022Extension[];
}

