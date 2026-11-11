/**
 * GET /api/health
 * Says which groups of environment variables this deployment has, as true/false.
 * It never returns a value, a length, or any part of a key. Use it after adding
 * variables in Vercel to confirm they took effect (a redeploy is needed first).
 */
const has = (...names) => names.every((n) => !!(process.env[n] && String(process.env[n]).trim()));

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    database: has('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'),
    email: has('RESEND_API_KEY', 'EMAIL_FROM'),
    staffAlerts: has('RESEND_API_KEY', 'EMAIL_FROM', 'STAFF_NOTIFY_TO'),
    squarePayments: has('SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID'),
    squareEnvironment: process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : (process.env.SQUARE_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'not set'),
    squareMonthly: has('SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID'),
    squareWebhook: has('SQUARE_WEBHOOK_SIGNATURE_KEY', 'SQUARE_WEBHOOK_URL'),
    receiptTaxStatement: has('RECEIPT_TAX_STATEMENT'),
  });
};
