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
| 1.3 | O2 — Agent 4.2: eventos, limpeza de segredos, fila, installation_id, versão, rotação do agent.log, menos ruído | ✅ código (instalador sai na O4) |
| 1.4 | O3 — Web: tela de recuperação de erro, versão do build, aba "Central" (só admin), botão "Enviar diagnóstico" | ✅ código |
| 1.5 | O4 — teste real: Agent 4.2 de teste + impressora + banco de teste (16 validações) | ✅ passou; instalador 4.2 gerado |
| 1.6 | Keepalive diário (GitHub Actions) para o Supabase grátis não pausar | ✅ `.github/workflows/keepalive.yml` (sem segredo: chave anon é pública); passa a valer com a O5 na main |
| 1.7 | Backup semanal automático do banco de produção no PC (8 cópias) | ✅ agendado (domingo 12:00); 1º backup semanal-20260929-050456, 11 tabelas conferidas |
| 1.8 | O5 — produção: migration, publicar Web, instalar Agent 4.2 (fora de impressão), você vira admin, 7 dias de observação | 🔨 3 scripts prontos e ensaiados: `o5-schema-producao.ps1` → `publicar-web-producao.ps1` → `o5-instalar-agent.ps1` · 👤 rodar |

## BLOCO 2 — Entrada do cliente (sem isso ninguém de fora consegue usar)

| # | Tarefa | Quem |
|---|---|---|
| 2.1a | Piloto: contas dos testers criadas pelo Ricardo no painel do Supabase (Add user, e-mail já confirmado; não envia e-mail) | 👤 na Onda A |
| 2.1b | Venda: cadastro aberto + "esqueci minha senha" — exige SMTP próprio (o e-mail padrão do Supabase só envia para a equipe do projeto, 2/hora) → depende do domínio (4.5) | ⏳ Bloco 4 |
| 2.2 | Aviso de privacidade do piloto (`docs/PRIVACIDADE_PILOTO.md`) | ✅ aprovado; contato rprado3d@gmail.com |
| 2.2b | Termos de Uso + Política de Privacidade completos (revisão de advogado) | ⏳ antes da venda |
| 2.3 | Pareamento do Agent por código (10 caracteres, 10 min, uso único; Agent nunca pede a senha; botão 💻 Computadores na Web para desconectar) | ✅ no banco de teste (e2e 15/15) · vai para produção junto com a O5 |
| 2.4 | Checagem automática no GitHub (testes + typecheck a cada push) | ✅ `.github/workflows/ci.yml` — 1º run verde (64c5ee5) |
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
| 4.2 | Modelo de cobrança e plataforma — proposta em `docs/PROPOSTA_PRECOS_E_MONETIZACAO.md` (Grátis / Maker R$ 19,90 / Pro R$ 39,90; oferta Fundador; kit NFC; parceria com lojas) | 👤 decidir |
| 4.3 | Cobrança integrada (webhook idempotente, plano no banco, bloqueio por atraso) | ⏳ depois de 4.2 |
| 4.4 | Assinatura digital do instalador (tira o aviso do Windows) | 👤 compra do certificado |
| 4.5 | Domínio próprio | 👤 compra |
| 4.7 | Repositório GitHub privado (hoje público por necessidade; Actions continua funcionando no privado) | 👤 decidido: vai ficar privado |
| 4.6 | Supabase pago (backup gerenciado) quando houver receita | 👤 |

## Pendências antigas (paralelas, quando você puder)

- F8 uso real: resolver os 2 itens ignorados (PETG Prata, Branco Ultra Silk) e ligar carretéis aos slots. 👤
- F9 travas no banco (depois de alguns dias limpos).
- Antes da Onda A: revisão de falhas silenciosas no Agent (checklist do agente silent-failure-hunter do ECC, aplicado sem instalar), separando o que é engolido de propósito (telemetria) do que é bug. Candidatos já vistos: updateStatus sem conferir resultado; catch vazio no encerramento.
- Investigar: o log real mostra ~195 reconciliações/dia da projeção AMS pós-Cloud Sync e ~208 avisos "Bambu Cloud apontava carretel ..." — possível vai-e-volta entre nuvem e projeção. Não muda estoque (só ams_slots), mas a Central vai mostrar; analisar com evidência antes de mexer.

---

## Registro

| Data | Item | Resultado |
|---|---|---|
| 2026-09-29 | 1.1 | Pacote de construção fechado; decisões D1–D4 tomadas |
| 2026-09-29 | 1.2 | Migration 20261001100000 no banco de teste: 26/26 testes (RLS, GRANT, anon, sequestro de ID, duplicado, lote, cota 300, purga 30 d, admin, health); rollback → reaplicação → 26/26; spools/print_logs intactos |
| 2026-09-29 | 1.3 | Agent 4.2 (código): emissor, sanitização, installation_id, marca de crash, 30 eventos ligados, log de perfis só na mudança, rotação 5 MB no run-agent.vbs. Suíte Agent 269/269; integração real no banco de teste 8/8 (segredo fictício não chega, central fora do ar = 0 ms e fila preservada) |
| 2026-09-29 | 1.4 | Web: ErrorBoundary + onerror/unhandledrejection → WEB_ERROR, versão do build (hash do commit), botão 📡 Central (só admin: instalações, saúde, timeline, filtros, erros agrupados, purga), botão 🛟 Suporte (SUPPORT_REQUEST). Sanitização idêntica à do Agent (teste trava). Web 14/14 arquivos de teste + typecheck; Agent 270/270 |
| 2026-09-29 | 1.5 prep | A1 aceita 1 conexão MQTT (fonte: allaboutbambu.com, ha-bambulab #174) → O4 exige parar o Agent de produção. Script O4 com ensaio (bloqueia se há impressão ativa ou finalize pendente; pasta isolada via FILAMAP_CONFIG_DIR para nunca ler a fila da produção). Staging web publicado (staging.filamap.pages.dev), usuário de teste admin, replay do agent.log de 28/09 na Central de teste (195 eventos, incidente visível) |
| 2026-09-29 | 1.6/1.7/2.4 | keepalive() testado no banco de teste (HTTP 200); backup inclui filament_products/spool_inbox/spools_identity_backup e só apaga pastas semanal-* (backups manuais preservados); CI criado. Observação: o repositório GitHub é PÚBLICO (sem segredos commitados; decidir se deve virar privado antes da venda) |
| 2026-09-29 | 2.1/2.2/2.4 | Evidência: SMTP padrão do Supabase só entrega para a equipe do projeto (2/h) → cadastro aberto vai para o Bloco 4; piloto usa contas criadas no painel. Aviso de privacidade do piloto rascunhado. CI verde no GitHub |
| 2026-09-29 | 2.3 | Porta do pareamento (13af7da) para o código atual. Provado antes no banco de teste: postgres pode apagar auth.sessions; generate_link+verify cria sessão própria sem e-mail; apagar a sessão do computador não afeta a da Web. Bug achado no e2e (coluna expires_at ambígua em create_agent_pairing_code — nunca teria funcionado) corrigido; rollback→reaplicação→e2e 15/15. Agent 281/281, Web 15/15 |
| 2026-09-29 | INCIDENTE | Ao ensaiar o O5 "no teste", o wrapper do agente repassou `-EnsaioNoTeste` como texto e o script rodou no modo produção: histórico lido, ensaio com ROLLBACK (conferido sem rastro), backup somente leitura extra (prod-20260929-051617), cancelado no pedido de APLICAR. Produção verificada limpa (sem ops_events/agent_devices, histórico sem as versões). Prevenção: scripts de ops recusam parâmetro não reconhecido; wrapper testado em script inofensivo antes de uso |
| 2026-09-29 | revisão ECC | 9 skills + 2 agentes lidos inteiros; nenhum instalado. Aplicado o padrão (SELECT f()) nas 4 políticas RLS novas (checklist database-reviewer); rollback→reaplicação no teste; Central 26/26, emissor 8/8, pareamento 15/15, ensaio O5 11/11; hashes do O5 atualizados |
| 2026-09-29 | 1.5 O4 | Agent 4.2 (fonte) + A1 real + banco de teste: 20 eventos seq 1–20 sem buraco; impressão curta COMPLETED 1 g no carretel do slot 3; cancelada FAILED 0 % = 0 g; impressora desligada → MQTT_ERROR/DISCONNECTED/PRINTER_OFFLINE → ONLINE/CONNECTED (~2 min); IP antigo .17 → .15 redescoberto em 8 s; Ctrl+C → AGENT_STOPPED, marca de execução limpa, fila vazia; health OK, 0 erros; sem segredo nos eventos; Agent de produção religado. Pendências menores: JOB_DETECTED com grams=0 (emitido antes do FTPS); aviso do slot 4 ~7×/20 min (item de investigação). Instalador 4.2 SHA256 98866BDB…; Agent 281/281. Build apaga installer/output → cópia dos arquivos 4.1 instalados em %APPDATA%\Filamap-devollback-agent-4.1.0 |
