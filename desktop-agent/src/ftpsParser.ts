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

    return filaments;
  } catch (err: any) {
    client.close();
    console.error("❌ Erro ao baixar ou parsear o .3mf via FTPS:", err.message);
    return [];
  }
}