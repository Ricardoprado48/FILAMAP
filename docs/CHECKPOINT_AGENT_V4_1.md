# CHECKPOINT_AGENT_V4_1

Data: 2026-09-28. Origem: pedido do usuario ("vamos fazer o v4.1").

```text
INSTALADOR:  C:\FILAMAP-staging\releases\FilamapAgentSetup-v4.1-2B35BE25.exe (4.1.0; NAO instalado ainda)
AGENT SHA:   CE5C42A6F359B47AB572A9268DFF395DDB19410BB781D30CD569AFB02999D7E5
BRIDGE SHA:  116B1442... (inalterado)
SCHEMA:      nenhuma migration nova (usa colunas da F1/F4 e o metadata jsonb)
```

## Mudancas

1. **A escolha mais recente vale.** O sync da nuvem guarda em `bambu_source_metadata` a posicao que a
   PROPRIA nuvem informa (`cloud_position = "serial|slot"`) e quando ela mudou (`cloud_position_changed_at`;
   1a observacao = null = antiga). A projecao do AMS usa essa visao (e nao `bambu_slot_id`, que ela mesma
   reescreve). Escolha no Filamap (`ams_slots.assigned_at`) perde para uma troca feita em Dispositivos na
   Bambu DEPOIS dela; ganha de uma anterior.
2. **Perfil do slot.** `tray_info_idx` do AMS -> perfil -> produto (F6). Um unico carretel ativo desse
   produto = identificado. Dois ou mais iguais = nao chuta (mantem o que ja estava, se for do produto).
   Carretel anterior ou da nuvem que contradiz o perfil do slot e descartado.
3. **Registros principal + secundario** do mesmo carretel na nuvem viram uma unica posicao; se o principal
   foi apagado na Bambu, o secundario informa a posicao (caso real do Rosa Choque).

Ordem: RFID > escolha no Filamap (salvo troca posterior na Bambu) > nuvem > perfil do slot > slot anterior > material+cor.

## Evidencias

| Verificacao | Resultado |
|---|---|
| Agent hermeticos | 242/242 (13 novos) |
| R-CONTRATO | 37 consultas + 1 rpc, 0 falhas |
| Integracao REAL (nuvem Bambu real -> banco de TESTE, dist novo) | 8/8: cloud_position gravado, changed_at null sem troca, 4 slots identificados (1 pela nuvem via secundario, 3 pelo perfil do slot), escolha no Filamap mais recente mantida, troca posterior na Bambu vence, identidade/fisico iguais |

Correcao durante a fase (TIPO D): o teste de integracao supunha 4 carreteis "na impressora" segundo a
nuvem; a nuvem real informava 2 (leitura direta do bridge). Expectativa corrigida; codigo inalterado.
