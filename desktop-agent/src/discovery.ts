import dgram from "node:dgram";
import os from "node:os";
import mqtt from "mqtt";

const BROADCAST_PORT = 2021;
const DEFAULT_BROADCAST_TIMEOUT_MS = 4000;
const DEFAULT_SCAN_PER_IP_TIMEOUT_MS = 1500;

// Limite de hosts por varredura -- ver getLocalIPv4Ranges(). Cobre o caso
// comum de LAN doméstica/pequeno escritório (/24, até 254 hosts) sem
// arriscar varrer uma faixa enorme (ex.: uma /16 corporativa) IP a IP.
const MAX_SUBNET_SCAN_HOSTS = 256;

export interface FindPrinterOptions {
  printerSerial: string;
  accessCode: string;
  broadcastTimeoutMs?: number;
  scanPerIpTimeoutMs?: number;
}

export interface FindPrinterResult {
  ip: string;
  method: "broadcast" | "subnet-scan";
}

/**
 * Descoberta em camadas (nota da Seção 8 do documento de arquitetura):
 * 1. Broadcast BBLP/porta 2021 -- rápido, primeira tentativa.
 * 2. Varredura de sub-rede na porta MQTT (8883) -- fallback mais lento,
 *    não depende de broadcast/multicast chegar ao Agent.
 * Retorna null se nenhuma das duas encontrar a impressora.
 */
export async function findPrinter(opts: FindPrinterOptions): Promise<FindPrinterResult | null> {
  const broadcastIp = await discoverByBroadcast(opts.printerSerial, opts.broadcastTimeoutMs ?? DEFAULT_BROADCAST_TIMEOUT_MS);
  if (broadcastIp) {
    return { ip: broadcastIp, method: "broadcast" };
  }

  console.log("🔍 Broadcast BBLP não respondeu -- iniciando varredura de sub-rede (fallback)...");
  const scannedIp = await discoverBySubnetScan(
    opts.printerSerial,
    opts.accessCode,
    opts.scanPerIpTimeoutMs ?? DEFAULT_SCAN_PER_IP_TIMEOUT_MS
  );
  if (scannedIp) {
    return { ip: scannedIp, method: "subnet-scan" };
  }

  return null;
}

function discoverByBroadcast(printerSerial: string, timeoutMs: number): Promise<string> {
  console.log("🔍 Procurando impressora Bambu Lab automaticamente na rede local (broadcast BBLP)...");
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let resolved = false;

    const finish = (ip: string) => {
      if (resolved) return;
      resolved = true;
      try { socket.close(); } catch (e) {}
      resolve(ip);
    };

    socket.on("error", () => finish(""));

    socket.bind(() => {
      try { socket.setBroadcast(true); } catch (e) {}
      const message = Buffer.from("BBLP");
      socket.send(message, 0, message.length, BROADCAST_PORT, "255.255.255.255", (err) => {
        if (err) finish("");
      });
    });

    socket.on("message", (msg, rinfo) => {
      const text = msg.toString();
      if (text.includes("BBLP") || text.includes(printerSerial)) {
        console.log(`✅ Impressora encontrada automaticamente no IP: ${rinfo.address}`);
        finish(rinfo.address);
      }
    });

    setTimeout(() => finish(""), timeoutMs);
  });
}

interface LocalRangeInfo {
  candidates: string[];
  rangeDescriptions: string[];
}

export function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

export function intToIp(int: number): string {
  return [24, 16, 8, 0].map((shift) => (int >>> shift) & 0xff).join(".");
}

export function prefixLength(maskInt: number): number {
  let count = 0;
  for (let i = 31; i >= 0; i--) {
    if ((maskInt >>> i) & 1) count++;
    else break;
  }
  return count;
}

// Determina a faixa de sub-rede a varrer a partir da interface de rede real
// do sistema (endereço + máscara), nunca de um valor fixo tipo 192.168.1.x.
// Se a máscara real resultar numa faixa maior que MAX_SUBNET_SCAN_HOSTS,
// assume uma /24 a partir do IP local detectado (razão documentada na
// descrição retornada) em vez de varrer a faixa inteira.
export function hostsInRange(address: string, netmask: string): { ips: string[]; description: string } {
  const addrInt = ipToInt(address);
  const maskInt = ipToInt(netmask);
  const prefix = prefixLength(maskInt);
  const networkInt = addrInt & maskInt;
  const hostBits = 32 - prefix;

  if (hostBits <= 1) {
    return { ips: [], description: `${address}/${prefix} (sem hosts para varrer)` };
  }

  const totalHosts = Math.pow(2, hostBits) - 2;

  if (totalHosts > MAX_SUBNET_SCAN_HOSTS) {
    const assumedNetworkInt = addrInt & ipToInt("255.255.255.0");
    const ips: string[] = [];
    for (let host = 1; host <= 254; host++) {
      const ip = intToIp(assumedNetworkInt + host);
      if (ip !== address) ips.push(ip);
    }
    return {
      ips,
      description:
        `${intToIp(assumedNetworkInt)}/24 (assumido a partir do IP local ${address} -- ` +
        `a máscara real ${netmask} (/${prefix}) teria ${totalHosts} hosts, acima do limite ` +
        `de ${MAX_SUBNET_SCAN_HOSTS} para varredura em tempo hábil)`,
    };
  }

  const ips: string[] = [];
  for (let host = 1; host <= totalHosts; host++) {
    const ip = intToIp(networkInt + host);
    if (ip !== address) ips.push(ip);
  }
  return { ips, description: `${intToIp(networkInt)}/${prefix} (${totalHosts} hosts)` };
}

function getLocalIPv4Ranges(): LocalRangeInfo {
  const interfaces = os.networkInterfaces();
  const candidateSet = new Set<string>();
  const rangeDescriptions: string[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      const { ips, description } = hostsInRange(iface.address, iface.netmask);
      for (const ip of ips) candidateSet.add(ip);
      if (ips.length > 0) rangeDescriptions.push(description);
    }
  }

  return { candidates: Array.from(candidateSet), rangeDescriptions };
}

function checkPrinterAtIp(ip: string, printerSerial: string, accessCode: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const probe = mqtt.connect(`mqtts://${ip}:8883`, {
      username: "bblp",
      password: accessCode,
      rejectUnauthorized: false,
      reconnectPeriod: 0,
      connectTimeout: timeoutMs,
    });

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.removeAllListeners();
      probe.end(true);
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    probe.on("connect", () => {
      // Confirmação pelo número de série: só a impressora certa publica
      // no tópico específico do serial esperado em resposta ao pushall.
      probe.subscribe(`device/${printerSerial}/report`, () => {
        probe.publish(`device/${printerSerial}/request`, JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } }));
      });
    });

    probe.on("message", () => finish(true));
    probe.on("error", () => finish(false));
  });
}

async function discoverBySubnetScan(printerSerial: string, accessCode: string, perIpTimeoutMs: number): Promise<string> {
  const { candidates, rangeDescriptions } = getLocalIPv4Ranges();

  if (candidates.length === 0) {
    console.warn("⚠️ Nenhuma interface de rede IPv4 local elegível para varredura de sub-rede.");
    return "";
  }

  console.log(`🔎 Varredura de sub-rede: ${candidates.length} IP(s) na(s) faixa(s) detectada(s): ${rangeDescriptions.join(", ")}`);

  const results = await Promise.all(
    candidates.map(async (ip) => ({ ip, ok: await checkPrinterAtIp(ip, printerSerial, accessCode, perIpTimeoutMs) }))
  );

  const match = results.find((r) => r.ok);
  if (match) {
    console.log(`✅ Impressora encontrada via varredura de sub-rede no IP: ${match.ip}`);
    return match.ip;
  }

  return "";
}
