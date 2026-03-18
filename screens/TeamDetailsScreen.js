// screens/TeamDetailsScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { supabase } from "../supabaseClient";

// ✅ Exakter Clubname wie in nuLiga/PDF (wichtig für Filter + Heim/Auswärts)
const OUR_CLUB_ROOT = "TeG Alzstadt";

// normalize: IDs raus, Leerzeichen clean, lowercase
const norm = (s) =>
  stripClubId(s).replace(/\s+/g, " ").trim().toLowerCase();

// Team-spezifisch: welche TEG-Mannschaft gilt als "uns"?
const isOurTeamForThisSchedule = (teamId, rawTeamName) => {
  const name = norm(rawTeamName);
  const root = OUR_CLUB_ROOT.toLowerCase();

  if (!name.includes(root)) return false;

  // Herren Sommer 1: nur "TeG Alzstadt" (ohne II/III)
  if (teamId === "herren_s1") {
    return !/\bii\b|\biii\b/.test(name); // schließt II und III aus
  }

  // Herren Sommer 2: nur "TeG Alzstadt II"
  if (teamId === "herren_s2") {
    return /\bii\b/.test(name);
  }

  // Default: alles was Root enthält
  return true;
};

// ---------- Helpers ----------
const stripClubId = (s) => String(s || "").replace(/\s*\(\d+\)\s*$/, "").trim();

const parseDEDateTime = (datum, uhrzeit) => {
  // datum: "15.03.2026", uhrzeit: "15:00"
  if (!datum) return null;
  const parts = String(datum).split(".");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  const [hh, min] = String(uhrzeit || "00:00").split(":");
  const d = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    0,
    0
  );
  return Number.isNaN(d.getTime()) ? null : d;
};

const isPlayed = (m) => String(m?.erg || "").trim().length > 0;

const getMatchState = (m) => {
  // gespielt, wenn Ergebnis da ist ODER Termin in der Vergangenheit ist
  if (String(m?.erg || "").trim()) return "played";
  const t = m?.dateObj?.getTime?.();
  if (t && t < Date.now()) return "played";
  return "upcoming";
};

const normalizeClub = (s) =>
  stripClubId(s).replace(/\s+/g, " ").trim().toLowerCase();

const OUR = normalizeClub(OUR_CLUB);

const involvesOurClub = (teamId, m) => {
  return (
    isOurTeamForThisSchedule(teamId, m?.heim) ||
    isOurTeamForThisSchedule(teamId, m?.gast)
  );
};

const computeHomeFlagForOurClub = (teamId, m) => {
  return isOurTeamForThisSchedule(teamId, m?.heim);
};

const mapMatch = (m) => {
  const d = parseDEDateTime(m?.datum, m?.uhrzeit);
  return {
    id: `${m?.datum}-${m?.uhrzeit}-${m?.heim}-${m?.gast}`,
    date: d ? d.toISOString() : null,
    dateObj: d,
    time: String(m?.uhrzeit || "").trim(),
    venue: m?.halle || "—",
    erg: String(m?.erg || "").trim(),
    heim: stripClubId(m?.heim),
    gast: stripClubId(m?.gast),
  };
};

const sortByDateAsc = (a, b) =>
  (a?.dateObj?.getTime?.() ?? 0) - (b?.dateObj?.getTime?.() ?? 0);
const sortByDateDesc = (a, b) =>
  (b?.dateObj?.getTime?.() ?? 0) - (a?.dateObj?.getTime?.() ?? 0);

const splitMatches = (all) => {
  const now = new Date();
  const upcoming = [];
  const played = [];

  for (const m of all) {
    if (!m?.dateObj) continue;

    if (isPlayed(m)) {
      played.push(m);
      continue;
    }

    if (m.dateObj >= now) upcoming.push(m);
    else played.push(m);
  }

  upcoming.sort(sortByDateAsc);
  played.sort(sortByDateDesc);

  return { upcoming, played };
};

function formatDateDE(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }) {
  const s = String(status || "").toUpperCase();

  let label = s || "—";
  let containerStyle = styles.badgeNeutral;
  let textStyle = styles.badgeTextNeutral;

  if (s === "ACTIVE") {
    label = "AKTIV";
    containerStyle = styles.badgeActive;
    textStyle = styles.badgeTextActive;
  } else if (s === "PENDING") {
    label = "NOCH KEIN SPIELPLAN";
    containerStyle = styles.badgePending;
    textStyle = styles.badgeTextPending;
  } else if (s === "FINISHED") {
    label = "SAISON BEENDET";
    containerStyle = styles.badgeFinished;
    textStyle = styles.badgeTextFinished;
  }

  return (
    <View style={[styles.badge, containerStyle]}>
      <Text style={[styles.badgeText, textStyle]}>{label}</Text>
    </View>
  );
}

function TabButton({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabBtn, active && styles.tabBtnActive]}
      activeOpacity={0.9}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function TeamDetailsScreen({ route, navigation }) {
  const teamId = route?.params?.teamId || "unknown";
  const teamTitle =
    route?.params?.teamTitle ||
    route?.params?.label ||
    route?.params?.team ||
    "Team";

  const [tab, setTab] = useState("teg"); // teg | table | liga
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");

  // Fallback Demo
  const demo = useMemo(
    () => ({
      team: teamTitle,
      season: "—",
      status: "PENDING",
      matches: [],
      next_matches: [],
      table: [],
      source_url: "",
      updated_at: null,
    }),
    [teamTitle]
  );

  const fetchTeam = async () => {
    setError("");
    try {
      const { data, error: dbErr } = await supabase
        .from("team_cache")
        .select("team_id, payload_json, status, source_url, updated_at")
        .eq("team_id", teamId)
        .maybeSingle();

      if (dbErr) throw dbErr;
      if (!data) throw new Error("Keine Teamdaten in team_cache gefunden.");

      // payload_json enthält euer komplettes Objekt (matches, table, season, ...)
      const p = data.payload_json || {};

      setPayload({
        ...p,
        status: data.status || p.status || "—",
        source_url: data.source_url || p.source_url || "",
        updated_at: data.updated_at || p.updated_at || null,
      });
    } catch (e) {
      setError(e?.message || String(e));
      setPayload(demo);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchTeam();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTeam();
    setRefreshing(false);
  };

  // ======= UI-Daten aus payload bauen =======

  const table = (payload?.table || []).map((r) => ({
    rank: Number(r?.rang ?? 0) || 0,
    club: stripClubId(r?.mannschaft),
    played: Number(r?.begegnungen ?? 0) || 0,
    points: r?.punkte || "—",
  }));

  const rawMatches = payload?.matches || [];
  const allMatches = rawMatches.map(mapMatch).filter((m) => m.dateObj);

const ourMatchesRaw = allMatches
  .filter((m) => involvesOurClub(teamId, m))
  .map((m) => ({ ...m, home: computeHomeFlagForOurClub(teamId, m) }));

  const { upcoming: ourUpcoming, played: ourPlayed } = splitMatches(ourMatchesRaw);
  const tegList = [...ourUpcoming, ...ourPlayed];

  const { upcoming: ligaUpcoming, played: ligaPlayed } = splitMatches(allMatches);
  const ligaList = [...ligaUpcoming, ...ligaPlayed];

  const nextMatch = ourUpcoming[0] || null;

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>{"< Zurück"}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{teamTitle}</Text>
          <View style={{ width: 70 }} />
        </View>

        <View style={styles.center}>
          <ActivityIndicator color="#ffffff" />
          <Text style={styles.mutedText}>Lade Teamdaten…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>{"< Zurück"}</Text>
        </TouchableOpacity>

        <Text style={styles.title} numberOfLines={1}>
          {payload?.team || teamTitle}
        </Text>

        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
      >
        {/* Hero */}
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Text style={styles.seasonText}>{payload?.season || "—"}</Text>
            <StatusBadge status={payload?.status} />
          </View>

          {__DEV__ && !!error && (
            <Text style={styles.warningText}>
              Hinweis: Live-Daten konnten nicht geladen werden ({error}). Demo-Daten werden angezeigt.
            </Text>
          )}

          <View style={styles.nextMatchCard}>
            <Text style={styles.sectionTitle}>Nächstes Spiel (TEG)</Text>

            {payload?.status === "PENDING" ? (
              <Text style={styles.mutedText}>Spielplan ist noch nicht veröffentlicht.</Text>
            ) : nextMatch ? (
              <>
                <Text style={styles.bigLine}>
                  {nextMatch.home ? "🏠 Heim" : "🚌 Auswärts"} · {formatDateDE(nextMatch.date)}
                  {nextMatch.time ? ` · ${nextMatch.time}` : ""}
                </Text>

                <View style={styles.teamsRow}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={styles.teamLineHero} numberOfLines={1}>
                      {nextMatch.heim || "—"}
                    </Text>
                    <Text style={styles.teamLineHero} numberOfLines={1}>
                      {nextMatch.gast || "—"}
                    </Text>
                  </View>

                  {!!nextMatch.erg && (
                    <View style={styles.scoreBox}>
                      <Text style={styles.scoreText}>{nextMatch.erg}</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.matchVenue} numberOfLines={2}>
                  {nextMatch.venue || "—"}
                </Text>
              </>
            ) : (
              <Text style={styles.mutedText}>Aktuell kein nächstes TEG-Spiel gefunden.</Text>
            )}
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabsRow}>
          <TabButton label="TEG" active={tab === "teg"} onPress={() => setTab("teg")} />
          <TabButton label="Tabelle" active={tab === "table"} onPress={() => setTab("table")} />
          <TabButton label="Liga" active={tab === "liga"} onPress={() => setTab("liga")} />
        </View>

        {/* ======= TEG TAB ======= */}
        {tab === "teg" && (
          <View style={{ paddingHorizontal: 14, marginTop: 12 }}>
            {tegList.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>TEG Begegnungen</Text>
                <Text style={styles.mutedText}>Keine Begegnungen für TeG Alzstadt gefunden.</Text>
              </View>
            ) : (
              tegList.map((m) => (
                <View
                  key={m.id || `${m.date}-${m.heim}-${m.gast}`}
                  style={[
                    styles.matchCard,
                    getMatchState(m) === "played"
                      ? styles.matchCardPlayed
                      : styles.matchCardUpcoming,
                  ]}
                >
                  <View style={styles.matchTopRow}>
                    <View style={[styles.chip, m.home ? styles.chipHome : styles.chipAway]}>
                      <Text style={styles.chipText}>{m.home ? "HEIM" : "AUSWÄRTS"}</Text>
                    </View>

                    <Text style={styles.matchMetaRight}>
                      {formatDateDE(m.date)}
                      {m.time ? ` · ${m.time}` : ""}
                    </Text>
                  </View>

                  <View style={styles.teamsRow}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.teamLine} numberOfLines={1}>
                        {m.heim || "—"}
                      </Text>
                      <Text style={styles.teamLine} numberOfLines={1}>
                        {m.gast || "—"}
                      </Text>
                    </View>

                    {!!m.erg && (
                      <View style={styles.scoreBox}>
                        <Text style={styles.scoreText}>{m.erg}</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.matchVenue} numberOfLines={2}>
                    {m.venue || "—"}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* ======= TABLE TAB ======= */}
        {tab === "table" && (
          <View style={{ paddingHorizontal: 14, marginTop: 12 }}>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Tabelle</Text>

              {table.length === 0 ? (
                <Text style={styles.mutedText}>Noch keine Tabelle verfügbar.</Text>
              ) : (
                <View style={styles.table}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.th, { width: 40 }]}>#</Text>
                    <Text style={[styles.th, { flex: 1 }]}>Verein</Text>
                    <Text style={[styles.th, { width: 60, textAlign: "right" }]}>Sp</Text>
                    <Text style={[styles.th, { width: 70, textAlign: "right" }]}>Pkt</Text>
                  </View>

                  {table.map((row) => (
                    <View key={`${row.rank}-${row.club}`} style={styles.tableRow}>
                      <Text style={[styles.td, { width: 40 }]}>{row.rank}</Text>
                      <Text style={[styles.td, { flex: 1 }]} numberOfLines={1}>
                        {row.club}
                      </Text>
                      <Text style={[styles.td, { width: 60, textAlign: "right" }]}>
                        {row.played ?? "—"}
                      </Text>
                      <Text style={[styles.td, { width: 70, textAlign: "right" }]}>
                        {row.points ?? "—"}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {/* ======= LIGA TAB ======= */}
        {tab === "liga" && (
          <View style={{ paddingHorizontal: 14, marginTop: 12 }}>
            {ligaList.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Liga Begegnungen</Text>
                <Text style={styles.mutedText}>Keine Liga-Begegnungen gefunden.</Text>
              </View>
            ) : (
              ligaList.map((m) => (
                <View
                  key={m.id || `${m.date}-${m.heim}-${m.gast}`}
                  style={[
                    styles.matchCard,
                    getMatchState(m) === "played"
                      ? styles.matchCardPlayed
                      : styles.matchCardUpcoming,
                  ]}
                >
                  <View style={styles.matchTopRow}>
                    <View style={[styles.chip, styles.chipNeutral]}>
                      <Text style={styles.chipText}>LIGA</Text>
                    </View>

                    <Text style={styles.matchMetaRight}>
                      {formatDateDE(m.date)}
                      {m.time ? ` · ${m.time}` : ""}
                    </Text>
                  </View>

                  <View style={styles.teamsRow}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.teamLine} numberOfLines={1}>
                        {m.heim || "—"}
                      </Text>
                      <Text style={styles.teamLine} numberOfLines={1}>
                        {m.gast || "—"}
                      </Text>
                    </View>

                    {!!m.erg && (
                      <View style={styles.scoreBox}>
                        <Text style={styles.scoreText}>{m.erg}</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.matchVenue} numberOfLines={2}>
                    {m.venue || "—"}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738", paddingTop: 40 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 10,
    justifyContent: "space-between",
    gap: 10,
  },
  backBtn: { paddingVertical: 8, paddingRight: 12 },
  backText: { color: "#f28b25", fontSize: 14, fontWeight: "700" },
  title: { color: "#ffffff", fontSize: 18, fontWeight: "800", flex: 1, textAlign: "center" },
  refreshBtn: {
    width: 44,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#355a8a",
    alignItems: "center",
    justifyContent: "center",
  },
  refreshText: { color: "#ffffff", fontSize: 18 },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  mutedText: { color: "#9fb0c8", marginTop: 8, textAlign: "center" },

  heroCard: {
    marginHorizontal: 14,
    backgroundColor: "#022449",
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
  },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  seasonText: { color: "#ffffff", fontSize: 16, fontWeight: "900" },

  warningText: {
    marginTop: 10,
    color: "#ffd18a",
    fontSize: 12,
    lineHeight: 16,
  },

  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: "900" },
  badgeNeutral: { backgroundColor: "rgba(195, 208, 234, 0.12)" },
  badgeActive: { backgroundColor: "rgba(46, 204, 113, 0.18)" },
  badgePending: { backgroundColor: "rgba(243, 156, 18, 0.18)" },
  badgeFinished: { backgroundColor: "rgba(155, 89, 182, 0.18)" },

  badgeTextNeutral: { color: "#c3d0ea" },
  badgeTextActive: { color: "#bff2d3" },
  badgeTextPending: { color: "#ffd18a" },
  badgeTextFinished: { color: "#e3c7ff" },

  nextMatchCard: {
    marginTop: 12,
    backgroundColor: "rgba(8, 35, 80, 0.9)",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#183b63",
  },
  sectionTitle: { color: "#ffffff", fontSize: 14, fontWeight: "900", marginBottom: 8 },
  bigLine: { color: "#c3d0ea", fontSize: 13, marginBottom: 6 },

  tabsRow: {
    marginTop: 12,
    marginHorizontal: 14,
    flexDirection: "row",
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "rgba(8, 35, 80, 0.55)",
  },
  tabBtnActive: { backgroundColor: "#f28b25", borderColor: "#f28b25" },
  tabText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  tabTextActive: { color: "#001738" },

  card: {
    marginTop: 12,
    backgroundColor: "#022449",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
  },

  matchCard: {
    marginTop: 12,
    backgroundColor: "#022449",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
  },

  matchCardUpcoming: {
    borderColor: "#f28b25",
    borderWidth: 2,
  },

  matchCardPlayed: {
    borderColor: "rgba(255,255,255,0.18)",
    opacity: 0.92,
  },

  matchTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  matchMetaRight: {
    color: "#c3d0ea",
    fontSize: 12,
    fontWeight: "800",
  },

  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  chipHome: { borderColor: "#2ecc71" },
  chipAway: { borderColor: "#e67e22" },
  chipNeutral: { borderColor: "#355a8a" },
  chipText: { color: "#ffffff", fontSize: 11, fontWeight: "900" },

  teamsRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
  },

  teamLine: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  teamLineHero: {
    color: "#ffffff",
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
  },

  scoreBox: {
    minWidth: 56,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f28b25",
    alignItems: "center",
    justifyContent: "center",
  },

  scoreText: {
    color: "#f28b25",
    fontSize: 14,
    fontWeight: "900",
  },

  matchVenue: { marginTop: 6, color: "#9fb0c8", fontSize: 13 },

  // Table
  table: { marginTop: 8 },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#183b63",
  },
  th: { color: "#9fb0c8", fontSize: 12, fontWeight: "900" },
  tableRow: { flexDirection: "row", paddingVertical: 10 },
  td: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
});
