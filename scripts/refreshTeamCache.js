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
function buildPayload(teamId, text) {
  return {
    teamId,
    status: "ACTIVE",
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
