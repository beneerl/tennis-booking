const { createClient } = require("@supabase/supabase-js");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TEAM_MAP = {
  herren_w1: {
    team_id: "herren_w1",
    pdf_url:
      "https://btv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument?dokument=ScheduleReportFOP&group=2115082",
  },
};

function ensurePdftotext() {
  try {
    execSync("pdftotext -v", { stdio: "ignore" });
  } catch {
    console.log("pdftotext not found -> installing poppler-utils");
    execSync("sudo apt-get update && sudo apt-get install -y poppler-utils", {
      stdio: "inherit",
    });
  }
}

async function download(url, outPath) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`Download failed ${r.status} for ${url}`);
  const ab = await r.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(ab));
}

function pdfToText(pdfPath) {
  const txtPath = pdfPath.replace(/\.pdf$/i, ".txt");
  execSync(`pdftotext -layout "${pdfPath}" "${txtPath}"`, { stdio: "inherit" });
  return fs.readFileSync(txtPath, "utf8");
}

function isDowStart(line) {
  return /^(Mo\.|Di\.|Mi\.|Do\.|Fr\.|Sa\.|So\.)\s+\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}/.test(
    line.trim()
  );
}

// --------------- PARSE TABLE (Ranking) ---------------
function parseRanking(text) {
  const lines = text.split(/\r?\n/);

  const headerIdx = lines.findIndex((l) =>
    l.trim().toLowerCase().startsWith("rang mannschaft")
  );
  if (headerIdx === -1) return [];

  const rows = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const lower = line.toLowerCase();
    if (!line) continue;

    if (lower.startsWith("spielleiter")) break;
    if (lower.startsWith("btv-hotline")) break;

    // We extract ranking row by matching from start up to "Spiele" (last score like 277:104)
    // This survives if schedule text continues on the right.
    const m = line.match(
      /^(\d+)\s+(.+?)\s+(\d+)\s+(\d+:\d+)\s+(\d+:\d+)\s+(\d+:\d+)\s+(\d+:\d+)\b/
    );
    if (!m) continue;

    rows.push({
      rang: Number(m[1]),
      mannschaft: m[2].trim(),
      begegnungen: Number(m[3]),
      punkte: m[4],
      matches: m[5],
      saetze: m[6],
      spiele: m[7],
    });
  }

  return rows;
}


// --------------- PARSE MATCHES ---------------
function parseMatches(text, teamNames) {
  const lines = text.split(/\r?\n/);

  const teams = [...teamNames].sort((a, b) => b.length - a.length);

  const matches = [];
  const seen = new Set();

  // Find matches anywhere in the text (even if embedded in ranking lines)
  // Example chunk: "So. 05.10.2025 15:00   TeG Alzstadt   TC Rimsting II          2:4"
  const matchRe =
    /(Mo\.|Di\.|Mi\.|Do\.|Fr\.|Sa\.|So\.)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})\s+(.+?)\s+(\d+:\d+)/g;

  for (const raw of lines) {
    // capture hall line for "last match" if present
    const lineTrim = raw.trim();
    if (matches.length && /^Halle:\s*/i.test(lineTrim)) {
      matches[matches.length - 1].halle = lineTrim.replace(/^halle:\s*/i, "").trim();
      continue;
    }

    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;

    let m;
    while ((m = matchRe.exec(line)) !== null) {
      const wochentag = m[1];
      const datum = m[2];
      const uhrzeit = m[3];

      // m[4] contains "Heim Gast" (with collapsed spaces); m[5] is result
      const rest = m[4].trim();
      const erg = m[5];

      // Determine gast by matching a known team at the end
      let gast = null;
      let heim = null;

      for (const t of teams) {
        const tNorm = t.replace(/\s+/g, " ").trim();
        if (rest.endsWith(tNorm)) {
          gast = tNorm;
          heim = rest.slice(0, rest.length - tNorm.length).trim();
          break;
        }
      }

      // If still unknown, do a fallback split (not perfect but better than nothing)
      if (!gast || !heim) {
        const parts = rest.split(" ");
        heim = parts.slice(0, Math.max(1, Math.floor(parts.length / 2))).join(" ");
        gast = parts.slice(Math.max(1, Math.floor(parts.length / 2))).join(" ");
      }

      const key = `${datum}|${uhrzeit}|${heim}|${gast}|${erg}`;
      if (seen.has(key)) continue;
      seen.add(key);

      matches.push({ wochentag, datum, uhrzeit, heim, gast, erg });
    }
    matchRe.lastIndex = 0;
  }

  return matches;
}


function computeNextMatches(matches) {
  const toTs = (m) => {
    const [dd, mm, yyyy] = (m.datum || "").split(".");
    const [hh, mi] = (m.uhrzeit || "00:00").split(":");
    const dt = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
    const ts = dt.getTime();
    return Number.isNaN(ts) ? Infinity : ts;
  };

  const sorted = [...matches].sort((a, b) => toTs(a) - toTs(b));
  return sorted.slice(0, 3);
}

function buildPayload(teamId, text) {
  const table = parseRanking(text);
  const teamNames = table.map((r) => r.mannschaft);

  const matches = parseMatches(text, teamNames);
  const status = table.length || matches.length ? "ACTIVE" : "PENDING";

  return {
    teamId,
    status,
    table,
    matches,
    next_matches: computeNextMatches(matches),
    text_preview: text.slice(0, 2000),
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key);

  ensurePdftotext();

  const tmpDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const [teamId, cfg] of Object.entries(TEAM_MAP)) {
    console.log(`Refreshing ${teamId}...`);
    const pdfPath = path.join(tmpDir, `${teamId}.pdf`);

    await download(cfg.pdf_url, pdfPath);
    const text = pdfToText(pdfPath);

    const payload = buildPayload(teamId, text);

    console.log("payload keys:", Object.keys(payload));
    console.log("table len:", payload.table.length, "matches len:", payload.matches.length);

    const { error } = await supabase.from("team_cache").upsert({
      team_id: teamId,
      payload_json: payload,
      status: payload.status,
      source_url: cfg.pdf_url,
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    console.log(`✅ Updated cache for ${teamId}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
