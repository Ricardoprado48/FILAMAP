import { supabase } from "../lib/supabase";

// Leitura da Central de Observabilidade. O banco só devolve dados a quem
// está em ops_admins (RLS + checagem nas funções); para os demais, vazio/42501.

export interface OpsHealthRow {
  installation_id: string;
  user_id: string;
  user_email: string | null;
  kind: "agent" | "web";
  app_version: string | null;
  machine_hint: string | null;
  possible_clone: boolean;
  first_seen_at: string;
  agent_last_seen_at: string;
  printer_last_online_at: string | null;
  status: Record<string, any>;
  last_job_at: string | null;
  last_finalize_at: string | null;
  error_count_24h: number;
  critical_count_24h: number;
  inbox_pending: number;
  health_status: "OK" | "DEGRADED" | "CRITICAL" | "OFFLINE";
}

export interface OpsEventRow {
  id: number;
  installation_id: string;
  boot_id: string;
  seq: number;
  occurred_at: string;
  received_at: string;
  app_version: string | null;
  event_type: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  component: string;
  printer_id: string | null;
  job_id: string | null;
  spool_id: string | null;
  error_code: string | null;
  fingerprint: string | null;
  message: string | null;
  repeat_count: number;
  metadata: Record<string, any>;
}

export async function isOpsAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await supabase.from("ops_admins").select("user_id").eq("user_id", userId);
  return !error && Array.isArray(data) && data.length > 0;
}

export async function fetchOpsHealth(): Promise<{ rows: OpsHealthRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc("ops_health");
  return { rows: (data as OpsHealthRow[]) || [], error: error ? error.message : null };
}

export async function fetchOpsEvents(installationId: string, sinceIso: string): Promise<{ rows: OpsEventRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("ops_events")
    .select("id, installation_id, boot_id, seq, occurred_at, received_at, app_version, event_type, severity, component, printer_id, job_id, spool_id, error_code, fingerprint, message, repeat_count, metadata")
    .eq("installation_id", installationId)
    .gte("received_at", sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(200);
  return { rows: (data as OpsEventRow[]) || [], error: error ? error.message : null };
}

export async function purgeExpiredOpsEvents(): Promise<{ removed: number; error: string | null }> {
  const { data, error } = await supabase.rpc("ops_purge_expired");
  return { removed: Number(data) || 0, error: error ? error.message : null };
}

// Ordem da timeline: horário do cliente, desempatando por boot e sequência.
export function sortTimeline(rows: OpsEventRow[]): OpsEventRow[] {
  return [...rows].sort((a, b) => {
    const t = Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
    if (t !== 0) return t;
    if (a.boot_id === b.boot_id) return b.seq - a.seq;
    return a.boot_id < b.boot_id ? 1 : -1;
  });
}

// Relógio do PC diferente do servidor por mais de 2 min.
export function clockSkewMinutes(row: Pick<OpsEventRow, "occurred_at" | "received_at">): number {
  return Math.round((Date.parse(row.received_at) - Date.parse(row.occurred_at)) / 60000);
}

// Erros agrupados por impressão digital (soma repeat_count).
export function groupErrors(rows: OpsEventRow[]): Array<{ fingerprint: string; count: number; last: OpsEventRow }> {
  const map = new Map<string, { fingerprint: string; count: number; last: OpsEventRow }>();
  for (const r of rows) {
    if (!r.fingerprint || (r.severity !== "ERROR" && r.severity !== "CRITICAL" && r.severity !== "WARNING")) continue;
    const g = map.get(r.fingerprint);
    if (g) {
      g.count += r.repeat_count || 1;
      if (Date.parse(r.occurred_at) > Date.parse(g.last.occurred_at)) g.last = r;
    } else {
      map.set(r.fingerprint, { fingerprint: r.fingerprint, count: r.repeat_count || 1, last: r });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
