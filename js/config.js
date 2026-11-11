/* ============================================================
   JDF PUBLIC SAFETY: PUBLIC CONFIG
   Every value in this file is safe to publish.
     - The Supabase publishable key (sb_publishable_..., or the
       older "anon" key) only allows what the database's row
       level security rules allow.
     - The Square application id and location id only let a
       browser draw Square's card form. They cannot move money.
   NEVER put a Supabase secret / service_role key, a Square
   access token or a Square webhook signature key in this file.

   Two sets of values, chosen by where the page is running:
     STAGING     the review copy at jdf-preview.vercel.app and
                 local previews. Uses Square SANDBOX values, so
                 test cards work and no real money moves.
     PRODUCTION  the real site, on any other hostname.

   Leave a value empty until that service exists:
     - Supabase empty: member pages say "registration opens soon".
     - Square empty: the donate page hands off to the hosted
       Square checkout link, as it does today.
   ============================================================ */
(function () {
  var STAGING = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SQUARE_APPLICATION_ID: '',   // starts with "sandbox-"
    SQUARE_LOCATION_ID: '',
    SQUARE_ENVIRONMENT: 'sandbox'
  };

  var PRODUCTION = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SQUARE_APPLICATION_ID: '',
    SQUARE_LOCATION_ID: '',
    SQUARE_ENVIRONMENT: 'production'
  };

  var host = location.hostname;
  var isStaging = host === 'jdf-preview.vercel.app' || host === 'localhost' || host === '127.0.0.1' ||
    /^jdf-preview-.*\.vercel\.app$/.test(host);

  window.JDF_CONFIG = isStaging ? STAGING : PRODUCTION;
  window.JDF_CONFIG.ENV = isStaging ? 'staging' : 'production';
})();
