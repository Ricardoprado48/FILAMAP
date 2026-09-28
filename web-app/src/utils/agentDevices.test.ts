import { describe, it, expect } from "vitest";
import { describeDevicePresence, pairingSecondsLeft, AGENT_DEVICE_ONLINE_THRESHOLD_MS } from "./agentDevices";

const NOW = 1_800_000_000_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("describeDevicePresence", () => {
  it("nunca visto", () => {
    expect(describeDevicePresence(null, NOW)).toEqual({ label: "Ainda não se conectou", online: false });
    expect(describeDevicePresence("lixo", NOW).online).toBe(false);
  });

  it("dentro da folga de presença -> conectado", () => {
    expect(describeDevicePresence(ago(30_000), NOW)).toEqual({ label: "Conectado agora", online: true });
    expect(describeDevicePresence(ago(AGENT_DEVICE_ONLINE_THRESHOLD_MS - 1), NOW).online).toBe(true);
  });

  it("fora da folga -> tempo desde a última vez", () => {
    expect(describeDevicePresence(ago(AGENT_DEVICE_ONLINE_THRESHOLD_MS), NOW)).toEqual({ label: "Visto há 2 min", online: false });
    expect(describeDevicePresence(ago(3 * 3600_000), NOW).label).toBe("Visto há 3 h");
    expect(describeDevicePresence(ago(5 * 86400_000), NOW).label).toBe("Visto há 5 dias");
  });

  it("relógio do Agent adiantado (timestamp no futuro) conta como conectado", () => {
    expect(describeDevicePresence(ago(-15_000), NOW).online).toBe(true);
  });
});

describe("pairingSecondsLeft", () => {
  it("conta regressiva e piso em zero", () => {
    expect(pairingSecondsLeft(new Date(NOW + 600_000).toISOString(), NOW)).toBe(600);
    expect(pairingSecondsLeft(new Date(NOW - 1000).toISOString(), NOW)).toBe(0);
    expect(pairingSecondsLeft("invalido", NOW)).toBe(0);
  });
});
