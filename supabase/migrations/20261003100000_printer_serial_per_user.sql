-- A mesma impressora (serial) pode estar em contas diferentes: revenda, troca de dono,
-- ou teste de instalacao limpa com outra conta. Antes o serial era unico no sistema
-- inteiro e o Agent da segunda conta falhava ao registrar a impressora (23505).
-- Continua unico DENTRO de cada conta. RLS (owner_all) nao muda: cada conta so ve a sua.
ALTER TABLE public.printers ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.printers DROP CONSTRAINT printers_serial_key;
ALTER TABLE public.printers ADD CONSTRAINT printers_user_serial_key UNIQUE (user_id, serial);
