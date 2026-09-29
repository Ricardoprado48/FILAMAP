# PACOTE DE CONSTRUÇÃO — CENTRAL DE OBSERVABILIDADE FILAMAP V1

**Fase:** O0 (engenharia, sem código) · **Data:** 2026-09-29 · **Protocolo:** V8
**Documento-base:** FASE_PILOTO_OBSERVABILIDADE_FILAMAP_V1.md
**Nível de risco:** ALTO (migration, Agent em produção, dados multi-usuário) → camada V8 integral.

---

## 0. Check de acesso e retomada

```text
PROJETO LOCAL:            C:\FILAMAP (main) + worktree C:\FILAMAP-staging
BRANCH DE TRABALHO:       staging/fase-i (= main 9b63394, em produção)
GIT STATUS:               limpo (só web-app/dist-staging/ não rastreado)
PRODUÇÃO:                 Supabase gqtlszffgvxsqcmefhyd (linked) · Web filamap.pages.dev · Agent v4.1 instalado
BANCO DE TESTE:           zllbzjwhdyxbryhbqrfg
LEITURA DO REPOSITÓRIO:   DISPONÍVEL
ESCRITA:                  DISPONÍVEL (staging); main/produção só pelo cliente
BLOQUEADORES:             nenhum para O0; CLI sem privilégio no projeto de teste por comando direto (403) — usar ops scripts com token DPAPI
```

---

## 1. Estado atual (comprovado)

| Item | Evidência | Situação |
|---|---|---|
| Log do Agent | `run-agent.vbs:32` → `cmd >> %APPDATA%\Filamap\agent.log` | **Sem rotação.** 1,36 MB / 16.002 linhas em ~32 h (medido). Cresce ~1 MB/dia para sempre. |
| Timestamp no log | `index.ts:38-43` (prefixo ISO em console.*) | OK |
| Rejeição não tratada | `index.ts:49` registra e segue | OK, mas só local |
| Ruído | últimas 24 h: 2.167 linhas; **980** = "Perfis sincronizados" (a cada ~90 s, mesmo sem mudança); 208+195 = projeção AMS | 85 % do log é repetição sem valor diagnóstico |
| Incidente real no log | 96× `column spools.tray_info_idx does not exist` (16:22→17:43 de 28/09) + 10 reenvios + recuperação 17:44 | Só descobrível lendo o arquivo na máquina do dono. **Exatamente o caso que a central precisa mostrar.** |
| Heartbeat | `index.ts:362-396` grava `printers.last_seen_at` a cada 15 s | Já é a fonte de "impressora/Agent online". Reaproveitar. |
| Sessão | `sessionSupervisor.ts` tem `reportSessionLost` e `onRecovered` | Ganchos prontos |
| Fila de finalize | `finalizeOutbox.ts` (persistente, `attempts`, log na 1ª e a cada 10) | Ganchos prontos (logInfo/logWarn injetáveis) |
| Versão do Agent | `package.json` = 1.0.0; instalador `.iss` = 4.1.0; **o código não sabe a própria versão** | Lacuna |
| Versão Web | `package.json` 1.0.0; sem hash de build | Lacuna |
| Erros Web | sem ErrorBoundary, sem `window.onerror`/`unhandledrejection` | Erro de render = tela branca sem rastro |
| Papel de admin | inexistente no banco | Necessário para o dashboard interno |
| Desinstalação | `.iss` não apaga `%APPDATA%\Filamap` | installation_id sobrevive a reinstalação no mesmo PC (desejado) |
| supabase-js (Agent) | 2.116.0; `fetchWithAuth` pega o token via `getSession()`; PostgREST não emite SIGNED_OUT | Chamada de telemetria usa **o mesmo caminho do heartbeat**: não cria classe nova de falha de sessão |

---

## 2. Arquitetura

```text
 Agent (Node/pkg)                                  Web (PWA)
 ─────────────────                                 ─────────
 código crítico ──emit()──► Emitter (memória, O(1), try/catch total)      ErrorBoundary / onerror
                              │ sanitiza + dedup + limite                  │ sanitiza + limite
                              ▼                                            ▼
                     telemetry-outbox.jsonl (anel 500)             (memória, 50)
                              │ flush a cada 60 s, single-flight, timeout 10 s
                              ▼                                            ▼
                    RPC ingest_ops_events(p_installation, p_status, p_events)  [SECURITY DEFINER]
                              │ força user_id = auth.uid(), valida tamanho, cota diária, dedup, purga 30 d
                              ▼
        ops_installations (1 linha por instalação, sobrescrita)   ops_events (append, 30 dias)
                              │
                              ▼
        view ops_installation_health  ──►  Central (aba só para admin no Web)
```

**Regra estrutural:** o emitter não recebe referência a nada do fluxo crítico, não lança exceção, não é aguardado (`await`) por nenhum handler de MQTT/job/finalize, e nunca chama o SessionSupervisor.

---

## 3. Error tracking — decisão

| Critério | Sentry (Developer grátis) | **Supabase próprio** |
|---|---|---|
| Custo 10 testers | US$ 0 até 5.000 erros/mês, **1 usuário**, 30 dias (sentry.io/pricing, 2026-09-29); Team US$ 26/mês | US$ 0 incremental (mesmo banco) |
| Node empacotado com pkg | SDK extra no .exe + source maps de bundle pkg (trabalho novo, não comprovado) | Nenhuma dependência nova |
| Timeline operacional (objetivo nº 1 da fase) | Não cobre eventos não-erro | Mesma tabela dos eventos |
| Privacidade/LGPD | Novo operador de dados (EUA) | Dados ficam onde já estão |
| Agrupamento | Nativo | `fingerprint` calculado no cliente (seção 10) |
| Esforço operacional | Mais uma conta/painel | Um painel |

**DECISÃO: Supabase próprio para o piloto.** Reavaliar Sentry na abertura de venda (volume e equipe maiores). Sem lock-in: `fingerprint` + `stack` sanitizado são exportáveis.

---

## 4. Catálogo de eventos (fechado)

Legenda dedup: **T** = só na transição de estado; **J** = 1 por job; **W60** = mesma fingerprint no máximo 1×/60 s (repetições somadas em `repeat_count`).

| event_type | sev | component | quando (ponto no código) | dedup |
|---|---|---|---|---|
| AGENT_STARTED | INFO | agent | `startAgent()` após auth | — |
| AGENT_STOPPED | INFO | agent | `gracefulShutdown` (flush best-effort 3 s) | — |
| AGENT_CRASH_RECOVERED | WARNING | agent | no start, se `last-run.json` indica que a execução anterior não teve STOPPED | — |
| MQTT_CONNECTED / MQTT_DISCONNECTED | INFO / WARNING | mqtt | `client.on("connect"/"close")` | T |
| MQTT_ERROR | WARNING | mqtt | `client.on("error")` (code no error_code) | W60 |
| PRINTER_ONLINE / PRINTER_OFFLINE | INFO / WARNING | printer | redescoberta encontrou / 1ª falha de busca | T |
| TELEMETRY_DEGRADED / TELEMETRY_RESTORED | WARNING / INFO | supabase | `updatePrinterConfirmed` 1ª falha / restabelecido (heartbeat e telemetria) | T |
| SESSION_LOST / SESSION_RECOVERED | ERROR / INFO | session | `reportSessionLost` / `onRecovered` | T |
| SESSION_REFRESHED | — | — | **não enviar** (rotina, ~24/dia, zero valor) | — |
| BAMBU_SYNC_FAILED / BAMBU_SYNC_RECOVERED | WARNING / INFO | bambu_cloud | falha/volta do Cloud Spool Sync | T |
| PROFILE_SYNC_FAILED / PROFILE_SYNC_RECOVERED | WARNING / INFO | bambu_studio | idem, perfis | T |
| BAMBU_SYNC_STARTED/COMPLETED | — | — | **não enviar** (200/dia); último sucesso vai no status da instalação | — |
| INBOX_ITEM_CREATED | INFO | bambu_cloud | contagem "N na caixa de entrada" > 0 | por item |
| JOB_DETECTED | INFO | job | "Novo trabalho de impressão detectado" | J |
| JOB_FINISHED / JOB_FAILED | INFO / WARNING | job | CONCLUÍDA / INTERROMPIDA (percent no metadata) | J |
| FTPS_FAILED | WARNING | ftps | erro ao carregar slice_info | J |
| FINALIZE_QUEUED | INFO | finalize | job foi para a outbox | J |
| FINALIZE_RETRY | WARNING | finalize | tentativa 1 e a cada 10 (mesma regra do log atual) | — |
| FINALIZE_COMPLETED | INFO | finalize | "📝 Job finalizado" / "enviada após N" (gramas, attempts) | J |
| FINALIZE_FAILED | ERROR | finalize | job não pôde ir para a fila (`index.ts:649`) | J |
| SPOOL_AMBIGUOUS | WARNING | identity | slot sem carretel resolvido no finalize (orphan_slot) | por slot/job |
| SPOOL_IDENTIFIED | — | — | **não enviar como evento**; vai no metadata de FINALIZE_COMPLETED (slot→spool, fonte da identificação) | — |
| FTPS_CONNECTED | — | — | **não enviar** (1 por job, sem valor; sucesso implícito) | — |
| UNHANDLED_REJECTION | ERROR | agent | `process.on("unhandledRejection")` | W60 |
| AGENT_ERROR | ERROR | (qualquer) | `catch` relevantes (`Erro no processamento`, falha de projeção) | W60 |
| WEB_ERROR | ERROR | web | ErrorBoundary / onerror / unhandledrejection | W60 |
| SUPPORT_REQUEST | INFO | web | botão "Enviar diagnóstico ao suporte" | — |

Cada tipo tem semântica escrita em `eventCatalog.ts` (constante tipada); tipo fora do catálogo é recusado pelo servidor (CHECK).

---

## 5. Schema

```sql
ops_installations (
  installation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('agent','web')),
  machine_hint text,               -- sha256(hostname)[:12]; nunca o hostname
  app_version text,                -- '4.2.0' / hash do build web
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),   -- relógio do SERVIDOR
  status jsonb NOT NULL DEFAULT '{}'::jsonb           -- snapshot sobrescrito (ver 12)
)

ops_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  installation_id uuid NOT NULL REFERENCES ops_installations ON DELETE CASCADE,
  client_event_id uuid NOT NULL,
  boot_id uuid NOT NULL,           -- 1 por processo
  seq integer NOT NULL,            -- monotônico por boot (ordem mesmo com relógio errado)
  occurred_at timestamptz NOT NULL,-- relógio do cliente
  received_at timestamptz NOT NULL DEFAULT now(),
  app_version text,
  event_type text NOT NULL CHECK (event_type IN (<catálogo>)),
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','ERROR','CRITICAL')),
  component text NOT NULL,
  printer_id uuid, job_id uuid, spool_id uuid,       -- sem FK: evento não pode falhar por referência apagada
  error_code text CHECK (length(error_code) <= 80),
  fingerprint text CHECK (length(fingerprint) <= 40),
  message text CHECK (length(message) <= 500),
  repeat_count integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(metadata) <= 4096),
  UNIQUE (installation_id, client_event_id)
)

ops_admins (user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE)
```

`CRITICAL` fica reservado (nenhum evento do catálogo o usa hoje; serve para "desconto duplicado detectado" no futuro).

## 6. Índices

```sql
ops_events (installation_id, occurred_at DESC)       -- timeline
ops_events (user_id, received_at DESC)               -- filtro por usuário
ops_events (received_at) WHERE severity IN ('ERROR','CRITICAL')  -- erros 24h
ops_events (installation_id, received_at)            -- cota diária e purga
```

## 7. RLS

- RLS ligado nas 3 tabelas.
- `ops_events`, `ops_installations`: **SELECT só para `ops_is_admin()`**. Nenhuma policy de INSERT/UPDATE/DELETE (escrita só pela RPC).
- `ops_admins`: SELECT só do próprio registro (para o Web saber se mostra a aba).
- `ops_is_admin()`: `SECURITY DEFINER STABLE SET search_path = public`, `EXISTS (SELECT 1 FROM ops_admins WHERE user_id = auth.uid())`.

## 8. GRANT

```sql
REVOKE ALL ON ops_events, ops_installations, ops_admins FROM anon, authenticated;
GRANT SELECT ON ops_events, ops_installations, ops_admins TO authenticated;   -- RLS filtra
REVOKE ALL ON FUNCTION ingest_ops_events(...) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ingest_ops_events(...) TO authenticated;
GRANT EXECUTE ON FUNCTION ops_is_admin() TO authenticated;
```

**RPC `ingest_ops_events(p_installation jsonb, p_events jsonb) RETURNS jsonb`** — SECURITY DEFINER, `SET search_path = public`:
1. `auth.uid()` nulo → `{ok:false, reason:'no_session'}` (sem efeito).
2. Instalação existente de **outro** usuário → recusa (impede sequestro de installation_id).
3. UPSERT da instalação (`last_seen_at = now()`, versão, status).
4. Até **50 eventos por chamada**; eventos acima da **cota de 300/dia/instalação** são descartados e contados (`dropped`).
5. `user_id` sempre `auth.uid()` (o do payload é ignorado); `INSERT … ON CONFLICT (installation_id, client_event_id) DO NOTHING`.
6. Purga oportunista: apaga até 500 linhas desta instalação com `received_at < now() - 30 days`.
7. Retorna `{ok, accepted, duplicated, dropped}`.

---

## 9. installation_id

| Pergunta | Decisão |
|---|---|
| Geração | `crypto.randomUUID()` no 1º start (já usado em `index.ts`) |
| Persistência | `%APPDATA%\Filamap\installation.json` `{installation_id, created_at}` (escrita atômica tmp+rename, como `agent-state.json`) |
| Reinstalação | Mantém (desinstalador não apaga AppData) — mesma máquina = mesma instalação |
| Vários PCs | IDs diferentes (arquivo local) |
| Pasta copiada para outro PC | `machine_hint` diferente sob o mesmo ID → dashboard marca "possível clone" |
| Arquivo corrompido/ilegível | Gera novo ID e registra evento AGENT_STARTED com `metadata.new_installation=true`; nunca bloqueia o start |
| Privacidade | UUID aleatório; `machine_hint` = hash truncado; sem MAC, IP, hostname ou serial |
| Web | `filamap_web_install_id` em localStorage (try/catch; sem storage → ID efêmero por aba) |

---

## 10. Sanitização (função única, testada, aplicada a message, stack e metadata)

Ordem, em `sanitize.ts` (Agent) e `sanitize.ts` (Web, mesma lógica e **mesmos casos de teste**):
1. **Valores exatos registrados em runtime:** Access Code, senha Filamap, refresh token, access token, anon key → `[REDACTED]`. O Agent registra esses valores no sanitizer logo após `bootstrapRuntimeConfig()`. (Necessário: Access Code tem 8 caracteres e não é detectável por padrão.)
2. **Chaves de metadata** que casam `/pass|secret|token|jwt|cookie|authorization|access.?code|api.?key|session|credential|private/i` → valor removido.
3. **Padrões:** JWT `eyJ[\w-]+\.[\w-]+\.[\w-]*`, `Bearer \S+`, `sb-[\w-]+-auth-token`, blobs base64/hex ≥ 32 chars, `-----BEGIN … KEY-----`.
4. **E-mail:** `a***@dominio`. **Caminhos Windows:** `C:\Users\<nome>\` → `C:\Users\<user>\`.
5. **HTML** (páginas de erro do Cloudflare que hoje entram no log como `<html>`): troca pelo `<title>` + status.
6. **Limites:** message 500, stack 4.000 (mantém topo), metadata 4 KB serializado, profundidade 4, arrays 20 itens.
7. Qualquer exceção dentro do sanitizer → evento vira `{event_type, severity, component, message:'[sanitize_failed]'}` (nunca envia o original).

`fingerprint` = sha1(component + error_code + message normalizada sem números/UUIDs + 1º frame do stack)[:16].

**Arquivos nunca lidos pela telemetria:** `secrets.dat`, `secrets-BACKUP-*.dat`, `config.json`.

---

## 11. Retenção, volume e custo

**Volume medido** (log real 24 h, convertendo linhas → eventos do catálogo):

| Fonte | Linhas/dia | Eventos/dia |
|---|---|---|
| Perfis/Cloud/projeção (rotina) | ~1.600 | 0 (só falha/volta) |
| MQTT/impressora/redescoberta | ~80 | ~25 |
| Heartbeat/telemetria falhas | ~40 | ~10 (transições) |
| Jobs (8 no dia) + FTPS + finalize | ~120 | ~50 |
| Erros (incl. incidente tray_info_idx: 96 linhas) | ~100 | ~5 (W60 + repeat_count) |
| **Total dia pesado** | **2.167** | **~90–150** |

**Estimativa:** 150 eventos × 10 testers × 30 dias = **45.000 linhas ≈ 35 MB** (≈ 800 B/linha com índices).
**Pior caso limitado pela cota:** 300 × 10 × 30 = 90.000 linhas ≈ **75 MB**.
`ops_installations`: 1 linha por instalação, UPDATE a cada 5 min (≈ 288/dia, sem crescimento).

**Retenção:** 30 dias para tudo (purga pela própria RPC; sem dependência de pg_cron — disponibilidade no plano Free não comprovada na documentação oficial, então não é usado).

**Custo:** US$ 0 incremental no Free (500 MB). **Decisão D2 (cliente, 2026-09-29): continuar no Free.** Mitigações: função `keepalive()` chamada 1×/dia pelo GitHub Actions (o Free pausa após 7 dias sem atividade de banco; o heartbeat do Agent já evita isso enquanto algum Agent roda), backup semanal automático no PC do dono, cota reduzida para **300 eventos/dia/instalação** (pior caso ≈ 80 MB).

---

## 12. Health por instalação

Fonte única por dado (sem duplicar verdade):

| Campo | Fonte |
|---|---|
| installation_id, user_id, agent_version, agent_last_seen_at | `ops_installations` (last_seen_at = relógio do servidor) |
| printer_last_online_at | `printers.last_seen_at` (heartbeat existente) |
| mqtt_status, last_bambu_sync_at, last_profile_sync_at, pending_finalize_count, active_job | `ops_installations.status` (snapshot enviado a cada 5 min e em toda transição) |
| last_job_at, last_finalize_at | `print_logs` / `ops_events` FINALIZE_COMPLETED |
| error_count_24h | `ops_events` severity ERROR/CRITICAL |
| inbox_pending | `spool_inbox` status pending |

Função `ops_health()` SECURITY DEFINER com checagem de admin (uma view invoker não leria `auth.users` nem `printers` de outros usuários). `health_status`:
- **OFFLINE**: agent_last_seen_at > 15 min;
- **CRITICAL**: sessão perdida, ou finalize pendente > 1 h, ou erro CRITICAL 24 h;
- **DEGRADED**: mqtt desconectado > 10 min, ou erros 24 h > 0, ou sync falhando;
- **OK**: resto.

---

## 13. Estratégia de envio, retry, fila, offline

| Aspecto | Regra |
|---|---|
| `emit()` | síncrono, O(1): sanitiza, dedup W60/T, põe no anel. Envolvido em try/catch; retorna `void`. |
| Persistência | anel em memória + `telemetry-outbox.jsonl` regravado no máximo 1×/10 s (atômico). Crash perde ≤10 s de eventos — aceito. |
| Limite de fila | **500 eventos**. Cheio → descarta o INFO mais antigo; se não houver INFO, o mais antigo; conta `dropped_local` no próximo status. |
| Cota local | 250 eventos/dia/instalação (abaixo da cota do servidor 300). |
| Flush | a cada 60 s via `setTimeout` encadeado (não `setInterval`, evita sobreposição), **single-flight**, lote ≤ 50, timeout 10 s (`abortSignal`). |
| Sem sessão | não tenta enviar (consulta estado do SessionSupervisor, só leitura). Eventos ficam no anel. |
| Falha | backoff 1 → 2 → 5 → 15 → 30 min; sucesso volta a 60 s. Falha de telemetria **nunca** chama `reportSessionLost` nem loga mais de 1 linha por mudança de estado. |
| Resposta `no_session`/401 | igual a falha (backoff), sem efeito colateral. |
| Shutdown | tenta flush com teto de 3 s; não atrasa o encerramento além disso. |
| Web | anel 50 em memória; flush a cada 60 s e em `visibilitychange=hidden`; sem usuário logado → descarta. |

---

## 14. Logs locais

- **Rotação no `run-agent.vbs`** antes de cada início: `agent.log` > 5 MB → `agent.log.1` (sobrescreve o anterior). Máx. ≈ 10 MB em disco.
- **Redução de ruído (sem mudar comportamento):** "Perfis sincronizados" e "Projeção AMS" só logam quando o resultado muda. Corta ~85 % das linhas.
- DEBUG continua só local; nada de DEBUG na central.

---

## 15. Dashboard interno (Web, aba "Central", só admin)

- **Visão geral:** tabela de instalações (`ops_installation_health`): usuário (e-mail mascarado), tipo, versão, health, Agent visto há, impressora vista há, MQTT, último sync, último job, finalize pendente, erros 24 h, inbox, alerta "possível clone".
- **Detalhe:** timeline (occurred_at + seq, com received_at ao lado quando diferença > 2 min = "relógio divergente"), filtros event_type / severity / component / período / job_id; agrupamento de erros por fingerprint com contagem.
- Consultas sempre com `LIMIT 200` e janela padrão de 24 h.
- Aba invisível se `ops_is_admin()` = false; RLS garante o bloqueio mesmo se alguém forçar a rota.
- **"Enviar diagnóstico ao suporte"** (qualquer usuário, na aba Dispositivos): cria SUPPORT_REQUEST com nota opcional + versão web + installation_ids do usuário. Como os eventos do Agent já estão na central, o suporte reconstrói a timeline sem pedir print. (Pacote com trecho do agent.log fica para P2.)

---

## 16. Testes planejados

**Agent (vitest, mock):**
- sanitize: JWT, Bearer, refresh token fictício, Access Code registrado, senha registrada, e-mail, caminho de usuário, HTML Cloudflare, metadata com chave `password`, stack contendo token, metadata 50 KB, objeto circular, exceção interna → `[sanitize_failed]`.
- emitter: `emit` nunca lança (sanitizer que explode, disco cheio, JSON inválido na outbox); anel 500 com descarte de INFO; W60 soma repeat_count; transição T não repete; cota diária; flush single-flight; timeout; backoff; sem sessão não chama RPC; **falha de RPC não chama reportSessionLost**.
- installationId: cria, reaproveita após restart, arquivo corrompido → novo ID sem lançar.
- version: `AGENT_VERSION` == `MyAppVersion` do `.iss` (trava contra divergência).
- regressão: suíte atual do Agent inteira.

**Banco (integração, projeto de TESTE, 3 usuários: A, B, admin + anon):**
A grava via RPC ✔ · A lê ops_events ✘ · B lê de A ✘ · anon RPC → no_session ✘ · anon SELECT ✘ · INSERT direto na tabela ✘ · B usa installation_id de A ✘ · admin lê A e B ✔ · evento duplicado = 1 linha · 51º evento do lote ignorado · cota 500/dia · metadata > 4 KB recusado · event_type fora do catálogo recusado · purga > 30 d.

**Web:** sanitize (mesmos casos) · ErrorBoundary mostra tela de recuperação e emite WEB_ERROR · aba Central oculta para não-admin · suíte atual inteira + typecheck.

**Integração real (O4, Agent de teste contra banco de teste):** as 16 validações da seção "VALIDAÇÃO" do documento-base, incluindo derrubar a rede e apontar a URL da central para host inválido com impressão em andamento simulada.

---

## 17. Rollback

- **Banco:** `ROLLBACK_observability.sql` = `DROP VIEW ops_installation_health; DROP FUNCTION ingest_ops_events, ops_is_admin; DROP TABLE ops_events, ops_installations, ops_admins;`. Nenhuma tabela existente é alterada → rollback não toca estoque/jobs.
- **Agent:** reinstalar v4.1 (`releases/FilamapAgentSetup-v4.1-2B35BE25.exe`), **nunca durante impressão ativa**. Se a RPC não existir, o Agent novo apenas acumula no anel (resposta de erro = backoff) — **Agent novo funciona com banco antigo**.
- **Web:** republicar 9b63394 via `ops/publicar-web-producao.ps1`. Web novo sem RPC: telemetria falha em silêncio.
- **Desligar sem reinstalar:** `config.json` `"telemetry": false` → emitter vira no-op.

---

## 18. Matriz de falhas (pré-mortem)

| Cenário | Impacto sem prevenção | Prevenção incorporada | Residual |
|---|---|---|---|
| Central/Supabase offline | fila cresce, CPU em retry | anel 500 + backoff até 30 min | perde INFO antigos |
| Internet offline | idem | idem; heartbeat existente não muda | idem |
| Loop de erro (ex.: 96× tray_info_idx) | milhares de linhas | W60 + repeat_count + cota 300/500 | nenhum |
| Evento duplicado (retry após timeout) | linha dupla | client_event_id UNIQUE + DO NOTHING | nenhum |
| Relógio errado / fora de ordem | timeline errada | seq por boot + received_at do servidor | exibição marca divergência |
| Segredo em payload/exception | vazamento | sanitizer 7 etapas + valores exatos registrados + teste com fixtures fictícios | segredo novo não registrado e sem padrão → mitigado por chaves e tamanho |
| Metadata gigante | custo/erro de insert | corte no cliente 4 KB + CHECK no banco | nenhum |
| Stack com token | vazamento | sanitize aplica ao stack | idem |
| Versão antiga do Agent | sem dados | dashboard mostra "sem telemetria" pela ausência | esperado |
| Duas instalações do mesmo usuário | mistura | installation_id por máquina | nenhum |
| Pasta AppData clonada | ID repetido | machine_hint diferente → alerta | nenhum |
| RLS errada / A lê B | vazamento | SELECT só admin; escrita só RPC; testes com 2 usuários + anon + insert direto | nenhum |
| Sequestro de installation_id | poluir outro usuário | RPC recusa ID de outro user_id | nenhum |
| Retenção sem limite | banco enche | purga 30 d + cota | purga só roda quando a instalação envia — instalação morta mantém ≤ 30 d de dados até a próxima purga admin (botão "purgar" no dashboard) |
| Dashboard caro | lento | índices + LIMIT 200 + janela 24 h | nenhum |
| Heartbeat excessivo | volume | status é UPSERT 1 linha a cada 5 min, não evento | nenhum |
| Fila local infinita | disco/memória | anel 500, arquivo ≤ ~1 MB | nenhum |
| Erro na observabilidade causa crash | Agent cai | try/catch em emit/flush/persist; promessas com `.catch`; testes de "nunca lança" | nenhum |
| Observabilidade altera timing de MQTT/job/finalize | job perdido | emit síncrono O(1), flush em timer próprio, nenhum `await` novo nos handlers; comparação de tempos no soak O5 | medido no O5 |
| Telemetria dispara perda de sessão | Agent desloga | não chama supervisor; mesmo caminho de token do heartbeat (15 s) já em produção | nenhum |
| Evento decide estoque | regra violada | nenhuma tabela crítica lida/escrita pela RPC; RPC não retorna nada usado pelo fluxo | nenhum |

---

## 19. Arquivos exatos

**Supabase (novo):**
- `supabase/migrations/20261001100000_ops_observability.sql`
- `supabase/rollback/ROLLBACK_20261001100000_ops_observability.sql`
- `web-app/src/services/opsObservability.integration.test.ts`

**Agent:**
- novos: `src/observability/{eventCatalog,sanitize,emitter,installationId,version}.ts` + `*.test.ts`
- alterados (só chamadas `emit`/injeção de callbacks, sem mudar lógica): `src/index.ts`, `src/sessionSupervisor.ts` (nada — usa `logWarn`/`onRecovered` já injetáveis), `src/finalizeOutbox.ts` (callbacks opcionais `onRetry/onSent`), `src/config/configStore.ts` (flag `telemetry`), `src/filamentProfileSync.ts` e trecho de log em `index.ts` (log só na mudança)
- `run-agent.vbs` (rotação), `installer/FilamapAgentSetup.iss` (4.2.0)

**Web:**
- novos: `src/observability/{sanitize,webTelemetry}.ts` + testes, `src/components/ErrorBoundary.tsx`, `src/components/OpsCentral.tsx`, `src/services/opsService.ts`
- alterados: `src/main.tsx` (ErrorBoundary + handlers globais), `src/App.tsx` (aba Central para admin, botão diagnóstico), `vite.config.ts` (`__APP_VERSION__` = hash do commit)

**Docs:** `docs/PRIVACIDADE_PILOTO.md` (texto para o tester), `docs/RELATORIO_OBSERVABILIDADE_FILAMAP_V1.md` (saída final).

---

## 20. Fases O1–O5

| Fase | Entrega | Gate de saída |
|---|---|---|
| O1 | Migration + rollback no **banco de teste**; testes de integração RLS/GRANT/RPC | 100 % da lista de banco da seção 16; rollback executado e reaplicado |
| O2 | Módulos do Agent + ganchos + rotação + versão 4.2.0 | suíte Agent inteira verde; testes "nunca lança"; build pkg OK |
| O3 | ErrorBoundary, telemetria Web, aba Central, botão diagnóstico | suíte Web + typecheck verdes |
| O4 | Agent 4.2 de teste contra banco de teste com impressora real (jobs curtos) | 16 validações do documento-base; central derrubada sem efeito no job |
| O5 | **Cliente** aplica migration em produção (script com ensaio + palavra de confirmação), publica Web, instala Agent 4.2 **fora de impressão**; cliente se cadastra em `ops_admins`; soak 7 dias | eventos/dia, tamanho médio, CPU/RAM do Agent vs 4.1, zero regressão |

Nenhum tester nesta execução.

## 21. Critérios para Piloto A

Os 10 do documento-base (seção 17) + `docs/PRIVACIDADE_PILOTO.md` aprovado pelo cliente + decisão D2 tomada.

## 22. Riscos residuais aceitos

1. Crash perde até 10 s de eventos não persistidos.
2. Instalação que parou de enviar mantém até 30 dias de eventos até purga manual.
3. Segredo de formato desconhecido e não registrado poderia passar — mitigado por chave, tamanho e testes; revisar ao adicionar qualquer credencial nova.
4. Custo de CPU/RAM é estimado desprezível, só **medido** no O5.

---

## 23. Decisões que dependem do cliente

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Error tracking | **Supabase próprio** agora; Sentry na venda |
| D2 | Plano Supabase | **Free** + keepalive + backup semanal (decidido) |
| D3 | Retenção | **30 dias** |
| D4 | Testers podem ver os próprios eventos? | **Não** no piloto (menos superfície); só o botão de diagnóstico |

---

## 24. Painel

```text
CHECK DE ACESSO:                 APROVADO
CHECKPOINT DE RETOMADA:          APROVADO (main 9b63394, Agent v4.1, F1-F7 em produção)
GATE ZERO:                       APROVADO
GATE DE EVIDÊNCIA:               APROVADO para O1–O4
                                 PENDENTE para O5: tamanho atual do banco de produção e plano
                                 (CLI 403 no comando direto; obter pelo painel ou script DPAPI)
PRÉ-FLIGHT:                      APROVADO (sem dependência externa nova; supabase-js 2.116.0 já em uso)
GATE DE PREVENÇÃO V8:            APROVADO (pré-mortem 18 cenários, matriz, crítica, bordas)
CRÍTICA:                         incorporada (ver seção 25)
PACOTE FECHADO:                  SIM
PRONTO PARA EDITAR:              SIM para O1–O4, após aprovação do cliente de D1–D4
LIBERAÇÃO PARA CONSTRUIR:        AGUARDANDO CLIENTE
```

## 25. Crítica pré-construção (objeções levantadas e como foram fechadas)

1. *"Evento em todo job aumenta chamadas ao Supabase durante impressão."* → Não há chamada no handler; o flush é por timer, lote único a cada 60 s, mesmo cliente HTTP do heartbeat que já roda a cada 15 s.
2. *"Admin via tabela pode ser burlado pelo próprio usuário."* → `ops_admins` não tem GRANT de escrita a `authenticated`; só o cliente insere via SQL em produção.
3. *"Upsert de status a cada 5 min é heartbeat disfarçado."* → É UPDATE de 1 linha (sem crescimento), e evita criar evento de heartbeat.
4. *"Sanitizer do Web e do Agent podem divergir."* → Mesma lista de casos de teste nos dois; fixture compartilhada copiada e verificada por teste que compara hash do arquivo de fixtures.
5. *"Agent novo com banco antigo quebra?"* → RPC ausente = erro tratado como falha de rede (backoff). Ordem de implantação indiferente.
6. *"`seq` reinicia a cada boot."* → Por isso `boot_id` + `seq`; timeline ordena por occurred_at e desempata por (boot_id, seq).
7. *"Purga dentro da RPC deixa o insert mais lento."* → Limite de 500 linhas com índice (installation_id, received_at); roda no máximo 1× por chamada.
