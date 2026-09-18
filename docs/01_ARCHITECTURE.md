# 01 — Arquitetura do Filamap

## Visão geral

```text
Bambu Lab A1 / AMS Lite
        │
        ├── MQTT TLS :8883 ──────────────┐
        │                                │
        └── FTPS :990 ───────────────┐   │
                                     ▼   ▼
                            Desktop Agent (Node/TS)
                                     │
                                     │ Supabase JS / HTTPS
                                     ▼
                           Supabase Auth + Postgres
                                     ▲
                                     │ Supabase JS / HTTPS
                                     │
                              Web App React/Vite
                                     │
                                     └── Web NFC (Android/Chrome)
```

## Componente A — Web App

Arquivo central atual: `web-app/src/App.tsx`.

O frontend é monolítico: autenticação, consultas, regras de UI, orçamento, inventário e operações NFC estão concentrados em um único componente React.

### Fluxo de dados

O app consulta diretamente o Supabase usando a anon key e a sessão autenticada. O isolamento depende de RLS.

`loadData()` faz polling a cada 3 segundos e consulta:

- `printers`;
- `ams_slots` + relação com `spools`;
- `spools`;
- `catalog_items`;
- `print_logs`.

Não existe uma camada de API própria nem state manager externo no código auditado.

### NFC

`web-app/src/hooks/useNfc.ts` implementa:

- leitura NFC via `NDEFReader.scan()`;
- escrita de URL via `NDEFReader.write()`.

No estado auditado, a função de leitura existe no hook, mas não há chamada a `startScanning()` na interface. A URL gravada usa `https://filamap.pages.dev/?tag=...`, porém `App.tsx` não lê o parâmetro `tag`. Portanto, o fluxo completo “encostar tag → identificar carretel → associar ao slot” não está fechado no frontend atual.

## Componente B — Desktop Agent

Arquivo central: `desktop-agent/src/index.ts`.

### Inicialização

1. carrega `.env`;
2. autentica no Supabase com e-mail/senha próprios;
3. usa `PRINTER_IP` quando configurado ou tenta descoberta UDP;
4. localiza/cria registro da impressora no banco;
5. inicia heartbeat;
6. conecta ao MQTT da impressora;
7. solicita `pushall` periodicamente.

### Estado do job

`ActiveJobState` mantém:

- nome do trabalho;
- progresso máximo/último;
- slot considerado ativo;
- início;
- tempo estimado;
- gramatura detectada pelo nome;
- dados de `slice_info.config`.

O estado é persistido em `agent-state.json` no diretório de execução. Isso reduz perda de contexto do job após reinício do processo, embora não constitua ainda uma fila offline completa.

### Telemetria

O Agent atualiza o registro de `printers` com campos como:

- `gcode_state`;
- `active_slot_index`;
- `current_task`;
- `print_progress`;
- `remaining_time_min`;
- `current_layer`;
- `total_layers`;
- `nozzle_temp`;
- `bed_temp`;
- `filament_slice_info`.

Nem todos esses campos aparecem nas migrations disponíveis.

### Finalização e consumo

Ao detectar `FINISH`, `FAILED`, `PAUSE_STOP` ou `STOP`, o Agent chama `finalizeJob()`.

Ordem atual para calcular gramatura:

1. `slice_info.config`, se houver entrada para o slot;
2. gramatura extraída do nome do arquivo/job, se existir padrão como `_45g`;
3. estimativa por duração (`~0,22 g/min`);
4. fallback inicial de 35 g quando não há informação melhor.

Depois aplica o percentual executado e um eventual `weightDiscount` do parser.

**Importante:** a baixa é feita por `UPDATE` direto em `spools.current_weight` e depois é criado `print_logs`. Não é uma transação única e não possui chave de idempotência no código auditado.

### Limitação multicolor atual

O job armazena `activeSlot` quando `currentJob` é criado. O valor não é atualizado dentro do job à medida que o AMS troca de material. `finalizeJob()` consulta e desconta um único slot. Embora o parser consiga retornar vários filamentos, a baixa atual não percorre todos os filamentos do job.

Consequência: o fluxo de consumo multicolor/AMS ainda precisa ser redesenhado/validado antes de ser considerado confiável.

## Componente C — Parser FTPS/3MF

Arquivo: `desktop-agent/src/ftpsParser.ts`.

Fluxo implementado:

1. conecta via FTPS usando `bblp` + Access Code;
2. baixa arquivo remoto para `./temp_job.3mf`;
3. abre o `.3mf` como ZIP;
4. procura entrada que contenha `Metadata/slice_info.config`;
5. faz parse XML;
6. tenta extrair por filamento:
   - tray/id;
   - `model_g`;
   - `support_g`;
   - `flush_g`;
   - `total_g`;
   - cor;
   - `weight_discount`.

A implementação é resiliente a alguns nomes alternativos de campo, mas a estrutura real do arquivo e o mapeamento com AMS ainda precisam de validação em arquivos reais representativos.

## Descoberta da impressora

Há dois mecanismos diferentes no repositório:

- `desktop-agent/src/index.ts`: broadcast UDP customizado `BBLP` na porta 2021 quando `PRINTER_IP` está vazio;
- `desktop-agent/src/discovery.ts`: script diagnóstico SSDP multicast em `239.255.255.250:1900`.

O script SSDP não está integrado ao fluxo principal. Não existe no código auditado varredura de sub-rede + fallback manual dentro do app conforme a arquitetura-alvo descreve.

## Arquitetura-alvo já documentada, ainda não implementada por completo

O documento de jornada prevê evoluções como:

- workspaces/multi-tenancy formal;
- ledger imutável de movimentos de spool;
- consumo por múltiplos filamentos;
- idempotência de finalização;
- onboarding automático do Agent;
- offline buffer robusto;
- descoberta em camadas;
- alertas e previsão de saldo.

Essas ideias não devem ser confundidas com o estado atual do código.
