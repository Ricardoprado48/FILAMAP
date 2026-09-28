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