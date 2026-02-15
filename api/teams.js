const pdfParse = require("pdf-parse");
const { createClient } = require("@supabase/supabase-js");

const TEAM_MAP = {
  herren_w1: {
    source_url:
      "https://btv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument?dokument=ScheduleReportFOP&group=2115082",
  },
};

const TTL_MINUTES = 60;

module.exports = async (req, res) => {
  const t0 = Date.now();
  const log = (msg) => console.log(`[teams] +${Date.now() - t0}ms ${msg}`);

  try {
    const teamId = req.query.teamId;
    if (!teamId) return res.status(400).json({ error: "missing_teamId" });

    const teamCfg = TEAM_MAP[teamId];
    if (!teamCfg) return res.status(404).json({ error: "unknown_teamId", teamId });

    // --- Supabase admin client ---
    const hasEnv = {
      hasUrl: !!process.env.SUPABASE_URL,
      hasService: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    if (!hasEnv.hasUrl || !hasEnv.hasService) {
      return res.status(500).json({ error: "missing_env", ...hasEnv });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // --- Cache first ---
    log("cache read");
    const { data: cacheRow, error: cacheErr } = await supabase
      .from("team_cache")
      .select("team_id, payload_json, status, source_url, updated_at")
      .eq("team_id", teamId)
      .maybeSingle();

    if (cacheErr) log(`cache read error: ${cacheErr.message}`);

    const isFresh =
      cacheRow?.updated_at &&
      Date.now() - new Date(cacheRow.updated_at).getTime() < TTL_MINUTES * 60 * 1000;

    if (cacheRow && isFresh) {
      log("return fresh cache");
      return res.status(200).json({
        ...cacheRow.payload_json,
        status: cacheRow.status,
        source_url: cacheRow.source_url,
        last_updated: cacheRow.updated_at,
        cache: "HIT",
      });
    }

    // --- Fetch PDF with timeout ---
    log("fetch pdf");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const r = await fetch(teamCfg.source_url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!r.ok) {
      return res.status(502).json({
        error: "pdf_fetch_failed",
        status: r.status,
        source_url: teamCfg.source_url,
      });
    }

    const ab = await r.arrayBuffer();
    log(`pdf bytes=${ab.byteLength}`);

    // --- Parse PDF ---
    log("pdf-parse start");
    const parsed = await pdfParse(Buffer.from(ab));
    log(`pdf-parse done textLen=${parsed.text?.length || 0}`);

    // TODO: hier setzt du DEINE extractTable / extractMatches Logik ein:
    const payload = {
      teamId,
      status: "ACTIVE",
      table: [],       // extractTable(parsed.text)
      matches: [],     // extractMatches(parsed.text)
      next_matches: [],// aus matches berechnen
    };

    // --- Upsert cache ---
    log("cache upsert");
    const { error: upErr } = await supabase
      .from("team_cache")
      .upsert({
        team_id: teamId,
        payload_json: payload,
        status: payload.status,
        source_url: teamCfg.source_url,
        updated_at: new Date().toISOString(),
      });

    if (upErr) {
      log(`cache upsert error: ${upErr.message}`);
      // Trotzdem Payload zurückgeben – API soll nicht wegen Cache sterben
    }

    log("return payload");
    return res.status(200).json({
      ...payload,
      source_url: teamCfg.source_url,
      last_updated: new Date().toISOString(),
      cache: "MISS",
    });
  } catch (err) {
    console.error("[teams] fatal:", err);
    return res.status(500).json({
      error: "internal_error",
      detail: err?.message || String(err),
    });
  }
};
