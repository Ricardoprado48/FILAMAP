import React from "react";

interface LoginScreenProps {
  authEmail: string;
  setAuthEmail: (v: string) => void;
  authPassword: string;
  setAuthPassword: (v: string) => void;
  authLoading: boolean;
  authError: string | null;
  onSubmit: (e: React.FormEvent) => void;
}

export function LoginScreen({ authEmail, setAuthEmail, authPassword, setAuthPassword, authLoading, authError, onSubmit }: LoginScreenProps) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#0f172a" }}>
      <div style={{ maxWidth: 380, width: "100%", background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 24, boxSizing: "border-box" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <span style={{ fontSize: 36 }}>🧵</span>
          <h1 style={{ margin: "8px 0 0", fontSize: 24, color: "#38bdf8", fontWeight: 900 }}>FILAMAP</h1>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 12 }}>Acesso à Oficina & Estoque NFC</p>
        </div>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>E-mail</label>
            <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="seu@email.com" required style={{ width: "100%", padding: 10, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 }}>Senha</label>
            <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="••••••••" required style={{ width: "100%", padding: 10, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff" }} />
          </div>
          {authError && <div style={{ color: "#f87171", fontSize: 12, background: "rgba(239, 68, 68, 0.1)", padding: 8, borderRadius: 6, border: "1px solid #dc2626" }}>{authError}</div>}
          <button type="submit" disabled={authLoading} style={{ padding: 12, background: authLoading ? "#0369a1" : "#0284c7", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>
            {authLoading ? "Entrando..." : "Entrar no Filamap"}
          </button>
        </form>
      </div>
    </div>
  );
}
