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

    // stop when schedule lines begin
    if (isDowStart(line)) break;

    // IMPORTANT: Some PDFs merge ranking + schedule into one line.
    // We only take the "ranking part" BEFORE any weekday token appears.
    // Example merged line contains: " ... 277:104   So. 05.10.2025 15:00 ..."
    const cut = line.replace(/\s+(Mo\.|Di\.|Mi\.|Do\.|Fr\.|Sa\.|So\.)\s+.*/, "");
    const parts = cut.split(/\s+/);

    if (parts.length < 8) continue;
    if (!/^\d+$/.test(parts[0])) continue;

    const rang = Number(parts[0]);

    // last 5 tokens should be: Beg. Punkte Matches Sätze Spiele
    const spiele = parts[parts.length - 1];
    const saetze = parts[parts.length - 2];
    const matches = parts[parts.length - 3];
    const punkte = parts[parts.length - 4];
    const begegnungen = parts[parts.length - 5];

    const isScore = (s) => /^\d+:\d+$/.test(s);

    if (
      /^\d+$/.test(begegnungen) &&
      isScore(punkte) &&
      isScore(matches) &&
      isScore(saetze) &&
      isScore(spiele)
    ) {
      const mannschaft = parts.slice(1, parts.length - 5).join(" ");
      rows.push({
        rang,
        mannschaft,
        begegnungen: Number(begegnungen),
        punkte,
        matches,
        saetze,
        spiele,
      });
    }
  }

  return rows;
}

// --------------- PARSE MATCHES ---------------
function parseMatches(text, teamNames) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));

  // Sort team names longest-first so matching works properly
  const teams = [...teamNames].sort((a, b) => b.length - a.length);

  const matches = [];
  let inSchedule = false;

  for (const raw of lines) {
    const line = raw.trim();
    const lower = line.toLowerCase();
    if (!line) continue;

    if (
      lower.includes("termin") &&
      lower.includes("heimmannschaft") &&
      lower.includes("gastmannschaft")
    ) {
      inSchedule = true;
      continue;
    }
    if (!inSchedule) continue;

    if (lower.startsWith("spielleiter")) break;
    if (lower.startsWith("btv-hotline")) break;

    // Hallen line
    if (matches.length && lower.startsWith("halle:")) {
      matches[matches.length - 1].halle = line.replace(/^halle:\s*/i, "").trim();
      continue;
    }

    // Match line must start with DOW + date + time
    const head = line.match(
      /^(Mo\.|Di\.|Mi\.|Do\.|Fr\.|Sa\.|So\.)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})\s+(.+)$/
    );
    if (!head) continue;

    const wochentag = head[1];
    const datum = head[2];
    const uhrzeit = head[3];
    let rest = head[4];

    // cut off trailing result "2:4"
    const resMatch = rest.match(/(.+?)\s+(\d+:\d+)\s*$/);
    if (!resMatch) continue;

    rest = resMatch[1].trim();
    const erg = resMatch[2];

    // Try to identify "gast" as one of the known team names at the END of rest
    let gast = null;
    let heim = null;

    for (const t of teams) {
      if (rest.endsWith(t)) {
        gast = t;
        heim = rest.slice(0, rest.length - t.length).trim();
        break;
      }
    }

    // Fallback if not found: split by multiple spaces from original raw line (layout)
    if (!gast || !heim) {
      const mid = head[4].replace(/\s+(\d+:\d+)\s*$/, "").trim(); // before erg
      const chunks = mid.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
      if (chunks.length >= 2) {
        // try last two chunks
        heim = chunks[chunks.length - 2];
        gast = chunks[chunks.length - 1];
      } else {
        // last fallback: cannot reliably split
        heim = mid;
        gast = "";
      }
    }

    matches.push({ wochentag, datum, uhrzeit, heim, gast, erg });
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
