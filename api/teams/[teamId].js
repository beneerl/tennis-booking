module.exports = async (req, res) => {
  try {
    require.resolve("@napi-rs/canvas");
  } catch (e) {
    console.error("resolve canvas failed:", e);
    return res.status(500).json({
      error: "canvas_not_found",
      detail: e.message,
    });
  }

  // ... ab hier erst dein bisheriger Code ...
};

// api/teams/[teamId].js
import pdf from "pdf-parse";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cache-TTL (Millisekunden): 60 Minuten
const CACHE_TTL_MS = 60 * 60 * 1000;

// ✅ Team Mapping (erstmal nur Herren Winter)
const TEAM_MAP = {
  herren_w1: {
    label: "Herren (Winter)",
    season: "Winter 2025/26",
    group: "2115082",
    pdfUrl:
      "https://btv.liga.nu/cgi-bin/WebObjects/nuLigaDokumentTENDE.woa/wa/nuDokument?dokument=ScheduleReportFOP&group=2115082",
  },
};

function supabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function parseGermanDateToISO(dateStr) {
  // akzeptiert z.B. "08.03.2026" oder "08.03.26"
  const m = String(dateStr || "").match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
  if (!m) return null;
  const dd = m[1];
  const mm = m[2];
  let yyyy = m[3];
  if (yyyy.length === 2) yyyy = "20" + yyyy;
  return `${yyyy}-${mm}-${dd}`;
}

function safeDateTimeISO(dateKey, timeStr) {
  // dateKey: "2026-03-08", timeStr: "09:00"
  if (!dateKey) return null;
  const t = (timeStr || "00:00").trim();
  // Wir geben UTC ISO zurück; in UI formatierst du ohnehin lokal.
  // Für "nur Anzeige" reicht das. (Genauigkeit Zeitzone ist hier unkritisch)
  return new Date(`${dateKey}T${t}:00.000Z`).toISOString();
}

function normalizeSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function extractTable(text) {
  // Sehr robuste "leichte" Variante: Wir suchen Zeilen, die wie Tabellenzeilen aussehen:
  // "<rank> <club> <beg> <pkt>"
  const lines = text.split("\n").map((l) => normalizeSpaces(l)).filter(Boolean);

  const rows = [];
  for (const line of lines) {
    // Beispiel: "1 TC Waging am See 4 8:0 21:3 44:7"
    // Wir nehmen rank, club, played, points (Pkt)
    const m = line.match(/^(\d{1,2})\s+(.+?)\s+(\d{1,2})\s+(\d{1,2}:\d{1,2})\b/);
    if (!m) continue;

    const rank = Number(m[1]);
    const club = m[2];
    const played = Number(m[3]);
    const points = m[4];

    // Filtern: rank 1..50, played plausibel
    if (rank >= 1 && rank <= 50 && played >= 0 && played <= 50) {
      rows.push({ rank, club, played, points });
    }
  }

  // Doppelte raus (kommt manchmal vor, wenn PDF Bereiche wiederholt)
  const uniq = [];
  const seen = new Set();
  for (const r of rows) {
    const key = `${r.rank}|${r.club}|${r.played}|${r.points}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(r);
  }

  // Nur wenn’s wirklich nach Tabelle aussieht:
  return uniq.length >= 2 ? uniq : [];
}

function extractMatches(text) {
  // Wir suchen Zeilen mit Datum + Zeit + Mannschaften.
  // nuLiga PDFs sind nicht immer 1:1 gleich, daher nehmen wir mehrere Patterns.
  const rawLines = text.split("\n").map((l) => normalizeSpaces(l)).filter(Boolean);

  const matches = [];

  for (const line of rawLines) {
    // Pattern A: "So. 08.03.2026 09:00 TEG Tacherting - TC Beispielstadt 6:3"
    let m =
      line.match(
        /(\d{2}\.\d{2}\.\d{2,4})\s+(\d{2}:\d{2})\s+(.+?)\s+[-–]\s+(.+?)(?:\s+(\d{1,2}:\d{1,2}))?$/
      ) ||
      line.match(
        /(\d{2}\.\d{2}\.\d{2,4})\s+(.+?)\s+[-–]\s+(.+?)(?:\s+(\d{1,2}:\d{1,2}))?$/
      );

    if (!m) continue;

    const dateStr = m[1];
    const dateKey = parseGermanDateToISO(dateStr);

    // Wenn Pattern ohne Zeit:
    let timeStr = null;
    let home = null;
    let away = null;
    let result = null;

    if (m.length >= 6 && m[2] && m[2].includes(":")) {
      // Pattern mit Zeit
      timeStr = m[2];
      home = m[3];
      away = m[4];
      result = m[5] || null;
    } else {
      // Pattern ohne Zeit
      home = m[2];
      away = m[3];
      result = m[4] || null;
    }

    home = normalizeSpaces(home);
    away = normalizeSpaces(away);

    // Plausibilitätsfilter
    if (!dateKey || home.length < 3 || away.length < 3) continue;

    matches.push({
      id: `${dateKey}-${timeStr || "00:00"}-${home}-${away}`.slice(0, 140),
      date: safeDateTimeISO(dateKey, timeStr || "00:00"),
      date_key: dateKey,
      time: timeStr || null,
      home_team: home,
      away_team: away,
      result: result ? String(result).trim() : null,
      venue: null, // kann man später ergänzen, wenn’s im PDF sauber extrahierbar ist
    });
  }

  // Duplikate entfernen
  const uniq = [];
  const seen = new Set();
  for (const x of matches) {
    const key = `${x.date_key}|${x.time}|${x.home_team}|${x.away_team}|${x.result || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(x);
  }

  // Sortieren nach Datum
  uniq.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return uniq;
}

function computeStatus(table, matches) {
  if (matches && matches.length > 0) return "ACTIVE";
  if (table && table.length > 0) return "PENDING"; // Tabelle da, Spielplan evtl. noch nicht
  return "PENDING";
}

function nextMatches(matches) {
  const now = Date.now();
  return (matches || [])
    .filter((m) => {
      const t = m?.date ? Date.parse(m.date) : NaN;
      if (!Number.isFinite(t)) return false;
      return t >= now;
    })
    .slice(0, 3);
}

export default async function handler(req, res) {
  try {
    const teamId = req.query.teamId;
    const def = TEAM_MAP[teamId];

    if (!def) {
      res.status(404).json({
        status: "PENDING",
        message: `Unbekanntes Team: ${teamId}. Bitte TEAM_MAP erweitern.`,
      });
      return;
    }

    const sb = supabaseAdmin();

    // 1) Cache lesen
    const { data: cached, error: cacheErr } = await sb
      .from("team_cache")
      .select("team_id, payload_json, updated_at")
      .eq("team_id", teamId)
      .maybeSingle();

    if (cacheErr) {
      // nicht fatal
      console.log("cache read error:", cacheErr.message);
    }

    if (cached?.payload_json && cached?.updated_at) {
      const ageMs = Date.now() - Date.parse(cached.updated_at);
      if (ageMs < CACHE_TTL_MS) {
        res.status(200).json(cached.payload_json);
        return;
      }
    }

    // 2) PDF laden
    const pdfRes = await fetch(def.pdfUrl);
    if (!pdfRes.ok) throw new Error(`PDF fetch failed: HTTP ${pdfRes.status}`);
    const buffer = Buffer.from(await pdfRes.arrayBuffer());

    // 3) PDF parsen
    const parsed = await pdf(buffer);
    const text = parsed?.text || "";

    const table = extractTable(text);
    const matches = extractMatches(text);

    const status = computeStatus(table, matches);

    const payload = {
      team: def.label,
      season: def.season,
      status,
      last_updated: nowIso(),
      source: {
        type: "PDF",
        url: def.pdfUrl,
        group: def.group,
      },
      next_matches: nextMatches(matches),
      matches,
      table,
    };

    // 4) Cache updaten
    await sb.from("team_cache").upsert(
      {
        team_id: teamId,
        payload_json: payload,
        status,
        source_url: def.pdfUrl,
        updated_at: nowIso(),
      },
      { onConflict: "team_id" }
    );

    res.status(200).json(payload);
  } catch (e) {
    console.log("teams api error:", e?.message || e);

    // Fallback: versuch Cache zurückzugeben
    try {
      const sb = supabaseAdmin();
      const teamId = req.query.teamId;

      const { data: cached } = await sb
        .from("team_cache")
        .select("payload_json")
        .eq("team_id", teamId)
        .maybeSingle();

      if (cached?.payload_json) {
        res.status(200).json({
          ...cached.payload_json,
          warning: `Live-Daten konnten nicht geladen werden: ${e?.message || e}`,
        });
        return;
      }
    } catch {}

    res.status(500).json({ error: e?.message || String(e) });
  }
}
