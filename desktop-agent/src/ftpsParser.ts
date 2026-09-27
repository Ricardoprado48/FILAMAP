import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import * as ftp from "basic-ftp";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

export interface FilamentSliceInfo {
  trayId: number;
  logicalIndex: number;
  filamentId?: number;
  material?: string;
  trayInfoIdx?: string;
  modelGrams: number;
  supportGrams: number;
  flushGrams: number;
  totalGrams: number;
  color: string;
  weightDiscount: number;
}

export interface FtpClientLike {
  access(options: ftp.AccessOptions): Promise<unknown>;
  downloadTo(destination: string, fromRemotePath: string): Promise<unknown>;
  close(): void;
  ftp: { verbose: boolean; timeout?: number };
}

/**
 * Normaliza caminhos de arquivo remoto para o servidor FTPS da Bambu Lab.
 * No servidor FTPS da impressora, a raiz "/" já é o próprio cartão SD.
 * Caminhos vindos do MQTT como "/sdcard/cache/..." ou "arquivo.3mf" são
 * ajustados para múltiplos candidatos prováveis (/cache/..., /model/..., etc.).
 */
export function normalizeRemoteFtpPath(remotePath: string): string[] {
  let cleaned = remotePath.trim();
  if (!cleaned) {
    return ["/cache/current.gcode.3mf"];
  }

  // Remove prefixo /sdcard/ ou sdcard/ pois a raiz do FTPS da Bambu já é o sdcard
  cleaned = cleaned.replace(/^[\/\\]?sdcard[\/\\]?/i, "");

  // Garante barra inicial
  if (!cleaned.startsWith("/")) {
    cleaned = "/" + cleaned;
  }

  const candidates: string[] = [cleaned];

  // Se o caminho não especifica /cache/ ou /model/, tenta essas pastas padrão do fatiador
  if (!cleaned.startsWith("/cache/") && !cleaned.startsWith("/model/")) {
    candidates.push(`/cache${cleaned}`);
    candidates.push(`/model${cleaned}`);
  }

  // Remove duplicatas preservando a ordem
  return Array.from(new Set(candidates));
}

/**
 * Analisa o XML de Metadata/slice_info.config e opcionalmente Metadata/plate_1.json
 * para extrair o consumo granular de filamento por slot.
 */
export function parseSliceInfoXml(
  sliceInfoXmlContent: string,
  plateJsonContent?: string
): FilamentSliceInfo[] {
  const filaments: FilamentSliceInfo[] = [];

  // Tenta extrair mapeamento de filament_ids de plate_1.json se disponível
  let plateFilamentIds: number[] | null = null;
  if (plateJsonContent) {
    try {
      const plateJson = JSON.parse(plateJsonContent);
      if (Array.isArray(plateJson.filament_ids)) {
        plateFilamentIds = plateJson.filament_ids.map(Number);
      }
    } catch {}
  }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const jsonObj = parser.parse(sliceInfoXmlContent);

  const plateList = jsonObj?.config?.plate;
  const headerFilaments = jsonObj?.config?.filament || jsonObj?.config?.header?.filament;

  const extractFilamentData = (node: any) => {
    if (!node) return;
    const nodes = Array.isArray(node) ? node : [node];
    for (const f of nodes) {
      let trayId: number;
      let rawId: number | undefined;

      if (f.id !== undefined) {
        const parsed = parseInt(String(f.id), 10);
        if (!isNaN(parsed)) {
          rawId = parsed;
        }
      }

      if (f.tray_id !== undefined) {
        trayId = parseInt(String(f.tray_id), 10);
      } else if (f.tray_idx !== undefined) {
        trayId = parseInt(String(f.tray_idx), 10);
      } else if (rawId !== undefined) {
        // No Bambu Studio / slicer XML, filament id é 1-based (id="1" -> slot 0, id="8" -> slot 7)
        if (plateFilamentIds && rawId > 0 && rawId <= plateFilamentIds.length) {
          trayId = plateFilamentIds[rawId - 1];
        } else {
          trayId = rawId > 0 ? rawId - 1 : 0;
        }
      } else {
        continue;
      }

      if (isNaN(trayId) || trayId < 0) continue;

      const logicalIndex =
        rawId !== undefined && rawId > 0
          ? rawId - 1
          : trayId >= 0
          ? trayId
          : 0;

      const color = f.color ?? f.color_name ?? "unknown";
      const modelGrams = parseFloat(f.model_g ?? f.model_grams ?? "0");
      const supportGrams = parseFloat(f.support_g ?? f.support_grams ?? "0");
      const flushGrams = parseFloat(f.flush_g ?? f.flush_grams ?? "0");
      const usedGrams = parseFloat(f.used_g ?? f.total_g ?? f.total_grams ?? "0");

      const totalGrams = usedGrams > 0 ? usedGrams : (modelGrams + supportGrams + flushGrams);
      const effectiveModelGrams = modelGrams > 0 ? modelGrams : Math.max(0, totalGrams - supportGrams - flushGrams);
      const weightDiscount = parseFloat(f.weight_discount ?? "0") || 0;

      const rawMaterial = f.type ?? f.material ?? f.tray_type;
      const material = typeof rawMaterial === "string" && rawMaterial.trim() ? rawMaterial.trim() : undefined;

      const rawTrayInfoIdx = f.tray_info_idx ?? f.trayInfoIdx;
      const trayInfoIdx = typeof rawTrayInfoIdx === "string" && rawTrayInfoIdx.trim() ? rawTrayInfoIdx.trim() : undefined;

      const existingIdx = filaments.findIndex((item) => item.logicalIndex === logicalIndex);
      const infoObj: FilamentSliceInfo = {
        trayId,
        logicalIndex,
        ...(rawId !== undefined ? { filamentId: rawId } : {}),
        ...(material ? { material } : {}),
        ...(trayInfoIdx ? { trayInfoIdx } : {}),
        modelGrams: Math.round(effectiveModelGrams * 100) / 100,
        supportGrams: Math.round(supportGrams * 100) / 100,
        flushGrams: Math.round(flushGrams * 100) / 100,
        totalGrams: Math.round(totalGrams * 100) / 100,
        color,
        weightDiscount,
      };

      if (existingIdx >= 0) {
        filaments[existingIdx] = infoObj;
      } else {
        filaments.push(infoObj);
      }
    }
  };

  if (plateList) {
    const plates = Array.isArray(plateList) ? plateList : [plateList];
    for (const p of plates) {
      if (p.filament) {
        extractFilamentData(p.filament);
      }
    }
  }

  if (headerFilaments) {
    extractFilamentData(headerFilaments);
  }

  return filaments;
}

/**
 * Conecta via FTPS com TLS Implícito à impressora Bambu Lab, faz o download do arquivo .3mf
 * do trabalho e extrai os metadados de consumo por filamento/slot de Metadata/slice_info.config.
 */
export async function fetchAndParseSliceInfo(
  host: string,
  accessCode: string,
  remoteFilePath: string,
  injectedClient?: FtpClientLike
): Promise<FilamentSliceInfo[]> {
  const client: FtpClientLike = injectedClient ?? new ftp.Client();
  client.ftp.verbose = false;
  client.ftp.timeout = 10000; // 10 segundos timeout

  const tempFilePath = path.join(os.tmpdir(), `filamap_${randomUUID()}.3mf`);

  try {
    // Conexão FTPS na porta 990 com TLS implícito (obrigatório para Bambu Lab)
    // O basic-ftp requer secure: "implicit" para TLS implícito na porta 990.
    // Usar secure: true dispara FTPS explícito com AUTH TLS sobre texto claro, gerando Timeout.
    await client.access({
      host: host,
      port: 990,
      user: "bblp",
      password: accessCode,
      secure: "implicit",
      secureOptions: { rejectUnauthorized: false },
    });

    console.log("📂 Conectado ao FTPS da impressora (TLS Implícito). Baixando metadados...");

    const candidates = normalizeRemoteFtpPath(remoteFilePath);
    let downloaded = false;
    let lastError: Error | null = null;

    for (const candidate of candidates) {
      try {
        await client.downloadTo(tempFilePath, candidate);
        downloaded = true;
        console.log(`📦 Arquivo .3mf baixado com sucesso de: ${candidate}`);
        break;
      } catch (err: any) {
        lastError = err;
      }
    }

    if (!downloaded) {
      console.warn(
        `⚠️ Nenhum caminho candidato do .3mf foi encontrado na impressora: ${candidates.join(", ")}. Último erro: ${lastError?.message}`
      );
      return [];
    }

    // Abre o ZIP (o .3mf é um pacote ZIP)
    const zip = new AdmZip(tempFilePath);
    const zipEntries = zip.getEntries();

    let sliceInfoXmlContent = "";
    let plateJsonContent = "";

    for (const entry of zipEntries) {
      if (entry.entryName.includes("Metadata/slice_info.config")) {
        sliceInfoXmlContent = entry.getData().toString("utf8");
      } else if (entry.entryName.includes("plate_1.json") || entry.entryName.endsWith(".json")) {
        if (!plateJsonContent) {
          plateJsonContent = entry.getData().toString("utf8");
        }
      }
    }

    if (!sliceInfoXmlContent) {
      console.warn("⚠️ Arquivo Metadata/slice_info.config não encontrado no .3mf.");
      return [];
    }

    const filaments = parseSliceInfoXml(sliceInfoXmlContent, plateJsonContent);

    console.log(`📊 Filamentos lidos do slice_info.config (${filaments.length} encontrados):`);
    for (const f of filaments) {
      console.log(
        `  - Logical ${f.logicalIndex} / Tray ${f.trayId} (${f.material || "unknown"}, ${f.color}): total=${f.totalGrams}g (Model=${f.modelGrams}g, Support=${f.supportGrams}g, Flush=${f.flushGrams}g) Discount=${f.weightDiscount}g`
      );
    }

    return filaments;
  } catch (err: any) {
    console.error("❌ Erro ao baixar ou parsear o .3mf via FTPS:", err.message);
    return [];
  } finally {
    try {
      client.close();
    } catch {}

    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch {}
  }
}