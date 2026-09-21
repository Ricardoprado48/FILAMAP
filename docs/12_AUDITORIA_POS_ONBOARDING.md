# 12 — Auditoria Técnica Pós-Onboarding V2 / DPAPI

**Data da auditoria:** 21/09/2026
**Branch auditada:** `main` (HEAD `0c25b1d` — inclui onboarding comercial v2 e cofre DPAPI)
**Método:** leitura de código linha a linha, execução real de testes/build, e execução real das migrations SQL contra um Postgres 16 local vazio (não só leitura). Nenhum arquivo do projeto foi alterado durante esta auditoria.

---

## 1. Resumo executivo

O projeto está em estado bem mais maduro do que a "Auditoria 07" (18–20/09) registrava: onboarding comercial completo, cofre de segredos DPAPI no Windows, idempotência transacional via RPC, consumo multicolor correto e 57 testes automatizados passando no desktop-agent. A arquitetura de segredos (senha nunca persistida, Access Code/refresh token atrás de `SecretStore`, DPAPI escopado ao usuário do Windows) está bem desenhada e bem testada **no nível de unidade**.

Dois problemas, porém, são graves o suficiente para destacar antes de qualquer piloto comercial:

- **As migrations do Supabase, como estão hoje no repositório, não aplicam do zero em um projeto novo** — reproduzido nesta auditoria executando-as de verdade contra um Postgres 16 vazio (não apenas lendo o SQL). Isso contradiz a conclusão "✅" registrada em `docs/07_CURRENT_STATE.md` para esse mesmo ponto.
- **O caminho de onboarding do Desktop Agent aceita `SUPABASE_SERVICE_KEY` como substituto silencioso da `anon key`** (`src/config/onboarding.ts:36`), o que pode colocar uma credencial `service_role` — que ignora todo o RLS — em um `.env` rodando numa máquina Windows de cliente fora do controle da empresa, violando a regra não-negociável do próprio `CLAUDE.md` ("nenhuma service_role no cliente").

Fora esses dois pontos, não há regressão funcional encontrada nos fluxos de consumo, multicolor, idempotência, redescoberta de IP ou onboarding. Testes e build passam limpos; `tsc --noEmit` sem erros nos dois pacotes.

---

## 🚨 P0 — Achados que bloqueiam ou representam risco grave

### P0.1 — Migrations não aplicam do zero em um projeto Supabase novo (regressão em relação ao que `docs/07` registra como "✅ concluído")

- **Arquivo:** `supabase/migrations/0015_bootstrap_missing_dependencies.sql`
- **Trecho:** todo o arquivo (linhas 1–58), em especial a ordem de nome de arquivo em relação a `001_initial_schema.sql`.
- **Problema:** o Supabase CLI (e qualquer ferramenta que aplique migrations por ordem alfabética do nome do arquivo, que é o padrão) ordena `0015_bootstrap_missing_dependencies.sql` **antes** de `001_initial_schema.sql` (comparação de string: `"0015_"` < `"001_"` porque `'5' < '_'` na 4ª posição). Isso significa que `0015` roda antes de:
  - `001_initial_schema.sql` criar a extensão `uuid-ossp` (usada por `uuid_generate_v4()`, chamada logo na linha 7 de `0015`);
  - `001_initial_schema.sql` criar `public.printers`, `public.spools` e `public.ams_slots` (referenciadas por `0015` via `FOREIGN KEY` e `ALTER TABLE public.ams_slots ...`).
- **Impacto:** qualquer tentativa de recriar o schema do zero (recuperação de desastre, ambiente de homologação, ambiente de CI, ou um segundo projeto Supabase) falha imediatamente na primeira migration aplicada. `docs/07_CURRENT_STATE.md` (seção "Nível 2B — Reconciliação das migrations ✅") e `docs/08_BACKLOG.md` (item P0.1) registram esse ponto como resolvido e "validado no banco remoto" — o que é verdade apenas para o projeto remoto específico que já tinha as tabelas criadas manualmente antes da reconciliação, não para um banco novo.
- **Evidência (reproduzida nesta auditoria):** instalado PostgreSQL 16 localmente (`initdb` + `pg_ctl`, ambiente descartável, removido ao final), criado banco vazio `filamap_fresh`, e aplicadas as 9 migrations em ordem alfabética real (`ls | sort`):
  ```
  0015_bootstrap_missing_dependencies.sql
  001_initial_schema.sql
  002_rls_hardening.sql
  003_close_permissive_policies.sql
  004_fix_ams_slots_user_id.sql
  005_reconciliation_schema.sql
  20260920190000_add_print_logs_job_tracking.sql
  20260920190100_add_nfc_written_at.sql
  20260920190200_add_printers_last_seen_at.sql
  ```
  Resultado ao aplicar a primeira (`0015_bootstrap_missing_dependencies.sql`):
  ```
  ERROR:  function uuid_generate_v4() does not exist
  LINE 2:     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                                          ^
  HINT:  No function matches the given name and argument types. You might need to add explicit type casts.
  ```
  A migration nem chega a executar o `ALTER TABLE public.ams_slots` (que também falharia, pois `ams_slots` só é criada em `001`).
- **Recomendação:** renomear `0015_bootstrap_missing_dependencies.sql` para um timestamp posterior a `001`–`005` (ex.: prefixo `00151_...` não resolve — usar um timestamp real tipo `20260919...`, coerente com o padrão já adotado nas três migrations de 20/09), ou fundir seu conteúdo em `001`/`005`. Depois, repetir esta mesma validação (Postgres vazio + aplicar em ordem) antes de declarar o item novamente como concluído.

### P0.2 — `SUPABASE_SERVICE_KEY` aceito como substituto da `anon key` no caminho de onboarding distribuído ao cliente

- **Arquivo:** `desktop-agent/src/config/onboarding.ts:36`
- **Trecho:**
  ```ts
  supabaseAnonKey: clean(env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY),
  ```
- **Problema:** essa é a mesma função (`readEnvOverrides`) usada tanto pelo modo dev/CI quanto pelo caminho de produção do Agent (`resolveAgentRuntimeConfig`, chamada por `bootstrapRuntimeConfig()` em `index.ts:41`, sem nenhum gate que separe "modo desenvolvedor" de "modo cliente final"). Se, por qualquer motivo, um `.env` na máquina do cliente final tiver `SUPABASE_SERVICE_KEY` preenchido (ex.: um técnico de suporte copia as duas chaves do painel do Supabase, que as lista lado a lado como "Project API keys", e cola a errada; ou um `.env` de debug esquecido pelo próprio time), o Agent monta `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, ...)` com esse valor — ou seja, cria um cliente Supabase com privilégio de `service_role` (contorna **todo** o RLS que sustenta o modelo de segurança inteiro do produto) rodando numa máquina Windows fora do controle da empresa.
- **Impacto:** viola diretamente a regra do próprio `CLAUDE.md` ("nenhuma service_role no cliente") e o comentário que o próprio time já deixou em `supabase/migrations/002_rls_hardening.sql:61` ("nunca a anon key" — no contexto inverso, mas reconhecendo o mesmo risco). Uma vez vazada para uma máquina de cliente, a chave `service_role` não pode ser "revogada" sem rotacionar a chave do projeto inteiro (afetando todos os outros usuários).
- **Evidência:** o mesmo padrão de fallback aparece em três lugares (`desktop-agent/src/config/onboarding.ts:36`, `desktop-agent/seed_presets.ts:8`, `desktop-agent/seed_spools.ts:8`, e no teste `desktop-agent/src/finalize.integration.test.ts:14-20`). Os dois scripts `seed_*.ts` e o teste de integração são utilitários de desenvolvedor (não fazem parte do `pkg`/`.exe` distribuído, não são chamados por `index.ts`), então o risco real está concentrado em `onboarding.ts`.
- **Recomendação:** remover o fallback para `SUPABASE_SERVICE_KEY` de `onboarding.ts` (o caminho que roda na máquina do cliente). Se o fallback for necessário para alguma conta de teste interna, mantê-lo isolado nos scripts de seed/teste (que já não rodam no `.exe` distribuído), nunca no módulo que compõe a configuração de runtime do Agent.

---

## 2. O que está correto

- **Nenhum segredo em texto puro.** `dpapiSecretStore.test.ts` testa explicitamente (em utf-8, latin1 e base64) que nem o valor nem os nomes dos campos (`supabaseRefreshToken`, `printerAccessCode`) aparecem no `secrets.dat`. Confirmado lendo `dpapiSecretStore.ts`: o arquivo em disco é só o blob binário que sai do DPAPI.
- **Senha nunca persistida.** Usada uma vez em `signInWithPassword` (`index.ts:125-131`) e descartada; não há `console.log`/gravação em disco em nenhum ponto do fluxo (`grep` por padrões de log com `password|token|secret` não encontrou nenhuma ocorrência em `desktop-agent/src`).
- **Segredo nunca trafega como argumento de processo.** `dpapiSecretStore.ts` passa o payload só via `stdin` (`spawnSync(..., { input: inputBase64 })`); o script PowerShell em si é estático, sem interpolação do segredo.
- **DPAPI escopado corretamente ao usuário do Windows.** `DataProtectionScope.CurrentUser`, e o auto-start (`install-autostart.ps1`) registra a Tarefa Agendada para rodar no logon do **mesmo usuário atual** (`New-ScheduledTaskTrigger -AtLogOn -User $currentUser`), não como `SYSTEM` — isso é o que faz o DPAPI conseguir descriptografar depois do reboot.
- **`secrets.dat` corrompido/ausente/de outro usuário nunca derruba o Agent.** `WindowsDpapiSecretStore.load()` trata arquivo ausente, base64/JSON inválido e falha do `unprotect` (DPAPI recusando) da mesma forma: retorna `EMPTY_SECRETS`. Coberto por 4 testes distintos em `dpapiSecretStore.test.ts`.
- **Refresh token expirado/revogado é descartado, não repetido para sempre.** `index.ts:117-123`: se `refreshSession` falha, chama `persistSessionSecrets(store, null, ...)` para apagar o token salvo antes de encerrar — a próxima execução interativa vai pedir login de novo em vez de repetir a mesma falha indefinidamente.
- **Nenhuma `service_role` no bundle do Web App** (`web-app/src/lib/supabase.ts` usa só a `anon key` pública, protegida por RLS).
- **RLS habilitado e correto em todas as tabelas expostas** (`spools`, `printers`, `ams_slots`, `print_logs`, `catalog_items`), políticas `owner_all` por `auth.uid() = user_id`, políticas antigas permissivas (`qual: true`) removidas em `003_close_permissive_policies.sql`.
- **`finalize_print_job` e `deduct_spool_filament` verificam dono antes de descontar**, mesmo sendo `SECURITY DEFINER` (`RAISE EXCEPTION` se `auth.uid()` não bate com o dono do spool).
- **Idempotência funciona no caso real de uso** (único Agent, um job por vez): 5 testes de integração cobrindo idempotência, estoque nunca fica negativo, `orphan_slot`, `unknown` sem desconto e multicolor com dois spools — todos com asserção correta contra o schema real via RPC.
- **Consumo multicolor correto**: `usedSlots` acumula todos os slots vistos como ativos durante `RUNNING` (`index.ts:391-399`), não só o inicial; cascata de 4 níveis de qualidade (`exact` → `estimated_filename` → `estimated_duration` → `unknown`) bem coberta por 21 testes em `consumption.test.ts`.
- **Redescoberta de IP** bem isolada em função pura testável (`decideRediscovery`), 5 testes cobrindo todos os ramos (`skip_in_progress`, `skip_connected`, `retry`, `reconnect_same_ip`, `reconnect_new_ip`).
- **Comportamento sem `.env` e com `.env`** ambos corretos: com `.env` completo (5 variáveis), o caminho é preservado 100% (nenhuma chamada a `configStore`/`secretStore`); sem `.env`, cai no onboarding comercial.
- **`web-app`: nenhum import duplicado** encontrado no refactor recente (`App.tsx`, `dataService.ts`, `catalogService.ts`, `selectors.ts`, `inventory.ts`, `nfc.ts`, `printer.ts`, `types.ts` revisados linha a linha).
- **Build e typecheck limpos** nos dois pacotes (ver seção 8).

---

## 3. P1 — Importante antes do piloto

### P1.1 — `start-agent.bat` (raiz do repo) está quebrado e é o ponto de entrada mais visível para um usuário não técnico

- **Arquivo:** `start-agent.bat` (raiz)
- **Trecho:**
  ```bat
  cd /d C:\FILAMAP\desktop-agent
  npm run dev
  ```
- **Problema:** `desktop-agent/package.json` não tem script `dev` (só `build`, `start`, `package-exe`, `test`, `test:integration`) — `dev` só existe em `web-app/package.json`. Além disso, o caminho `C:\FILAMAP\desktop-agent` é fixo, só funciona se o repositório estiver clonado exatamente nesse local.
- **Impacto:** qualquer cliente/testador que veja este `.bat` na raiz do projeto (é o nome mais óbvio: "start-agent") e o execute recebe `npm ERR! Missing script: "dev"` sem nenhuma explicação de que o caminho certo é `npm start`, `node dist/index.js` ou `filamap-agent.exe`. Já está documentado como conhecido em `docs/07_CURRENT_STATE.md` (divergência 5) e `docs/08_BACKLOG.md`, mas o arquivo continua no repositório sem aviso nem correção.
- **Recomendação:** corrigir `start-agent.bat` para chamar `npm start` (ou detectar `.exe`/`dist\index.js` como `run-agent.ps1` já faz), ou remover o arquivo do repositório para não competir com o mecanismo de auto-start já correto.

### P1.2 — Caminho real do DPAPI (`powershell.exe` + `ProtectedData`) nunca foi validado numa máquina Windows de verdade

- **Arquivo:** `desktop-agent/src/config/dpapiSecretStore.ts` (funções `dpapiProtect`/`dpapiUnprotect`, linhas 69-77)
- **Problema:** os 9 testes de `dpapiSecretStore.test.ts` injetam um XOR fake via `WindowsDpapiSecretStoreOptions.protect/unprotect` — nenhum deles chama `spawnSync("powershell.exe", ...)` de fato, porque o ambiente de CI/sandbox é Linux. O próprio `docs/11_AGENT_ONBOARDING_V2.md` (linhas 288-296, 365-370) já registra isso honestamente como pendência.
- **Impacto:** é exatamente o elo central do fluxo comercial descrito pelo usuário ("Windows reinicia → Agent inicia → recupera segredos → autentica sem senha"). Qualquer diferença entre o ambiente de teste e uma máquina Windows real — política de execução do PowerShell restritiva, antivírus interceptando `powershell.exe -Command`, locale/console code page afetando a codificação base64 via stdin/stdout, tamanho de buffer do `spawnSync`, versão do .NET sem `System.Security.Cryptography.ProtectedData` — quebraria silenciosamente a persistência de segredos sem que nenhum teste automatizado tivesse detectado. O único sintoma visível para o cliente final seria "preciso digitar o Access Code de novo toda vez", sem mensagem de erro clara apontando a causa raiz.
- **Recomendação:** antes de qualquer piloto, validar manualmente em uma máquina Windows real: `save()` → reiniciar o processo (idealmente reiniciar a própria máquina) → `load()` devolve os mesmos segredos. Também testar o caso de outro usuário do Windows tentando ler o `secrets.dat` (deve cair em "sem segredo salvo", não travar).

### P1.3 — `pkg` empacota o Agent para o runtime `node18-win-x64`, que está em fim de vida (EOL) desde abril/2025

- **Arquivo:** `desktop-agent/package.json:10`
- **Trecho:** `"package-exe": "tsc && pkg dist/index.js --targets node18-win-x64 --output filamap-agent.exe"`
- **Problema:** Node.js 18 saiu de suporte (sem mais correções de segurança) antes da data desta auditoria. O `.exe` distribuído a clientes reais embutiria esse runtime desatualizado, exposto à rede local (MQTT, FTPS, parsing de XML/ZIP de dados vindos da própria impressora).
- **Impacto:** superfície de risco de segurança/manutenção num artefato que roda continuamente em máquinas de clientes fora do controle da empresa, sem mecanismo de auto-update (já documentado como pendente em `docs/11`).
- **Recomendação:** atualizar o target do `pkg` para uma versão de Node com suporte ativo compatível com a versão do `pkg` em uso (verificar suporte a Node 20/22 no `pkg@5.8.1` antes de trocar; pode exigir atualizar o `pkg` também).

### P1.4 — Reautenticação necessária (refresh token expirado/revogado) não gera nenhum alerta visível para o dono do negócio

- **Arquivos:** `desktop-agent/src/index.ts:117-123` (Agent) + ausência de sinalização correspondente no Web App
- **Problema:** quando o refresh token salvo expira ou é revogado, o Agent registra um aviso só no `console.warn` (que, rodando via Tarefa Agendada sem janela, vai parar em `desktop-agent\agent.log`, sobrescrito a cada novo início) e encerra com `process.exit(1)`. O Task Scheduler tenta reiniciar até 3 vezes (`RestartCount 3`), mas como a causa não é transiente, as 3 tentativas falham do mesmo jeito e o Agent fica parado permanentemente.
- **Impacto:** do ponto de vista do dono do negócio olhando o Web App, a impressora simplesmente aparece "OFFLINE" (via `last_seen_at` parado) — indistinguível de um problema de rede, PC desligado, ou impressora desligada. Não há como saber, sem abrir `agent.log` manualmente, que a causa é "sessão expirada, preciso logar de novo".
- **Recomendação:** considerar gravar no próprio registro do `printers` (ou uma tabela de status do Agent) um motivo explícito quando o Agent encerra por falha de autenticação, para o Web App poder exibir "Reautenticação necessária" em vez de apenas "OFFLINE".

### P1.5 — `dataService.ts` descarta silenciosamente qualquer erro do Supabase em todas as leituras

- **Arquivo:** `web-app/src/services/dataService.ts` (todas as funções: `fetchPrinters`, `fetchActiveSlots`, `fetchInventory`, `fetchCatalog`, `fetchPrintLogs`)
- **Trecho (padrão repetido):**
  ```ts
  const { data } = await supabase.from("printers").select("*");
  return data as Printer[] | null;
  ```
- **Problema:** o campo `error` retornado pelo Supabase nunca é lido. Uma falha de rede, RLS bloqueando a query, ou o token de sessão expirado no navegador resulta silenciosamente em `data === null`, que o `App.tsx` trata como "lista vazia" (ver `loadData()`, linhas 120-150) — sem nenhum aviso ao usuário.
- **Impacto:** o Web App recarrega a cada 3s (`setInterval(loadData, 3000)`); se uma dessas chamadas começar a falhar (ex.: sessão expirada), o dashboard passa a mostrar dados cada vez mais desatualizados (ou zerados) sem qualquer indicação de erro — parece "estoque zerado" ou "impressora sumiu" em vez de "sessão expirada, faça login de novo".
- **Recomendação:** propagar e tratar `error` nas funções de `dataService.ts`, ao menos logando ou expondo um estado de erro visível no `App.tsx` (o app já faz isso em outros pontos, ex. `handleSaveEdit`, então o padrão existe, só não foi aplicado à leitura).

---

## 4. P2 — Melhorias necessárias, não bloqueantes

### P2.1 — Corrida teórica na idempotência de `finalize_print_job` sob chamadas concorrentes de verdade

- **Arquivo:** `supabase/migrations/20260920190000_add_print_logs_job_tracking.sql:88-94`
- **Problema:** o teste de idempotência (`EXISTS (SELECT 1 FROM print_logs WHERE job_id = p_job_id)`) não é atômico por si só. Em teoria, duas chamadas RPC verdadeiramente simultâneas com o mesmo `job_id` passariam ambas pelo `EXISTS` antes de qualquer uma commitar. O índice único `print_logs_job_spool_uniq (job_id, spool_id)` acaba servindo de rede de segurança: a segunda chamada, ao tentar inserir, colide com a constraint e a transação inteira daquela chamada é desfeita (incluindo o desconto de peso que ela já tinha aplicado) — então **não há desconto duplicado persistido**, mas a segunda chamada recebe um erro em vez do retorno idempotente esperado pelo teste (`finalize.integration.test.ts`, que assume que a segunda chamada simplesmente devolve o resultado já existente).
- **Impacto:** baixo na arquitetura atual (um único Agent, um job por vez, processado sequencialmente). Só se torna relevante se o produto evoluir para múltiplos Agents/processos podendo finalizar o mesmo job concorrentemente.
- **Recomendação:** se/quando isso deixar de ser uma garantia arquitetural, trocar o `IF EXISTS` por um lock explícito (`SELECT ... FOR UPDATE` numa tabela de controle, ou `pg_advisory_xact_lock(hashtext(p_job_id::text))`) no início da função.

### P2.2 — Linhas de `orphan_slot` (spool_id NULL) não são protegidas pelo índice único de idempotência

- **Arquivo:** mesmo arquivo, mesma função — `v_spool_id := NULLIF(v_item->>'spool_id', '')::UUID` pode ser `NULL`
- **Problema:** o índice único é `(job_id, spool_id)`. No Postgres, `NULL` nunca é considerado igual a outro `NULL` para fins de unicidade — então duas linhas com o mesmo `job_id` e `spool_id = NULL` (caso de `orphan_slot`) não violam a constraint.
- **Impacto:** no cenário de corrida do P2.1, um slot órfão poderia, em teoria, gerar linhas de log duplicadas em `print_logs` (sem nenhum impacto em saldo de estoque, já que órfão nunca desconta). É um problema de duplicidade de auditoria, não de dinheiro/estoque.
- **Recomendação:** mesmo tratamento do P2.1 (lock explícito), se necessário no futuro.

### P2.3 — Arquivo temporário do FTPS (`./temp_job.3mf`) em caminho relativo, sem limpeza garantida em todos os caminhos de erro

- **Arquivo:** `desktop-agent/src/ftpsParser.ts:46-65`
- **Problema:** `tempFilePath = "./temp_job.3mf"` é relativo ao `cwd` do processo (não a um diretório temporário do SO), e o `fs.unlinkSync(tempFilePath)` só é chamado depois do parse do ZIP, dentro do bloco `try`. Se o `AdmZip`/parse XML lançar uma exceção, o fluxo cai direto no `catch` externo (linha 150-154), que fecha o client FTP mas não limpa o arquivo temporário.
- **Impacto:** baixo isoladamente (um arquivo por falha de parse), mas pode acumular arquivos `.3mf` no diretório de trabalho do Agent ao longo do tempo em instalações com jobs frequentes e slicers com formatos inesperados de `slice_info.config`. Também é um pequeno risco em cenários com múltiplas instâncias do Agent rodando no mesmo diretório (não deveria acontecer, mas o nome fixo não teria proteção contra colisão).
- **Recomendação:** usar `fs.mkdtempSync(os.tmpdir())` para gerar um caminho único por download, e limpar num `finally`.

### P2.4 — Comentário desatualizado referenciando uma migration já removida

- **Arquivo:** `supabase/migrations/20260920190000_add_print_logs_job_tracking.sql:12-19`
- **Problema:** o comentário descreve, em detalhe, um problema em `20260918_add_consumption_quality.sql` (tabela errada + sintaxe `DO \$\$` inválida) como uma "nota de divergência encontrada nesta investigação (não corrigida aqui)". Esse arquivo não existe mais no repositório (`docs/07`/`docs/09` confirmam que ele foi removido na reconciliação de 20/09). O comentário ficou órfão, descrevendo um problema que já não existe fisicamente no repo.
- **Impacto:** confunde quem ler a migration hoje tentando entender "onde está esse arquivo com o problema?" — puramente de manutenibilidade da documentação inline.
- **Recomendação:** atualizar o comentário para refletir que o arquivo problemático foi removido, não apenas "não corrigido".

### P2.5 — `App.tsx` mistura leitura via `services/` com escrita direta via `supabase.from(...)` inline

- **Arquivo:** `web-app/src/App.tsx` (`handleAssignSlot`, `handleEjectSlot`, `handleSaveWeigh`, `handleSaveEdit`, `handleDeleteSpool`, `handleWriteTag` — todas chamam `supabase.from(...)` diretamente, enquanto as leituras já foram extraídas para `dataService.ts`/`catalogService.ts`)
- **Problema:** o refactor recente extraiu somente as leituras (`fetch*`) e o CRUD de catálogo (`catalogService.ts`) para módulos de serviço; toda a escrita em `spools`/`ams_slots` continua inline no componente. Não é um bug, mas é uma inconsistência arquitetural que deixa o `App.tsx` (1174 linhas) ainda como um monólito, na direção oposta do que o próprio backlog já registra como objetivo ("Nível 3 — reduzir o monólito de App.tsx").
- **Impacto:** nenhum funcional. Manutenibilidade/consistência do padrão introduzido pelo refactor.
- **Recomendação:** ao continuar o refactor, mover as escritas de `spools`/`ams_slots` para um `spoolService.ts`/`amsService.ts` seguindo o mesmo padrão já estabelecido.

### P2.6 — `seed_presets.ts`/`seed_spools.ts` aceitam `SUPABASE_SERVICE_KEY` sem nenhum aviso de risco

- **Arquivo:** `desktop-agent/seed_presets.ts:8`, `desktop-agent/seed_spools.ts:8`
- **Problema:** mesmo padrão do P0.2, mas em scripts que só um desenvolvedor roda manualmente (não fazem parte do `.exe`/`pkg`, não são chamados por `index.ts`). Ainda assim, nada nos arquivos avisa que só deveriam ser rodados contra uma conta de teste/projeto de desenvolvimento, nunca com o `.env` de um cliente.
- **Recomendação:** comentário de aviso explícito no topo de ambos os arquivos.

---

## 5. P3 — Melhorias futuras

- **`docs/07_CURRENT_STATE.md`, `docs/09_CHANGELOG.md` e `docs/11_AGENT_ONBOARDING_V2.md` citam "45/45 testes passando"** — o número real hoje é **57/57** (o cofre DPAPI adicionou mais testes depois dessas entradas terem sido escritas). Não é uma divergência grave, mas os três arquivos deveriam ser atualizados juntos para não ficarem "quase certos" (ver seção 9).
- **Service worker (`web-app/public/sw.js`) está registrado (`index.html:17-21`) mas não faz pre-cache de nada no evento `install`** — o fallback `caches.match(e.request)` no handler de `fetch` nunca encontra nada em cache, então o app não funciona de fato offline apesar de ter um Service Worker ativo. Já é uma lacuna conhecida ("PWA/service worker" listado em `docs/07` como "precisa de validação").
- **Ícone do manifest PWA é um único SVG marcado como `"purpose": "any maskable"`** para os dois tamanhos (192/512) — ícones maskable em SVG têm suporte inconsistente entre plataformas de instalação de PWA; nada crítico, mas vale gerar PNGs dedicados se a instalação como app Android/Desktop for um cenário importante.
- **`agent.log` (gerado por `run-agent.ps1`) é sobrescrito a cada início**, sem rotação/retenção — suficiente para depuração pontual, mas insuficiente se o suporte precisar investigar um problema intermitente que aconteceu horas antes do processo reiniciar.
- **`-ExecutionPolicy Bypass` em `install-autostart.ps1`** é uma prática comum, mas pode ser sinalizada por antivírus/EDR corporativo em máquinas de clientes mais restritas — vale ter isso em mente ao escrever o instalador final.
- **Leitura do `?tag=` no carregamento da página (deep link passivo de NFC) continua pendente** — já documentado em `docs/07_CURRENT_STATE.md`, reafirmado aqui: nenhum parsing de `location.search` foi encontrado em `web-app/src`.
- **Ausência de qualquer teste automatizado no `web-app`** — já reconhecido no backlog ("Nível 3"), reafirmado.

---

## 6. Segurança — síntese

| Item verificado | Status |
| --- | --- |
| Segredo em texto puro em disco | ✅ Não encontrado (testado inclusive em utf-8/latin1/base64) |
| `service_role` no cliente (Web App) | ✅ Não encontrado |
| `service_role` no cliente (Desktop Agent) | 🔴 Risco latente — ver P0.2 |
| Senha persistida | ✅ Nunca — usada uma vez e descartada |
| Refresh token tratado corretamente | ✅ Descartado ao expirar/ser revogado |
| Argumentos de processo com segredo | ✅ Não encontrado (`powershell.exe` recebe segredo só via stdin) |
| Logs vazando segredo | ✅ Não encontrado (`grep` dedicado sem ocorrências) |
| DPAPI vinculado ao usuário correto | ✅ `CurrentUser` + Tarefa Agendada no mesmo usuário |
| `secrets.dat` corrompido | ✅ Tratado sem crash (4 testes cobrindo os casos) |
| Logout/reautenticação | ✅ Token inválido descartado; próxima execução interativa pede login |
| RLS habilitado em todas as tabelas de API | ✅ Sim, políticas antigas permissivas removidas |
| RPCs `SECURITY DEFINER` validam dono | ✅ Sim, em ambas (`deduct_spool_filament`, `finalize_print_job`) |

---

## 7. Testes executados (resultado exato)

### `desktop-agent`

```
$ npx tsc --noEmit
(sem saída — 0 erros)
```

```
$ npm test
# tests 57
# suites 0
# pass 57
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 168.222053
```

```
$ npm run test:integration
# Error: Configure SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_EMAIL e AGENT_PASSWORD no .env
# tests 1 / pass 0 / fail 1
```
> Limitação do ambiente de auditoria (sandbox sem `.env`/credenciais de um projeto Supabase de teste), não uma falha de código — o teste está corretamente projetado para exigir essas variáveis (`finalize.integration.test.ts:25-34`).

### `web-app`

```
$ npm run build
> tsc && vite build
✓ 1521 modules transformed.
dist/index.html                  1.01 kB │ gzip:   0.57 kB
dist/assets/index-BBarYnK5.js  419.01 kB │ gzip: 115.59 kB
✓ built in 2.52s
```

### Validação extra realizada nesta auditoria (fora da lista literal, mas dentro do escopo "Banco/Supabase: migrations atuais")

```
$ initdb + pg_ctl (PostgreSQL 16 local, descartável) + psql aplicando
  supabase/migrations/*.sql em ordem alfabética real (ls | sort)

=== Applying 0015_bootstrap_missing_dependencies.sql ===
ERROR:  function uuid_generate_v4() does not exist
>>> STOPPED at 0015_bootstrap_missing_dependencies.sql <<<
```
Ver P0.1. Ambiente de teste removido ao final (nenhum arquivo do projeto foi tocado).

---

## 8. Divergências de documentação encontradas

| Documento | Afirmação | Realidade | Severidade |
| --- | --- | --- | --- |
| `docs/07_CURRENT_STATE.md` (seção "Nível 2B") | "Migrations aplicadas com sucesso no Supabase remoto" / "✅" | Verdade só para o projeto remoto já existente; falha do zero (ver P0.1) | Alta — leva a crer que o item está fechado |
| `docs/07_CURRENT_STATE.md` (seção "Onboarding comercial v2") | "cofre de segredos seguro do Windows... continua **não implementado**" | Já implementado (`WindowsDpapiSecretStore`, commits `36f0ec2`/`109a3b9`/`0c25b1d`, posteriores à escrita dessa seção) | Média — desatualizado, mas `docs/11` tem a informação correta |
| `docs/07_CURRENT_STATE.md`, `docs/09_CHANGELOG.md`, `docs/11_AGENT_ONBOARDING_V2.md` | "45/45 testes passando" | 57/57 hoje (DPAPI adicionou testes depois) | Baixa |
| `supabase/migrations/20260920190000_...sql` (comentário) | Descreve um problema em `20260918_add_consumption_quality.sql` como "não corrigido" | Esse arquivo já foi removido do repositório | Baixa |

Nenhuma divergência foi encontrada nas descrições de consumo multicolor, idempotência, RLS ou redescoberta de IP — essas partes da documentação batem com o código.

---

## 9. Fluxo comercial ponta a ponta — pontos incompletos identificados

Fluxo auditado (instala → primeira execução → login → descoberta → Access Code → DPAPI salva → fecha → Windows reinicia → inicia de novo → recupera segredos → autentica sem senha → encontra impressora → MQTT → heartbeat → Web App ONLINE):

1. **"Instala o Agent"** não tem, hoje, um instalador de verdade — só um binário único via `pkg` (sem wizard, sem atalho, sem desinstalador no Painel de Controle). Documentado como pendência conhecida (`docs/11`, seção 11).
2. **`start-agent.bat`**, o script mais visível na raiz do repositório, está quebrado (P1.1) — risco real de um usuário/testador tentar usá-lo em vez do fluxo correto.
3. **Login → descoberta → Access Code → DPAPI salva**: implementado e coerente end-to-end no código e nos testes unitários.
4. **"Windows reinicia → Agent inicia novamente → recupera segredos → autentica sem senha"**: a lógica está correta e testada com um cofre DPAPI *simulado*, mas o elo real (`powershell.exe` de verdade numa máquina Windows) nunca foi exercitado (P1.2) — é o maior risco não mitigado deste fluxo.
5. **Se o refresh token salvo expira/é revogado** entre uma execução e outra, o Agent para silenciosamente (do ponto de vista do dono do negócio, que só vê "OFFLINE" no Web App) — P1.4.
6. **Encontra impressora → MQTT → heartbeat → Web App ONLINE**: implementado e coerente; `last_seen_at`/`PRINTER_ONLINE_THRESHOLD_MS` (30s) é uma escolha razoável e já documentada.

Conclusão desta seção: o fluzo descrito pelo usuário **funciona no papel e nos testes automatizados**, mas tem uma lacuna de validação real de ponta a ponta (nunca rodou numa máquina Windows física com uma Bambu Lab real) — exatamente o que `docs/11` já assume como pendência, e que esta auditoria reforça como pré-requisito antes de um piloto.

---

## 10. Riscos de empacotamento

- **Runtime `node18-win-x64` (EOL)** embutido pelo `pkg` — P1.3.
- **Sem assinatura de código** — SmartScreen/antivírus vão alertar "editor desconhecido" ao abrir o `.exe` num PC de cliente pela primeira vez; já documentado como pendência (`docs/11`).
- **`-ExecutionPolicy Bypass`** nos scripts de auto-start pode ser sinalizado por soluções de segurança corporativas mais restritivas.
- **Nenhuma dependência nativa (`.node`)** encontrada nas dependências diretas do Agent (`basic-ftp`, `adm-zip`, `fast-xml-parser`, `mqtt`, `ws`, `@supabase/supabase-js`) — bom sinal para o pipeline atual do `pkg` (evita o problema de compilar binário por arquitetura).
- **`run-agent.ps1` decide em tempo de execução entre `.exe` e `dist\index.js`** — resiliente a qual dos dois artefatos foi de fato gerado, mas depende de pelo menos um deles existir no diretório; se nenhum dos dois for gerado antes de instalar o auto-start, a tarefa é criada mas falha silenciosamente (só visível em `agent.log`).
- **Instalação em outro PC Windows**: não testada nesta auditoria (sem acesso a uma segunda máquina Windows); o único ponto sensível identificado no código é justamente o DPAPI (P1.2) e o `%APPDATA%\Filamap\` (caminho por usuário, deveria funcionar em qualquer PC Windows sem adaptação).

---

## 11. Checklist antes do piloto

- [ ] **P0.1** — Corrigir ordenação das migrations e validar aplicação do zero (Postgres vazio) antes de reafirmar "reconciliação concluída".
- [ ] **P0.2** — Remover o fallback `SUPABASE_SERVICE_KEY` do caminho de onboarding do cliente (`onboarding.ts`).
- [ ] **P1.1** — Corrigir ou remover `start-agent.bat`.
- [ ] **P1.2** — Validar o cofre DPAPI numa máquina Windows real (save → reiniciar → load).
- [ ] **P1.3** — Atualizar o target de runtime do `pkg` para uma versão de Node com suporte ativo.
- [ ] **P1.4** — Decidir como sinalizar "reautenticação necessária" no Web App.
- [ ] **P1.5** — Tratar `error` nas funções de `dataService.ts`.
- [ ] Testar o onboarding completo com uma Bambu Lab real na rede (descoberta automática de serial e IP) — nenhuma sessão de auditoria até agora teve acesso a hardware real.
- [ ] Atualizar `docs/07_CURRENT_STATE.md` para refletir o cofre DPAPI e a contagem real de testes (57).

---

## 12. Próximos passos recomendados

1. Resolver os dois achados P0 antes de qualquer outra prioridade — ambos são baratos de corrigir (renomear um arquivo de migration; remover uma linha de fallback) e o custo de não corrigi-los antes de um piloto é alto.
2. Fazer a validação física pendente (P1.2, DPAPI em Windows real; hardware real da Bambu Lab) — é a única lacuna que nenhum teste automatizado consegue fechar sozinho.
3. Corrigir `start-agent.bat` (P1.1) e o target de runtime do `pkg` (P1.3) — ambos rápidos e de baixo risco.
4. Só então seguir para os itens de Nível 3 já conhecidos no backlog (reduzir o monólito de `App.tsx`, instalador gráfico, assinatura de código, auto-update, cofre de segredos fora do Windows).

---

*Esta auditoria não alterou nenhum arquivo do projeto além da criação deste próprio relatório. O ambiente PostgreSQL local usado para reproduzir o P0.1 foi criado e destruído inteiramente fora do diretório do projeto (`/home/pgtest_data`, removido ao final da sessão).*
