import { useState } from "react";
import { supabase } from "../lib/supabase";

// Troca de senha de quem está logado (não depende de e-mail).

const input = { width: "100%", padding: 10, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" } as const;

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirm) return setError("As duas senhas não são iguais.");
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(`Não foi possível trocar a senha: ${err.message}`);
    setDone(true);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000 }}>
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 20, width: "100%", maxWidth: 360, boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <strong style={{ color: "#f8fafc" }}>🔑 Trocar senha</strong>
          <button onClick={onClose} aria-label="Fechar" style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontWeight: 700, fontSize: 16 }}>✕</button>
        </div>
        {done ? (
          <div style={{ color: "#34d399", fontSize: 14 }}>Senha trocada. Use a nova senha no próximo acesso.</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nova senha (mínimo 8)" style={input} />
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repita a nova senha" style={input} />
            {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}
            <button type="submit" disabled={busy} style={{ padding: 10, background: "#0284c7", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>
              {busy ? "Salvando..." : "Salvar nova senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
