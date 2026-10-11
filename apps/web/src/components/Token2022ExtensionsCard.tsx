import { Layers, ShieldAlert, CheckCircle, Info } from "lucide-react";
import type { Token2022Extension } from "../types";

const short = (val: string) => (val.length > 20 ? `${val.slice(0, 6)}...${val.slice(-4)}` : val);

export function Token2022ExtensionsCard({ extensions }: { extensions?: Token2022Extension[] }) {
  if (!extensions || extensions.length === 0) return null;

  return (
    <div className="ag-extensions-card">
      <div className="sc-section-title">
        <span>TOKEN-2022 EXTENSIONS</span>
        <span>{extensions.length} detected</span>
      </div>

      <div className="ag-extensions-grid">
        {extensions.map(ext => {
          const isCritical = ext.typeCode === 13 || ext.name === "PermanentDelegate";
          const isFee = ext.typeCode === 1 || ext.name === "TransferFeeConfig";
          const isHook = ext.typeCode === 14 || ext.name === "TransferHook";

          return (
            <div key={ext.typeCode} className={`ag-ext-item ${isCritical ? "critical-ext" : ""}`}>
              <div className="ag-ext-head">
                <div className="ag-ext-icon">
                  {isCritical ? (
                    <ShieldAlert size={16} className="text-red" />
                  ) : (
                    <Layers size={16} className="text-accent" />
                  )}
                </div>
                <div>
                  <strong>{ext.name}</strong>
                  <span className="sc-mono sc-muted" style={{ fontSize: "11px", marginLeft: "6px" }}>
                    #{ext.typeCode}
                  </span>
                </div>
                <span className={`pill pill-${ext.parseStatus === "parsed" ? "info" : "low"}`}>
                  {ext.parseStatus.toUpperCase()}
                </span>
              </div>

              {ext.authority && (
                <div className="ag-ext-auth">
                  <span className="sc-muted">Authority: </span>
                  <code className="sc-mono">{short(ext.authority)}</code>
                </div>
              )}

              {ext.fields && Object.keys(ext.fields).length > 0 && (
                <div className="ag-ext-fields">
                  {Object.entries(ext.fields).map(([k, v]) => (
                    <div key={k} className="ag-ext-field-row">
                      <span className="sc-muted">{k}:</span>
                      <span className="sc-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="ag-ext-desc">
                {isCritical && "High Privilege: Delegate can unilaterally transfer or burn tokens from any holder account without their signature."}
                {isFee && "Transfer Fee: Deducts a percentage fee on every transfer, redirected to fee authority."}
                {isHook && "Transfer Hook: Invokes an external program before completing transfers, creating a potential freeze or interception vector."}
                {!isCritical && !isFee && !isHook && `Extension #${ext.typeCode} parsed according to SPL Token-2022 TLV specification.`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
