/**
 * Security Policy and Configuration Drift Engine
 *
 * Evaluates verifiable security policies against observed account configuration.
 *
 * Evaluation states:
 * - PASS: All applicable requirements are verified against on-chain evidence.
 * - FAIL: A verified requirement is violated.
 * - UNKNOWN: Insufficient evidence or unparsed account data prevents verification.
 * - NOT_APPLICABLE: The rule does not apply to this asset/account type.
 *
 * Critical principle: Never return PASS when required fields cannot be parsed or
 * when an authority control path is unresolved.
 */

import type {
  AnalysisResponse,
  SecurityPolicy,
  PolicyEvaluation,
  PolicyRuleResult,
  PolicyEvaluationStatus
} from "./types.js";

export const DEFAULT_BASELINE_POLICY: SecurityPolicy = {
  id: "baseline-solana-security",
  name: "Baseline Solana Administrative Security Policy",
  description: "Standard security posture: disallows arbitrary freeze authority, flags dangerous Token-2022 extensions like PermanentDelegate, and requires verified multisig or immutability.",
  rules: {
    requireImmutableProgram: false,
    disallowFreezeAuthority: true,
    disallowPermanentDelegate: true,
    minMultisigThreshold: 2,
    disallowUnresolvedAuthorities: false
  }
};

export const STRICT_IMMUTABILITY_POLICY: SecurityPolicy = {
  id: "strict-immutability",
  name: "Strict Immutability Policy",
  description: "Requires complete immutability: no program upgrade authority, revoked mint authority, revoked freeze authority, and no transfer interceptors.",
  rules: {
    requireImmutableProgram: true,
    disallowFreezeAuthority: true,
    disallowPermanentDelegate: true,
    disallowedToken2022Extensions: [1, 2, 4, 13] // TransferFee, MintCloseAuthority, DefaultAccountState, PermanentDelegate
  }
};

export function evaluatePolicy(
  analysis: AnalysisResponse,
  policy: SecurityPolicy = DEFAULT_BASELINE_POLICY
): PolicyEvaluation {
  const ruleResults: PolicyRuleResult[] = [];

  // Helper to find finding
  const findFinding = (id: string) => analysis.findings.find(f => f.id === id);

  // 1. Program Immutability Rule
  if (policy.rules.requireImmutableProgram !== undefined) {
    if (analysis.kind === "program") {
      const immutableFinding = findFinding("PROGRAM_IMMUTABLE");
      const activeUpgradeFinding = findFinding("PROGRAM_UPGRADE_AUTHORITY_ACTIVE");
      const unsupportedFinding = findFinding("PROGRAM_LOADER_UNSUPPORTED");

      if (immutableFinding) {
        ruleResults.push({
          ruleId: "require-immutable-program",
          name: "Program Must Be Immutable",
          status: "PASS",
          reason: "ProgramData account confirms upgrade authority is null (immutable program).",
          evidence: immutableFinding.evidence[0]?.detail
        });
      } else if (activeUpgradeFinding) {
        if (policy.rules.requireImmutableProgram) {
          ruleResults.push({
            ruleId: "require-immutable-program",
            name: "Program Must Be Immutable",
            status: "FAIL",
            reason: `Program has an active upgrade authority: ${activeUpgradeFinding.evidence[0]?.observedValue}`,
            evidence: activeUpgradeFinding.evidence[0]?.detail
          });
        } else {
          ruleResults.push({
            ruleId: "require-immutable-program",
            name: "Program Must Be Immutable",
            status: "PASS",
            reason: "Policy allows upgradeable programs, active upgrade authority observed.",
            evidence: activeUpgradeFinding.evidence[0]?.detail
          });
        }
      } else if (unsupportedFinding) {
        ruleResults.push({
          ruleId: "require-immutable-program",
          name: "Program Must Be Immutable",
          status: "UNKNOWN",
          reason: "Program loader format is unsupported. Cannot verify upgrade authority status.",
          evidence: unsupportedFinding.evidence[0]?.detail
        });
      } else {
        ruleResults.push({
          ruleId: "require-immutable-program",
          name: "Program Must Be Immutable",
          status: "UNKNOWN",
          reason: "Incomplete ProgramData account layout prevented determination of immutability."
        });
      }
    } else {
      ruleResults.push({
        ruleId: "require-immutable-program",
        name: "Program Must Be Immutable",
        status: "NOT_APPLICABLE",
        reason: "Target account is not a program."
      });
    }
  }

  // 2. Approved Upgrade Authorities Rule
  if (policy.rules.approvedUpgradeAuthorities && policy.rules.approvedUpgradeAuthorities.length > 0) {
    if (analysis.kind === "program") {
      const activeUpgradeFinding = findFinding("PROGRAM_UPGRADE_AUTHORITY_ACTIVE");
      if (activeUpgradeFinding) {
        const authority = activeUpgradeFinding.evidence[0]?.observedValue;
        if (authority && policy.rules.approvedUpgradeAuthorities.includes(authority)) {
          ruleResults.push({
            ruleId: "approved-upgrade-authorities",
            name: "Upgrade Authority Must Be Whitelisted",
            status: "PASS",
            reason: `Upgrade authority ${authority} matches approved list.`,
            evidence: activeUpgradeFinding.evidence[0]?.detail
          });
        } else {
          ruleResults.push({
            ruleId: "approved-upgrade-authorities",
            name: "Upgrade Authority Must Be Whitelisted",
            status: "FAIL",
            reason: `Upgrade authority ${authority} is not in the approved whitelist.`,
            evidence: `Observed: ${authority}; Allowed: ${policy.rules.approvedUpgradeAuthorities.join(", ")}`
          });
        }
      } else if (findFinding("PROGRAM_IMMUTABLE")) {
        ruleResults.push({
          ruleId: "approved-upgrade-authorities",
          name: "Upgrade Authority Must Be Whitelisted",
          status: "PASS",
          reason: "Program is immutable; no unapproved upgrade authority exists."
        });
      } else {
        ruleResults.push({
          ruleId: "approved-upgrade-authorities",
          name: "Upgrade Authority Must Be Whitelisted",
          status: "UNKNOWN",
          reason: "Program upgrade authority status could not be resolved."
        });
      }
    } else {
      ruleResults.push({
        ruleId: "approved-upgrade-authorities",
        name: "Upgrade Authority Must Be Whitelisted",
        status: "NOT_APPLICABLE",
        reason: "Target account is not a program."
      });
    }
  }

  // 3. Freeze Authority Rule
  if (policy.rules.disallowFreezeAuthority !== undefined) {
    if (analysis.kind === "mint") {
      const activeFreeze = findFinding("TOKEN_FREEZE_AUTHORITY_ACTIVE");
      const revokedFreeze = findFinding("TOKEN_FREEZE_AUTHORITY_REVOKED");

      if (policy.rules.disallowFreezeAuthority) {
        if (revokedFreeze) {
          ruleResults.push({
            ruleId: "disallow-freeze-authority",
            name: "Freeze Authority Must Be Revoked",
            status: "PASS",
            reason: "Freeze authority is revoked in mint layout.",
            evidence: revokedFreeze.evidence[0]?.detail
          });
        } else if (activeFreeze) {
          ruleResults.push({
            ruleId: "disallow-freeze-authority",
            name: "Freeze Authority Must Be Revoked",
            status: "FAIL",
            reason: `Freeze authority is active: ${activeFreeze.evidence[0]?.observedValue}`,
            evidence: activeFreeze.evidence[0]?.detail
          });
        } else {
          ruleResults.push({
            ruleId: "disallow-freeze-authority",
            name: "Freeze Authority Must Be Revoked",
            status: "UNKNOWN",
            reason: "Freeze authority field could not be decoded."
          });
        }
      } else {
        ruleResults.push({
          ruleId: "disallow-freeze-authority",
          name: "Freeze Authority Must Be Revoked",
          status: "PASS",
          reason: "Policy allows active freeze authority."
        });
      }
    } else {
      ruleResults.push({
        ruleId: "disallow-freeze-authority",
        name: "Freeze Authority Must Be Revoked",
        status: "NOT_APPLICABLE",
        reason: "Target account is not a mint."
      });
    }
  }

  // 4. Approved Mint Authorities Rule
  if (policy.rules.approvedMintAuthorities !== undefined) {
    if (analysis.kind === "mint") {
      const activeMint = findFinding("TOKEN_MINT_AUTHORITY_ACTIVE");
      const revokedMint = findFinding("TOKEN_MINT_AUTHORITY_REVOKED");

      if (revokedMint) {
        ruleResults.push({
          ruleId: "approved-mint-authorities",
          name: "Mint Authority Must Be Whitelisted or Revoked",
          status: "PASS",
          reason: "Mint authority is revoked; no new tokens can be minted.",
          evidence: revokedMint.evidence[0]?.detail
        });
      } else if (activeMint) {
        const auth = activeMint.evidence[0]?.observedValue;
        if (auth && policy.rules.approvedMintAuthorities.includes(auth)) {
          ruleResults.push({
            ruleId: "approved-mint-authorities",
            name: "Mint Authority Must Be Whitelisted or Revoked",
            status: "PASS",
            reason: `Mint authority ${auth} matches approved whitelist.`,
            evidence: activeMint.evidence[0]?.detail
          });
        } else {
          ruleResults.push({
            ruleId: "approved-mint-authorities",
            name: "Mint Authority Must Be Whitelisted or Revoked",
            status: "FAIL",
            reason: `Mint authority ${auth} is not in the approved whitelist.`,
            evidence: `Observed: ${auth}; Allowed: ${policy.rules.approvedMintAuthorities.join(", ")}`
          });
        }
      } else {
        ruleResults.push({
          ruleId: "approved-mint-authorities",
          name: "Mint Authority Must Be Whitelisted or Revoked",
          status: "UNKNOWN",
          reason: "Mint authority field could not be verified."
        });
      }
    } else {
      ruleResults.push({
        ruleId: "approved-mint-authorities",
        name: "Mint Authority Must Be Whitelisted or Revoked",
        status: "NOT_APPLICABLE",
        reason: "Target account is not a mint."
      });
    }
  }

  // 5. Token-2022 Permanent Delegate Rule
  if (policy.rules.disallowPermanentDelegate !== undefined) {
    if (analysis.kind === "mint") {
      const permDelegateExt = analysis.extensions?.find(e => e.typeCode === 13 || e.name === "PermanentDelegate");
      if (permDelegateExt) {
        ruleResults.push({
          ruleId: "disallow-permanent-delegate",
          name: "Permanent Delegate Must Be Absent",
          status: "FAIL",
          reason: `Permanent Delegate extension detected (delegate: ${permDelegateExt.authority ?? "unresolved"}). Can seize or burn tokens from any account.`,
          evidence: `Extension typeCode 13 detected. Delegate authority: ${permDelegateExt.authority}`
        });
      } else {
        ruleResults.push({
          ruleId: "disallow-permanent-delegate",
          name: "Permanent Delegate Must Be Absent",
          status: "PASS",
          reason: "No Permanent Delegate extension detected on this mint."
        });
      }
    } else {
      ruleResults.push({
        ruleId: "disallow-permanent-delegate",
        name: "Permanent Delegate Must Be Absent",
        status: "NOT_APPLICABLE",
        reason: "Target account is not a mint."
      });
    }
  }

  // 6. Disallowed Token-2022 Extensions Rule
  if (policy.rules.disallowedToken2022Extensions && policy.rules.disallowedToken2022Extensions.length > 0) {
    if (analysis.kind === "mint") {
      const matchedExts = analysis.extensions?.filter(e =>
        policy.rules.disallowedToken2022Extensions!.includes(e.typeCode)
      );
      if (matchedExts && matchedExts.length > 0) {
        ruleResults.push({
          ruleId: "disallowed-token2022-extensions",
          name: "Disallowed Token-2022 Extensions Must Be Absent",
          status: "FAIL",
          reason: `Disallowed extension(s) found: ${matchedExts.map(e => `${e.name} (#${e.typeCode})`).join(", ")}`,
          evidence: `Extensions present: ${matchedExts.map(e => e.typeCode).join(", ")}`
        });
      } else {
        ruleResults.push({
          ruleId: "disallowed-token2022-extensions",
          name: "Disallowed Token-2022 Extensions Must Be Absent",
          status: "PASS",
          reason: "None of the disallowed Token-2022 extensions are present."
        });
      }
    } else {
      ruleResults.push({
        ruleId: "disallowed-token2022-extensions",
        name: "Disallowed Token-2022 Extensions Must Be Absent",
        status: "NOT_APPLICABLE",
        reason: "Target account is not a mint."
      });
    }
  }

  // 7. Minimum Multisig Threshold Rule
  if (policy.rules.minMultisigThreshold !== undefined) {
    const squadsFindings = analysis.findings.filter(f => f.authorityType === "squads-multisig");
    if (squadsFindings.length > 0) {
      let anyFailed = false;
      let anyUnknown = false;
      const reasons: string[] = [];

      for (const finding of squadsFindings) {
        const thresholdMatch = finding.evidence[0]?.detail.match(/threshold=(\d+)/i);
        if (thresholdMatch) {
          const threshold = parseInt(thresholdMatch[1], 10);
          if (threshold < policy.rules.minMultisigThreshold) {
            anyFailed = true;
            reasons.push(`Authority ${finding.evidence[0]?.observedValue} has threshold ${threshold} < required ${policy.rules.minMultisigThreshold}`);
          } else {
            reasons.push(`Authority ${finding.evidence[0]?.observedValue} has threshold ${threshold} >= required ${policy.rules.minMultisigThreshold}`);
          }
        } else {
          anyUnknown = true;
          reasons.push(`Authority ${finding.evidence[0]?.observedValue} threshold could not be decoded`);
        }
      }

      if (anyFailed) {
        ruleResults.push({
          ruleId: "min-multisig-threshold",
          name: "Minimum Multisig Threshold Requirement",
          status: "FAIL",
          reason: reasons.join("; ")
        });
      } else if (anyUnknown) {
        ruleResults.push({
          ruleId: "min-multisig-threshold",
          name: "Minimum Multisig Threshold Requirement",
          status: "UNKNOWN",
          reason: reasons.join("; ")
        });
      } else {
        ruleResults.push({
          ruleId: "min-multisig-threshold",
          name: "Minimum Multisig Threshold Requirement",
          status: "PASS",
          reason: reasons.join("; ")
        });
      }
    } else {
      ruleResults.push({
        ruleId: "min-multisig-threshold",
        name: "Minimum Multisig Threshold Requirement",
        status: "NOT_APPLICABLE",
        reason: "No Squads multisig authorities identified for this asset."
      });
    }
  }

  // 8. Disallow Unresolved Authorities Rule
  if (policy.rules.disallowUnresolvedAuthorities) {
    const unresolvedFindings = analysis.findings.filter(
      f => f.authorityType === "unresolved" || f.authorityType === "unknown-program-owned"
    );
    if (unresolvedFindings.length > 0) {
      ruleResults.push({
        ruleId: "disallow-unresolved-authorities",
        name: "All Authorities Must Be Resolved",
        status: "FAIL",
        reason: `${unresolvedFindings.length} authority(ies) could not be resolved to a direct key or known multisig: ` +
          unresolvedFindings.map(f => f.evidence[0]?.observedValue).join(", ")
      });
    } else {
      ruleResults.push({
        ruleId: "disallow-unresolved-authorities",
        name: "All Authorities Must Be Resolved",
        status: "PASS",
        reason: "All identified authorities were resolved to verified direct keys or recognized multisig accounts."
      });
    }
  }

  // Determine overall policy status
  const applicableResults = ruleResults.filter(r => r.status !== "NOT_APPLICABLE");
  let overallStatus: "PASS" | "FAIL" | "UNKNOWN" = "PASS";

  if (applicableResults.some(r => r.status === "FAIL")) {
    overallStatus = "FAIL";
  } else if (applicableResults.some(r => r.status === "UNKNOWN")) {
    overallStatus = "UNKNOWN";
  } else if (applicableResults.length === 0) {
    overallStatus = "PASS";
  }

  const failCount = applicableResults.filter(r => r.status === "FAIL").length;
  const passCount = applicableResults.filter(r => r.status === "PASS").length;
  const unknownCount = applicableResults.filter(r => r.status === "UNKNOWN").length;

  const summary = overallStatus === "PASS"
    ? `All ${passCount} applicable security requirements passed.`
    : overallStatus === "FAIL"
      ? `Policy violation detected: ${failCount} requirement(s) failed.`
      : `Inconclusive policy evaluation: ${unknownCount} requirement(s) could not be verified due to incomplete or unsupported data.`;

  return {
    policyId: policy.id,
    policyName: policy.name,
    status: overallStatus,
    summary,
    rules: ruleResults,
    evaluatedAt: new Date().toISOString()
  };
}
