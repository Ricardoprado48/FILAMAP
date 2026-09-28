# IMPACTO_ARQUITETURA_ESTOQUE_FILAMAP_V2

- **Base:** V1 (mesma pasta). Continua válida nos itens 1–26; esta versão acrescenta decisões, evidências novas, o incidente de 28/09 e a aplicação mecânica do **Protocolo Mestre V8**.
- **Tipo de trabalho:** projeto existente, continuação.
- **Data:** 2026-09-28.
- **Nada foi implementado para esta obra.** A única alteração em produção foi o hotfix do incidente (seção 3), autorizado e executado pelo cliente.

---

## 1. Check de acesso ao projeto

```text
PROJETO LOCAL:            C:\FILAMAP (main link), worktrees abaixo
CAMINHO DA OBRA:          C:\FILAMAP-staging  (branch staging/fase-i)
REPOSITÓRIO REMOTO:       github.com/Ricardoprado48/FILAMAP
BRANCH PADRÃO:            main = 684513e (origem do Agent v2 instalado)
HEAD DA OBRA:             d87fa45  (0 à frente / 0 atrás de origin/staging/fase-i; 12 commits à frente da main)
NÃO RASTREADOS:           docs/IMPACTO_*_V1.md, docs/IMPACTO_*_V2.md, web-app/dist-staging/ (build)
OUTRAS WORKTREES:         C:\FILAMAP (fase-i-wip 10a5769), C:\FILAMAP-device-pairing (feat/agent-device-pairing 1edbad6),
                          C:\FILAMAP-hotfix-agent (684513e)
LEITURA REPO:             DISPONÍVEL
ESCRITA/PUSH staging:     DISPONÍVEL (push feito hoje)
PUSH main:                INDISPONÍVEL para o agente (trava de segurança) → cliente executa
FONTE DE VERDADE:         código = staging/fase-i; produção = main 684513e + hotfix de schema de 28/09
BLOQUEADORES:             nenhum para documentação; ver Pré-flight (seção 7)
```

## 2. Checkpoint de retomada

```text
OBJETIVO FINAL:        estoque confiável e vendável: PRESET → FILAMENT_PRODUCT → SPOOL → POSIÇÃO → HISTÓRICO,
                       com a nuvem Bambu/RFID como evidência (Inbox), nunca como autoridade.
ÚLTIMA FASE VALIDADA:  pacote staging (Fase I + lista de perfis sem duplicatas + escolha de slot sem tag + nomes padronizados)
                       NÍVEL 3 na Web contra o banco de teste; regra "Agent respeita escolha do usuário" só NÍVEL 2 (mock).
FASE ATUAL:            engenharia (Gate Zero → Gate 1) da obra de identidade de produto.
PARCIAL:               mapa spool→preset aprovado e aplicado SÓ no teste (organizar-carreteis.sql, 28 spools).
PENDENTE:              toda a obra abaixo.
TESTES CONFIRMADOS:    Agent 220/220, Web 121/121 (herméticos); Web × banco de teste (integração real).
```

## 3. Incidente de 28/09 (registro forense)

```text
INCIDENTE:        Agent v2 não fechava impressões (42703 spools_1.tray_info_idx does not exist)
ESCOPO:           2 jobs (406f5736: 10,4 g COMPLETED; 9151f705: 0 g FAILED), ambos na fila local
CAUSA RAIZ:       commit 75f64ac consulta coluna nunca criada; testes só com mock (V7: MOCK VERDE ≠ INTEGRAÇÃO REAL)
RECUPERAÇÃO:      ALTER TABLE spools ADD COLUMN IF NOT EXISTS tray_info_idx TEXT (cliente, 17:43Z)
PÓS-RECUPERAÇÃO:  fila enviada (83 tentativas); Preto Velvet 739,3 → 728,9 g; fila vazia; consulta OK 200
REGISTRO:         migration 20260928180000 (d87fa45), aplicada também no teste
CLASSIFICAÇÃO:    TIPO B (previsível, não verificado antes)
PREVENÇÃO:        regra R-CONTRATO (seção 5): toda consulta do Agent/Web roda contra o schema do banco de teste antes do build
```

## 4. Decisões do cliente (FIXO)

| # | Decisão | Condição / regra |
|---|---|---|
| D1 | Unificar os 3 pares de presets num único FILAMENT_PRODUCT | **Só com evidência** de mesmo produto; nome igual não basta. Os presets continuam separados por baixo |
| D2 | PLA Lite Amarelo → produto a partir do preset oficial Bambu usado | Não cria spool |
| D3 | Ledger de movimentações | Fase própria posterior; esta obra não pode dificultá-lo |
| D4 | Arquivar spool em vez de apagar | Spool com histórico não é apagado (`archived_at`) |
| D5 | `filament_presets` e `print_jobs` | Congeladas como legado: sem escrita nova, sem dependência nova, sem remoção agora |
| D6 | Rename no Bambu Studio | Após confirmação humana, o mesmo FILAMENT_PRODUCT.id recebe a nova referência e o novo nome; o histórico mantém o snapshot |

**Regras fixas adicionais:**
- R1 Nuvem/RFID/AMS não criam, fundem nem reclassificam spool.
- R2 Texto só sugere.
- R3 Desconhecido fica desconhecido.
- R4 Histórico não é preenchido por inferência. Os 12 `print_logs` órfãos ficam sem vínculo.
- R5 Spool só nasce por ação explícita (Novo Carretel/Inbox).
- R6 O produto tem ID interno estável.
- R7 IDs Bambu são referência externa.
- R8 É **proibido reconciliar os 28 spools na produção enquanto o Agent que reescreve perfil estiver ativo**.

**Ordem aprovada:**
1. Agent novo implementado e testado sem instalar;
2. schema aditivo;
3. instalar o Agent;
4. observar ≥1 sincronização completa, provando 0 criações, 0 fusões, 0 reclassificações e 0 sobrescritas de peso/tara/preço;
5. backup;
6. reconciliação dos 28;
7. Web;
8. uso real controlado;
9. travas.

### FIXO × LIVRE

- **FIXO:** D1–D6, R1–R8, a ordem aprovada, "perfil ≠ carretel", as regras de negócio do CLAUDE.md (tara, desconto só em FINISH/proporcional, Agent sem regra de preço).
- **LIVRE:** nomes de tabelas/colunas, formato da Inbox na Web, estratégia de testes, divisão interna das fases, scripts.
- **Dúvida do cliente pendente:** a marca oficial dos 3 pares (o campo `vendor` é inválido nos dois arquivos: "PETG" e "-"). Proposta: usar a marca do nome ("FUSIONX", "MASTERPRINT"), confirmada na tela de reconciliação.

## 5. Gate de Evidência

| Fato necessário | Evidência | Fonte | Estado |
|---|---|---|---|
| Os 3 pares são o mesmo produto (D1) | Mesmo nome, material PETG, impressora A1 0.4. Studio 22/09 × Beta 26/09 (cópia de canal). Única diferença: `vendor` inválido | arquivos JSON dos presets | COMPROVADO |
| O PLA Lite tem preset oficial (D2) | `GFA18` = filament_id de `Bambu PLA Lite @base.json` (2.054 presets de sistema no disco) = source_key do registro da nuvem | disco + prod | COMPROVADO |
| O preset `P86318ba` está ausente na prod | consulta prod: não existe; o v2 não lê a pasta Beta | prod | COMPROVADO |
| Agent v2 reescreve `filament_profile_id` | `buildSpoolUpdateRow` (bambuCloudSpoolSync.ts:600) | código | COMPROVADO |
| Agent v2 cria spools e casa por texto | Casos C/D (bambuCloudSpoolSync.ts:734-776) | código | COMPROVADO |
| O consumo depende só de `spool_id` | `finalize_print_job`: dono + `weight_confirmed_at` + INSERT em `print_logs` (SECURITY DEFINER) | migration 20260928000000 | COMPROVADO |
| O snapshot pode ser gravado no servidor | o INSERT da RPC (l.105) pode ler spool→produto; independe da versão do Agent | idem | COMPROVADO |
| O desconto só ocorre com peso confirmado | l.88: `v_grams > 0 AND weight_confirmed_at IS NOT NULL` | idem | COMPROVADO (regra preservada) |
| RLS das tabelas atuais | todas `owner_all (auth.uid() = user_id)`; `filament_presets` só SELECT autenticado | pg_policies | COMPROVADO |
| Service worker não prende versão antiga | `sw.js`: network-first + skipWaiting + clients.claim | web-app/public/sw.js | COMPROVADO (residual: uso offline) |
| Leitura da nuvem sem MQTT | `filamap-bambu-bridge.exe` separado; execução só de leitura devolveu 15 registros | execução real | COMPROVADO |
| Agent isolável da produção | pasta de config = `%APPDATA%\Filamap` (configStore.ts:39); URL por env `SUPABASE_URL` | código | COMPROVADO no código; **execução ao vivo NÃO VERIFICADA** (pré-flight P1) |
| Apagar spool apaga vínculo do histórico | `print_logs.spool_id ON DELETE SET NULL`; a Web faz DELETE real (App.tsx:723) | schema + código | COMPROVADO |
| Os 12 logs órfãos não vieram de exclusão | todos `orphan_slot = true` | prod | COMPROVADO |
| Consultas do Agent × schema real | 1 quebrada (tray_info_idx), já corrigida; **nenhum teste cobre isso hoje** | incidente | COMPROVADO → vira regra R-CONTRATO |

**Resultado: APROVADO para o desenho da solução.** Os fatos operacionais pendentes estão no Pré-flight (seção 7), não no desenho.

## 6. Solução técnica fechada (resumo)

- **Schema aditivo (F1):**
  - `filament_products` (id, user_id, name, brand, material, color_name, color_hex, density, origin, archived_at, timestamps; UNIQUE `(user_id, lower(name))`; RLS owner_all);
  - `user_filament_profiles.filament_product_id`;
  - `spools.filament_product_id` e `spools.archived_at`;
  - `spools.brand` e `spools.material` passam a aceitar NULL (R3; o código antigo continua preenchendo);
  - `print_logs`: `filament_product_id`, `product_name_snapshot`, `brand_snapshot`, `material_snapshot`, `color_snapshot`, `snapshot_backfilled`;
  - `spool_inbox`;
  - `spools_identity_backup`;
  - `finalize_print_job` grava o snapshot.
  - Tudo com `BEGIN/COMMIT` e `IF NOT EXISTS`; rollback escrito por migration.
- **Agent v3 (F2):**
  - a nuvem **só** atualiza `bambu_*` (posição/evidência) de spools já ligados por `bambu_spool_id` e grava na `spool_inbox` o que não reconhecer;
  - remove o insert de spool, o casamento por texto, a gravação de perfil no spool e a fusão por secundários;
  - sincroniza o preset oficial **usado** (por filament_id visto na nuvem/AMS) como `source = 'bambu_official'`;
  - preset renomeado vira item de Inbox (`preset_renamed`);
  - todas as listas de spool filtram `archived_at IS NULL`.
- **Backfill (F6):** produtos só a partir dos presets ativos mapeados (28) + PLA Lite (GFA18) + 3 pares confirmados; spools via mapa aprovado; os 6 logs com spool recebem snapshot com `snapshot_backfilled = true`; os 12 órfãos ficam intactos (R4).
- **Web (F7):**
  - identidade exibida a partir do produto; "Novo Carretel" exige produto;
  - tela de Inbox; tag desconhecida → Inbox (remove App.tsx:454);
  - arquivar em vez de apagar; sem defaults inventados (Voolt3D/85/1000);
  - histórico mostra o snapshot;
  - inclui o pacote staging já pronto.
- **Travas (F9, gate próprio):** NOT NULL em produto/user_id, `nfc_uid` único por usuário, fim dos defaults no banco, colunas legadas renomeadas.

## 7. Pré-flight de capacidades

| Recurso | Capacidade | Fase | Estado | Evidência / ação | Fallback |
|---|---|---|---|---|---|
| Banco de teste (Management API) | ler/escrever/aplicar migration | F0–F2, F7 | DISPONÍVEL | 20 migrations aplicadas hoje | — |
| Banco de teste | DELETE/reset pelo agente | F0 | INDISPONÍVEL (trava) | cliente roda o script | script pronto |
| Produção | leitura (CLI linked) | todas | DISPONÍVEL | consultas de hoje | — |
| Produção | aplicar migration | F4, F6 | DISPONÍVEL **só pelo cliente** | hotfix de hoje; `supabase db push` bloqueado para o agente | cliente executa script |
| Produção | aplicar migrations **da branch staging** | F4 | **NÃO VERIFICADO** | só C:\FILAMAP tem link com a prod; definir método (link na worktree ou copiar SQL) | script que roda de C:\FILAMAP apontando os arquivos |
| Produção | backup antes de F6 | F5 | **NÃO VERIFICADO** | `supabase db dump --linked --data-only` ou tabela `*_backup` via SQL | backup por tabelas SQL (já no desenho) |
| Bridge Bambu | leitura da nuvem | F2 | DISPONÍVEL | 15 registros, execução real | — |
| Agent de teste isolado | APPDATA + SUPABASE_URL próprios, sem MQTT | F2 | **NÃO VERIFICADO** | executar só os módulos de sync via script Node contra o teste (padrão sync-perfis-staging.cjs) | teste por módulo, sem processo completo |
| 2º usuário no teste | teste de isolamento RLS | F1 | **PRECISA PREPARAR** | criar via Auth admin (service_role do teste) | — |
| Build do instalador | v3 a partir de staging/fase-i | F3 | **NÃO VERIFICADO** nesta branch | `scripts/build-installer.ps1` existe; v3 anterior foi gerado de outra branch | build na worktree device-pairing após merge |
| Cloudflare Pages | deploy de preview | F7 | DISPONÍVEL | deploy de hoje | — |
| Cloudflare Pages | deploy de produção | F7 | DISPONÍVEL (já feito antes) | `--branch main` | cliente executa |
| Git | push na main | F8 | cliente | regra de permissão existente | — |

**Resultado: PENDENTE** (5 itens NÃO VERIFICADOS/PRECISA PREPARAR → fase F0).

## 8. Gate de Prevenção de Falhas: pré-mortem e matriz

**Risco da obra: ALTO** (migration, produção, dados persistentes, Agent instalado).

| # | Etapa | O que pode falhar | Previsível? | Prevenção incorporada | Residual |
|---|---|---|---|---|---|
| 1 | Janela até o v3 | v2 reescreve perfil / cria spool | SIM | R8; produto em **coluna nova** que o v2 não toca; cliente não cadastra carretel novo no gerenciador Bambu até o v3 | baixo |
| 2 | Qualquer build | consulta a coluna/tabela inexistente (incidente) | SIM | **R-CONTRATO:** script que executa todas as consultas do Agent/Web (select strings) contra o schema do teste; bloqueia o build se houver 42703/42P01 | baixo |
| 3 | Migrations | falha no meio | SIM | `BEGIN/COMMIT`, `IF NOT EXISTS`, verificação pós por consulta | baixo |
| 4 | Backfill | produto duplicado | SIM | só presets mapeados; pares só com D1; UNIQUE; ensaio no teste com cópia fiel | baixo |
| 5 | Backfill prod | `P86318ba` ainda não sincronizado | SIM | pré-condição SQL: F6 aborta se algum source_key do mapa não existir | nulo |
| 6 | Backfill | peso/tara/preço alterados | SIM | o SQL não referencia essas colunas; checksum antes/depois (soma e contagem) obrigatório | nulo |
| 7 | Tabelas novas | RLS sem policy (acesso negado) ou aberta demais | SIM | policy owner_all explícita; teste com 2 usuários (ler/escrever o do outro = 0) | baixo |
| 8 | RPC finalize | snapshot quebra o consumo | SIM | colunas nullable; o snapshot não bloqueia o INSERT; teste de integração real (finalize/resolution) + idempotência por job_id | baixo |
| 9 | Arquivamento | spool arquivado reaparece no AMS/lista | SIM | filtro `archived_at IS NULL` no Agent (amsProjection:405, index:796) e na Web; testes | baixo |
| 10 | Inbox | a nuvem gera itens repetidos a cada sync | SIM | UNIQUE `(user_id, source, external_id)` + upsert idempotente | baixo |
| 11 | Rename de preset | colisão de nome com outro produto | SIM | não renomeia automaticamente; a Inbox mostra o conflito | baixo |
| 12 | Encoding | "Limão/Metálico" corrompidos | SIM | SQL via corpo UTF-8 (API) ou CLI; verificação dos nomes pós-migração | baixo |
| 13 | Rollback F6 | restauração incompleta | SIM | `spools_identity_backup` + script de rollback **executado no teste** antes da prod | baixo |
| 14 | Instalação v3 | instalar durante impressão | SIM | regra existente: só com a impressora ociosa; checagem de `gcode_state` antes | baixo |
| 15 | Bridge Bambu | timeout (visto no log) | SIM | falha da bridge não altera nada (design "nunca rejeita"); a Inbox só recebe em caso de sucesso | nulo |
| 16 | Web offline | bundle antigo em cache | SIM | sw network-first | baixo (só offline) |
| 17 | Multi-cliente | `nfc_uid` único global colide entre contas | SIM | fora desta obra; F9 (único por usuário) | **médio até F9** (aceito: 1 cliente hoje) |
| 18 | Relógio do notebook ~15 s adiantado | ordem de eventos | SIM | timestamps do servidor (`now()`) | baixo |

**Simulação do fluxo crítico (Inbox):** a bridge devolve um registro → o Agent busca spool por `bambu_spool_id`:
- **existe:** atualiza só `bambu_*`; o estado fica consistente se falhar (nada mais é escrito);
- **não existe:** upsert na `spool_inbox`; o estado fica consistente se falhar (próximo ciclo repete, idempotente);
- **Web:** o usuário escolhe *vincular* (grava `bambu_spool_id` no spool escolhido), *criar* (Novo Carretel pré-preenchido, produto obrigatório) ou *ignorar*.

Nenhum caminho cria, funde ou altera peso sem ação humana.

**Resultado: PENDENTE**, falta só a crítica pré-construção independente sobre esta V2 (item abaixo).

## 9. Crítica pré-construção

- **Crítica executada nesta V2** (papel crítico, pelo executor), que achou e incorporou:
  - o snapshot deve ficar no servidor;
  - a coluna nova reduz o risco da janela do v2;
  - o arquivamento exige filtros no Agent;
  - a Inbox precisa de idempotência;
  - o incidente exige R-CONTRATO.
- **Pendente:** crítica independente (o revisor do parecer) sobre as seções 6–8.

**Estado: PENDENTE.**

## 10. Mapa de fases e Gate 1 (Lista Mestra)

| ID | Fase | Tarefa | Local | Executor | Artefato | Início quando | Termina quando (evidência) | Maturidade |
|---|---|---|---|---|---|---|---|---|
| F0 | Canteiro | Cópia fiel prod→teste (só linhas com dono, **com print_logs**); baseline de checksums; 2º usuário de teste; script R-CONTRATO; teste do Agent isolado por módulo; definir método de migration e backup na prod | scratchpad + teste | PowerShell (Claude Code escreve) / cliente para DELETE | scripts .ps1 | Gate 1 aprovado | pré-flight 100% DISPONÍVEL ou com fallback aceito | 3 |
| F1 | Schema aditivo | migrations da seção 6 + rollbacks | banco de **teste** | Claude Code (SQL) / PowerShell aplica | .sql + rollback | F0 | aplicadas; RLS 2 usuários OK; finalize com snapshot OK (integração real); rollback testado; checksums iguais | 3 |
| F2 | Agent v3 | Inbox, sem autoridade da nuvem, preset oficial, rename→Inbox, filtros de arquivamento | staging/fase-i | Claude Code | código + testes | F1 | unitários verdes + **R-CONTRATO verde** + sync real (bridge) contra o teste: 0 inserts em spools, itens na Inbox | 3 |
| F3 | Build | instalador v3 | worktree | PowerShell | .exe + hash | F2 | instalador gerado, hash registrado, executável contém versão nova | 1 |
| F4 | Prod: schema | Fase I + tray_info_idx (já aplicada) + F1 na produção | produção | **cliente** (script) | script único | F3 + ok do cliente | migrations registradas; consultas R-CONTRATO OK na prod; checksums iguais | 3 |
| F5 | Prod: Agent | instalar v3 (impressora ociosa) e observar ≥1 ciclo completo | PC do cliente | **cliente** (UAC) + verificação por script | script de observação | F4 | prova: 0 spools novos, 0 fusões, 0 mudanças em perfil/produto/peso/tara/preço; `P86318ba` presente | 4 |
| F6 | Prod: reconciliação | backup + backfill (28 + PLA Lite + 3 pares) + snapshot retroativo | produção | **cliente** (script ensaiado no teste) | .sql/.ps1 + rollback | F5 + ok do cliente | 29/29 spools com produto; 0 nomes duplicados; checksums iguais; 12 órfãos intactos | 3 |
| F7 | Web | seção 6 (Web) + pacote staging; deploy staging → homologação pelo cliente → deploy prod + merge main | staging → prod | Claude Code / cliente (deploy prod, merge) | código + deploy | F2 (implementação pode correr em paralelo a F3–F6); deploy prod só após F6 | e2e do cliente no staging; homologação remota na prod (URL, bundle, fluxo Novo Carretel/Inbox/arquivar) | 4 |
| F8 | Uso real | uso controlado por alguns dias | produção | cliente + consulta diária de saúde | script de saúde | F7 | 0 divergências; Inbox usada; consumo correto | 4 |
| F9 | Travas | NOT NULL, nfc por usuário, fim de defaults, colunas legadas | produção | gate próprio (novo documento) | — | F8 | — | — |

- **Paralelismo:** só a implementação da Web (F7-código) com F2–F6, em arquivos distintos (web-app/ × desktop-agent/ + SQL). A sincronização acontece antes do deploy de F7.
- **Pontos de parada humana:** aprovação do Gate 1; DELETE/reset no teste (F0); F4, F5 e F6 na produção; homologação da Web; merge na main.
- **Estratégia:** **por fase** (MODO A), porque há produção e decisões humanas entre as fases. F1+F2 podem virar prompt macro depois de F0 verde.
- **Roteamento:** PowerShell para cópia, checksums, aplicação, build e observação. Claude Code só para SQL novo, Agent e Web (multi-arquivo, justificado). Revisão independente: o revisor do parecer.

### Prompts das fases (curtos)

- **PROMPT_F0:** "Execute F0 do IMPACTO_V2 §10. Só scripts no scratchpad e leitura da prod. Entregue o pré-flight §7 com cada item DISPONÍVEL + evidência. Não edite o repositório."
- **PROMPT_F1:** "Execute F1 conforme §6 (schema) e §8 (itens 3, 7, 8, 13). Aplique só no banco de teste. Critério: §10-F1. Divergência → PARE."
- **PROMPT_F2:** "Execute F2 conforme §6 (Agent) e §8 (1, 2, 9, 10, 11, 15). Critério: §10-F2, incluindo R-CONTRATO e sync real contra o teste. Divergência → PARE."
- **PROMPT_F3:** "Gere o instalador v3 de staging/fase-i (build-installer.ps1). Registre hash e versão. Não instale."
- **PROMPT_F4–F6:** "Prepare o script da fase Fx para o cliente executar, com verificação ANTES/DEPOIS e rollback. Pré-condições do §10 obrigatórias; não execute na produção."
- **PROMPT_F7:** "Execute F7 conforme §6 (Web). Deploy só no staging; a produção só após F6 e o ok do cliente."
- **PROMPT_F8:** "Rode o script de saúde diário e reporte divergências."

## 11. Risco residual (aceito para construir, sujeito ao cliente)

- `nfc_uid` único global até F9 (1 cliente hoje).
- Uso da Web offline com bundle antigo.
- O timeout da bridge Bambu atrasa a Inbox, sem corromper nada.
- A janela F4→F5 com o Agent v2 ativo sobre o schema novo: mitigada pela coluna nova + R8 + o cliente não cadastrar carretel novo no gerenciador Bambu nesse intervalo.

---

## 12. Painel de liberação da obra

```text
CHECK DE ACESSO AO PROJETO:        APROVADO
CHECKPOINT DE RETOMADA:            APROVADO
GATE ZERO:                         APROVADO (escopo, fases, riscos, executores) — depende do pré-flight
PRÉ-FLIGHT DE CAPACIDADES:         PENDENTE  (5 itens → F0)
GATE DE EVIDÊNCIAS:                APROVADO  (desenho); fatos operacionais em F0
GATE DE PREVENÇÃO DE FALHAS:       PENDENTE  (matriz feita; falta crítica independente)
PRÉ-MORTEM TÉCNICO:                APROVADO
CRÍTICA PRÉ-CONSTRUÇÃO:            PENDENTE  (revisor independente sobre §6–§8)
MODOS DE FALHA RELEVANTES:         TRATADOS (18)
RISCO RESIDUAL:                    ACEITÁVEL (§11) — sujeito ao cliente
GATE DE INTEGRIDADE DE ARTEFATOS:  N/A agora (nenhum artefato executável desta obra ainda)
ESTADO GIT/DISCO COERENTE:         APROVADO (HEAD d87fa45 = remoto)
PROJETO TÉCNICO FECHADO:           APROVADO (§6)
PACOTE DE CONSTRUÇÃO FECHADO:      NÃO (F0 precisa fechar o pré-flight)
GATE 1 / ORDEM DE SERVIÇO:         APRESENTADO — aguardando aprovação
APROVAÇÃO DO CLIENTE:              PENDENTE

LIBERAÇÃO PARA CONSTRUIR:          NÃO
PRONTO PARA EDITAR:                NÃO
```

**Próximo passo para liberar:**
1. crítica independente das §6–§8;
2. aprovação do Gate 1;
3. execução de **F0**, que não edita o repositório (só scripts e leitura), fechando o pré-flight.

Com F0 verde, o painel é reapresentado para liberar F1.
