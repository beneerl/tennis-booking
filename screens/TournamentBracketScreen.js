import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Modal,
  TextInput,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../supabaseClient";
import { getCurrentUserProfile, normalizeUserStatus } from "../authProfile";
import {
  formatTournamentDate,
  participantKeyFor,
  pendingWinnerKeyFor,
  winnerKeyFor,
} from "../tournamentUtils";
import TennisLoader from "../components/TennisLoader";

const COURTS = ["Platz 1", "Platz 2", "Platz 3"];
const CARD_WIDTH = 226;
const CARD_HEIGHT = 98;
const BASE_SLOT_HEIGHT = 116;
const CONNECTOR_GAP = 38;

function message(title, text) {
  if (Platform.OS === "web" && typeof window !== "undefined") window.alert(`${title}\n\n${text}`);
  else Alert.alert(title, text);
}

function shortRound(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("sechzehntel")) return "1/16";
  if (n.includes("achtel")) return "AF";
  if (n.includes("viertel")) return "VF";
  if (n.includes("halb")) return "HF";
  if (n.includes("final")) return "F";
  return "R";
}

export default function TournamentBracketScreen({ navigation, route }) {
  const initialDrawId = route?.params?.drawId || null;
  const focusMatchId = route?.params?.focusMatchId || null;
  const [loading, setLoading] = useState(true);
  const [authId, setAuthId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tournament, setTournament] = useState(null);
  const [draws, setDraws] = useState([]);
  const [drawId, setDrawId] = useState(initialDrawId);
  const [matches, setMatches] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [score, setScore] = useState("");
  const [winnerId, setWinnerId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showInitialLoader, setShowInitialLoader] = useState(false);
  const loaderShownAt = useRef(0);

  const load = async (requestedDraw = drawId || initialDrawId) => {
    setLoading(true);
    try {
      const { session, profile } = await getCurrentUserProfile();
      if (!session?.user?.id || !profile || normalizeUserStatus(profile.status) === "blocked") {
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
        return;
      }
      setAuthId(session.user.id);
      setIsAdmin(!!profile.is_admin);

      let chosenDraw = null;
      if (requestedDraw) {
        const { data, error } = await supabase.from("tournament_draws").select("*").eq("id", requestedDraw).maybeSingle();
        if (error) throw error;
        chosenDraw = data;
      }
      if (!chosenDraw) throw new Error("Turnierbaum nicht gefunden.");

      const { data: tournamentRow, error: tErr } = await supabase
        .from("tournaments")
        .select("*")
        .eq("id", chosenDraw.tournament_id)
        .maybeSingle();
      if (tErr) throw tErr;
      setTournament(tournamentRow || null);

      const { data: drawRows, error: dErr } = await supabase
        .from("tournament_draws")
        .select("*")
        .eq("tournament_id", chosenDraw.tournament_id)
        .order("sort_order", { ascending: true });
      if (dErr) throw dErr;
      setDraws(drawRows || []);
      setDrawId(chosenDraw.id);

      const { data: matchRows, error: mErr } = await supabase
        .from("tournament_matches")
        .select("*")
        .eq("draw_id", chosenDraw.id)
        .order("round_index", { ascending: true })
        .order("match_index", { ascending: true });
      if (mErr) throw mErr;
      const rows = matchRows || [];
      setMatches(rows);

      if (focusMatchId) {
        const focused = rows.find((m) => m.id === focusMatchId);
        if (focused) openMatch(focused);
      } else if (selectedMatch) {
        const refreshed = rows.find((m) => m.id === selectedMatch.id);
        if (refreshed) setSelectedMatch(refreshed);
      }
    } catch (e) {
      console.log("Bracket load:", e?.message || e);
      message("Turnier", e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(initialDrawId);
  }, [initialDrawId]);

  // Avoid flashing a loading state for very fast requests. If loading lasts long enough,
  // show the quiet bracket skeleton briefly so the transition feels deliberate.
  useEffect(() => {
    let timer;

    if (loading && !matches.length && !showInitialLoader) {
      timer = setTimeout(() => {
        loaderShownAt.current = Date.now();
        setShowInitialLoader(true);
      }, 160);
    } else if (!loading && showInitialLoader) {
      const elapsed = Date.now() - loaderShownAt.current;
      timer = setTimeout(() => setShowInitialLoader(false), Math.max(0, 520 - elapsed));
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [loading, matches.length, showInitialLoader]);

  const rounds = useMemo(() => {
    const map = new Map();
    matches.forEach((m) => {
      const arr = map.get(m.round_index) || [];
      arr.push(m);
      map.set(m.round_index, arr);
    });
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches]);

  const currentDraw = draws.find((d) => d.id === drawId);

  const openMatch = (match) => {
    setSelectedMatch(match);
    setScore(match.status === "completed" ? match.score || "" : match.pending_score || "");
    setWinnerId(match.status === "completed" ? winnerKeyFor(match) : pendingWinnerKeyFor(match));
  };

  const switchDraw = async (id) => {
    if (id === drawId) return;
    setSelectedMatch(null);
    await load(id);
  };

  const participant = !!selectedMatch && (selectedMatch.player1_auth_id === authId || selectedMatch.player2_auth_id === authId);
  const bothPlayersReady = !!selectedMatch?.player1_name && !!selectedMatch?.player2_name;
  const hasExternal = !!selectedMatch && (
    (!!selectedMatch.player1_name && !selectedMatch.player1_auth_id) ||
    (!!selectedMatch.player2_name && !selectedMatch.player2_auth_id)
  );
  const pendingByMe = selectedMatch?.pending_submitted_by === authId;
  const canConfirm = selectedMatch?.status === "pending_confirmation" && (!!isAdmin || (participant && !pendingByMe));
  const playerCanReport = bothPlayersReady && !hasExternal && participant;

  const submitPlayerResult = async () => {
    if (!selectedMatch || !winnerId) return message("Ergebnis", "Bitte Sieger auswählen.");
    setSaving(true);
    try {
      const { error } = await supabase.rpc("tournament_submit_result_v2", {
        p_match_id: selectedMatch.id,
        p_score: score.trim(),
        p_winner_participant_id: winnerId,
      });
      if (error) throw error;
      await load(drawId);
      message("Gespeichert", "Das Ergebnis wartet jetzt auf die Bestätigung des Gegners.");
    } catch (e) {
      message("Ergebnis konnte nicht gespeichert werden", e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveAdminResult = async () => {
    if (!selectedMatch || !winnerId) return message("Ergebnis", "Bitte Sieger auswählen.");
    setSaving(true);
    try {
      const { error } = await supabase.rpc("tournament_admin_set_result_v2", {
        p_match_id: selectedMatch.id,
        p_score: score.trim(),
        p_winner_participant_id: winnerId,
      });
      if (error) throw error;
      await load(drawId);
      message("Ergebnis gespeichert", "Der Turnierbaum wurde aktualisiert.");
    } catch (e) {
      message("Ergebnis konnte nicht gespeichert werden", e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmPending = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("tournament_confirm_result_v2", { p_match_id: selectedMatch.id });
      if (error) throw error;
      await load(drawId);
      message("Bestätigt", "Das Ergebnis ist jetzt offiziell.");
    } catch (e) {
      message("Bestätigung fehlgeschlagen", e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const rejectPending = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("tournament_reject_result_v2", { p_match_id: selectedMatch.id });
      if (error) throw error;
      await load(drawId);
      setSelectedMatch(null);
    } catch (e) {
      message("Ablehnen fehlgeschlagen", e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (showInitialLoader) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <TennisLoader />
      </View>
    );
  }

  // For sub-160 ms loads, keep the transition visually quiet instead of flashing a skeleton.
  if (loading && !matches.length) {
    return <View style={styles.container}><StatusBar barStyle="light-content" /></View>;
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={22} color="#FFFFFF" /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={2}>{tournament?.name || "Vereinsmeisterschaft"}</Text>
        </View>
        <View style={styles.trophyBadge}><Ionicons name="trophy-outline" size={18} color="#F28B25" /></View>
      </View>

      <View style={styles.drawTabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.drawTabs}>
          {draws.map((draw) => {
            const active = draw.id === drawId;
            return (
              <TouchableOpacity key={draw.id} style={[styles.drawTab, active && styles.drawTabActive]} onPress={() => switchDraw(draw.id)}>
                <Ionicons name={draw.draw_type === "consolation" ? "shield-outline" : draw.name.toLowerCase().includes("damen") ? "ribbon-outline" : "trophy-outline"} size={15} color={active ? "#001738" : "#8FA7C7"} />
                <Text style={[styles.drawTabText, active && styles.drawTabTextActive]}>{draw.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView style={styles.verticalScroll} contentContainerStyle={styles.verticalContent} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bracketContent}>
          {rounds.map(([roundIndex, roundMatches], roundArrayIndex) => {
            const itemHeight = BASE_SLOT_HEIGHT * 2 ** roundIndex;
            const isLast = roundArrayIndex === rounds.length - 1;
            const segmentWidth = CARD_WIDTH + (isLast ? 0 : CONNECTOR_GAP);
            return (
              <View key={roundIndex} style={[styles.roundSegment, { width: segmentWidth }]}>
                <View style={[styles.roundHeader, { width: CARD_WIDTH }]}>
                  <Text style={styles.roundTitle}>{roundMatches[0]?.round_name || `Runde ${roundIndex + 1}`}</Text>
                </View>

                <View style={[styles.matchesArea, { height: itemHeight * roundMatches.length }]}>
                  {roundMatches.map((match) => (
                    <View key={match.id} style={[styles.matchSlot, { height: itemHeight, width: CARD_WIDTH }]}>
                      <MatchCard match={match} authId={authId} onPress={() => openMatch(match)} />
                    </View>
                  ))}

                  {!isLast && Array.from({ length: Math.floor(roundMatches.length / 2) }, (_, pairIndex) => {
                    const topY = (pairIndex * 2 + 0.5) * itemHeight;
                    const bottomY = (pairIndex * 2 + 1.5) * itemHeight;
                    const midY = (topY + bottomY) / 2;
                    const jointX = CARD_WIDTH + CONNECTOR_GAP / 2;
                    return (
                      <React.Fragment key={`connector_${pairIndex}`}>
                        <View style={[styles.connectorH, { left: CARD_WIDTH, top: topY, width: CONNECTOR_GAP / 2 }]} />
                        <View style={[styles.connectorH, { left: CARD_WIDTH, top: bottomY, width: CONNECTOR_GAP / 2 }]} />
                        <View style={[styles.connectorV, { left: jointX, top: topY, height: bottomY - topY }]} />
                        <View style={[styles.connectorH, { left: jointX, top: midY, width: CONNECTOR_GAP / 2 }]} />
                      </React.Fragment>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </ScrollView>

      <Modal visible={!!selectedMatch} transparent animationType="fade" onRequestClose={() => setSelectedMatch(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            {selectedMatch && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalTop}>
                  <View style={styles.modalIcon}><Ionicons name="trophy-outline" size={21} color="#F28B25" /></View>
                  <View style={{ flex: 1 }}><Text style={styles.modalKicker}>{currentDraw?.name} · {selectedMatch.round_name}</Text><Text style={styles.modalTitle}>Matchdetails</Text></View>
                  <TouchableOpacity onPress={() => setSelectedMatch(null)}><Ionicons name="close" size={23} color="#8CA2BE" /></TouchableOpacity>
                </View>

                <View style={styles.playersBox}>
                  <PlayerLine name={selectedMatch.player1_name || "Noch offen"} external={!!selectedMatch.player1_name && !selectedMatch.player1_auth_id} winner={winnerKeyFor(selectedMatch) === participantKeyFor(selectedMatch, 1)} />
                  <Text style={styles.vsBig}>VS</Text>
                  <PlayerLine name={selectedMatch.player2_name || "Noch offen"} external={!!selectedMatch.player2_name && !selectedMatch.player2_auth_id} winner={winnerKeyFor(selectedMatch) === participantKeyFor(selectedMatch, 2)} />
                </View>

                {hasExternal && (
                  <View style={styles.externalNotice}><Ionicons name="shield-outline" size={18} color="#F4A04A" /><View style={{ flex: 1 }}><Text style={styles.externalNoticeTitle}>Externer Teilnehmer</Text><Text style={styles.externalNoticeText}>Dieses Match wird beim Ergebnis vom Admin verwaltet. Eine Spieler-Bestätigung ist hier nicht nötig.</Text></View></View>
                )}

                {selectedMatch.booking_date ? (
                  <View style={styles.scheduleBox}>
                    <Ionicons name="calendar-outline" size={18} color="#61D6B1" />
                    <View style={{ flex: 1 }}><Text style={styles.scheduleTitle}>{formatTournamentDate(selectedMatch.booking_date)} · {selectedMatch.booking_from_time}–{selectedMatch.booking_to_time}</Text><Text style={styles.scheduleMeta}>{COURTS[selectedMatch.booking_court_index] || "Platz"}</Text></View>
                  </View>
                ) : selectedMatch.status === "open" && participant ? (
                  <TouchableOpacity style={styles.bookBtn} onPress={() => { setSelectedMatch(null); navigation.navigate("Booking", { tournamentMatchId: selectedMatch.id }); }}>
                    <Ionicons name="calendar-outline" size={18} color="#001738" /><Text style={styles.bookBtnText}>Platz für dieses Match buchen</Text>
                  </TouchableOpacity>
                ) : null}

                {selectedMatch.status === "completed" && (
                  <View style={styles.resultBox}><Text style={styles.resultLabel}>OFFIZIELLES ERGEBNIS</Text><Text style={styles.resultScore}>{selectedMatch.score || "Ergebnis eingetragen"}</Text><Text style={styles.resultWinner}>Sieger: {selectedMatch.winner_name || "–"}</Text></View>
                )}

                {selectedMatch.status === "pending_confirmation" && (
                  <View style={styles.pendingBox}>
                    <Text style={styles.pendingLabel}>WARTET AUF BESTÄTIGUNG</Text>
                    <Text style={styles.pendingScore}>{selectedMatch.pending_score || "–"}</Text>
                    <Text style={styles.pendingWinner}>Sieger gemeldet: {selectedMatch.pending_winner_name}</Text>
                    {pendingByMe && !isAdmin && <Text style={styles.pendingHint}>Dein Gegner muss das Ergebnis noch bestätigen.</Text>}
                    {canConfirm && (
                      <View style={styles.actionRow}>
                        <TouchableOpacity style={styles.rejectBtn} onPress={rejectPending} disabled={saving}><Text style={styles.rejectText}>Ablehnen</Text></TouchableOpacity>
                        <TouchableOpacity style={styles.confirmBtn} onPress={confirmPending} disabled={saving}><Ionicons name="checkmark" size={17} color="#001738" /><Text style={styles.confirmText}>Bestätigen</Text></TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}

                {bothPlayersReady && (selectedMatch.status !== "pending_confirmation" || isAdmin) && (isAdmin || playerCanReport) && (
                  <View style={styles.formBox}>
                    <Text style={styles.formTitle}>{isAdmin ? (selectedMatch.status === "completed" ? "Ergebnis korrigieren" : "Ergebnis eintragen") : "Ergebnis melden"}</Text>
                    <Text style={styles.fieldLabel}>Ergebnis</Text>
                    <TextInput value={score} onChangeText={setScore} style={styles.input} placeholder="z. B. 6:3 4:6 10:7" placeholderTextColor="#607A99" />
                    <Text style={styles.fieldLabel}>Sieger</Text>
                    <View style={styles.winnerRow}>
                      {[
                        { id: participantKeyFor(selectedMatch, 1), name: selectedMatch.player1_name },
                        { id: participantKeyFor(selectedMatch, 2), name: selectedMatch.player2_name },
                      ].filter((p) => p.id && p.name).map((p) => {
                        const active = winnerId === p.id;
                        return <TouchableOpacity key={p.id} style={[styles.winnerChip, active && styles.winnerChipActive]} onPress={() => setWinnerId(p.id)}><Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={16} color={active ? "#001738" : "#8CA2BE"} /><Text style={[styles.winnerText, active && styles.winnerTextActive]} numberOfLines={1}>{p.name}</Text></TouchableOpacity>;
                      })}
                    </View>
                    <TouchableOpacity style={styles.saveBtn} onPress={isAdmin ? saveAdminResult : submitPlayerResult} disabled={saving}>
                      <Ionicons name={isAdmin ? "shield-checkmark-outline" : "paper-plane-outline"} size={18} color="#001738" />
                      <Text style={styles.saveText}>{saving ? "Speichere …" : isAdmin ? "Direkt als offiziell speichern" : "Ergebnis melden"}</Text>
                    </TouchableOpacity>
                    {!isAdmin && <Text style={styles.formHint}>Das Ergebnis wird erst nach Bestätigung des Gegners offiziell.</Text>}
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PlayerLine({ name, winner, external }) {
  return (
    <View style={[styles.playerLine, winner && styles.playerWinner]}>
      <View style={[styles.playerAvatar, winner && styles.playerAvatarWinner]}><Text style={[styles.playerLetter, winner && styles.playerLetterWinner]}>{String(name || "?").charAt(0).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}><Text style={[styles.playerName, winner && styles.playerNameWinner]} numberOfLines={1}>{name}</Text>{external && <Text style={styles.externalTiny}>EXTERN</Text>}</View>
      {winner && <Ionicons name="checkmark-circle" size={19} color="#F28B25" />}
    </View>
  );
}

function MatchCard({ match, authId, onPress }) {
  const mine = match.player1_auth_id === authId || match.player2_auth_id === authId;
  const completed = match.status === "completed";
  const pending = match.status === "pending_confirmation";
  const p1Key = participantKeyFor(match, 1);
  const p2Key = participantKeyFor(match, 2);
  const winKey = winnerKeyFor(match);
  const p1External = !!match.player1_name && !match.player1_auth_id;
  const p2External = !!match.player2_name && !match.player2_auth_id;

  return (
    <TouchableOpacity style={[styles.matchCard, completed && styles.matchCardCompleted, mine && styles.matchCardMine]} onPress={onPress} activeOpacity={0.86}>
      <View style={styles.cardAccent} />
      <View style={styles.matchTop}>
        <Text style={styles.matchNo}>MATCH {match.match_index + 1}</Text>
        {pending ? <View style={styles.pendingPill}><Text style={styles.pendingPillText}>PRÜFEN</Text></View> : match.booking_date ? <View style={styles.scheduledPill}><Ionicons name="calendar" size={10} color="#61D6B1" /><Text style={styles.scheduledText}>{match.booking_from_time}</Text></View> : completed ? <Ionicons name="checkmark-circle-outline" size={14} color="#607A99" /> : <View style={styles.openDot} />}
      </View>
      <BracketPlayer name={match.player1_name} external={p1External} winner={completed && !!p1Key && winKey === p1Key} />
      <View style={styles.divider} />
      <BracketPlayer name={match.player2_name} external={p2External} winner={completed && !!p2Key && winKey === p2Key} />
      {completed && (
        <View style={styles.resultStrip}>
          {match.score !== "Freilos" && <Ionicons name="trophy-outline" size={12} color="#F28B25" />}
          <Text style={styles.resultStripScore} numberOfLines={1}>
            {match.score === "Freilos" ? "Freilos" : String(match.score || "Beendet").replace(/\s+/g, "  ·  ")}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function BracketPlayer({ name, winner, external }) {
  return (
    <View style={[styles.bracketPlayer, winner && styles.bracketWinner]}>
      <View style={[styles.miniAvatar, winner && styles.miniAvatarWinner]}><Text style={[styles.miniAvatarText, winner && styles.miniAvatarTextWinner]}>{name ? String(name).charAt(0).toUpperCase() : "–"}</Text></View>
      <Text style={[styles.bracketName, !name && styles.tbd, winner && styles.bracketWinnerName]} numberOfLines={1}>{name || "Noch offen"}</Text>
      {external && <View style={styles.extPill}><Text style={styles.extPillText}>EXT</Text></View>}
      {winner && <Ionicons name="chevron-forward" size={14} color="#F28B25" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738" },
  centered: { alignItems: "center", justifyContent: "center" },
  loadingText: { color: "#9FB0C8", marginTop: 10 },
  header: { paddingTop: 48, paddingHorizontal: 15, paddingBottom: 13, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderBottomColor: "#123356" },
  backBtn: { width: 41, height: 41, borderRadius: 13, backgroundColor: "#08264A", alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#FFFFFF", fontSize: 20.5, lineHeight: 25, fontWeight: "900", letterSpacing: -0.3 },
  trophyBadge: { width: 41, height: 41, borderRadius: 13, backgroundColor: "#302719", borderWidth: 1, borderColor: "#6C4B28", alignItems: "center", justifyContent: "center" },
  drawTabsWrap: { borderBottomWidth: 1, borderBottomColor: "#0F3153" },
  drawTabs: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  drawTab: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, backgroundColor: "#061F40", borderWidth: 1, borderColor: "#153D66", paddingHorizontal: 12, paddingVertical: 9 },
  drawTabActive: { backgroundColor: "#F28B25", borderColor: "#F28B25" },
  drawTabText: { color: "#8FA7C7", fontWeight: "800", fontSize: 11 },
  drawTabTextActive: { color: "#001738" },
  verticalScroll: { flex: 1 },
  verticalContent: { paddingBottom: 24 },
  bracketContent: { paddingLeft: 14, paddingRight: 20, paddingTop: 16, paddingBottom: 20, alignItems: "flex-start" },
  roundSegment: { position: "relative" },
  roundHeader: { height: 52, justifyContent: "center", paddingRight: 8 },
  roundTitle: { color: "#FFFFFF", fontSize: 21, lineHeight: 26, fontWeight: "900", letterSpacing: -0.45 },
  matchesArea: { position: "relative" },
  matchSlot: { justifyContent: "center" },
  connectorH: { position: "absolute", height: 1, backgroundColor: "#31577B" },
  connectorV: { position: "absolute", width: 1, backgroundColor: "#31577B" },
  matchCard: { width: CARD_WIDTH, height: CARD_HEIGHT, backgroundColor: "#051E3B", borderRadius: 14, borderWidth: 1, borderColor: "#173F66", paddingHorizontal: 9, paddingTop: 7, paddingBottom: 6, overflow: "hidden" },
  // Finished matches need a little more vertical room for the score footer.
  // Keeping the footer inside the card prevents the result from looking detached/clipped.
  matchCardCompleted: { height: 112, paddingBottom: 0 },
  matchCardMine: { borderColor: "#B56B29", backgroundColor: "#082442" },
  cardAccent: { position: "absolute", left: 0, top: 11, bottom: 11, width: 2, borderRadius: 2, backgroundColor: "#274C70" },
  matchTop: { height: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 3 },
  matchNo: { color: "#607A99", fontSize: 7.7, fontWeight: "900", letterSpacing: 0.65 },
  pendingPill: { backgroundColor: "#3B2B1A", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  pendingPillText: { color: "#F4A04A", fontSize: 6.8, fontWeight: "900" },
  scheduledPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#0A3443", borderRadius: 999, paddingHorizontal: 5, paddingVertical: 2 },
  scheduledText: { color: "#61D6B1", fontSize: 7.3, fontWeight: "900" },
  openDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#365C7D" },
  bracketPlayer: { height: 27, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 3, borderRadius: 7 },
  bracketWinner: { backgroundColor: "rgba(242,139,37,0.10)" },
  miniAvatar: { width: 20, height: 20, borderRadius: 7, backgroundColor: "#0C2B4B", alignItems: "center", justifyContent: "center" },
  miniAvatarWinner: { backgroundColor: "#F28B25" },
  miniAvatarText: { color: "#8299B7", fontSize: 8.2, fontWeight: "900" },
  miniAvatarTextWinner: { color: "#001738" },
  bracketName: { color: "#DBE7F3", fontSize: 10.7, fontWeight: "800", flex: 1 },
  bracketWinnerName: { color: "#FFFFFF" },
  tbd: { color: "#566F8F", fontWeight: "600" },
  extPill: { backgroundColor: "#342A1C", borderRadius: 5, paddingHorizontal: 4, paddingVertical: 2 },
  extPillText: { color: "#F4A04A", fontSize: 6, fontWeight: "900" },
  divider: { height: 1, backgroundColor: "#123858", marginLeft: 29 },
  resultStrip: { height: 24, marginTop: 4, marginHorizontal: -9, borderTopWidth: 1, borderTopColor: "rgba(242,139,37,0.20)", backgroundColor: "rgba(242,139,37,0.08)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 9 },
  resultStripScore: { color: "#F4A04A", fontSize: 9.8, lineHeight: 13, fontWeight: "900", letterSpacing: 0.12, maxWidth: 178, textAlign: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,9,24,0.78)", alignItems: "center", justifyContent: "center", padding: 14 },
  sheet: { width: "100%", maxWidth: 470, maxHeight: "90%", backgroundColor: "#061E3B", borderRadius: 23, borderWidth: 1, borderColor: "#1A4167", padding: 15 },
  handle: { width: 39, height: 4, borderRadius: 99, backgroundColor: "#294B6D", alignSelf: "center", marginBottom: 14 },
  modalTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  modalIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#302719", borderWidth: 1, borderColor: "#654725", alignItems: "center", justifyContent: "center" },
  modalKicker: { color: "#7D94B1", fontSize: 8.5, fontWeight: "900", textTransform: "uppercase" },
  modalTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", marginTop: 2 },
  playersBox: { borderRadius: 16, backgroundColor: "#03172E", borderWidth: 1, borderColor: "#153A5D", padding: 9 },
  playerLine: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 12, paddingHorizontal: 8 },
  playerWinner: { backgroundColor: "rgba(242,139,37,0.08)" },
  playerAvatar: { width: 31, height: 31, borderRadius: 10, backgroundColor: "#0D2E4F", alignItems: "center", justifyContent: "center" },
  playerAvatarWinner: { backgroundColor: "#F28B25" },
  playerLetter: { color: "#98ADC5", fontWeight: "900", fontSize: 12 },
  playerLetterWinner: { color: "#001738" },
  playerName: { color: "#DDE8F3", fontWeight: "900", fontSize: 12 },
  playerNameWinner: { color: "#FFFFFF" },
  externalTiny: { color: "#F4A04A", fontSize: 7, fontWeight: "900", letterSpacing: 0.5, marginTop: 1 },
  vsBig: { textAlign: "center", color: "#4E6988", fontSize: 8, fontWeight: "900", marginVertical: -3 },
  externalNotice: { marginTop: 10, borderRadius: 13, backgroundColor: "#2B251B", borderWidth: 1, borderColor: "#5B4729", padding: 10, flexDirection: "row", gap: 8, alignItems: "center" },
  externalNoticeTitle: { color: "#F3BD7A", fontSize: 10.5, fontWeight: "900" },
  externalNoticeText: { color: "#B79D7C", fontSize: 8.8, lineHeight: 12, marginTop: 2 },
  scheduleBox: { marginTop: 10, borderRadius: 13, backgroundColor: "#082B3E", padding: 11, flexDirection: "row", alignItems: "center", gap: 9 },
  scheduleTitle: { color: "#DDEAF3", fontSize: 10.5, fontWeight: "900" },
  scheduleMeta: { color: "#61D6B1", fontSize: 9, marginTop: 2 },
  bookBtn: { marginTop: 10, minHeight: 45, borderRadius: 13, backgroundColor: "#61D6B1", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  bookBtnText: { color: "#001738", fontWeight: "900", fontSize: 11 },
  resultBox: { marginTop: 10, borderRadius: 14, backgroundColor: "#2D261B", borderWidth: 1, borderColor: "#604626", padding: 12 },
  resultLabel: { color: "#9D7A50", fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  resultScore: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginTop: 4 },
  resultWinner: { color: "#F2A054", fontSize: 9.5, fontWeight: "800", marginTop: 3 },
  pendingBox: { marginTop: 10, borderRadius: 14, backgroundColor: "#16243A", borderWidth: 1, borderColor: "#405274", padding: 12 },
  pendingLabel: { color: "#899DB7", fontSize: 8, fontWeight: "900", letterSpacing: 0.5 },
  pendingScore: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", marginTop: 4 },
  pendingWinner: { color: "#B5C5D8", fontSize: 9.5, marginTop: 2 },
  pendingHint: { color: "#728AA7", fontSize: 8.5, marginTop: 6 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  rejectBtn: { flex: 1, minHeight: 41, borderRadius: 12, backgroundColor: "#291D29", alignItems: "center", justifyContent: "center" },
  rejectText: { color: "#FF9B9B", fontSize: 10, fontWeight: "900" },
  confirmBtn: { flex: 1.2, minHeight: 41, borderRadius: 12, backgroundColor: "#61D6B1", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  confirmText: { color: "#001738", fontSize: 10, fontWeight: "900" },
  formBox: { marginTop: 12, borderRadius: 15, backgroundColor: "#041A34", borderWidth: 1, borderColor: "#173A5C", padding: 11 },
  formTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "900", marginBottom: 7 },
  fieldLabel: { color: "#7790AD", fontSize: 8.5, fontWeight: "800", marginTop: 7, marginBottom: 5 },
  input: { minHeight: 42, borderRadius: 11, backgroundColor: "#02152B", borderWidth: 1, borderColor: "#163858", paddingHorizontal: 10, color: "#FFFFFF", fontSize: 11 },
  winnerRow: { flexDirection: "row", gap: 7 },
  winnerChip: { flex: 1, minHeight: 41, borderRadius: 11, borderWidth: 1, borderColor: "#1B4165", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, backgroundColor: "#06203C" },
  winnerChipActive: { backgroundColor: "#F28B25", borderColor: "#F28B25" },
  winnerText: { color: "#B6C6D8", fontSize: 9.5, fontWeight: "800", flex: 1 },
  winnerTextActive: { color: "#001738" },
  saveBtn: { marginTop: 10, minHeight: 44, borderRadius: 12, backgroundColor: "#F28B25", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  saveText: { color: "#001738", fontSize: 10.5, fontWeight: "900" },
  formHint: { color: "#647E9B", fontSize: 8.5, lineHeight: 12, marginTop: 6 },
});
