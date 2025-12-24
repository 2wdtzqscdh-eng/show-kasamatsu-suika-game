// Serverless endpoint for fetching leaderboard (Vercel KV recommended).
// Deploy note: on Vercel, enable @vercel/kv and this will work. Otherwise this endpoint
// returns 501 asking you to configure a KV/DB provider.

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { get } = await import('@vercel/kv');
    const map = await get('kasamatsu_ranking_v1');
    return res.json({ ok: true, map: map || {} });
  } catch (err) {
    return res.status(501).json({ ok: false, error: 'KV not configured. Configure Vercel KV or implement storage.' });
  }
}
