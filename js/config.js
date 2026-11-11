/* ============================================================
   JDF PUBLIC SAFETY: PUBLIC CONFIG
   Every value in this file is safe to publish.
     - The Supabase "anon" key only allows what the database's
       row level security rules allow.
     - The Square application id and location id only let a
       browser draw Square's card form. They cannot move money.
   NEVER put the Supabase service_role key, the Square access
   token or the Square webhook signature key in this file.

   Leave a pair empty until that service exists:
     - Supabase empty: member pages say "registration opens soon".
     - Square empty: the donate page hands off to the hosted
       Square checkout link, as it does today.
   ============================================================ */
window.JDF_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  SQUARE_APPLICATION_ID: '',
  SQUARE_LOCATION_ID: '',
  SQUARE_ENVIRONMENT: 'production' // 'sandbox' while testing with sandbox credentials
};
