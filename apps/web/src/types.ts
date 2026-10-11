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
  /** Finding rule version */
  ruleVersion?: string;
  /** Categorization for filtering and policy checks */
  category?: "upgrade-authority" | "mint-authority" | "freeze-authority" | "extension-risk" | "multisig-posture" | "account-integrity";
}

/** Directed Authority Control Graph */
export interface GraphNode {
  id: string;
  label: string;
  role: "target" | "upgrade-authority" | "mint-authority" | "freeze-authority" | "extension-authority" | "multisig-member" | "program" | "authority";
  type: "program" | "mint" | "direct-key" | "squads-multisig" | "unknown-program-owned" | "unresolved";
  address: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  relation:
    | "UPGRADE_AUTHORITY_OF"
    | "MINT_AUTHORITY_OF"
    | "FREEZE_AUTHORITY_OF"
    | "EXTENSION_AUTHORITY_OF"
    | "OWNED_BY"
    | "MULTISIG_MEMBER_OF";
  evidence: string;
}

export interface AuthorityControlGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Security Policy and Configuration Drift */
export type PolicyEvaluationStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";

export interface PolicyRuleResult {
  ruleId: string;
  name: string;
  status: PolicyEvaluationStatus;
  reason: string;
  evidence?: string;
}

export interface PolicyEvaluation {
  policyId: string;
  policyName: string;
  status: "PASS" | "FAIL" | "UNKNOWN";
  summary: string;
  rules: PolicyRuleResult[];
  evaluatedAt: string;
}

export interface SecurityPolicy {
  id: string;
  name: string;
  description: string;
  rules: {
    requireImmutableProgram?: boolean;
    approvedUpgradeAuthorities?: string[];
    disallowFreezeAuthority?: boolean;
    approvedMintAuthorities?: string[];
    disallowPermanentDelegate?: boolean;
    disallowedToken2022Extensions?: number[];
    minMultisigThreshold?: number;
    disallowUnresolvedAuthorities?: boolean;
  };
}

/** Historical Snapshot and Change Detection */
export type ChangeEventType =
  | "AUTHORITY_CHANGED"
  | "AUTHORITY_REMOVED"
  | "AUTHORITY_ADDED"
  | "MULTISIG_THRESHOLD_CHANGED"
  | "MULTISIG_MEMBERS_CHANGED"
  | "EXTENSION_CHANGED"
  | "PROGRAM_IMMUTABILITY_CHANGED"
  | "STATUS_CHANGED";

export interface ChangeEvent {
  type: ChangeEventType;
  field: string;
  previousValue: string | number | null;
  currentValue: string | number | null;
  severity: Severity;
  description: string;
  timestamp: string;
}

export interface Snapshot {
  id: string;
  address: string;
  cluster: string;
  observedAt: string;
  accountDataHash: string;
  kind: "program" | "mint" | "unknown";
  summary: string;
  authorities: {
    upgradeAuthority?: string | null;
    mintAuthority?: string | null;
    freezeAuthority?: string | null;
    extensions?: Record<string, string | null>;
  };
  multisig?: {
    threshold?: number;
    memberCount?: number;
  };
  findingsCount: number;
  analysis: AnalysisResponse;
}

export interface SnapshotComparison {
  targetAddress: string;
  previousSnapshotId: string;
  currentSnapshotId: string;
  previousObservedAt: string;
  currentObservedAt: string;
  hasChanges: boolean;
  changes: ChangeEvent[];
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
  /** Directed Authority Control Graph */
  graph?: AuthorityControlGraph;
  /** Security Policy evaluation result */
  policy?: PolicyEvaluation;
}

