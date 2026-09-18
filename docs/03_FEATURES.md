# 03 — Funcionalidades do Filamap

Legenda:

- **Implementado:** existe fluxo no código auditado.
- **Parcial:** existe parte relevante, mas o fluxo não está completo/validado.
- **Visão:** descrito na documentação, sem implementação suficiente no código auditado.

| Área | Estado | Observação |
|---|---|---|
| Login por e-mail/senha | Implementado | Supabase Auth no frontend. |
| RLS por usuário | Implementado nas migrations | Requer confirmar estado remoto e completar schema reproduzível. |
| Cadastro de impressora pelo Agent | Implementado | Cria/atualiza por `serial`. |
| Heartbeat online/offline | Implementado | Agent marca online e MQTT close marca offline. |
| Telemetria MQTT | Implementado | Estado, progresso, camada, temperaturas, slot, tarefa. |
| Descoberta automática de IP | Parcial | Broadcast BBLP no Agent; SSDP existe separado; sem estratégia completa em camadas. |
| Reconexão MQTT | Implementado pelo cliente MQTT | `reconnectPeriod: 5000`; não equivale a redescoberta de IP. |
| Download FTPS do `.3mf` | Parcial | Código existe; caminho/compatibilidade precisam validação real. |
| Parse `slice_info.config` | Parcial | Parser existe; estrutura/mapeamento precisam validação. |
| Persistência do job ativo | Implementado | `agent-state.json`. |
| Buffer offline geral | Visão | Não há fila durável de eventos/sync no código auditado. |
| Baixa automática após conclusão | Implementado com ressalvas | Faz estimativa/fallback; sem idempotência/transação completa. |
| Baixa proporcional em falha/stop | Implementado | Usa maior percentual observado. |
| Consumo multicolor/multi-slot | Parcial crítico | Parser suporta lista, finalização desconta essencialmente um slot. |
| Estoque de carretéis | Implementado | Listagem, filtro, peso, valor estimado. |
| Re-pesagem manual | Implementado | Peso bruto - tara. |
| Edição de carretel | Implementado | Marca/material/cor/peso/preço. |
| Exclusão de carretel | Implementado | Desassocia slots antes de excluir. |
| Associação spool ↔ slot | Parcial | Handler existe, mas depende de `nfcUid`; leitura NFC não está ligada à UI. |
| Ejeção de slot | Implementado | Define `spool_id = null`. |
| Gravação de tag NFC | Implementado/parcial | Web NFC grava URL e salva spool; depende de navegador compatível. |
| Leitura de tag NFC | Parcial | Hook existe, sem botão/chamada no App atual. |
| Deep link `?tag=` | Não implementado no App | URL é gravada na tag, mas App não consome o parâmetro. |
| Histórico de impressões | Implementado | Últimos 10 `print_logs`. |
| Pendência de pesagem | Inconsistente | Tipo/variável existem, porém Agent grava `needs_weighing: false` e UI não usa a lista calculada. |
| Catálogo de peças | Implementado | Criar, listar, excluir e carregar no simulador. |
| Calculadora de orçamento | Implementado | Filamento + energia + depreciação + extras + markup. |
| Configuração local de custos | Implementado | `localStorage`. |
| PWA básica | Parcial | Manifest/service worker presentes; auditoria funcional não foi feita. |
| Onboarding guiado do Agent | Visão | Atualmente configuração depende de `.env`. |
| Instalador/tray/service robusto | Parcial | Há `.exe`, `start-agent.bat` e script `pkg`; ciclo de instalação não foi auditado como produto. |
| Multi-workspace/equipe | Visão | Schema atual é por `user_id`. |
| Ledger imutável de estoque | Visão | Não existe `spool_movements`. |
| Alertas de estoque baixo | Visão | Não identificado no código atual. |
| Previsão antes de imprimir | Visão | Não identificado no código atual. |

## Funcionalidades auxiliares encontradas

- presets de tara definidos no frontend;
- lista de marcas populares;
- totalização de peso/valor por material;
- catálogo em lista/grid;
- preço de venda sugerido por multiplicador de markup;
- arquivo SCAD/STL para clipe NFC.
