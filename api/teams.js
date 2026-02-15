// api/teams.js
// /api/teams?teamId=herren_w1
// Reads cached JSON from Supabase table: team_cache

const { createClient } = require("@supabase/supabase-js");

const TTL_MINUTES = 60;

function minutesSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 60000;
}

module.exports = async (req, res) => {
  try {
    const teamId = req.query.teamId;
    if (!teamId) return res.status(400).json({ error: "missing_teamId" });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: "missing_env",
        message:
          "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set on Vercel (Project Settings → Environment Variables).",
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from("team_cache")
      .select("team_id, payload_json, status, source_url, updated_at")
      .eq("team_id", teamId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: "supabase_error", message: error.message });
    }

    if (!data) {
      return res.status(200).json({
        ok: false,
        teamId,
        status: "PENDING",
        reason: "no_cache_entry",
        hint:
          "Run GitHub Action 'Refresh team cache' to populate team_cache for this teamId.",
      });
    }

    const ageMin = minutesSince(data.updated_at);
    const isFresh = ageMin <= TTL_MINUTES;

    return res.status(200).json({
      ok: true,
      teamId: data.team_id,
      status: data.status || "UNKNOWN",
      source_url: data.source_url,
      updated_at: data.updated_at,
      cache: { age_minutes: Math.round(ageMin), fresh: isFresh, ttl_minutes: TTL_MINUTES },
      payload: data.payload_json || {},
    });
  } catch (err) {
    return res.status(500).json({
      error: "internal_error",
      message: err?.message || String(err),
      stack: (err?.stack || "").split("\n").slice(0, 8),
    });
  }
};
