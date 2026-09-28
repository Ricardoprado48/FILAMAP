# CHECKPOINT_ESTOQUE_F0_F1_V1

Referência: `IMPACTO_ARQUITETURA_ESTOQUE_FILAMAP_V2.md`, §10. Data: 2026-09-28.

## F0 — Canteiro

```text
FASE:        F0
STATUS:      CONCLUÍDA (nível 3: integração real)
ALTERAÇÕES:  nenhuma no repositório; scripts no scratchpad da sessão; banco de TESTE = cópia fiel da produção
RESULTADO:   pré-flight 100% DISPONÍVEL
```

| Capacidade | Evidência |
|---|---|
| Migrations da branch na produção | `supabase migration list --linked --workdir C:\FILAMAP-staging` → 5 pendentes (20260927200000 fora de ordem → `--include-all`) |
| Backup da produção | `db dump` exige Docker (INDISPONÍVEL) → exportação JSON por tabela + contagem + SHA256, testada com cp850 |
| Checksums | 15 valores; baseline `prod-f0-baseline` |
| R-CONTRATO | staging 0 falhas; controles negativos: coluna inexistente (42703) e branch de pareamento (tabela + 3 RPCs) acusados |
| Isolamento | 2º usuário no teste |
| Agent isolado | bridge (15 registros) + auth no teste, 0 escritas, sem MQTT/segredos da produção |
| Instalador | Inno Setup 6/7 + pkg; bridge .exe a copiar na F3 |
| Cópia fiel | 6/6 IGUAL, hash da linha inteira (sem user_id nem campos vivos do Agent) |

**Incidentes do canteiro (TIPO B, previsíveis), todos com causa comprovada:**

1. A CLI Supabase muda o formato de saída quando detecta agente de IA (`AI_AGENT`, `CLAUDECODE`): `{rows}` × `[...]` × tabela.
2. O console do usuário usa **cp850** e o do agente **65001**. A saída UTF-8 da CLI era decodificada errado (acentos).
3. O `ConvertFrom-Json`/`ConvertTo-Json` do PowerShell trocava a escala numérica (`11.0` → `11`). Solução: `json_agg::text`.
4. Uma prova fraca (só alguns campos) deixou passar os itens 2 e 3. Agora usa a linha inteira.

**Prevenção incorporada ao método:**
- script entregue ao cliente só depois de rodar **inteiro** sem as variáveis de agente e com cp850;
- modo `-Ensaio` com ROLLBACK;
- só ASCII;
- validado pelo parser do PowerShell 5.1;
- SHA256 informado.

## F1 — Schema aditivo (somente banco de TESTE)

```text
FASE:        F1
STATUS:      CONCLUÍDA (nível 3: integração real no banco de teste)
ARQUIVOS:    supabase/migrations/20260930100000_filament_products_inbox.sql
             supabase/migrations/20260930110000_finalize_print_job_snapshot.sql
             supabase/rollbacks/20260930100000_filament_products_inbox.down.sql
             supabase/rollbacks/20260930110000_finalize_print_job_snapshot.down.sql
PRODUÇÃO:    NÃO TOCADA (aplicação na produção = F4, executada pelo cliente)
```

| # | Esperado (definido antes) | Obtido |
|---|---|---|
| 1 | Checksum antes = depois | IGUAL, 15/15 |
| 2 | 3 tabelas, RLS, policies | `filament_products`, `spool_inbox`, `spools_identity_backup`, RLS=true; `owner_all` nas 2 de cliente |
| 3 | Colunas novas; brand/material nullable | 9 colunas; brand=YES, material=YES |
| 4 | Finalize com snapshot | 3 linhas; 2ª chamada idempotente; snapshot do produto (A); do spool legado (B); órfão = NULL (R4); desconto 1× só com peso confirmado |
| 5 | Isolamento 2 usuários | u2 vê 0/0/0; grava em nome do u1 → 42501; altera → 0 linhas; próprio → OK |
| 6 | Backup invisível ao cliente | 3 linhas reais → 0 visíveis |
| 7 | Rollbacks | removem as 3 tabelas + 9 colunas; brand volta a NOT NULL; finalize sem snapshot |
| 8 | R-CONTRATO | 17 consultas + 1 rpc, 0 falhas |
| 9 | Testes herméticos | Agent 220/220, Web 121/121 |

- **Convenção adotada:** as migrations não controlam a transação. Quem controla é o aplicador: o aplicador do teste envolve arquivo + histórico num único BEGIN/COMMIT, e na produção isso fica a cargo da CLI. Os rollbacks manuais têm BEGIN/COMMIT próprios.
- **Pendências:** nenhuma P0.
  - Residual: `spool_inbox.suggested_*` referencia por id simples (não composto com user_id). Os ids não são adivinháveis e o RLS impede a leitura, então o risco é baixo; revisar na F9.
  - Decisão aberta: renomear o Agent novo para **v4**, porque o instalador "v3" existente é o de pareamento e não deve ser instalado.
- **Próxima fase:** F2 (Agent: Inbox, sem autoridade da nuvem).
