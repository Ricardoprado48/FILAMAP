import { FirstStep } from "../utils/firstSteps";

// Lista "Primeiros passos" (aba AMS) até a primeira impressão descontada.

export function FirstStepsPanel({
  steps,
  onOpenComputers,
  onNewSpool,
  onHide,
}: {
  steps: FirstStep[];
  onOpenComputers: () => void;
  onNewSpool: () => void;
  onHide: () => void;
}) {
  const next = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <div style={{ background: "#1e293b", border: "1px solid #0284c7", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <strong style={{ color: "#f8fafc", fontSize: 15 }}>🚀 Primeiros passos · {doneCount} de {steps.length}</strong>
        <button onClick={onHide} style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>
          Esconder
        </button>
      </div>
      <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((s) => {
          const isNext = next?.id === s.id;
          return (
            <li key={s.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", opacity: s.done ? 0.65 : 1 }}>
              <span style={{ fontSize: 16, lineHeight: "20px" }}>{s.done ? "✅" : isNext ? "👉" : "⬜"}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#f8fafc", fontWeight: isNext ? 800 : 600, fontSize: 13, textDecoration: s.done ? "line-through" : "none" }}>{s.title}</div>
                {isNext && (
                  <div style={{ color: "#cbd5e1", fontSize: 12, marginTop: 2 }}>
                    {s.hint}
                    {(s.id === "agent" || s.id === "printer") && (
                      <button onClick={onOpenComputers} style={{ marginLeft: 8, background: "#2563eb", color: "#fff", border: "none", padding: "4px 9px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        💻 Computadores
                      </button>
                    )}
                    {s.id === "spools" && (
                      <button onClick={onNewSpool} style={{ marginLeft: 8, background: "#059669", color: "#fff", border: "none", padding: "4px 9px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        ➕ Novo Carretel
                      </button>
                    )}
                    {s.id === "printer" && (
                      <div style={{ marginTop: 4 }}>
                        Onde achar o Access Code: <a href="/guia#access-code" target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>passo a passo por modelo</a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
