// Catálogo fechado de eventos da Central (PACOTE seção 4). O banco recusa
// qualquer tipo fora desta lista (CHECK em ops_events.event_type).
// A central OBSERVA: nenhum evento decide estoque, identidade, peso ou finalize.

export type Severity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

// dedup: "none" = todo emit vira evento; "window" = mesma impressão digital
// no máximo 1x por janela (repetições somadas em repeat_count).
export const EVENT_CATALOG = {
  AGENT_STARTED: { severity: "INFO", component: "agent", dedup: "none", meaning: "Processo do Agent autenticado e iniciando." },
  AGENT_STOPPED: { severity: "INFO", component: "agent", dedup: "none", meaning: "Encerramento limpo (Ctrl+C/SIGTERM)." },
  AGENT_CRASH_RECOVERED: { severity: "WARNING", component: "agent", dedup: "none", meaning: "A execução anterior não terminou de forma limpa (crash, desligamento do PC ou queda de energia)." },
  MQTT_CONNECTED: { severity: "INFO", component: "mqtt", dedup: "none", meaning: "Conexão MQTT com a impressora estabelecida (transição)." },
  MQTT_DISCONNECTED: { severity: "WARNING", component: "mqtt", dedup: "none", meaning: "Conexão MQTT fechada (transição)." },
  MQTT_ERROR: { severity: "WARNING", component: "mqtt", dedup: "window", meaning: "Erro de stream MQTT (ECONNRESET, timeout)." },
  PRINTER_ONLINE: { severity: "INFO", component: "printer", dedup: "none", meaning: "Impressora encontrada na rede depois de estar ausente." },
  PRINTER_OFFLINE: { severity: "WARNING", component: "printer", dedup: "none", meaning: "Impressora não encontrada na rede (1ª falha da busca)." },
  TELEMETRY_DEGRADED: { severity: "WARNING", component: "supabase", dedup: "none", meaning: "Heartbeat/telemetria para o Supabase começou a falhar." },
  TELEMETRY_RESTORED: { severity: "INFO", component: "supabase", dedup: "none", meaning: "Heartbeat/telemetria voltou." },
  SESSION_LOST: { severity: "ERROR", component: "session", dedup: "none", meaning: "Sessão Supabase perdida; recuperação automática iniciada." },
  SESSION_RECOVERED: { severity: "INFO", component: "session", dedup: "none", meaning: "Sessão Supabase recuperada." },
  BAMBU_SYNC_FAILED: { severity: "WARNING", component: "bambu_cloud", dedup: "none", meaning: "Cloud Spool Sync começou a falhar (transição)." },
  BAMBU_SYNC_RECOVERED: { severity: "INFO", component: "bambu_cloud", dedup: "none", meaning: "Cloud Spool Sync voltou." },
  PROFILE_SYNC_FAILED: { severity: "WARNING", component: "bambu_studio", dedup: "none", meaning: "Sincronização de perfis do Bambu Studio começou a falhar." },
  PROFILE_SYNC_RECOVERED: { severity: "INFO", component: "bambu_studio", dedup: "none", meaning: "Sincronização de perfis voltou." },
  INBOX_ITEM_CREATED: { severity: "INFO", component: "bambu_cloud", dedup: "none", meaning: "Quantidade de itens na caixa de entrada mudou para mais que zero." },
  JOB_DETECTED: { severity: "INFO", component: "job", dedup: "none", meaning: "Novo trabalho de impressão detectado via MQTT." },
  JOB_FINISHED: { severity: "INFO", component: "job", dedup: "none", meaning: "Impressão concluída." },
  JOB_FAILED: { severity: "WARNING", component: "job", dedup: "none", meaning: "Impressão interrompida/falha (percentual no metadata)." },
  FTPS_FAILED: { severity: "WARNING", component: "ftps", dedup: "none", meaning: "Não foi possível ler slice_info.config via FTPS." },
  FINALIZE_QUEUED: { severity: "INFO", component: "finalize", dedup: "none", meaning: "Job gravado na fila persistente de finalização." },
  FINALIZE_RETRY: { severity: "WARNING", component: "finalize", dedup: "none", meaning: "Finalização falhou e ficou para reenvio (tentativa 1 e a cada 10)." },
  FINALIZE_COMPLETED: { severity: "INFO", component: "finalize", dedup: "none", meaning: "finalize_print_job confirmou; itens e fonte da identificação no metadata." },
  FINALIZE_FAILED: { severity: "ERROR", component: "finalize", dedup: "none", meaning: "Job não pôde entrar na fila (ficou só em agent-state.json)." },
  SPOOL_AMBIGUOUS: { severity: "WARNING", component: "identity", dedup: "none", meaning: "Slot usado no job sem carretel identificado (log órfão, sem desconto)." },
  UNHANDLED_REJECTION: { severity: "ERROR", component: "agent", dedup: "window", meaning: "Promise rejeitada sem tratamento (Agent segue)." },
  AGENT_ERROR: { severity: "ERROR", component: "agent", dedup: "window", meaning: "Erro capturado em ponto relevante (component indica onde)." },
  WEB_ERROR: { severity: "ERROR", component: "web", dedup: "window", meaning: "Erro no app Web (render, onerror, unhandledrejection)." },
  SUPPORT_REQUEST: { severity: "INFO", component: "web", dedup: "none", meaning: "Usuário pediu suporte pelo botão Enviar diagnóstico." },
} as const satisfies Record<string, { severity: Severity; component: string; dedup: "none" | "window"; meaning: string }>;

export type EventType = keyof typeof EVENT_CATALOG;
