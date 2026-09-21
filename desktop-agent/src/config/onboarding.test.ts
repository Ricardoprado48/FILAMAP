import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveAgentRuntimeConfig,
  computeMissingFields,
  hasCompleteEnvConfig,
  readEnvOverrides,
  MissingField,
  OnboardingPrompts,
  DiscoveryPort,
} from "./onboarding";
import { mergeNonSecretConfig } from "./configStore";
import { SecretStore, AgentSecrets } from "./secretStore";

class FakeSecretStore implements SecretStore {
  readonly kind = "fake";
  readonly persists: boolean;
  private secrets: AgentSecrets;
  saved: AgentSecrets[] = [];

  constructor(initial: AgentSecrets, persists = true) {
    this.secrets = initial;
    this.persists = persists;
  }

  async load(): Promise<AgentSecrets> {
    return this.secrets;
  }

  async save(secrets: AgentSecrets): Promise<void> {
    this.saved.push(secrets);
    this.secrets = secrets;
  }

  async clear(): Promise<void> {
    this.secrets = { supabaseRefreshToken: null, printerAccessCode: null };
  }
}

class FakePrompts implements OnboardingPrompts {
  notifications: string[] = [];
  calls: string[] = [];
  cannotPromptCalledWith: MissingField[] | null = null;

  constructor(
    private answers: {
      email?: string;
      password?: string;
      serial?: string;
      accessCode?: string;
    } = {}
  ) {}

  notify(message: string): void {
    this.notifications.push(message);
  }

  async askEmail(): Promise<string> {
    this.calls.push("askEmail");
    return this.answers.email ?? "";
  }

  async askPassword(): Promise<string> {
    this.calls.push("askPassword");
    return this.answers.password ?? "";
  }

  async askPrinterSerial(): Promise<string> {
    this.calls.push("askPrinterSerial");
    return this.answers.serial ?? "";
  }

  async askPrinterAccessCode(): Promise<string> {
    this.calls.push("askPrinterAccessCode");
    return this.answers.accessCode ?? "";
  }

  onCannotPrompt(missing: MissingField[]): never {
    this.cannotPromptCalledWith = missing;
    throw new Error(`CANNOT_PROMPT:${missing.join(",")}`);
  }
}

function fakeDiscovery(result: { ip: string; serial: string }): DiscoveryPort {
  return {
    async discoverPrinter() {
      return result;
    },
  };
}

function useTempConfigDir(t: any): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-onboarding-test-"));
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousAppData = process.env.APPDATA;
  // getConfigDir() (usado por mergeNonSecretConfig/loadNonSecretConfig) usa
  // process.platform real -- em Windows isso lê APPDATA, não
  // XDG_CONFIG_HOME, então os dois precisam ser sobrescritos pro tmpDir pra
  // nunca tocar o config.json real do usuário, independente do SO que
  // rodar o teste.
  process.env.XDG_CONFIG_HOME = tmpDir;
  process.env.APPDATA = tmpDir;

  t.after(() => {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
}

test("readEnvOverrides: limpa aspas e barra final da URL, mesma normalização de antes", () => {
  const env = readEnvOverrides({
    SUPABASE_URL: '"https://example.supabase.co/"',
    SUPABASE_ANON_KEY: "'anon-key'",
  } as NodeJS.ProcessEnv);

  assert.equal(env.supabaseUrl, "https://example.supabase.co");
  assert.equal(env.supabaseAnonKey, "anon-key");
});

test("hasCompleteEnvConfig: true só com as 5 variáveis que o Agent sempre exigiu", () => {
  const complete = readEnvOverrides({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "k",
    AGENT_EMAIL: "a@b.com",
    AGENT_PASSWORD: "pw",
    PRINTER_SERIAL: "01P00A0",
  } as NodeJS.ProcessEnv);
  assert.equal(hasCompleteEnvConfig(complete), true);

  const incomplete = readEnvOverrides({
    SUPABASE_URL: "https://x.supabase.co",
  } as NodeJS.ProcessEnv);
  assert.equal(hasCompleteEnvConfig(incomplete), false);
});

test("computeMissingFields: refresh token supre a necessidade de senha", () => {
  const missing = computeMissingFields({
    env: readEnvOverrides({} as NodeJS.ProcessEnv),
    nonSecret: {
      formatVersion: 1,
      agentEmail: "a@b.com",
      printerSerial: "01P00A0",
      lastKnownPrinterIp: "",
      onboardingCompletedAt: null,
      updatedAt: "",
    },
    secrets: { supabaseRefreshToken: "rt-1", printerAccessCode: "12345678" },
  });

  assert.deepEqual(missing, []);
});

test("resolveAgentRuntimeConfig: .env completo usa as env vars diretamente, sem tocar disco nem perguntar nada", async () => {
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    AGENT_EMAIL: "dev@example.com",
    AGENT_PASSWORD: "secret",
    PRINTER_SERIAL: "01P00A000000001",
  } as NodeJS.ProcessEnv;

  const secretStore = new FakeSecretStore({ supabaseRefreshToken: null, printerAccessCode: null });
  const prompts = new FakePrompts();

  const result = await resolveAgentRuntimeConfig(secretStore, prompts, { env, isTTY: false });

  assert.equal(result.supabaseUrl, "https://example.supabase.co");
  assert.equal(result.agentEmail, "dev@example.com");
  assert.equal(result.printerSerial, "01P00A000000001");
  assert.deepEqual(result.auth, { type: "password", password: "secret" });
  assert.equal(prompts.notifications.length, 0);
  assert.equal(prompts.calls.length, 0);
  assert.equal(secretStore.saved.length, 0);
});

test("resolveAgentRuntimeConfig: sem terminal interativo e config incompleta aciona onCannotPrompt", async (t) => {
  useTempConfigDir(t);

  const secretStore = new FakeSecretStore({ supabaseRefreshToken: null, printerAccessCode: null });
  const prompts = new FakePrompts();
  const discovery = fakeDiscovery({ ip: "", serial: "" });

  await assert.rejects(
    () =>
      resolveAgentRuntimeConfig(secretStore, prompts, {
        env: {} as NodeJS.ProcessEnv,
        isTTY: false,
        discovery,
      }),
    /CANNOT_PROMPT/
  );

  assert.ok(prompts.cannotPromptCalledWith?.includes("agentEmail"));
  assert.ok(prompts.cannotPromptCalledWith?.includes("printerAccessCode"));
});

test("resolveAgentRuntimeConfig: descoberta automática preenche serial, só falta perguntar o Access Code", async (t) => {
  useTempConfigDir(t);

  mergeNonSecretConfig({ agentEmail: "user@test.com" });

  const secretStore = new FakeSecretStore({ supabaseRefreshToken: "rt-123", printerAccessCode: null });
  const prompts = new FakePrompts({ accessCode: "87654321" });
  const discovery = fakeDiscovery({ ip: "192.168.1.50", serial: "01P00A000000009" });

  const result = await resolveAgentRuntimeConfig(secretStore, prompts, {
    env: {} as NodeJS.ProcessEnv,
    isTTY: true,
    discovery,
  });

  assert.equal(result.printerSerial, "01P00A000000009");
  assert.equal(result.printerIp, "192.168.1.50");
  assert.equal(result.printerAccessCode, "87654321");
  assert.deepEqual(result.auth, { type: "refresh_token", refreshToken: "rt-123" });

  assert.deepEqual(prompts.calls, ["askPrinterAccessCode"]);

  assert.equal(secretStore.saved.length, 1);
  assert.equal(secretStore.saved[0].printerAccessCode, "87654321");
  assert.equal(secretStore.saved[0].supabaseRefreshToken, "rt-123");
});

test("resolveAgentRuntimeConfig: SecretStore que não persiste avisa e segue mesmo assim", async (t) => {
  useTempConfigDir(t);

  mergeNonSecretConfig({ agentEmail: "user@test.com", printerSerial: "01P00A000000009" });

  const secretStore = new FakeSecretStore(
    { supabaseRefreshToken: null, printerAccessCode: null },
    /* persists */ false
  );
  const prompts = new FakePrompts({ password: "senha-temp", accessCode: "11112222" });
  const discovery = fakeDiscovery({ ip: "", serial: "" });

  const result = await resolveAgentRuntimeConfig(secretStore, prompts, {
    env: {} as NodeJS.ProcessEnv,
    isTTY: true,
    discovery,
  });

  assert.deepEqual(result.auth, { type: "password", password: "senha-temp" });
  assert.equal(result.printerAccessCode, "11112222");
  assert.equal(secretStore.saved.length, 0);
  assert.ok(prompts.notifications.some((n) => n.includes("não será lembrado")));
});
