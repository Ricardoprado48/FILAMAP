import React from "react";
import type { Spool } from "../types";
import { POPULAR_BRANDS } from "../constants";

interface EditSpoolModalProps {
  spool: Spool;
  brand: string;
  setBrand: (v: string) => void;
  material: string;
  setMaterial: (v: string) => void;
  colorName: string;
  setColorName: (v: string) => void;
  colorHex: string;
  setColorHex: (v: string) => void;
  tare: string;
  setTare: (v: string) => void;
  weight: string;
  setWeight: (v: string) => void;
  onWriteTag: () => void;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export function EditSpoolModal({
  spool, brand, setBrand, material, setMaterial, colorName, setColorName,
  colorHex, setColorHex, tare, setTare, weight, setWeight, onWriteTag, onCancel, onSubmit,
}: EditSpoolModalProps) {
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 12, padding: 20, maxWidth: 380, width: "100%" }}>
        <h3 style={{ margin: "0 0 10px", color: "#fff" }}>✏️ Editar Carretel</h3>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8" }}>Marca</label>
              <select value={brand} onChange={(e) => setBrand(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}>
                {POPULAR_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8" }}>Material</label>
              <select value={material} onChange={(e) => setMaterial(e.target.value)} style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }}>
                <option value="PETG">PETG</option>
                <option value="PLA">PLA</option>
                <option value="ABS">ABS</option>
                <option value="TPU">TPU</option>
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8" }}>Cor</label>
              <input type="text" value={colorName} onChange={(e) => setColorName(e.target.value)} placeholder="Cor" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8" }}>Tom</label>
              <input type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} style={{ width: "100%", height: 34, padding: 2, background: "#0f172a", border: "1px solid #334155", borderRadius: 6 }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8" }}>Tara (g)</label>
              <input type="number" value={tare} onChange={(e) => setTare(e.target.value)} placeholder="Tara" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#94a3b8" }}>Saldo (g)</label>
              <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Saldo em gramas" style={{ width: "100%", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} required />
            </div>
          </div>
          {!spool.nfc_uid && (
            <button
              type="button"
              onClick={onWriteTag}
              style={{ padding: 8, background: "#0f172a", color: "#38bdf8", border: "1px solid #38bdf8", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}
            >
              🏷️ Gravar tag deste carretel
            </button>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onCancel} style={{ flex: 1, padding: 8, background: "#334155", color: "#fff", border: "none", borderRadius: 6 }}>Cancelar</button>
            <button type="submit" style={{ flex: 1, padding: 8, background: "#0284c7", color: "#fff", border: "none", borderRadius: 6 }}>Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
