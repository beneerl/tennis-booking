// api/teams.js
// /api/teams?teamId=herren_w1
// Plan C: create session on btv.liga.nu, then fetch groupPage with cookies

const TEAM_MAP = {
  herren_w1: {
    groupId: "2115082",
  },
};

function pickSetCookies(headers) {
  // Node fetch may expose multiple set-cookie headers differently depending on runtime
  const raw = headers.raw?.()["set-cookie"];
  if (raw && Array.isArray(raw) && raw.length) return raw;

  const single = headers.get("set-cookie");
  if (single) return [single];

  return [];
}

function cookiesToHeader(setCookies) {
  // Keep only "name=value"
  return setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  const log = (m) => console.log(`[teams] +${Date.now() - t0}ms ${m}`);

  try {
    const teamId = req.query.teamId;
    if (!teamId) return res.status(400).json({ error: "missing_teamId" });

    const cfg = TEAM_MAP[teamId];
    if (!cfg) return res.status(404).json({ error: "unknown_teamId", teamId });

    // 1) Warmup request to create session + get cookies
    const homeUrl = "https://btv.liga.nu/";
    log("warmup session");
    const homeResp = await fetch(homeUrl, {
      headers: { "user-agent": "Mozilla/5.0" },
      redirect: "follow",
    });

    const setCookies = pickSetCookies(homeResp.headers);
    const cookieHeader = cookiesToHeader(setCookies);

    log(`cookies found=${setCookies.length}`);

    // 2) Try different groupPage URL variants (some installs want group=, some groupid=)
    const candidates = [
      `https://btv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/groupPage?group=${encodeURIComponent(
        cfg.groupId
      )}`,
      `https://btv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/groupPage?groupid=${encodeURIComponent(
        cfg.groupId
      )}`,
      // sometimes works as "competitionPage"
      `https://btv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/competitionPage?group=${encodeURIComponent(
        cfg.groupId
      )}`,
    ];

    // 3) Fetch candidates with cookies + referer
    for (const url of candidates) {
      log(`try url: ${url}`);
      const r = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0",
          referer: homeUrl,
          cookie: cookieHeader,
          "accept-language": "de-DE,de;q=0.9,en;q=0.8",
        },
        redirect: "follow",
      });

      const html = await r.text();
      const preview = html.slice(0, 600);

      // Heuristic: forbidden call pages are tiny and contain "Forbidden Call"
      const isForbidden =
        preview.toLowerCase().includes("forbidden") ||
        preview.toLowerCase().includes("forbidden call");

      // Heuristic: nuLiga pages usually contain "nuLiga" / tables / forms
      const looksLikeNuLiga =
        html.length > 2000 &&
        (html.includes("nuLiga") ||
          html.includes("WebObjects") ||
          html.includes("table") ||
          html.includes("wa/"));

      if (!isForbidden && looksLikeNuLiga) {
        const cheerio = require("cheerio");

        const normalizeSpace = (s) => (s || "").replace(/\s+/g, " ").trim();

        const parseHtmlTables = ($) => {
          const tables = [];
          $("table").each((_, table) => {
            const rows = [];
            $(table)
              .find("tr")
              .each((__, tr) => {
                const cells = [];
                $(tr)
                  .find("th,td")
                  .each((___, td) => cells.push(normalizeSpace($(td).text())));
                if (cells.some((c) => c.length)) rows.push(cells);
              });
            if (rows.length) tables.push(rows);
          });
          return tables;
        };

        const guessRankingTable = (allTables) => {
          for (const t of allTables) {
            const header = (t[0] || []).join(" | ").toLowerCase();
            if (
              header.includes("rang") &&
              header.includes("mannschaft") &&
              (header.includes("punkte") || header.includes("begegn"))
            ) {
              return t;
            }
          }
          return null;
        };

        const guessMatchesTable = (allTables) => {
          for (const t of allTables) {
            const header = (t[0] || []).join(" | ").toLowerCase();
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
        };

        const tableToObjects = (table) => {
          if (!table || table.length < 2) return [];
          const headers = table[0].map((h) => normalizeSpace(h).toLowerCase());
          return table.slice(1).map((row) => {
            const obj = {};
            headers.forEach((h, i) => {
              obj[h || `col_${i}`] = row[i] ?? "";
            });
            return obj;
          });
        };

        log("parse html with cheerio");
        const $ = cheerio.load(html);

        const title =
          normalizeSpace($("h1").first().text()) || normalizeSpace($("title").text());

        const allTables = parseHtmlTables($);
        const rankingTable = guessRankingTable(allTables);
        const matchesTable = guessMatchesTable(allTables);

        const table = rankingTable ? tableToObjects(rankingTable) : [];
        const matches = matchesTable ? tableToObjects(matchesTable) : [];

        const status = table.length || matches.length ? "ACTIVE" : "PENDING";

        return res.status(200).json({
          ok: true,
          teamId,
          status,
          title,
          source_url: url,
          ms: Date.now() - t0,
          cookies_used: setCookies.length,
          parsed: {
            tables_found: allTables.length,
            used_ranking_table: !!rankingTable,
            used_matches_table: !!matchesTable,
          },
          table,
          matches,
          next_matches: matches.slice(0, 3),
        });

      }

      // keep debug info if none works
    }

    return res.status(200).json({
      ok: false,
      reason: "all_candidates_forbidden_or_not_nuliga",
      ms: Date.now() - t0,
      cookies_used: setCookies.length,
      candidates,
      hint: "Next step: inspect preview/status_code to adjust URL or headers",
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
