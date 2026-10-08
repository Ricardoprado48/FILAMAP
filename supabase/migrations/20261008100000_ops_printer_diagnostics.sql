-- Diario da impressora (Agent 4.3.0): dois tipos novos de evento na Central.
--   PRINTER_HMS   -- alerta HMS apareceu/sumiu (codigo em error_code, action no metadata)
--   PRINTER_ERROR -- print_error da impressora mudou para nao-zero
-- ADITIVA: so amplia o CHECK de ops_events.event_type. Nenhum dado existente muda.
-- Agent antigo segue funcionando; Agent 4.3.0 contra banco sem esta migration so tem
-- esses dois tipos recusados pela RPC (evento a evento), o resto do lote entra.
--
-- Rollback: supabase/rollbacks/20261008100000_ops_printer_diagnostics.down.sql

ALTER TABLE public.ops_events DROP CONSTRAINT IF EXISTS ops_events_event_type_check;

ALTER TABLE public.ops_events ADD CONSTRAINT ops_events_event_type_check CHECK (event_type IN (
    'AGENT_STARTED', 'AGENT_STOPPED', 'AGENT_CRASH_RECOVERED',
    'MQTT_CONNECTED', 'MQTT_DISCONNECTED', 'MQTT_ERROR',
    'PRINTER_ONLINE', 'PRINTER_OFFLINE',
    'TELEMETRY_DEGRADED', 'TELEMETRY_RESTORED',
    'SESSION_LOST', 'SESSION_RECOVERED',
    'BAMBU_SYNC_FAILED', 'BAMBU_SYNC_RECOVERED',
    'PROFILE_SYNC_FAILED', 'PROFILE_SYNC_RECOVERED',
    'INBOX_ITEM_CREATED',
    'JOB_DETECTED', 'JOB_FINISHED', 'JOB_FAILED',
    'FTPS_FAILED',
    'PRINTER_HMS', 'PRINTER_ERROR',
    'FINALIZE_QUEUED', 'FINALIZE_RETRY', 'FINALIZE_COMPLETED', 'FINALIZE_FAILED',
    'SPOOL_AMBIGUOUS',
    'UNHANDLED_REJECTION', 'AGENT_ERROR',
    'WEB_ERROR', 'SUPPORT_REQUEST'
));
