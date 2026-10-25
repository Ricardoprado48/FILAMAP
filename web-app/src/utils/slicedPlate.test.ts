import { describe, expect, it } from "vitest";
import { parseSliceInfo, readSlicedPlateFile } from "./slicedPlate";

// Resumo real exportado pelo Bambu Studio 02.08.03.66 (LOGO_SIMONE, 1 placa).
const LOGO_SIMONE = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.08.03.66"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="prediction" value="2256"/>
    <metadata key="weight" value="4.10"/>
    <metadata key="outside" value="false"/>
    <object identify_id="8" name="LOGO_SIMONE.3mf" skipped="false" />
    <filament id="1" tray_info_idx="GFA00" type="PLA" color="#FEFEFE" used_m="1.19" used_g="3.61" group_id="0"/>
    <filament id="2" tray_info_idx="GFA00" type="PLA" color="#FD0473" used_m="0.16" used_g="0.49" group_id="0"/>
    <filament id="3" tray_info_idx="GFA00" type="PLA" color="#FBCBDA" used_m="0.00" used_g="0.00" group_id="0"/>
  </plate>
</config>`;

const HEADER_ONLY = `<?xml version="1.0" encoding="UTF-8"?>
<config><header><header_item key="X-BBL-Client-Type" value="slicer"/></header></config>`;

// Monta um ZIP mínimo (deflate) igual ao .gcode.3mf.
async function deflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw.slice()]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function buildZip(files: Record<string, string | Uint8Array>): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const data = await deflateRaw(raw);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    all.set(part, p);
    p += part.length;
  }
  return all.buffer;
}

describe("parseSliceInfo", () => {
  it("lê tempo, peso, gramas por cor e peças da placa (arquivo real)", () => {
    const [plate] = parseSliceInfo(LOGO_SIMONE);
    expect(plate.index).toBe(1);
    expect(plate.seconds).toBe(2256);
    expect(plate.weightG).toBe(4.1);
    expect(plate.objects).toEqual(["LOGO_SIMONE.3mf"]);
    expect(plate.filaments).toEqual([
      { id: 1, type: "PLA", color: "#FEFEFE", grams: 3.61, trayInfoIdx: "GFA00" },
      { id: 2, type: "PLA", color: "#FD0473", grams: 0.49, trayInfoIdx: "GFA00" },
    ]);
  });

  it("projeto salvo sem fatiamento não tem placa", () => {
    expect(parseSliceInfo(HEADER_ONLY)).toEqual([]);
  });

  it("arquivo com várias placas devolve todas", () => {
    const two = LOGO_SIMONE.replace("</config>", LOGO_SIMONE.slice(LOGO_SIMONE.indexOf("<plate>"), LOGO_SIMONE.indexOf("</config>")).replace('value="1"/>', 'value="3"/>') + "</config>");
    expect(parseSliceInfo(two).map((p) => p.index)).toEqual([1, 3]);
  });
});

describe("readSlicedPlateFile", () => {
  it("abre o .gcode.3mf, lê o resumo e a miniatura da placa", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const buf = await buildZip({
      "Metadata/plate_1.gcode": "G1 X0\n".repeat(1000),
      "Metadata/slice_info.config": LOGO_SIMONE,
      "Metadata/plate_1.png": png,
    });
    const [plate] = await readSlicedPlateFile(buf);
    expect(plate.seconds).toBe(2256);
    expect(plate.filaments).toHaveLength(2);
    expect(plate.thumbnail).toBe("data:image/png;base64,iVBORw==");
  });

  it("projeto salvo (.3mf sem fatiar) dá mensagem dizendo como exportar", async () => {
    const buf = await buildZip({ "Metadata/slice_info.config": HEADER_ONLY });
    await expect(readSlicedPlateFile(buf)).rejects.toThrow(/fatie a placa antes de exportar/);
  });

  it("arquivo que não é .3mf dá erro claro", async () => {
    await expect(readSlicedPlateFile(new TextEncoder().encode("nao sou zip").buffer)).rejects.toThrow(/não é um .3mf válido/);
  });
});
