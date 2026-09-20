// URL e anon key públicos do projeto Supabase -- protegidos por RLS, o
// mesmo par já embutido no bundle JS do web-app
// (web-app/src/lib/supabase.ts). Seguro embutir aqui: não são segredo,
// só identificam o projeto. Permite o Agent funcionar sem nenhuma
// variável de ambiente configurada pelo cliente final; SUPABASE_URL e
// SUPABASE_ANON_KEY no .env continuam tendo prioridade (dev/CI/conta de
// teste), como já acontecia.
export const DEFAULT_SUPABASE_URL = "https://gqtlszffgvxsqcmefhyd.supabase.co";
export const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxdGxzemZmZ3Z4c3FjbWVmaHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NTA3OTQsImV4cCI6MjEwNTIyNjc5NH0.YH6OHOF2lV1uIjQ3A9kLFhIGlovgZc2ywdXmRykxkkM";
