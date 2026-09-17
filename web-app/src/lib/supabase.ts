import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://gqtlszffgvxsqcmefhyd.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxdGxzemZmZ3Z4c3FjbWVmaHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NTA3OTQsImV4cCI6MjEwNTIyNjc5NH0.YH6OHOF2lV1uIjQ3A9kLFhIGlovgZc2ywdXmRykxkkM";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
