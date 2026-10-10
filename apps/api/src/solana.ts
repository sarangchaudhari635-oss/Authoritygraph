import {
  LoaderV3Program,
  Connection,
  PublicKey,
  AccountInfo
} from "@solana/web3.js";
import type { Finding, AnalysisResponse } from "./types.js";
import { config } from "./config.js";

// ── Program IDs constructed from web3.js v3 PublicKey (not spl-token's bundled v1 copy)
// This avoids the cross-version PublicKey.equals() crash (audit finding B-2).
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// BPF Upgradeable Loader program ID (via LoaderV3Program in web3.js v3)
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = LoaderV3Program.programId;

export const connection = new Connection(config.rpcUrl, {
  commitment: "confirmed",
  // This does not apply to getAccountInfo, handled by getAccountInfoWithTimeout below
  confirmTransactionInitialTimeout: config.requestTimeoutMs
});

/**
 * Custom timeout wrapper for getAccountInfo (audit finding B-4).
 * Ensures individual read-only RPC requests do not hang the connection indefinitely.
 */
async function getAccountInfoWithTimeout(conn: Connection, key: PublicKey): Promise<AccountInfo<Buffer | Uint8Array> | null> {
  const timeoutMs = config.requestTimeoutMs;
  return Promise.race([
    conn.getAccountInfo(key, "confirmed"),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("RPC_TIMEOUT")), timeoutMs);
      timer.unref(); // Don't hold event loop
    })
  ]);
}

/**
 * Manual 82-byte SPL Token MintLayout decoder.
 * Eliminates the @solana/spl-token dependency, resolving stream-json and uuid CVEs (audit finding H-1/H-2).
 */
export const MintLayout = {
  span: 82,
  decode: (buf: Buffer | Uint8Array) => {
    if (buf.length < 82) throw new Error("Account data too short for MintLayout");
    const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    return {
      mintAuthorityOption: data.readUInt32LE(0),
      mintAuthority: new Uint8Array(data.subarray(4, 36)),
      supply: new Uint8Array(data.subarray(36, 44)),
      decimals: data[44],
      isInitialized: data[45],
      freezeAuthorityOption: data.readUInt32LE(46),
      freezeAuthority: new Uint8Array(data.subarray(50, 82))
    };
  }
};

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
    // observedAt is left blank initially, populated when the analysis genuinely finishes (audit finding B-5)
    observedAt: "",
    result: "findings",
    summary: "Analysis completed. Review each finding and its evidence.",
    findings: [],
    warnings: [
      "This report describes observed on-chain configuration, not confirmed exploitability.",
      "Only supported account types and direct authorities are analyzed in this MVP."
    ]
  };
}

/**
 * Decode a 32-byte public key from a Buffer at the given byte offset.
 */
function decodePubkey(data: Uint8Array, start: number): string {
  if (data.length < start + 32) throw new Error("Account data too short to decode public key");
  return new PublicKey(data.subarray(start, start + 32)).toBase58();
}

export async function analyzeProgram(address: string, preFetchedInfo?: AccountInfo<Buffer | Uint8Array> | null): Promise<AnalysisResponse> {
  const response = baseResponse(address, "program");
  const key = new PublicKey(address);
  // Avoids redundant double-fetch in auto mode (audit finding B-3)
  const info = preFetchedInfo || await getAccountInfoWithTimeout(connection, key);

  if (!info) {
    response.kind = "unknown";
    response.result = "unsupported";
    response.summary = "No account was found for this address on the configured cluster.";
    response.warnings.push("Verify the address and selected cluster.");
    response.observedAt = new Date().toISOString();
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
    response.observedAt = new Date().toISOString();
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
    response.observedAt = new Date().toISOString();
    return response;
  }

  const data = Buffer.isBuffer(info.data) ? info.data : Buffer.from(info.data.buffer, info.data.byteOffset, info.data.byteLength);
  if (data.length < 36 || data.readUInt32LE(0) !== 2) {
    response.result = "unsupported";
    response.summary = "The program account data did not match the expected upgradeable-loader layout.";
    response.warnings.push("No authority conclusion was made because the loader data could not be decoded safely.");
    response.observedAt = new Date().toISOString();
    return response;
  }

  const programDataAddress = decodePubkey(data, 4);
  const programDataInfo = await getAccountInfoWithTimeout(connection, new PublicKey(programDataAddress));

  const pdData = programDataInfo
    ? (Buffer.isBuffer(programDataInfo.data) ? programDataInfo.data : Buffer.from(programDataInfo.data.buffer, programDataInfo.data.byteOffset, programDataInfo.data.byteLength))
    : null;

  if (!pdData || pdData.length < 13 || pdData.readUInt32LE(0) !== 3) {
    response.result = "unsupported";
    response.summary = "The ProgramData account could not be decoded using the expected loader layout.";
    response.warnings.push("No authority conclusion was made because ProgramData evidence was incomplete.");
    response.observedAt = new Date().toISOString();
    return response;
  }

  const deploymentSlot = pdData.readBigUInt64LE(4).toString();
  const optionTag = pdData[12];

  if (optionTag === 0) {
    response.findings.push(finding(
      "PROGRAM_IMMUTABLE", "No upgrade authority recorded", "info", "absent",
      "The ProgramData account records no upgrade authority. This is consistent with an immutable program.",
      "upgradeAuthority=null",
      `ProgramData=${programDataAddress}; deploymentSlot=${deploymentSlot}.`,
      "Keep deployment and source-verification evidence with the release record.",
      programDataAddress
    ));
  } else if (optionTag === 1 && pdData.length >= 45) {
    const authority = decodePubkey(pdData, 13);
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

  response.observedAt = new Date().toISOString();
  return response;
}

export async function analyzeMint(address: string, preFetchedInfo?: AccountInfo<Buffer | Uint8Array> | null): Promise<AnalysisResponse> {
  const response = baseResponse(address, "mint");
  const key = new PublicKey(address);
  // Avoids redundant double-fetch in auto mode (audit finding B-3)
  const info = preFetchedInfo || await getAccountInfoWithTimeout(connection, key);

  if (!info) {
    response.kind = "unknown";
    response.result = "unsupported";
    response.summary = "No account was found for this address on the configured cluster.";
    response.warnings.push("Verify the address and selected cluster.");
    response.observedAt = new Date().toISOString();
    return response;
  }

  const isToken = info.owner.equals(TOKEN_PROGRAM_ID);
  const isToken2022 = info.owner.equals(TOKEN_2022_PROGRAM_ID);

  if (!isToken && !isToken2022) {
    response.kind = "unknown";
    response.result = "unsupported";
    response.summary = "The account is not owned by the classic SPL Token or Token-2022 program.";
    response.warnings.push(`Observed account owner: ${info.owner.toBase58()}`);
    response.observedAt = new Date().toISOString();
    return response;
  }

  // Prevent token accounts (165 bytes) from being silently decoded as mints (82 bytes) (audit finding D-4)
  if (info.data.length === 165) {
    response.kind = "unknown";
    response.result = "unsupported";
    response.summary = "The provided address appears to be a token account, not a mint account.";
    response.warnings.push("Token accounts are not supported by the mint analysis endpoint.");
    response.observedAt = new Date().toISOString();
    return response;
  }

  let decoded;
  try {
    decoded = MintLayout.decode(info.data.subarray(0, MintLayout.span));
  } catch {
    response.kind = "unknown";
    response.result = "unsupported";
    response.summary = "The token account could not be decoded as a supported mint.";
    response.warnings.push("The address data did not match the expected mint layout.");
    response.observedAt = new Date().toISOString();
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

  if (isToken2022) {
    response.warnings.push(
      "This account uses the Token-2022 program. Extensions such as PermanentDelegate, " +
      "TransferHook, DefaultAccountState, InterestBearingConfig, and others are NOT decoded by this MVP. " +
      "The findings below reflect base mint fields (mint authority, freeze authority) only. " +
      "Review on-chain extension data independently before making security judgements."
    );
  }

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

  response.observedAt = new Date().toISOString();
  return response;
}

export async function analyzeAddress(address: string, kind: "auto" | "program" | "mint"): Promise<AnalysisResponse> {
  const key = new PublicKey(address);

  if (kind === "program") return analyzeProgram(key.toBase58());
  if (kind === "mint") return analyzeMint(key.toBase58());

  // Auto-detect branch
  const info = await getAccountInfoWithTimeout(connection, key);
  if (!info) {
    const response = baseResponse(key.toBase58(), "unknown");
    response.result = "unsupported";
    response.summary = "No account was found for this address on the configured cluster.";
    response.observedAt = new Date().toISOString();
    return response;
  }

  if (info.executable) return analyzeProgram(key.toBase58(), info);
  if (info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return analyzeMint(key.toBase58(), info);
  }

  const response = baseResponse(key.toBase58(), "unknown");
  response.result = "unsupported";
  response.summary = "This account type is not supported by the current MVP.";
  response.warnings.push(`Observed account owner: ${info.owner.toBase58()}`);
  response.observedAt = new Date().toISOString();
  return response;
}
