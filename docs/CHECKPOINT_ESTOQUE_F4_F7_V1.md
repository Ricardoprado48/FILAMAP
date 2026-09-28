# CHECKPOINT_ESTOQUE_F4_F7_V1

Referencia: `IMPACTO_ARQUITETURA_ESTOQUE_FILAMAP_V2.md` (F4-F7). Data: 2026-09-28.

```text
F4  schema na PRODUCAO        CONCLUIDA (usuario; ops/f4-schema-producao.ps1; 14/14; dados iguais; backup prod-20260928-163743)
F5  Agent v4 instalado        CONCLUIDA (agent A41E257A; identidade e fisico com hash igual; P86318ba sincronizado;
                              fechamento real 17:04 gravado com snapshot)
F6  reconciliacao PRODUCAO    CONCLUIDA (usuario; ops/f6-reconciliar.ps1; 29 produtos, 32 perfis ligados, 4 fantasmas
                              removidos, 13 logs com snapshot, 12 orfaos intactos; backup prod-20260928-170617;
                              -Rollback ensaiado no teste: aplicar -> desfazer -> aplicar)
F7  Web                       NO STAGING, aguardando homologacao do usuario (https://staging.filamap.pages.dev)
```

## F7 - o que mudou na Web

| Antes | Agora |
|---|---|
| Nome vinha do perfil/cor do carretel | Nome = produto (`filament_products.name`) |
| Novo Carretel com perfil opcional e padroes Voolt3D/85/1000/200 | Produto obrigatorio (existente, a partir do perfil do Studio ou manual); peso e tara obrigatorios; preco opcional (NULL) |
| Tag desconhecida no slot criava carretel "Voolt3D PETG Preto 1000 g" | Vai para a Caixa de entrada (ligar a carretel existente, criar novo ou ignorar); ao resolver, entra no slot |
| Excluir carretel (DELETE) | Arquivar (`archived_at`), some do estoque/AMS; historico preservado |
| Editar marca/material/cor livre no carretel | Trocar produto + editar marca do produto (corrige "ROSA"/"BRANCO") |
| Historico mostrava o carretel atual | Mostra o snapshot da epoca |
| Pesagem/gravacao de tag com tara 218 inventada | Campo vazio quando nao ha tara |
| - | Caixa de entrada: nuvem Bambu, tag NFC, preset renomeado (D6: produto mantem ID, recebe nome novo) |

## Evidencias

| Verificacao | Resultado |
|---|---|
| Typecheck | OK |
| Web hermeticos | 140/140 (17 novos) |
| R-CONTRATO | 26 consultas + 1 rpc, 0 falhas |
| Integracao REAL (servicos da Web x banco de teste) | 6/6: produtos da F6, produto manual + carretel com preco NULL, tag -> caixa -> ligar (so nfc_uid muda) -> reabrir -> ignorar, marca do produto, produto a partir do perfil + rename D6 (ID mantido), arquivar |
| Pacote staging | index-IgTa2W5Z.js, so aponta para o banco de teste |

Pendente: homologacao do usuario no staging -> deploy de producao + merge na main (usuario).
