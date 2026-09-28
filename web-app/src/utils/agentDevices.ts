// O Agent marca presença a cada 60s (touch_agent_device). Folga para 2
// batidas perdidas antes de dizer que o computador não está conectado.
export const AGENT_DEVICE_ONLINE_THRESHOLD_MS = 150_000;

export type DevicePresence = { label: string; online: boolean };

export function describeDevicePresence(lastSeenAt: string | null, now: number = Date.now()): DevicePresence {
  const seen = lastSeenAt ? new Date(lastSeenAt).getTime() : NaN;
  if (!Number.isFinite(seen)) return { label: "Ainda não se conectou", online: false };

  const ageMs = Math.max(0, now - seen);
  if (ageMs < AGENT_DEVICE_ONLINE_THRESHOLD_MS) return { label: "Conectado agora", online: true };

  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return { label: `Visto há ${minutes} min`, online: false };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { label: `Visto há ${hours} h`, online: false };
  return { label: `Visto há ${Math.floor(hours / 24)} dias`, online: false };
}

// Segundos restantes até o código expirar (0 quando já expirou).
export function pairingSecondsLeft(expiresAt: string, now: number = Date.now()): number {
  const ms = new Date(expiresAt).getTime() - now;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
}
