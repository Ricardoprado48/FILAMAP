// Cadastro por convite (20261004100000 + Edge Function signup-invite) contra o banco de TESTE.
// A = usuario principal de teste (admin da Central), B = user2 (nao admin), anon.
const { createRequire } = require("module");
const req = createRequire("C:/FILAMAP-staging/desktop-agent/package.json");
const { createClient } = req("@supabase/supabase-js");

const K = JSON.parse(process.env.STAGING_CREDS);
const U2 = JSON.parse(process.env.STAGING_USER2);
if (K.url.includes("gqtlszffgvxsqcmefhyd")) throw new Error("Recusado: producao.");
let falhas = 0;
const ok = (cond, msg, extra) => { console.log((cond ? "OK   " : "FALHA") + " " + msg + (cond || extra === undefined ? "" : " -> " + JSON.stringify(extra))); if (!cond) falhas++; };
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const stamp = Date.now();
const mail = (n) => `convite-e2e-${stamp}-${n}@example.com`;
const SENHA = "SenhaTeste-" + stamp;

async function signup(body) {
  const r = await fetch(`${K.url}/functions/v1/signup-invite`, {
    method: "POST",
    headers: { apikey: K.anon, Authorization: `Bearer ${K.anon}`, "Content-Type": "application/json" },
    body: JSON.stringify({ terms_version: "piloto-2026-09-29", ...body }),
  });
  let j = {};
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

(async () => {
  const svc = createClient(K.url, K.service_role, opts);
  const anon = createClient(K.url, K.anon, opts);
  const A = createClient(K.url, K.anon, opts);
  const B = createClient(K.url, K.anon, opts);
  const la = await A.auth.signInWithPassword({ email: K.email, password: K.password });
  const lb = await B.auth.signInWithPassword({ email: U2.email, password: U2.password });
  if (la.error || lb.error) throw la.error || lb.error;
  const criados = [];
  const convites = [];
  try {
    const an = await anon.rpc("create_signup_invite", { p_label: "x" });
    ok(!!an.error, "anon nao gera convite", an.error);
    const bn = await B.rpc("create_signup_invite", { p_label: "x" });
    ok(!!bn.error, "usuario comum nao gera convite", bn.error);
    const bl = await B.rpc("list_signup_invites");
    ok(!!bl.error, "usuario comum nao lista convites", bl.error);
    const tab = await B.from("signup_invites").select("id");
    ok(!!tab.error || (tab.data || []).length === 0, "tabela de convites inacessivel direto", tab.data);

    const c1 = await A.rpc("create_signup_invite", { p_label: "e2e dois usos", p_max_uses: 2, p_days: 1 });
    ok(!c1.error && /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(c1.data?.[0]?.code || ""), "admin gera convite XXXXX-XXXXX", c1.error || c1.data);
    const code = c1.data[0].code;
    const inv = (await svc.from("signup_invites").select("id,code_hash").eq("label", "e2e dois usos").order("created_at", { ascending: false }).limit(1)).data[0];
    convites.push(inv.id);
    ok(inv.code_hash.length === 64 && !inv.code_hash.includes(code.replace("-", "")), "banco guarda so o hash do codigo", inv);

    const direto = await anon.auth.signUp({ email: mail("direto"), password: SENHA });
    ok(!!direto.error, "cadastro publico direto bloqueado (disable_signup)", direto.data);
    const res = await anon.rpc("reserve_signup_invite", { p_code: code });
    ok(!!res.error, "anon nao chama reserve_signup_invite direto", res.error);

    let r = await signup({ code: "AAAAA-AAAAA", email: mail(0), password: SENHA });
    ok(r.status === 400 && r.body.error === "invalid_invite", "codigo errado recusado", r);
    r = await signup({ code, email: mail(0), password: "123" });
    ok(r.status === 400 && r.body.error === "weak_password", "senha curta recusada", r);
    r = await signup({ code, email: "nao-e-email", password: SENHA });
    ok(r.status === 400 && r.body.error === "invalid_email", "e-mail invalido recusado", r);
    r = await signup({ code, email: mail(0), password: SENHA, terms_version: "" });
    ok(r.status === 400 && r.body.error === "terms_required", "sem aceite do aviso de privacidade recusado", r);
    let st = (await svc.from("signup_invites").select("used_count").eq("id", inv.id).single()).data;
    ok(st.used_count === 0, "recusas antes de criar a conta nao gastam o convite", st);

    r = await signup({ code: code.toLowerCase(), email: mail(1), password: SENHA });
    ok(r.status === 200 && r.body.ok, "convite valido cria a conta (codigo em minusculas aceito)", r);
    const n1 = createClient(K.url, K.anon, opts);
    const l1 = await n1.auth.signInWithPassword({ email: mail(1), password: SENHA });
    ok(!l1.error && !!l1.data.user?.email_confirmed_at, "conta nova entra direto, e-mail ja confirmado", l1.error);
    const meta = l1.data.user?.user_metadata || {};
    ok(meta.terms_version === "piloto-2026-09-29" && !!meta.terms_accepted_at, "aceite do aviso gravado na conta (versao + data)", meta);
    if (l1.data.user) criados.push(l1.data.user.id);

    r = await signup({ code, email: mail(1), password: SENHA });
    ok(r.status === 409 && r.body.error === "email_exists", "e-mail repetido recusado (409)", r);
    st =(await svc.from("signup_invites").select("used_count").eq("id", inv.id).single()).data;
    ok(st.used_count === 1, "e-mail repetido devolve o uso (used_count=1)", st);

    r = await signup({ code, email: mail(2), password: SENHA });
    ok(r.status === 200, "segundo uso cria a segunda conta", r);
    const u2 = (await svc.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === mail(2));
    if (u2) criados.push(u2.id);
    r = await signup({ code, email: mail(3), password: SENHA });
    ok(r.status === 400 && r.body.error === "invalid_invite", "convite esgotado recusado", r);

    const lst = await A.rpc("list_signup_invites");
    const row = (lst.data || []).find((x) => x.id === inv.id);
    ok(row && row.used_count === 2 && (row.emails || "").includes(mail(1)) && (row.emails || "").includes(mail(2)), "admin ve usos e e-mails do convite", row);

    const c2 = await A.rpc("create_signup_invite", { p_label: "e2e cancelado", p_max_uses: 1, p_days: 1 });
    const inv2 = (await svc.from("signup_invites").select("id").eq("label", "e2e cancelado").order("created_at", { ascending: false }).limit(1)).data[0];
    convites.push(inv2.id);
    const rv = await A.rpc("revoke_signup_invite", { p_id: inv2.id });
    ok(!rv.error, "admin cancela convite", rv.error);
    r = await signup({ code: c2.data[0].code, email: mail(4), password: SENHA });
    ok(r.status === 400 && r.body.error === "invalid_invite", "convite cancelado recusado", r);

    const c3 = await A.rpc("create_signup_invite", { p_label: "e2e vencido", p_max_uses: 1, p_days: 1 });
    const inv3 = (await svc.from("signup_invites").select("id").eq("label", "e2e vencido").order("created_at", { ascending: false }).limit(1)).data[0];
    convites.push(inv3.id);
    await svc.from("signup_invites").update({ expires_at: new Date(Date.now() - 60000).toISOString() }).eq("id", inv3.id);
    r = await signup({ code: c3.data[0].code, email: mail(5), password: SENHA });
    ok(r.status === 400 && r.body.error === "invalid_invite", "convite vencido recusado", r);

    const sp = await n1.from("spools").select("id");
    ok(!sp.error && sp.data.length === 0, "conta nova nao ve carreteis de ninguem", sp.data?.length);
    const pr = await n1.from("printers").select("id");
    ok(!pr.error && pr.data.length === 0, "conta nova nao ve impressoras de ninguem", pr.data?.length);
    const oh = await n1.rpc("ops_health");
    ok(!!oh.error || (oh.data || []).length === 0, "conta nova nao e admin da Central", oh.data);
    const nc = await n1.rpc("create_signup_invite", { p_label: "x" });
    ok(!!nc.error, "conta nova nao gera convite", nc.error);
    const pc = await n1.rpc("create_agent_pairing_code");
    ok(!pc.error && /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(pc.data?.[0]?.code || ""), "conta nova gera codigo para parear o Agent", pc.error);
    await n1.auth.signOut({ scope: "local" });
  } finally {
    for (const id of criados) { const d = await svc.auth.admin.deleteUser(id); ok(!d.error, "limpeza: conta de teste apagada", d.error); }
    for (const id of convites) await svc.from("signup_invites").delete().eq("id", id);
    await A.auth.signOut({ scope: "local" }); await B.auth.signOut({ scope: "local" });
  }
  console.log(falhas === 0 ? "\nCONVITES_OK" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
})();
