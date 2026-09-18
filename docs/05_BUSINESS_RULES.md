# 05 — Regras de Negócio do Filamap

## BR-01 — Saldo é filamento líquido

`current_weight` representa filamento útil restante, não peso bruto carretel + filamento.

Ao cadastrar/re-pesar:

```text
peso líquido = peso bruto na balança - tara do carretel
```

## BR-02 — Tara precisa ser preservada

A tara deve permanecer associada ao carretel e ser reutilizada em recalibrações.

## BR-03 — Automação é o padrão

Dados que podem ser obtidos de impressora/AMS/3MF não devem ser pedidos manualmente na operação normal.

## BR-04 — Baixa deve acontecer por evento real de job

O sistema deve ligar consumo a um trabalho executado. A visão-alvo é efetivar consumo na conclusão e calcular de forma proporcional quando um trabalho é interrompido.

## BR-05 — Não mascarar qualidade do consumo

O estado atual possui fallback estimado por tempo e até valor default. Isso é implementação existente, não uma regra desejável de precisão.

Na evolução, todo consumo deve carregar sua origem/qualidade, por exemplo:

- exato do slicer;
- derivado;
- estimado;
- pendente de reconciliação.

O sistema não deve apresentar uma estimativa como se fosse medição exata.

## BR-06 — Baixa precisa ser idempotente

Um mesmo job não pode descontar o estoque duas vezes por reconexão, repetição de evento MQTT ou reinício do Agent.

O código atual ainda não garante formalmente essa regra; ela é requisito de evolução prioritária.

## BR-07 — Multicolor deve descontar cada carretel correto

Um job que usa múltiplos slots precisa distribuir o consumo por spool/slot. Não é aceitável atribuir todo o job a apenas um slot quando o slicer indicar múltiplos materiais.

## BR-08 — RLS por proprietário é obrigatório

Usuário autenticado só pode acessar seus próprios recursos. Tabelas compartilhadas de referência podem ter política específica somente leitura.

## BR-09 — Access Code é credencial local sensível

Não exibir, documentar ou enviar credenciais LAN desnecessariamente à nuvem. Preferir armazenamento local seguro.

## BR-10 — Agent coleta; cloud consolida

O Agent deve concentrar comunicação local e normalização. Regras comerciais complexas e relatórios devem permanecer no backend/web, salvo necessidade técnica clara.

## BR-11 — Operação sem internet deve degradar com segurança

A visão do produto prevê buffer offline. Até existir uma fila confiável, não afirmar que o sistema garante sincronização após perda prolongada de internet.

## BR-12 — Um carretel físico possui identidade persistente

A identidade NFC deve referenciar um spool persistente, não apenas uma cor/material genéricos.

## BR-13 — Re-pesagem é recalibração

Uma re-pesagem manual pode corrigir drift do saldo calculado. Alterações de peso precisam ser tratadas como ação explícita do usuário e, no futuro, idealmente registradas em ledger.

## BR-14 — Orçamento não deve alterar estoque

A calculadora usa pesos/preços para estimar custo, mas não representa consumo real e não deve dar baixa em spool.
