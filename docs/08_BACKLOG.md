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
4. `005_reconciliation_schema.sql` tem dois blocos `do push ... end push;` (linhas ~37 e ~45) — **não é sintaxe válida de `DO` block do Postgres** (o correto é `DO $$ ... END $$;`); mesmo pulando os problemas 1-3, `005` sozinha já falha com `ERROR: syntax error at or near "push"`.
5. `20260918_add_consumption_quality.sql` tem dois problemas independentes: altera `public.print_jobs` (tabela legada, sem uso — ver comentário em `002_rls_hardening.sql:35`) em vez de `public.print_logs` (a tabela real), e usa `DO \$\$ ... END \$\$;` com barra invertida antes dos cifrões, que também não é dollar-quoting válido.

Nenhum desses 5 pontos foi corrigido nesta tarefa (fora do escopo autorizado — só reportado). `docs/09_CHANGELOG.md` tem os comandos exatos usados pra reproduzir cada erro.

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

Integrar estratégia em camadas:

1. descoberta rápida;
2. mecanismo alternativo/varredura controlada;
3. entrada manual de IP;
4. redescoberta quando conexão persistente falhar.

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

Mínimo:

- parser 3MF/XML;
- cálculo de consumo;
- baixa idempotente;
- RLS;
- cálculo de tara;
- orçamento.

## P2 — Produto comercial

### P2.1 — Onboarding do Agent

Eliminar necessidade do usuário editar `.env`.

### P2.2 — Armazenamento seguro do Access Code

Usar mecanismo seguro do SO/credencial local em vez de arquivo texto como solução final.

### P2.3 — Instalador/auto-start/auto-update

Empacotamento robusto para Windows e, se desejado, outros sistemas.

- [x] **auto-start via Tarefa Agendada** — adicionado em 20/09/2026:
  `desktop-agent/install-autostart.ps1` + `run-agent.ps1` +
  `uninstall-autostart.ps1`. Só o mecanismo de "iniciar sozinho no
  logon"; o resto de P2.3 (instalador de fato, auto-update) continua em
  aberto. Ver `docs/09_CHANGELOG.md`.

### P2.4 — Offline queue

Persistir eventos/ações quando Supabase estiver indisponível e sincronizar com idempotência.

### P2.5 — Alertas de estoque baixo

Após saldo confiável, adicionar alertas e previsão.

### P2.6 — UX/refatoração do frontend

`App.tsx` concentra quase toda a aplicação. Separar componentes, hooks e serviços quando a base funcional estiver estável.

## P3 — Evoluções da visão

- workspaces/equipes;
- farm management;
- previsão de autonomia;
- custo por job automatizado;
- análise de desperdício;
- compras/reposição;
- rastreabilidade por lote.

<!-- AUTO:LEVEL_1_2_BACKLOG_20260920:START -->

## Atualização de backlog — 20/09/2026

### Concluído — retirar das pendências

Os itens abaixo NÃO devem mais ser tratados como backlog:

- [x] Consumo multicolor correto.
- [x] Finalização atômica e idempotente.
- [x] Política de qualidade do consumo.
- [x] Persistência e identificação de jobs.
- [x] Tratamento de slots órfãos.
- [x] Redescoberta automática da impressora após mudança de IP.
- [x] Reconciliação do histórico de migrations.
- [x] Criação de bootstrap reproduzível do schema.
- [x] Versões únicas para migrations.
- [x] Alinhamento das migrations locais com o Supabase remoto.

### Nível 3 — Maturidade de produto

#### Testes automatizados

Status: pendente.

Objetivo:

Criar proteção contra regressões nas áreas críticas do Filamap.

Prioridades iniciais:

1. cálculo de consumo;
2. `finalizeJob`;
3. jobs multicolor;
4. idempotência;
5. reconexão/redescoberta;
6. regras de estoque.

#### Refatoração do Web App

Status: pendente.

Problema:

`App.tsx` concentra responsabilidades demais.

Objetivo:

Extrair gradualmente componentes, hooks e regras de domínio sem realizar uma reescrita geral do frontend.

A refatoração deve ocorrer por partes e com comportamento preservado.

#### Segurança do Access Code da impressora

Status: aceitável para uso próprio, pendente antes de distribuição pública.

Situação atual:

O Access Code é configurado localmente por variável de ambiente.

Antes de distribuir o Desktop Agent para terceiros, revisar:

- armazenamento seguro;
- onboarding;
- proteção das credenciais;
- logs;
- empacotamento do Agent.

### Regra para futuras tarefas

Antes de iniciar nova feature, verificar se ela pertence ao Nível 3 ou se é uma correção necessária para preservar confiabilidade, dados ou operação.

Não reabrir Níveis 1 ou 2 como pendentes sem uma regressão comprovada.

<!-- AUTO:LEVEL_1_2_BACKLOG_20260920:END -->


