const { createClient } = require("@supabase/supabase-js");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// === Team Quellen ===
const TEAM_MAP = {
  herren_w1: {
    team_id: "herren_w1",
    pdf_url:
      "https://btv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument?dokument=ScheduleReportFOP&group=2115082",
    season: "Winter 2025/2026",
    team: "Herren (Winter)",
    parser: "winter"
  },

  // ✅ NEU: Herren Sommer I
  herren_s1: {
    team_id: "herren_s1",
    pdf_url:
      "https://btv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument?dokument=ScheduleReportFOP&group=2215966",
    season: "Sommer 2026",
    team: "Herren I (Sommer)",
    parser: "summer"
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

function toLines(text) {
  return String(text || "")
    .replace(/\f/g, "\n") // ✅ Seitenumbruch aus PDF (FormFeed) -> Zeilenumbruch
    .split(/\r?\n/)
    .map((l) => l.replace(/[\u00a0\u2007\u202f]/g, " ")) // NBSP + andere "komische" Spaces
    .map((l) => l.replace(/\t/g, " "))
    .map((l) => l.replace(/\s+$/g, "")); // rechts trim
}

// === Ranking (Tabelle) robust ===
// Wir lesen nur den linken Block bis zur "Termin"-Spalte.
function parseRanking(text) {
  const lines = toLines(text);

  const headerIdx = lines.findIndex((l) =>
    l.toLowerCase().includes("rang") &&
    l.toLowerCase().includes("mannschaft") &&
    l.toLowerCase().includes("punkte")
  );
  if (headerIdx === -1) return [];

  const header = lines[headerIdx];
  const terminIdx = header.indexOf("Termin");
  const leftCut = terminIdx > 0 ? terminIdx : header.length;

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    // Rankingzeilen beginnen mit Rangnummer links
    const left = line.slice(0, leftCut).trim();

    // stop condition: wenn wir überhaupt keine Rangzeilen mehr sehen und wir schon was haben,
    // brechen wir nicht hart ab, sondern lassen es weiterlaufen (PDF mischt manchmal Blöcke)
    // => wir matchen nur echte Rangzeilen:
    const m = left.match(
      /^(\d+)\s+(.+?)\s+(\d+)\s+(\d+:\d+)\s+(\d+:\d+)\s+(\d+:\d+)\s+(\d+:\d+)\s*$/
    );
    if (m) {
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
  }
  return rows;
}

// === Matches aus festen Spalten (Header-Positionen) ===
function parseMatchesStrict(text) {
  const lines = toLines(text);

  const headerIdx = lines.findIndex((l) =>
    l.toLowerCase().includes("termin") &&
    l.toLowerCase().includes("heimmannschaft") &&
    l.toLowerCase().includes("gastmannschaft")
  );
  if (headerIdx === -1) return [];

  const header = lines[headerIdx];

  const terminStart = header.indexOf("Termin");
  const heimStart = header.indexOf("Heimmannschaft");
  const gastStart = header.indexOf("Gastmannschaft");
  // "Bem. Erg." -> wir nehmen Erg-Start als Position von "Erg."
  let ergStart = header.indexOf("Erg.");
  if (ergStart === -1) {
    // fallback: wenn "Bem." da ist, nimm ab Bem.
    ergStart = header.indexOf("Bem.");
  }
  if (terminStart === -1 || heimStart === -1 || gastStart === -1 || ergStart === -1) return [];

  const matches = [];
  const terminRegex = /^(Mo\.|Di\.|Mi\.|Do\.|Fr\.|Sa\.|So\.)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})$/;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Halle-Zeilen hängen ans letzte Match
    if (/^halle:/i.test(trimmed) && matches.length) {
      matches[matches.length - 1].halle = trimmed.replace(/^halle:\s*/i, "").trim();
      continue;
    }

    // Aus festen Spalten schneiden
    const terminField = line.slice(terminStart, heimStart).trim();
    const heimField = line.slice(heimStart, gastStart).trim();
    const gastField = line.slice(gastStart, ergStart).trim();
    const ergField = line.slice(ergStart).trim();

    // Wir akzeptieren nur echte Termin-Zeilen (wochentag + datum + uhrzeit)
    const tm = terminField.match(terminRegex);
    if (!tm) continue;

    const wochentag = tm[1];
    const datum = tm[2];
    const uhrzeit = tm[3];

    // Ergebnis erkennen (Score wie 2:4). Falls leer => upcoming
    const scoreMatch = ergField.match(/(\d+:\d+)/);
    const erg = scoreMatch ? scoreMatch[1] : ""; // "" = noch kein Ergebnis

    matches.push({
      wochentag,
      datum,
      uhrzeit,
      heim: heimField,
      gast: gastField,
      erg,
    });
  }

  return matches;
}

function parseMatchesRelaxed(text) {
  const lines = toLines(text);

  const headerIdx = lines.findIndex((l) =>
    l.toLowerCase().includes("termin") &&
    l.toLowerCase().includes("heimmannschaft") &&
    l.toLowerCase().includes("gastmannschaft")
  );
  if (headerIdx === -1) return [];

  const header = lines[headerIdx];

  const terminStart = header.indexOf("Termin");
  const heimStart = header.indexOf("Heimmannschaft");
  const gastStart = header.indexOf("Gastmannschaft");

  let ergStart = header.indexOf("Erg.");
  if (ergStart === -1) ergStart = header.indexOf("Bem.");
  if (terminStart === -1 || heimStart === -1 || gastStart === -1 || ergStart === -1) return [];

  const matches = [];
  const terminRegex =
    /^(Mo\.|Di\.|Mi\.|Do\.|Fr\.|Sa\.|So\.)[,]?\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}[:.]\d{2})\s*$/;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    // ✅ Halle / Spielort Zeilen anhängen
    if (/^(halle|spielort):/i.test(trimmed) && matches.length) {
      matches[matches.length - 1].halle = trimmed
        .replace(/^(halle|spielort):\s*/i, "")
        .trim();
      continue;
    }

    const terminField = line.slice(terminStart, heimStart).trim();
    const heimField = line.slice(heimStart, gastStart).trim();
    const gastField = line.slice(gastStart, ergStart).trim();
    const ergField = line.slice(ergStart).trim();

    const tm = terminField.match(terminRegex);
    if (!tm) continue;

    const wochentag = tm[1];
    const datum = tm[2];
    const uhrzeit = tm[3].replace(".", ":"); // ✅ 09.00 -> 09:00

    const scoreMatch = ergField.match(/(\d+:\d+)/);
    const erg = scoreMatch ? scoreMatch[1] : "";

    matches.push({
      wochentag,
      datum,
      uhrzeit,
      heim: heimField,
      gast: gastField,
      erg,
    });
  }

  return matches;
}

function parseMatchesWinter(text) {
  const strict = parseMatchesStrict(text);

  // Wenn strict schon genug Spiele findet, passt es (Winter bleibt stabil)
  if (strict && strict.length >= 6) return strict;

  // Fallback: relaxed
  const relaxed = parseMatchesRelaxed(text);

  // Nimm die Variante, die mehr Matches liefert
  if ((relaxed?.length || 0) > (strict?.length || 0)) return relaxed;

  return strict || [];
}

function parseMatchesSummer(text) {
  const lines = toLines(text);
  const matches = [];

  // Termin kann 09:00 oder 09.00 sein, Komma nach Wochentag manchmal vorhanden
  const terminRe =
    /^(Mo\.|Di\.|Mi\.|Do\.|Fr\.|Sa\.|So\.)[,]?\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}[:.]\d{2})\s*(.*)$/;

  // Helfer: versucht aus "rest" heim/gast/erg zu ziehen
  function parseRest(rest) {
    const r = String(rest || "").trim();
    if (!r) return null;

    // Spalten sind meist 2+ Spaces
    let parts = r.split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);

    // Fallback: manchmal hat pdftotext zu stark gekürzt -> dann wenigstens grob splitten
    if (parts.length < 2) {
      parts = r.split(/\s{1,}/).map((x) => x.trim()).filter(Boolean);
      // Wenn das zu granular wird, bringt es nix -> dann lieber null
      if (parts.length < 4) return null;
      // grob: heim = erste Hälfte, gast = zweite Hälfte (heuristisch)
      const mid = Math.floor(parts.length / 2);
      const heim = parts.slice(0, mid).join(" ");
      const gast = parts.slice(mid).join(" ");
      return { heim, gast, erg: (r.match(/(\d+:\d+)/) || [])[1] || "" };
    }

    const heim = parts[0] || "";
    const gast = parts[1] || "";
    const erg = (r.match(/(\d+:\d+)/) || [])[1] || "";

    if (!heim || !gast) return null;
    return { heim, gast, erg };
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = String(lines[i] || "").trim();
    if (!trimmed) continue;

    // Spielort/Halle-Zeilen ans letzte Match hängen
    if (/^(halle|spielort):/i.test(trimmed) && matches.length) {
      matches[matches.length - 1].halle = trimmed
        .replace(/^(halle|spielort):\s*/i, "")
        .trim();
      continue;
    }

    const m = trimmed.match(terminRe);
    if (!m) continue;

    const wochentag = m[1];
    const datum = m[2];
    const uhrzeit = m[3].replace(".", ":");
    let rest = m[4] || "";

    // ✅ WICHTIG: Sommer-PDF bricht manchmal um -> dann stehen Heim/Gast in der nächsten Zeile
    // Wir hängen bis zu 2 Folgezeilen an, solange sie NICHT ein neuer Termin sind.
    let parsed = parseRest(rest);
    let lookahead = 0;
    let j = i + 1;

    while (!parsed && lookahead < 2 && j < lines.length) {
      const nxt = String(lines[j] || "").trim();
      if (!nxt) {
        j++;
        continue;
      }

      // Wenn nächste Zeile wieder ein Termin ist, abbrechen (neues Match)
      if (terminRe.test(nxt)) break;

      // Wenn nächste Zeile Spielort/Halle ist, NICHT als Teamzeile verwenden
      if (/^(halle|spielort):/i.test(nxt)) break;

      rest = `${rest}  ${nxt}`.trim();
      parsed = parseRest(rest);

      lookahead++;
      j++;
    }

    if (!parsed) continue;

    matches.push({
      wochentag,
      datum,
      uhrzeit,
      heim: parsed.heim,
      gast: parsed.gast,
      erg: parsed.erg,
    });
  }

  return matches;
}

// dd.mm.yyyy + hh:mm => Date (lokal)
function parseDEDateTime(datum, uhrzeit) {
  if (!datum || !uhrzeit) return null;
  const [dd, mm, yyyy] = datum.split(".").map(Number);
  const [hh, mi] = uhrzeit.split(":").map(Number);
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd, hh || 0, mi || 0, 0, 0);
}

function computeNextMatches(matches) {
  const now = new Date();

  // upcoming = kein Ergebnis UND Datum in Zukunft (mit kleinem Puffer)
  const upcoming = matches
    .map((m) => ({ ...m, _dt: parseDEDateTime(m.datum, m.uhrzeit) }))
    .filter((m) => m._dt)
    .filter((m) => !m.erg) // <- wichtigste Änderung: nur ohne Ergebnis
    .filter((m) => m._dt.getTime() >= now.getTime() - 6 * 60 * 60 * 1000) // 6h Puffer
    .sort((a, b) => a._dt - b._dt)
    .slice(0, 3)
    .map(({ _dt, ...rest }) => rest);

  return upcoming;
}

function computePlayedMatches(matches) {
  return matches.filter((m) => !!m.erg);
}

function buildPayload(teamId, cfg, text) {
  const table = parseRanking(text);
const matches =
    cfg.parser === "summer"
      ? parseMatchesSummer(text)
      : parseMatchesWinter(text);

  const status = table.length || matches.length ? "ACTIVE" : "PENDING";

  return {
    teamId,
    status,
    team: cfg.team || teamId,
    season: cfg.season || "",
    last_updated: new Date().toISOString(),

    table,
    matches,
    played_matches: computePlayedMatches(matches),
    next_matches: computeNextMatches(matches),

    // Debug (optional)
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

    const payload = buildPayload(teamId, cfg, text);

    const { error } = await supabase.from("team_cache").upsert({
      team_id: teamId,
      payload_json: payload,
      status: payload.status,
      source_url: cfg.pdf_url,
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;
    console.log(
      `✅ Updated cache for ${teamId} | table=${payload.table.length} matches=${payload.matches.length} next=${payload.next_matches.length}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
