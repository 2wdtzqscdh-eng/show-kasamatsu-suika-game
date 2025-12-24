// Serverless endpoint for submitting/upserting a player's best score
// Expects POST { name: string, score: number }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const score = Number(body.score || 0);
  if (!name) return res.status(400).json({ ok: false, error: 'Missing name' });

  try {
    const { get, set } = await import('@vercel/kv');
    const map = (await get('kasamatsu_ranking_v1')) || {};
    const prev = map[name];
    if (prev == null || score > prev) {
      map[name] = score;
      await set('kasamatsu_ranking_v1', map);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(501).json({ ok: false, error: 'KV not configured. Configure Vercel KV or implement storage.' });
  }
}
