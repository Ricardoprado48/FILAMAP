import React from "react";
import type { Spool } from "../types";

interface WeighSpoolModalProps {
  spool: Spool;
  grossWeight: string;
  setGrossWeight: (v: string) => void;
  tareWeight: string;
  setTareWeight: (v: string) => void;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function WeighSpoolModal({ spool, grossWeight, setGrossWeight, tareWeight, setTareWeight, onCancel, onSubmit }: WeighSpoolModalProps) {
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 12, padding: 20, maxWidth: 380, width: "100%" }}>
        <h3 style={{ margin: "0 0 10px", color: "#fff" }}>⚖️ Re-pesar {spool.color_name}</h3>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="number" value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} placeholder="Peso na balança (g)" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
          <input type="number" value={tareWeight} onChange={(e) => setTareWeight(e.target.value)} placeholder="Tara (g)" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: 8, background: "#334155", color: "#fff", border: "none", borderRadius: 6 }}>Cancelar</button>
            <button type="submit" style={{ flex: 1, padding: 8, background: "#0284c7", color: "#fff", border: "none", borderRadius: 6 }}>Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
