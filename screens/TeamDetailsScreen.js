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

// 🔧 TODO: Hier später deine echte Backend-URL eintragen
const API_BASE_URL = ""; // z.B. "https://dein-backend.de"

function formatDateTimeDE(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDateDE(isoOrDateKey) {
  if (!isoOrDateKey) return "—";
  try {
    const d = new Date(isoOrDateKey);
    return d.toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return isoOrDateKey;
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
  // TeamsScreen sendet: navigation.navigate("TeamDetails", { teamId, label })
  const teamId = route?.params?.teamId || "unknown";
  const teamTitle =
    route?.params?.teamTitle ||
    route?.params?.label ||
    route?.params?.team ||
    "Team";

  const [tab, setTab] = useState("overview"); // overview | matches | table
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");

  // Demo-Daten (solange kein Backend angeschlossen ist)
  const demo = useMemo(
    () => ({
      team: teamTitle,
      season: "Sommer 2026",
      status: "ACTIVE",
      last_updated: new Date().toISOString(),
      next_matches: [
        {
          id: "m1",
          date: "2026-03-08T09:00:00.000Z",
          home: true,
          opponent: "TC Beispielstadt",
          venue: "Tacherting Tennisanlage",
        },
      ],
      matches: [
        {
          id: "m2",
          date: "2026-03-08T09:00:00.000Z",
          home: true,
          opponent: "TC Beispielstadt",
          venue: "Tacherting Tennisanlage",
        },
        {
          id: "m3",
          date: "2026-03-22T10:00:00.000Z",
          home: false,
          opponent: "SV Irgendwo",
          venue: "Auswärts",
        },
        {
          id: "m4",
          date: "2026-04-05T09:00:00.000Z",
          home: true,
          opponent: "TSV Muster",
          venue: "Tacherting Tennisanlage",
        },
      ],
      table: [
        { rank: 1, club: "TEG Tacherting", played: 3, points: "6:0" },
        { rank: 2, club: "TC Beispielstadt", played: 3, points: "4:2" },
        { rank: 3, club: "SV Irgendwo", played: 3, points: "2:4" },
        { rank: 4, club: "TSV Muster", played: 3, points: "0:6" },
      ],
    }),
    [teamTitle]
  );

  const fetchTeam = async () => {
    setError("");
    try {
      // Wenn noch kein Backend: Demo anzeigen
      if (!API_BASE_URL) {
        setPayload(demo);
        return;
      }

      const url = `${API_BASE_URL}/teams/${encodeURIComponent(teamId)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setPayload(json);
    } catch (e) {
      setError(e?.message || String(e));
      setPayload(demo); // fallback
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

  const nextMatch = payload?.next_matches?.[0] || null;
  const matches = payload?.matches || payload?.next_matches || [];
  const table = payload?.table || [];

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
        {/* Hero / Summary */}
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

          <Text style={styles.lastUpdated}>
            Letztes Update: {formatDateTimeDE(payload?.last_updated)}
          </Text>

          {/* Next match highlight */}
          <View style={styles.nextMatchCard}>
            <Text style={styles.sectionTitle}>Nächstes Spiel</Text>

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
              <Text style={styles.mutedText}>Aktuell kein nächstes Spiel gefunden.</Text>
            )}
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabsRow}>
          <TabButton label="Übersicht" active={tab === "overview"} onPress={() => setTab("overview")} />
          <TabButton label="Begegnungen" active={tab === "matches"} onPress={() => setTab("matches")} />
          <TabButton label="Tabelle" active={tab === "table"} onPress={() => setTab("table")} />
        </View>

        {/* ======= OVERVIEW ======= */}
        {tab === "overview" && (
          <View style={{ marginTop: 12 }}>
            {/* Stats Row */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Saisonstatus</Text>
                <Text style={styles.statValue}>
                  {payload?.status === "ACTIVE"
                    ? "Aktiv"
                    : payload?.status === "PENDING"
                    ? "Pending"
                    : payload?.status === "FINISHED"
                    ? "Beendet"
                    : "—"}
                </Text>
                <Text style={styles.statHint}>automatisch aktualisiert</Text>
              </View>

              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Begegnungen</Text>
                <Text style={styles.statValue}>{matches?.length ? `${matches.length}` : "0"}</Text>
                <Text style={styles.statHint}>im Spielplan</Text>
              </View>
            </View>

            {/* Preview Matches */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.sectionTitle}>Kommende Begegnungen</Text>
                <TouchableOpacity onPress={() => setTab("matches")} style={styles.smallLinkBtn}>
                  <Text style={styles.smallLinkText}>Alle ansehen →</Text>
                </TouchableOpacity>
              </View>

              {payload?.status === "PENDING" ? (
                <Text style={styles.mutedText}>Spielplan ist noch nicht veröffentlicht.</Text>
              ) : matches.length === 0 ? (
                <Text style={styles.mutedText}>Keine Begegnungen vorhanden.</Text>
              ) : (
                matches.slice(0, 3).map((m) => (
                  <View key={m.id || `${m.date}-${m.opponent}`} style={styles.previewRow}>
                    <View style={[styles.chip, m.home ? styles.chipHome : styles.chipAway]}>
                      <Text style={styles.chipText}>{m.home ? "HEIM" : "AUSW"}</Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewOpponent} numberOfLines={1}>
                        {m.opponent || "—"}
                      </Text>
                      <Text style={styles.previewMeta} numberOfLines={1}>
                        {formatDateDE(m.date)} · {m.venue || "—"}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Preview Table */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.sectionTitle}>Tabelle (Top 4)</Text>
                <TouchableOpacity onPress={() => setTab("table")} style={styles.smallLinkBtn}>
                  <Text style={styles.smallLinkText}>Öffnen →</Text>
                </TouchableOpacity>
              </View>

              {payload?.status === "PENDING" ? (
                <Text style={styles.mutedText}>Noch keine Tabelle verfügbar.</Text>
              ) : table.length === 0 ? (
                <Text style={styles.mutedText}>Noch keine Tabelle verfügbar.</Text>
              ) : (
                table.slice(0, 4).map((row) => (
                  <View
                    key={`${row.rank}-${row.club}`}
                    style={[
                      styles.tablePreviewRow,
                      String(row.club || "").toLowerCase().includes("tacherting") &&
                        styles.tableRowHighlight,
                    ]}
                  >
                    <Text style={styles.tablePreviewRank}>{row.rank}</Text>
                    <Text style={styles.tablePreviewClub} numberOfLines={1}>
                      {row.club}
                    </Text>
                    <Text style={styles.tablePreviewRight}>{row.points ?? "—"}</Text>
                  </View>
                ))
              )}
            </View>
          </View>
        )}

        {/* ======= MATCHES ======= */}
        {tab === "matches" && (
          <View style={{ paddingHorizontal: 14, marginTop: 12 }}>
            {matches.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Begegnungen</Text>
                <Text style={styles.mutedText}>Keine Begegnungen vorhanden.</Text>
              </View>
            ) : (
              matches.map((m) => (
                <View key={m.id || `${m.date}-${m.opponent}`} style={styles.matchCard}>
                  <View style={styles.matchTopRow}>
                    <View style={[styles.chip, m.home ? styles.chipHome : styles.chipAway]}>
                      <Text style={styles.chipText}>{m.home ? "HEIM" : "AUSWÄRTS"}</Text>
                    </View>
                    <Text style={styles.matchDate}>{formatDateDE(m.date)}</Text>
                  </View>

                  <Text style={styles.matchOpponent}>{m.opponent || "—"}</Text>
                  <Text style={styles.matchVenue}>{m.venue || "—"}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* ======= TABLE ======= */}
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
                    <View
                      key={`${row.rank}-${row.club}`}
                      style={[
                        styles.tableRow,
                        String(row.club || "").toLowerCase().includes("tacherting") &&
                          styles.tableRowHighlight,
                      ]}
                    >
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
  lastUpdated: { color: "#9fb0c8", fontSize: 12, marginTop: 8 },

  warningText: {
    marginTop: 10,
    color: "#ffd18a",
    fontSize: 12,
    lineHeight: 16,
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
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
  tabBtnActive: {
    backgroundColor: "#f28b25",
    borderColor: "#f28b25",
  },
  tabText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  tabTextActive: { color: "#001738" },

  card: {
    marginTop: 12,
    marginHorizontal: 14,
    backgroundColor: "#022449",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
  },

  // Overview stats
  statsRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(8, 35, 80, 0.85)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#183b63",
  },
  statLabel: { color: "#9fb0c8", fontSize: 12, fontWeight: "800" },
  statValue: { marginTop: 6, color: "#ffffff", fontSize: 22, fontWeight: "900" },
  statHint: { marginTop: 4, color: "#c3d0ea", fontSize: 12 },

  cardTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  smallLinkBtn: { paddingVertical: 4, paddingHorizontal: 6 },
  smallLinkText: { color: "#f28b25", fontSize: 12, fontWeight: "800" },

  // Preview rows
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(53, 90, 138, 0.35)",
  },
  previewOpponent: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
  previewMeta: { marginTop: 2, color: "#c3d0ea", fontSize: 12, fontWeight: "700" },

  matchCard: {
    marginTop: 12,
    backgroundColor: "#022449",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
  },
  matchTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipHome: { borderColor: "#2ecc71" },
  chipAway: { borderColor: "#e67e22" },
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
  tableRowHighlight: {
    backgroundColor: "rgba(242, 139, 37, 0.12)",
    borderRadius: 12,
    paddingHorizontal: 8,
  },
  td: { color: "#ffffff", fontSize: 13, fontWeight: "800" },

  // Table preview
  tablePreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(53, 90, 138, 0.35)",
    gap: 10,
  },
  tablePreviewRank: { width: 24, color: "#c3d0ea", fontWeight: "900" },
  tablePreviewClub: { flex: 1, color: "#ffffff", fontWeight: "900" },
  tablePreviewRight: { width: 70, textAlign: "right", color: "#c3d0ea", fontWeight: "900" },
});
