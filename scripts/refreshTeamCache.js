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

function parseRanking(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length);

  const headerIdx = lines.findIndex((l) =>
    l.toLowerCase().startsWith("rang mannschaft")
  );
  if (headerIdx === -1) return [];

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Stop when schedule header begins or footer
    if (
      lower.includes("termin") &&
      lower.includes("heimmannschaft") &&
      lower.includes("gastmannschaft")
    )
      break;
    if (lower.startsWith("spielleiter")) break;
    if (lower.startsWith("btv-hotline")) break;

    // Robust parse: split tokens; last 5 tokens are numeric/scores
    const parts = line.split(/\s+/);
    if (parts.length < 8) continue;

    if (!/^\d+$/.test(parts[0])) continue;

    const rang = Number(parts[0]);
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

function parseMatches(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length);

  const headerIdx = lines.findIndex((l) => {
    const s = l.toLowerCase();
    return (
      s.includes("termin") &&
      s.includes("heimmannschaft") &&
      s.includes("gastmannschaft")
    );
  });
  if (headerIdx === -1) return [];

  const matches = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    if (lower.startsWith("spielleiter")) break;
    if (lower.startsWith("btv-hotline")) break;

    // normalize spacing (pdftotext -layout creates weird gaps)
    const s = line.replace(/\s+/g, " ").trim();

    // Example:
    // "So. 05.10.2025 15:00 TeG Alzstadt TC Rimsting II 2:4"
    const m = s.match(
      /^(Mo\.|Di\.|Mi\.|Do\.|Fr\.|Sa\.|So\.)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})\s+(.+?)\s+(.+?)\s+(\d+:\d+)\s*$/
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

    // Hallen-Info: attach to previous match if present
    if (matches.length && lower.startsWith("halle:")) {
      matches[matches.length - 1].halle = line.replace(/^halle:\s*/i, "").trim();
    }
  }

  return matches;
}

function computeNextMatches(matches) {
  // Sort by date+time (dd.mm.yyyy)
  const toTs = (m) => {
    const [dd, mm, yyyy] = (m.datum || "").split(".");
    const time = (m.uhrzeit || "00:00").split(":");
    const dt = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(time[0]),
      Number(time[1])
    );
    const ts = dt.getTime();
    return Number.isNaN(ts) ? Infinity : ts;
  };

  const sorted = [...matches].sort((a, b) => toTs(a) - toTs(b));
  return sorted.slice(0, 3);
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
    text_preview: text.slice(0, 2000),
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

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

    // Optional debug:
    console.log("payload keys:", Object.keys(payload));
    console.log(
      "table len:",
      payload.table?.length,
      "matches len:",
      payload.matches?.length
    );

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
