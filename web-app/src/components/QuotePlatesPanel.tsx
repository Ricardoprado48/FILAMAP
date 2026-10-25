import { useRef, useState } from "react";
import { readSlicedPlateFile } from "../utils/slicedPlate";
import { formatDuration, summarizeQuote, type QuotePlate } from "../utils/quotePlates";

interface Props {
  plates: QuotePlate[];
  onPlatesChange: (plates: QuotePlate[]) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
}

const box = { background: "#0f172a", border: "1px solid #334155", borderRadius: 8 } as const;
const input = { padding: 6, background: "#1e293b", border: "1px solid #475569", borderRadius: 4, color: "#fff", fontSize: 12, boxSizing: "border-box" as const };

function plateName(file: string, index: number, total: number): string {
  const base = file.replace(/\.gcode\.3mf$/i, "").replace(/\.3mf$/i, "");
  return total > 1 ? `${base} – placa ${index}` : base;
}

export function QuotePlatesPanel({ plates, onPlatesChange, notes, onNotesChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const summary = summarizeQuote(plates);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setLoading(true);
    const added: QuotePlate[] = [];
    try {
      for (const file of Array.from(files)) {
        const sliced = await readSlicedPlateFile(await file.arrayBuffer());
        for (const p of sliced) {
          added.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: plateName(file.name, p.index, sliced.length),
            seconds: p.seconds,
            filaments: p.filaments,
            units: 1,
            notes: p.objects.length ? `Peças: ${p.objects.join(", ")}` : "",
            ...(p.thumbnail ? { thumbnail: p.thumbnail } : {}),
          });
        }
      }
      onPlatesChange([...plates, ...added]);
    } catch (e: any) {
      setError(e?.message || String(e));
      if (added.length) onPlatesChange([...plates, ...added]);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function update(id: string, patch: Partial<QuotePlate>) {
    onPlatesChange(plates.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  return (
    <div style={{ background: "#1e293b", padding: 14, borderRadius: 12, border: "1px solid #334155", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13, color: "#f8fafc" }}>📐 PLACAS DO ORÇAMENTO</strong>
        <button
          type="button"
          disabled={loading}
          onClick={() => fileRef.current?.click()}
          style={{ background: "#0284c7", color: "#fff", border: "none", padding: "7px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          {loading ? "Lendo..." : "➕ Importar placa fatiada"}
        </button>
        <input ref={fileRef} type="file" accept=".3mf" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {plates.length === 0 && (
        <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
          No Bambu Studio, fatie a placa e use <b>Arquivo › Exportar › Exportar placa fatiada</b> (.gcode.3mf). Importe uma por uma (ou várias de uma vez) e diga quantas unidades do produto cada placa atende: 4 copos numa placa = 4; as tampas de 6 produtos = 6.
          Tempo e gramas por cor vão direto para o cálculo abaixo.
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: "#fca5a5", background: "rgba(239,68,68,0.12)", padding: 8, borderRadius: 6 }}>{error}</div>}

      {plates.map((p) => {
        const grams = p.filaments.reduce((s, f) => s + f.grams, 0);
        return (
          <div key={p.id} style={{ ...box, padding: 10, display: "flex", gap: 10, alignItems: "flex-start" }}>
            {p.thumbnail ? (
              <img src={p.thumbnail} alt="" style={{ width: 56, height: 56, objectFit: "contain", background: "#1e293b", borderRadius: 6, flexShrink: 0 }} />
            ) : (
              <div style={{ width: 56, height: 56, background: "#1e293b", borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🧩</div>
            )}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} style={{ ...input, flex: 1, minWidth: 0, fontWeight: 700 }} />
                <button type="button" title="Tirar placa" onClick={() => onPlatesChange(plates.filter((x) => x.id !== p.id))} style={{ background: "transparent", border: "1px solid #475569", color: "#94a3b8", borderRadius: 4, cursor: "pointer", padding: "0 8px" }}>
                  ✕
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#cbd5e1", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span>⏱ {formatDuration(p.seconds)}</span>
                <span>⚖️ {grams.toFixed(1)} g</span>
                {p.filaments.map((f) => (
                  <span key={`${f.id}-${f.color}`} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: f.color || "#888", border: "1px solid #64748b" }} />
                    {f.grams.toFixed(1)} g
                  </span>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 120px) minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
                <label style={{ fontSize: 11, color: "#94a3b8", display: "flex", flexDirection: "column", gap: 2 }}>
                  Atende quantas unidades
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    value={p.units}
                    onChange={(e) => update(p.id, { units: parseFloat(e.target.value) || 0 })}
                    style={{ ...input, width: "100%", color: "#38bdf8", fontWeight: 700, textAlign: "center" }}
                  />
                </label>
                <label style={{ fontSize: 11, color: "#94a3b8", display: "flex", flexDirection: "column", gap: 2 }}>
                  Observação da placa
                  <input value={p.notes} onChange={(e) => update(p.id, { notes: e.target.value })} placeholder="ex.: clone da original, por objeto" style={{ ...input, width: "100%" }} />
                </label>
              </div>
            </div>
          </div>
        );
      })}

      {plates.length > 0 && (
        <div style={{ ...box, padding: 10, fontSize: 12, color: "#e2e8f0", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <strong style={{ color: "#38bdf8" }}>Por unidade:</strong>
          <span>⏱ {formatDuration(summary.secondsPerUnit)}</span>
          <span>⚖️ {summary.gramsPerUnit.toFixed(1)} g</span>
          {summary.filaments.map((l) => (
            <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: l.color || "#888", border: "1px solid #64748b" }} />
              {l.gramsPerUnit.toFixed(1)} g
            </span>
          ))}
        </div>
      )}

      <label style={{ fontSize: 11, color: "#94a3b8", display: "flex", flexDirection: "column", gap: 4 }}>
        Observações do produto
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          placeholder="Como montar as placas, o que vai em cada uma, acabamento, embalagem..."
          style={{ ...input, width: "100%", padding: 8, resize: "vertical", fontFamily: "inherit" }}
        />
      </label>
    </div>
  );
}
