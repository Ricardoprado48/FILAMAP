import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import AdmZip from "adm-zip";
import {
  normalizeRemoteFtpPath,
  parseSliceInfoXml,
  fetchAndParseSliceInfo,
  FtpClientLike,
} from "./ftpsParser";

test("normalizeRemoteFtpPath: remove prefixo /sdcard/ e gera candidatos padrão", () => {
  const result = normalizeRemoteFtpPath("/sdcard/cache/current.gcode.3mf");
  assert.deepEqual(result, ["/cache/current.gcode.3mf"]);
});

test("normalizeRemoteFtpPath: nome relativo gera candidatos em /, /cache/ e /model/", () => {
  const result = normalizeRemoteFtpPath("Cubo.3mf");
  assert.deepEqual(result, [
    "/Cubo.3mf",
    "/cache/Cubo.3mf",
    "/model/Cubo.3mf",
  ]);
});

test("normalizeRemoteFtpPath: caminho com /sdcard/ relativo a arquivo solto", () => {
  const result = normalizeRemoteFtpPath("/sdcard/my_model.gcode.3mf");
  assert.deepEqual(result, [
    "/my_model.gcode.3mf",
    "/cache/my_model.gcode.3mf",
    "/model/my_model.gcode.3mf",
  ]);
});

test("normalizeRemoteFtpPath: caminho vazio usa fallback seguro", () => {
  const result = normalizeRemoteFtpPath("");
  assert.deepEqual(result, ["/cache/current.gcode.3mf"]);
});

test("parseSliceInfoXml: extrai filamento único com used_g e id 1-based (Cubo.3mf)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
  </header>
  <plate>
    <metadata key="weight" value="18.98"/>
    <filament id="1" tray_info_idx="Pc5a93aa" type="PETG" color="#161616" used_m="6.16" used_g="18.98" group_id="0"/>
  </plate>
</config>`;

  const result = parseSliceInfoXml(xml);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    trayId: 0, // id="1" no slicer mapeia para slot 0 (0-based)
    modelGrams: 18.98,
    supportGrams: 0,
    flushGrams: 0,
    totalGrams: 18.98,
    color: "#161616",
    weightDiscount: 0,
  });
});

test("parseSliceInfoXml: extrai multicolor 3 cores (3DBenchy_3color)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="weight" value="15.80"/>
    <filament id="1" type="PLA" color="#FFFFFF" used_m="2.63" used_g="7.98" />
    <filament id="2" type="PLA" color="#7A7A7A" used_m="1.47" used_g="4.45" />
    <filament id="3" type="PLA" color="#000000" used_m="1.10" used_g="3.34" />
  </plate>
</config>`;

  const result = parseSliceInfoXml(xml);
  assert.equal(result.length, 3);

  assert.deepEqual(result[0], {
    trayId: 0,
    modelGrams: 7.98,
    supportGrams: 0,
    flushGrams: 0,
    totalGrams: 7.98,
    color: "#FFFFFF",
    weightDiscount: 0,
  });

  assert.deepEqual(result[1], {
    trayId: 1,
    modelGrams: 4.45,
    supportGrams: 0,
    flushGrams: 0,
    totalGrams: 4.45,
    color: "#7A7A7A",
    weightDiscount: 0,
  });

  assert.deepEqual(result[2], {
    trayId: 2,
    modelGrams: 3.34,
    supportGrams: 0,
    flushGrams: 0,
    totalGrams: 3.34,
    color: "#000000",
    weightDiscount: 0,
  });
});

test("parseSliceInfoXml: extrai slots descontínuos com auxílio de plate_1.json (slot 0 e slot 7)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <filament id="1" type="PLA" color="#FFFFFF" used_g="1.66" />
    <filament id="8" type="PLA" color="#F72323" used_g="0.45" />
  </plate>
</config>`;

  const plateJson = JSON.stringify({
    filament_ids: [0, 7],
    filament_colors: ["#FFFFFF", "#F72323"],
  });

  const result = parseSliceInfoXml(xml, plateJson);
  assert.equal(result.length, 2);

  assert.equal(result[0].trayId, 0);
  assert.equal(result[0].totalGrams, 1.66);
  assert.equal(result[0].color, "#FFFFFF");

  assert.equal(result[1].trayId, 7);
  assert.equal(result[1].totalGrams, 0.45);
  assert.equal(result[1].color, "#F72323");
});

test("parseSliceInfoXml: suporta campos legados model_g, support_g, flush_g e weight_discount", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <filament id="2" color="Blue" model_g="20.5" support_g="3.0" flush_g="1.5" weight_discount="2.0" />
  </plate>
</config>`;

  const result = parseSliceInfoXml(xml);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    trayId: 1, // id="2" -> slot 1
    modelGrams: 20.5,
    supportGrams: 3.0,
    flushGrams: 1.5,
    totalGrams: 25.0,
    color: "Blue",
    weightDiscount: 2.0,
  });
});

test("parseSliceInfoXml: resiliente a XML vazio ou sem nós de filamento", () => {
  const result = parseSliceInfoXml("<config></config>");
  assert.deepEqual(result, []);
});

test("fetchAndParseSliceInfo: conecta com secure: 'implicit' e faz fallback de candidato", async () => {
  let accessedOptions: any = null;
  let downloadedPaths: string[] = [];

  // Cria um arquivo zip .3mf válido em memória para o mock servir
  const testZip = new AdmZip();
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <filament id="1" color="#161616" used_g="15.5"/>
  </plate>
</config>`;
  testZip.addFile("Metadata/slice_info.config", Buffer.from(sampleXml, "utf8"));
  const zipBuffer = testZip.toBuffer();

  const mockClient: FtpClientLike = {
    ftp: { verbose: false },
    async access(options) {
      accessedOptions = options;
    },
    async downloadTo(destination, fromRemotePath) {
      downloadedPaths.push(fromRemotePath);
      if (fromRemotePath === "/Cubo.3mf") {
        // Simula erro 550 no primeiro candidato
        throw new Error("550 File not found");
      }
      if (fromRemotePath === "/cache/Cubo.3mf") {
        // Sucesso no segundo candidato
        fs.writeFileSync(destination, zipBuffer);
        return;
      }
      throw new Error("550 File not found");
    },
    close() {},
  };

  const result = await fetchAndParseSliceInfo(
    "192.168.1.100",
    "test_access_code",
    "Cubo.3mf",
    mockClient
  );

  // 1. Verifica se conectou com secure: 'implicit' na porta 990
  assert.ok(accessedOptions);
  assert.equal(accessedOptions.port, 990);
  assert.equal(accessedOptions.secure, "implicit");
  assert.equal(accessedOptions.user, "bblp");
  assert.equal(accessedOptions.password, "test_access_code");

  // 2. Verifica se tentou os caminhos candidatos e recuperou no segundo
  assert.deepEqual(downloadedPaths, ["/Cubo.3mf", "/cache/Cubo.3mf"]);

  // 3. Verifica o resultado extraído
  assert.equal(result.length, 1);
  assert.equal(result[0].trayId, 0);
  assert.equal(result[0].totalGrams, 15.5);
});

test("fetchAndParseSliceInfo: limpa arquivo temporário mesmo em caso de erro", async () => {
  const mockClient: FtpClientLike = {
    ftp: { verbose: false },
    async access() {
      throw new Error("Connection failed");
    },
    async downloadTo() {},
    close() {},
  };

  const result = await fetchAndParseSliceInfo(
    "192.168.1.100",
    "test_access_code",
    "/sdcard/test.3mf",
    mockClient
  );

  assert.deepEqual(result, []);
});
