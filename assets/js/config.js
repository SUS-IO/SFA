// ============================================================
//  SFA Bike: settings you edit.  Everything else stays as is.
//  Where to find the two values: Supabase > Project Settings > API
//     SUPABASE_URL      = "Project URL"
//     SUPABASE_ANON_KEY = the "anon" (public) key, or the "publishable" key.
//  NEVER paste the service_role / secret key here.
// ============================================================
window.SFA_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-ID.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',

  APP_NAME: 'SFA Bike',          // shown in the header and on the login page
  EMAIL_DOMAIN: 'sfabike.app',   // hidden login domain, keep as is (EX1 -> ex1@sfabike.app)
  SESSION_HOURS: 6,              // automatic sign-out after this many hours
};
