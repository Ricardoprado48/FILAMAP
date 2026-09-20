# 07 — Estado Atual do Projeto

**Snapshot auditado:** 18/09/2026  
**Base:** conteúdo do ZIP `desktop-agent.zip` fornecido para auditoria.

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
- baixa de peso;
- gravação de `print_logs`.

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

No código atual, `finalizeJob()` estima por tempo e possui fallback inicial de 35 g; depois grava `needs_weighing: false`.

Portanto, o comportamento real atual é diferente da descrição antiga.

### 3. Migrations não reproduzem o banco usado pelo código

O código usa `print_logs`, `catalog_items`, `price_paid` e várias colunas de telemetria que não são criadas pelas migrations disponíveis.

### 4. RPC segura existe, mas não é usada na baixa atual

`deduct_spool_filament()` foi endurecida, porém `finalizeJob()` atualiza `spools.current_weight` diretamente.

## Limitações críticas atuais

### Consumo multicolor

`currentJob.activeSlot` é capturado no início do job e a finalização baixa um spool. O parser pode retornar múltiplos filamentos, mas a baixa não percorre todos eles.

### Idempotência/transação

Não existe identificador único de job/finalização que impeça baixa dupla. Atualizar spool e inserir log não ocorre em uma única transação.

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

### Onboarding

O Agent depende de configuração por `.env`. Não existe onboarding comercial guiado no código auditado.

### Offline

Há persistência do job ativo, mas não foi encontrado buffer persistente de eventos/ações pendentes para sincronizar depois.

### Testes

Não foram encontrados testes automatizados no pacote auditado.

## Build auditado

Validação executada nesta auditoria:

- `web-app`: o TypeScript (`tsc`) compilou sem erros. O passo Vite não pôde ser concluído neste ambiente Linux porque o `node_modules` vindo do ZIP é de Windows e não contém o binário opcional `@rollup/rollup-linux-x64-gnu`. Isso é uma limitação do ambiente de auditoria, não evidência de erro no código.
- `desktop-agent`: TypeScript (`tsc`) compilou sem erros.

Para validar o build completo no Windows do projeto, executar `npm install`/`npm ci` no ambiente correto e depois `npm run build` em cada pacote.

## Próximo objetivo recomendado do projeto

Antes de acrescentar novas funcionalidades de negócio, estabilizar o núcleo de inventário automático:

1. tornar o schema 100% reproduzível por migrations;
2. validar arquivo FTPS/slice info com casos reais;
3. corrigir consumo multicolor;
4. implementar finalização atômica/idempotente;
5. decidir política explícita de consumo quando não houver dado autoritativo;
6. fechar leitura NFC/deep link;
7. somente então evoluir onboarding e experiência comercial.
