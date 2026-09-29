import { useEffect, useMemo, useState } from "react";
import {
  OpsEventRow,
  OpsHealthRow,
  clockSkewMinutes,
  fetchOpsEvents,
  fetchOpsHealth,
  groupErrors,
  purgeExpiredOpsEvents,
  sortTimeline,
} from "../services/opsService";

// Central de Observabilidade (só admin; o banco bloqueia os demais).
// Visão geral por instalação + timeline de uma instalação com filtros.

const HEALTH_COLOR: Record<OpsHealthRow["health_status"], string> = {
  OK: "#34d399",
  DEGRADED: "#fbbf24",
  CRITICAL: "#f87171",
  OFFLINE: "#94a3b8",
};
const SEV_COLOR: Record<string, string> = { INFO: "#94a3b8", WARNING: "#fbbf24", ERROR: "#f87171", CRITICAL: "#ef4444" };
const PERIODS = [
  { label: "24 h", ms: 24 * 3600_000 },
  { label: "7 dias", ms: 7 * 24 * 3600_000 },
  { label: "30 dias", ms: 30 * 24 * 3600_000 },
];

function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

function maskEmail(email: string | null): string {
  if (!email) return "—";
  const [u, d] = email.split("@");
  return `${u.slice(0, 2)}***@${d ?? ""}`;
}

const sel = { padding: 6, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#fff", fontSize: 12 } as const;

export function OpsCentral({ onClose }: { onClose: () => void }) {
  const [health, setHealth] = useState<OpsHealthRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OpsHealthRow | null>(null);
  const [events, setEvents] = useState<OpsEventRow[]>([]);
  const [period, setPeriod] = useState(PERIODS[0].ms);
  const [fSeverity, setFSeverity] = useState("");
  const [fComponent, setFComponent] = useState("");
  const [fType, setFType] = useState("");
  const [fJob, setFJob] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function loadHealth() {
    setLoading(true);
    const r = await fetchOpsHealth();
    setHealth(r.rows);
    setError(r.error);
    setLoading(false);
  }

  useEffect(() => {
    void loadHealth();
  }, []);

  useEffect(() => {
    if (!selected) return;
    void fetchOpsEvents(selected.installation_id, new Date(Date.now() - period).toISOString()).then((r) => {
      setEvents(sortTimeline(r.rows));
      if (r.error) setError(r.error);
    });
  }, [selected, period]);

  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          (!fSeverity || e.severity === fSeverity) &&
          (!fComponent || e.component === fComponent) &&
          (!fType || e.event_type === fType) &&
          (!fJob || e.job_id === fJob || String(e.metadata?.job ?? "") === fJob)
      ),
    [events, fSeverity, fComponent, fType, fJob]
  );
  const options = (key: keyof OpsEventRow) => [...new Set(events.map((e) => String(e[key] ?? "")).filter(Boolean))].sort();
  const groups = useMemo(() => groupErrors(events), [events]);

  async function purge() {
    const r = await purgeExpiredOpsEvents();
    setNote(r.error ? `Erro: ${r.error}` : `${r.removed} evento(s) com mais de 30 dias removidos.`);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Central de observabilidade" style={{ position: "fixed", inset: 0, background: "#0f172a", zIndex: 1100, overflowY: "auto", padding: 16, boxSizing: "border-box" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
          <h2 style={{ margin: 0, color: "#fff", fontSize: 17 }}>📡 Central {selected ? "· timeline" : ""}</h2>
          <div style={{ display: "flex", gap: 6 }}>
            {selected && (
              <button onClick={() => { setSelected(null); setEvents([]); }} style={{ ...sel, cursor: "pointer" }}>◂ Instalações</button>
            )}
            <button onClick={() => (selected ? setSelected({ ...selected }) : loadHealth())} style={{ ...sel, cursor: "pointer" }}>↻</button>
            <button onClick={onClose} style={{ ...sel, cursor: "pointer" }}>✕</button>
          </div>
        </div>

        {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 8 }}>Erro: {error}</div>}
        {note && <div style={{ color: "#34d399", fontSize: 12, marginBottom: 8 }}>{note}</div>}

        {!selected && (
          <>
            {loading ? (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>Carregando…</div>
            ) : health.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>Nenhuma instalação enviou dados ainda.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {health.map((h) => (
                  <button
                    key={h.installation_id}
                    onClick={() => setSelected(h)}
                    style={{ textAlign: "left", background: "#1e293b", border: `1px solid ${HEALTH_COLOR[h.health_status]}`, borderRadius: 8, padding: 10, color: "#e2e8f0", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 13 }}>
                        <span style={{ color: HEALTH_COLOR[h.health_status] }}>● {h.health_status}</span> · {h.kind === "agent" ? "🖥️ Agent" : "🌐 Web"} {h.app_version ?? "?"} · {maskEmail(h.user_email)}
                      </strong>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>visto há {ago(h.agent_last_seen_at)}</span>
                    </div>
                    {h.kind === "agent" && (
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span>impressora {ago(h.printer_last_online_at)}</span>
                        <span>MQTT {h.status?.mqtt ?? "?"}</span>
                        <span>sessão {h.status?.session ?? "?"}</span>
                        <span>sync Bambu {h.status?.bambu_sync ?? "?"} ({ago(h.status?.last_bambu_sync_at)})</span>
                        <span>último job {ago(h.last_job_at)}</span>
                        <span style={{ color: Number(h.status?.pending_finalize) > 0 ? "#fbbf24" : undefined }}>finalize pendente {h.status?.pending_finalize ?? 0}</span>
                        <span style={{ color: Number(h.error_count_24h) > 0 ? "#f87171" : undefined }}>erros 24h {h.error_count_24h}</span>
                        <span>inbox {h.inbox_pending}</span>
                        {h.possible_clone && <span style={{ color: "#f87171" }}>⚠ possível pasta clonada</span>}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <button onClick={purge} style={{ ...sel, cursor: "pointer" }}>Remover eventos com mais de 30 dias</button>
            </div>
          </>
        )}

        {selected && (
          <>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>
              {selected.kind} {selected.app_version} · {maskEmail(selected.user_email)} · instalação {selected.installation_id.slice(0, 8)}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} style={sel}>
                {PERIODS.map((p) => <option key={p.ms} value={p.ms}>{p.label}</option>)}
              </select>
              <select value={fSeverity} onChange={(e) => setFSeverity(e.target.value)} style={sel}>
                <option value="">severidade</option>
                {options("severity").map((o) => <option key={o}>{o}</option>)}
              </select>
              <select value={fComponent} onChange={(e) => setFComponent(e.target.value)} style={sel}>
                <option value="">componente</option>
                {options("component").map((o) => <option key={o}>{o}</option>)}
              </select>
              <select value={fType} onChange={(e) => setFType(e.target.value)} style={sel}>
                <option value="">evento</option>
                {options("event_type").map((o) => <option key={o}>{o}</option>)}
              </select>
              <input value={fJob} onChange={(e) => setFJob(e.target.value.trim())} placeholder="job id" style={{ ...sel, width: 120 }} />
            </div>

            {groups.length > 0 && (
              <div style={{ background: "#1e293b", borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#f8fafc", marginBottom: 6 }}>Problemas agrupados</div>
                {groups.slice(0, 8).map((g) => (
                  <div key={g.fingerprint} style={{ fontSize: 11, color: SEV_COLOR[g.last.severity], marginBottom: 3 }}>
                    {g.count}× {g.last.event_type} · {g.last.component} · {g.last.message ?? g.last.error_code ?? ""} <span style={{ color: "#64748b" }}>(último há {ago(g.last.occurred_at)})</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {filtered.length === 0 && <div style={{ color: "#94a3b8", fontSize: 12 }}>Nenhum evento no período/filtro.</div>}
              {filtered.map((e) => {
                const skew = clockSkewMinutes(e);
                return (
                  <details key={e.id} style={{ background: "#1e293b", borderRadius: 6, padding: "6px 10px", borderLeft: `3px solid ${SEV_COLOR[e.severity]}` }}>
                    <summary style={{ cursor: "pointer", fontSize: 12, color: "#e2e8f0", listStyle: "none" }}>
                      <span style={{ color: "#94a3b8" }}>{new Date(e.occurred_at).toLocaleString("pt-BR")}</span>{" "}
                      <strong style={{ color: SEV_COLOR[e.severity] }}>{e.event_type}</strong>
                      {e.repeat_count > 1 && <span style={{ color: "#fbbf24" }}> ×{e.repeat_count}</span>}
                      {e.message && <span style={{ color: "#cbd5e1" }}> · {e.message}</span>}
                      {Math.abs(skew) > 2 && <span style={{ color: "#fbbf24" }}> · relógio {skew > 0 ? "atrasado" : "adiantado"} {Math.abs(skew)} min</span>}
                    </summary>
                    <pre style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "6px 0 0" }}>
                      {JSON.stringify({ component: e.component, error_code: e.error_code, job_id: e.job_id, printer_id: e.printer_id, spool_id: e.spool_id, app_version: e.app_version, boot: e.boot_id.slice(0, 8), seq: e.seq, metadata: e.metadata }, null, 2)}
                    </pre>
                  </details>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
