import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveConfigDir,
  mergeNonSecretConfig,
  loadNonSecretConfig,
  CONFIG_FORMAT_VERSION,
} from "./configStore";

test("resolveConfigDir: win32 usa APPDATA quando definido", () => {
  const dir = resolveConfigDir("win32", "C:\\Users\\ricardo", {
    APPDATA: "C:\\Users\\ricardo\\AppData\\Roaming",
  });
  assert.equal(dir, "C:\\Users\\ricardo\\AppData\\Roaming\\Filamap");
});

test("resolveConfigDir: win32 sem APPDATA cai para AppData\\Roaming do homedir", () => {
  const dir = resolveConfigDir("win32", "C:\\Users\\ricardo", {});
  assert.equal(dir, "C:\\Users\\ricardo\\AppData\\Roaming\\Filamap");
});

test("resolveConfigDir: darwin usa Library/Application Support", () => {
  const dir = resolveConfigDir("darwin", "/Users/ricardo", {});
  assert.equal(dir, "/Users/ricardo/Library/Application Support/Filamap");
});

test("resolveConfigDir: linux usa XDG_CONFIG_HOME quando definido", () => {
  const dir = resolveConfigDir("linux", "/home/ricardo", {
    XDG_CONFIG_HOME: "/home/ricardo/.myconfig",
  });
  assert.equal(dir, "/home/ricardo/.myconfig/filamap");
});

test("resolveConfigDir: linux sem XDG_CONFIG_HOME cai para ~/.config", () => {
  const dir = resolveConfigDir("linux", "/home/ricardo", {});
  assert.equal(dir, "/home/ricardo/.config/filamap");
});

test("mergeNonSecretConfig: persiste patch e preserva campos não alterados", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-config-test-"));
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalAppData = process.env.APPDATA;
  // getConfigDir() usa process.platform real (não um valor injetado), então
  // em Windows é APPDATA que decide o diretório, não XDG_CONFIG_HOME -- os
  // dois precisam apontar pro tmpDir pra isolar o teste em qualquer SO.
  process.env.XDG_CONFIG_HOME = tmpDir;
  process.env.APPDATA = tmpDir;

  t.after(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const first = mergeNonSecretConfig({ agentEmail: "user@example.com" });
  assert.equal(first.agentEmail, "user@example.com");
  assert.equal(first.printerSerial, "");
  assert.equal(first.formatVersion, CONFIG_FORMAT_VERSION);

  const second = mergeNonSecretConfig({ printerSerial: "01P00A000000000" });
  assert.equal(second.agentEmail, "user@example.com");
  assert.equal(second.printerSerial, "01P00A000000000");

  const loaded = loadNonSecretConfig();
  assert.equal(loaded?.agentEmail, "user@example.com");
  assert.equal(loaded?.printerSerial, "01P00A000000000");
});

test("loadNonSecretConfig: retorna null se arquivo não existe", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-config-test-empty-"));
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalAppData = process.env.APPDATA;
  process.env.XDG_CONFIG_HOME = tmpDir;
  process.env.APPDATA = tmpDir;

  t.after(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  assert.equal(loadNonSecretConfig(), null);
});
