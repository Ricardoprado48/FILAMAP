import dgram from "node:dgram";

// Extraído de index.ts (comportamento preservado bit-a-bit) para permitir
// reuso pelo onboarding sem duplicar a lógica de descoberta SSDP já
// homologada. `discoverPrinterIp` é chamada por index.ts exatamente como
// antes -- mesmas portas, mesmo timeout, mesmas mensagens de log.
//
// Não confundir com src/discovery.ts: aquele é um script diagnóstico
// standalone (SSDP M-SEARCH manual, não integrado ao Agent) que já
// existia antes desta extração -- ver docs/01_ARCHITECTURE.md.

const BAMBU_SSDP_PORTS = [2021, 1990];
const BAMBU_SSDP_MULTICAST_GROUP = "239.255.255.250";
const DISCOVERY_TIMEOUT_MS = 12000;

export interface DiscoveredPrinter {
  ip: string;
  serial: string;
}

function isBambuAnnouncement(text: string, serialHint: string): boolean {
  return (
    text.includes("urn:bambulab-com:device:3dprinter") ||
    text.toLowerCase().includes("devmodel.bambu.com") ||
    (serialHint ? text.includes(serialHint) : false)
  );
}

function extractAnnouncedSerial(text: string): string {
  const usnMatch = text.match(/^USN:\s*(.+)$/im);
  return usnMatch?.[1]?.trim() ?? "";
}

function extractIpFromLocation(text: string, fallbackIp: string): string {
  const locationMatch = text.match(/^LOCATION:\s*(.+)$/im);

  if (locationMatch?.[1]) {
    const location = locationMatch[1].trim();
    const ipMatch = location.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);

    if (ipMatch?.[0]) {
      return ipMatch[0];
    }
  }

  return fallbackIp;
}

// Escuta anúncios SSDP da Bambu Lab na rede local. Se `serialHint` for
// informado, descarta anúncios de outra impressora cujo serial não bata
// (mesma regra de antes). Se `serialHint` estiver vazio, aceita o primeiro
// anúncio Bambu encontrado -- é o que já acontecia implicitamente quando
// PRINTER_SERIAL não filtrava nada, só que agora o serial anunciado (campo
// USN) também é devolvido pra quem quiser usá-lo (onboarding).
export function discoverPrinter(
  serialHint: string,
  timeoutMs: number = DISCOVERY_TIMEOUT_MS
): Promise<DiscoveredPrinter> {
  return new Promise((resolve) => {
    const sockets: dgram.Socket[] = [];
    let resolved = false;

    function cleanup() {
      for (const socket of sockets) {
        try {
          socket.close();
        } catch (_) {}
      }
    }

    function finish(result: DiscoveredPrinter) {
      if (resolved) return;

      resolved = true;
      cleanup();
      resolve(result);
    }

    function handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
      const text = msg.toString("utf8");

      if (!isBambuAnnouncement(text, serialHint)) return;

      const announcedSerial = extractAnnouncedSerial(text);

      if (
        announcedSerial &&
        serialHint &&
        announcedSerial !== serialHint &&
        !announcedSerial.includes(serialHint)
      ) {
        return;
      }

      const detectedIp = extractIpFromLocation(text, rinfo.address);

      finish({ ip: detectedIp, serial: announcedSerial });
    }

    for (const port of BAMBU_SSDP_PORTS) {
      try {
        const socket = dgram.createSocket({
          type: "udp4",
          reuseAddr: true,
        });

        sockets.push(socket);

        socket.on("error", (error) => {
          console.warn(
            `⚠️ Falha ao escutar descoberta Bambu na porta ${port}: ${error.message}`
          );
        });

        socket.on("message", handleMessage);

        socket.bind(port, "0.0.0.0", () => {
          try {
            socket.addMembership(BAMBU_SSDP_MULTICAST_GROUP);
          } catch (_) {}
        });
      } catch (_) {}
    }

    setTimeout(() => {
      finish({ ip: "", serial: "" });
    }, timeoutMs);
  });
}

// Wrapper com o comportamento e as mensagens de log exatas que já existiam
// em index.ts -- usado pelo Agent em produção (startup + redescoberta).
export async function discoverPrinterIp(serialHint: string): Promise<string> {
  console.log("🔍 Procurando impressora Bambu Lab automaticamente na rede local...");

  const { ip } = await discoverPrinter(serialHint);

  if (ip) {
    console.log(`✅ Impressora encontrada automaticamente no IP: ${ip}`);
  }

  return ip;
}
