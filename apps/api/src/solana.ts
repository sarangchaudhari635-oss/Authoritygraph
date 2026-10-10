import {
  LoaderV3Program,
  Connection,
  PublicKey
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  MintLayout
} from "@solana/spl-token";

// Token-2022 program ID (hardcoded since spl-token v0.1.8 doesn't export it)
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// BPF Upgradeable Loader program ID (via LoaderV3Program in web3.js v3)
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = LoaderV3Program.programId;
import type { Finding, AnalysisResponse } from "./types.js";
import { config } from "./config.js";

export const connection = new Connection(config.rpcUrl, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: config.requestTimeoutMs
});

function finding(
  id: string,
  title: string,
  severity: Finding["severity"],
  status: Finding["status"],
  summary: string,
  observedValue: string,
  detail: string,
  recommendation: string,
  accountAddress?: string,
  limitations?: string[]
): Finding {
  return {
    id, title, severity, status, summary, recommendation, limitations,
    evidence: [{
      source: "Solana RPC account data",
      accountAddress,
      observedValue,
      detail
    }]
  };
}

function baseResponse(address: string, kind: AnalysisResponse["kind"]): AnalysisResponse {
  return {
    address,
    kind,
    cluster: config.cluster,
    observedAt: new Date().toISOString(),
    result: "findings",
    summary: "Analysis completed. Review each finding and its evidence.",
    findings: [],
    warnings: [
      "This report describes observed on-chain configuration, not confirmed exploitability.",
      "Only supported account types and direct authorities are analyzed in this MVP."
    ]
  };
}

function decodePubkey(data: Buffer, start: number): string {
  if (data.length < start + 32) throw new Error("Account data too short to decode public key");
  return new PublicKey(data.subarray(start, start + 32)).toBase58();
}

async function analyzeProgram(address: string): Promise<AnalysisResponse> {
  const response = baseResponse(address, "program");
  const key = new PublicKey(address);
  const info = await connection.getAccountInfo(key, "confirmed");

  if (!info) {
    response.kind = "unknown";
    response.result = "unsupported";
    response.summary = "No account was found for this address on the configured cluster.";
    response.warnings.push("Verify the address and selected cluster.");
    return response;
  }

  if (!info.executable) {
    response.kind = "unknown";
    response.result = "unsupported";
    response.summary = "The account is not marked executable, so it is not analyzed as a program.";
    response.findings.push(finding(
      "ACCOUNT_NOT_EXECUTABLE", "Account is not executable", "info", "present",
      "The supplied address does not point to an executable program account.",
      "executable=false", "Read from account metadata.", "Submit a program ID to analyze upgrade authority.", address
    ));
    return response;
  }

  if (!info.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)) {
    response.findings.push(finding(
      "PROGRAM_LOADER_UNSUPPORTED", "Program loader not analyzed", "unknown", "unknown",
      "This executable program is not owned by the upgradeable BPF loader recognized by this MVP.",
      info.owner.toBase58(), "Account owner is the loader program ID.",
      "Review the loader and its authority model manually. Do not infer immutability from this result.", address,
      ["Other loaders and loader-specific authority formats are not decoded."]
    ));
    response.result = "unsupported";
    response.summary = "The program is executable, but its loader authority format is outside the current MVP.";
    return response;
  }

  // UpgradeableLoaderState::Program is enum variant 2, followed by a 32-byte ProgramData address.
  // Fail closed if the observed layout differs from the expected layout.
  if (info.data.length < 36 || info.data.readUInt32LE(0) !== 2) {
    response.result = "unsupported";
    response.summary = "The program account data did not match the expected upgradeable-loader layout.";
    response.warnings.push("No authority conclusion was made because the loader data could not be decoded safely.");
    return response;
  }

  const programDataAddress = decodePubkey(info.data, 4);
  const programDataInfo = await connection.getAccountInfo(new PublicKey(programDataAddress), "confirmed");

  if (!programDataInfo || programDataInfo.data.length < 13 || programDataInfo.data.readUInt32LE(0) !== 3) {
    response.result = "unsupported";
    response.summary = "The ProgramData account could not be decoded using the expected loader layout.";
    response.warnings.push("No authority conclusion was made because ProgramData evidence was incomplete.");
    return response;
  }

  // UpgradeableLoaderState::ProgramData: enum tag (4 bytes), slot (8 bytes), Option<Pubkey>.
  const deploymentSlot = programDataInfo.data.readBigUInt64LE(4).toString();
  const optionTag = programDataInfo.data[12];

  if (optionTag === 0) {
    response.findings.push(finding(
      "PROGRAM_IMMUTABLE", "No upgrade authority recorded", "info", "absent",
      "The ProgramData account records no upgrade authority. This is consistent with an immutable program.",
      "upgradeAuthority=null",
      `ProgramData=${programDataAddress}; deploymentSlot=${deploymentSlot}.`,
      "Keep deployment and source-verification evidence with the release record.",
      programDataAddress
    ));
  } else if (optionTag === 1 && programDataInfo.data.length >= 45) {
    const authority = decodePubkey(programDataInfo.data, 13);
    response.findings.push(finding(
      "PROGRAM_UPGRADE_AUTHORITY_ACTIVE", "Program has an active upgrade authority", "high", "present",
      "An address is recorded as the authority able to upgrade this program under the decoded loader layout.",
      authority,
      `ProgramData=${programDataAddress}; deploymentSlot=${deploymentSlot}; direct authority only.`,
      "Verify the authority's custody, approval policy, recovery process, and whether the trust model is documented.",
      programDataAddress,
      ["This does not determine who controls the key or whether it is protected by a multisig."]
    ));
  } else {
    response.result = "unsupported";
    response.summary = "The ProgramData authority field contained an unexpected option value or truncated data.";
    response.warnings.push("No authority conclusion was made.");
  }

  return response;
}

async function analyzeMint(address: string): Promise<AnalysisResponse> {
  const response = baseResponse(address, "mint");
  const key = new PublicKey(address);
  const info = await connection.getAccountInfo(key, "confirmed");

  if (!info) {
    response.kind = "unknown";
    response.result = "unsupported";
    response.summary = "No account was found for this address on the configured cluster.";
    response.warnings.push("Verify the address and selected cluster.");
    return response;
  }

  const supportedOwner = info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID);
  if (!supportedOwner) {
    response.kind = "unknown";
    response.result = "unsupported";
    response.summary = "The account is not owned by the classic SPL Token or Token-2022 program.";
    response.warnings.push(`Observed account owner: ${info.owner.toBase58()}`);
    return response;
  }

  // Decode mint using MintLayout (82-byte classic SPL layout)
  // Works for both TOKEN_PROGRAM_ID and TOKEN_2022_PROGRAM_ID base mint fields
  let decoded: {
    mintAuthorityOption: number;
    mintAuthority: Uint8Array;
    supply: Uint8Array;
    decimals: number;
    isInitialized: number;
    freezeAuthorityOption: number;
    freezeAuthority: Uint8Array;
  };
  try {
    if (info.data.length < MintLayout.span) {
      throw new Error("Account data too short for MintLayout");
    }
    decoded = MintLayout.decode(info.data.slice(0, MintLayout.span)) as typeof decoded;
  } catch {
    response.kind = "unknown";
    response.result = "unsupported";
    response.summary = "The token account could not be decoded as a supported mint.";
    response.warnings.push("The address may refer to a token account rather than a mint.");
    return response;
  }

  const tokenProgram = info.owner.toBase58();
  const mintAuthorityPubkey = decoded.mintAuthorityOption !== 0
    ? new PublicKey(decoded.mintAuthority).toBase58()
    : null;
  const freezeAuthorityPubkey = decoded.freezeAuthorityOption !== 0
    ? new PublicKey(decoded.freezeAuthority).toBase58()
    : null;
  const supply = Buffer.from(decoded.supply).readBigUInt64LE(0).toString();
  const { decimals } = decoded;

  response.findings.push(finding(
    mintAuthorityPubkey ? "TOKEN_MINT_AUTHORITY_ACTIVE" : "TOKEN_MINT_AUTHORITY_REVOKED",
    mintAuthorityPubkey ? "Mint authority is active" : "Mint authority is revoked",
    mintAuthorityPubkey ? "medium" : "info",
    mintAuthorityPubkey ? "present" : "absent",
    mintAuthorityPubkey
      ? "An address is recorded as able to mint additional tokens."
      : "No mint authority is recorded in the decoded mint state.",
    mintAuthorityPubkey ?? "null",
    `Token program=${tokenProgram}; decimals=${decimals}; supply=${supply}.`,
    mintAuthorityPubkey
      ? "Confirm whether ongoing issuance is intended and document the authority's custody and approval controls."
      : "Keep evidence of the revoked authority with the token's launch documentation.",
    address
  ));

  response.findings.push(finding(
    freezeAuthorityPubkey ? "TOKEN_FREEZE_AUTHORITY_ACTIVE" : "TOKEN_FREEZE_AUTHORITY_REVOKED",
    freezeAuthorityPubkey ? "Freeze authority is active" : "Freeze authority is revoked",
    freezeAuthorityPubkey ? "medium" : "info",
    freezeAuthorityPubkey ? "present" : "absent",
    freezeAuthorityPubkey
      ? "An address is recorded as able to freeze token accounts under the supported token program."
      : "No freeze authority is recorded in the decoded mint state.",
    freezeAuthorityPubkey ?? "null",
    `Token program=${tokenProgram}.`,
    freezeAuthorityPubkey
      ? "Confirm the operational and legal purpose of freezing, and disclose the policy to token holders."
      : "Record the current authority state and recheck it after relevant governance changes.",
    address
  ));

  return response;
}

export async function analyzeAddress(address: string, kind: "auto" | "program" | "mint"): Promise<AnalysisResponse> {
  const key = new PublicKey(address);

  if (kind === "program") return analyzeProgram(key.toBase58());
  if (kind === "mint") return analyzeMint(key.toBase58());

  const info = await connection.getAccountInfo(key, "confirmed");
  if (!info) {
    const response = baseResponse(key.toBase58(), "unknown");
    response.result = "unsupported";
    response.summary = "No account was found for this address on the configured cluster.";
    return response;
  }

  if (info.executable) return analyzeProgram(key.toBase58());
  if (info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return analyzeMint(key.toBase58());
  }

  const response = baseResponse(key.toBase58(), "unknown");
  response.result = "unsupported";
  response.summary = "This account type is not supported by the current MVP.";
  response.warnings.push(`Observed account owner: ${info.owner.toBase58()}`);
  return response;
}
