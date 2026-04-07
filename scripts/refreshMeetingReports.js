// scripts/refreshMeetingReports.js
const { createClient } = require("@supabase/supabase-js");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TEAM_MAP = {
  herren_w1: { team_id: "herren_w1", group_id: 2115082 },
  herren_s1: { team_id: "herren_s1", group_id: 2215966 },
  herren_s2: { team_id: "herren_s2", group_id: 2215959 },
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

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "de-DE,de;q=0.9,en;q=0.8",
    },
    redirect: "follow",
  });

  const text = await r.text();

  return {
    ok: r.ok,
    status: r.status,
    finalUrl: r.url,
    text,
    contentType: r.headers.get("content-type") || "",
  };
}

async function download(url, outPath) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, redirect: "follow" });
  if (!r.ok) throw new Error(`Download failed ${r.status} for ${url}`);
  const ab = await r.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(ab));
}

function pdfToText(pdfPath) {
  const txtPath = pdfPath.replace(/\.pdf$/i, ".txt");
  execSync(`pdftotext -layout "${pdfPath}" "${txtPath}"`, { stdio: "inherit" });
  return fs.readFileSync(txtPath, "utf8");
}

function toLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, " "))
    .map((l) => l.replace(/\t/g, " "))
    .map((l) => l.replace(/\s+$/g, ""));
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

// 1) Meeting IDs aus nuLiga HTML ziehen
// 1) Meeting IDs aus nuLiga HTML ziehen (robust)
async function fetchMeetingIdsForGroup(groupId) {
  const urls = [
    `https://btv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/groupPage?group=${groupId}`,
    `https://btv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/groupPage?group=${groupId}&page=matches`,
    `https://btv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/groupPage?group=${groupId}&page=results`,
    `https://btv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/groupPage?group=${groupId}&page=meetings`,
  ];

  for (const url of urls) {
    try {
     const html = String(await fetchText(url) || "");

// ✅ findet meeting=123… egal ob ?meeting=, &meeting= oder &amp;meeting=
const re = /(?:\?|&|&amp;)meeting=(\d{6,})/g;
const ids = [];

let m;
while ((m = re.exec(html)) !== null) {
  ids.push(m[1]);
}

if (ids.length) return uniq(ids);

      if (ids.length) return uniq(ids);

      // mini-debug (siehst du in Actions Logs), falls Seite was Unerwartetes liefert
      if (html.toLowerCase().includes("meeting=")) {
        console.log("page contains 'meeting=' but regex found 0 ->", url);
      }
    } catch (e) {
      console.log("meeting list fetch failed:", url, String(e));
    }
  }

  return [];
}

// ---- Parser: MeetingReportFOP PDF Text ----
function parseMeetingReportText(text) {
  const lines = toLines(text);

  // Termin oben
  const headerAll = lines.join(" ");
  const tMatch = headerAll.match(/Termin\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})/);
  const termin = tMatch ? { datum: tMatch[1], uhrzeit: tMatch[2] } : null;

  // Singles: Zeilen beginnen bei "1 21 10166719 ..."
  const singles = [];
  const playerIndex = {}; // name -> {id, lk} für Doppel-Mapping

  const singleRowRe =
    /^(\d+)\s+\d+\s+(\d+)\s+(.+?)\s+GER\s+\(LK\s*([0-9.,]+)\)\s+\d+\s+(\d+)\s+(.+?)\s+GER\s+\(LK\s*([0-9.,]+)\)\s+.*?\s+(\d)\s+(\d)\s+(\d)\s+(\d)\s+(\d+)\s+(\d+)\s*$/;

  let inSingles = false;
  let inDoubles = false;

  for (const line of lines) {
    if (line.trim() === "Einzel") { inSingles = true; inDoubles = false; continue; }
    if (line.trim() === "Doppel") { inDoubles = true; inSingles = false; continue; }
    if (line.includes("Einzel-Summe")) inSingles = false;

    if (inSingles) {
      const m = line.match(singleRowRe);
      if (!m) continue;

      const pos = Number(m[1]);
      const homeId = String(m[2]);
      const homeName = m[3].trim();
      const homeLK = Number(String(m[4]).replace(",", "."));

      const awayId = String(m[5]);
      const awayName = m[6].trim();
      const awayLK = Number(String(m[7]).replace(",", "."));

      const mpH = Number(m[8]);
      const mpA = Number(m[9]);

      const winner = mpH > mpA ? "home" : "away";

      playerIndex[homeName] = { id: homeId, lk: homeLK };
      playerIndex[awayName] = { id: awayId, lk: awayLK };

      singles.push({
        pos,
        home: { id: homeId, name: homeName, lk: homeLK },
        away: { id: awayId, name: awayName, lk: awayLK },
        winner,
      });
    }
  }

  // Doubles: MVP-parsing (Name-Mapping über Singles)
  // Struktur wie in deinem PDF:
  // "1 Fugger, Tobias GER 1 Rakowski, Dominik GER" (Start)
  // dann irgendwo "Eder, Stefan GER ..." und "Geiring, Ralph GER"
  // dann Score-Line: "6:1 6:2 0:0 1 0 2 0 12 3"
  const doubles = [];
  const dblStartRe = /^(\d+)\s+(.+?)\s+GER\s+\d+\s+(.+?)\s+GER\s*$/;
  const nameRe = /([A-Za-zÄÖÜäöüß\-]+,\s*[A-Za-zÄÖÜäöüß\-]+)\s+GER/;
  const scoreRe = /^\d+:\d+\s+\d+:\d+\s+\d+:\d+\s+(\d)\s+(\d)\s+(\d)\s+(\d)\s+(\d+)\s+(\d+)\s*$/;

  if (lines.some((l) => l.trim() === "Doppel")) {
    let cur = null;
    for (const line of lines) {
      if (line.trim() === "Doppel") { cur = null; continue; }
      if (!line.trim()) continue;

      const s = line.match(dblStartRe);
      if (s) {
        cur = {
          pos: Number(s[1]),
          home1: s[2].trim(),
          home2: null,
          away1: s[3].trim(),
          away2: null,
          winner: null,
        };
        continue;
      }

      if (!cur) continue;

      const sc = line.match(scoreRe);
      if (sc) {
        const mpH = Number(sc[1]);
        const mpA = Number(sc[2]);
        cur.winner = mpH > mpA ? "home" : "away";

        // IDs/LKs über Singles-Index (wenn möglich)
        const mapPlayer = (name) => {
          const p = playerIndex[name];
          return p ? { id: p.id, name, lk: p.lk } : { id: null, name, lk: null };
        };

        doubles.push({
          pos: cur.pos,
          home: [mapPlayer(cur.home1), mapPlayer(cur.home2)].filter((x) => x.name),
          away: [mapPlayer(cur.away1), mapPlayer(cur.away2)].filter((x) => x.name),
          winner: cur.winner,
        });

        cur = null;
        continue;
      }

      // names einsammeln für home2/away2
      const nm = line.match(nameRe);
      if (nm) {
        const n = nm[1].trim();
        if (n === cur.home1 || n === cur.away1) continue;
        if (!cur.home2) cur.home2 = n;
        else if (!cur.away2) cur.away2 = n;
      }
    }
  }

  return { termin, singles, doubles };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, key);
  ensurePdftotext();

  const tmpDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const cfg of Object.values(TEAM_MAP)) {
    const teamId = cfg.team_id;
    const groupId = cfg.group_id;

    console.log(`\n=== Meeting refresh for ${teamId} (group ${groupId}) ===`);

 // ---- START meeting refresh block ----

// 1) bisherige meeting_ids aus Index holen (pro Team 1 Zeile)
const { data: idxRow, error: idxErr } = await supabase
  .from("meeting_reports_index")
  .select("meeting_ids")
  .eq("team_id", teamId)
  .maybeSingle();

if (idxErr) throw idxErr;

const existingIds = Array.isArray(idxRow?.meeting_ids)
  ? idxRow.meeting_ids.map(String)
  : [];

// 2) aktuelle Meeting-IDs aus nuLiga holen
const meetingIds = (await fetchMeetingIdsForGroup(groupId)).map(String);
if (teamId === "herren_w1" && meetingIds.length === 0) {
  console.log("⚠️ DEBUG: no meetingIds found, using seed meetingId 12458500");
  meetingIds.push("12458500");
}

console.log(`found meeting ids: ${meetingIds.length}`);

const newIds = meetingIds.filter((id) => !existingIds.includes(id));
console.log(`new meeting ids: ${newIds.length}`);

// 3) neue Reports downloaden + parsen + pro meeting_id speichern
for (const meetingId of newIds) {
  const pdfUrl =
    `https://btv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument` +
    `?dokument=MeetingReportFOP&meeting=${meetingId}`;
  const pdfPath = path.join(tmpDir, `meeting_${meetingId}.pdf`);

  console.log("downloading meeting pdf:", meetingId);
  await download(pdfUrl, pdfPath);

  const text = pdfToText(pdfPath);
  const parsed = parseMeetingReportText(text);

  const reportRow = {
    meeting_id: meetingId,      // darf NIE null sein
    team_id: teamId,
    group_id: groupId,
    pdf_url: pdfUrl,
    termin: parsed.termin,
    singles: parsed.singles,
    doubles: parsed.doubles,
    text_preview: text.slice(0, 800),
    updated_at: new Date().toISOString(),
  };

  const { error: repErr } = await supabase
    .from("meeting_reports")
    .upsert(reportRow, { onConflict: "meeting_id" });

  if (repErr) throw repErr;
}

// 4) Index updaten (damit wir nächstes Mal nur neue ziehen)
const mergedIds = uniq([...existingIds, ...newIds]);

const { error: upErr } = await supabase
  .from("meeting_reports_index")
  .upsert(
    {
      team_id: teamId,
      group_id: groupId,
      meeting_ids: mergedIds,
      last_updated: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id" }
  );

if (upErr) throw upErr;

console.log(`✅ saved meetings for ${teamId}: total=${mergedIds.length}`);

// ---- END meeting refresh block ----


  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});