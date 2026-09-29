import { useState } from "react";
import { webEmit, flushWebTelemetry, WEB_VERSION } from "../observability/webTelemetry";

// "Enviar diagnóstico ao suporte": registra um SUPPORT_REQUEST na Central.
// Os eventos do Agent já estão lá, então o suporte reconstrói a linha do
// tempo sem pedir print. Nada de senha, token ou Access Code é enviado.
export function SupportDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "queued">("idle");

  async function send() {
    setState("sending");
    webEmit("SUPPORT_REQUEST", {
      message: text.trim().slice(0, 500) || "(sem descrição)",
      metadata: {
        web_version: WEB_VERSION,
        online: navigator.onLine,
        screen: `${window.innerWidth}x${window.innerHeight}`,
        standalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
      },
    });
    const ok = await flushWebTelemetry();
    setState(ok ? "sent" : "queued");
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Enviar diagnóstico" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2, 6, 23, 0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#1e293b", border: "1px solid #38bdf8", borderRadius: 12, padding: 16, maxWidth: 440, width: "100%", boxSizing: "border-box" }}>
        <h3 style={{ margin: "0 0 6px", color: "#fff", fontSize: 16 }}>🛟 Enviar diagnóstico ao suporte</h3>
        {state === "sent" || state === "queued" ? (
          <>
            <p style={{ color: "#34d399", fontSize: 13 }}>
              {state === "sent" ? "Enviado. O suporte já consegue ver o que aconteceu no seu Agent e no app." : "Guardado: será enviado assim que houver conexão."}
            </p>
            <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#0284c7", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Fechar</button>
          </>
        ) : (
          <>
            <p style={{ margin: "0 0 10px", color: "#94a3b8", fontSize: 12 }}>
              Conte em poucas palavras o que aconteceu. Enviamos junto só dados técnicos (versão, conexão, erros recentes). Nenhuma senha ou código da impressora é enviado.
            </p>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={4} placeholder="Ex.: a impressão de ontem à noite não descontou o filamento" style={{ width: "100%", boxSizing: "border-box", padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 13, fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #334155", background: "transparent", color: "#e2e8f0", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button disabled={state === "sending"} onClick={send} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#0284c7", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {state === "sending" ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
