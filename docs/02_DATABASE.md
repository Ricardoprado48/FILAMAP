# 02 — Banco de Dados e Supabase

## Fonte auditada

Migrations presentes:

- `001_initial_schema.sql`
- `002_rls_hardening.sql`
- `003_close_permissive_policies.sql`
- `004_fix_ams_slots_user_id.sql`

O repositório também contém metadados de um projeto Supabase linkado, mas esta auditoria foi feita sobre os arquivos locais; não foi executada introspecção do schema remoto.

## Tabelas criadas explicitamente pela migration 001

### `spools`

Campos-base:

- `id`
- `user_id`
- `nfc_uid`
- `brand`
- `material`
- `color_name`
- `color_hex`
- `spool_tare_weight`
- `initial_weight`
- `current_weight`
- `created_at`
- `updated_at`

O frontend também usa `price_paid`, mas esse campo **não é criado nas migrations disponíveis**.

### `printers`

Campos-base:

- `id`
- `user_id`
- `serial`
- `name`
- `model`
- `ip_address`
- `is_online`
- `updated_at`

O Agent/Web App usam diversas colunas adicionais não presentes nas migrations auditadas:

- `current_task`
- `print_progress`
- `remaining_time_min`
- `current_layer`
- `total_layers`
- `nozzle_temp`
- `bed_temp`
- `gcode_state`
- `active_slot_index`
- `filament_slice_info`

### `ams_slots`

Campos da 001:

- `id`
- `printer_id`
- `slot_index`
- `spool_id`
- `updated_at`

A migration 004 adiciona/repara `user_id`.

### `print_jobs`

Tabela legada criada na 001:

- `id`
- `printer_id`
- `spool_id`
- `subtask_name`
- `grams_consumed`
- `status`
- `created_at`

O código atual não a utiliza no fluxo principal.

## Tabelas usadas pelo código, mas não criadas nas migrations disponíveis

### `print_logs`

O frontend/Agent esperam pelo menos:

- `id`
- `user_id`
- `printer_id`
- `spool_id`
- `slot_index`
- `subtask_name`
- `filament_used_g`
- `print_duration_minutes`
- `status`
- `needs_weighing`
- `completed_at`

A migration 002 assume que a tabela já existe e apenas adiciona `user_id` se necessário.

### `catalog_items`

O frontend espera:

- `id`
- `user_id`
- `name`
- `material`
- `weight_g`
- `print_hours`
- `accessories_cost`
- `production_cost`
- `sale_price`
- `created_at`

Também aqui a migration 002 assume que a tabela já existe.

### `filament_presets`

As migrations de RLS referenciam a tabela, mas a criação dela não aparece nas migrations auditadas.

## RLS e segurança

A migration 002:

- ativa RLS nas tabelas conhecidas;
- estabelece policies `owner_all` com `auth.uid() = user_id`;
- torna `filament_presets` somente leitura para autenticados;
- endurece `deduct_spool_filament()` para verificar proprietário.

A migration 003 remove policies antigas permissivas que anulavam a segurança por OR.

A migration 004 repara a ausência de `ams_slots.user_id` no histórico de migrations.

## RPC `deduct_spool_filament`

Existe uma RPC segura em migrations após a 002, porém o Agent atual **não a usa na finalização**. Ele lê `current_weight`, calcula o próximo peso e faz `UPDATE` direto.

Isso cria duas fragilidades:

1. operação não atômica entre baixa e log;
2. risco de dupla baixa se o evento de finalização for processado mais de uma vez.

## P0 — Reprodutibilidade do schema

Antes de considerar o banco pronto para outro ambiente, criar migration de reconciliação que reproduza o schema realmente usado pelo código, incluindo:

- criação de `print_logs`;
- criação de `catalog_items`;
- criação/definição de `filament_presets` se continuar necessária;
- `spools.price_paid`;
- colunas de telemetria em `printers`;
- índices/constraints necessários;
- RLS/policies correspondentes.

A migration deve ser gerada com base em introspecção do banco remoto ou em uma especificação confirmada, e não por adivinhação.

## Evolução recomendada já prevista na visão do produto

Ainda não implementada no schema local:

- `workspaces` / multi-tenancy formal;
- `spool_movements` como ledger;
- relação de múltiplos filamentos por job;
- `finalized_at`/chave de idempotência;
- qualidade/origem do consumo (`exact`, `estimated`, etc.).
