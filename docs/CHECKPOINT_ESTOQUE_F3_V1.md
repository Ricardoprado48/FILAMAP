# CHECKPOINT_ESTOQUE_F3_V1

Referencia: `IMPACTO_ARQUITETURA_ESTOQUE_FILAMAP_V2.md` (F3). Data: 2026-09-28.

```text
FASE:        F3 - Instalador do Agent v4 (gerado; NAO instalado)
STATUS:      CONCLUIDA
ORIGEM:      staging/fase-i @ 8face49 (+ versao 4.0.0 no .iss)
INSTALADOR:  C:\FILAMAP-staging\releases\FilamapAgentSetup-v4-BFCA84FE.exe
PRODUCAO:    NAO TOCADA
```

| Item | Valor |
|---|---|
| Testes do Agent | 229/229 |
| Instalador SHA256 | BFCA84FE218C0E44238595BE0430EEE7D5B270BD6A1C79300F673FAAFBC35059 (18.209.510 bytes) |
| filamap-agent.exe SHA256 | A41E257A7B31B2C8EF3A8B2772FA703DB747B6BE6C3520296865C7009796CA35 |
| Bridge SHA256 | 116B144218D7726F45E72F55B22DF81BFCE72A6F99E30149A713097862DEE9B3 (igual ao instalado hoje) |
| Codigo da F2 dentro do .exe | spool_inbox, "na caixa de entrada", bambu_official, preset_renamed, isMissingArchivedColumn: presentes |
| URL Supabase embutida | somente producao (gqtlszffgvxsqcmefhyd); demais ocorrencias sao exemplos da biblioteca |

Instalar somente na F5, depois da F4 (schema na producao), com a impressora parada.
O instalador antigo "v3" (C:\FILAMAP-device-pairing\releases) NAO deve ser usado.
