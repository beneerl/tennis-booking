// api/teams.js
// Endpoint: /api/teams?teamId=herren_w1
//
// Goal (this version): Find an HTML (NOT PDF) representation of the nuLiga report,
// by trying common "format/view/output" parameters on the stable nuDokument URL.
// If we find HTML, we return a preview so we can implement cheerio parsing next.
// If we only get PDF, we report that clearly.
//
// NOTE: This version intentionally does NOT parse PDF.

const TEAM_MAP = {
  herren_w1: {
    groupId: "2115082",
    // stable PDF/report endpoint you already have
    reportBase:
      "https://btv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument?dokument=ScheduleReportFOP&group=2115082",
  },
};

module.exports = async (req, res) => {
  const t0 = Date.now();
  const log = (m) => console.log(`[teams] +${Date.now() - t0}ms ${m}`);

  try {
    const teamId = req.query.teamId;
    if (!teamId) return res.status(400).json({ error: "missing_teamId" });

    const cfg = TEAM_MAP[teamId];
    if (!cfg) return res.status(404).json({ error: "unknown_teamId", teamId });

    const reportBase = cfg.reportBase;

    // Try common variants that (depending on nuLiga config) may return HTML instead of PDF.
    const candidates = [
      reportBase,
      `${reportBase}&format=html`,
      `${reportBase}&view=html`,
      `${reportBase}&output=html`,
      `${reportBase}&export=html`,
      `${reportBase}&filetype=html`,
      `${reportBase}&contentType=text/html`,
      `${reportBase}&type=html`,
      `${reportBase}&as=html`,
      `${reportBase}&mime=text/html`,
    ];

    const results = [];

    for (const url of candidates) {
      log(`try: ${url}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      let r;
      try {
        r = await fetch(url, {
          headers: {
            "user-agent": "Mozilla/5.0",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "de-DE,de;q=0.9,en;q=0.8",
          },
          redirect: "follow",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const contentType =
        (typeof r.headers?.get === "function" && r.headers.get("content-type")) || "";

      // Read a small preview safely (works for HTML; for PDF we won't read the whole thing)
      let preview = "";
      if (contentType.includes("text/html")) {
        const html = await r.text();
        preview = html.slice(0, 900);

        // Found HTML -> return immediately with preview
        return res.status(200).json({
          ok: true,
          teamId,
          found: "html_report",
          picked_url: url,
          status_code: r.status,
          contentType,
          ms: Date.now() - t0,
          html_preview: preview,
          next_step:
            "If preview contains schedule/table HTML, we will parse it with cheerio into matches/table JSON + add Supabase caching.",
        });
      }

      // For PDFs (or other types), just record status/type and continue.
      results.push({
        url,
        status_code: r.status,
        contentType,
      });
    }

    // If we reach here, none of the candidates returned HTML.
    return res.status(200).json({
      ok: false,
      teamId,
      reason: "no_html_variant_found",
      ms: Date.now() - t0,
      reportBase,
      tried: results,
      note:
        "All variants returned non-HTML (likely PDF only). If so, we must either (1) parse PDF outside Vercel with a dedicated worker, or (2) locate an alternate nuLiga export endpoint (CSV/HTML) for this league.",
    });
  } catch (err) {
    console.error("[teams] error:", err);
    return res.status(500).json({
      error: "internal_error",
      message: err?.message || String(err),
      stack: (err?.stack || "").split("\n").slice(0, 8),
    });
  }
};
