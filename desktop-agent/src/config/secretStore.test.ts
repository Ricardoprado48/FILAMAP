import test from "node:test";
import assert from "node:assert/strict";
import { EnvSecretStore, UnavailableSecretStore, resolveSecretStore } from "./secretStore";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }

  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("EnvSecretStore: lê PRINTER_ACCESS_CODE e SUPABASE_REFRESH_TOKEN do ambiente", async () => {
  await withEnv(
    { PRINTER_ACCESS_CODE: "12345678", SUPABASE_REFRESH_TOKEN: "rt-abc" },
    async () => {
      const store = new EnvSecretStore();
      const secrets = await store.load();
      assert.equal(secrets.printerAccessCode, "12345678");
      assert.equal(secrets.supabaseRefreshToken, "rt-abc");
    }
  );
});

test("EnvSecretStore: campos ausentes viram null, não string vazia", async () => {
  await withEnv(
    { PRINTER_ACCESS_CODE: undefined, SUPABASE_REFRESH_TOKEN: undefined },
    async () => {
      const store = new EnvSecretStore();
      const secrets = await store.load();
      assert.equal(secrets.printerAccessCode, null);
      assert.equal(secrets.supabaseRefreshToken, null);
    }
  );
});

test("EnvSecretStore: save()/clear() são no-op e persists é true", async () => {
  const store = new EnvSecretStore();
  assert.equal(store.persists, true);
  await store.save({ supabaseRefreshToken: "x", printerAccessCode: "y" });
  await store.clear();
});

test("UnavailableSecretStore: load() sempre vazio e persists é false", async () => {
  const store = new UnavailableSecretStore();
  assert.equal(store.persists, false);
  const secrets = await store.load();
  assert.equal(secrets.printerAccessCode, null);
  assert.equal(secrets.supabaseRefreshToken, null);
});

test("resolveSecretStore: usa EnvSecretStore quando PRINTER_ACCESS_CODE está no ambiente", () => {
  withEnv(
    { PRINTER_ACCESS_CODE: "12345678", SUPABASE_REFRESH_TOKEN: undefined },
    () => {
      const store = resolveSecretStore();
      assert.equal(store.kind, "env");
    }
  );
});

test("resolveSecretStore: usa EnvSecretStore quando só SUPABASE_REFRESH_TOKEN está no ambiente", () => {
  withEnv(
    { PRINTER_ACCESS_CODE: undefined, SUPABASE_REFRESH_TOKEN: "rt-abc" },
    () => {
      const store = resolveSecretStore();
      assert.equal(store.kind, "env");
    }
  );
});

test("resolveSecretStore: cai para UnavailableSecretStore sem nenhum dos dois (Linux/macOS)", () => {
  withEnv(
    { PRINTER_ACCESS_CODE: undefined, SUPABASE_REFRESH_TOKEN: undefined },
    () => {
      const store = resolveSecretStore("linux");
      assert.equal(store.kind, "unavailable");
    }
  );
});

test("resolveSecretStore: usa WindowsDpapiSecretStore no Windows sem segredos no ambiente", () => {
  withEnv(
    { PRINTER_ACCESS_CODE: undefined, SUPABASE_REFRESH_TOKEN: undefined },
    () => {
      const store = resolveSecretStore("win32");
      assert.equal(store.kind, "windows-dpapi");
      assert.equal(store.persists, true);
    }
  );
});

test("resolveSecretStore: no Windows, .env ainda tem prioridade sobre o DPAPI", () => {
  withEnv(
    { PRINTER_ACCESS_CODE: "12345678", SUPABASE_REFRESH_TOKEN: undefined },
    () => {
      const store = resolveSecretStore("win32");
      assert.equal(store.kind, "env");
    }
  );
});
