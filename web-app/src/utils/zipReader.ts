// Leitor mínimo de ZIP para o arquivo fatiado do Bambu Studio (.gcode.3mf).
// Lê só o índice do arquivo e descompacta apenas as entradas pedidas (resumo da
// placa e miniatura); o G-code, que é a maior parte do arquivo, nunca é aberto.
// Sem dependência: usa DecompressionStream("deflate-raw"), nativo nos navegadores
// atuais e no Node 18+.

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function listZipEntries(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf);
  // Fim do diretório central: procura de trás para frente (comentário de até 64 KB).
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Arquivo não é um .3mf válido (ZIP sem índice).");

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== CDIR_SIG) throw new Error("Índice do .3mf corrompido.");
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(buf, p + 46, nameLen));
    entries.push({ name, method, compressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipEntry(buf: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buf);
  const p = entry.localHeaderOffset;
  if (view.getUint32(p, true) !== LOCAL_SIG) throw new Error(`Entrada ${entry.name} corrompida.`);
  const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
  const raw = new Uint8Array(buf, start, entry.compressedSize);
  if (entry.method === 0) return raw.slice();
  if (entry.method === 8) return inflateRaw(raw);
  throw new Error(`Compressão não suportada (${entry.method}) em ${entry.name}.`);
}
