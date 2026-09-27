# 09 — Changelog Técnico

## 27/09/2026 — Correção de Regressão MQTT: Remoção de Assinatura em /request

- **Causa Raiz Identificada:** O broker MQTT local da Bambu Lab A1 fecha sumariamente conexões que tentem assinar o tópico `device/${PRINTER_SERIAL}/request` (reservado apenas para comandos enviados à impressora).
- **Correção em `desktop-agent/src/index.ts`:** Removida a linha `client.subscribe(device/${PRINTER_SERIAL}/request)`. Mantida a assinatura exclusiva em `device/${PRINTER_SERIAL}/report`.
- **Validação de `ams_mapping`:** O payload regular do tópico `/report` fornece `print.ams_mapping`, garantindo captura do mapeamento multicolor sem instabilidade de rede.
- **Testes:** 173 unitários e 13 de integração PASS (186/186 PASS). Teste live de 15s com a impressora física comprovou 0 reconnects e 0 disconnects.
- **Hashes da Release:** Agent `D15909F2EA548642D75C9BDA6BFCBC4390CABC9E8892D050CCB35431962824B2`, Instalador `4524F89973C6AE95886ADB98E4CE875AB5F3BB9A6E1500200D44903290BE49E2`.

## 27/09/2026 — Gate 1: Mapeamento Multicolor Autorizado e Telemetria tray_now

Correção da causa raiz do desvio de mapeamento em impressões multicolor e do congelamento do "Slot em Uso" na telemetria, conforme aprovado no Gate 1 e emendas arquiteturais autoritativas.

### G1.1 — Mapeamento Multicolor e Precedência Determinística (`ftpsParser.ts` e `consumption.ts`)
- **Parser do .3MF (`ftpsParser.ts`):** `FilamentSliceInfo` estendido com `logicalIndex`, `filamentId`, `material` e `trayInfoIdx`. O mapeamento anterior assumia `trayId = parsed - 1`, o que sobrepunha indevidamente índices lógicos em slots físicos contíguos, ignorando slots intermediários vazios na AMS.
- **Precedência de Mapeamento de 4 Níveis (`resolveFilamentSliceToAmsSlots`):**
  - **Prioridade 1:** `ams_mapping` do MQTT (array ex: `[0, 2, 3]`). Cada filamento lógico `i` é atribuído ao slot físico `ams_mapping[i]`.
  - **Prioridade 2:** Slot físico AMS derivado do mapeamento.
  - **Prioridade 3:** Reconciliação dos carretéis físicos nos slots (`ams_slots`).
  - **Prioridade 4:** Carretel físico associado ao slot.
- **Regra Autoritativa de Ambiguidade:**
  - Se `ams_mapping` estiver ausente e houver exatamente 1 candidato compatível por cor/material: resolve automaticamente.
  - Se houver 2 ou mais candidatos: NÃO ADIVINHA; status = `AMBIGUOUS`; NÃO debita estoque (`spool_id = null`); NÃO marca `needs_weighing` por punição de ambiguidade; solicita identificação física.
  - Proibido qualquer fallback sequencial por slots ocupados.
- **Fixture do Incidente Validada:** Slices 0 (2.77g), 1 (2.83g), 2 (0.76g) com `ams_mapping = [0, 2, 3]` mapeiam com exatidão para os slots 0 (Preto Velvet: 2.8g), 2 (Vermelho Ultra Silk: 2.8g) e 3 (Branco PETG: 0.8g), resultando em exatamente zero logs órfãos e slot 1 (vazio) não tocado.

### G1.2 — Telemetria de Slot em Uso (`jobStateMachine.ts`)
- **Causa Raiz Resolvida:** O Agent lia `print.ams?.ams?.[0]?.tray_tar`. Na telemetria real da Bambu Lab A1 / AMS Lite, a propriedade reportada é `print.ams.tray_now`. Como era `undefined`, `activeSlotIndex` permanecia permanentemente congelado em 0 (Slot 1).
- **Tratamento do Valor 255:** O valor `255` emitido durante retração e troca de filamento é tratado estritamente como transição: nunca é convertido para 0 e nunca entra no array `usedSlots`.
- **Acúmulo de Slots Usados:** Sequência de troca de slots (0 -> 2 -> 3) validada com `usedSlots = [0, 2, 3]`.

### G1.3 — Captura e Persistência de `ams_mapping` (`index.ts`)
- Subscrição dos tópicos `device/${PRINTER_SERIAL}/report` e `device/${PRINTER_SERIAL}/request` no broker MQTT.
- Captura de `ams_mapping` no início do trabalho e persistência no estado do agente em `%APPDATA%\Filamap\agent-state.json`.

### G1.4 — Suíte de Testes
- 172/172 unitários (+9 novos testes específicos de Gate 1) PASS.
- 13/13 testes de integração PASS.
- Total: 185/185 PASS (0 falhas, 0 regressões).

## 26/09/2026 — Correção de Localização AMS & Auditoria de Contagem Real (30 vs 29)

Implementação da rotina única e idempotente de projeção de slots da AMS, isolamento da contagem física real na interface Web e auditoria detalhada do inventário físico (30x29).

### AMS.1 — Projeção e Reconciliação Automática da AMS (`desktop-agent/src/amsProjection.ts`)
- **Autoridade Física Local:** Estabelecido que o MQTT local (porta 8883) é a única fonte autoritativa de presença/ocupação física da impressora. A nuvem Bambu é tratada como fonte secundária sujeita a cache stale.
- **Parser de Telemetria (`parseMqttAmsStatus`):** Normaliza o array `tray` e a máscara `tray_exist_bits` (ex.: `"d"` = `0b1101` -> slots 0, 2, 3 ocupados; slot 1 vazio), extraindo tipos de material e cores normalizadas em `#RRGGBB`.
- **Reconciliação Determinística (`reconcileAmsState`):**
  - Ocupação estrita orientada pelo hardware local.
  - Validação de material incompatível: descarta atribuições fantasmas ou stale da nuvem Bambu.
  - No Slot 4: a Bambu Cloud reportava erroneamente `PLA Lite AMARELO` (PLA), mas o hardware MQTT reportava `PETG Branco` (`FFFFFFFF`). O conflito foi resolvido a favor do hardware: `PLA Lite AMARELO` foi desvinculado do slot mantendo 100% de seus dados e 950g intactos no inventário; `MasterPrint PETG Branco` foi vinculado ao Slot 4.
  - Sincronização executada em 3 gatilhos automáticos: conexão MQTT (`pushall`), alteração de estado `print.ams`/`tray_exist_bits`, e após cada ciclo de Cloud Spool Sync (sem depender de finalização de print jobs).
- **Validação ao Vivo e Idempotência:**
  - Projeção executada com sucesso contra o Supabase de produção: Slot 1 -> Preto Velvet, Slot 2 -> Vazio, Slot 3 -> Vermelho Ultra Silk, Slot 4 -> MasterPrint PETG Branco.
  - Segunda execução imediata gerou `slotsUpdated: 0, spoolsUpdated: 0, conflictsCount: 0` (idempotência perfeita).
- **Testes Unitários:** 8 novos testes adicionados em `amsProjection.test.ts` cobrindo todos os cenários de conflito, desvinculação limpa, compatibilidade e falhas parciais.

### AMS.2 — Interface Web: Total Físico Isolado de Filtros (`web-app`)
- **Problema:** Ao aplicar filtros de material (ex.: filtrar por PLA) ou pesquisa textual, a seção "Na Impressora Agora" ocultava os carretéis que não batiam com o filtro e reduzia o número exibido, criando a falsa impressão de que havia menos carretéis instalados no hardware.
- **Correção:** Implementada função `getInPrinterCountDisplay(visibleCount, totalCount)` em `web-app/src/utils/inventory.ts` com testes em `inventory.test.ts`. A seção "Na Impressora Agora" agora calcula `totalInPrinterCount` a partir do inventário não-filtrado e renderiza `📍 Na Impressora Agora (3)` quando todos estão visíveis, ou `(X de 3)` quando há filtros ativos.
- Adicionada mensagem informativa caso todos os carretéis instalados sejam filtrados pelo usuário.

### AMS.3 — Auditoria e Consolidação Definitiva do Inventário Físico em 29 Carretéis
- **Constatação e Fato Físico do Cliente:** O cliente confirmou formalmente que o inventário real da oficina possui exatamente 29 carretéis físicos.
- **Correção dos Carretéis Vermelhos (Invalidação da Fusão):**
  - O cliente comprovou que existem dois carretéis físicos vermelhos reais e distintos: `Voolt3D PLA Vermelho Velvet` (`ceff1f7e`, 52g, com NFC `FILA-PLA-VERMELHO-VELVET`) e `Voolt3D PLA Vermelho Ultra Silk` (`d2863713`, 830g, no Slot 3 da AMS).
  - Ambos foram preservados como entidades independentes, com pesos originais intactos e sem qualquer fusão.
- **Identificação do Verdadeiro 30º Excedente (Carretéis Pretos):**
  - O cliente confirmou que existem no estoque apenas `Voolt3D PLA Preto Velvet` e `MasterPrint PETG Preto`. Não existe carretel físico `Voolt3D PETG Preto`.
  - No banco existia `1e1e2428-5d99-48c0-a04d-e11dc508e8d0` (`Voolt3D PETG Preto`, NFC `53:2c:de:99:33:00:01`), criado como teste/leitura avulsa em 17/09.
  - Auditoria técnica comprovou: 0 dependências em `ams_slots`, 0 em `print_logs`, `bambu_spool_id: null`, `bambu_in_printer: false`.
- **Execução Segura da Remoção:**
  - Backup persistido em `backups/spool_1e1e2428_backup.json` e script de restauração criado (`scratch/rollback_candidate_30.js`).
  - Registro excluído do Supabase (`DELETE FROM spools WHERE id = '1e1e2428-5d99-48c0-a04d-e11dc508e8d0'`).
  - Contagem de `spools` verificada em exatamente 29 registros legítimos.
- **Validação E2E Pós-Remoção:**
  - Executado ciclo completo de `syncBambuCloudSpools`: `spoolsInserted: 0` e total permaneceu em 29 (prova de idempotência).
  - Executada rotina `syncAmsProjection`: todos os 4 slots atribuídos corretamente (Slot 1: Preto Velvet 900g, Slot 2: Vazio, Slot 3: Vermelho Ultra Silk 830g, Slot 4: MasterPrint PETG Branco 450g).
  - Integridade dos pesos verificada: Vermelho Velvet 52g intacto, Vermelho Ultra Silk 830g intacto, MasterPrint PETG Preto 1000g intacto, PLA Lite Amarelo 950g intacto no estoque (fora da AMS).

### AMS.4 — Compilação e Releases
- Desktop Agent: 163/163 unitários PASS, 13/13 integração PASS.
- Web App: 62/62 unitários PASS, build de produção PASS.
- Binários gerados:
  - Agent Executable: `filamap-agent.exe` (SHA256: `ABB40E10DB188F1AF6B0F071EF62154DDCA900D9565B81CABA366C2CDE2CACEA`).
  - Bridge: `filamap-bambu-bridge.exe` (SHA256: `116B144218D7726F45E72F55B22DF81BFCE72A6F99E30149A713097862DEE9B3`).
  - Installer Setup: `FilamapAgentSetup.exe` (SHA256: `28018F2ADF626D94CA96ED3238E0BF3D0EDFAEBEDCEE008090DD916C0E13739D`).

## 26/09/2026 — Fase F: Resolução de Identidade Física e Deduplicação

Resolução definitiva da duplicação de carretéis entre ecossistema Bambu e NFC, consolidação física de inventário e prevenção de regressão de estoque.

### F.1 — Deduplicação e Fusão de Carretéis Físicos
- **Diagnóstico:** Tabela `spools` possuía 42 registros (28 carretéis físicos originais com NFC e peso confirmado + 14 registros sincronizados via Bambu Cloud). Destes 14, apenas 1 era fisicamente novo (`PLA Lite AMARELO`, Bambu Lab com RFID no slot 3) e 13 representavam "gêmeos digitais" concorrentes de carretéis de terceiros existentes.
- **Fusão e Sobrevivência:** Executadas 10 fusões onde o carretel original cadastrado sobreviveu (mantendo seu `nfc_uid`, peso inicial/tara, peso confirmado e histórico de consumo), recebendo `bambu_spool_id`, `bambu_in_printer`, `bambu_slot_id` e metadados.
- **Aliases Secundários:** 2 duplicatas secundárias da nuvem Bambu (`15788790` - Off White Velvet e `15306058` - Rosa Choque) foram removidas da tabela `spools` e registradas em `bambu_source_metadata.secondary_bambu_spool_ids` no carretel sobrevivente.
- **Carretéis Legítimos Independentes:** O carretel `d2863713` (Voolt3D PLA Vermelho Ultra Silk, 830g) foi preservado como carretel físico independente (distinto de Vermelho Velvet, 52g), evitando corrupção de peso real.
- **Integridade Relacional:** Todas as 12 linhas em `print_logs` e slots em `ams_slots` foram migradas para os sobreviventes antes da exclusão das duplicatas. Zero órfãos resultantes.
- **Estoque Consolidado:** Inventário final fixado em exatamente 30 carretéis físicos reais no Supabase (28 originais com NFC + 1 Bambu Lab Amarelo + 1 Voolt3D Ultra Silk). Script de migração (`desktop-agent/scripts/migrate-fusion.js`) e rollback (`desktop-agent/scripts/rollback-fusion.js`) criados.

### F.2 — Reconciliação Inteligente no Cloud Sync (`desktop-agent/src/bambuCloudSpoolSync.ts`)
- Implementada função `findStrongReconciliationCandidate` e `isStrongCandidateMatch`:
  - Compatibilidade rígida de material (PLA com PLA, PETG com PETG).
  - Comparação de descritor de cor e remoção de prefixos técnicos.
  - Regra de segurança física: só reconcilia se houver correspondência ÚNICA. Havendo ambiguidade (mais de 1 candidato compatível desvinculado), retorna `null` para evitar débitos incorretos às cegas.
- Suporte a `secondary_bambu_spool_ids`: atualiza localização de carretéis com IDs secundários da Bambu sem duplicar linhas.
- Implementada função `resolveSpoolBrand`: separa rigorosamente Marca real de Origem do dado (identifica Bambu Lab apenas via RFID; detecta marcas como Voolt3D, MasterPrint, Easy Print, Fusion no nome; recorre a "Genérico" caso contrário).
- **Validação ao Vivo:** Teste de sincronização executado contra o Supabase de produção comprovou idempotência total (`totalRecords: 15, skippedRecords: 1, profilesUpserted: 12, spoolsInserted: 0, spoolsUpdated: 12`). O estoque permaneceu estritamente em 30 carretéis.
- 7 novos testes unitários adicionados em `bambuCloudSpoolSync.test.ts`.

### F.3 — Distinção de Marca vs Origem na Interface Web (`web-app`)
- Adicionada função `getSpoolBrandDisplay(brand, material)` em `web-app/src/utils/inventory.ts` com testes em `inventory.test.ts`: normaliza brands idênticos ao material ou marcadores para "Genérico", sem confundir origem com marca.
- Interface Web (`App.tsx`):
  - Badge alterado de `🌐 Bambu` para `🌐 Sincronizado` com tooltip: `"Origem do registro: sincronizado via ecossistema Bambu (Cloud Spool Sync)"`.
  - Texto da modal de pesagem atualizado para `"Este carretel foi sincronizado via ecossistema Bambu e ainda não foi pesado no Filamap..."`.

### F.4 — Builds e Release
- Testes Unitários Agent: 155/155 PASS.
- Testes de Integração Agent: 13/13 PASS.
- Testes Unitários Web: 60/60 PASS.
- Build de Produção Web: PASS.
- Executável empacotado: `filamap-agent.exe` (SHA256: `2F51816ABE9E7BFE0376E7A0CBE00B75CE83836F812A1AAC4E3D7354C52DEEB0`).
- Bambu Bridge: `filamap-bambu-bridge.exe` (SHA256: `116B144218D7726F45E72F55B22DF81BFCE72A6F99E30149A713097862DEE9B3`).
- Instalador Inno Setup gerado: `FilamapAgentSetup.exe` (SHA256: `C3424700506853F7B0AAE75ED68AA53E883ECBAD2DA315E20ABFFA0CDC223256`).

## 26/09/2026 — Fase F0: Resoluções Operacionais e Empacotamento de Release

Investigação e resolução dos problemas de telemetria stale e exibição de carretéis identificados no início da Fase F0.

### F0.A — Auth / RLS / Telemetria Stale (`8f2226f`, `02a1b03`)
- **Causa raiz:** No Desktop Agent, `promptLogin()` chamava `bootstrapRuntimeConfig()`, que recriava a instância global `supabase` como cliente anônimo. O login subsequente autenticava apenas uma variável local, deixando o agente com um cliente anônimo que falhava queries de `printers` e `user_filament_profiles` sob RLS (`owner_all`). Sem registrar o printer, MQTT e heartbeat não iniciavam, mantendo telemetria antiga (`gcode_state: RUNNING`) no Supabase.
- **Correção Agent:** Preservação do cliente Supabase instanciado e invocação explícita de `supabase.auth.setSession(...)` no `sessionManager.ts`, além de passar `user_id` autenticado na inserção de impressora.
- **Correção Web App:** No componente `LivePrintCard`, a exibição de impressão ao vivo agora utiliza `isPrinterLivePrinting(printer)` (`isPrinterOnline(printer) && (gcode_state === 'RUNNING' || gcode_state === 'PAUSE')`). Quando a impressora está offline, a telemetria antiga não é exibida como ativa. 10 testes unitários adicionados (`web-app/src/utils/printer.test.ts`).

### F0.B — Resolução de Cores HEX e Nomes de Carretel (`c556ba1`)
- **Causa raiz:** O Bambu Cloud Spool Sync gravava `spool.color` (ex.: `#161616`) no campo `color_name` e deixava `color_hex` nulo. Na interface Web, o card renderizava `spool.color_name` como título do carretel, exibindo códigos HEX como `#161616`, `#F72323`.
- **Correção Agent:** Implementada normalização estrita de códigos HEX para `color_hex` (`#RRGGBB`) e resolução de nomes legíveis para `color_name` a partir do perfil (`filamentName` / `profileDisplayName`), com rotina de auto-cura para registros existentes. Testes adicionados em `bambuCloudSpoolSync.test.ts`.
- **Correção Web App:** Utilitários `getSpoolDisplayName`, `getSpoolSwatchColor` e `isHexColor` adicionados em `web-app/src/utils/inventory.ts`, com 15 testes unitários. Interface Web atualizada para aplicar nomes legíveis em cards, AMS slots, logs de impressão e modais.
- **Backfill Supabase:** Script de backfill executado contra o Supabase de produção corrigindo todos os 14 carretéis da Bambu Cloud, substituindo nomes HEX por nomes legíveis e preenchendo `color_hex`.

### F0.C — Empacotamento Determinístico e Release (`cd0a4b7`)
- **Causa raiz do deadlock:** O `@yao-pkg/pkg` no Windows trava em IPC pipes (`fetched-v22.23.2-win-x64`) ao fabricar cache V8 bytecode para mais de 2.000 módulos JS via stdin (`fabricator.js`).
- **Correção:** Ajustadas flags do comando `pkg` para `--public --public-packages "*" --no-bytecode` em `desktop-agent/scripts/package-exe.ps1`, reduzindo o tempo de empacotamento de horas (com travamento) para ~15 segundos.
- **Artefatos gerados:**
  - Agent Executable: `desktop-agent/installer/payload/filamap-agent.exe` (SHA256: `C6ECAAC0E21F7202ADD98AD0553A3F7E90330519998BE0E1AB1B3F679FA1A05D`)
  - Bambu Bridge: `desktop-agent/installer/payload/bambu-bridge/filamap-bambu-bridge.exe` (SHA256: `116B144218D7726F45E72F55B22DF81BFCE72A6F99E30149A713097862DEE9B3`)
  - Instalador Inno Setup: `desktop-agent/installer/output/FilamapAgentSetup.exe` (SHA256: `23EC10CF65C8D6E8B920F0278CE53D16BB7B5B8700BBC79A4B8295DB218E4028`)

## 25/09/2026 — Fase E: Estabilidade Operacional do Núcleo (E1, E2, E3)

Fechamento completo da Fase E com 143/143 testes unitários e 13/13 testes de integração passando.

### E1 — Phantom Job / Máquina de Estados MQTT (`9bc9785`)
- Implementada classe pura `JobStateMachine` (`desktop-agent/src/jobStateMachine.ts`) para processamento de telemetria MQTT da Bambu Lab tolerante a deltas parciais.
- Preservação estrita de `jobId`, `subtaskName`, `gcodeFile`, slots usados e progresso máximo entre deltas que omitem campos.
- Descarte automático de jobs espúrios com 0% em estado `IDLE` sem geração de débito ou print_logs.
- Finalização única garantida (`FINISH`, `STOP`, `FAILED`, `REPLACED`).
- Cobertura com 13 testes unitários cobrindo todos os cenários de deltas, reinicialização e limpeza.

### E2 — Autenticação Automática no Boot (`744300f`)
- Implementado `desktop-agent/src/config/sessionManager.ts` com recuperação resiliente de sessão.
- Diferenciação estrita de erros transitórios de rede/DNS (retentados com backoff exponencial sem apagar o segredo local) versus revogação comprovada (`invalid_grant`/400/401).
- Preservação perpétua do `PRINTER_ACCESS_CODE` e do `refresh_token` durante blips de conectividade no logon do Windows.
- O usuário não precisa mais digitar senha em boots rotineiros.
- Cobertura com 10 testes unitários simulando falhas de rede, DNS e revogação.

### E3 — FTPS / .3MF / slice_info.config (`e1ef6d5`)
- Identificada e comprovada em hardware real a causa raiz do `Timeout (control socket)`: o servidor FTPS da Bambu Lab na porta 990 requer TLS Implícito. O uso de `secure: true` no `basic-ftp` disparava FTPS Explícito (texto claro + AUTH TLS). Corrigido para `secure: "implicit"`.
- Comprovado em hardware real que a raiz do FTP da impressora é o próprio SD card (`/`), e requisições iniciando por `/sdcard/` falham com erro 550. Implementada normalização de caminhos (`normalizeRemoteFtpPath`) com fallback inteligente entre `/`, `/cache/` e `/model/`.
- Comprovado em arquivos reais (.3mf do Bambu Studio) que o peso de filamento reside na propriedade `used_g` (não apenas `model_g`/`total_g`) e que os IDs de filamento no slicer XML são 1-based (`id="1"` -> slot `0`), reconciliando com `plate_1.json`.
- Isolamento e segurança de arquivos temporários: uso de `os.tmpdir()` com UUID aleatório e remoção garantida em bloco `finally`.
- Cobertura com 11 testes unitários novos em `desktop-agent/src/ftpsParser.test.ts`.

## 24/09/2026 — Gate Zero, baseline e reconciliação documental

Baseline confirmado em Windows para `main@3ce850a`:

- Git local e remoto alinhados;
- Desktop Agent build PASS;
- 106/106 testes unitários PASS;
- 13/13 testes de integração PASS;
- Web App 33/33 testes PASS;
- Web App build de produção PASS;
- `supabase migration list --linked` confirmou migrations local/remoto
  alinhadas até `20260923120000`.

Também foi confirmado que o Agent atualmente instalado é anterior a
`3ce850a`; portanto a homologação real anterior não valida a lógica nova de
resolução física. A próxima etapa é gerar uma release atual, instalar com
controle de hash e repetir a homologação operacional antes do Golden Test.

A documentação foi reconciliada para refletir onboarding gráfico Windows,
DPAPI CurrentUser, instalador/auto-start, testes automatizados, Cloud Spool
Sync, weight gate e resolução automática de spool físico.


Este changelog registra apenas alterações que podem ser confirmadas pelos arquivos presentes no repositório auditado. Datas anteriores nem sempre estão disponíveis no pacote, então os itens históricos são agrupados por evidência/migration.

## 23/09/2026 (2) — Resolução automática do spool físico via localização Bambu Cloud

Escopo: até aqui, `finalizeJob()` resolvia slot → spool físico só por
`ams_slots.spool_id` (vínculo por toque de NFC); a Bambu Cloud só entrava
como cross-check de divergência, nunca como fonte de resolução. Isso exigia
o usuário tocar a tag NFC de novo toda vez que trocava um spool no AMS,
mesmo quando a Bambu Cloud já sabia exatamente qual spool estava em qual
slot. Bridge C++, `bambuCloudSpoolSync.ts` e Web não foram alterados.

### Fonte de verdade escolhida

Por slot, em ordem de prioridade:
1. **Bambu Cloud** -- spool do usuário com `bambu_in_printer = true`,
   `bambu_dev_id` igual ao serial da impressora do job e `bambu_slot_id`
   igual ao slot. Só resolve por aqui quando há **exatamente 1** candidato;
   0 ou mais de 1 (ambíguo) nunca é tratado como resposta.
2. **`ams_slots.spool_id`** (vínculo NFC) -- usado sempre que a Bambu Cloud
   não resolver: spool nunca sincronizado da nuvem (cadastro manual),
   sincronizado mas não mais reportado no AMS, ou caso ambíguo.
3. Nenhuma das duas -- `orphan_slot`, sem débito incorreto (comportamento
   já existente, preservado).

`bambu_ams_id` (unidade física do AMS) deliberadamente não entra no
filtro: a arquitetura atual só suporta 1 unidade AMS por impressora
(`ams_slots.slot_index BETWEEN 0 AND 3`, MQTT só lê `ams.ams[0]` em
`index.ts`) e o job não carrega hoje qual unidade AMS foi usada. Confirmado
também nos dados reais de produção que `bambu_ams_id` vem `null` em vários
spools que já têm `bambu_slot_id` preenchido -- filtrar por ele seria
inseguro. Uma eventual segunda unidade AMS cairia no caso ">1 candidatos"
e voltaria com segurança para o vínculo NFC, em vez de resolver errado.

### `ams_slots`: papel final

Passa a ser tratado como **projeção/cache da localização física**, não só
do vínculo NFC. Depois que a RPC `finalize_print_job` confirma o consumo
com sucesso, se a Prioridade 1 resolveu um spool diferente do que estava
gravado (ou não havia nada gravado), `finalizeJob()` corrige
`ams_slots.spool_id` com o mesmo `upsert` idempotente já usado pelo fluxo
de NFC na Web (`handleAssignSlot`). Escrita condicional e idempotente --
reprocessar o mesmo job depois do vínculo já corrigido não gera nenhuma
escrita nova (`computeAmsSlotSelfHeals`).

### NFC: papel final

Continua sendo a única forma de identificar um spool fora da impressora
(inventário, pesagem, operações manuais) e o único caminho para spools sem
`bambu_spool_id`. Dentro do AMS, deixa de ser pré-requisito para consumo
automático quando a Bambu Cloud já identifica o spool com segurança --
colocar o carretel físico no slot já basta.

### Conflito (Bambu Cloud × NFC)

Nunca consome dos dois. Prevalece a Bambu Cloud somente quando ela resolve
sem ambiguidade (regra acima); a divergência é logada
(`console.warn`, sem alerta/notificação nova) e `ams_slots` é corrigido
depois da RPC ter sucesso. Confirmado em dados reais de produção: os slots
0 e 3 da impressora `03919D570307088` tinham vínculo NFC apontando para um
spool diferente do que a Bambu Cloud reporta fisicamente ali agora --
exatamente o cenário que este mecanismo resolve.

### Sem Cloud (spool nunca sincronizado ou sem candidato unívoco)

Cai para `ams_slots.spool_id`; se também não houver, `orphan_slot` (sem
alterar nenhum saldo), como já era o comportamento antes desta fase.

### Troca de spool durante a impressão (limitação documentada)

O Agent não guarda hoje um snapshot da identidade Bambu por slot capturado
no início do job -- só o que a Bambu Cloud reporta no momento do
`finalizeJob()` (sync a cada 300000ms). Se o usuário trocar um spool
fisicamente durante uma impressão em andamento, entre dois syncs, a
resolução no fim do job pode não capturar a troca com precisão. Não foi
inventada nenhuma lógica de snapshot por job/slot para cobrir esse caso --
documentado como limitação real, coberta apenas pelo cross-check de
divergência já existente (`detectPhysicalIdentityMismatches`), que continua
ativo para os slots resolvidos por fallback (`ams_slots`).

### Peso

Regra preservada sem alteração: `current_weight` só é descontado quando
`weight_confirmed_at IS NOT NULL`, independentemente de qual prioridade
resolveu o spool_id. Confirmado nos testes de integração cobrindo spool
resolvido via Bambu Cloud com e sem peso confirmado.

### Testes

- **Unitários** (`npm test`, sem banco): +23 novos em `consumption.test.ts`
  cobrindo `resolvePhysicalSpoolForSlot`/`resolvePhysicalSpoolsForJob`
  (Bambu Cloud sem NFC, concordância, conflito, fallback, ambiguidade,
  nenhuma fonte, multicolor 3 slots), `groupBambuCandidatesBySlot`
  (agrupamento, isolamento por impressora, `in_printer=false`, slot
  inválido/ausente, ambiguidade) e `computeAmsSlotSelfHeals` (heal novo,
  heal por conflito, no-op quando já correto, no-op para fallback/none,
  idempotência de ponta a ponta). 106/106 no total.
- **Integração** (`npm run test:integration`, banco real): novo arquivo
  `resolution.integration.test.ts` com 3 testes que replicam as queries
  reais de `finalizeJob()` -- conflito Bambu×NFC com self-heal e
  reprocessamento idempotente do mesmo job; spool sem NFC nunca tocado
  populando `ams_slots` pela primeira vez; isolamento por impressora com
  duas impressoras reais. 13/13 no total (10 pré-existentes + 3 novos).

### Homologação real

Inspeção somente leitura (sem RPC, sem `upsert`, nenhum spool movido,
nenhuma impressão interrompida) contra o projeto Supabase de produção
(`gqtlszffgvxsqcmefhyd`), impressora real `03919D570307088`:
- 4 spools Bambu Cloud reportados `in_printer=true` nos slots 0-3, cada um
  com exatamente 1 candidato -- incluindo `bambu_spool_id 15582983` (slot
  2) e `15589421` (slot 1), citados no escopo desta fase.
- Slots 1 e 2 não têm nenhum vínculo NFC hoje (`ams_slots.spool_id = null`)
  -- confirma o caso real "resolve só pela Bambu Cloud, sem NFC".
- Slots 0 e 3 têm vínculo NFC apontando para spools diferentes dos que a
  Bambu Cloud reporta fisicamente ali -- confirma o caso real de conflito
  em produção, não só hipotético.
- Todos os 4 spools ainda têm `weight_confirmed_at = NULL` -- a regra de
  peso da fase anterior continua se aplicando sem alteração.

### Arquivos alterados

- `desktop-agent/src/consumption.ts` -- `resolvePhysicalSpoolForSlot`,
  `resolvePhysicalSpoolsForJob`, `groupBambuCandidatesBySlot`,
  `computeAmsSlotSelfHeals` (novo); `SlotResolution`,
  `SlotResolutionSource`, `BambuSyncedSpoolRow`, `AmsSlotSelfHeal` (tipos
  novos).
- `desktop-agent/src/index.ts` -- `finalizeJob()` passa a rodar a segunda
  query (candidatos Bambu Cloud), a resolução por prioridade, o log de
  conflito e o self-heal de `ams_slots` após a RPC.
- `desktop-agent/src/consumption.test.ts` -- testes novos (acima).
- `desktop-agent/src/resolution.integration.test.ts` -- novo.
- `desktop-agent/package.json` -- `test:integration` passa a incluir o
  novo arquivo.

### Migrations

Nenhuma. Reaproveita 100% do schema existente (`ams_slots.spool_id`,
`spools.bambu_*`, `spools.weight_confirmed_at`).

### Limitações restantes

- Troca de spool **durante** um job em andamento, entre dois syncs da
  Bambu Cloud, pode não ser capturada com precisão (ver seção acima) --
  limitação real, não coberta por invenção de snapshot.
- Multi-AMS (mais de 1 unidade física por impressora) permanece fora de
  escopo -- arquitetura de `ams_slots` e captura MQTT já assumiam isso
  antes desta fase; ambiguidade cai com segurança para o vínculo NFC em
  vez de quebrar.
- Spool externo (fora de qualquer AMS, ex.: bobina lateral) não tem
  tratamento dedicado -- mesma lacuna pré-existente, não inventada agora.

## 23/09/2026 — Consumo automático end-to-end usando spools físicos da Bambu

Escopo: fechar a lacuna entre o Cloud Spool Sync (`bambu_spool_id`,
`bambu_dev_id`, `bambu_ams_id`, `bambu_slot_id`, `bambu_in_printer`, todos
de `20260922140000_add_bambu_cloud_spool_sync.sql`) e o desconto real de
`current_weight` por job. Web App, bridge C++ e `bambuCloudSpoolSync.ts`
não foram alterados.

### Lacuna encontrada

`public.finalize_print_job` descontava `current_weight` de **qualquer**
`spool_id` resolvido, mesmo quando o spool era recém-sincronizado da Bambu
Cloud e `current_weight` ainda era só o default da coluna (1000g) — nunca
uma pesagem real (`weight_confirmed_at` existe desde
`20260922150000_add_spools_weight_confirmed_at.sql` e já era lido pelo
frontend, mas a RPC nunca chegou a checá-lo). Confirmado contra dados reais
de produção: os 12 spools sincronizados da Bambu Cloud no banco atual têm
`weight_confirmed_at = NULL`.

### Alterado

- `supabase/migrations/20260923120000_finalize_print_job_weight_gate.sql`
  (nova, aplicada no banco remoto via `supabase db push`) —
  `finalize_print_job` só desconta `current_weight` quando
  `spools.weight_confirmed_at IS NOT NULL`. Sem isso, a linha de
  `print_logs` continua sendo gravada normalmente (consumo/qualidade
  preservados) e `needs_weighing` passa a cobrir dois motivos
  independentes: `consumption_quality = 'unknown'` (como antes) OU spool
  identificado mas sem peso confirmado (novo). Nenhuma coluna nova em
  `print_logs`; reaproveita `needs_weighing`, já lido por
  `getPendingWeighingLogs` no Web App.
- `desktop-agent/src/consumption.ts` — nova
  `detectPhysicalIdentityMismatches()`: compara o vínculo slot -> spool por
  NFC (`ams_slots.spool_id`, fonte da verdade já existente, associação por
  identidade física via toque de tag — nunca por material/cor/nome) contra
  o snapshot mais recente da própria Bambu Cloud
  (`bambu_dev_id`/`bambu_slot_id`/`bambu_in_printer`). Só relata
  divergência quando há dado suficiente da nuvem para afirmar algo
  (inconclusivo ≠ divergente); nunca troca o `spool_id` sozinha — o vínculo
  por NFC continua sendo o sinal mais forte, e o sync da nuvem roda a cada
  5 minutos (pode estar desatualizado). `bambu_dev_id` é comparado contra
  `printers.serial`: confirmado contra dados reais de produção que os dois
  valores são idênticos (`03919D570307088` nos dois lados) para spools
  atualmente na impressora.
- `desktop-agent/src/index.ts::finalizeJob` — passa a buscar
  `weight_confirmed_at` e os campos `bambu_*` junto com `ams_slots` (join
  em `spools`, mesma query, sem custo extra), loga um aviso quando um slot
  vai gerar consumo mas o spool ainda não tem peso confirmado (mesmo
  padrão do aviso já existente para `orphan_slot`), chama
  `detectPhysicalIdentityMismatches()` e loga cada divergência encontrada.
  `totalDeducted` do log final passou a refletir só o que a RPC realmente
  desconta (antes contava todo `spool_id` presente, mesmo sem peso
  confirmado).

### Limitações documentadas (não implementadas nesta fase, de propósito)

- **Troca de spool no mesmo slot sem reler a tag NFC**: não há como
  detectar com certeza — o cross-check acima só *sinaliza* (log) quando a
  Bambu Cloud contradiz o vínculo NFC, nunca decide sozinho. Sem alertas
  novos (fora de escopo) e sem redesenho de arquitetura para isso.
- **Múltiplas unidades de AMS por impressora**: fora de escopo — o schema
  atual (`ams_slots.slot_index` 0-3, sem coluna de AMS) já assume uma
  única AMS por impressora desde `001_initial_schema.sql`; não alterado.
- **Catch-up retroativo**: quando um spool passa a ter peso confirmado
  depois de já ter jobs registrados com `needs_weighing = true` por falta
  de pesagem, o consumo já logado não é aplicado retroativamente a
  `current_weight`. Não pedido no escopo desta fase.

### Testes

- `desktop-agent/src/consumption.test.ts` — 10 testes novos para
  `detectPhysicalIdentityMismatches` (sem dado suficiente não gera
  divergência; concordância não gera divergência; `bambu_in_printer=false`,
  `dev_id` diferente e `slot_id` diferente cada um gera divergência;
  slot órfão nunca gera divergência; multicolor isola a divergência ao
  slot certo). 28/28 testes de `consumption.test.ts` passando, 88/88 no
  total (`npm test`).
- `desktop-agent/src/finalize.integration.test.ts` — 4 testes novos contra
  o banco remoto real (`npm run test:integration`): spool sem peso
  confirmado registra consumo sem descontar; idempotência do mesmo caso;
  multicolor com um spool confirmado e outro não (desconta só o
  confirmado); `nfc_uid`/colunas `bambu_*` preservadas após finalizar.
  10/10 testes de integração passando contra o projeto Supabase real
  (`gqtlszffgvxsqcmefhyd`).
- Homologação real adicional (scripts descartáveis, não commitados):
  leitura read-only do banco de produção confirmou `bambu_dev_id ==
  printers.serial` em spools reais na impressora, e uma rechamada de
  `finalize_print_job` contra um `job_id` real já processado (com payload
  deliberadamente diferente, incluindo gramas absurdas) confirmou que a
  guarda de idempotência bloqueia qualquer novo processamento — nenhuma
  linha nova, nenhum peso alterado.

## 21/09/2026 — Onboarding comercial do Desktop Agent (v2)

Branch `claude/agent-onboarding-v2`, criada a partir de `origin/main`
(`5704d43`). Escopo exclusivo: onboarding comercial do Desktop Agent —
Web App, migrations, consumo, descoberta de IP/reconexão MQTT existentes
não foram alterados (só reutilizados). Relatório completo em
`docs/11_AGENT_ONBOARDING_V2.md`.

### Adicionado

- `desktop-agent/src/printerDiscovery.ts` — extração mecânica (sem
  mudança de comportamento) da descoberta SSDP que já existia dentro de
  `index.ts`. Adiciona `discoverPrinter()`, que também expõe o serial
  anunciado no campo `USN`, usado só pelo onboarding.
- `desktop-agent/src/config/configStore.ts` — config não secreta
  (e-mail, serial, último IP) persistida em `%APPDATA%\Filamap\config.json`
  (Windows) e equivalentes em macOS/Linux.
- `desktop-agent/src/config/secretStore.ts` — abstração `SecretStore`
  para segredos (refresh token da sessão Supabase + Access Code da
  impressora; senha nunca é persistida). `EnvSecretStore` cobre dev/CI.
  Cofre comercial (Credential Manager/DPAPI/`keytar`) fica deliberadamente
  **não implementado** — decisão de arquitetura documentada como
  bloqueada, não tomada silenciosamente.
- `desktop-agent/src/config/onboarding.ts` + `onboardingCli.ts` — decide o
  que falta configurar, tenta descoberta automática do serial antes de
  perguntar, monta o runtime config final. Lógica de decisão separada da
  UI de terminal (interface `OnboardingPrompts` injetada), pensada para
  ser trocável por uma tela gráfica sem reescrever a lógica.
- `desktop-agent/src/config/supabaseDefaults.ts` — URL/anon key públicos
  embutidos (mesmo par já no bundle do web-app).
- `desktop-agent/README.md` — documenta o fluxo de onboarding, onde cada
  dado fica, e o que falta para o instalador `.exe`.
- 21 testes novos em `node:test` (mesmo framework já usado no projeto —
  **Vitest não foi instalado**): `configStore.test.ts` (7),
  `secretStore.test.ts` (7), `onboarding.test.ts` (9 + 2 unitários).
- `docs/11_AGENT_ONBOARDING_V2.md` — relatório completo da sessão.

### Alterado

- `desktop-agent/src/index.ts` — bootstrap inicial trocado por
  `bootstrapRuntimeConfig()`. Caminho `.env` completo (as 5 variáveis de
  sempre) preservado byte a byte, verificado manualmente (processo vai
  direto para `signInWithPassword`, `config.json` nunca criado). Caminho
  sem `.env` completo usa a nova arquitetura. Autenticação passou a
  aceitar `signInWithPassword` (senha) ou `refreshSession` (sessão salva);
  refresh token inválido é descartado para não repetir a mesma falha
  indefinidamente.
- `desktop-agent/.env.example` — comentários atualizados (`.env` é
  opcional/dev-only); nova variável opcional `SUPABASE_REFRESH_TOKEN`
  documentada.
- `desktop-agent/package.json` — script `test` passou a incluir os 3
  novos arquivos de teste (lista explícita, mesmo padrão já usado).
- `docs/07_CURRENT_STATE.md`, `docs/08_BACKLOG.md` — atualizados com o
  que foi de fato implementado (ver seções específicas).

### Corrigido durante a sessão (sem chegar a virar bug commitado)

- Uma primeira tentativa de extrair a descoberta SSDP sobrescreveu
  `desktop-agent/src/discovery.ts` (script diagnóstico standalone
  pré-existente, documentado em `docs/01_ARCHITECTURE.md`, não integrado
  ao Agent) sem lê-lo antes. Identificado antes de qualquer commit,
  revertido via `git restore`/`git checkout`. O módulo novo foi criado com
  outro nome (`printerDiscovery.ts`) para não colidir. `git diff` contra
  `origin/main` confirma `src/discovery.ts` idêntico ao original.

### Testes

```
Antes (baseline, origin/main):
  npm test               → 24/24 passando
  npm run test:integration → falha (sem .env -- preexistente)

Depois:
  npm test               → 45/45 passando
  npx tsc --noEmit        → limpo
  npm run test:integration → mesmo resultado da baseline (arquivo não tocado)
```

### Não implementado (ver `docs/11_AGENT_ONBOARDING_V2.md`, seções 9-11)

- Cofre de segredos comercial do Windows (Credential Manager/DPAPI/
  `keytar`) — 3 opções comparadas, decisão pendente do usuário.
- Validação de ponta a ponta do assistente interativo com um usuário real
  numa máquina Windows com impressora física.
- Instalador gráfico, assinatura de código, auto-update.

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

<!-- AUTO:LEVEL_1_2_CHANGELOG_20260920:START -->

## 20/09/2026 — Estabilização dos Níveis 1 e 2

### Confiabilidade de consumo

Finalizada a implementação do Nível 1.

Entregas:

- consumo multicolor;
- finalização atômica;
- idempotência;
- `job_id`;
- `consumption_quality`;
- `orphan_slot`;
- política de quatro níveis de qualidade;
- RPC `finalize_print_job`.

### Redescoberta automática de rede

Implementada redescoberta SSDP da impressora Bambu Lab.

O Desktop Agent agora:

- detecta perda da conexão MQTT;
- procura novamente a impressora;
- identifica mudança de IP;
- atualiza a conexão;
- reconecta automaticamente.

Teste real:

`192.168.15.13 -> 192.168.15.17`

Commits:

- `e55faac` — `feat: add automatic printer network rediscovery`
- `0a52b7c` — `fix: prevent duplicate mqtt rediscovery attempts`

### Reconciliação de banco e migrations

Corrigido o drift entre schema real do Supabase e histórico versionado.

Alterações:

- criada migration de bootstrap `0015`;
- corrigida a dependência anterior à `002`;
- `filament_presets`, `catalog_items` e `print_logs` passaram a fazer parte da reconstrução versionada;
- corrigida criação de `ams_slots.user_id`;
- removida migration inválida de `consumption_quality`;
- migrations de 20/09 passaram a utilizar versões únicas;
- `005` foi transformada em reconciliação complementar idempotente.

O `supabase migration list --linked` foi validado com histórico local e remoto alinhados.

Também foram confirmados no schema remoto:

- `job_id`;
- `consumption_quality`;
- `orphan_slot`;
- `last_seen_at`;
- `nfc_written_at`;
- `finalize_print_job`.

Commit:

- `df64a72` — `fix: reconcile database migration history`

### Status após estabilização

- Nível 1: concluído.
- Nível 2A: concluído.
- Nível 2B: concluído.
- Próxima frente: Nível 3 — maturidade de produto.

<!-- AUTO:LEVEL_1_2_CHANGELOG_20260920:END -->


