import { useState, useEffect } from "react";
import { History, Clock, ArrowRight, ShieldAlert, Check, RefreshCw } from "lucide-react";
import type { ChangeEvent } from "../types";

const short = (val: string | number | null) => {
  if (val === null || val === undefined) return "null";
  const s = String(val);
  return s.length > 16 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
};

export function HistoryTimelineCard({ address }: { address: string }) {
  const [loading, setLoading] = useState(false);
  const [historyData, setHistoryData] = useState<{
    count: number;
    hasHistory: boolean;
    allChanges: ChangeEvent[];
  } | null>(null);

  async function fetchHistory() {
    if (!address) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/snapshots/${address}/history`);
      if (res.ok) {
        const json = await res.json();
        setHistoryData(json);
      }
    } catch {
      // Ignore network errors on background fetch
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHistory();
  }, [address]);

  if (!historyData || historyData.count === 0) return null;

  return (
    <div className="ag-history-card">
      <div className="ag-history-head">
        <div className="sc-eyebrow">
          <History size={13} /> HISTORICAL AUDIT & CONFIGURATION DRIFT
        </div>
        <div className="ag-history-meta sc-mono">
          <span>{historyData.count} point-in-time snapshot(s)</span>
          <button
            type="button"
            className="ag-refresh-btn"
            onClick={fetchHistory}
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {historyData.allChanges.length > 0 ? (
        <div className="ag-changes-timeline">
          <div className="sc-section-title" style={{ margin: "10px 0" }}>
            <span>CONFIG DRIFT DETECTED</span>
            <span>{historyData.allChanges.length} change event(s)</span>
          </div>

          {historyData.allChanges.map((change, i) => (
            <div key={i} className={`ag-change-item change-${change.severity}`}>
              <div className="ag-change-icon">
                <ShieldAlert size={15} />
              </div>
              <div className="ag-change-body">
                <div className="ag-change-top">
                  <strong>{change.type.replace(/_/g, " ")}</strong>
                  <span className={`pill pill-${change.severity}`}>
                    {change.severity.toUpperCase()}
                  </span>
                  <span className="sc-mono sc-muted" style={{ fontSize: "11px", marginLeft: "auto" }}>
                    <Clock size={11} style={{ verticalAlign: "middle", marginRight: "3px" }} />
                    {new Date(change.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="ag-change-desc">{change.description}</p>
                <div className="ag-change-diff sc-mono">
                  <span className="diff-old">{short(change.previousValue)}</span>
                  <ArrowRight size={13} className="diff-arrow" />
                  <span className="diff-new">{short(change.currentValue)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ag-no-drift">
          <Check size={16} className="text-green" />
          <span>
            No configuration drift observed across {historyData.count} observation(s). On-chain authorities remain identical to prior snapshots.
          </span>
        </div>
      )}
    </div>
  );
}
