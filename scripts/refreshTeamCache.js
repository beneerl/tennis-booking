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

// Erstmal nur als Beweis, dass die Pipeline funktioniert.
// Danach ersetzen wir das durch extractMatches/extractTable.
function parseRanking(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Find header line that starts with "Rang Mannschaft"
  const headerIdx = lines.findIndex((l) => l.toLowerCase().startsWith("rang mannschaft"));
  if (headerIdx === -1) return [];

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];

    // Stop when schedule section begins (Termin/Heimmannschaft...) or "Spielleiter"
    if (line.toLowerCase().includes("termin") && line.toLowerCase().includes("heimmannschaft")) break;
    if (line.toLowerCase().startsWith("spielleiter")) break;

    // Example:
    // 1 TC Waging am See (02378) 4 8:0 21:3 44:7 277:104
    const m = line.match(
      /^(\d+)\s+(.+?)\s+(\d+)\s+(\d+:\d+)\s+(\d+:\d+)\s+(\d+:\d+)\s+(\d+:\d+)\s*$/
    );
    if (m) {
      rows.push({
        rang: Number(m[1]),
        mannschaft: m[2],
        begegnungen: Number(m[3]),
        punkte: m[4],
        matches: m[5],
        saetze: m[6],
        spiele: m[7],
      });
    }
  }
  return rows;
}

function parseMatches(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Find header line for schedule
  const headerIdx = lines.findIndex(
    (l) =>
      l.toLowerCase().includes("termin") &&
      l.toLowerCase().includes("heimmannschaft") &&
      l.toLowerCase().includes("gastmannschaft")
  );
  if (headerIdx === -1) return [];

  const matches = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];

    if (line.toLowerCase().startsWith("spielleiter")) break;

    // Example:
    // So. 05.10.2025 15:00   TeG Alzstadt   TC Rimsting II   2:4
    const m = line.match(
      /^(Mo\.|Di\.|Mi\.|Do\.|Fr\.|Sa\.|So\.)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})\s+(.+?)\s{2,}(.+?)\s{2,}(\d+:\d+)\s*$/
    );

    if (m) {
      matches.push({
        wochentag: m[1],
        datum: m[2],
        uhrzeit: m[3],
        heim: m[4],
        gast: m[5],
        erg: m[6],
      });
      continue;
    }

    // Hallen-Info-Zeilen mitnehmen, falls du willst (optional)
    if (matches.length && line.toLowerCase().startsWith("halle:")) {
      matches[matches.length - 1].halle = line.replace(/^halle:\s*/i, "");
    }
  }

  return matches;
}

function computeNextMatches(matches) {
  // naive: first 3, später sortieren nach Datum
  return matches.slice(0, 3);
}

function buildPayload(teamId, text) {
  const table = parseRanking(text);
  const matches = parseMatches(text);

  const status = table.length || matches.length ? "ACTIVE" : "PENDING";

  return {
    teamId,
    status,
    table,
    matches,
    next_matches: computeNextMatches(matches),
    text_preview: text.slice(0, 2000), // kannst du später rauswerfen
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
