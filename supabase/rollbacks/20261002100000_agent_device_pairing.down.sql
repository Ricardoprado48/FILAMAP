-- Rollback de 20261002100000_agent_device_pairing.sql.
-- Sessões de dispositivos já pareados continuam válidas em auth.sessions
-- (o Agent segue funcionando); só a gestão por dispositivo deixa de existir.

DROP FUNCTION IF EXISTS public.touch_agent_device(TEXT);
DROP FUNCTION IF EXISTS public.revoke_agent_device(UUID);
DROP FUNCTION IF EXISTS public.consume_agent_pairing_code(TEXT);
DROP FUNCTION IF EXISTS public.create_agent_pairing_code();
DROP TABLE IF EXISTS public.agent_devices;
DROP TABLE IF EXISTS public.agent_pairing_codes;
