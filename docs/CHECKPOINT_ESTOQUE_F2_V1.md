# CHECKPOINT_ESTOQUE_F2_V1

Referência: `IMPACTO_ARQUITETURA_ESTOQUE_FILAMAP_V2.md` (§6 Agent, §8 itens 1, 2, 9, 10, 11, 15). Data: 2026-09-28.

```text
FASE:        F2 - Agent v4 (codigo; NAO instalado)
STATUS:      CONCLUIDA (nivel 3: integracao real contra o banco de TESTE)
ARQUIVOS:    desktop-agent/src/bambuCloudSpoolSync.ts   (+ .test.ts)
             desktop-agent/src/amsProjection.ts         (+ .test.ts)
             desktop-agent/src/filamentProfileSync.ts   (+ .test.ts)
             desktop-agent/src/index.ts
PRODUCAO:    NAO TOCADA
```

## O que mudou

| Antes (Agent v2, em produção) | Agora (Agent v4) |
|---|---|
| Nuvem regravava `filament_profile_id`, cor e nome do spool | Nuvem atualiza **só** `bambu_*` (posição/evidência) |
| Carretel da nuvem desconhecido → **spool criado** | → item em `spool_inbox` (0 spools criados) |
| Casamento por texto → **religava** o spool | → **sugestão** (`suggested_spool_id`) no item da Inbox |
| Preset oficial (GFA18) guardado como `bambu_cloud` | `bambu_official` (regra `^GF[A-Z0-9]{2,6}$`: 100/100 sistema, 0/46 usuário) |
| Spool arquivado entrava no AMS/fechamento | Fora (fallback se a coluna não existir) |
| Preset com produto que sumiu (rename) | Pendência `preset_renamed` na Inbox (adormecida até a F6; nunca derruba o sync) |
| Log "N novo(s)" | Log "N na caixa de entrada" |

Os vínculos secundários antigos (`secondary_bambu_spool_ids`) são só lidos; nenhum vínculo novo é criado.

## Evidências

| Verificação | Resultado |
|---|---|
| Typecheck | OK |
| Agent (herméticos) | 229/229 (9 novos: Inbox, R8 sem sobrescrita, oficial, Inbox ausente, item resolvido não reaberto, arquivado, sem coluna, rename, rename sem tabela) |
| Web | 121/121 |
| R-CONTRATO | 20 consultas + 1 rpc, 0 falhas (inclui as 3 consultas novas) |
| **Sync real** (bridge → nuvem Bambu → banco de TESTE, dist novo) | 15 registros (1 ignorado); 13 posições atualizadas; **0 spools criados (29→29)**; identidade (perfil/marca/material/cor/vínculo) **IGUAL**; físico (peso/tara/preço/tag) **IGUAL**; Inbox 0→0 (todos já ligados); `GFA18` → `bambu_official` |
| Checksum do teste antes × depois | igual, exceto `perfis_total` 58→59 (= o perfil oficial GFA18, esperado) |

**Correção durante a fase (TIPO D, erro de execução):**
- Duas consultas foram escritas com template/variável e escapariam do R-CONTRATO. O verificador acusou uma delas, e as duas foram reescritas por extenso.
- Um teste passava `presentKeys` já entre parênteses; o erro era do teste, não do código.

## Próxima fase

**F3:** gerar o instalador **v4** a partir de `staging/fase-i` (build-installer.ps1 + bridge .exe com hash conferido), sem instalar.
