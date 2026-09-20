import { describe, it, expect } from "vitest";
import { resolveConfigDir, missingRequiredFields, DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_ANON_KEY, AgentConfig } from "./store";

describe("resolveConfigDir", () => {
  it("usa %APPDATA%\\Filamap no Windows", () => {
    const dir = resolveConfigDir("win32", "C:\\Users\\ricardo", { APPDATA: "C:\\Users\\ricardo\\AppData\\Roaming" });
    expect(dir).toBe("C:\\Users\\ricardo\\AppData\\Roaming\\Filamap");
  });

  it("monta APPDATA a partir do homedir quando a variável de ambiente não existe", () => {
    const dir = resolveConfigDir("win32", "C:\\Users\\ricardo", {});
    expect(dir).toContain("Filamap");
    expect(dir).toContain("AppData");
  });

  it("usa Library/Application Support no macOS", () => {
    const dir = resolveConfigDir("darwin", "/Users/ricardo", {});
    expect(dir).toBe("/Users/ricardo/Library/Application Support/Filamap");
  });

  it("usa XDG_CONFIG_HOME/filamap no Linux quando definido", () => {
    const dir = resolveConfigDir("linux", "/home/ricardo", { XDG_CONFIG_HOME: "/home/ricardo/.config" });
    expect(dir).toBe("/home/ricardo/.config/filamap");
  });

  it("cai para ~/.config/filamap no Linux sem XDG_CONFIG_HOME", () => {
    const dir = resolveConfigDir("linux", "/home/ricardo", {});
    expect(dir).toBe("/home/ricardo/.config/filamap");
  });
});

function fullConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    supabaseUrl: DEFAULT_SUPABASE_URL,
    supabaseAnonKey: DEFAULT_SUPABASE_ANON_KEY,
    agentEmail: "user@example.com",
    agentPassword: "senha123",
    printerIp: "",
    printerSerial: "01P00A000000000",
    printerAccessCode: "12345678",
    ...overrides,
  };
}

describe("missingRequiredFields", () => {
  it("retorna vazio quando tudo que o onboarding pede está presente", () => {
    expect(missingRequiredFields(fullConfig())).toEqual([]);
  });

  it("não exige printerIp (descoberta automática cobre isso)", () => {
    expect(missingRequiredFields(fullConfig({ printerIp: "" }))).toEqual([]);
  });

  it("aponta cada campo obrigatório faltando", () => {
    const missing = missingRequiredFields(
      fullConfig({ agentEmail: "", agentPassword: "", printerSerial: "", printerAccessCode: "" })
    );
    expect(missing).toEqual(["agentEmail", "agentPassword", "printerSerial", "printerAccessCode"]);
  });

  it("aponta só o access code quando o resto já está preenchido", () => {
    expect(missingRequiredFields(fullConfig({ printerAccessCode: "" }))).toEqual(["printerAccessCode"]);
  });
});
