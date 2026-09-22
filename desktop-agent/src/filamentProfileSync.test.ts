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