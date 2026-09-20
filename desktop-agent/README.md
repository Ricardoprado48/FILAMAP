# Filamap Desktop Agent

Serviço local que descobre a impressora Bambu Lab na rede, conecta via MQTT
e reporta telemetria/consumo de filamento para o backend Filamap.

## Fluxo de onboarding comercial (implementado)

1. Cliente assina, baixa o `filamap-agent.exe` (ou roda em modo dev).
2. Executa o Agent uma vez, com um terminal visível (duplo-clique no `.exe`
   já abre um).
3. Como ainda não há nada configurado, o Agent pergunta, no próprio
   terminal: e-mail e senha da conta Filamap, número de série e Access Code
   da impressora.
4. A resposta é salva em `src/config/store.ts` → `getConfigPath()`:
   - Windows: `%APPDATA%\Filamap\config.json`
   - macOS: `~/Library/Application Support/Filamap/config.json`
   - Linux: `~/.config/filamap/config.json` (ou `$XDG_CONFIG_HOME/filamap/config.json`)
5. Da próxima vez que o Agent iniciar (manualmente ou via auto-start do
   Windows), a configuração já está lá — não pergunta nada de novo, não
   precisa de terminal.
6. Se o Agent for iniciado sem configuração completa **e** sem terminal
   interativo (`stdin` não é TTY — é exatamente o caso do auto-start via
   Tarefa Agendada), ele não fica esperando input que nunca vai chegar:
   grava um erro claro em `agent.log` e encerra, pedindo pra rodar
   manualmente uma vez primeiro.

A URL e a chave anônima do Supabase já vêm com um valor padrão embutido
(igual ao que o Web App já publica no próprio bundle JS) — o cliente nunca
precisa descobrir ou colar isso.

`.env` continua funcionando (prioridade sobre o arquivo salvo) para
desenvolvimento, CI ou contas de teste — ver `.env.example`. Não é o
caminho esperado para o cliente final.

### Reconfigurar / trocar de conta ou impressora

Apague o `config.json` (caminho acima) e rode o Agent de novo com um
terminal visível — o assistente roda outra vez.

## Auto-start no Windows

`install-autostart.ps1` registra uma Tarefa Agendada no logon do usuário
(sem janela visível, com restart automático). Ver comentários no próprio
script e em `run-agent.ps1`. `uninstall-autostart.ps1` remove.

## Testes

```
npm test              # unitários (src/**/*.test.ts), sem dependências externas
npm run test:integration  # RPC real contra um Supabase de TESTE (pula sem credenciais)
```

## O que falta para o instalador `.exe` completo (P2.3, backlog)

Implementado nesta rodada: onboarding sem `.env`, config persistida fora do
projeto, auto-start (já existia). Em aberto, e por que ficaram de fora:

- **Instalador gráfico (wizard `.exe`/MSI)** — hoje `npm run package-exe`
  gera um binário único (`pkg`), não um instalador com wizard, atalho no
  menu iniciar, desinstalador registrado no Painel de Controle. Ferramentas
  como Inno Setup/NSIS/electron-builder resolvem isso, mas envolvem
  escolher uma delas e configurar um pipeline de build novo — decisão de
  produto/ferramenta, não teve pedido explícito de qual usar.
- **Assinatura de código (code signing)** — sem isso, o Windows/SmartScreen
  mostra aviso de "editor desconhecido" ao abrir o `.exe`. Exige um
  certificado de assinatura (custo + processo de verificação de identidade
  da empresa) que só o dono do produto pode providenciar — bloqueado por
  decisão externa, não técnica.
- **Auto-update** — não implementado. Também depende da decisão de
  como distribuir novas versões (canal próprio vs. algo como
  electron-updater) e, de novo, assinatura de código para atualizações
  confiáveis.
- **Armazenamento do Access Code em cofre do SO** (em vez do
  `config.json` em texto puro, hoje com permissão restrita a 0600 só no
  POSIX) — ver P2.2 no backlog. Precisaria de uma dependência nativa
  (ex.: `keytar`/Credential Manager no Windows via DPAPI), o que muda o
  processo de build/empacotamento do `pkg`; não implementado nesta rodada
  por ser exatamente esse tipo de escolha maior de dependência/arquitetura.
