const SUPABASE_URL = 'https://kparyjhwfncrsgcuohiy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwYXJ5amh3Zm5jcnNnY3VvaGl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4ODI3NTUsImV4cCI6MjA5MDQ1ODc1NX0.0PdDm415dsTxzhgbvOMnaS9ZOaMSQBcU4ZBErVraqvM';

// UMD from cdn.jsdelivr.net exposes the factory on window.supabase before we replace it with the client
const supabaseUmd = window.supabase;
if (!supabaseUmd || typeof supabaseUmd.createClient !== 'function') {
  throw new Error(
    'Biblioteca Supabase não carregou (rede, bloqueio ou script bloqueado). Recarrega a página.'
  );
}
window.supabase = supabaseUmd.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: window.sessionStorage, storageKey: 'sb-session' },
});
