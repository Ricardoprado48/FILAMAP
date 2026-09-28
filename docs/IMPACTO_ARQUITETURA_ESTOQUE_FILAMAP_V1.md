# IMPACTO_ARQUITETURA_ESTOQUE_FILAMAP_V1

Confronto do modelo **PRESET EXTERNO → FILAMENT_PRODUCT → SPOOL → POSIÇÃO → MOVIMENTAÇÃO/HISTÓRICO**
(parecer técnico de 2026-09-28) com o schema, o código e os dados reais.

- **Método:** somente leitura. Schema e constraints lidos do banco de teste (FILAMAP-TESTE, idêntico à produção + migrations da Fase I). Dados e histórico lidos da produção (`gqtlszffgvxsqcmefhyd`) em modo leitura. Código lido na branch `staging/fase-i` (1100d8c).
- **Nada foi alterado nesta etapa.**
- **Estado dos testes hoje:** Agent 220/220, Web 121/121.

---

## Parte A — Estado atual

### 1. Tabelas existentes (schema `public`)

| Tabela | Papel hoje | Linhas (prod) |
|---|---|---|
| `spools` | Carretel físico, mas **também guarda a identidade do produto** (marca, material, cor) e o espelho da nuvem Bambu (`bambu_*`) | 33 (29 reais + 4 sem dono, apagados no teste; na prod aguardam o script) |
| `user_filament_profiles` | Presets externos. `source = 'bambu_studio'` (presets do Studio) ou `'bambu_cloud'` (criados pelo Cloud Spool Sync) | 46 studio + 12 cloud |
| `ams_slots` | Posição: slot do AMS → spool | 4 |
| `print_logs` | Histórico de consumo por spool | 18 |
| `printers` | Impressora | 1 |
| `catalog_items` | Produtos vendidos (calculadora), sem relação com spool | 17 |
| `filament_presets` | **Legado**: presets semeados por `seed_presets.ts`, sem `user_id`, sem uso no fluxo atual | 32 |
| `print_jobs` | **Legado**: vazia | 0 |

### 2. Colunas que duplicam a identidade do produto

| Coluna | `spools` | `user_filament_profiles` | Observação |
|---|---|---|---|
| marca | `brand` **NOT NULL** | `brand` | O spool é obrigado a ter marca própria, e isso gera invenção de valor |
| material | `material` **NOT NULL** | `material` NOT NULL | |
| cor (nome) | `color_name` | `color_name` (vazio em todos os presets do Studio) | |
| cor (hex) | `color_hex` | só em `source_metadata.default_filament_colour` | |
| nome | — (a Web exibia `color_name`) | `display_name` / `source_profile_name` | |

**Valores inventados por DEFAULT em `spools`:** `initial_weight = 1000`, `spool_tare_weight = 200`, `price_paid = 85.00`, `user_id = auth.uid()`. Em `filament_presets`: `brand = 'Bambu Studio'`, `color_hex = '#111827'`, `density = 1.25`.

### 3. FKs e unicidades existentes

- `spools.user_id` → `auth.users` ON DELETE CASCADE. **A coluna aceita NULL**; foi assim que nasceram os 4 fantasmas.
- `spools (filament_profile_id, user_id)` → `user_filament_profiles (id, user_id)` ON DELETE SET NULL (filament_profile_id).
- `ams_slots.spool_id` → `spools` ON DELETE SET NULL. Único por `(printer_id, slot_index)`.
- `print_logs.spool_id` → `spools` **ON DELETE SET NULL**: apagar um spool apaga a identidade do seu histórico.
- `print_jobs.spool_id` → `spools` ON DELETE SET NULL.
- `spools.nfc_uid` UNIQUE **global**, não por usuário. Com vários clientes, um texto de tag igual em duas contas colide.
- `spools (user_id, bambu_spool_id)` UNIQUE parcial.
- `user_filament_profiles (user_id, source, source_key)` UNIQUE.

### 4. Estrutura de `user_filament_profiles`

`id, user_id!, source!, source_key!` (filament_id do Bambu, ex. `P86318ba`), `source_profile_name!, display_name!, material!, color_name, model_name, brand, source_metadata (jsonb: filament_vendor, default_filament_colour, filament_density, slicer_dir…), is_listed (Fase I), first_seen_at, last_seen_at`.

- A marca e o modelo são derivados do nome por heurística. Resultado real: `brand = 'ROSA'` (Anycubic PETG ROSA), `'BRANCO'` (Creality PLA BRANCO), `'BUENAS'`, `'EASY'`/`'EASYPRINT'` para a mesma marca.
- **Não é confiável como identidade de produto.**

### 5. Existe algo equivalente a FILAMENT_PRODUCT?

**Não.** Hoje o "produto" está espalhado em três lugares que podem divergir:
- a linha de preset em `user_filament_profiles`;
- as colunas de identidade em `spools`;
- o `filament_presets` legado.

Um rename no Studio gera `source_key` novo, portanto uma linha nova. Não há nada que diga "é o mesmo produto".

### 6. Como `spools` aponta para o perfil

`spools.filament_profile_id` (UUID) → `user_filament_profiles.id`. Na **produção** hoje:
- 17 spools sem perfil;
- 12 spools ligados a perfis `bambu_cloud` genéricos, por exemplo "PLA" (Rosa Choque e Preto Velvet) e "PLA VELVET VOOLT3D" (compartilhado por Off White e Vermelho Velvet, que são produtos diferentes).

No **teste**, os 28 spools reais foram religados ao preset correto do Studio. O usuário conferiu e aprovou.

### 7. Como `ams_slots` aponta para o spool

Só por `spool_id` (+ `assigned_by` `'user'|'agent'` e `assigned_at`, Fase I). Não depende de marca, material nem cor. **Não é afetado pelo novo modelo.**

### 8. Como `print_logs` guarda identidade

**Só por `spool_id`.** Não há snapshot. Colunas: `printer_id, spool_id, slot_index, subtask_name, filament_used_g, print_duration_minutes, completed_at, status, estimated_total_weight_g, user_id, needs_weighing, job_id, consumption_quality, orphan_slot`.

Na produção: 18 logs.
- **12 com `spool_id = NULL`**, todos com `orphan_slot = true`. O Agent não soube qual spool estava no slot; não foram perdidos por exclusão. 11 deles têm 0 g; 1 tem 2,8 g ("exact", slot 1).
- 6 ligados a 4 spools: Rosa Choque 174,6 g; Preto Velvet 5,7 g; Vermelho Ultra Silk 2,6 g; Branco PETG 0,7 g.

### 9. Funções/RPCs que usam marca, material ou cor

Nenhuma. `deduct_spool_filament(p_spool_id, p_grams_consumed)` e `finalize_print_job(...)` trabalham só com `spool_id` e gramas. Não há triggers de negócio. **O consumo não é afetado.**

### 10. Código (não testes) que lê ou escreve campos de identidade

| Arquivo | Ocorrências | Natureza |
|---|---|---|
| `web-app/src/App.tsx` | 24 | exibição, formulários, **criação por NFC desconhecida com valores fixos** (l. 454: marca Voolt3D, PETG, Preto) |
| `web-app/src/utils/inventory.ts` | 9 | nome de exibição, filtros, agrupamento por material |
| `web-app/src/services/spoolService.ts` | 4 | `createSpool` grava marca, material e cor copiados do perfil |
| `web-app/src/utils/slotPicker.ts`, `spoolStatus.ts`, `history.ts` | 10 | exibição / pré-preenchimento |
| `desktop-agent/src/bambuCloudSpoolSync.ts` | 15 | **cria spools** (Caso D) e **casa spool por texto** (Caso C) |
| `desktop-agent/src/amsProjection.ts` | 9 | reconciliação do AMS (lê cor e material do spool; escreve só `bambu_*` e `ams_slots`) |
| `desktop-agent/src/ftpsParser.ts`, `consumption.ts`, `index.ts`, `filamentProfileSync.ts` | 9 | leitura/log |

**Pontos que violam as regras fixas hoje:**
- **R9 (nuvem não cria spool):** `bambuCloudSpoolSync.ts:769-776`, Caso D, insere spool novo para todo carretel da nuvem que não casou. Foi a origem do "Vermelho Ultra Silk Voolt3D".
- **R10 (texto não decide):** `bambuCloudSpoolSync.ts:734-765`, Caso C (`isStrongCandidateMatch`), vincula automaticamente por material + cor + marca textuais.
- **R10 (fusão):** `secondary_bambu_spool_ids` (commit 1edbad6) funde registros da nuvem em um spool. Existe em 2 spools da produção (Rosa Choque, Off White).
- **R12 (desconhecido fica desconhecido):** `App.tsx:454` (NFC desconhecida vira "PETG Preto Voolt3D"); `resolveSpoolBrand` devolve "Genérico"; defaults 1000 / 200 / 85 no banco; `createBrand` começa como "Voolt3D".
- **R4/R7 — BLOQUEADOR:** `buildSpoolUpdateRow` (`bambuCloudSpoolSync.ts:600`) grava `filament_profile_id` do perfil **bambu_cloud** a cada sincronização em todos os spools ligados à nuvem. Qualquer reorganização de vínculos na produção é **desfeita pelo Agent v2 na próxima passada**, em 12 dos 28 spools.

### 11. Testes que dependem da estrutura atual

- **Agent:** `bambuCloudSpoolSync.test.ts` (Casos A–D, marca, nome de cor, secundários), `amsProjection.test.ts` (fixtures com marca/material/cor), `consumption.test.ts`, `filamentProfileSync.test.ts`, integrações `finalize`/`resolution` (banco real).
- **Web:** `inventory.test.ts`, `spoolStatus.test.ts` (`parseProfileToSpoolForm`), `spoolService.test.ts` (`createSpool`), `slotPicker.test.ts`, `history.test.ts`, `dataService.test.ts`.

Todos usam o spool com marca, material e cor próprios. Vão precisar de fixtures com produto.

---

## Parte B — Dados

### 12. Dados que precisam ser migrados

- 29 spools reais → cada um ligado a 1 FILAMENT_PRODUCT.
- Presets `bambu_studio` (46 na prod; 29 ativos após a Fase I) → viram referências externas de um produto.
- 12 perfis `bambu_cloud` → deixam de ser identidade. Ficam só como evidência / caixa de entrada.
- 6 `print_logs` com spool → snapshot preenchido a partir do estado atual, marcado como retroativo. Os 12 órfãos ficam sem snapshot.
- `filament_presets` (32) e `print_jobs` (0): legados, fora do novo modelo. Proposta: congelar agora e remover numa fase posterior.

### 13. Spools com dados divergentes do perfil hoje (prod)

- **Vermelho Ultra Silk:** o spool diz `Voolt3D`; o produto real é `VIDAS BUENAS`. O perfil ligado é o antigo "PLA VERMELHO_ULTRA_SILK" (bambu_cloud); o preset correto do Studio é `P86318ba`.
- **Rosa Choque e Preto Velvet:** ligados ao perfil genérico "PLA".
- **Off White Velvet e Vermelho Velvet:** ligados ao **mesmo** perfil "PLA VELVET VOOLT3D".
- **Branco Velvet:** "PLA VELVET". **PLA Lite Amarelo:** "PLA Lite" (bambu_cloud, RFID).
- **17 spools sem perfil nenhum.**

### 14. Casos que exigem reconciliação manual

| Caso | Qtde | Situação |
|---|---|---|
| Spool → produto | 28 | **Mapeamento pronto e aprovado pelo usuário** (aplicado e validado no teste; script `organizar-carreteis.sql`, por `source_key`) |
| PLA Lite Amarelo (Bambu RFID, sem preset no Studio) | 1 | Decidir: produto criado a partir do preset oficial Bambu usado |
| Presets com o mesmo nome na prod (Amarelo Limão Fusionx, Branco MasterPrint, Preto MasterPrint: 2 `source_key` cada, pastas Studio/Beta) | 3 | Confirmar: 2 presets → 1 produto (R14) |
| Preset `P86318ba` (Vermelho Ultra Silk Vidas Buenas) | 1 | **Não existe na prod**: o Agent v2 não lê a pasta Beta. Só aparece após o Agent v3 |

### 15. Branco Ultra Silk Vida Buenas

O preset `P6337f36` existe na prod. Vira um FILAMENT_PRODUCT **sem spools**. O carretel físico só nasce quando o usuário usar "Novo Carretel" (R15). Não é fundido com o PETG Branco MasterPrint e não herda o saldo de nenhum outro spool (regra do usuário).

### 16. Destino de cada spool

| Spool | Peso | Tag | Slot | Produto (preset Studio) | Observação |
|---|---|---|---|---|---|
| Preto Velvet | 739 g | ✔ | 1 | + PLA PRETO VELVET VOOLT (`Pef7a165`) | sai do perfil genérico "PLA" |
| Rosa Choque | 495 g | ✔ | 2 (nuvem) | + PLA ROSA CHOQUE VOOLT (`Pc11e481`) | tem `secondary_bambu_spool_ids` (fusão 1edbad6) |
| Vermelho Ultra Silk | 888 g | ✔ | 3 | + PLA VERMELHO ULTRA SILK VIDAS BUENAS (`P86318ba`) | a marca deixa de ser Voolt3D; depende do Agent v3 na prod |
| Branco PETG MasterPrint | 353 g | ✔ | 4 | - PETG BRANCO MASTERPRINT (`P915cab1`) | preset duplicado Studio/Beta na prod |
| PLA Lite Amarelo | 950 g | — | — | produto do preset oficial Bambu (a decidir) | único com RFID Bambu |
| Demais 24 | inalterados | inalterados | — | 1 preset Studio cada (mapa aprovado) | 17 hoje sem perfil |

**Em nenhum spool mudam peso, tara, preço, tag, slot ou histórico.**

---

## Parte C — Migração proposta

### 17. Migrations (todas aditivas até M5)

| # | Migration | Conteúdo |
|---|---|---|
| M1 | `filament_products` | `id uuid pk, user_id not null, name, brand, material, color_name, color_hex, density, origin ('bambu_studio'\|'bambu_official'\|'manual'), archived_at, created_at, updated_at`; UNIQUE `(user_id, lower(name))` |
| M1 | refs externas | `user_filament_profiles.filament_product_id` (N presets → 1 produto, nullable); `spools.filament_product_id` (nullable, FK composta com `user_id`) |
| M2 | backfill (dados) | 1 produto por preset Studio **ativo**, agrupando os pares de mesmo nome **só após confirmação** (itens 14 e 23); spools ligados pelo mapa aprovado; PLA Lite conforme decisão |
| M3 | snapshot | `print_logs`: `filament_product_id, product_name_snapshot, brand_snapshot, material_snapshot, color_snapshot, snapshot_backfilled bool`. `finalize_print_job` passa a gravar o snapshot |
| M4 | caixa de entrada | `spool_inbox`: `id, user_id, source ('bambu_cloud'\|'rfid'\|'nfc'), external_id, payload jsonb, suggested_spool_id, suggested_product_id, status ('pending'\|'linked'\|'created'\|'ignored'), resolved_spool_id, created_at, resolved_at` |
| M5 | travas **(só depois do soak)** | `spools.user_id NOT NULL`; `filament_product_id NOT NULL`; remover defaults 1000/200/85 (colunas nullable = "não informado"); `nfc_uid` UNIQUE por `(user_id, nfc_uid)`; `print_logs.spool_id` ON DELETE RESTRICT + arquivamento (`archived_at`) em vez de DELETE; colunas `brand/material/color_*` do spool → `legacy_*` somente leitura |

Movimentações (`spool_movements`: INITIAL_WEIGHT, PRINT_CONSUMPTION, WEIGHING, MANUAL_ADJUSTMENT, CORRECTION) são **compatíveis** com o modelo, mas proponho uma fase própria (V2), para não misturar mudança de identidade com mudança de saldo.

### 18. Rollback

- **M1–M4:** só criam tabelas e colunas novas. Rollback = `DROP` do que foi criado. As colunas antigas do spool continuam intactas e preenchidas, e o código antigo continua funcionando.
- **M2** grava antes uma tabela `spools_identity_backup` (id, filament_profile_id, brand, material, color_name, color_hex). O rollback restaura os vínculos por `UPDATE … FROM backup`.
- **M5** é o único passo não trivial. Só entra depois que todo o código ler do produto, com backup completo das colunas renomeadas e com rollback escrito e testado no banco de teste antes.

### 19–24. Riscos

| # | Risco | Avaliação |
|---|---|---|
| 19 | Perder histórico | **Não** pela migração: `print_logs` mantém `spool_id`; snapshot é aditivo. **Risco atual independente:** apagar um spool zera `spool_id` no histórico (ON DELETE SET NULL); corrigido em M5 (arquivar, não apagar) |
| 20 | Alterar pesos | **Não**: nenhuma migration toca `current_weight`, `initial_weight`, `spool_tare_weight`, `price_paid`. Provado por checksum antes/depois (item 26) |
| 21 | Alterar vínculos AMS | **Não**: `ams_slots` só referencia `spool_id`, que não muda |
| 22 | Alterar consumo registrado | **Não**: as RPCs usam só `spool_id` e gramas; `print_logs` não é reescrito, só ganha snapshot |
| 23 | Duplicar produtos | **Sim, se automatizado**: prod tem 46 presets Studio (3 nomes em dobro, pastas Studio/Beta) + 12 cloud. Mitigação: produtos só de presets **ativos**, agrupamento dos pares **confirmado pelo usuário**, UNIQUE `(user_id, lower(name))` |
| 24 | Spools órfãos | 1 caso (PLA Lite) sem preset Studio, resolvido por decisão explícita. `NOT NULL` só em M5, depois de 0 órfãos |
| — | **Agent reverter os vínculos** | **Sim, hoje**: `buildSpoolUpdateRow` reescreve `filament_profile_id`. **O Agent v3 precisa parar de gravar vínculo de produto ANTES de M2 rodar na produção** |

### 25. Ordem correta

1. **Agent v3:** o Cloud Sync para de criar spool (Caso D → `spool_inbox`), para de casar por texto (Caso C → sugestão na inbox) e para de gravar `filament_profile_id`/produto. Continua atualizando só `bambu_*` (posição/evidência). Lê a pasta Beta (Fase I).
2. **M1 + M3 + M4** (aditivas) na produção.
3. **Instalar o Agent v3** (sem impressão ativa) e esperar uma sincronização completa de presets (`P86318ba` aparecer na prod).
4. **Backup + M2** (backfill com o mapa aprovado + decisões do item 14).
5. **Web:** identidade exibida e editada via produto; "Novo Carretel" exige produto; tela da caixa de entrada; NFC desconhecida → inbox (fim do `App.tsx:454`); sem defaults inventados.
6. Soak de alguns dias de uso real.
7. **M5** (travas), com backup e rollback testado.

### 26. Testes que provam a migração antes do deploy

- **No banco de teste**, com cópia nova da prod (só linhas com dono, **incluindo `print_logs`**), rodar M1–M4 e comparar antes/depois:
  - `sum(current_weight)`, `sum(initial_weight)`, `sum(spool_tare_weight)`, `sum(price_paid)` idênticos;
  - `count(spools)`, `count(print_logs)`, conteúdo de `ams_slots` e `sum(filament_used_g)` idênticos;
  - 29/29 spools com `filament_product_id`, 0 produtos com nome duplicado por usuário.
- **Rollback de M2** executado e verificado (vínculos iguais ao backup).
- **Agent** (unitários novos):
  - carretel da nuvem desconhecido → linha em `spool_inbox`, **0 inserts em `spools`**;
  - Caso C vira sugestão;
  - update não contém `filament_profile_id`/`filament_product_id`;
  - rename de preset (source_key novo com mesmo nome) → pendência de reconciliação, spool intacto.
- **Web:** produto obrigatório no "Novo Carretel"; NFC desconhecida não cria spool; exibição a partir do produto; snapshot mostrado no histórico.
- **Integração** (`finalize`/`resolution`): consumo com snapshot gravado; RPC continua descontando só pelo `spool_id`.

---

## Parte D — Gates

| Gate | Situação | Motivo |
|---|---|---|
| **Evidência** | **APROVADO** | Todas as respostas vêm de leitura direta de schema, dados e código (acima) |
| **Prevenção** | **PENDENTE** | Bloqueador identificado: o Agent v2 reescreve o vínculo de perfil (item 10 / 19–24). A ordem do item 25 resolve; precisa ser aceita |
| **Crítica** | **PENDENTE** | Decisões do usuário abaixo |
| **Pacote de construção** | **ABERTO** | Fecha após a Crítica |

### Decisões pendentes do usuário

1. **Pares de presets com o mesmo nome** (Amarelo Limão Fusionx, Branco MasterPrint, Preto MasterPrint): 2 presets → 1 produto? *(recomendado: sim)*
2. **PLA Lite Amarelo:** criar produto a partir do preset oficial Bambu usado *(recomendado)*, ou produto manual?
3. **Movimentações (ledger):** fase própria V2 *(recomendado)*, ou já nesta?
4. **Excluir carretel:** passar a **arquivar** em vez de apagar, preservando histórico *(recomendado)*.
5. **`filament_presets` e `print_jobs` legados:** congelar agora, remover depois *(recomendado)*.
6. **Nome do produto quando o preset for renomeado no Studio:** o produto acompanha o nome novo após a confirmação da reconciliação *(recomendado)*, ou mantém o nome antigo?
