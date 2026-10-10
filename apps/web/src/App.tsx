import { FormEvent, useState } from "react";
import { Activity, ArrowUpRight, BadgeCheck, CircleAlert, FileSearch, GitBranch, LoaderCircle, Shield, ShieldAlert } from "lucide-react";
import type { AnalysisResponse, Severity } from "./types";

const short = (value: string) => value.length > 20 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;

function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`pill pill-${severity}`}>{severity.toUpperCase()}</span>;
}

export default function App() {
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
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="AuthorityGraph home">
          <span className="brand-mark"><GitBranch size={20} /></span>
          <span>authority<span className="brand-light">graph</span></span>
        </a>
        <div className="top-status"><span className="status-dot" /> READ-ONLY ANALYSIS</div>
      </header>

      <section className="hero">
        <div className="eyebrow"><Shield size={14} /> SOLANA SECURITY POSTURE</div>
        <h1>Know who controls<br /><span>your protocol.</span></h1>
        <p className="hero-copy">Map privileged on-chain permissions. Understand the evidence. Find the controls your team should review.</p>
      </section>

      <section className="search-panel">
        <form onSubmit={submit}>
          <label htmlFor="address">PROGRAM ID OR TOKEN MINT</label>
          <div className="search-row">
            <input id="address" value={address} onChange={e => setAddress(e.target.value)} placeholder="Enter a Solana address…" minLength={32} maxLength={44} required />
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
          <div className="form-note"><span>◎</span> Public on-chain data only. No wallet connection or transaction signing.</div>
        </form>
      </section>

      {error && <div className="error-banner"><CircleAlert size={18} /> {error}</div>}

      {report && (
        <section className="report">
          <div className="report-heading">
            <div>
              <div className="eyebrow">ANALYSIS REPORT</div>
              <h2>{report.kind === "program" ? "Program authority" : report.kind === "mint" ? "Token permissions" : "Account analysis"}</h2>
              <p className="muted mono">{short(report.address)} · {report.cluster} · {new Date(report.observedAt).toLocaleString()}</p>
            </div>
            <span className={`result-badge ${report.result}`}><Activity size={15} /> {report.result.replace("_", " ").toUpperCase()}</span>
          </div>
          <p className="report-summary">{report.summary}</p>
          <div className="metric-grid">
            <div className="metric"><span>FINDINGS</span><strong>{report.findings.length}</strong><small>Evidence-backed checks</small></div>
            <div className="metric"><span>ACTIVE CONTROLS</span><strong>{activeCount}</strong><small>Direct authorities observed</small></div>
            <div className="metric"><span>ACCOUNT TYPE</span><strong className="type-value">{report.kind.toUpperCase()}</strong><small>Detected from account data</small></div>
          </div>

          <div className="section-title"><span>01 / FINDINGS</span><span>{report.findings.length} checks</span></div>
          {report.findings.length === 0 && <div className="empty-state">No findings were produced for this account. Check the warnings and supported account types.</div>}
          <div className="finding-list">
            {report.findings.map(item => (
              <article className="finding-card" key={item.id}>
                <div className="finding-icon"><ShieldAlert size={19} /></div>
                <div className="finding-content">
                  <div className="finding-title-row"><h3>{item.title}</h3><SeverityPill severity={item.severity} /></div>
                  <p>{item.summary}</p>
                  <div className="evidence">
                    <div className="evidence-label"><BadgeCheck size={14} /> OBSERVED EVIDENCE</div>
                    <code>{item.evidence.map(e => e.observedValue).join(" · ")}</code>
                    {item.evidence.map((e, i) => <small key={i}>{e.detail}{e.accountAddress ? ` Account: ${e.accountAddress}` : ""}</small>)}
                  </div>
                  <div className="recommendation"><ArrowUpRight size={15} /><span><strong>Recommended review</strong><br />{item.recommendation}</span></div>
                  {item.limitations?.map(text => <p className="limitation" key={text}>Limitation: {text}</p>)}
                </div>
              </article>
            ))}
          </div>

          {report.warnings.length > 0 && <div className="warnings"><strong>Important limitations</strong>{report.warnings.map(w => <p key={w}>• {w}</p>)}</div>}
          <div className="report-footer">Analysis is a point-in-time observation. Verify important findings independently before making security decisions.</div>
        </section>
      )}

      {!report && !loading && (
        <section className="below-fold">
          <div className="section-title"><span>WHAT WE CHECK</span><span>INITIAL MVP</span></div>
          <div className="feature-grid">
            <div className="feature"><div className="feature-icon"><ShieldAlert size={19} /></div><h3>Upgrade authority</h3><p>Identify the direct authority recorded for supported upgradeable programs.</p><span>PROGRAMS</span></div>
            <div className="feature"><div className="feature-icon"><Activity size={19} /></div><h3>Token permissions</h3><p>Inspect active mint and freeze authorities on supported SPL token mints.</p><span>SPL TOKEN + TOKEN-2022</span></div>
            <div className="feature"><div className="feature-icon"><GitBranch size={19} /></div><h3>Evidence first</h3><p>Every supported finding explains the observed value and its limitations.</p><span>TRANSPARENT RESULTS</span></div>
          </div>
          <div className="notice"><CircleAlert size={17} /><p><strong>Not an audit.</strong> An active authority is not automatically a vulnerability. AuthorityGraph reports observed configuration and suggested review steps.</p></div>
        </section>
      )}

      <footer><span>AUTHORITYGRAPH <span className="muted">/ HACKATHON MVP</span></span><span>Built for a safer Solana ecosystem</span></footer>
    </main>
  );
}
