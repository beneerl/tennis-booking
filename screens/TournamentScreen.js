import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../supabaseClient";
import { getCurrentUserProfile, normalizeUserStatus } from "../authProfile";
import BottomNav from "../components/BottomNav";
import TennisLoader from "../components/TennisLoader";
import { formatTournamentDate } from "../tournamentUtils";

const COURTS = ["Platz 1", "Platz 2", "Platz 3"];

export default function TournamentScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [authId, setAuthId] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [activeTournament, setActiveTournament] = useState(null);
  const [draws, setDraws] = useState([]);
  const [matches, setMatches] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const { session, profile: p } = await getCurrentUserProfile();
      if (!session?.user?.id || !p || normalizeUserStatus(p.status) === "blocked") {
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
        return;
      }
      setProfile(p);
      setAuthId(session.user.id);

      const { data: tournamentRows, error: tErr } = await supabase
        .from("tournaments")
        .select("*")
        .order("year", { ascending: false })
        .order("created_at", { ascending: false });
      if (tErr) throw tErr;
      const all = tournamentRows || [];
      setTournaments(all);
      const active = all.find((t) => t.status === "active") || all[0] || null;
      setActiveTournament(active);

      if (!active) {
        setDraws([]);
        setMatches([]);
        return;
      }

      const { data: drawRows, error: dErr } = await supabase
        .from("tournament_draws")
        .select("*")
        .eq("tournament_id", active.id)
        .order("sort_order", { ascending: true });
      if (dErr) throw dErr;
      const ds = drawRows || [];
      setDraws(ds);

      if (!ds.length) {
        setMatches([]);
        return;
      }

      const { data: matchRows, error: mErr } = await supabase
        .from("tournament_matches")
        .select("*")
        .in("draw_id", ds.map((d) => d.id))
        .order("round_index", { ascending: true })
        .order("match_index", { ascending: true });
      if (mErr) throw mErr;
      setMatches(matchRows || []);
    } catch (e) {
      console.log("Tournament load:", e?.message || e);
      setActiveTournament(null);
      setDraws([]);
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [])
  );

  const drawStats = useMemo(() => {
    const map = {};
    draws.forEach((draw) => {
      const dm = matches.filter((m) => m.draw_id === draw.id);
      map[draw.id] = {
        total: dm.length,
        completed: dm.filter((m) => m.status === "completed").length,
      };
    });
    return map;
  }, [draws, matches]);

  const upcoming = useMemo(
    () =>
      matches
        .filter((m) => m.status !== "completed" && m.booking_date && m.player1_name && m.player2_name)
        .sort((a, b) => `${a.booking_date}-${a.booking_from_time || ""}`.localeCompare(`${b.booking_date}-${b.booking_from_time || ""}`))
        .slice(0, 6),
    [matches]
  );

  const myMatches = useMemo(
    () =>
      matches.filter(
        (m) =>
          m.status !== "completed" &&
          (m.player1_auth_id === authId || m.player2_auth_id === authId) &&
          m.player1_name &&
          m.player2_name
      ),
    [matches, authId]
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <TennisLoader />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={2}>
              {activeTournament?.name || "Vereinsmeisterschaft"}
            </Text>
            {activeTournament && (
              <View style={styles.liveInline}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </View>
          {profile?.is_admin && (
            <TouchableOpacity style={styles.adminBtn} onPress={() => navigation.navigate("TournamentAdmin")}>
              <Ionicons name="settings-outline" size={19} color="#F28B25" />
            </TouchableOpacity>
          )}
        </View>

        {!activeTournament ? (
          <View style={styles.emptyCard}>
            <View style={styles.bigIcon}><Ionicons name="trophy-outline" size={30} color="#F28B25" /></View>
            <Text style={styles.emptyTitle}>Noch kein Turnier aktiv</Text>
            <Text style={styles.emptyText}>Sobald die Vereinsmeisterschaft angelegt ist, erscheinen hier Turnierbäume, Spiele und Ergebnisse.</Text>
            {profile?.is_admin && (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate("TournamentAdmin")}>
                <Text style={styles.primaryBtnText}>Turnier anlegen</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {myMatches.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Meine Spiele</Text>
                {myMatches.slice(0, 3).map((m) => (
                  <MatchRow key={m.id} match={m} draws={draws} mine navigation={navigation} />
                ))}
              </>
            )}

            <Text style={styles.sectionTitle}>Turnierbäume</Text>
            <View style={styles.drawGrid}>
              {draws.map((draw) => {
                const stat = drawStats[draw.id] || { total: 0, completed: 0 };
                const progress = stat.total ? Math.round((stat.completed / stat.total) * 100) : 0;
                const nameLower = String(draw.name || "").toLowerCase();
                const isSchneider = nameLower.includes("schneider");
                const isConsolation = draw.draw_type === "consolation" || nameLower.includes("trost");
                const isWomen = nameLower.includes("damen");
                const icon = isSchneider
                  ? "git-branch-outline"
                  : isConsolation
                  ? "shield-outline"
                  : isWomen
                  ? "ribbon-outline"
                  : "trophy-outline";
                const typeLabel = isSchneider ? "Schneiderrunde" : isConsolation ? "Trostrunde" : "Hauptfeld";
                return (
                  <TouchableOpacity
                    key={draw.id}
                    style={styles.drawCard}
                    onPress={() => navigation.navigate("TournamentBracket", { drawId: draw.id, tournamentId: activeTournament.id })}
                    activeOpacity={0.84}
                  >
                    <View style={styles.drawIcon}><Ionicons name={icon} size={21} color="#F28B25" /></View>
                    <View style={styles.drawTitleRow}>
                      <Text style={styles.drawName}>{draw.name}</Text>
                      <View style={[styles.drawTypePill, isSchneider && styles.drawTypePillSchneider, isConsolation && styles.drawTypePillConsolation]}>
                        <Text style={styles.drawTypeText}>{typeLabel}</Text>
                      </View>
                    </View>
                    <Text style={styles.drawMeta}>{stat.completed}/{stat.total} Spiele</Text>
                    <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
                    <View style={styles.openRow}><Text style={styles.openText}>Turnierbaum</Text><Ionicons name="arrow-forward" size={16} color="#AFC4DE" /></View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>Nächste Spiele</Text>
            {upcoming.length === 0 ? (
              <View style={styles.softEmpty}><Ionicons name="calendar-outline" size={19} color="#6F86A8" /><Text style={styles.softEmptyText}>Noch keine kommenden Matches terminiert.</Text></View>
            ) : upcoming.map((m) => <MatchRow key={m.id} match={m} draws={draws} navigation={navigation} />)}

            {tournaments.filter((t) => t.id !== activeTournament.id).length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Archiv</Text>
                {tournaments.filter((t) => t.id !== activeTournament.id).slice(0, 4).map((t) => (
                  <View key={t.id} style={styles.archiveRow}>
                    <Ionicons name="time-outline" size={18} color="#7990AE" />
                    <Text style={styles.archiveText}>{t.name}</Text>
                    <Text style={styles.archiveYear}>{t.year}</Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
      <BottomNav navigation={navigation} active="Tournament" />
    </View>
  );
}

function MatchRow({ match, draws, mine, navigation }) {
  const draw = draws.find((d) => d.id === match.draw_id);
  const scheduled = !!match.booking_date;
  return (
    <TouchableOpacity
      style={[styles.matchCard, mine && styles.matchCardMine]}
      onPress={() => navigation.navigate("TournamentBracket", { drawId: match.draw_id, focusMatchId: match.id })}
      activeOpacity={0.84}
    >
      <View style={[styles.matchIcon, mine && styles.matchIconMine]}>
        <Ionicons name={mine ? "tennisball" : "trophy-outline"} size={19} color={mine ? "#001738" : "#F28B25"} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.matchLabel}>{draw?.name || "Vereinsmeisterschaft"} · {match.round_name}</Text>
        <Text style={styles.matchPlayers} numberOfLines={1}>{match.player1_name} <Text style={styles.vs}>vs.</Text> {match.player2_name}</Text>
        {scheduled ? (
          <Text style={styles.matchSchedule}>{formatTournamentDate(match.booking_date)} · {match.booking_from_time} · {COURTS[match.booking_court_index] || "Platz"}</Text>
        ) : (
          <Text style={styles.matchOpen}>Termin noch offen</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color="#667E9E" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738" },
  scroll: { flex: 1 },
  content: { paddingTop: 52, paddingHorizontal: 16, paddingBottom: 30 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, width: "100%" },
  headerCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  title: { color: "#FFFFFF", fontSize: 27, lineHeight: 32, fontWeight: "900", flexShrink: 1, letterSpacing: -0.4 },
  titleCompact: { fontSize: 22, lineHeight: 27 },
  adminBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#08264A", borderWidth: 1, borderColor: "#17406A", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  liveInline: { marginTop: 8, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#0D2C4A", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#61D6B1" },
  liveText: { color: "#61D6B1", fontSize: 9, fontWeight: "900", letterSpacing: 0.7 },
  sectionTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", marginTop: 8, marginBottom: 10 },
  drawGrid: { gap: 10, marginBottom: 18 },
  drawCard: { backgroundColor: "#061F40", borderRadius: 18, borderWidth: 1, borderColor: "#153D66", padding: 14 },
  drawIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#302719", alignItems: "center", justifyContent: "center", marginBottom: 9 },
  drawTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  drawName: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", flex: 1 },
  drawTypePill: { borderRadius: 999, backgroundColor: "#143153", paddingHorizontal: 8, paddingVertical: 4 },
  drawTypePillConsolation: { backgroundColor: "#132F4B" },
  drawTypePillSchneider: { backgroundColor: "#292647" },
  drawTypeText: { color: "#9EB6CF", fontSize: 8.5, fontWeight: "900" },
  drawMeta: { color: "#8198B7", fontSize: 11, marginTop: 3 },
  progressTrack: { height: 5, backgroundColor: "#102D4F", borderRadius: 999, overflow: "hidden", marginTop: 11 },
  progressFill: { height: "100%", backgroundColor: "#F28B25", borderRadius: 999 },
  openRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 11 },
  openText: { color: "#AFC4DE", fontSize: 11, fontWeight: "800" },
  matchCard: { backgroundColor: "#061E3B", borderRadius: 17, borderWidth: 1, borderColor: "#153957", padding: 12, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 9 },
  matchCardMine: { borderColor: "#B96C24", backgroundColor: "#10233A" },
  matchIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#2C251B", alignItems: "center", justifyContent: "center" },
  matchIconMine: { backgroundColor: "#F28B25" },
  matchLabel: { color: "#7890AF", fontSize: 9.5, fontWeight: "800" },
  matchPlayers: { color: "#FFFFFF", fontSize: 14, fontWeight: "900", marginTop: 3 },
  vs: { color: "#7088A6", fontWeight: "700" },
  matchSchedule: { color: "#61D6B1", fontSize: 10.5, fontWeight: "700", marginTop: 4 },
  matchOpen: { color: "#8DA2BD", fontSize: 10.5, marginTop: 4 },
  softEmpty: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#061E3B", borderRadius: 15, padding: 13, marginBottom: 18 },
  softEmptyText: { color: "#8298B4", fontSize: 11.5 },
  archiveRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#102F50" },
  archiveText: { color: "#AEC1D7", flex: 1, fontSize: 12.5, fontWeight: "700" },
  archiveYear: { color: "#6F86A6", fontSize: 11 },
  emptyCard: { alignItems: "center", backgroundColor: "#061F40", borderRadius: 22, borderWidth: 1, borderColor: "#153D66", padding: 24, marginTop: 24 },
  bigIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: "#2C251B", alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginTop: 14 },
  emptyText: { color: "#8EA4BF", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 6 },
  primaryBtn: { marginTop: 18, backgroundColor: "#F28B25", borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
  primaryBtnText: { color: "#001738", fontWeight: "900" },
});
