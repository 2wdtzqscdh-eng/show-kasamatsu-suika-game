// Serverless endpoint to clear leaderboard. Admin-only via secret.
// POST { password: string }
// Set CLEAR_RANK_SECRET in your Vercel Environment Variables.
// For local development, a default password is provided below (change or remove before public release).

const DEV_DEFAULT_SECRET = 'Jiin0104!!'; // local dev fallback (user requested)

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const { password } = req.body || {};
  const secret = process.env.CLEAR_RANK_SECRET || DEV_DEFAULT_SECRET;
  if (String(password || '') !== String(secret)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  try {
    const { del } = await import('@vercel/kv');
    await del('kasamatsu_ranking_v1');
    return res.json({ ok: true });
  } catch (err) {
    return res.status(501).json({ ok: false, error: 'KV not configured. Configure Vercel KV or implement storage.' });
  }
}
