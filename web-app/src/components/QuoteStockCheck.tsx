import { checkStock, STOCK_TIGHT_G, type MatchableSpool, type QuoteFilamentLine } from "../utils/quotePlates";

interface Props {
  // O que a calculadora vai gastar, por cor e material (stockNeedsFromRows).
  needs: QuoteFilamentLine[];
  spools: MatchableSpool[];
  spoolName: (id: string) => string;
}

const STATUS = {
  ok: { icon: "✅", label: "Tem", color: "#34d399" },
  tight: { icon: "⚖️", label: "Repese para conferir", color: "#fcd34d" },
  buy: { icon: "⚠️", label: "Comprar carretel", color: "#f87171" },
} as const;

// Tem material para imprimir? Uma linha por cor: precisa x tem no estoque.
export function QuoteStockCheck({ needs, spools, spoolName }: Props) {
  if (!needs.length) return null;
  const lines = checkStock(needs, spools);

  const colorName = (l: (typeof lines)[number]) => (l.spoolIds.length ? spoolName(l.spoolIds[0]) : `${l.type} ${l.color}`);
  const buy = lines.filter((l) => l.status === "buy");
  const tight = lines.filter((l) => l.status === "tight");
  const headline = buy.length
    ? { ...STATUS.buy, text: `Comprar carretel: ${buy.map(colorName).join(", ")}` }
    : tight.length
      ? { ...STATUS.tight, text: `Repese antes de começar: ${tight.map(colorName).join(", ")}` }
      : { ...STATUS.ok, text: "Pode imprimir: tem material de todas as cores" };

  return (
    <div style={{ background: "#1e293b", padding: 14, borderRadius: 12, border: `1px solid ${headline.color}`, display: "flex", flexDirection: "column", gap: 8 }}>
      <strong style={{ fontSize: 13, color: "#f8fafc" }}>🧵 MATERIAL NO ESTOQUE</strong>
      <div style={{ fontSize: 13, fontWeight: 700, color: headline.color }}>
        {headline.icon} {headline.text}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {lines.map((l) => {
          const st = STATUS[l.status];
          return (
            <div
              key={l.key}
              style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", fontSize: 12 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: l.color || "#888", border: "1px solid #64748b", flexShrink: 0 }} />
                <span style={{ color: "#e2e8f0", overflowWrap: "anywhere" }}>
                  {colorName(l)}
                  {l.spoolIds.length > 1 ? (
                    <span style={{ color: "#94a3b8" }}> · {l.spoolIds.length} carretéis: {l.spoolGrams.map((g) => `${g.toFixed(0)} g`).join(" + ")}</span>
                  ) : null}
                </span>
              </div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <span style={{ color: "#94a3b8" }}>precisa {l.grams.toFixed(0)} g · tem {l.haveG.toFixed(0)} g</span>
                <div style={{ color: st.color, fontWeight: 700 }}>
                  {st.icon} {st.label}
                  {l.status === "buy" ? ` (faltam ${l.diffG.toFixed(0)} g)` : ` (sobram ${l.diffG.toFixed(0)} g)`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "#64748b" }}>
        Confere o carretel escolhido em Parâmetros da peça, somando os carretéis do mesmo produto (mesma marca, linha e cor). Sem carretel escolhido, soma pela cor e material da placa. Sobra menor que {STOCK_TIGHT_G} g pede repesagem, porque a balança pode ter errado.
      </div>
    </div>
  );
}
