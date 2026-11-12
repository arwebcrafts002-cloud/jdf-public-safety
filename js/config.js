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
    SUPABASE_URL: 'https://tzxfibpdqpxdoedyoclj.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_G9_egnahDOWwYYiT2aDrmA_PKfrrXxF',
    SQUARE_APPLICATION_ID: 'sandbox-sq0idb-rPf-1zves7bdyT1RApzj9Q',   // starts with "sandbox-"
    SQUARE_LOCATION_ID: 'LXSR7DZG31FYZ',
    SQUARE_ENVIRONMENT: 'sandbox'
  };

  var PRODUCTION = {
    SUPABASE_URL: 'https://tzxfibpdqpxdoedyoclj.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_G9_egnahDOWwYYiT2aDrmA_PKfrrXxF',
    SQUARE_APPLICATION_ID: 'sq0idp-AKWRf94FbLGjoclnlj4-2w',
    SQUARE_LOCATION_ID: 'LADDVTZV7KX70',
    SQUARE_ENVIRONMENT: 'production'
  };

  var host = location.hostname;
  var isStaging = host === 'jdf-preview.vercel.app' || host === 'localhost' || host === '127.0.0.1' ||
    /^jdf-preview-.*\.vercel\.app$/.test(host);

  window.JDF_CONFIG = isStaging ? STAGING : PRODUCTION;
  window.JDF_CONFIG.ENV = isStaging ? 'staging' : 'production';
})();
