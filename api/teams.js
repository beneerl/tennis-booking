// api/teams.js
// /api/teams?teamId=herren_w1
// Strategy:
// 1) Fetch BTV page (groupid=...)
// 2) Extract nuLiga groupPage URL from HTML (regex)
// 3) Fetch nuLiga groupPage HTML
// 4) Parse tables (ranking + matches) with cheerio
//
// NOTE: First get it working without Supabase cache. Add cache after we see good JSON.

const cheerio = require("cheerio");

const TEAM_MAP = {
  herren_w1: {
    // your stable entrypoint
    btv_url: "https://www.btv.de/de/spielbetrieb/tabelle-spielplan.html?groupid=2115082",
  },
};

function pickFirstNonEmpty(arr) {
  return arr.find((x) => typeof x === "string" && x.trim().length > 0) || null;
}

function normalizeSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Try to find a nuLiga groupPage URL inside the BTV HTML
function extractNuLigaGroupPageUrl(btvHtml) {
  // typical patterns we saw on the web:
  // .../cgi-bin/WebObjects/nuLigaTENDE.woa/wa/groupPage?championship=...&group=...
  const re = /https?:\/\/[a-z0-9.-]+\/cgi-bin\/WebObjects\/nuLigaTENDE\.woa\/wa\/groupPage\?[^"'<> ]+/gi;
  const matches = btvHtml.match(re);
  if (matches && matches.length) return matches[0];

  // sometimes relative (rare)
  const reRel = /\/cgi-bin\/WebObjects\/nuLigaTENDE\.woa\/wa\/groupPage\?[^"'<> ]+/i;
  const rel = btvHtml.match(reRel);
  if (rel && rel[0]) return `https://btv.liga.nu${rel[0]}`;

  return null;
}

function parseHtmlTables($) {
  // Returns all HTML tables as arrays of row arrays
  const tables = [];
  $("table").each((_, table) => {
    const rows = [];
    $(table)
      .find("tr")
      .each((__, tr) => {
        const cells = [];
        $(tr)
          .find("th,td")
          .each((___, td) => {
            cells.push(normalizeSpace($(td).text()));
          });
        if (cells.some((c) => c.length)) rows.push(cells);
      });
    if (rows.length) tables.push(rows);
  });
  return tables;
}

function guessRankingTable(allTables) {
  // Heuristic: ranking table often contains headers like "Rang" + "Mannschaft" + "Begegnungen"
  for (const t of allTables) {
    const headerRow = t[0] || [];
    const header = headerRow.join(" | ").toLowerCase();
    if (
      header.includes("rang") &&
      header.includes("mannschaft") &&
      (header.includes("begegnungen") || header.includes("punkte"))
    ) {
      return t;
    }
  }
  return null;
}

function guessMatchesTable(allTables) {
  // Heuristic: matches table often contains "Datum" or "Heim" "Gast" or "Begegnung"
  for (const t of allTables) {
    const headerRow = t[0] || [];
    const header = headerRow.join(" | ").toLowerCase();
    if (
      header.includes("datum") ||
      header.includes("uhr") ||
      header.includes("begegn") ||
      (header.includes("heim") && header.includes("gast"))
    ) {
      return t;
    }
  }
  return null;
}

function tableToObjects(table) {
  // Convert rows to objects using header row
  if (!table || table.length < 2) return [];
  const headers = table[0].map((h) => normalizeSpace(h).toLowerCase());
  return table.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h || `col_${i}`] = row[i] ?? "";
    });
    return obj;
  });
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  const log = (m) => console.log(`[teams] +${Date.now() - t0}ms ${m}`);

  try {
    const teamId = req.query.teamId;
    if (!teamId) return res.status(400).json({ error: "missing_teamId" });

    const cfg = TEAM_MAP[teamId];
    if (!cfg) return res.status(404).json({ error: "unknown_teamId", teamId });

    // 1) Fetch BTV html
    log("fetch btv page");
    const btvResp = await fetch(cfg.btv_url, {
      headers: { "user-agent": "Mozilla/5.0" },
    });
    const btvHtml = await btvResp.text();

    // 2) Extract nuLiga groupPage url
    log("extract nuLiga url");
    const nuLigaUrl = extractNuLigaGroupPageUrl(btvHtml);

    if (!nuLigaUrl) {
      log("nuLiga url not found in HTML -> scan scripts");

      // collect script src
      const $btv = cheerio.load(btvHtml);
      const scriptSrcs = [];
      $btv("script[src]").each((_, el) => {
        const src = $btv(el).attr("src");
        if (src) scriptSrcs.push(src);
      });

      // make absolute URLs
      const abs = scriptSrcs
        .map((s) => (s.startsWith("http") ? s : new URL(s, cfg.btv_url).toString()))
        // ignore obvious third-party analytics/cookie
        .filter(
          (u) =>
            !u.includes("cookiebot") &&
            !u.includes("matomo") &&
            !u.includes("google") &&
            !u.includes("gstatic")
        )
        .slice(0, 6); // keep it small

      const findings = [];

      for (const jsUrl of abs) {
        try {
          log(`fetch js: ${jsUrl}`);
          const jsResp = await fetch(jsUrl, { headers: { "user-agent": "Mozilla/5.0" } });
          const jsText = await jsResp.text();

          // look for promising patterns
          const patterns = [
            "nuLigaTENDE.woa/wa/groupPage",
            "btv.liga.nu",
            "nuLigaDokumentTENDE",
            "groupid",
            "group=",
            "championship=",
            "wa/groupPage",
            "wa/nuDokument",
            "tabelle",
            "spielplan",
          ];

          const hits = patterns.filter((p) => jsText.includes(p));
          if (hits.length) {
            findings.push({
              jsUrl,
              status: jsResp.status,
              hits,
              snippet: jsText.slice(0, 800),
            });

            // also try to extract a full nuLiga URL directly
            const direct = jsText.match(
              /https?:\/\/[a-z0-9.-]+\/cgi-bin\/WebObjects\/nuLigaTENDE\.woa\/wa\/groupPage\?[^"'<> ]+/i
            );
            if (direct && direct[0]) {
              return res.status(200).json({
                ok: true,
                status: "ACTIVE",
                found: "nuLiga_url_in_js",
                nuLiga_groupPage_url: direct[0],
                jsUrl,
              });
            }
          }
        } catch (e) {
          findings.push({ jsUrl, error: e.message || String(e) });
        }
      }

      return res.status(200).json({
        ok: false,
        status: "PENDING",
        reason: "nuLiga_url_not_found_in_btv_html_or_first_js",
        btv_url: cfg.btv_url,
        scripts_checked: abs,
        findings,
      });
    }


    // 3) Fetch nuLiga group page html
    log("fetch nuLiga groupPage");
    const nuResp = await fetch(nuLigaUrl, {
      headers: { "user-agent": "Mozilla/5.0" },
    });
    const nuHtml = await nuResp.text();

    // 4) Parse nuLiga page
    log("parse nuLiga html");
    const $ = cheerio.load(nuHtml);
    const title = normalizeSpace($("h1").first().text()) || normalizeSpace($("title").text());

    const allTables = parseHtmlTables($);
    const rankingTable = guessRankingTable(allTables);
    const matchesTable = guessMatchesTable(allTables);

    const table = rankingTable ? tableToObjects(rankingTable) : [];
    const matches = matchesTable ? tableToObjects(matchesTable) : [];

    // Status logic (simple):
    // If we have neither table nor matches, treat as PENDING
    const status = table.length || matches.length ? "ACTIVE" : "PENDING";

    // next_matches: take first 3 rows that look like future fixtures (best-effort)
    const next_matches = matches.slice(0, 3);

    return res.status(200).json({
      ok: true,
      teamId,
      status,
      title,
      source: {
        btv_url: cfg.btv_url,
        nuLiga_groupPage_url: nuLigaUrl,
      },
      last_updated: new Date().toISOString(),
      ms: Date.now() - t0,
      parsed: {
        tables_found: allTables.length,
        used_ranking_table: !!rankingTable,
        used_matches_table: !!matchesTable,
      },
      table,
      matches,
      next_matches,
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
