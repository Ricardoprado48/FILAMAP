import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { CreatedInvite, SignupInvite, createInvite, inviteMessage, inviteStatus, listInvites, revokeInvite } from "../services/inviteService";

// Convites (Central, só admin): gera o link que o tester usa para criar a
// própria conta, lista quem entrou por cada convite e cancela convites.

const input = { padding: 8, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 13 } as const;
const STATUS_COLOR = { ativo: "#34d399", esgotado: "#94a3b8", vencido: "#fbbf24", cancelado: "#f87171" } as const;

export function InvitesPanel() {
  const [invites, setInvites] = useState<SignupInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [uses, setUses] = useState(1);
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setInvites(await listInvites(supabase));
      setError(null);
    } catch (e: any) {
      setError(`Não foi possível carregar os convites: ${e?.message || e}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setCreated(await createInvite(supabase, label.trim(), uses, days));
      setLabel("");
      await load();
    } catch (err: any) {
      setError(`Não foi possível gerar o convite: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(inviteMessage(created.code, window.location.origin, created.expires_at));
      setCopied(true);
    } catch {
      setError("Não foi possível copiar. Selecione a mensagem e copie à mão.");
    }
  }

  async function handleRevoke(inv: SignupInvite) {
    if (!window.confirm(`Cancelar o convite "${inv.label}"? Quem já criou conta continua com ela.`)) return;
    try {
      await revokeInvite(supabase, inv.id);
      await load();
    } catch (err: any) {
      setError(`Não foi possível cancelar: ${err?.message || err}`);
    }
  }

  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color: "#f8fafc", fontSize: 14, marginBottom: 8 }}>✉️ Convites</div>
      <form onSubmit={handleCreate} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
        <label style={{ flex: "2 1 160px", fontSize: 11, color: "#94a3b8" }}>
          Para quem
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Nome do tester" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </label>
        <label style={{ flex: "1 1 70px", fontSize: 11, color: "#94a3b8" }}>
          Contas
          <input type="number" min={1} max={50} value={uses} onChange={(e) => setUses(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </label>
        <label style={{ flex: "1 1 70px", fontSize: 11, color: "#94a3b8" }}>
          Vale (dias)
          <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 14)))} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </label>
        <button type="submit" disabled={busy || !label.trim()} style={{ background: "#059669", color: "#fff", border: "none", padding: "9px 12px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: busy || !label.trim() ? 0.6 : 1 }}>
          {busy ? "Gerando..." : "Gerar convite"}
        </button>
      </form>

      {created && (
        <div style={{ marginTop: 10, border: "1px solid #059669", borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Mande esta mensagem ao tester (o código só aparece agora):</div>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0, fontSize: 12, color: "#e2e8f0", userSelect: "all" }}>
            {inviteMessage(created.code, window.location.origin, created.expires_at)}
          </pre>
          <button onClick={handleCopy} style={{ marginTop: 8, background: "#2563eb", color: "#fff", border: "none", padding: "7px 10px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            {copied ? "✓ Copiado" : "Copiar mensagem"}
          </button>
        </div>
      )}

      {error && <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{error}</div>}

      {invites.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {invites.map((inv) => {
            const st = inviteStatus(inv);
            return (
              <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: 12, borderTop: "1px solid #1e293b", paddingTop: 6, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ color: "#f8fafc", fontWeight: 700 }}>{inv.label}</span>
                  <span style={{ color: STATUS_COLOR[st], marginLeft: 6 }}>{st}</span>
                  <span style={{ color: "#94a3b8", marginLeft: 6 }}>
                    {inv.used_count}/{inv.max_uses} · até {new Date(inv.expires_at).toLocaleDateString("pt-BR")}
                  </span>
                  {inv.emails && <div style={{ color: "#94a3b8", overflowWrap: "anywhere" }}>{inv.emails}</div>}
                </div>
                {st === "ativo" && (
                  <button onClick={() => handleRevoke(inv)} style={{ background: "#334155", color: "#fca5a5", border: "none", padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    Cancelar
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
