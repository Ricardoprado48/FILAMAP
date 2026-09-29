# PLANO MESTRE — PILOTO E PREPARAÇÃO PARA VENDA

Atualizado: 2026-09-29 · Fonte do detalhe técnico da Central: `PACOTE_CONSTRUCAO_OBSERVABILIDADE_FILAMAP_V1.md`

Legenda: ✅ feito · 🔨 em andamento · ⏳ a fazer · 👤 precisa do Ricardo

Decisões já tomadas (2026-09-29): D1 erros no próprio Supabase · D2 plano **grátis** + keepalive diário + backup semanal + cota 300 eventos/dia · D3 retenção 30 dias · D4 tester não vê os próprios eventos.

---

## BLOCO 1 — Central de Observabilidade (antes de qualquer tester)

| # | Tarefa | Quem |
|---|---|---|
| 1.1 | O0 — engenharia e pacote de construção | ✅ |
| 1.2 | O1 — migration da Central + rollback + testes de segurança no **banco de teste** | ✅ |
| 1.3 | O2 — Agent 4.2: eventos, limpeza de segredos, fila, installation_id, versão, rotação do agent.log, menos ruído | 🔨 |
| 1.4 | O3 — Web: tela de recuperação de erro, versão do build, aba "Central" (só admin), botão "Enviar diagnóstico" | ⏳ |
| 1.5 | O4 — teste real: Agent 4.2 de teste + impressora + banco de teste (16 validações) | ⏳ 👤 impressora livre para jobs curtos |
| 1.6 | Keepalive diário (GitHub Actions) para o Supabase grátis não pausar | ⏳ 👤 cadastrar 1 segredo no GitHub (script pronto) |
| 1.7 | Backup semanal automático do banco de produção no PC (8 cópias) | ⏳ 👤 rodar script que agenda |
| 1.8 | O5 — produção: migration, publicar Web, instalar Agent 4.2 (fora de impressão), você vira admin, 7 dias de observação | ⏳ 👤 rodar scripts |

## BLOCO 2 — Entrada do cliente (sem isso ninguém de fora consegue usar)

| # | Tarefa | Quem |
|---|---|---|
| 2.1 | Cadastro de conta + "esqueci minha senha" + confirmação de e-mail | ⏳ |
| 2.2 | Termos de Uso + Política de Privacidade (LGPD) + aceite no cadastro + texto do piloto | ⏳ 👤 revisar e aprovar o texto |
| 2.3 | Pareamento do Agent por código de 6 dígitos (Agent deixa de pedir a senha Filamap) | ⏳ |
| 2.4 | Checagem automática no GitHub (testes + typecheck a cada push) | ⏳ |
| 2.5 | Teste ponta a ponta do cliente novo: cadastro → instalar → parear → imprimir → desconto | ⏳ |

## BLOCO 3 — Piloto fechado

| # | Tarefa | Quem |
|---|---|---|
| 3.1 | Onda A — 3 testers (convite, instalação, acompanhamento pela Central) | 👤 escolher os 3 |
| 3.2 | Critérios de liberação da Onda B (nenhum job perdido, nenhum desconto duplicado etc.) | ⏳ |
| 3.3 | Onda B — +7 testers | 👤 |

## BLOCO 4 — Venda

| # | Tarefa | Quem |
|---|---|---|
| 4.1 | Atualização automática do Agent | ⏳ |
| 4.2 | Modelo de cobrança (mensal / único / por impressora) e plataforma | 👤 decidir |
| 4.3 | Cobrança integrada (webhook idempotente, plano no banco, bloqueio por atraso) | ⏳ depois de 4.2 |
| 4.4 | Assinatura digital do instalador (tira o aviso do Windows) | 👤 compra do certificado |
| 4.5 | Domínio próprio | 👤 compra |
| 4.6 | Supabase pago (backup gerenciado) quando houver receita | 👤 |

## Pendências antigas (paralelas, quando você puder)

- F8 uso real: resolver os 2 itens ignorados (PETG Prata, Branco Ultra Silk) e ligar carretéis aos slots. 👤
- F9 travas no banco (depois de alguns dias limpos).

---

## Registro

| Data | Item | Resultado |
|---|---|---|
| 2026-09-29 | 1.1 | Pacote de construção fechado; decisões D1–D4 tomadas |
| 2026-09-29 | 1.2 | Migration 20261001100000 no banco de teste: 26/26 testes (RLS, GRANT, anon, sequestro de ID, duplicado, lote, cota 300, purga 30 d, admin, health); rollback → reaplicação → 26/26; spools/print_logs intactos |
