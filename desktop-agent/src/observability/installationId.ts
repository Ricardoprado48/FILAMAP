import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";

// Identificador estável e NÃO sensível da instalação (PACOTE seção 9).
// Fica em %APPDATA%\Filamap\installation.json: sobrevive a reinstalação no
// mesmo PC (o desinstalador não apaga AppData); PCs diferentes = IDs diferentes.
// Nunca lança e nunca bloqueia o start: arquivo ilegível gera ID novo.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadOrCreateInstallationId(dir: string): { id: string; created: boolean } {
  const file = path.join(dir, "installation.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (typeof parsed?.installation_id === "string" && UUID_RE.test(parsed.installation_id)) {
      return { id: parsed.installation_id, created: false };
    }
  } catch {
    // ausente ou ilegível: cria abaixo
  }
  const id = randomUUID();
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `installation.${randomUUID()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ installation_id: id, created_at: new Date().toISOString() }, null, 2), "utf-8");
    fs.renameSync(tmp, file);
  } catch {
    // sem disco: ID vale só para este processo
  }
  return { id, created: true };
}

// Hash truncado do nome da máquina: distingue PCs (alerta de pasta clonada)
// sem enviar o nome.
export function machineHint(hostname: string = os.hostname()): string {
  return createHash("sha256").update(`filamap:${hostname.toLowerCase()}`).digest("hex").slice(0, 12);
}

// Marca de execução: se o processo anterior não gravou "running:false" ao sair,
// ele terminou de forma não limpa (crash, desligamento do PC, queda de energia).
export function markRunStart(dir: string, bootId: string): { uncleanPrevious: boolean; previousStartedAt: string | null } {
  const file = path.join(dir, "agent-run.json");
  let uncleanPrevious = false;
  let previousStartedAt: string | null = null;
  try {
    const prev = JSON.parse(fs.readFileSync(file, "utf-8"));
    uncleanPrevious = prev?.running === true;
    previousStartedAt = typeof prev?.started_at === "string" ? prev.started_at : null;
  } catch {
    // primeira execução ou arquivo ilegível
  }
  writeRun(file, { running: true, boot_id: bootId, started_at: new Date().toISOString() });
  return { uncleanPrevious, previousStartedAt };
}

export function markRunStopped(dir: string, bootId: string): void {
  writeRun(path.join(dir, "agent-run.json"), { running: false, boot_id: bootId, stopped_at: new Date().toISOString() });
}

function writeRun(file: string, data: Record<string, unknown>): void {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `agent-run.${randomUUID()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(data), "utf-8");
    fs.renameSync(tmp, file);
  } catch {
    // sem disco: só perde o diagnóstico de crash
  }
}
