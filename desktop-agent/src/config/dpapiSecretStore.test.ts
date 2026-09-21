import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WindowsDpapiSecretStore } from "./dpapiSecretStore";

// `powershell.exe` não existe neste ambiente de teste (Linux), então os
// testes injetam um protect/unprotect fake -- reversível, mas não é
// identidade nem base64 simples, pra que "o arquivo não contém o segredo
// em texto puro" seja uma checagem real e não um acidente de codificação.
const FAKE_KEY = Buffer.from("filamap-fake-dpapi-key");

function fakeXor(input: Buffer): Buffer {
  const out = Buffer.alloc(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] ^ FAKE_KEY[i % FAKE_KEY.length];
  }
  return out;
}

function makeTempFilePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "filamap-secretstore-"));
  return path.join(dir, "secrets.dat");
}

function makeStore(filePath: string) {
  return new WindowsDpapiSecretStore({
    filePath,
    protect: fakeXor,
    unprotect: fakeXor, // XOR é simétrico
  });
}

test("WindowsDpapiSecretStore: kind e persists", () => {
  const store = makeStore(makeTempFilePath());
  assert.equal(store.kind, "windows-dpapi");
  assert.equal(store.persists, true);
});

test("WindowsDpapiSecretStore: save() seguido de load() devolve os mesmos segredos", async () => {
  const filePath = makeTempFilePath();
  const store = makeStore(filePath);

  await store.save({ supabaseRefreshToken: "rt-abc123", printerAccessCode: "87654321" });
  const loaded = await store.load();

  assert.equal(loaded.supabaseRefreshToken, "rt-abc123");
  assert.equal(loaded.printerAccessCode, "87654321");
});

test("WindowsDpapiSecretStore: save() cria o diretório do arquivo se não existir", async () => {
  const nestedPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "filamap-secretstore-")),
    "nested",
    "dir",
    "secrets.dat"
  );
  const store = makeStore(nestedPath);

  await store.save({ supabaseRefreshToken: "rt-x", printerAccessCode: "y" });

  assert.equal(fs.existsSync(nestedPath), true);
});

test("WindowsDpapiSecretStore: clear() remove o arquivo e load() volta a ficar vazio", async () => {
  const filePath = makeTempFilePath();
  const store = makeStore(filePath);

  await store.save({ supabaseRefreshToken: "rt-abc123", printerAccessCode: "87654321" });
  assert.equal(fs.existsSync(filePath), true);

  await store.clear();

  assert.equal(fs.existsSync(filePath), false);
  const loaded = await store.load();
  assert.equal(loaded.supabaseRefreshToken, null);
  assert.equal(loaded.printerAccessCode, null);
});

test("WindowsDpapiSecretStore: clear() sem arquivo existente não lança erro", async () => {
  const store = makeStore(makeTempFilePath());
  await store.clear();
});

test("WindowsDpapiSecretStore: load() sem arquivo (nunca salvo) devolve segredos vazios", async () => {
  const store = makeStore(makeTempFilePath());
  const loaded = await store.load();
  assert.equal(loaded.supabaseRefreshToken, null);
  assert.equal(loaded.printerAccessCode, null);
});

test("WindowsDpapiSecretStore: load() com arquivo corrompido (bytes aleatórios) devolve vazio, não lança", async () => {
  const filePath = makeTempFilePath();
  fs.writeFileSync(filePath, Buffer.from([0x00, 0xff, 0x10, 0x42, 0x99, 0x01]));

  const store = makeStore(filePath);
  const loaded = await store.load();

  assert.equal(loaded.supabaseRefreshToken, null);
  assert.equal(loaded.printerAccessCode, null);
});

test("WindowsDpapiSecretStore: load() quando unprotect() falha (ex.: DPAPI recusa) devolve vazio, não lança", async () => {
  const filePath = makeTempFilePath();
  fs.writeFileSync(filePath, Buffer.from("qualquer coisa"));

  const store = new WindowsDpapiSecretStore({
    filePath,
    protect: fakeXor,
    unprotect: () => {
      throw new Error("simulated DPAPI failure (ex.: outro usuário do Windows)");
    },
  });

  const loaded = await store.load();
  assert.equal(loaded.supabaseRefreshToken, null);
  assert.equal(loaded.printerAccessCode, null);
});

test("WindowsDpapiSecretStore: load() com JSON decriptografado inválido devolve vazio, não lança", async () => {
  const filePath = makeTempFilePath();
  // protect() de algo que não é um JSON válido -- simula um blob que passa
  // pela descriptografia DPAPI mas cujo conteúdo não é o formato esperado.
  fs.writeFileSync(filePath, fakeXor(Buffer.from("isto não é json", "utf-8")));

  const store = makeStore(filePath);
  const loaded = await store.load();

  assert.equal(loaded.supabaseRefreshToken, null);
  assert.equal(loaded.printerAccessCode, null);
});

test("WindowsDpapiSecretStore: Access Code e refresh token nunca aparecem em texto puro no arquivo", async () => {
  const filePath = makeTempFilePath();
  const store = makeStore(filePath);

  const secretRefreshToken = "rt-super-secret-marker-zzz111";
  const secretAccessCode = "ACCESSCODE99887766";

  await store.save({
    supabaseRefreshToken: secretRefreshToken,
    printerAccessCode: secretAccessCode,
  });

  const raw = fs.readFileSync(filePath);
  const rawUtf8 = raw.toString("utf-8");
  const rawLatin1 = raw.toString("latin1");
  const rawBase64 = raw.toString("base64");

  for (const needle of [
    secretRefreshToken,
    secretAccessCode,
    "supabaseRefreshToken",
    "printerAccessCode",
  ]) {
    assert.equal(rawUtf8.includes(needle), false, `"${needle}" vazou em utf-8 no arquivo`);
    assert.equal(rawLatin1.includes(needle), false, `"${needle}" vazou em latin1 no arquivo`);
    assert.equal(rawBase64.includes(needle), false, `"${needle}" vazou em base64 no arquivo`);
  }
});
