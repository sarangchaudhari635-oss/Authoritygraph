import { FormEvent, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  CircleAlert,
  FileSearch,
  GitBranch,
  LoaderCircle,
  Shield,
  ShieldAlert,
  Sparkles,
  AlertTriangle,
  AlertCircle,
  Info,
  HelpCircle,
  Users,
  Key,
  Layers,
  History,
  ShieldCheck
} from "lucide-react";
import type { AnalysisResponse, Severity, Finding } from "./types";
import { LiquidGlass } from "./components/LiquidGlass";
import { AuthorityGraphView } from "./components/AuthorityGraphView";
import { PolicyEvaluationCard } from "./components/PolicyEvaluationCard";
import { Token2022ExtensionsCard } from "./components/Token2022ExtensionsCard";
import { HistoryTimelineCard } from "./components/HistoryTimelineCard";
import "./styles.css";

const short = (value: string) =>
  value.length > 20 ? `${value.slice(0, 9)}...${value.slice(-7)}` : value;

function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`pill pill-${severity}`}>{severity.toUpperCase()}</span>;
}

function SeverityIcon({ severity }: { severity: Severity }) {
  switch (severity) {
    case "critical":
      return <ShieldAlert size={19} className="text-red" />;
    case "high":
      return <AlertTriangle size={19} className="text-amber" />;
    case "medium":
      return <AlertCircle size={19} className="text-yellow" />;
    case "low":
      return <Info size={19} className="text-blue" />;
    case "info":
      return <BadgeCheck size={19} className="text-green" />;
    case "unknown":
    default:
      return <HelpCircle size={19} className="text-muted" />;
  }
}

export default function App() {
  const [view, setView] = useState<"home" | "scanner">("home");
  const [address, setAddress] = useState("");
  const [kind, setKind] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<AnalysisResponse | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setReport(null);
    setLoading(true);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim(), kind })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Analysis failed.");
      setReport(data as AnalysisResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete analysis.");
    } finally {
      setLoading(false);
    }
  }

  const activeCount = report?.findings.filter(f => f.status === "present").length ?? 0;

  return (
    <>
      {/* Always-on animated glass background */}
      <LiquidGlass />

      {/* Persistent top nav */}
      <header className="app-topbar">
        <a className="app-brand" href="/" onClick={e => { e.preventDefault(); setView("home"); }}>
          <span className="app-brand-icon"><GitBranch size={14} /></span>
          authority<span className="app-brand-accent">graph</span>
        </a>
        <nav className="app-nav">
          <button type="button" className={`app-nav-btn${view === "home" ? " active" : ""}`} onClick={() => setView("home")}>
            <Sparkles size={13} /> Home
          </button>
          <button type="button" className={`app-nav-btn${view === "scanner" ? " active" : ""}`} onClick={() => setView("scanner")}>
            <Shield size={13} /> Security Protocols
          </button>
        </nav>
        <div className="app-status"><span className="app-status-dot" /> READ-ONLY</div>
      </header>

      {/* Home view */}
      {view === "home" && (
        <div className="app-page home-page">
          <div className="lg-hero-overlay">
            <div className="lg-hero-card">
              <div className="lg-hero-eyebrow">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                SOLANA SECURITY INTELLIGENCE
              </div>
              <h1 className="lg-hero-title">
                Know who controls<br />
                <span className="lg-hero-accent">your protocol.</span>
              </h1>
              <p className="lg-hero-desc">
                Map privileged on-chain permissions, Token-2022 extensions, and Squads multisig configurations.
                Verify security policies and track administrative drift with evidence.
              </p>
              <div className="lg-hero-features">
                <div className="lg-hero-feat"><span className="lg-feat-dot" /> Directed authority control graph</div>
                <div className="lg-hero-feat"><span className="lg-feat-dot" /> Token-2022 extension TLV analysis</div>
                <div className="lg-hero-feat"><span className="lg-feat-dot" /> Squads multisig threshold verification</div>
                <div className="lg-hero-feat"><span className="lg-feat-dot" /> Historical drift & configuration timeline</div>
              </div>
              <button type="button" className="lg-hero-cta" onClick={() => setView("scanner")}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Launch Security Protocols
              </button>
              <p className="lg-hero-note">Public on-chain data only — deterministic and read-only</p>
            </div>
          </div>
        </div>
      )}

      {/* Scanner view */}
      {view === "scanner" && (
        <div className="app-page scanner-page">
          <div className="scanner-scroll">
            <div className="scanner-shell">
              <section className="sc-hero">
                <div className="sc-eyebrow"><Shield size={13} /> SOLANA ADMINISTRATIVE CONTROL POSTURE</div>
                <h1>Know who controls<br /><span>your protocol.</span></h1>
                <p className="sc-hero-copy">
                  Map privileged on-chain permissions. Understand the evidence. Find the controls your team should review.
                </p>
              </section>

              <section className="sc-panel">
                <form onSubmit={submit}>
                  <label htmlFor="address" className="sc-label">PROGRAM ID OR TOKEN MINT</label>
                  <div className="sc-row">
                    <input
                      id="address"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      placeholder="Enter a Solana program ID or token mint address..."
                      minLength={32}
                      maxLength={44}
                      required
                    />
                    <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Analysis type">
                      <option value="auto">Auto detect</option>
                      <option value="program">Program</option>
                      <option value="mint">Token mint</option>
                    </select>
                    <button type="submit" disabled={loading}>
                      {loading ? <LoaderCircle className="spin" size={17} /> : <FileSearch size={17} />}
                      {loading ? "Analyzing" : "Analyze"}
                    </button>
                  </div>
                  <div className="sc-presets">
                    <span className="sc-presets-label">Quick samples:</span>
                    <button type="button" className="sc-preset-pill" onClick={() => { setAddress("MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD"); setKind("program"); }}>
                      Marinade Program
                    </button>
                    <button type="button" className="sc-preset-pill" onClick={() => { setAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); setKind("mint"); }}>
                      USDC Mint
                    </button>
                    <button type="button" className="sc-preset-pill" onClick={() => { setAddress("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"); setKind("program"); }}>
                      Token Program
                    </button>
                    <button type="button" className="sc-preset-pill" onClick={() => { setAddress("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"); setKind("auto"); }}>
                      Keypair Wallet
                    </button>
                  </div>
                  <div className="sc-note"><span>*</span> Public on-chain data only. No wallet connection or transaction signing.</div>
                </form>
              </section>

              {error && <div className="sc-error"><CircleAlert size={18} /> {error}</div>}

              {report && (
                <section className="sc-report">
                  <div className="sc-report-head">
                    <div>
                      <div className="sc-eyebrow">ADMINISTRATIVE POSTURE REPORT</div>
                      <h2>{report.kind === "program" ? "Program Upgrade Authority" : report.kind === "mint" ? "Token Permission Posture" : "Account Security Analysis"}</h2>
                      <p className="sc-muted sc-mono">{short(report.address)} · {report.cluster} · {new Date(report.observedAt).toLocaleString()}</p>
                    </div>
                    <span className={`sc-badge ${report.result}`}><Activity size={14} /> {report.result.replace("_", " ").toUpperCase()}</span>
                  </div>

                  <p className="sc-summary">{report.summary}</p>

                  <div className="sc-metrics">
                    <div className="sc-metric"><span>FINDINGS</span><strong>{report.findings.length}</strong><small>Evidence-backed checks</small></div>
                    <div className="sc-metric"><span>ACTIVE CONTROLS</span><strong>{activeCount}</strong><small>Direct authorities observed</small></div>
                    <div className="sc-metric"><span>ACCOUNT TYPE</span><strong className="type-val">{report.kind.toUpperCase()}</strong><small>Detected from account data</small></div>
                  </div>

                  {/* Feature One: Directed Authority Control Graph */}
                  <AuthorityGraphView graph={report.graph} />

                  {/* Feature Five: Security Policy and Configuration Drift */}
                  <PolicyEvaluationCard policy={report.policy} />

                  {/* Feature Three: Token-2022 Extensions */}
                  <Token2022ExtensionsCard extensions={report.extensions} />

                  {/* Feature Four: Historical Snapshots and Change Events */}
                  <HistoryTimelineCard address={report.address} />

                  {/* Findings Breakdown */}
                  <div className="sc-section-title">
                    <span>FINDINGS & EVIDENCE</span>
                    <span>{report.findings.length} checks</span>
                  </div>

                  {report.findings.length === 0 && (
                    <div className="sc-empty">No findings were produced for this account.</div>
                  )}

                  <div className="sc-findings">
                    {report.findings.map(item => (
                      <article className="sc-finding" key={item.id}>
                        <div className="sc-finding-icon">
                          <SeverityIcon severity={item.severity} />
                        </div>
                        <div className="sc-finding-body">
                          <div className="sc-finding-title-row">
                            <h3>{item.title}</h3>
                            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                              {item.authorityType && (
                                <span className={`pill pill-auth-${item.authorityType}`} style={{ fontSize: "10px" }}>
                                  {item.authorityType === "squads-multisig" ? "SQUADS MULTISIG" : item.authorityType === "direct-key" ? "DIRECT KEY" : item.authorityType.toUpperCase()}
                                </span>
                              )}
                              <SeverityPill severity={item.severity} />
                            </div>
                          </div>

                          <p>{item.summary}</p>

                          <div className="sc-evidence">
                            <div className="sc-evidence-label"><BadgeCheck size={13} /> OBSERVED EVIDENCE</div>
                            <code>{item.evidence.map(e => e.observedValue).join(" · ")}</code>
                            {item.evidence.map((e, i) => (
                              <small key={i}>{e.detail}{e.accountAddress ? ` Account: ${e.accountAddress}` : ""}</small>
                            ))}
                          </div>

                          <div className="sc-rec">
                            <ArrowUpRight size={14} />
                            <span><strong>Recommended review</strong><br />{item.recommendation}</span>
                          </div>

                          {item.limitations?.map(text => (
                            <p className="sc-limit" key={text}>Limitation: {text}</p>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>

                  {report.warnings.length > 0 && (
                    <div className="sc-warnings">
                      <strong>Important limitations & scope</strong>
                      {report.warnings.map(w => <p key={w}>* {w}</p>)}
                    </div>
                  )}

                  <div className="sc-report-footer">
                    Analysis is a point-in-time observation based on public Solana on-chain data. Verify important findings independently before making security decisions.
                  </div>
                </section>
              )}

              {!report && !loading && (
                <section className="sc-features-section">
                  <div className="sc-section-title"><span>COMPREHENSIVE CAPABILITIES</span><span>INTELLIGENCE ENGINE</span></div>
                  <div className="sc-features">
                    <div className="sc-feature">
                      <div className="sc-feat-icon"><GitBranch size={19} /></div>
                      <h3>Authority Control Graph</h3>
                      <p>Visual directed graph mapping program upgrade authorities, token mint/freeze roles, and controlling accounts.</p>
                      <span>DIRECTED GRAPH</span>
                    </div>
                    <div className="sc-feature">
                      <div className="sc-feat-icon"><Layers size={19} /></div>
                      <h3>Token-2022 Extensions</h3>
                      <p>Full TLV decoding for PermanentDelegate, TransferHook, TransferFee, DefaultAccountState, and MintCloseAuthority.</p>
                      <span>EXTENSIONS ANALYZER</span>
                    </div>
                    <div className="sc-feature">
                      <div className="sc-feat-icon"><Users size={19} /></div>
                      <h3>Squads Multisig Adapter</h3>
                      <p>Detects Squads v3 & v4 multisigs on-chain, validates approval threshold, signer counts, and configuration risks.</p>
                      <span>MULTISIG AUDIT</span>
                    </div>
                    <div className="sc-feature">
                      <div className="sc-feat-icon"><ShieldCheck size={19} /></div>
                      <h3>Security Policy Engine</h3>
                      <p>Automated verification against immutability, freeze revocation, and multisig threshold policies with PASS/FAIL/UNKNOWN states.</p>
                      <span>POLICY & DRIFT</span>
                    </div>
                    <div className="sc-feature">
                      <div className="sc-feat-icon"><History size={19} /></div>
                      <h3>Historical Snapshots</h3>
                      <p>Persistent observations and deterministic change events to monitor authority handover and configuration drift.</p>
                      <span>CHANGE MONITORING</span>
                    </div>
                    <div className="sc-feature">
                      <div className="sc-feat-icon"><BadgeCheck size={19} /></div>
                      <h3>Traceable Evidence</h3>
                      <p>Every finding links directly to raw account data, deployment slot, and observed layout fields.</p>
                      <span>ZERO GUESSWORK</span>
                    </div>
                  </div>
                  <div className="sc-notice">
                    <CircleAlert size={17} />
                    <p>
                      <strong>Read-only analysis.</strong> AuthorityGraph does not request wallet signatures, move funds, or submit transactions.
                    </p>
                  </div>
                </section>
              )}

              <footer className="sc-footer">
                <span>AUTHORITYGRAPH <span className="sc-muted">/ SOLANA SECURITY INTELLIGENCE</span></span>
                <span>Deterministic administrative security posture analyzer</span>
              </footer>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
