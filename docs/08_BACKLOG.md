# 08 — Backlog Priorizado

Este backlog foi criado a partir do código auditado em 18/09/2026. Prioridade indica risco técnico/operacional, não esforço.

## P0 — Integridade e confiança do núcleo

### P0.1 — Reconciliar banco remoto com migrations

**Problema:** migrations locais não criam todo o schema que o código usa.

**Concluído quando:** um projeto Supabase vazio consegue receber todas as migrations e executar Web App + Agent sem criação manual no dashboard.

**Investigação em 20/09/2026 (executada de verdade, num Postgres local, não só lida):** rodar 001→005 em ordem contra um banco vazio quebra em pelo menos 3 pontos distintos, confirmados com erro real do Postgres:

1. `002_rls_hardening.sql` falha em `ALTER TABLE public.ams_slots ALTER COLUMN user_id...` — a coluna só é criada em `004`, que vem depois no número do arquivo.
2. Mesmo reordenando 004 antes de 002, `002` ainda falha tentando alterar `public.print_logs`/`catalog_items` — essas tabelas só são criadas em `005`, também depois na ordem numérica.
3. Mesmo com 001→004→005→002→003 (ordem mínima que funciona pras duas primeiras), `002` falha de novo em `public.filament_presets` — essa tabela **não é criada por nenhuma migration**, nem em 005; só existe hoje porque foi criada manualmente no dashboard.
4. ~~`005_reconciliation_schema.sql` tem dois blocos `do push ... end push;` (linhas ~37 e ~45) — **não é sintaxe válida de `DO` block do Postgres** (o correto é `DO $$ ... END $$;`); mesmo pulando os problemas 1-3, `005` sozinha já falha com `ERROR: syntax error at or near "push"`.~~ **Corrigido em 20/09/2026** (mesma data, investigação separada — ver changelog "nfc_written_at" abaixo): os dois blocos usam `DO $$ ... END $$;` corretamente agora. Validado rodando `005` sozinha e dentro da cadeia completa contra Postgres local.
5. ~~`20260918_add_consumption_quality.sql` tem dois problemas independentes: altera `public.print_jobs` (tabela legada, sem uso — ver comentário em `002_rls_hardening.sql:35`) em vez de `public.print_logs` (a tabela real), e usa `DO \$\$ ... END \$\$;` com barra invertida antes dos cifrões, que também não é dollar-quoting válido.~~ **Sintaxe corrigida em 20/09/2026** (dollar-quoting sem barra invertida + `;` faltante depois de `END IF`), **mas o alvo errado (`print_jobs`) foi deixado como está de propósito**: essa migration já está superada por `20260920_add_print_logs_job_tracking.sql`, que adiciona `consumption_quality` corretamente em `public.print_logs` (a tabela real). Corrigir só a sintaxe evita que ela quebre uma aplicação em lote das migrations; seu efeito prático continua sendo inofensivo (só toca `print_jobs`, confirmado sem nenhuma referência em `web-app/src` ou `desktop-agent/src`).

Os pontos 1-3 (ordem dos arquivos e a tabela `filament_presets` ausente) **continuam sem correção** — não foi pedido nesta tarefa e mudar a ordem/numeração de migrations ou inventar o schema de `filament_presets` sem confirmar a estrutura real do banco em produção é risco maior do que os dois bugs de sintaxe puros corrigidos acima. `docs/09_CHANGELOG.md` tem os comandos exatos usados pra reproduzir e validar cada correção.

**Investigação adicional em 20/09/2026, corrigida em 20/09/2026:**
usuário reportou `ERROR: relation "v_owner" does not exist` ao aplicar
`20260920_add_print_logs_job_tracking.sql` no Supabase real. Não é um
dos 5 pontos acima (esses são sobre ordem/sintaxe de `001-005`; este era
um bug próprio, independente, nessa migration nova). Causa raiz real:
`$$` literal solto dentro de um comentário (linha 18), confundindo
ferramentas que segmentam o script por pareamento simples de `$$` sem
serem cientes de comentários `--`. Corrigido reescrevendo só o
comentário. Ver `docs/07_CURRENT_STATE.md` (Divergência 7) e
`docs/09_CHANGELOG.md` para a simulação que confirma a causa.

### P0.2 — Idempotência + transação de finalização

- [x] corrigido em 20/09/2026 — nova função `public.finalize_print_job`
  (`20260920_add_print_logs_job_tracking.sql`), chamada por
  `desktop-agent/src/index.ts::finalizeJob`. Recebe o job inteiro (job_id +
  array de itens por spool) e roda numa única transação: checa se o
  `job_id` já foi processado (idempotência — reprocessar não faz nada),
  verifica dono de cada spool via `auth.uid()`, desconta o peso e insere
  todas as linhas de `print_logs`, tudo ou nada. `job_id` é gerado pelo
  Agent (`crypto.randomUUID()`) no início do job e persistido em
  `agent-state.json` — ver investigação (a) no changelog sobre por que não
  foi usado um identificador vindo do payload MQTT da impressora. Validado
  com execução real num Postgres local (não só leitura) — ver changelog.

### P0.3 — Corrigir consumo multicolor/AMS

- [x] corrigido em 20/09/2026 — `desktop-agent/src/index.ts` agora
  rastreia todos os slots vistos como ativos durante `RUNNING`
  (`currentJob.usedSlots`), não só o slot inicial. Cada slot usado vira uma
  linha própria em `print_logs`, com seu próprio spool e desconto. Ver
  `docs/09_CHANGELOG.md` para a decisão de como dividir a estimativa
  quando não há granularidade por cor (níveis 2/3 da cascata).

### P0.4 — Validar FTPS + `slice_info.config` com arquivos reais

Criar conjunto de amostras reais:

- uma cor;
- 2+ cores;
- suporte;
- flush/purga;
- impressão interrompida.

Registrar estrutura observada e criar testes de parser.

### P0.5 — Política de fallback de consumo

- [x] corrigido em 20/09/2026 — cascata de 4 níveis implementada e
  wireada (existia código morto parcial, `evaluateConsumption`/
  `extractWeightFromFilename`, nunca chamado — removido e substituído por
  `computeConsumptionPerSlot`, que efetivamente decide `consumption_quality`
  por slot): `exact` (slice_info.config real) → `estimated_filename` →
  `estimated_duration` → `unknown` (não desconta, `needs_weighing: true`,
  nunca inventa peso). O antigo fallback fixo de 35g quando nada estava
  disponível foi removido — hoje isso cai em `unknown`/0g. Ver
  `docs/09_CHANGELOG.md`.

### P0.6 — Status online/offline da impressora travava em "ONLINE" com o Agent morto

- [x] corrigido em 20/09/2026 — `printers.last_seen_at` (migration
  `20260920_add_printers_last_seen_at.sql`), atualizado a cada heartbeat
  (15s) e a cada telemetria MQTT sincronizada pelo Agent; frontend calcula
  online/offline pela recência de `last_seen_at` (limiar de 30s) em vez de
  ler `is_online` diretamente. Ver `docs/09_CHANGELOG.md` e
  `docs/07_CURRENT_STATE.md` (Status online/offline da impressora).

## P1 — Fechar os fluxos atuais

### P1.1 — Leitura NFC no frontend

- [x] integrar `startScanning()` à UI (botão "Ler tag NFC" por slot do AMS);
- [x] resolver spool por tag lida (associa existente ou auto-cria);
- [x] fluxo claro de associação ao slot (por slot, com timeout/cancelamento);
- [ ] ler `?tag=` no carregamento (deep link passivo — ainda não
      interpretado; mecanismo separado do scan ativo acima).

### P1.1b — Checar retorno de `writeTagUrl` antes de persistir `nfc_uid`

- [x] corrigido em 20/09/2026 — ver `docs/09_CHANGELOG.md`.

### P1.1c — Indicador de gravação física real da tag (`nfc_written_at`)

- [x] adicionado em 20/09/2026 — coluna `spools.nfc_written_at`
  (migration `20260920_add_nfc_written_at.sql`), preenchida só quando
  `handleWriteTag` confirma escrita física via `writeTagUrl`; indicador
  de 3 estados (gravada/aguardando/sem tag) no Estoque e no seletor da
  aba Tags. Ver `docs/09_CHANGELOG.md`.

### P1.2 — Descoberta/re-descoberta robusta

- [x] descoberta rápida (broadcast BBLP/porta 2021) — já existia, extraída
  em 20/09/2026 para `desktop-agent/src/discovery.ts::findPrinter()`;
- [x] varredura de sub-rede como fallback — adicionada em 20/09/2026,
  faixa determinada via `os.networkInterfaces()` (nunca hardcoded),
  confirmação por conexão MQTT (8883) + serial esperado, IPs testados em
  paralelo;
- [x] redescoberta automática quando a conexão MQTT falha de forma
  persistente (60s contínuos sem conexão confirmada) — adicionada em
  20/09/2026 em `desktop-agent/src/index.ts`; reconecta no IP novo e
  atualiza `printers.ip_address` quando muda, ou continua tentando a
  cada 60s sem travar o processo quando as duas camadas falham;
- [ ] entrada manual de IP na UI — continua fora de escopo, por `.env`
  como antes.

**Não validado com hardware real** nesta sessão (sem impressora física
disponível) — ver aviso na Seção 62 do documento de arquitetura.

### P1.3 — Schema de qualidade do consumo

- [x] corrigido em 20/09/2026 — junto com P0.2/P0.3/P0.5:
  `print_logs.consumption_quality` (exact/estimated_filename/
  estimated_duration/unknown). Ver `docs/09_CHANGELOG.md`.

### P1.4 — Histórico/ledger de movimentos

Registrar não só impressão, mas também:

- cadastro inicial;
- baixa por job;
- re-pesagem;
- correção manual;
- descarte/fim de bobina.

### P1.5 — Testes automatizados

- [x] cálculo de consumo — adicionado em 20/09/2026:
  `desktop-agent/src/consumption.test.ts` (9 testes, cascata de 4 níveis
  + extração de peso do nome do arquivo);
- [x] descoberta de impressora (matemática de sub-rede) — adicionado em
  20/09/2026: `desktop-agent/src/discovery.test.ts` (8 testes);
- [x] onboarding/config do Agent — adicionado em 20/09/2026:
  `desktop-agent/src/config/store.test.ts` (9 testes);
- [x] scaffold de teste de integração real do `finalize_print_job`
  (idempotência incluída) — adicionado em 20/09/2026 em
  `desktop-agent/tests/integration/`, mas **não executado** (pula sem
  credenciais de um Supabase de teste; nenhuma disponível no ambiente
  desta sessão);
- [ ] parser 3MF/XML (`ftpsParser.ts`) — ainda sem testes, é P0.4
  (precisa de amostras reais de `.3mf`/`slice_info.config`);
- [ ] RLS — ainda sem testes automatizados;
- [ ] cálculo de tara — lógica está em `web-app` (`openWeighModal`/
  `handleSaveWeigh` em `App.tsx`), não extraída para função pura ainda,
  sem teste;
- [x] orçamento — extraído para `web-app/src/utils/budget.ts` em
  20/09/2026 (função pura `computeBudgetSummary`), mas ainda sem
  suíte de teste própria no `web-app` (nenhum framework de teste
  configurado lá ainda — diferente do `desktop-agent`, que já tem
  `vitest`). Candidato natural para o mesmo `vitest` no próximo passo.

## P2 — Produto comercial

### P2.1 — Onboarding do Agent

- [x] eliminada a necessidade de editar `.env` — adicionado em
  20/09/2026: assistente interativo (`desktop-agent/src/config/
  setupWizard.ts`) pergunta e-mail/senha/serial/Access Code uma única
  vez e salva; execuções seguintes (inclusive auto-start sem terminal)
  não perguntam de novo. `.env` continua funcionando como override
  opcional para desenvolvimento. Ver `desktop-agent/README.md` e
  `docs/09_CHANGELOG.md`.

### P2.2 — Armazenamento seguro do Access Code

**Parcialmente resolvido em 20/09/2026:** a configuração (incluindo
Access Code) saiu do `.env` dentro do projeto e passou a viver em
`%APPDATA%\Filamap\config.json` (Windows) / equivalente em macOS/Linux,
com permissão de arquivo restrita ao dono (`chmod 600`) como melhor
esforço — só funciona de fato em POSIX; Windows/NTFS não tem um
equivalente direto sem dependência nativa extra. **Ainda não é o cofre de
credenciais do SO** (Windows Credential Manager/DPAPI, Keychain no
macOS): continua sendo um arquivo JSON em texto puro. Migrar para um cofre
de verdade exige uma dependência nativa (ex.: `keytar` ou acesso direto à
DPAPI), o que muda o processo de build/empacotamento do `pkg` — decisão de
arquitetura/dependência maior, não tomada nesta sessão (ver
`desktop-agent/README.md`, seção "O que falta").

### P2.3 — Instalador/auto-start/auto-update

Empacotamento robusto para Windows e, se desejado, outros sistemas.

- [x] **auto-start via Tarefa Agendada** — adicionado em 20/09/2026:
  `desktop-agent/install-autostart.ps1` + `run-agent.ps1` +
  `uninstall-autostart.ps1`. Só o mecanismo de "iniciar sozinho no
  logon"; o resto de P2.3 (instalador de fato, auto-update) continua em
  aberto. Ver `docs/09_CHANGELOG.md`.
- [x] **onboarding sem `.env`** — ver P2.1, feito em 20/09/2026 na mesma
  sessão que preparou o resto da arquitetura comercial descrita aqui.
- [ ] **instalador gráfico (`.exe`/MSI com wizard)** — hoje
  `npm run package-exe` gera um binário único via `pkg`, sem tela de
  instalação, atalho no menu iniciar ou desinstalador registrado.
  Exigiria escolher uma ferramenta (Inno Setup, NSIS, electron-builder)
  — não decidido nesta sessão por ser escolha de produto/ferramenta sem
  pedido explícito de qual usar.
- [ ] **assinatura de código** — bloqueado por depender de um
  certificado de assinatura (custo + verificação de identidade da
  empresa), que só o dono do produto pode providenciar; sem isso o
  Windows/SmartScreen mostra aviso de "editor desconhecido".
- [ ] **auto-update** — não implementado; depende de decidir o canal de
  distribuição de novas versões e, de novo, de assinatura de código para
  atualizações confiáveis.

### P2.4 — Offline queue

Persistir eventos/ações quando Supabase estiver indisponível e sincronizar com idempotência.

### P2.5 — Alertas de estoque baixo

Após saldo confiável, adicionar alertas e previsão.

### P2.6 — UX/refatoração do frontend

**Em andamento, avançado em 20/09/2026:** `App.tsx` caiu de 1244 para 1053
linhas, extraindo (sem mudar comportamento/visual, `npm run build`
validado a cada passo):
- [x] tipos e constantes (`src/types.ts`, `src/constants.ts`);
- [x] utils puros — `printer.ts`, `nfc.ts`, `inventory.ts`,
  `selectors.ts`, `budget.ts`;
- [x] acesso a dados — `src/services/{dataService,catalogService,
  spoolService}.ts` (antes, `supabase.from(...)` espalhado direto em
  `App.tsx`);
- [x] componentes isolados — `LoginScreen.tsx`, `WeighSpoolModal.tsx`,
  `EditSpoolModal.tsx`.

Ainda pendente (não extraído nesta rodada por serem blocos maiores,
mais arriscados de mover sem conseguir testar visualmente num
navegador real — ambiente desta sessão não tinha um disponível):
- [ ] os 4 corpos de aba (AMS/Estoque/Orçamento/Tags — a maior parte do
  JSX que resta, com `style` inline em todo lugar);
- [ ] `supabase.auth.*` (login/logout) para um hook `useAuth`/serviço
  próprio;
- [ ] hooks de estado/efeitos maiores (ex.: o fluxo de scan NFC por
  slot: `scanningSlot`, `handleScanSlot`, `handleCancelScan`, os dois
  `useEffect` que reagem a `nfcUid`/`nfcError`).

Antes de continuar essa extração, recomenda-se validar visualmente
(login, AMS, estoque, orçamento, gravação de tag) num navegador real —
só `tsc`/`vite build` verificam tipo, não comportamento de UI.

## P3 — Evoluções da visão

- workspaces/equipes;
- farm management;
- previsão de autonomia;
- custo por job automatizado;
- análise de desperdício;
- compras/reposição;
- rastreabilidade por lote.
