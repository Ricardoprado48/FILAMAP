import * as fs from "node:fs";
import * as ftp from "basic-ftp";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

export interface FilamentSliceInfo {
  trayId: number;
  modelGrams: number;
  supportGrams: number;
  flushGrams: number;
  totalGrams: number;
  color: string; // Adicionado para armazenar a cor do filamento
  weightDiscount: number; // Adicionado para armazenar o desconto de peso por cor
}

export async function fetchAndParseSliceInfo(
  host: string,
  accessCode: string,
  remoteFilePath: string // Ex: "/sdcard/cache/current.gcode.3mf" ou similar descoberto no teste
): Promise<FilamentSliceInfo[]> {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    // Conexão FTPS na porta 990 com TLS implícito (padrão Bambu Lab)
    await client.access({
      host: host,
      port: 990,
      user: "bblp",
      password: accessCode,
      secure: true,
      secureOptions: { rejectUnauthorized: false }
    });

    console.log("📂 Conectado ao FTPS da impressora. Baixando metadados do trabalho...");

    // Baixa o arquivo para um buffer na memória
    const chunks: Buffer[] = [];
    const writable = new WritableStream({
      write(chunk) {
        chunks.push(Buffer.from(chunk));
      }
    });

    // Como o basic-ftp suporta download para stream ou arquivo local, vamos baixar para o disco temporariamente
    const tempFilePath = "./temp_job.3mf";
    await client.downloadTo(tempFilePath, remoteFilePath);
    client.close();

    console.log("📦 Arquivo .3mf baixado com sucesso. Extraindo slice_info.config...");

    // Abre o ZIP (o .3mf é um arquivo zipado)
    const zip = new AdmZip(tempFilePath);
    const zipEntries = zip.getEntries();

    let sliceInfoXmlContent = "";
    for (const entry of zipEntries) {
      if (entry.entryName.includes("Metadata/slice_info.config")) {
        sliceInfoXmlContent = entry.getData().toString("utf8");
        break;
      }
    }

    // Limpa o arquivo temporário do disco
    try { fs.unlinkSync(tempFilePath); } catch (e) {}

    if (!sliceInfoXmlContent) {
      console.warn("⚠️ Arquivo slice_info.config não encontrado no .3mf.");
      return [];
    }

    // Faz o parse do XML
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
    const jsonObj = parser.parse(sliceInfoXmlContent);

    const filaments: FilamentSliceInfo[] = [];

    // Estrutura típica do slice_info.config da Bambu Lab
    // Vamos mapear os nós de filamento e extrair modelo, suporte e purga
    const plateList = jsonObj?.config?.plate;
    const headerFilaments = jsonObj?.config?.filament || jsonObj?.config?.header?.filament;

    // Dependendo da versão do fatiador, os dados de peso vêm mapeados por id de filamento
    // Exemplo estrutural seguro:
    console.log("🔍 XML do slice_info parseado com sucesso.");

    // No XML do Bambu Lab, a estrutura pode conter:
    // <plate>
    //   <filament id="1" model_g="10.5" support_g="0.5" flush_g="2.1" total_g="13.1" color="FFFFFF" weight_discount="5" />
    // </plate>
    // Ou as propriedades podem estar no header, ou mapeadas direto no plate.
    // Vamos varrer ambos os nós (plate e filament) de forma resiliente.
    const extractFilamentData = (node: any) => {
      if (!node) return;
      const nodes = Array.isArray(node) ? node : [node];
      for (const f of nodes) {
        // Tenta obter o tray_id / id
        const idStr = f.id ?? f.tray_id ?? f.tray_idx;
        if (idStr === undefined) continue;

        const trayId = parseInt(idStr);
        const color = f.color ?? f.color_name ?? "unknown";
        const modelGrams = parseFloat(f.model_g ?? f.model_grams ?? "0");
        const supportGrams = parseFloat(f.support_g ?? f.support_grams ?? "0");
        const flushGrams = parseFloat(f.flush_g ?? f.flush_grams ?? "0");
        const totalGrams = parseFloat(f.total_g ?? f.total_grams ?? "0") || (modelGrams + supportGrams + flushGrams);
        const weightDiscount = parseFloat(f.weight_discount ?? "0");

        // Evita duplicatas se o mesmo trayId aparecer múltiplas vezes
        const existingIdx = filaments.findIndex(item => item.trayId === trayId);
        const infoObj = {
          trayId,
          modelGrams,
          supportGrams,
          flushGrams,
          totalGrams,
          color,
          weightDiscount
        };

        if (existingIdx >= 0) {
          filaments[existingIdx] = infoObj;
        } else {
          filaments.push(infoObj);
        }
      }
    };

    // Extrai do plate
    if (plateList) {
      const plates = Array.isArray(plateList) ? plateList : [plateList];
      for (const p of plates) {
        if (p.filament) {
          extractFilamentData(p.filament);
        }
      }
    }

    // Fallback ou complemento do headerFilaments
    if (headerFilaments) {
      extractFilamentData(headerFilaments);
    }

    console.log(`📊 Filamentos lidos do slice_info.config (${filaments.length} encontrados):`);
    for (const f of filaments) {
      console.log(`  - Tray ${f.trayId} (${f.color}): total=${f.totalGrams}g (Model=${f.modelGrams}g, Support=${f.supportGrams}g, Flush=${f.flushGrams}g) Discount=${f.weightDiscount}g`);
    }

    return filaments;
  } catch (err: any) {
    client.close();
    console.error("❌ Erro ao baixar ou parsear o .3mf via FTPS:", err.message);
    return [];
  }
}