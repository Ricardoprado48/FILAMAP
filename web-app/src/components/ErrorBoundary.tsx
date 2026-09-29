import React from "react";
import { webEmit, flushWebTelemetry } from "../observability/webTelemetry";

// Erro de render deixava a tela branca e sem rastro. Agora: tela de
// recuperação + WEB_ERROR na Central (sem dados do usuário, sanitizado).
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    webEmit("WEB_ERROR", { error, component: "react_render", metadata: { component_stack: String(info?.componentStack || "").slice(0, 800) } });
    void flushWebTelemetry();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", background: "#0f172a", color: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 420, background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 20, textAlign: "center" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Algo deu errado nesta tela</h2>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "#94a3b8" }}>
            Seu estoque não foi alterado. O erro foi registrado para o suporte.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button onClick={() => this.setState({ failed: false })} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #334155", background: "transparent", color: "#e2e8f0", fontWeight: 700, cursor: "pointer" }}>
              Tentar de novo
            </button>
            <button onClick={() => window.location.reload()} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#0284c7", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              Recarregar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
