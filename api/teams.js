// api/teams.js
// /api/teams?teamId=herren_w1
// Strategy:
// 1) Fetch stable PDF (ScheduleReportFOP)
// 2) Extract nuLiga groupPage URL from PDF bytes via regex (no PDF parsing)
// 3) Fetch nuLiga groupPage HTML
// 4) Parse ranking + matches tables with cheerio

const cheerio = require("cheerio");

const TEAM_MAP = {
  herren_w1: {
    pdf_url:
      "https://btv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument?dokument=ScheduleReportFOP&group=2115082",
  },
};

function normalizeSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function parseHtmlTables($) {
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
}

function guessRankingTable(allTables) {
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
}

function guessMatchesTable(allTables) {
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
}

function tableToObjects(table) {
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

// Extract nuLiga groupPage URL from PDF binary text
function extractGroupPageUrlFromPdfBytes(pdfBytes, fallbackGroupId) {
  // Many PDFs contain full URLs as plain text
  const s = Buffer.from(pdfBytes).toString("latin1");

  // 1) try full URL
  let m = s.match(/https?:\/\/[a-z0-9.-]+\/cgi-bin\/WebObjects\/nuLigaTENDE\.woa\/wa\/groupPage\?[^"'<> \r\n]+/i);
  if (m && m[0]) return m[0];

  // 2) try relative URL
  m = s.match(/\/cgi-bin\/WebObjects\/nuLigaTENDE\.woa\/wa\/groupPage\?[^"'<> \r\n]+/i);
  if (m && m[0]) return `https://btv.liga.nu${m[0]}`;

  // 3) last resort: sometimes only championship appears, build url
  // If we can find championship=... inside PDF, we can build the URL.
  const c = s.match(/championship=([A-Za-z0-9+.%/_ -]+)/i);
  if (c && c[1] && fallbackGroupId) {
    const champ = c[1];
    return `https://btv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/groupPage?championship=${champ}&group=${fallbackGroupId}`;
  }

  return null;
}

module.exports = async (req, res) => {
  const t0 = Date.now();
  const log = (m) => console.log(`[teams] +${Date.now() - t0}ms ${m}`);

  try {
    const teamId = req.query.teamId;
    if (!teamId) return res.status(400).json({ error: "missing_teamId" });

    const cfg = TEAM_MAP[teamId];
    if (!cfg) return res.status(404).json({ error: "unknown_teamId", teamId });

    // 1) fetch PDF (stable)
    log("fetch pdf");
    const pdfResp = await fetch(cfg.pdf_url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!pdfResp.ok) {
      return res.status(502).json({ error: "pdf_fetch_failed", status: pdfResp.status, pdf_url: cfg.pdf_url });
    }
    const ab = await pdfResp.arrayBuffer();
    const pdfBytes = new Uint8Array(ab);
    log(`pdf bytes=${pdfBytes.byteLength}`);

    // 2) extract nuLiga HTML URL from PDF bytes
    log("extract groupPage url from pdf bytes");
    const groupPageUrl = extractGroupPageUrlFromPdfBytes(pdfBytes, "2115082");
    if (!groupPageUrl) {
      return res.status(200).json({
        ok: false,
        status: "PENDING",
        reason: "groupPage_url_not_found_in_pdf",
        pdf_url: cfg.pdf_url,
      });
    }

    // 3) fetch nuLiga HTML
    log(`fetch nuLiga html: ${groupPageUrl}`);
    const htmlResp = await fetch(groupPageUrl, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept-language": "de-DE,de;q=0.9,en;q=0.8",
        // sometimes helps:
        referer: "https://btv.liga.nu/",
      },
      redirect: "follow",
    });
    const html = await htmlResp.text();

    if (!htmlResp.ok || html.length < 500) {
      return res.status(502).json({
        error: "nuliga_html_fetch_failed",
        status: htmlResp.status,
        groupPageUrl,
        preview: html.slice(0, 400),
      });
    }

    // 4) parse tables
    log("parse html tables");
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
      source: {
        pdf_url: cfg.pdf_url,
        groupPageUrl,
      },
      ms: Date.now() - t0,
      parsed: {
        tables_found: allTables.length,
        used_ranking_table: !!rankingTable,
        used_matches_table: !!matchesTable,
      },
      table,
      matches,
      next_matches: matches.slice(0, 3),
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
