// ============================================================
//  SFA Bike: settings you edit.  Everything else stays as is.
//  Where to find the two values: Supabase > Project Settings > API
//     SUPABASE_URL      = "Project URL"
//     SUPABASE_ANON_KEY = the "anon" (public) key, or the "publishable" key.
//  NEVER paste the service_role / secret key here.
// ============================================================
window.SFA_CONFIG = {
  SUPABASE_URL: 'https://lkxosnadtoesncmeooxd.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxreG9zbmFkdG9lc25jbWVvb3hkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NDcyMjcsImV4cCI6MjEwNzEyMzIyN30.yZevmv-lZRXZyUx-_JiLx5AvBnuBLpLTnSAiWhKzWm8',


  APP_NAME: 'SFA Bike',          // shown in the header and on the login page
  EMAIL_DOMAIN: 'sfabike.app',   // hidden login domain, keep as is (EX1 -> ex1@sfabike.app)
  SESSION_HOURS: 6,              // automatic sign-out after this many hours
};
