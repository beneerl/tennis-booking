// screens/TeamDetailsScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  StatusBar,
} from "react-native";
import { supabase } from "../supabaseClient";
import { Ionicons } from "@expo/vector-icons";
import TennisLoader from "../components/TennisLoader";

// ✅ Exakter Clubname wie in nuLiga/PDF (wichtig für Filter + Heim/Auswärts)
// ✅ Clubname je Team (wichtig für TEG-Tab + Heim/Auswärts)
const OUR_CLUB_DEFAULT = "TeG Alzstadt";
const OUR_CLUB_BY_TEAM = {
  herren_s2: "TeG Alzstadt II",
  // falls du später brauchst:
  // mixed_1: "TeG Alzstadt",
  // mixed_2: "TeG Alzstadt",
};

const getOurClubForTeam = (teamId) => OUR_CLUB_BY_TEAM[teamId] || OUR_CLUB_DEFAULT;

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

const involvesOurClub = (m, ourNorm) => {
  const heim = normalizeClub(m?.heim);
  const gast = normalizeClub(m?.gast);
  return heim === ourNorm || gast === ourNorm; // ✅ exakt
};

const computeHomeFlagForOurClub = (m, ourNorm) => {
  const heim = normalizeClub(m?.heim);
  return heim === ourNorm;
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
  const ourClubName = useMemo(() => getOurClubForTeam(teamId), [teamId]);
const ourNorm = useMemo(() => normalizeClub(ourClubName), [ourClubName]);
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
  .filter((m) => involvesOurClub(m, ourNorm))
  .map((m) => ({ ...m, home: computeHomeFlagForOurClub(m, ourNorm) }));

  const { upcoming: ourUpcoming, played: ourPlayed } = splitMatches(ourMatchesRaw);
  const tegList = [...ourUpcoming, ...ourPlayed];

  const { upcoming: ligaUpcoming, played: ligaPlayed } = splitMatches(allMatches);
  const ligaList = [...ligaUpcoming, ...ligaPlayed];

  const nextMatch = ourUpcoming[0] || null;

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <TennisLoader />
      </View>
    );
  }

  const renderMatchCard = (m, mode = "teg") => {
    const played = getMatchState(m) === "played";
    const label = mode === "liga" ? "LIGA" : m.home ? "HEIM" : "AUSWÄRTS";
    const icon = mode === "liga" ? "tennisball-outline" : m.home ? "home-outline" : "car-outline";

    return (
      <View
        key={m.id || `${m.date}-${m.heim}-${m.gast}`}
        style={[styles.matchCard, !played && styles.matchCardUpcoming, played && styles.matchCardPlayed]}
      >
        <View style={styles.matchTopRow}>
          <View style={[styles.matchChip, mode === "liga" ? styles.matchChipNeutral : m.home ? styles.matchChipHome : styles.matchChipAway]}>
            <Ionicons name={icon} size={11} color={mode === "liga" ? "#91A7C0" : m.home ? "#61D6B1" : "#F2A054"} />
            <Text style={styles.matchChipText}>{label}</Text>
          </View>
          <Text style={styles.matchMetaRight}>
            {formatDateDE(m.date)}{m.time ? ` · ${m.time}` : ""}
          </Text>
        </View>

        <View style={styles.matchTeamsWrap}>
          <View style={styles.clubLine}>
            <View style={[styles.clubDot, normalizeClub(m.heim) === ourNorm && styles.clubDotOur]} />
            <Text style={[styles.teamLine, normalizeClub(m.heim) === ourNorm && styles.teamLineOur]} numberOfLines={1}>{m.heim || "—"}</Text>
          </View>
          <View style={styles.clubLine}>
            <View style={[styles.clubDot, normalizeClub(m.gast) === ourNorm && styles.clubDotOur]} />
            <Text style={[styles.teamLine, normalizeClub(m.gast) === ourNorm && styles.teamLineOur]} numberOfLines={1}>{m.gast || "—"}</Text>
          </View>

          {!!m.erg && (
            <View style={styles.scorePill}>
              <Text style={styles.scoreText}>{m.erg}</Text>
            </View>
          )}
        </View>

        <View style={styles.venueRow}>
          <Ionicons name="location-outline" size={12} color="#607B98" />
          <Text style={styles.matchVenue} numberOfLines={1}>{m.venue || "—"}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <Ionicons name="chevron-back" size={20} color="#F28B25" />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerKicker}>TENNIS TACHERTING · TEAM</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{payload?.team || teamTitle}</Text>
        </View>

        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn} activeOpacity={0.85}>
          <Ionicons name="refresh-outline" size={18} color="#F28B25" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F28B25" />}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View>
              <Text style={styles.heroKicker}>SAISON</Text>
              <Text style={styles.seasonText}>{payload?.season || "—"}</Text>
            </View>
            <StatusBadge status={payload?.status} />
          </View>

          {__DEV__ && !!error && (
            <View style={styles.warningBox}>
              <Ionicons name="warning-outline" size={15} color="#F0B26D" />
              <Text style={styles.warningText}>Live-Daten konnten nicht geladen werden ({error}). Demo-Daten werden angezeigt.</Text>
            </View>
          )}

          <View style={styles.nextMatchCard}>
            <View style={styles.nextMatchTitleRow}>
              <View style={styles.nextMatchIcon}>
                <Ionicons name="calendar-outline" size={17} color="#F28B25" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.nextMatchKicker}>NÄCHSTES SPIEL</Text>
                <Text style={styles.nextMatchTitle}>TEG Begegnung</Text>
              </View>
            </View>

            {payload?.status === "PENDING" ? (
              <Text style={styles.mutedText}>Spielplan ist noch nicht veröffentlicht.</Text>
            ) : nextMatch ? (
              <>
                <View style={styles.nextMetaRow}>
                  <View style={styles.nextMetaPill}>
                    <Ionicons name={nextMatch.home ? "home-outline" : "car-outline"} size={12} color={nextMatch.home ? "#61D6B1" : "#F2A054"} />
                    <Text style={styles.nextMetaText}>{nextMatch.home ? "Heim" : "Auswärts"}</Text>
                  </View>
                  <Text style={styles.nextDate}>{formatDateDE(nextMatch.date)}{nextMatch.time ? ` · ${nextMatch.time}` : ""}</Text>
                </View>

                <View style={styles.heroTeams}>
                  <Text style={[styles.heroTeamName, normalizeClub(nextMatch.heim) === ourNorm && styles.heroTeamOur]} numberOfLines={1}>{nextMatch.heim || "—"}</Text>
                  <View style={styles.vsPill}><Text style={styles.vsText}>VS</Text></View>
                  <Text style={[styles.heroTeamName, normalizeClub(nextMatch.gast) === ourNorm && styles.heroTeamOur]} numberOfLines={1}>{nextMatch.gast || "—"}</Text>
                </View>

                <View style={styles.heroVenueRow}>
                  <Ionicons name="location-outline" size={13} color="#607B98" />
                  <Text style={styles.heroVenue} numberOfLines={1}>{nextMatch.venue || "—"}</Text>
                </View>
              </>
            ) : (
              <Text style={styles.mutedText}>Aktuell kein nächstes TEG-Spiel gefunden.</Text>
            )}
          </View>
        </View>

        <View style={styles.tabsRow}>
          <TabButton label="TEG" active={tab === "teg"} onPress={() => setTab("teg")} />
          <TabButton label="Tabelle" active={tab === "table"} onPress={() => setTab("table")} />
          <TabButton label="Liga" active={tab === "liga"} onPress={() => setTab("liga")} />
        </View>

        {tab === "teg" && (
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionKicker}>TEG ALZSTADT</Text>
                <Text style={styles.sectionTitle}>Begegnungen</Text>
              </View>
              <View style={styles.countPill}><Text style={styles.countText}>{tegList.length}</Text></View>
            </View>
            {tegList.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="calendar-clear-outline" size={24} color="#4E6988" />
                <Text style={styles.emptyTitle}>Keine Begegnungen</Text>
                <Text style={styles.emptyText}>Für TeG Alzstadt wurden aktuell keine Spiele gefunden.</Text>
              </View>
            ) : tegList.map((m) => renderMatchCard(m, "teg"))}
          </View>
        )}

        {tab === "table" && (
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionKicker}>LIGA</Text>
                <Text style={styles.sectionTitle}>Tabelle</Text>
              </View>
              <Ionicons name="list-outline" size={19} color="#7187A4" />
            </View>

            <View style={styles.tableCard}>
              {table.length === 0 ? (
                <View style={styles.emptyInner}>
                  <Text style={styles.mutedText}>Noch keine Tabelle verfügbar.</Text>
                </View>
              ) : (
                <View style={styles.table}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.th, { width: 34 }]}>#</Text>
                    <Text style={[styles.th, { flex: 1 }]}>Verein</Text>
                    <Text style={[styles.th, { width: 38, textAlign: "right" }]}>Sp</Text>
                    <Text style={[styles.th, { width: 58, textAlign: "right" }]}>Pkt</Text>
                  </View>

                  {table.map((row) => {
                    const isOurRow = normalizeClub(row.club) === ourNorm;
                    return (
                      <View key={`${row.rank}-${row.club}`} style={[styles.tableRow, isOurRow && styles.tableRowOur]}>
                        <Text style={[styles.rankText, isOurRow && styles.tableTextOur]}>{row.rank}</Text>
                        <Text style={[styles.td, { flex: 1 }, isOurRow && styles.tableTextOur]} numberOfLines={1}>{row.club}</Text>
                        <Text style={[styles.td, { width: 38, textAlign: "right" }, isOurRow && styles.tableTextOur]}>{row.played ?? "—"}</Text>
                        <Text style={[styles.pointsText, isOurRow && styles.pointsTextOur]}>{row.points ?? "—"}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        )}

        {tab === "liga" && (
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionKicker}>GESAMTE LIGA</Text>
                <Text style={styles.sectionTitle}>Spielplan</Text>
              </View>
              <View style={styles.countPill}><Text style={styles.countText}>{ligaList.length}</Text></View>
            </View>
            {ligaList.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="tennisball-outline" size={24} color="#4E6988" />
                <Text style={styles.emptyTitle}>Keine Liga-Begegnungen</Text>
              </View>
            ) : ligaList.map((m) => renderMatchCard(m, "liga"))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738", paddingTop: 40 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: "#123356" },
  backBtn: { width: 41, height: 41, borderRadius: 13, backgroundColor: "#08264A", borderWidth: 1, borderColor: "#173F66", alignItems: "center", justifyContent: "center" },
  headerKicker: { color: "#7187A4", fontSize: 8.2, fontWeight: "900", letterSpacing: 0.7 },
  headerTitle: { color: "#FFFFFF", fontSize: 18.5, fontWeight: "900", marginTop: 1 },
  refreshBtn: { width: 41, height: 41, borderRadius: 13, backgroundColor: "#302719", borderWidth: 1, borderColor: "#654725", alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  mutedText: { color: "#7E95B0", fontSize: 9.5, lineHeight: 14 },
  scrollContent: { paddingBottom: 28 },
  heroCard: { marginHorizontal: 14, marginTop: 14, backgroundColor: "#051E3B", borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "#173F66" },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroKicker: { color: "#7187A4", fontSize: 7.8, fontWeight: "900", letterSpacing: 0.8 },
  seasonText: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginTop: 2 },
  warningBox: { marginTop: 10, borderRadius: 12, backgroundColor: "#2D261B", borderWidth: 1, borderColor: "#604626", padding: 9, flexDirection: "row", gap: 7, alignItems: "flex-start" },
  warningText: { color: "#C7A477", fontSize: 8.5, lineHeight: 12, flex: 1 },
  badge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 7.5, fontWeight: "900", letterSpacing: 0.45 },
  badgeNeutral: { backgroundColor: "#0B2947", borderColor: "#24496B" },
  badgeActive: { backgroundColor: "#0A3443", borderColor: "#246D62" },
  badgePending: { backgroundColor: "#302719", borderColor: "#654725" },
  badgeFinished: { backgroundColor: "#251F35", borderColor: "#4F436E" },
  badgeTextNeutral: { color: "#9CB0C5" },
  badgeTextActive: { color: "#61D6B1" },
  badgeTextPending: { color: "#F2A054" },
  badgeTextFinished: { color: "#BBA9E8" },
  nextMatchCard: { marginTop: 12, backgroundColor: "#03172E", borderRadius: 16, padding: 11, borderWidth: 1, borderColor: "#123858" },
  nextMatchTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  nextMatchIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#302719", borderWidth: 1, borderColor: "#654725", alignItems: "center", justifyContent: "center" },
  nextMatchKicker: { color: "#6F87A4", fontSize: 7, fontWeight: "900", letterSpacing: 0.8 },
  nextMatchTitle: { color: "#DCE7F2", fontSize: 11.5, fontWeight: "900", marginTop: 1 },
  nextMetaRow: { marginTop: 11, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  nextMetaPill: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 26, borderRadius: 9, backgroundColor: "#082B3E", paddingHorizontal: 8 },
  nextMetaText: { color: "#9DB2C6", fontSize: 8.5, fontWeight: "900" },
  nextDate: { color: "#8399B3", fontSize: 8.8, fontWeight: "800" },
  heroTeams: { marginTop: 11, borderRadius: 13, backgroundColor: "#061E38", padding: 10, gap: 5 },
  heroTeamName: { color: "#B9C9D9", fontSize: 13.5, fontWeight: "900" },
  heroTeamOur: { color: "#FFFFFF" },
  vsPill: { alignSelf: "flex-start", minWidth: 25, height: 18, borderRadius: 6, backgroundColor: "#0B2947", alignItems: "center", justifyContent: "center" },
  vsText: { color: "#617C99", fontSize: 6.5, fontWeight: "900" },
  heroVenueRow: { marginTop: 9, flexDirection: "row", gap: 5, alignItems: "center" },
  heroVenue: { color: "#6F87A4", fontSize: 8.8, flex: 1 },
  tabsRow: { marginTop: 12, marginHorizontal: 14, flexDirection: "row", backgroundColor: "#041A34", borderRadius: 14, borderWidth: 1, borderColor: "#153A5D", padding: 4, gap: 4 },
  tabBtn: { flex: 1, minHeight: 37, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tabBtnActive: { backgroundColor: "#F28B25" },
  tabText: { color: "#7188A4", fontSize: 9.5, fontWeight: "900" },
  tabTextActive: { color: "#001738" },
  sectionWrap: { paddingHorizontal: 14, marginTop: 16 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionKicker: { color: "#7187A4", fontSize: 7.5, fontWeight: "900", letterSpacing: 0.8 },
  sectionTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginTop: 2 },
  countPill: { minWidth: 32, height: 29, borderRadius: 10, backgroundColor: "#08264A", borderWidth: 1, borderColor: "#173F66", alignItems: "center", justifyContent: "center" },
  countText: { color: "#9FB1C7", fontSize: 9, fontWeight: "900" },
  matchCard: { marginBottom: 8, backgroundColor: "#051E3B", borderRadius: 16, padding: 11, borderWidth: 1, borderColor: "#153A5D" },
  matchCardUpcoming: { borderColor: "#694925" },
  matchCardPlayed: { opacity: 0.9 },
  matchTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  matchChip: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, borderRadius: 8, borderWidth: 1 },
  matchChipHome: { backgroundColor: "#082C31", borderColor: "#23675D" },
  matchChipAway: { backgroundColor: "#302719", borderColor: "#654725" },
  matchChipNeutral: { backgroundColor: "#08264A", borderColor: "#173F66" },
  matchChipText: { color: "#AFC0D1", fontSize: 7.3, fontWeight: "900", letterSpacing: 0.3 },
  matchMetaRight: { color: "#7E95B0", fontSize: 8.5, fontWeight: "800" },
  matchTeamsWrap: { marginTop: 9, position: "relative", paddingRight: 64 },
  clubLine: { minHeight: 25, flexDirection: "row", alignItems: "center", gap: 7 },
  clubDot: { width: 5, height: 5, borderRadius: 99, backgroundColor: "#365C7D" },
  clubDotOur: { backgroundColor: "#F28B25" },
  teamLine: { color: "#B9C9D9", fontSize: 11, fontWeight: "800", flex: 1 },
  teamLineOur: { color: "#FFFFFF", fontWeight: "900" },
  scorePill: { position: "absolute", right: 0, top: 8, minWidth: 52, minHeight: 31, borderRadius: 10, backgroundColor: "#302719", borderWidth: 1, borderColor: "#654725", alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  scoreText: { color: "#F28B25", fontSize: 10.5, fontWeight: "900" },
  venueRow: { marginTop: 7, paddingTop: 7, borderTopWidth: 1, borderTopColor: "#123858", flexDirection: "row", alignItems: "center", gap: 4 },
  matchVenue: { color: "#607B98", fontSize: 8.3, flex: 1 },
  tableCard: { backgroundColor: "#051E3B", borderRadius: 17, borderWidth: 1, borderColor: "#153A5D", overflow: "hidden" },
  table: {},
  tableHeader: { minHeight: 35, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, backgroundColor: "#03172E", borderBottomWidth: 1, borderBottomColor: "#123858" },
  th: { color: "#607B98", fontSize: 7.8, fontWeight: "900", letterSpacing: 0.4 },
  tableRow: { minHeight: 43, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "#0F3153" },
  tableRowOur: { backgroundColor: "rgba(242,139,37,0.08)" },
  rankText: { width: 34, color: "#7D94B1", fontSize: 9.5, fontWeight: "900" },
  td: { color: "#B9C9D9", fontSize: 9.5, fontWeight: "800" },
  tableTextOur: { color: "#FFFFFF", fontWeight: "900" },
  pointsText: { width: 58, textAlign: "right", color: "#9CB1C7", fontSize: 9.5, fontWeight: "900" },
  pointsTextOur: { color: "#F28B25" },
  emptyCard: { minHeight: 120, borderRadius: 17, borderWidth: 1, borderColor: "#153A5D", backgroundColor: "#041A34", alignItems: "center", justifyContent: "center", padding: 18 },
  emptyInner: { minHeight: 90, alignItems: "center", justifyContent: "center", padding: 15 },
  emptyTitle: { color: "#DCE6F1", fontSize: 11.5, fontWeight: "900", marginTop: 7 },
  emptyText: { color: "#667F9B", fontSize: 8.7, lineHeight: 12, marginTop: 3, textAlign: "center" },
});
