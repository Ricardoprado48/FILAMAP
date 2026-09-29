import { useState } from "react";
import { supabase } from "../lib/supabase";
import { signupWithInvite } from "../services/inviteService";

// Criar conta com convite (tela de login). Depois de criar, já entra.

const input = { width: "100%", padding: 10, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", boxSizing: "border-box" } as const;
const label = { display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 4 } as const;

export function InviteSignupForm({ initialCode, onBack }: { initialCode: string; onBack: () => void }) {
  const [code, setCode] = useState(initialCode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirm) return setError("As duas senhas não são iguais.");
    setBusy(true);
    const cleanEmail = email.trim().toLowerCase();
    const failure = await signupWithInvite(supabase, { code: code.trim(), email: cleanEmail, password });
    if (failure) {
      setBusy(false);
      return setError(failure);
    }
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    setBusy(false);
    if (loginError) return setError(`Conta criada. Entre com o seu e-mail e senha. (${loginError.message})`);
    window.history.replaceState(null, "", window.location.pathname);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ color: "#cbd5e1", fontSize: 13 }}>Crie sua conta com o convite que você recebeu.</div>
      <div>
        <label style={label}>Código do convite</label>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX" required style={{ ...input, fontFamily: "Consolas, monospace", letterSpacing: 2 }} />
      </div>
      <div>
        <label style={label}>E-mail</label>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" required style={input} />
      </div>
      <div>
        <label style={label}>Crie uma senha (mínimo 8)</label>
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required style={input} />
      </div>
      <div>
        <label style={label}>Repita a senha</label>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required style={input} />
      </div>
      {error && <div style={{ color: "#f87171", fontSize: 12, background: "rgba(239, 68, 68, 0.1)", padding: 8, borderRadius: 6, border: "1px solid #dc2626" }}>{error}</div>}
      <button type="submit" disabled={busy} style={{ padding: 12, background: busy ? "#047857" : "#059669", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>
        {busy ? "Criando..." : "Criar conta e entrar"}
      </button>
      <button type="button" onClick={onBack} style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>
        Já tenho conta: entrar
      </button>
    </form>
  );
}
