import type { SupabaseClient } from "@supabase/supabase-js";

// Computadores com o Desktop Agent pareados à conta (credencial por
// dispositivo). Ver supabase/migrations/20260929000000_agent_device_pairing.sql.

export interface AgentDevice {
  id: string;
  device_name: string;
  agent_version: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

export interface PairingCode {
  code: string;
  expires_at: string;
}

export async function listAgentDevices(client: SupabaseClient): Promise<AgentDevice[]> {
  const { data, error } = await client
    .from("agent_devices")
    .select("id, device_name, agent_version, created_at, last_seen_at, revoked_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AgentDevice[];
}

export async function createPairingCode(client: SupabaseClient): Promise<PairingCode> {
  const { data, error } = await client.rpc("create_agent_pairing_code");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.code) throw new Error("O servidor não devolveu o código de pareamento.");
  return { code: row.code, expires_at: row.expires_at };
}

export async function revokeAgentDevice(client: SupabaseClient, deviceId: string): Promise<void> {
  const { error } = await client.rpc("revoke_agent_device", { p_device_id: deviceId });
  if (error) throw error;
}
