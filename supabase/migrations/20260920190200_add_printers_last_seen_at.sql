-- printers.is_online fica preso em `true` quando o processo do Desktop
-- Agent para de rodar sem um encerramento limpo (PC desligado, hibernação,
-- queda de energia, crash) — ninguém nunca grava `false`. last_seen_at
-- é atualizado a cada ciclo de telemetria/heartbeat enquanto o Agent está
-- de fato vivo; o frontend passa a calcular online/offline pela
-- recência desse timestamp, em vez de confiar em is_online.
ALTER TABLE public.printers
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN public.printers.last_seen_at IS 'Timestamp do último heartbeat/telemetria confirmado pelo Desktop Agent. Fonte de verdade para online/offline no frontend (is_online continua existindo mas não é mais exibido diretamente).';
