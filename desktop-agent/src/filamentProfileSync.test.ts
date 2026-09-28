import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanDisplayName,
  getBambuStudioBaseDirectories,
  parseBambuFilamentPreset,
  readBambuStudioFilamentProfiles,
  syncBambuStudioFilamentProfiles,
} from "./filamentProfileSync";

test("cleanDisplayName remove somente o sufixo técnico da Bambu", () => {
  assert.equal(
    cleanDisplayName("+ PLA VERDE SILK VOOLT3D @Bambu Lab A1 0.4 nozzle"),
    "+ PLA VERDE SILK VOOLT3D"
  );
});

test("parseBambuFilamentPreset usa filament_id como source_key", () => {
  const profile = parseBambuFilamentPreset(
    {
      name: "+ PLA VERDE SILK VOOLT3D @Bambu Lab A1 0.4 nozzle",
      filament_id: ["Pef1676d"],
      filament_type: ["PLA"],
      filament_vendor: ["PLA"],
      filament_settings_id: [
        "+ PLA VERDE SILK VOOLT3D @Bambu Lab A1 0.4 nozzle",
      ],
      filament_density: ["1.24"],
      filament_diameter: ["1.75"],
      version: "2.4.0.9",
    },
    "+ PLA VERDE SILK VOOLT3D @Bambu Lab A1 0.4 nozzle.json"
  );

  assert.ok(profile);
  assert.equal(profile.source_key, "Pef1676d");
  assert.equal(profile.material, "PLA");
  assert.equal(profile.display_name, "+ PLA VERDE SILK VOOLT3D");
  assert.equal(profile.brand, "VOOLT3D");
});

test("preset calibrado sem filament_id é ignorado", () => {
  const profile = parseBambuFilamentPreset(
    {
      name: "PLA VERMELHO VOOLT3D CALIBRADO",
      inherits:
        "+ PLA VERMELHO VELVET VOOLT3D @Bambu Lab A1 0.4 nozzle",
      filament_settings_id: ["PLA VERMELHO VOOLT3D CALIBRADO"],
    },
    "PLA VERMELHO VOOLT3D CALIBRADO.json"
  );

  assert.equal(profile, null);
});

test("getBambuStudioBaseDirectories ignora user default", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-bambu-"));

  try {
    const userRoot = path.join(temp, "BambuStudio", "user");

    fs.mkdirSync(
      path.join(userRoot, "123", "filament", "base"),
      { recursive: true }
    );

    fs.mkdirSync(
      path.join(userRoot, "default", "filament", "base"),
      { recursive: true }
    );

    const dirs = getBambuStudioBaseDirectories(temp);

    assert.equal(dirs.length, 1);
    assert.match(dirs[0], /123[\\/]filament[\\/]base$/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("readBambuStudioFilamentProfiles deduplica pelo filament_id", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-bambu-"));

  try {
    const baseA = path.join(
      temp,
      "BambuStudio",
      "user",
      "111",
      "filament",
      "base"
    );

    const baseB = path.join(
      temp,
      "BambuStudio",
      "user",
      "222",
      "filament",
      "base"
    );

    fs.mkdirSync(baseA, { recursive: true });
    fs.mkdirSync(baseB, { recursive: true });

    const preset = {
      name: "+ PLA VERDE SILK VOOLT3D @Bambu Lab A1 0.4 nozzle",
      filament_id: ["Pef1676d"],
      filament_type: ["PLA"],
      filament_vendor: ["PLA"],
    };

    fs.writeFileSync(
      path.join(baseA, "a.json"),
      JSON.stringify(preset),
      "utf8"
    );

    fs.writeFileSync(
      path.join(baseB, "b.json"),
      JSON.stringify(preset),
      "utf8"
    );

    const profiles = readBambuStudioFilamentProfiles(temp);

    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].source_key, "Pef1676d");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("getBambuStudioBaseDirectories descobre BambuStudio, BambuStudioBeta e OrcaSlicer", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-slicers-"));

  try {
    const stableBase = path.join(temp, "BambuStudio", "user", "100", "filament", "base");
    const betaBase = path.join(temp, "BambuStudioBeta", "user", "200", "filament", "base");
    // OrcaSlicer não criado (simula pasta ausente)

    fs.mkdirSync(stableBase, { recursive: true });
    fs.mkdirSync(betaBase, { recursive: true });

    const dirs = getBambuStudioBaseDirectories(temp);

    assert.equal(dirs.length, 2);
    assert.ok(dirs.some((d) => d.includes("BambuStudio") && d.includes("100")));
    assert.ok(dirs.some((d) => d.includes("BambuStudioBeta") && d.includes("200")));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("readBambuStudioFilamentProfiles descobre novo perfil em BambuStudioBeta e deduplica com Stable", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-sync-multi-"));

  try {
    const stableBase = path.join(temp, "BambuStudio", "user", "userA", "filament", "base");
    const betaBase = path.join(temp, "BambuStudioBeta", "user", "userA", "filament", "base");

    fs.mkdirSync(stableBase, { recursive: true });
    fs.mkdirSync(betaBase, { recursive: true });

    // Perfil compartilhado entre Stable e Beta (mesmo filament_id)
    const sharedPreset = {
      name: "+ PLA PRETO VELVET VOOLT3D @Bambu Lab A1 0.4 nozzle",
      filament_id: ["Paaadef6"],
      filament_type: ["PLA"],
      filament_vendor: ["VOOLT3D"],
    };

    // Perfil novo exclusivo da versão Beta
    const newBetaPreset = {
      name: "+ PLA BRANCO ULTRA SILK VIDA BUENAS @Bambu Lab A1 0.4 nozzle",
      filament_id: ["P6337f36"],
      filament_type: ["PLA"],
      filament_vendor: ["+"],
    };

    fs.writeFileSync(path.join(stableBase, "preto.json"), JSON.stringify(sharedPreset), "utf8");
    fs.writeFileSync(path.join(betaBase, "preto_copy.json"), JSON.stringify(sharedPreset), "utf8");
    fs.writeFileSync(path.join(betaBase, "novo_buenas.json"), JSON.stringify(newBetaPreset), "utf8");

    const profiles = readBambuStudioFilamentProfiles(temp);

    assert.equal(profiles.length, 2);
    const keys = profiles.map((p) => p.source_key).sort();
    assert.deepEqual(keys, ["P6337f36", "Paaadef6"]);

    const buenas = profiles.find((p) => p.source_key === "P6337f36");
    assert.ok(buenas);
    assert.equal(buenas.display_name, "+ PLA BRANCO ULTRA SILK VIDA BUENAS");
    assert.equal(buenas.material, "PLA");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("readBambuStudioFilamentProfiles ignora JSON inválido sem falhar o ciclo", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-corrupt-"));

  try {
    const base = path.join(temp, "BambuStudio", "user", "999", "filament", "base");
    fs.mkdirSync(base, { recursive: true });

    fs.writeFileSync(path.join(base, "corrupt.json"), "{ invalid json syntax !!", "utf8");
    fs.writeFileSync(
      path.join(base, "valid.json"),
      JSON.stringify({
        name: "Valido",
        filament_id: ["Pvalid123"],
        filament_type: ["PETG"],
      }),
      "utf8"
    );

    const profiles = readBambuStudioFilamentProfiles(temp);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].source_key, "Pvalid123");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
// ---------------------------------------------------------------------------
// Fatiador em uso: só os perfis da pasta alterada por último vão para a lista
// (caso real 2026-09-28: BambuStudio parado desde 22/09, BambuStudioBeta em uso,
// mesmos produtos com filament_id diferentes após renomear os presets).
// ---------------------------------------------------------------------------

function writePreset(dir: string, file: string, name: string, id: string, mtime: Date) {
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, file);
  fs.writeFileSync(full, JSON.stringify({ name: `${name} @Bambu Lab A1 0.4 nozzle`, filament_id: [id], filament_type: [name.includes("PETG") ? "PETG" : "PLA"] }), "utf8");
  fs.utimesSync(full, mtime, mtime);
}

test("readBambuStudioFilamentProfiles: lista só a pasta em uso; a antiga fica guardada fora da lista", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-active-"));
  try {
    const stable = path.join(temp, "BambuStudio", "user", "838867154", "filament", "base");
    const beta = path.join(temp, "BambuStudioBeta", "user", "838867154", "filament", "base");
    const old = new Date("2026-09-22T10:08:00Z");
    const recent = new Date("2026-09-27T17:42:00Z");

    writePreset(stable, "a.json", "- PETG BRANCO MASTERPRINT", "P5881e45", old);
    writePreset(stable, "b.json", "+ PLA AZUL VELVET VOOLT3D", "P0ebefee", old);
    writePreset(stable, "c.json", "+ PLA ROSA CHOQUE VOOLT", "Pc11e481", old);
    writePreset(beta, "a.json", "- PETG BRANCO MASTERPRINT", "P915cab1", old);
    writePreset(beta, "b.json", "+ PLA AZUL VELVET VOOLT", "P83e3058", old);
    writePreset(beta, "c.json", "+ PLA ROSA CHOQUE VOOLT", "Pc11e481", old);
    writePreset(beta, "d.json", "+ PLA BRANCO ULTRA SILK VIDA BUENAS", "P6337f36", recent);

    const profiles = readBambuStudioFilamentProfiles(temp);
    const listed = profiles.filter((p) => p.listed).map((p) => p.source_key).sort();
    const hidden = profiles.filter((p) => !p.listed).map((p) => p.source_key).sort();

    assert.deepEqual(listed, ["P6337f36", "P83e3058", "P915cab1", "Pc11e481"]);
    assert.deepEqual(hidden, ["P0ebefee", "P5881e45"], "IDs antigos guardados para AMS/nuvem/carretéis");
    const names = profiles.filter((p) => p.listed).map((p) => p.display_name);
    assert.equal(new Set(names).size, names.length, "nenhum nome repetido na lista");
    const shared = profiles.find((p) => p.source_key === "Pc11e481");
    assert.equal(shared?.source_metadata.slicer_dir, "BambuStudioBeta", "ID presente nas duas pastas fica com a da pasta em uso");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("readBambuStudioFilamentProfiles: com uma pasta só, tudo é listado", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-single-"));
  try {
    const base = path.join(temp, "BambuStudio", "user", "1", "filament", "base");
    writePreset(base, "a.json", "+ PLA X", "P1", new Date());
    writePreset(base, "b.json", "- PETG Y", "P2", new Date());
    assert.ok(readBambuStudioFilamentProfiles(temp).every((p) => p.listed));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("syncBambuStudioFilamentProfiles: grava is_listed e tira da lista o que sumiu do fatiador", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-syncdb-"));
  try {
    const base = path.join(temp, "BambuStudio", "user", "1", "filament", "base");
    writePreset(base, "a.json", "+ PLA X", "P1", new Date());
    const calls: any[] = [];
    const fake: any = {
      from() {
        return {
          upsert(rows: any) { calls.push({ op: "upsert", rows }); return Promise.resolve({ error: null }); },
          update(payload: any) {
            const call: any = { op: "update", payload, filters: [] };
            calls.push(call);
            const q: any = {
              eq(c: string, v: any) { call.filters.push(["eq", c, v]); return q; },
              not(c: string, o: string, v: any) { call.filters.push(["not", c, o, v]); return Promise.resolve({ error: null }); },
            };
            return q;
          },
        };
      },
    };
    const n = await syncBambuStudioFilamentProfiles(fake, "user-1", temp);
    assert.equal(n, 1);
    assert.equal(calls[0].rows[0].is_listed, true);
    assert.deepEqual(calls[1].payload, { is_listed: false });
    assert.deepEqual(calls[1].filters.at(-1), ["not", "source_key", "in", '("P1")']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("syncBambuStudioFilamentProfiles: banco sem a coluna is_listed continua sincronizando", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-legacy-"));
  try {
    const base = path.join(temp, "BambuStudio", "user", "1", "filament", "base");
    writePreset(base, "a.json", "+ PLA X", "P1", new Date());
    const upserts: any[] = [];
    const fake: any = {
      from() {
        return {
          upsert(rows: any) {
            upserts.push(rows);
            return Promise.resolve({ error: "is_listed" in rows[0] ? { code: "PGRST204", message: "Could not find the 'is_listed' column" } : null });
          },
          update() { throw new Error("não deve tentar despublicar sem a coluna"); },
        };
      },
    };
    assert.equal(await syncBambuStudioFilamentProfiles(fake, "user-1", temp), 1);
    assert.equal(upserts.length, 2);
    assert.ok(!("is_listed" in upserts[1][0]));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
