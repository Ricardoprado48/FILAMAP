# 07 — Estado Atual do Projeto

**Snapshot auditado:** 18/09/2026 (base original), atualizado em 20/09/2026.
**Base:** conteúdo do ZIP `desktop-agent.zip` fornecido para auditoria +
sessão de refatoração/testes/onboarding de 20/09/2026 (ver
`docs/10_NIVEL_3_RELATORIO.md` para o relatório completo dessa sessão).

## Status geral

**Protótipo funcional em evolução.**

O Filamap já possui Web App, Desktop Agent, integração Supabase, MQTT, tentativa de FTPS/3MF, inventário e orçamento. Ainda não deve ser classificado como SaaS pronto para implantação comercial ampla por causa das lacunas abaixo.

## Implementado e visível no código

### Web

- autenticação por e-mail/senha;
- dashboard de impressora;
- status online/offline;
- tarefa, progresso, tempo restante, camada e temperaturas;
- quatro slots AMS Lite;
- listagem de estoque agrupada por material;
- busca/filtro;
- re-pesagem;
- edição/exclusão de spools;
- catálogo de peças;
- simulador de custos/orçamento;
- gravação de tag NFC vinculada a spool já existente no estoque (seleção via query real em `spools`, sem criar spool novo);
- histórico recente de `print_logs`.

### Desktop Agent

- login no Supabase;
- cadastro/atualização da impressora;
- descoberta UDP básica quando não há IP;
- MQTT TLS + reconexão do cliente;
- push periódico de status;
- atualização de telemetria no Supabase;
- estado do job persistido em arquivo;
- tentativa de baixar `.3mf` via FTPS;
- parser de `slice_info.config`;
- finalização em FINISH/FAILED/STOP;
- baixa de peso multicolor, idempotente e atômica por job (20/09/2026);
- gravação de `print_logs` (uma linha por slot/spool efetivamente usado no job).

### Banco/security

- schema inicial para spools/printers/ams_slots/print_jobs;
- migrations de RLS;
- remoção de policies permissivas antigas;
- correção de `ams_slots.user_id`.

## Implementado, mas precisa de validação antes de confiar em produção

- descoberta automática da impressora;
- caminho FTPS do job atual;
- parser real de `slice_info.config` em diferentes jobs;
- correspondência entre IDs do slicer e slots AMS;
- cálculo/baixa em jobs interrompidos;
- telemetria adicional do schema remoto;
- empacotamento/execução do Agent em máquinas novas;
- PWA/service worker.

## Divergências importantes encontradas

### 1. Documento v1.1 diz que persistência do job estava pendente

No código atual, `agent-state.json` já implementa persistência do `ActiveJobState`.

### 2. Documento v1.1 menciona `needs_weighing` como fallback sem inventar peso

**Resolvida em 20/09/2026.** Até então, `finalizeJob()` estimava por
tempo e possuía um fallback fixo de 35 g quando não havia nenhum dado —
divergindo do texto original que dizia "sem inventar peso" — e sempre
gravava `needs_weighing: false`, mesmo em estimativas. Agora
`finalizeJob()` usa a cascata de 4 níveis (`consumption_quality`); o
fallback fixo de 35 g foi removido — quando não há nenhum dado real, o
consumo fica em 0g com `consumption_quality: 'unknown'` e
`needs_weighing: true`, coerente com a descrição original. Ver
`docs/09_CHANGELOG.md`.

### 3. Migrations não reproduzem o banco usado pelo código

O código usa `print_logs`, `catalog_items`, `price_paid` e várias colunas de telemetria que não são criadas pelas migrations disponíveis.

### 4. RPC segura existe, mas não é usada na baixa atual

**Parcialmente resolvida em 20/09/2026.** `finalizeJob()` não faz mais
`UPDATE` direto em `spools.current_weight` — passou a chamar uma função
Postgres (`public.finalize_print_job`, nova, `SECURITY DEFINER` +
checagem de `auth.uid()`, mesmo padrão de segurança de
`deduct_spool_filament()`). Ainda é tecnicamente verdade que
`deduct_spool_filament()` especificamente continua sem uso — a nova
função foi escrita separada porque precisa descontar múltiplos spools
numa mesma transação atômica (um por slot do job), o que
`deduct_spool_filament()` (um spool por chamada) não cobre sozinha sem
perder a atomicidade entre os descontos. Ver `docs/09_CHANGELOG.md`.

### 5. `start-agent.bat` não inicia o Agent como está hoje

`start-agent.bat` (raiz do repo) roda `cd /d C:\FILAMAP\desktop-agent` e
`npm run dev`. `desktop-agent/package.json` não tem script `dev` — só
`build`, `start` e `package-exe` (`dev` só existe em
`web-app/package.json`, pro Vite). Ou seja, hoje esse `.bat` falharia com
"Missing script: dev" se executado. Não foi possível confirmar com o
usuário qual é de fato o método usado em produção (o `.exe` empacotado
via `pkg`, ou `node dist/index.js` direto) — `docs/03_FEATURES.md` cita
os dois sem diferenciar. Os scripts de auto-start adicionados em
20/09/2026 (ver seção "Auto-start do Agent" abaixo) foram desenhados pra
não depender dessa resposta: detectam em tempo de execução qual dos dois
existe em `desktop-agent/` e usam esse. `start-agent.bat` em si não foi
alterado (fora do escopo desta tarefa).

### 6. Migrations 001-005 não aplicam do zero em pelo menos 5 pontos distintos

Investigado em 20/09/2026 executando de verdade num Postgres local (não
só lendo): a coluna `ams_slots.user_id` (usada por `002`) só é criada em
`004`; `print_logs`/`catalog_items` (também usadas por `002`) só são
criadas em `005`; `filament_presets` (usada por `002`) não é criada por
nenhuma migration; `005_reconciliation_schema.sql` tem dois blocos
`do push ... end push;` que não são sintaxe válida de `DO` block do
Postgres; `20260918_add_consumption_quality.sql` altera a tabela errada
(`print_jobs`, legada, em vez de `print_logs`, a real) e também usa
dollar-quoting inválido (`DO \$\$`). Nenhum desses pontos foi corrigido
(fora do escopo das tarefas que os encontraram) — comandos exatos de
reprodução em `docs/09_CHANGELOG.md`. Aprofunda o que P0.1 já registrava
de forma mais genérica.

### 7. `ERROR: relation "v_owner" does not exist` ao aplicar `20260920_add_print_logs_job_tracking.sql` num Supabase real — CORRIGIDO

**Corrigido em 20/09/2026.** Causa raiz real: o comentário da linha 18
do arquivo tinha um `$$` literal solto (usado como texto explicativo,
não como delimitador de código), deixando três ocorrências soltas de
`$$` no arquivo (um número ímpar) em vez do par real esperado. SQL puro
(via `psql`/`libpq`, ciente de comentários `--`) nunca teve problema com
isso, mas uma ferramenta que segmenta o script colado em múltiplos
comandos usando pareamento simples de `$$` (comum em editores de SQL
que mostram resultado por instrução) pode não ser ciente de comentários
e contar esse `$$` extra como abertura/fechamento de bloco — o que
desalinha todo o pareamento seguinte e faz o corpo real da função ser
cortado nos `;` internos como se fossem comandos soltos. Simulado com um
script que reproduz esse pareamento ingênuo: antes da correção, um dos
fragmentos gerados era literalmente `v_owner UUID` isolado; depois da
correção (reescrita só do comentário, sem `$$` adjacente), nenhum
fragmento problemático é gerado. Revalidado contra Postgres local limpo
com o mesmo teste funcional de antes (desconto + idempotência). Ver
`docs/09_CHANGELOG.md`.

## Limitações críticas atuais

### Consumo multicolor

**Corrigido em 20/09/2026:** `desktop-agent/src/index.ts` agora rastreia
todos os slots vistos como ativos durante `RUNNING` num job
(`currentJob.usedSlots`), não só o capturado no início. A finalização
gera uma linha de `print_logs` por slot efetivamente usado, com desconto
individual do spool certo — ver `docs/09_CHANGELOG.md` para a cascata de
4 níveis e a decisão de como dividir a estimativa quando não há
granularidade por cor (slots usados > 1 e sem `slice_info.config`).

### Idempotência/transação

**Corrigido em 20/09/2026:** nova função Postgres
`public.finalize_print_job` (`SECURITY DEFINER`, `search_path` fixo)
recebe o job inteiro (identificado por um `job_id` gerado pelo Agent e
persistido em `agent-state.json`) e roda numa única transação: checa
idempotência (job já processado? não faz nada), verifica dono de cada
spool, desconta o peso e insere todas as linhas de log — tudo ou nada.
Substitui o `UPDATE` direto + `insert` separado que existia antes. Não há
ainda um identificador de job confirmado vindo da própria impressora
(payload MQTT) — ver `docs/09_CHANGELOG.md`, investigação (a), para o
porquê e a limitação residual (job que começa e termina inteiro com o
Agent desligado).

### Status online/offline da impressora

**Risco corrigido em 20/09/2026:** `printers.is_online` só era gravado
como `true` (no login do Agent, no heartbeat de 15s e a cada telemetria
MQTT) — nunca havia um caminho confiável para gravar `false` quando o
processo do Agent parava de rodar sem um encerramento limpo (PC
desligado, hibernação, queda de energia, crash do processo). Resultado: o
app mostrava "ONLINE" indefinidamente mesmo com tudo desligado de
verdade.

Corrigido com `printers.last_seen_at` (migration
`20260920_add_printers_last_seen_at.sql`), atualizado pelo Agent a cada
heartbeat (15s, independente do estado da conexão MQTT) e a cada
telemetria MQTT sincronizada. O frontend parou de ler `is_online`
diretamente — calcula online/offline no cliente comparando
`last_seen_at` com o momento atual: online se a diferença for menor que
`PRINTER_ONLINE_THRESHOLD_MS` (30s, 2× o ciclo de heartbeat, folga para
absorver uma gravação perdida por instabilidade de rede sem deixar a UI
presa em "ONLINE" por muito tempo depois que o Agent realmente parou).
`is_online` continua existindo na tabela e sendo gravado (compatibilidade
com o que já lia o campo), mas deixou de ser a fonte de verdade exibida.
Além disso, o Agent agora grava `is_online: false` num handler de
SIGINT/SIGTERM (Ctrl+C, `kill`) — é só um atalho pro caso de fechamento
limpo, não é a proteção principal (que é o cálculo por recência no
frontend). Ver `docs/09_CHANGELOG.md` (entrada de 20/09) para o racional
completo do limiar escolhido.

### Auto-start do Agent (Windows)

**Adicionado em 20/09/2026:** até então o Agent só subia manualmente
(`npm start`, o `.exe` empacotado, ou o `start-agent.bat` — que, como
descrito na divergência 5 acima, hoje não funciona). Nada iniciava
sozinho no boot/logon do Windows.

Adicionados `desktop-agent/install-autostart.ps1`,
`desktop-agent/run-agent.ps1` e `desktop-agent/uninstall-autostart.ps1`:
registram/removem uma Tarefa Agendada do Windows ("FilamapAgentAutoStart")
disparada no logon do usuário atual, sem janela visível, com até 3
reinícios automáticos (1 min de intervalo) em caso de falha, sem parar
por economia de bateria, e sem o limite padrão de 72h do Task Scheduler
(que mataria um processo de vida longa como esse). `run-agent.ps1`
detecta em tempo de execução se existe `filamap-agent.exe` (preferido) ou
`dist/index.js` e usa o que encontrar — ver divergência 5 sobre por que
essa escolha não foi presumida. Todo stdout/stderr do Agent é redirecionado
para `desktop-agent/agent.log`, sobrescrito a cada novo início (já que a
tarefa roda sem janela, sem isso não haveria nenhuma visibilidade). Isso é
só o mecanismo de auto-start — o instalador completo/auto-update (P2.3 no
backlog) continua pendente. Ver `docs/09_CHANGELOG.md`.

### NFC de leitura

`startScanning()` já está integrado na aba AMS (botão "Ler tag NFC" por
slot vazio, com timeout de 20s e cancelamento) e resolve/associa (ou
auto-cria) o spool pelo `nfc_uid` lido. Continua pendente: a URL `?tag=`
gravada na tag física é escrita mas não é interpretada no carregamento da
página (nenhum parsing de `location.search`) — esse é um mecanismo
diferente (deep link passivo via qualquer leitor NFC do SO, não a leitura
ativa dentro do app) e segue como lacuna separada.

**Risco corrigido em 20/09/2026:** `handleWriteTag` (aba Tags) ignorava o
retorno booleano de `writeTagUrl(...)` — se a gravação física na tag
falhasse, o código ainda assim atualizava `spools.nfc_uid` no banco e
exibia mensagem de sucesso, divergindo permanentemente o conteúdo do
chip físico do valor salvo no banco. Isso reproduziria o sintoma "leitura
de tag já gravada sempre cai no auto-cadastro de desconhecida". Corrigido
com um early-return quando `writeTagUrl` retorna `false`; o erro já era
exibido via `nfcError` no formulário da aba Tags. Ver
`docs/09_CHANGELOG.md` (entradas de 20/09) para a investigação completa.

**Adicionado em 20/09/2026:** `spools.nfc_written_at` (migration
`20260920_add_nfc_written_at.sql`) registra quando a gravação física foi
de fato confirmada por `handleWriteTag`. Estoque e o seletor da aba Tags
agora distinguem: tag gravada fisicamente, `nfc_uid` pendente de gravação
física (ex.: veio de importação em lote), ou sem tag nenhuma. Ver
`docs/09_CHANGELOG.md`.

### Onboarding

**Implementado em 20/09/2026:** o Agent não depende mais de `.env` para uso
comercial. `desktop-agent/src/config/store.ts` resolve a configuração com
prioridade env/`.env` (dev) > arquivo salvo do onboarding > defaults
(`SUPABASE_URL`/`SUPABASE_ANON_KEY`, mesmo valor público já embutido no
bundle do Web App). Quando falta algo essencial (e-mail/senha da conta,
serial/Access Code da impressora) e há terminal interativo,
`src/config/setupWizard.ts` pergunta uma única vez e salva o resultado em
`%APPDATA%\Filamap\config.json` (Windows) / equivalente em macOS/Linux —
execuções seguintes (inclusive via auto-start, sem terminal) não perguntam
de novo. Sem TTY e sem configuração completa, o Agent encerra rápido com
mensagem clara em vez de travar esperando input. Ver
`desktop-agent/README.md` para o fluxo completo e o que ainda falta
(instalador gráfico, assinatura de código, auto-update, cofre de
credenciais do SO) — ver `docs/09_CHANGELOG.md` e
`docs/10_NIVEL_3_RELATORIO.md`.

### Offline

Há persistência do job ativo, mas não foi encontrado buffer persistente de eventos/ações pendentes para sincronizar depois.

### Testes

**Adicionado em 20/09/2026:** não havia nenhum teste automatizado nem
framework de testes configurado em `desktop-agent` antes desta sessão
(apesar de uma descrição de tarefa anterior mencionar 24 unitários + 6 de
integração já passando — não encontrados no branch real; tratado como
divergência de estado, não como algo a preservar, e refeito do zero — ver
`docs/10_NIVEL_3_RELATORIO.md`). Hoje: `vitest` configurado, `npm test`
roda 26 testes unitários (100% passando) cobrindo a cascata de 4 níveis de
consumo, extração de peso do nome do arquivo, matemática de varredura de
sub-rede e resolução de configuração/onboarding. `npm run test:integration`
existe e tem um teste real (não mockado) para o RPC `finalize_print_job`
(incluindo idempotência), mas pula automaticamente sem credenciais de um
projeto Supabase de teste — não executado nesta sessão por falta dessas
credenciais no ambiente. Ainda não há testes para `ftpsParser.ts`
(parsing do `slice_info.config` real) nem para o fluxo completo de
`index.ts` (MQTT/discovery integrados) — ver P1.5/P0.4 no backlog.

### Refatoração do Web App (`App.tsx`)

**Em andamento, avançado em 20/09/2026:** `App.tsx` caiu de 1244 para 1053
linhas nesta sessão, com `npm run build` (`tsc` + `vite build`) validado a
cada etapa e sem mudança de comportamento/visual pretendida. Extraído:
`src/types.ts`, `src/constants.ts`, `src/utils/{printer,nfc,inventory,
selectors,budget}.ts`, `src/services/{dataService,catalogService,
spoolService}.ts`, `src/components/{LoginScreen,WeighSpoolModal,
EditSpoolModal}.tsx`. Ainda dentro de `App.tsx`: os 4 corpos de aba
(AMS/Estoque/Orçamento/Tags — JSX grande, todo com `style` inline) e
`supabase.auth.*` (login/logout). Ver P2.6 em `docs/08_BACKLOG.md` e
`docs/10_NIVEL_3_RELATORIO.md` para o motivo de ter parado aqui nesta
rodada (blocos maiores, sem como confirmar visualmente sem navegador no
ambiente desta sessão).

## Build auditado

Validação executada nesta auditoria (18/09/2026):

- `web-app`: o TypeScript (`tsc`) compilou sem erros. O passo Vite não pôde ser concluído neste ambiente Linux porque o `node_modules` vindo do ZIP é de Windows e não contém o binário opcional `@rollup/rollup-linux-x64-gnu`. Isso é uma limitação do ambiente de auditoria, não evidência de erro no código.
- `desktop-agent`: TypeScript (`tsc`) compilou sem erros.

**Revalidado em 20/09/2026** (ambiente diferente, com `node_modules` Linux
instalado de verdade): `cd web-app && npm run build` completo (tsc + vite
build) passou sem erros; `cd desktop-agent && npx tsc --noEmit` e
`npm test` (26/26) também passaram. Ver `docs/10_NIVEL_3_RELATORIO.md`.

Para validar o build completo no Windows do projeto, executar `npm install`/`npm ci` no ambiente correto e depois `npm run build` em cada pacote.

## Próximo objetivo recomendado do projeto

Antes de acrescentar novas funcionalidades de negócio, estabilizar o núcleo de inventário automático:

1. tornar o schema 100% reproduzível por migrations (ainda pendente —
   ver "Divergência 6" acima e P0.1 no backlog: pelo menos 5 pontos de
   falha confirmados por execução real em 20/09/2026);
2. validar arquivo FTPS/slice info com casos reais (ainda pendente — sem
   hardware nesta sessão);
3. ~~corrigir consumo multicolor~~ — feito em 20/09/2026;
4. ~~implementar finalização atômica/idempotente~~ — feito em 20/09/2026;
5. ~~decidir política explícita de consumo quando não houver dado autoritativo~~ — feito em 20/09/2026 (cascata de 4 níveis);
6. fechar leitura NFC/deep link (ainda pendente — só o `?tag=` no carregamento);
7. somente então evoluir onboarding e experiência comercial.
