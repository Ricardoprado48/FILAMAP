import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  AgentDevice,
  PairingCode,
  createPairingCode,
  listAgentDevices,
  revokeAgentDevice,
} from "../services/agentDeviceService";
import { describeDevicePresence, pairingSecondsLeft } from "../utils/agentDevices";

// "Computadores conectados": gera o código para parear um Desktop Agent e
// permite desconectar cada computador individualmente.

// Publicado junto com a Web pelo ops/publicar-web-producao.ps1 (instalador conferido por SHA256).
const AGENT_DOWNLOAD_URL = "/downloads/FilamapAgentSetup.exe";

const card = { background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: 16, marginBottom: 16 } as const;
const primaryButton = { background: "#059669", color: "#fff", border: "none", padding: "10px 14px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" } as const;

export function AgentDevicesPanel({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<AgentDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [generating, setGenerating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setDevices(await listAgentDevices(supabase));
      setError(null);
    } catch (e: any) {
      setError(`Não foi possível carregar os computadores: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = setInterval(() => void load(), 15_000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [load]);

  const secondsLeft = pairing ? pairingSecondsLeft(pairing.expires_at, now) : 0;

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      setPairing(await createPairingCode(supabase));
    } catch (e: any) {
      setError(`Não foi possível gerar o código: ${e?.message || e}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(device: AgentDevice) {
    const ok = window.confirm(
      `Desconectar "${device.device_name}"?\n\nO Agent desse computador perde o acesso em até 1 hora e vai pedir um novo código para voltar.`
    );
    if (!ok) return;
    setRevokingId(device.id);
    try {
      await revokeAgentDevice(supabase, device.id);
      await load();
    } catch (e: any) {
      setError(`Não foi possível desconectar: ${e?.message || e}`);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <strong style={{ fontSize: 15, color: "#f8fafc" }}>💻 Computadores conectados</strong>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontWeight: 700, fontSize: 16 }} aria-label="Fechar">
          ✕
        </button>
      </div>

      <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 12px" }}>
        O Desktop Agent roda no computador ligado à rede da impressora. Para conectar um computador, gere um código e digite no Agent. Sua senha nunca é pedida no Agent.
      </p>

      <div style={{ background: "#0f172a", borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13, color: "#cbd5e1" }}>
        <div style={{ fontWeight: 700, color: "#f8fafc", marginBottom: 6 }}>1. Instale o Filamap Agent (Windows)</div>
        <a href={AGENT_DOWNLOAD_URL} download style={{ ...primaryButton, display: "block", textAlign: "center", textDecoration: "none", background: "#2563eb", marginBottom: 8 }}>
          ⬇️ Baixar o Filamap Agent
        </a>
        <div style={{ color: "#94a3b8", fontSize: 12 }}>
          Se o Windows mostrar "O Windows protegeu o computador", clique em <strong>Mais informações</strong> e depois em <strong>Executar assim mesmo</strong>. Tenha à mão o <strong>Access Code</strong> da impressora (aparece nas configurações de rede/WLAN, na tela da impressora).
        </div>
        <div style={{ fontWeight: 700, color: "#f8fafc", marginTop: 10 }}>2. Gere o código e digite no Agent</div>
      </div>

      {pairing && secondsLeft > 0 ? (
        <div style={{ background: "#0f172a", border: "1px solid #059669", borderRadius: 10, padding: 14, marginBottom: 14, textAlign: "center" }}>
          <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>Digite este código no Filamap Agent</div>
          <div style={{ fontFamily: "Consolas, monospace", fontSize: 28, fontWeight: 800, letterSpacing: 3, color: "#34d399", userSelect: "all" }}>{pairing.code}</div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
            Expira em {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} · vale para um computador só
          </div>
        </div>
      ) : (
        <button onClick={handleGenerate} disabled={generating} style={{ ...primaryButton, width: "100%", marginBottom: 14, opacity: generating ? 0.6 : 1 }}>
          {generating ? "Gerando..." : pairing ? "Código expirou: gerar outro" : "Conectar computador"}
        </button>
      )}

      {error && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 10 }}>{error}</div>}

      {loading ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>Carregando...</div>
      ) : devices.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>Nenhum computador pareado ainda.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {devices.map((d) => {
            const presence = describeDevicePresence(d.last_seen_at, now);
            return (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#0f172a", borderRadius: 8, padding: "10px 12px", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#f8fafc", fontWeight: 700, fontSize: 14, overflowWrap: "anywhere" }}>{d.device_name}</div>
                  <div style={{ fontSize: 12, color: presence.online ? "#34d399" : "#94a3b8" }}>
                    {presence.label}
                    {d.agent_version ? ` · Agent ${d.agent_version}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(d)}
                  disabled={revokingId === d.id}
                  style={{ background: "#334155", color: "#fca5a5", border: "none", padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  {revokingId === d.id ? "Desconectando..." : "Desconectar"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
