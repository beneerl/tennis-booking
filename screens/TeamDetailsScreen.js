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

// ✅ Backend-URL
const API_BASE_URL = "https://tennis-booking-tau.vercel.app";

// ✅ Exakter Clubname wie in nuLiga/PDF (wichtig für Filter + Heim/Auswärts)
const OUR_CLUB = "TeG Alzstadt";

// ---------- Helpers ----------
const stripClubId = (s) => String(s || "").replace(/\s*\(\d+\)\s*$/, "").trim();

const parseDEDateTime = (datum, uhrzeit) => {
  // datum: "15.03.2026", uhrzeit: "15:00"
  if (!datum) return null;
  const parts = String(datum).split(".");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  const [hh, min] = String(uhrzeit || "00:00").split(":");
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
};

const isPlayed = (m) => String(m?.erg || "").trim().length > 0;

// ✅ Status für UI-Highlight (gespielt vs kommend)
const getMatchState = (m) => {
  // gespielt, wenn Ergebnis da ist ODER Termin in der Vergangenheit ist
  if (String(m?.erg || "").trim()) return "played";
  const t = m?.dateObj?.getTime?.();
  if (t && t < Date.now()) return "played";
  return "upcoming";
};

const involvesOurClub = (m) => {
  const o = OUR_CLUB.toLowerCase();
  const heim = stripClubId(m?.heim).toLowerCase();
  const gast = stripClubId(m?.gast).toLowerCase();
  return heim.includes(o) || gast.includes(o);
};

const computeHomeFlagForOurClub = (m) => {
  // Heim, wenn unser Verein links steht (auch wenn Halle neutral ist)
  const heim = stripClubId(m?.heim).toLowerCase();
  return heim.includes(OUR_CLUB.toLowerCase());
};

const buildOpponentText = (m) => {
  const heim = stripClubId(m?.heim);
  const gast = stripClubId(m?.gast);
  const erg = String(m?.erg || "").trim();
  return erg ? `${heim} vs ${gast} (${erg})` : `${heim} vs ${gast}`;
};

const mapMatch = (m) => {
  const d = parseDEDateTime(m?.datum, m?.uhrzeit);
  return {
    id: `${m?.datum}-${m?.uhrzeit}-${m?.heim}-${m?.gast}`,
    date: d ? d.toISOString() : null,
    dateObj: d, // nur intern zum Sortieren
    opponent: buildOpponentText(m),
    venue: m?.halle || "—",
    erg: String(m?.erg || "").trim(),
    heim: stripClubId(m?.heim),
    gast: stripClubId(m?.gast),
  };
};

const sortByDateAsc = (a, b) => (a?.dateObj?.getTime?.() ?? 0) - (b?.dateObj?.getTime?.() ?? 0);
const sortByDateDesc = (a, b) => (b?.dateObj?.getTime?.() ?? 0) - (a?.dateObj?.getTime?.() ?? 0);

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

    // Ohne Ergebnis -> Datum entscheidet
    if (m.dateObj >= now) upcoming.push(m);
    else played.push(m); // falls alte Zeile ohne Ergebnis
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

  // Fallback Demo (nur wenn API down ist)
  const demo = useMemo(
    () => ({
      team: teamTitle,
      season: "Winter 2025/2026",
      status: "ACTIVE",
      matches: [],
      next_matches: [],
      table: [],
    }),
    [teamTitle]
  );

  const fetchTeam = async () => {
    setError("");
    try {
      const url = `${API_BASE_URL}/api/teams?teamId=${encodeURIComponent(teamId)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      if (json?.ok && json?.payload) {
        setPayload(json.payload);
      } else {
        throw new Error(json?.reason || "Keine Daten");
      }
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

  // Tabelle normalisieren
  const table = (payload?.table || []).map((r) => ({
    rank: Number(r?.rang ?? 0) || 0,
    club: stripClubId(r?.mannschaft),
    played: Number(r?.begegnungen ?? 0) || 0,
    points: r?.punkte || "—",
  }));

  // Matches normalisieren
  const rawMatches = payload?.matches || [];
  const allMatches = rawMatches.map(mapMatch).filter((m) => m.dateObj);

  // TEG = nur unsere Spiele
  const ourMatchesRaw = allMatches.filter(involvesOurClub).map((m) => ({
    ...m,
    home: computeHomeFlagForOurClub(m),
  }));
  const { upcoming: ourUpcoming, played: ourPlayed } = splitMatches(ourMatchesRaw);
  const tegList = [...ourUpcoming, ...ourPlayed];

  // Liga = alle Spiele
  const { upcoming: ligaUpcoming, played: ligaPlayed } = splitMatches(allMatches);
  const ligaList = [...ligaUpcoming, ...ligaPlayed];

  // Hero Next Match: nur TEG
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

          {!!error && (
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
                </Text>
                <Text style={styles.bigOpponent} numberOfLines={2}>
                  {nextMatch.opponent}
                </Text>
                <Text style={styles.smallLine} numberOfLines={2}>
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
              tegList.map((m) => {
                const state = getMatchState(m);

                return (
                  <View
                    key={m.id || `${m.date}-${m.opponent}`}
                    style={[
                      styles.matchCard,
                      state === "played" ? styles.matchCardPlayed : styles.matchCardUpcoming,
                    ]}
                  >
                    <View style={styles.matchTopRow}>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        <View style={[styles.chip, m.home ? styles.chipHome : styles.chipAway]}>
                          <Text style={styles.chipText}>{m.home ? "HEIM" : "AUSWÄRTS"}</Text>
                        </View>

                        <View
                          style={[
                            styles.pill,
                            state === "played" ? styles.pillPlayed : styles.pillUpcoming,
                          ]}
                        >
                          <Text style={styles.pillText}>
                            {state === "played" ? "GESPIELT" : "KOMMT"}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.matchDate}>{formatDateDE(m.date)}</Text>
                    </View>

                    <Text style={styles.matchOpponent}>{m.opponent || "—"}</Text>
                    <Text style={styles.matchVenue}>{m.venue || "—"}</Text>
                  </View>
                );
              })
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
              ligaList.map((m) => {
                const state = getMatchState(m);

                return (
                  <View
                    key={m.id || `${m.date}-${m.opponent}`}
                    style={[
                      styles.matchCard,
                      state === "played" ? styles.matchCardPlayed : styles.matchCardUpcoming,
                    ]}
                  >
                    <View style={styles.matchTopRow}>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        <View style={[styles.chip, styles.chipNeutral]}>
                          <Text style={styles.chipText}>LIGA</Text>
                        </View>

                        <View
                          style={[
                            styles.pill,
                            state === "played" ? styles.pillPlayed : styles.pillUpcoming,
                          ]}
                        >
                          <Text style={styles.pillText}>
                            {state === "played" ? "GESPIELT" : "KOMMT"}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.matchDate}>{formatDateDE(m.date)}</Text>
                    </View>

                    <Text style={styles.matchOpponent}>{m.opponent || "—"}</Text>
                    <Text style={styles.matchVenue}>{m.venue || "—"}</Text>
                  </View>
                );
              })
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
  bigOpponent: { color: "#ffffff", fontSize: 18, fontWeight: "900" },
  smallLine: { color: "#9fb0c8", marginTop: 4 },

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

  // ✅ Highlight je nach Status
  matchCardUpcoming: {
    borderColor: "rgba(242, 139, 37, 0.7)",
    backgroundColor: "rgba(8, 35, 80, 0.65)",
  },
  matchCardPlayed: {
    borderColor: "rgba(53, 90, 138, 0.6)",
    backgroundColor: "rgba(2, 36, 73, 0.85)",
  },

  // ✅ Mini-Badge (KOMMT / GESPIELT)
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillUpcoming: { borderColor: "rgba(242, 139, 37, 0.85)" },
  pillPlayed: { borderColor: "rgba(46, 204, 113, 0.6)" },
  pillText: { color: "#ffffff", fontSize: 11, fontWeight: "900" },

  matchTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  chipHome: { borderColor: "#2ecc71" },
  chipAway: { borderColor: "#e67e22" },
  chipNeutral: { borderColor: "#355a8a" },
  chipText: { color: "#ffffff", fontSize: 11, fontWeight: "900" },
  matchDate: { color: "#c3d0ea", fontSize: 12, fontWeight: "800" },
  matchOpponent: { marginTop: 10, color: "#ffffff", fontSize: 16, fontWeight: "900" },
  matchVenue: { marginTop: 4, color: "#9fb0c8", fontSize: 13 },

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
