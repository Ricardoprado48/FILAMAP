import { createClient } from "@supabase/supabase-js";

// Produção por padrão. Staging: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY no build.
const PROD_SUPABASE_URL = "https://gqtlszffgvxsqcmefhyd.supabase.co";
const PROD_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxdGxzemZmZ3Z4c3FjbWVmaHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NTA3OTQsImV4cCI6MjEwNTIyNjc5NH0.YH6OHOF2lV1uIjQ3A9kLFhIGlovgZc2ywdXmRykxkkM";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || PROD_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || PROD_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
