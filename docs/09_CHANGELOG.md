# 09 — Changelog Técnico

Este changelog registra apenas alterações que podem ser confirmadas pelos arquivos presentes no repositório auditado. Datas anteriores nem sempre estão disponíveis no pacote, então os itens históricos são agrupados por evidência/migration.

## 20/09/2026 — Investigação: `ERROR: 42P01: relation "v_owner" does not exist` ao aplicar `20260920_add_print_logs_job_tracking.sql` no Supabase real

**Causa investigada, nenhum código alterado** — o arquivo commitado está
correto; a causa é externa ao repositório.

**Como foi validado:** copiado byte-a-byte (`md5sum` conferido) o
arquivo `supabase/migrations/20260920_add_print_logs_job_tracking.sql`
para um Postgres 16 local limpo (com stub mínimo de `auth.users` /
`auth.uid()` / `auth.role()`), aplicado sozinho via `psql -f` com
`ON_ERROR_STOP=1`. Resultado: `ALTER TABLE`, `COMMENT`, `CREATE INDEX` e
`CREATE FUNCTION` — todos com sucesso, sem nenhum erro. Como
`check_function_bodies` é `on` por padrão no Postgres, o próprio
`CREATE FUNCTION` já compila o corpo plpgsql inteiro nesse momento; se
`v_owner` estivesse de fato mal declarada ou usada fora de contexto, o
erro teria aparecido aqui, e não apareceu.

Em seguida, chamada funcional real da RPC (`SELECT *
FROM public.finalize_print_job(...)`) dentro de uma transação de teste
(`BEGIN ... ROLLBACK`), com um spool de 1000g e um item de 50g:
primeira chamada desconta corretamente para 950g; segunda chamada com o
mesmo `job_id` é idempotente — retorna a mesma linha, sem descontar de
novo (950g mantido). Nenhuma menção a `v_owner` em nenhum erro em
nenhuma das duas chamadas.

**Conclusão:** não é bug real na função (hipótese descartada por
execução real). É aplicação parcial ou corrupção do texto durante a
cópia para o SQL Editor do Supabase — a causa exata de qual caractere
específico se perdeu não pôde ser confirmada nesta sessão (sandboxed,
sem acesso ao projeto Supabase real do usuário para inspecionar o que
efetivamente foi executado lá). Hipótese mais provável, dado o padrão
do erro: a linha 86 (`v_owner UUID;`, dentro do bloco `DECLARE`) não
chegou a ser executada — se o corpo `$$ ... $$` for colado
parcialmente (por exemplo, começando a partir de uma linha no meio do
`DECLARE`, ou com uma ferramenta intermediária tratando `$$` como
delimitador de algo e cortando o texto ali), o Postgres pode compilar
uma função onde `v_owner` nunca foi declarada; nesse caso o uso de
`SELECT ... INTO v_owner FROM ...` faz o parser de plpgsql tentar
resolver `v_owner` como identificador de tabela/relação, exatamente o
erro relatado.

**Recomendação de recuperação (sem alterar o arquivo, que já está
correto):**
1. Não copiar o SQL editando manualmente ou colando de uma janela que
   possa reformatar texto (ex.: apps de chat/notas que tratam `$$` como
   marcação). Preferir copiar direto do GitHub (botão "Raw" do arquivo)
   ou usar `supabase db push` / `supabase migration up` via CLI ligado
   ao projeto, que aplica o arquivo como está no disco, sem colar manual.
2. O arquivo é seguro para reaplicar do zero: todo `ALTER TABLE` usa
   `ADD COLUMN IF NOT EXISTS`, o índice usa `CREATE UNIQUE INDEX IF NOT
   EXISTS`, e a função usa `CREATE OR REPLACE FUNCTION` — rodar de novo
   não duplica nada nem falha por já existir.
3. Depois de reaplicar, confirmar com:
   `SELECT prosrc FROM pg_proc WHERE proname = 'finalize_print_job';`
   e conferir se a linha `v_owner UUID;` aparece no `DECLARE` retornado.

## 20/09/2026 — Consumo multicolor + finalização idempotente/atômica + cascata de 4 níveis

Três problemas que se cruzam em `finalizeJob()` (P0.2, P0.3, P0.5 do
backlog), resolvidos juntos numa única reescrita da função, conforme
solicitado.

### Investigações executadas antes de implementar

**(a) Existe identificador estável de job no payload MQTT?** Não
confirmado. `desktop-agent/src/index.ts` só lê de `print`:
`subtask_name`, `gcode_state`, `mc_percent`, `mc_remaining_time`,
`layer_num`, `total_layer_num`, `nozzle_temper`, `bed_temper`,
`gcode_file`, `mc_total_cost_time`, `mc_cost_time`, `calc_remaining_time`
e `ams.ams[0].tray_tar` — nenhum campo de id de tarefa/job é lido em
nenhum lugar do código. A arquitetura-alvo (`FILAMAP_USER_JOURNEY_ARQUITETURA
(2).md`, Seções 22 e 44) nomeia um `external_task_id` como objetivo, mas
o próprio documento não confirma tê-lo visto num payload real — é visão,
não estado confirmado. Sem hardware real nesta sessão (ambiente
sandboxed) pra inspecionar o payload bruto e confirmar/descartar um
campo assim.

Decisão tomada (autorizada explicitamente pelo enunciado da tarefa como
fallback aceitável): o Agent gera seu próprio `job_id`
(`crypto.randomUUID()`) no momento em que detecta um job novo (mesmo
ponto onde `currentJob` é criado) e persiste em `agent-state.json`. Isso
sobrevive a um restart do Agent no meio de um job (o estado é recarregado
com o mesmo `job_id`, então uma finalização após restart ainda casa com
o que já podia ter sido processado). **Limitação residual, não nova:**
um job que começa E termina inteiramente com o Agent desligado nunca
teve `currentJob` capturado — nesse caso `finalizeJob` gera um `job_id`
novo ali mesmo (sem histórico prévio pra casar), então esse caso
específico não tem proteção de idempotência forte (mas também não tinha
nenhuma antes; não é regressão). Se no futuro for confirmado um campo
estável no payload real (inspecionando um MQTT bruto num teste com
impressora física), trocar pra ele é uma migração simples — só a origem
do `job_id` muda, o resto do mecanismo (índice único, função atômica)
continua igual.

**(b) Sem granularidade por cor (níveis 2/3), como distribuir entre os
slots usados?** Decisão: divide o total estimado igualmente entre todos
os slots detectados como usados (`currentJob.usedSlots`), arredondado a 1
casa decimal por slot. É a opção mais simples e defensável na ausência de
melhor dado, e foi a sugerida no próprio enunciado da tarefa. Alternativa
considerada e **não implementada** (fica pra depois, se fizer diferença
na prática): ponderar pelo tempo em que cada slot ficou ativo, em vez de
dividir igual — exigiria rastrear duração por slot, complexidade extra
não pedida nesta passagem.

**(c) Slot usado sem spool_id em ams_slots (sem check-in)?** Decisão:
insere a linha de `print_logs` mesmo assim (spool_id NULL, slot_index
preenchido, `grams` com o que teria sido consumido), com a nova flag
`orphan_slot = true`, e **não desconta de nenhum spool** (não existe pra
quem descontar). A função `finalize_print_job` pula o UPDATE de
`spools` quando `spool_id` é NULL. Isso dá visibilidade/auditoria ("esse
slot foi usado, ninguém descontou, alguém devia ter feito check-in") sem
inventar dono nem perder o evento silenciosamente.

### Schema (nova migration `20260920_add_print_logs_job_tracking.sql`)

Alvo é **`public.print_logs`** — a tabela real usada pelo Agent e pelo
Web App (`.from("print_logs")` nos dois) — não `public.print_jobs`
(tabela legada sem uso, ver `002_rls_hardening.sql:35`).

- `job_id UUID` (nullable — linhas antigas ficam sem);
- `consumption_quality TEXT DEFAULT 'unknown'`;
- `orphan_slot BOOLEAN NOT NULL DEFAULT false`;
- índice único `(job_id, spool_id)` — parte do mecanismo de idempotência
  (NULL é tratado pelo Postgres como distinto de qualquer outro valor,
  então linhas antigas com `job_id` NULL e múltiplos slots órfãos no
  mesmo job continuam permitidos);
- função nova `public.finalize_print_job(p_job_id, p_printer_id,
  p_subtask_name, p_print_duration_minutes, p_status, p_items jsonb)`,
  `SECURITY DEFINER` + `search_path = public` fixo, seguindo o padrão de
  `deduct_spool_filament` (`002_rls_hardening.sql`): dentro de uma
  transação só, checa se `job_id` já tem alguma linha (se sim, no-op,
  devolve o que já existe), senão para cada item do array verifica dono
  do spool via `auth.uid()` (spool de outro usuário aborta a função
  inteira com `RAISE EXCEPTION`, desfazendo tudo que já rodou nesta
  chamada), desconta o peso (só quando `spool_id` não é NULL) e insere a
  linha de log. `needs_weighing` continua existindo e é derivado como
  `(consumption_quality = 'unknown')`, preservando a lista "pendente de
  pesagem" já implementada no frontend sem precisar tocar nela.

**Divergência encontrada e reportada, não corrigida (fora de escopo):**
a migration `20260918_add_consumption_quality.sql`, de uma sessão
anterior, já tinha tentado adicionar uma coluna parecida, mas (1) alterou
`public.print_jobs` em vez de `public.print_logs`, e (2) seu bloco
`DO \$\$ ... END \$\$;` usa barra invertida antes dos cifrões, que não é
sintaxe válida de dollar-quoting do Postgres. Ver P0.1 no backlog pra
mais achados de migration quebrada, todos confirmados por execução real
nesta sessão (não só leitura):

```
# Ambiente: Postgres 16 local, banco vazio, stub mínimo de auth.users/auth.uid()/auth.role()
psql -f 001_initial_schema.sql        # OK
psql -f 002_rls_hardening.sql         # ERRO: column "user_id" of relation "ams_slots" does not exist
                                       # (a coluna só é criada em 004, que vem depois)
# reordenando 001 -> 004 -> 002:
psql -f 002_rls_hardening.sql         # ERRO: relation "public.print_logs" does not exist
                                       # (só é criada em 005, que também vem depois)
# reordenando 001 -> 004 -> 005(patched) -> 002:
psql -f 002_rls_hardening.sql         # ERRO: relation "public.filament_presets" does not exist
                                       # (nenhuma migration cria essa tabela)
# 005 sozinha, sem reordenar nada:
psql -f 005_reconciliation_schema.sql # ERRO: syntax error at or near "push"
                                       # (dois blocos "do push ... end push;", não é DO $$ ... END $$; válido)
```

### Agent (`desktop-agent/src/index.ts`)

- `ActiveJobState` ganha `jobId` e `usedSlots: number[]` (antes só havia
  `activeSlot`, capturado uma vez);
- o handler de mensagens MQTT agora atualiza `usedSlots` sempre que a AMS
  reporta troca de slot ativo durante `RUNNING`, não só na criação do
  job;
- nova função pura `computeConsumptionPerSlot(usedSlots,
  filamentSliceInfo, filenameGrams, durationMinutes)` implementa a
  cascata de 4 níveis retornando um `Map<slotIndex, {grams, quality,
  weightDiscount}>` — nível 1 usa os dados reais por `trayId` do
  `slice_info.config` (já granular, não precisa dividir); níveis 2/3
  dividem o total estimado igualmente entre `usedSlots` (decisão (b)
  acima); nível 4 nunca inventa peso;
- **correção do desconto de purga/flush não escalado
  (`index.ts:360-364` na numeração antes desta mudança):** em
  `FAILED`/`PAUSE_STOP`/`STOP`, tanto o valor base quanto
  `weightDiscount` (desconto de purga por cor, vindo do
  `slice_info.config`) agora são escalados pelo mesmo `percentExecuted`
  antes de um ser subtraído do outro — antes, `weightDiscount` era
  subtraído em cheio mesmo num job que falhou cedo;
- `finalizeJob` reescrita: monta os itens por slot (com lookup de
  `spool_id` via uma única query em `ams_slots` para todos os slots
  usados de uma vez, `.in("slot_index", ...)`), calcula `orphan_slot`
  (decisão (c) acima) e chama `supabase.rpc("finalize_print_job", ...)`
  uma única vez — substitui o `UPDATE` direto em `spools.current_weight`
  + `insert` separado em `print_logs` que existia antes;
- removidas as funções mortas `evaluateConsumption` e
  `extractWeightFromFilename` (existiam no arquivo, implementavam uma
  versão solta/nunca chamada da cascata de 4 níveis — a lógica real
  agora vive em `computeConsumptionPerSlot`, chamada de fato).

### Escopo

Só `finalizeJob` e o rastreamento de estado do job em `index.ts`, mais a
migration nova. Nada em AMS (UI), Orçamento, Estoque, Tags, autenticação,
ou na tela de "pendente de pesagem" (`needs_weighing` continua sendo
gravado do mesmo jeito que o frontend já lê).

**Efeito colateral visível esperado, não é bug:** um job multicolor agora
gera várias linhas em `print_logs` (uma por slot usado) em vez de uma só.
O histórico recente da aba AMS (`limit(10)`, já existente, não alterado)
vai mostrar essas linhas separadamente.

### Validações executadas

- `tsc --noEmit` e `npm run build` em `desktop-agent`: sem erro.
- Lógica pura de `computeConsumptionPerSlot` + escala de purga: validada
  com uma reimplementação isolada rodada via `node` (8 cenários: exact
  multicolor, exact parcial não inventa peso pro slot sem dado,
  estimated_filename dividido, estimated_duration dividido, unknown não
  desconta, `usedSlots` vazio cai no slot 0, purga escalada
  proporcionalmente, unknown nunca é escalado) — todos passaram. É uma
  reimplementação da mesma lógica pra teste, não uma importação direta do
  módulo real (não há harness de testes no repo).
- **A migration e a função `finalize_print_job` foram executadas de
  verdade** — não só lidas — num Postgres 16 local (`docker`/`psql`
  disponíveis no ambiente), com um stub mínimo de `auth.users`/
  `auth.uid()`/`auth.role()`. Cenários testados com dado real inserido e
  consultado de volta:
  1. job multicolor com 3 slots (2 com spool exato + 1 órfão): deduziu
     corretamente `987.5g`/`494.8g` nos dois spools certos, e a linha do
     slot órfão ficou com `spool_id NULL`, `orphan_slot=true`, sem
     deduzir de ninguém;
  2. reprocessar o mesmo `job_id`: nenhuma linha nova, nenhum desconto
     adicional (idempotência confirmada);
  3. job `unknown`: `needs_weighing=true`, saldo do spool intacto;
  4. `spool_id` de outro usuário: `RAISE EXCEPTION`, `ROLLBACK`, zero
     linhas inseridas (atomicidade/checagem de dono confirmadas).
- **O que não pôde ser validado:** hardware real (impressora Bambu Lab
  física, payload MQTT bruto, `.3mf` real via FTPS) — todo o ambiente de
  teste usou dados inseridos manualmente, não uma execução ponta a ponta
  do Agent contra uma impressora. A pergunta da investigação (a) (existe
  `task_id` no payload real?) continua em aberto até alguém inspecionar
  um payload de verdade.

### Pendências

- P0.1 (migrations não reproduzíveis do zero) continua aberta — achados
  novos documentados acima e no backlog, não corrigidos nesta tarefa.
- P0.4 (validar FTPS/slice_info.config com arquivos reais) continua
  aberta — sem hardware nesta sessão.
- Investigação (a) fica em aberto pra confirmação futura com hardware
  real (ver acima).

## 20/09/2026 — Auto-start do Desktop Agent no logon do Windows (Tarefa Agendada)

**Objetivo desta etapa:** só o mecanismo de "iniciar automaticamente" —
não o instalador completo do backlog P2.3 (empacotamento, auto-update),
que continua em aberto.

**Investigação do método de execução real (item 1 da tarefa) — não deu
pra confirmar com certeza qual é.** Apurado no repositório, sem presumir:

- `desktop-agent/package.json` tem só três scripts: `build` (`tsc`),
  `start` (`tsc && node dist/index.js`) e `package-exe` (`tsc && pkg
  dist/index.js --targets node18-win-x64 --output filamap-agent.exe`).
  **Não existe script `dev`** nesse `package.json`.
- `start-agent.bat` (raiz do repo) — único script de inicialização do
  Agent encontrado — roda `cd /d C:\FILAMAP\desktop-agent` seguido de
  `npm run dev`. Como esse script `dev` não existe em
  `desktop-agent/package.json` (só existe em `web-app/package.json`,
  pro Vite), `start-agent.bat` executado hoje contra este repositório
  falharia com "Missing script: dev" — ou seja, não é (ou não é mais) o
  jeito real de subir o Agent, ao menos não como está commitado.
- `docs/03_FEATURES.md` (linha "Instalador/tray/service robusto") cita
  "Há `.exe`, `start-agent.bat` e script `pkg`" sem diferenciar qual dos
  dois (`.exe` ou `node` direto) é o usado de fato em produção.
- Não há node_modules/dist/.exe commitados (estão no `.gitignore`) que
  permitissem inferir qual foi gerado por último numa máquina real.

**Decisão tomada diante da ambiguidade:** em vez de presumir um dos dois
e arriscar quebrar o fluxo real do usuário, `run-agent.ps1` (novo)
decide em tempo de execução — prefere `filamap-agent.exe` se existir em
`desktop-agent/`, senão cai para `node dist/index.js`. Isso cobre os dois
casos sem exigir a resposta antes de entregar a tarefa. **Pergunta em
aberto pro usuário:** qual dos dois você usa hoje de fato (ou roda outra
coisa que não aparece no repo)? Isso ajuda a simplificar/confirmar esse
script depois.

**Arquivos novos:**

- `desktop-agent/run-agent.ps1`: script chamado pela Tarefa Agendada.
  Faz `Set-Location` pro próprio diretório (garante que `.env` seja
  encontrado — `dotenv.config()` em `index.ts` carrega relativo ao
  `cwd`), decide entre `.exe`/`node` como descrito acima, e redireciona
  todo stdout/stderr (`*>>`) pra `desktop-agent/agent.log`, sobrescrito
  (linha de cabeçalho com timestamp) a cada novo início — a tarefa roda
  sem janela visível, então sem esse redirecionamento se perderia toda a
  visibilidade que hoje vem do terminal aberto manualmente. Não precisou
  alterar `index.ts`: a redireção é inteiramente externa ao processo do
  Agent (stdout/stderr de qualquer processo, Node ou `.exe` empacotado,
  já saem normalmente; só precisavam ser capturados).
- `desktop-agent/install-autostart.ps1`: registra a Tarefa Agendada
  `FilamapAgentAutoStart` via `Register-ScheduledTask`:
  - gatilho `New-ScheduledTaskTrigger -AtLogOn -User <usuário atual>`;
  - ação: `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy
    Bypass -File run-agent.ps1`, com `-WorkingDirectory` apontando pra
    `desktop-agent/` (não só `run-agent.ps1` faz `Set-Location`, a ação
    da tarefa em si também já inicia no diretório certo — dupla
    garantia);
  - `RestartCount 3` + `RestartInterval` de 1 min: reinício automático
    em falha, como pedido;
  - `AllowStartIfOnBatteries` + `DontStopIfGoingOnBatteries`: não para
    por economia de energia (notebook);
  - `ExecutionTimeLimit` zerado: desliga o limite padrão de 72h do Task
    Scheduler — sem isso, o Windows mataria o Agent sozinho depois de 3
    dias rodando contínuo, mesmo sem nenhum erro;
  - idempotente (`-Force`): rodar de novo atualiza a tarefa em vez de
    falhar por já existir.
  - comentário no topo documenta como verificar (`schtasks /query /tn
    "FilamapAgentAutoStart" /v /fo list`, ou `schtasks /run /tn
    "FilamapAgentAutoStart"` pra testar sem esperar o logon) e onde fica
    o log.
- `desktop-agent/uninstall-autostart.ps1`: remove a mesma tarefa
  (`Unregister-ScheduledTask`) de forma limpa, sem mexer num processo já
  em execução nem apagar o log.

**Escopo:** só os três scripts PowerShell novos, mais documentação. Não
alterei `desktop-agent/src/index.ts` (a redireção de log é externa, não
precisou tocar na lógica do Agent), nem `start-agent.bat`, nem nada em
AMS, Orçamento, Estoque, Tags ou consumo automático. Nenhuma migration
nova.

**Validações executadas:** revisão manual da sintaxe dos três scripts
PowerShell (nomes de cmdlet/parâmetros do módulo `ScheduledTasks`
conferidos um a um). **Não foi possível executar/testar em Windows real**
nesta sessão (ambiente Linux, sem PowerShell nem Task Scheduler) — não
consigo confirmar que `Register-ScheduledTask` roda sem elevação em toda
configuração de conta, nem o comportamento exato da redireção `*>>` com
um `.exe` nativo vs. `node.exe`. Recomendo testar com `schtasks /run /tn
"FilamapAgentAutoStart"` logo após instalar, conferir `agent.log`, e só
depois confiar no gatilho de logon.

- `docs/08_BACKLOG.md` (P2.3, sub-item marcado) e `docs/07_CURRENT_STATE.md`
  (nova seção "Auto-start do Agent (Windows)" + divergência 5 sobre
  `start-agent.bat`) atualizados.

## 20/09/2026 — `printers.is_online` travava em "ONLINE" quando o Agent morria sem aviso

**Problema confirmado pelo usuário:** `printers.is_online` só era gravado
como `true` — no login do Agent (`startAgent`, insert/update inicial),
no heartbeat de 15s (`setInterval`) e a cada telemetria MQTT
sincronizada. Não existia nenhum caminho que gravasse `false` quando o
processo parava de rodar por um motivo que não fosse um Ctrl+C limpo (PC
desligado, hibernação, queda de energia, crash) — sem ninguém escrevendo
`false`, o app mostrava "ONLINE" indefinidamente com tudo desligado de
verdade.

- nova migration `supabase/migrations/20260920_add_printers_last_seen_at.sql`:
  adiciona `printers.last_seen_at TIMESTAMPTZ`, nullable, sem default;
- `desktop-agent/src/index.ts`:
  - o heartbeat de 15s (`setInterval` já existente) passa a gravar
    `last_seen_at: now()` no mesmo `UPDATE` que já grava `is_online:
    true` — esse heartbeat roda independente do estado da conexão MQTT
    com a impressora, então é o sinal mais confiável de "o processo do
    Agent ainda está de pé";
  - o objeto `telemetryData` do handler de mensagens MQTT (ciclo já
    existente, no mínimo a cada 2.5s enquanto conectado) também passa a
    incluir `last_seen_at: now()`;
  - novo handler `gracefulShutdown` registrado em `SIGINT` e `SIGTERM`:
    tenta gravar `is_online: false` antes de `process.exit(0)`. É só um
    caminho rápido pro caso de encerramento limpo (Ctrl+C, `kill`) — não
    é a proteção principal, porque não cobre queda de energia/crash/
    hibernação (nenhum desses consegue rodar um handler de sinal);
- `web-app/src/App.tsx`: nova constante `PRINTER_ONLINE_THRESHOLD_MS =
  30000` e função `isPrinterOnline(printer)`, que calculam online no
  cliente comparando `last_seen_at` com `Date.now()`. O badge
  ONLINE/OFFLINE do cabeçalho (única leitura de status de impressora na
  UI) passou de ler `activePrinter.is_online` direto para usar
  `isPrinterOnline(activePrinter)`. `is_online` continua existindo na
  tabela e sendo gravado (não removido do schema nem do Agent), só
  deixou de ser a fonte de verdade exibida;
  - **limiar escolhido: 30s (2× o ciclo de heartbeat de 15s).** O
    heartbeat de 15s é o sinal de menor frequência garantida (roda mesmo
    sem MQTT conectado), então sob operação normal o maior intervalo
    possível entre duas gravações de `last_seen_at` é 15s. Um limiar de
    30s dá folga pra absorver uma gravação perdida por instabilidade de
    rede/Supabase sem piscar pra OFFLINE à toa, sem deixar a UI presa em
    "ONLINE" por muito tempo depois que o Agent realmente parou. A tela
    já faz polling de `printers` a cada 3s (`loadData`/`setInterval`
    existente), então o recálculo de online/offline já acontece nessa
    cadência, sem precisar de um relógio/timer novo só pra isso;
- escopo: só o Agent (`index.ts`) e o badge de status no cabeçalho do
  frontend. Nada em AMS, Orçamento, Estoque, Tags ou lógica de consumo
  automático; nenhuma migration anterior alterada;
- validado com `tsc --noEmit` e `npm run build` em `desktop-agent` e em
  `web-app`, ambos sem erro (foi necessário `npm install` no
  `desktop-agent` nesta sessão — não havia `node_modules`). Não foi
  possível validar em hardware real (matar o processo do Agent de forma
  não-limpa e observar o app cruzar o limiar de 30s) nesta sessão.
- `docs/08_BACKLOG.md` (P0.6) e `docs/07_CURRENT_STATE.md` (nova seção
  "Status online/offline da impressora") atualizados.

## 20/09/2026 — Indicador de gravação física real da tag NFC (`nfc_written_at`)

**Problema:** o Estoque e o seletor da aba Tags só distinguiam "tem
`nfc_uid`" vs "não tem". Isso não diz se alguém de fato encostou o
celular e confirmou a escrita NDEF naquele carretel, ou se o `nfc_uid`
veio de importação em lote (`desktop-agent/seed_spools.ts` +
`filamentos_bambu.json`) sem nenhuma tag física gravada ainda.

- nova migration `supabase/migrations/20260920_add_nfc_written_at.sql`:
  adiciona `spools.nfc_written_at TIMESTAMPTZ`, nullable, sem default e
  sem backfill — linhas existentes continuam com o campo `NULL` até
  passarem por uma gravação física real;
- `web-app/src/App.tsx`, `handleWriteTag`: agora grava
  `nfc_written_at: new Date().toISOString()` no mesmo `UPDATE` que já
  só roda depois que `writeTagUrl(...)` confirma sucesso (fix de
  20/09/2026 anterior) — ou seja, o timestamp só existe quando a escrita
  física foi confirmada pelo `NDEFReader.write()`, nunca em cadastro/edição
  manual nem em importação em lote;
- nova função `getNfcStatus(spool)` classifica cada carretel em três
  estados: `written` (`nfc_written_at` preenchido), `pending` (tem
  `nfc_uid` mas nunca teve gravação física confirmada) e `none` (sem
  `nfc_uid`);
- Estoque (`inventory`): o badge que já existia ao lado da marca passou
  de 2 para 3 estados — ✅ "Tag gravada" (verde, com tooltip mostrando
  data/hora e o `nfc_uid`), ⏳ "Aguardando gravação" (âmbar, tooltip
  explicando a origem), ⚠️ "Sem tag" (vermelho, inalterado). Visualmente
  distinto do botão de atalho 🏷️ que já existia na linha (esse botão
  continua só navegando pra aba Tags, sem mudar de ícone);
- aba Tags, `<select>` de carretel: mesmo critério de 3 estados aplicado
  ao prefixo/sufixo de cada `<option>` (✅/⏳/⚠️ + texto);
- escopo: só Estoque e o seletor da aba Tags. Nenhuma alteração em AMS,
  Orçamento ou lógica de consumo automático/desconto de peso;
- validado com `tsc --noEmit` e `npm run build`, ambos sem erro. Não foi
  possível testar a gravação em hardware NFC real nesta sessão (mesma
  limitação das entradas anteriores) — a lógica foi conferida lendo o
  código (`handleWriteTag` só chega no `UPDATE` após `wroteToTag` ser
  `true`).
- `docs/08_BACKLOG.md`: novo item.

## 20/09/2026 — Falha na gravação física da tag não impedia mais persistir `nfc_uid` no banco

Autorizado como follow-up do achado registrado na entrada anterior
(P1.1b do backlog).

- `web-app/src/App.tsx`, `handleWriteTag`: passa a checar o retorno
  booleano de `writeTagUrl(...)` antes de atualizar `spools.nfc_uid`. Se
  a gravação física falhar (`wroteToTag === false`), a função retorna
  cedo e o UPDATE nunca roda — sem mensagem de sucesso falsa, sem
  divergência entre o chip físico e o banco;
- o erro em si já era exibido: `useNfc.writeTagUrl` seta `error` (via
  `setError`) em caso de falha, e o formulário da aba Tags já renderiza
  esse `nfcError` logo abaixo do botão de submit — não foi necessário
  adicionar nenhum alerta novo;
- escopo: só a aba Tags (`handleWriteTag`), nada em Orçamento, Estoque,
  AMS ou lógica de consumo automático; nenhuma migration alterada;
- validado com `tsc --noEmit` e `npm run build`, ambos sem erro. Não foi
  possível validar em hardware NFC real nesta sessão (mesma limitação já
  registrada na entrada anterior).
- `docs/08_BACKLOG.md` (P1.1b) marcado como concluído.

## 20/09/2026 — Investigação: leitura de tag na AMS ainda cai no placeholder mesmo após o fix de 18/09

Relatado pelo usuário: tag já gravada num carretel real via aba Tags;
ao ler essa mesma tag num slot da AMS, o resultado é sempre o placeholder
"PETG Preto 1000g" (o auto-cadastro de tag desconhecida).

**Formato exato gravado** (`handleWriteTag`, `web-app/src/App.tsx`, fora
do escopo desta alteração — não editado): registro NDEF `recordType:
"url"`, `data` = `https://filamap.pages.dev/?tag=<encodeURIComponent(finalTagId)>`.
Em paralelo, `spools.nfc_uid` recebe o `finalTagId` cru (sem wrapper de
URL, sem encoding).

**Formato exato esperado na leitura** (`extractTagIdFromMessage`,
`web-app/src/hooks/useNfc.ts`, já corrigido em 18/09 para decodificar o
registro NDEF em vez de usar `event.serialNumber`): decodifica o
registro, faz `new URL(texto)` e lê `searchParams.get("tag")` — que já
vem desencodado pelo próprio `URLSearchParams`, batendo com o
`finalTagId` cru gravado no banco.

**Comparação:** os dois formatos batem no papel, no código já mesclado
em 18/09 (commit `c479d43`). Não foi possível reproduzir o bug com
hardware NFC real nesta sessão (ambiente remoto sem dispositivo físico),
então a causa exata do sintoma relatado não pôde ser confirmada
empiricamente. Hipótese mais provável, dado o padrão já visto nesta
mesma conversa: o dispositivo usado para testar (provavelmente acessando
`https://filamap.pages.dev`, a URL fixa gravada nas tags — não confundir
com o ambiente local `npm run dev` do desenvolvedor) pode ainda não
estar rodando o commit `c479d43`; não há visibilidade nem credenciais de
deploy do Cloudflare Pages nesta sessão para confirmar.

**Achado relacionado, fora do escopo autorizado (aba Tags, não
alterado):** `handleWriteTag` chama `await writeTagUrl(...)` e ignora o
retorno booleano — se a gravação física falhar, o código atualiza
`spools.nfc_uid` no banco e mostra "✅ gravado com sucesso" mesmo assim,
divergindo permanentemente o chip físico do banco. Isso reproduziria
exatamente o sintoma relatado (tag sempre cai no fallback de
desconhecida). Não corrigido por estar em `web-app/src/App.tsx` dentro
da aba Tags, fora do escopo travado desta tarefa — recomendado como
follow-up.

**Hardening aplicado (dentro do escopo, leitura/AMS apenas),
`web-app/src/hooks/useNfc.ts`:**
- aceita também `recordType === "absolute-url"` (variação de rótulo do
  mesmo tipo de registro NDEF de URI, dependendo do leitor);
- `trim()` no texto decodificado antes de interpretar;
- fallback: se `new URL(texto)` falhar (ex.: prefixo do identifier code
  da URI NDEF não expandido pelo leitor, texto sem esquema), tenta
  extrair `tag=` direto da query string bruta via regex antes de
  desistir do registro.
- validado com teste unitário isolado (Node, fora do repositório) para
  os casos: registro normal, `absolute-url`, prefixo não expandido, tag
  com acento/espaço, e ausência de registro válido — todos batendo com o
  esperado.

**Não corrigido / não validado:**
- reprodução em hardware NFC real;
- causa raiz definitiva do sintoma relatado (permanece como hipótese de
  deploy desatualizado no dispositivo de teste, ou como o achado do
  `writeTagUrl` sem checagem de retorno);
- carretéis já afetados por qualquer uma dessas causas **não foram
  corrigidos automaticamente** — spools com `brand: "Voolt3D"`,
  `material: "PETG"`, `color_name: "Preto"`, `initial_weight: 1000`,
  `spool_tare_weight: 218` que o usuário não criou manualmente são
  candidatos a placeholder-fantasma e devem ser revisados/removidos
  manualmente no Estoque.

## 20/09/2026 — Inversão de hierarquia visual no card de slot ocupado (AMS)

- `web-app/src/App.tsx`: no card de slot ocupado da aba AMS, a Cor
  (`spool.color_name`) passa a ser o texto principal (14px/700/claro) e
  o Material (`spool.material`) vira o texto secundário (11px, tom mais
  discreto) — inversão simples de qual campo ocupa qual estilo já
  existente, sem novo campo nem mudança de dado;
  peso/saldo e botão "Ejetar" mantidos como estavam.
- validado com `tsc --noEmit` e `npm run build`.

## 20/09/2026 — Redesign do estado vazio do card de slot na aba AMS

- só visual, sem tocar em lógica de leitura NFC, schema ou outras abas;
- `web-app/src/App.tsx`: o botão outline pequeno ("📡 Ler tag NFC") do
  estado vazio de cada card de slot foi substituído por um alvo circular
  de 60px (fundo `#0284c7`, ícone `Nfc` do lucide-react centralizado),
  com dois anéis concêntricos (`#38bdf8`) em animação de pulso contínua
  (`@keyframes filamapNfcPulse`, scale + fade, 2s, defasados em 1s) e
  texto abaixo ("Aproximar tag NFC" / "Toque para ler");
- número do slot e bolinha de status no topo do card mantidos como
  estavam; `onClick` continua chamando `handleScanSlot(slotIdx)`, sem
  mudança de comportamento;
- validado com `tsc --noEmit` e `npm run build` (ambos sem erro) e com
  preview visual isolado (HTML/CSS espelhando os mesmos estilos) via
  screenshot; não foi possível validar na aba AMS autenticada real dentro
  desta sessão (sem credenciais de login do usuário no ambiente).

## 18/09/2026 — Leitura de tag na aba AMS nunca reconhecia carretel já gravado

- causa raiz confirmada: `writeTagUrl` (aba Tags) grava um registro NDEF do
  tipo `url` cujo conteúdo é `https://filamap.pages.dev/?tag=<finalTagId>`
  — `spools.nfc_uid` guarda só o `<finalTagId>` (ex.: `FILA-PETG-...` ou
  valor customizado). Já `startScanning` (`web-app/src/hooks/useNfc.ts`)
  usava `event.serialNumber` — o número de série de **hardware do chip**,
  uma propriedade do NDEFReadingEvent totalmente independente do conteúdo
  gravado nele. Os dois nunca coincidem, então `handleAssignSlot` nunca
  encontrava o spool existente e sempre criava um placeholder novo
  (`Voolt3D`/`PETG`/`Preto`/1000g/218g);
- corrigido em `useNfc.ts`: `onreading` agora decodifica o registro NDEF
  lido (`event.message.records`), extrai o parâmetro `tag` da URL gravada
  e usa esse valor como `nfcUid` — a mesma string que `spools.nfc_uid`
  guarda. `event.serialNumber` vira fallback só para tags que nunca
  passaram pelo fluxo de gravação do app (sem registro NDEF reconhecível);
- **possível dado afetado (não corrigido nesta sessão, a pedido — ajuste
  manual)**: qualquer spool com `brand='Voolt3D'`, `material='PETG'`,
  `color_name='Preto'`, `current_weight=1000`, `spool_tare_weight=218` e
  `nfc_uid` no formato de serial de hardware (ex.: hexadecimal com `:`),
  em vez do padrão `FILA-...` ou de um ID customizado, é candidato a ter
  sido criado por este bug ao tentar ler uma tag já gravada (ex.: o
  "Vermelho Velvet" citado) pela aba AMS. O carretel original citado pelo
  usuário não deve ter sido alterado por este bug — o efeito colateral é a
  criação de um spool "fantasma" adicional, não a corrupção do original.

## 18/09/2026 — Falha silenciosa ao salvar edição de carretel

- investigado relato de que a Tara editada no modal "Editar Carretel" não
  persistia: conferido campo a campo, `handleSaveEdit` (`web-app/src/App.tsx`)
  já incluía `brand`, `material`, `color_name`, `color_hex`,
  `spool_tare_weight`, `current_weight` e `price_paid` no payload do
  `UPDATE` — nenhum campo exibido/editável no modal estava faltando;
- causa raiz real: a chamada ao Supabase não verificava o retorno (`error`
  nem linhas afetadas). No PostgREST/Supabase, quando o RLS filtra a linha
  alvo de um `UPDATE` (ex.: registro cujo `user_id` não é o do usuário
  logado — consistente com o achado anterior de que alguns carretéis têm
  valores "crus" de default, indício de inserção fora do fluxo normal do
  app), a operação retorna sucesso com 0 linhas afetadas, sem `error`. O
  modal fechava e recarregava como se tivesse salvo, mas nada mudava no
  banco — exatamente o sintoma relatado;
- corrigido: `handleSaveEdit` agora usa `.select()` no `update` e verifica
  tanto `error` quanto `data.length === 0`; em qualquer um dos dois casos,
  mostra alerta e mantém o modal aberto (sem descartar o que o usuário
  digitou), só fecha e recarrega em sucesso confirmado;
- não foi alterado schema nem corrigidos dados existentes — se o carretel
  de teste realmente estiver sem `user_id` compatível, isso é um problema
  de dado, fora do escopo desta correção.

## 18/09/2026 — Leitura de tag NFC ligada ao fluxo de slot do AMS

- aba AMS (`web-app/src/App.tsx`): cada slot vazio ganhou o botão "📡 Ler tag
  NFC", que chama `startScanning()` (hook `useNfc`, já existia mas não
  estava conectado a nenhum elemento da UI) e aguarda a leitura de uma tag
  física para aquele slot específico;
- ao ler um `nfcUid`: se já existir `spool` com esse `nfc_uid`, associa ao
  slot; se não existir, segue o fluxo já corrigido de `handleAssignSlot`
  (auto-cria com placeholder e abre a edição pré-preenchida na hora);
- erros tratados com mensagem visível (banner vermelho no painel do AMS):
  `NDEFReader` ausente no navegador/dispositivo, permissão negada, falha de
  leitura da tag — todos já reportados pelo hook `useNfc` via `error`; foi
  adicionado timeout de 20s próprio do fluxo de slot (o hook em si não
  expõe timeout/cancelamento) e um botão "Cancelar" que interrompe a espera
  do lado da UI;
- removido o `onClick` solto que existia no card do slot (associava o
  `nfcUid` corrente a qualquer slot clicado, sem nunca ter uma forma de
  popular esse `nfcUid`) — substituído pelo fluxo explícito por botão;
- investigado (sem alterar) o mecanismo `?tag=<id>` gravado por
  `handleWriteTag` na URL do NDEF: ele é escrito na tag física para uso
  como **deep link passivo** (qualquer leitor NFC do SO abre essa URL ao
  encostar no carretel, mesmo com o app fechado), mas hoje a página não lê
  `location.search`/`URLSearchParams` no carregamento — confirma a lacuna
  já registrada em `docs/08_BACKLOG.md` (P1.1: "ler `?tag=` no
  carregamento"). Não é redundante com `startScanning()`: um é leitura
  ativa dentro do app (usada agora para vincular um slot do AMS), o outro é
  abertura passiva do navegador a partir de qualquer leitor NFC do
  aparelho. Não foi unificado, por estar fora do escopo desta tarefa.

## 18/09/2026 — Auditoria de todos os pontos de INSERT em `spools`

- levantamento completo (grep por `.from("spools").insert`/`.upsert` em
  `web-app/` e `desktop-agent/`) confirma que existe **um único** ponto de
  criação de carretel disparado por ação do usuário: `handleAssignSlot`
  (`web-app/src/App.tsx`), acionado ao clicar num slot vazio do AMS com uma
  tag NFC física desconhecida já lida. Não existe (e nunca existiu neste
  repositório) um botão/formulário "Novo Carretel" na aba Estoque — essa
  hipótese do relatório anterior não se confirmou;
- `handleAssignSlot` gravava marca/material/cor/tara/peso **totalmente
  fixos** (`Voolt3D`/`PETG`/`Preto`/`1000g`/`218g`/`R$85`) porque esse
  fluxo não tem formulário algum — é um auto-cadastro de fallback para tag
  desconhecida, então não há "peso/tara digitado pelo usuário" que estivesse
  sendo descartado; o problema é que o placeholder era persistido como
  definitivo, sem chance de correção imediata;
- correção: após criar o carretel-placeholder e associá-lo ao slot,
  `handleAssignSlot` agora abre automaticamente o modal "Editar Carretel"
  (já com todos os campos, de sessão anterior) pré-preenchido, para que
  marca/material/cor/tara/peso reais sejam informados antes de o registro
  "ficar esquecido" com os defaults;
- `handleWriteTag` (gravação de tag pela aba Tags) segue confirmado como
  `UPDATE` por `spool.id`, nunca `INSERT` — não é fonte deste bug;
- dados já existentes no banco com tara/peso default (1000/200) não foram
  alterados por esta correção — ajuste deve ser feito manualmente pelo
  próprio app, via re-pesagem/edição, conforme solicitado.

## 18/09/2026 — Feedback de gravação de tag e diferenciação visual de carretéis com/sem tag

- `handleWriteTag` (`web-app/src/App.tsx`) agora, após gravação confirmada:
  limpa a seleção do carretel e os campos do formulário da aba Tags e navega
  automaticamente de volta para a aba Estoque, em vez de deixar a tela de
  gravação aberta no mesmo estado;
- a mensagem de sucesso passou a ser um banner global (visível
  independentemente da aba ativa, logo abaixo do cabeçalho), com
  auto-dispensa em 5s e botão de fechar manual;
- Estoque: cada linha de carretel agora mostra um selo visual — verde
  "🏷️ <tag>" quando `nfc_uid` está preenchido, vermelho "⚠️ Sem tag" quando
  não está — no lugar do texto cru "Tag: {nfc_uid}" (que ficava em branco
  sem indicação clara quando vazio);
- aba Tags: o seletor de carretel passou a prefixar cada opção com 🏷️ (já
  tem tag) ou ⚠️ (sem tag), incluindo o sufixo "(sem tag)" nas opções ainda
  não gravadas;
- investigado relato de bug em que os campos Tara/Saldo do modal "Editar
  Carretel" sempre mostravam 1000/200 independente do carretel selecionado:
  auditoria do histórico do git (commit de importação original, commit
  anterior à sessão de vínculo de tags, e o código atual) confirma que
  `openEditModal` sempre derivou `editWeight`/`editTare` a partir do
  `spool` clicado em todas as versões — não há nem nunca houve
  `useState(1000)`/`useState(200)` fixo no código. Os valores 1000 e 200
  coincidem exatamente com os defaults de coluna do Postgres
  (`current_weight NUMERIC(6,2) NOT NULL DEFAULT 1000.00` e
  `spool_tare_weight NUMERIC(6,2) DEFAULT 200.00`, em
  `supabase/migrations/001_initial_schema.sql`), o que indica que os
  registros testados nunca foram pesados/tarados individualmente pelo app
  (prováveis linhas inseridas fora do fluxo `handleAssignSlot`, que grava
  1000/218, não 1000/200) — não uma falha de renderização do formulário.

## 18/09/2026 — Gravação de tag NFC passa a operar sobre carretel já cadastrado

- aba "Tags" (`web-app/src/App.tsx`) deixou de ser um formulário de criação solta:
  Marca/Material/Cor agora são somente leitura, vindos de um seletor de `spools`
  real (query em `inventory`); Tag ID é preenchido a partir de `nfc_uid` do
  carretel selecionado ou gerado se ainda não houver; Peso Balança e Tara
  continuam editáveis; o botão de gravar atualiza o spool existente (`UPDATE`
  por `id`) em vez de criar um novo (antes fazia `upsert` por `nfc_uid`);
- Estoque ganhou atalho por linha (🏷️) para ir direto à aba Tags com o
  carretel já pré-selecionado;
- modal "Editar Carretel" passou a expor marca, material, cor (nome + tom),
  tara e peso — antes só tinha cor e peso; quando o carretel ainda não tem
  `nfc_uid`, o modal oferece um botão para ir direto ao fluxo de gravação de
  tag;
- removida `handleUpdateNfc`, função que já existia mas não estava conectada
  a nenhum elemento da UI;
- nenhuma migration foi criada — `spools.nfc_uid` já cumpre o papel de
  tag_id/slug do carretel.

## 18/09/2026 — Documentação de continuidade para IA

- criado `GEMINI.md`;
- criada estrutura `docs/00` a `docs/09`;
- separado estado implementado de visão-alvo;
- documentadas divergências entre jornada v1.1 e código atual;
- registrado backlog técnico priorizado;
- definido código + documentação como fonte oficial de contexto.

## Migration 004 — correção de `ams_slots.user_id`

- adiciona `user_id` se ausente;
- define default `auth.uid()`;
- realiza backfill pelo dono da impressora.

## Migration 003 — remoção de policies permissivas

- remove policies antigas que poderiam anular as restrictions de RLS por combinação OR.

## Migration 002 — hardening de segurança

- habilita RLS;
- adiciona defaults de `user_id`;
- cria policies por proprietário;
- restringe presets;
- endurece `deduct_spool_filament()`.

## Migration 001 — schema inicial

- cria `spools`;
- cria `printers`;
- cria `ams_slots`;
- cria `print_jobs`;
- cria RPC inicial de desconto.

## Estado funcional identificado no código atual

Sem data de commit disponível no pacote, já existem:

- frontend React com login, AMS, estoque, orçamento, catálogo e NFC writer;
- Agent MQTT;
- tentativa de descoberta automática;
- persistência local de job;
- FTPS + parser 3MF;
- baixa automática + `print_logs`;
- executável Windows do Agent.
