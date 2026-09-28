import { useMemo, useState } from "react";
import type { Spool } from "../types";
import { buildSlotPickerOptions } from "../utils/slotPicker";
import { getSpoolDisplayName, getSpoolSwatchColor } from "../utils/inventory";

// Escolher o carretel de um slot do AMS pela lista do estoque (sem tag NFC).

export function SlotSpoolPicker({
  slotIndex,
  inventory,
  activeSlots,
  saving,
  onPick,
  onClose,
}: {
  slotIndex: number;
  inventory: Spool[];
  activeSlots: Record<number, Spool | null>;
  saving: boolean;
  onPick: (spool: Spool) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(
    () => buildSlotPickerOptions(inventory, activeSlots, slotIndex, query),
    [inventory, activeSlots, slotIndex, query]
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Escolher carretel do slot ${slotIndex + 1}`}
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(2, 6, 23, 0.75)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50, padding: 12 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, width: "100%", maxWidth: 520, maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 16 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong style={{ color: "#f8fafc", fontSize: 15 }}>Qual carretel está no slot {slotIndex + 1}?</strong>
          <button onClick={onClose} aria-label="Fechar" style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar: cor, marca ou material (ex.: petg branco)"
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: "1px solid #334155", background: "#0f172a", color: "#f8fafc", fontSize: 14, marginBottom: 10 }}
        />

        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {options.length === 0 && (
            <div style={{ color: "#94a3b8", fontSize: 13, padding: 12, textAlign: "center" }}>Nenhum carretel encontrado.</div>
          )}
          {options.map(({ spool, inOtherSlot }) => (
            <button
              key={spool.id}
              disabled={saving}
              onClick={() => onPick(spool)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", cursor: saving ? "wait" : "pointer", color: "#f8fafc" }}
            >
              <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: "50%", backgroundColor: getSpoolSwatchColor(spool), border: "1px solid rgba(255,255,255,0.25)" }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 700, fontSize: 14, overflowWrap: "anywhere" }}>{getSpoolDisplayName(spool)}</span>
                <span style={{ display: "block", fontSize: 12, color: "#94a3b8" }}>
                  {spool.material} · {spool.current_weight}g
                  {inOtherSlot !== null ? ` · hoje no slot ${inOtherSlot + 1} (será movido)` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
