// Serial da impressora unico POR CONTA (20261003100000) contra o banco de TESTE. Recusa producao.
// A = usuario principal de teste (ja tem a impressora real), B = user2.
const { createRequire } = require("module");
const req = createRequire("C:/FILAMAP-staging/desktop-agent/package.json");
const { createClient } = req("@supabase/supabase-js");

const K = JSON.parse(process.env.STAGING_CREDS);
const U2 = JSON.parse(process.env.STAGING_USER2);
if (K.url.includes("gqtlszffgvxsqcmefhyd")) throw new Error("Recusado: producao.");
let falhas = 0;
const ok = (cond, msg, extra) => { console.log((cond ? "OK   " : "FALHA") + " " + msg + (cond || extra === undefined ? "" : " -> " + JSON.stringify(extra))); if (!cond) falhas++; };
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

(async () => {
  const A = createClient(K.url, K.anon, opts);
  const B = createClient(K.url, K.anon, opts);
  const la = await A.auth.signInWithPassword({ email: K.email, password: K.password });
  const lb = await B.auth.signInWithPassword({ email: U2.email, password: U2.password });
  if (la.error || lb.error) throw la.error || lb.error;
  const idB = lb.data.user.id;
  const { data: pa } = await A.from("printers").select("id,serial,user_id");
  ok(pa && pa.length >= 1, "A ve a propria impressora", pa);
  const serial = pa[0].serial;
  let criado = null;
  try {
    const { data: vb } = await B.from("printers").select("id").eq("serial", serial);
    ok(vb.length === 0, "B nao ve a impressora de A (RLS)", vb);

    const ins = await B.from("printers").insert({ user_id: idB, serial, model: "A1", is_online: false }).select().single();
    ok(!ins.error, "B registra o MESMO serial na propria conta", ins.error);
    criado = ins.data;

    const dup = await B.from("printers").insert({ user_id: idB, serial, model: "A1", is_online: false });
    ok(dup.error && dup.error.code === "23505", "B nao duplica o serial na propria conta (23505)", dup.error);

    const alheio = await B.from("printers").insert({ user_id: la.data.user.id, serial: "OUTRO-" + Date.now(), model: "A1" });
    ok(!!alheio.error, "B nao cria impressora em nome de A (RLS)", alheio.error);

    const semDono = await B.from("printers").insert({ serial: "SEMDONO-" + Date.now(), model: "A1" }).select().single();
    ok(!semDono.error && semDono.data.user_id === idB, "sem user_id explicito o dono vira o proprio B (default auth.uid())", semDono.error || semDono.data);
    if (semDono.data) await B.from("printers").delete().eq("id", semDono.data.id);

    const { data: pa2 } = await A.from("printers").select("id,serial").eq("serial", serial);
    ok(pa2.length === 1 && pa2[0].id === pa[0].id, "A continua vendo so a propria (mesmo id)", pa2);
  } finally {
    if (criado) { const d = await B.from("printers").delete().eq("id", criado.id); ok(!d.error, "limpeza: impressora de B apagada", d.error); }
    await A.auth.signOut({ scope: "local" }); await B.auth.signOut({ scope: "local" });
  }
  console.log(falhas === 0 ? "\nPRINTER_SERIAL_POR_CONTA_OK" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})();
