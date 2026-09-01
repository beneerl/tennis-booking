import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  TextInput,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../supabaseClient";
import { getCurrentUserProfile, normalizeUserStatus } from "../authProfile";
import { bracketLabelForSize, buildManualBracketRows, makeId } from "../tournamentUtils";
import TennisLoader from "../components/TennisLoader";

function msg(title, text) {
  if (Platform.OS === "web" && typeof window !== "undefined") window.alert(`${title}\n\n${text}`);
  else Alert.alert(title, text);
}

function confirmDelete(text) {
  if (Platform.OS === "web" && typeof window !== "undefined") return Promise.resolve(window.confirm(text));
  return new Promise((resolve) =>
    Alert.alert("Löschen?", text, [
      { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
      { text: "Löschen", style: "destructive", onPress: () => resolve(true) },
    ])
  );
}

const MAIN_PRESETS = [
  { name: "Herren", type: "main", icon: "trophy-outline", short: "Herren" },
  { name: "Damen", type: "main", icon: "ribbon-outline", short: "Damen" },
];

const SIDE_PRESETS = [
  { name: "Herren Trostrunde", type: "consolation", icon: "shield-outline", short: "Herren · Trost" },
  { name: "Herren Schneiderrunde", type: "other", icon: "git-branch-outline", short: "Herren · Schneider" },
  { name: "Damen Trostrunde", type: "consolation", icon: "shield-outline", short: "Damen · Trost" },
  { name: "Damen Schneiderrunde", type: "other", icon: "git-branch-outline", short: "Damen · Schneider" },
];

const BRACKET_SIZES = [
  { size: 4, label: "4er", round: "Halbfinale" },
  { size: 8, label: "8er", round: "Viertelfinale" },
  { size: 16, label: "16er", round: "Achtelfinale" },
  { size: 32, label: "32er", round: "Sechzehntelfinale" },
];

const emptySlots = (size) => Array.from({ length: size }, () => null);

const drawHasStarted = (matches = []) =>
  matches.some((m) =>
    !!m.booking_group_id ||
    m.status === "scheduled" ||
    m.status === "pending_confirmation" ||
    (m.status === "completed" && String(m.score || "").trim().toLowerCase() !== "freilos")
  );

export default function TournamentAdminScreen({ navigation }) {
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tournaments, setTournaments] = useState([]);
  const [activeTournament, setActiveTournament] = useState(null);
  const [draws, setDraws] = useState([]);
  const [users, setUsers] = useState([]);

  const currentYear = new Date().getFullYear();
  const [tournamentName, setTournamentName] = useState(`Vereinsmeisterschaft ${currentYear}`);
  const [tournamentYear, setTournamentYear] = useState(String(currentYear));

  const [drawName, setDrawName] = useState("Herren");
  const [drawType, setDrawType] = useState("main");
  const [bracketSize, setBracketSize] = useState(16);
  const [slots, setSlots] = useState(() => emptySlots(16));
  const [targetSlot, setTargetSlot] = useState(0);
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [editingDrawId, setEditingDrawId] = useState(null);
  const [editingDrawProtected, setEditingDrawProtected] = useState(false);
  const [editingSnapshot, setEditingSnapshot] = useState(null);
  const [showTournamentEdit, setShowTournamentEdit] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { session, profile } = await getCurrentUserProfile();
        const ok = !!session?.user?.id && !!profile?.is_admin && normalizeUserStatus(profile?.status) !== "blocked";
        setAllowed(ok);
        if (!ok) return;
        await loadAll();
      } catch (e) {
        console.log("Tournament admin access:", e?.message || e);
        setAllowed(false);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: ts, error: tErr }, { data: us, error: uErr }] = await Promise.all([
        supabase.from("tournaments").select("*").order("year", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("users").select("id, auth_id, name, email, status, is_admin").eq("status", "approved").order("name", { ascending: true }),
      ]);
      if (tErr) throw tErr;
      if (uErr) throw uErr;
      const allT = ts || [];
      setTournaments(allT);
      const active = allT.find((t) => t.status === "active") || null;
      setActiveTournament(active);
      setUsers((us || []).filter((u) => u.auth_id && u.name));
      if (active) await loadDraws(active.id);
      else setDraws([]);
    } catch (e) {
      msg("Turnierverwaltung", e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadDraws = async (tournamentId) => {
    const { data, error } = await supabase
      .from("tournament_draws")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    setDraws(data || []);
  };

  const createTournament = async () => {
    const year = Number(tournamentYear);
    if (!tournamentName.trim() || !Number.isFinite(year)) return msg("Hinweis", "Name und Jahr prüfen.");
    setBusy(true);
    try {
      await supabase.from("tournaments").update({ status: "archived" }).eq("status", "active");
      const row = { id: makeId("tournament"), name: tournamentName.trim(), year, status: "active" };
      const { error } = await supabase.from("tournaments").insert(row);
      if (error) throw error;
      resetBuilder();
      await loadAll();
    } catch (e) {
      msg("Turnier konnte nicht erstellt werden", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const finishTournament = async () => {
    if (!activeTournament) return;
    const { error } = await supabase.from("tournaments").update({ status: "completed" }).eq("id", activeTournament.id);
    if (error) return msg("Fehler", error.message);
    await loadAll();
  };

  const choosePreset = (preset) => {
    setDrawName(preset.name);
    setDrawType(preset.type);
  };

  const resetBuilder = (size = bracketSize) => {
    setSlots(emptySlots(size));
    setTargetSlot(0);
    setSearch("");
    setManualName("");
  };

  const changeBracketSize = (size) => {
    if (editingDrawProtected) return;
    setBracketSize(size);
    setSlots((prev) => Array.from({ length: size }, (_, i) => prev[i] || null));
    setTargetSlot((prev) => Math.min(prev, size - 1));
  };

  const nextEmptyAfter = (arr, start) => {
    for (let step = 1; step <= arr.length; step += 1) {
      const idx = (start + step) % arr.length;
      if (!arr[idx]) return idx;
    }
    return start;
  };

  const placeEntry = (entry) => {
    if (editingDrawProtected) return;
    setSlots((prev) => {
      const copy = [...prev];
      if (entry.auth_id) {
        const old = copy.findIndex((x) => x?.auth_id === entry.auth_id);
        if (old >= 0 && old !== targetSlot) copy[old] = null;
      }
      copy[targetSlot] = entry;
      setTargetSlot(nextEmptyAfter(copy, targetSlot));
      return copy;
    });
  };

  const addMember = (u) => {
    placeEntry({
      participant_id: makeId("participant"),
      auth_id: u.auth_id,
      name: u.name,
      external: false,
    });
  };

  const addManual = () => {
    const name = manualName.trim();
    if (!name) return;
    placeEntry({ participant_id: makeId("external"), auth_id: null, name, external: true });
    setManualName("");
  };

  const clearSlot = (index) => {
    if (editingDrawProtected) return;
    setSlots((prev) => prev.map((entry, i) => (i === index ? null : entry)));
    setTargetSlot(index);
  };

  const swapSlots = (a, b) => {
    if (editingDrawProtected) return;
    if (a < 0 || b < 0 || a >= slots.length || b >= slots.length) return;
    setSlots((prev) => {
      const copy = [...prev];
      [copy[a], copy[b]] = [copy[b], copy[a]];
      return copy;
    });
  };

  const beginNewDraw = () => {
    setEditingDrawId(null);
    setEditingDrawProtected(false);
    setEditingSnapshot(null);
    setDrawName("Herren");
    setDrawType("main");
    setBracketSize(16);
    resetBuilder(16);
  };

  const startEditTournament = () => {
    if (!activeTournament) return;
    setTournamentName(activeTournament.name || "");
    setTournamentYear(String(activeTournament.year || currentYear));
    setShowTournamentEdit(true);
  };

  const saveTournamentMeta = async () => {
    if (!activeTournament) return;
    const year = Number(tournamentYear);
    if (!tournamentName.trim() || !Number.isFinite(year)) return msg("Hinweis", "Name und Jahr prüfen.");
    setBusy(true);
    try {
      const { error } = await supabase
        .from("tournaments")
        .update({ name: tournamentName.trim(), year })
        .eq("id", activeTournament.id);
      if (error) throw error;
      setShowTournamentEdit(false);
      await loadAll();
    } catch (e) {
      msg("Meisterschaft konnte nicht geändert werden", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const startEditDraw = async (draw) => {
    setBusy(true);
    try {
      const [{ data: participants, error: pErr }, { data: matches, error: mErr }] = await Promise.all([
        supabase.from("tournament_participants").select("*").eq("draw_id", draw.id).order("seed", { ascending: true }),
        supabase.from("tournament_matches").select("*").eq("draw_id", draw.id).order("round_index", { ascending: true }).order("match_index", { ascending: true }),
      ]);
      if (pErr) throw pErr;
      if (mErr) throw mErr;

      const size = Number(draw.bracket_size) || 16;
      const participantRows = participants || [];
      const allMatches = matches || [];
      const firstRound = allMatches.filter((m) => Number(m.round_index) === 0).sort((a, b) => a.match_index - b.match_index);
      const participantById = new Map(participantRows.map((x) => [x.id, x]));

      const findParticipant = (participantId, authId, name) => {
        if (participantId && participantById.has(participantId)) return participantById.get(participantId);
        if (authId) {
          const byAuth = participantRows.find((x) => x.user_auth_id === authId);
          if (byAuth) return byAuth;
        }
        if (name) {
          const byName = participantRows.find((x) => x.display_name === name);
          if (byName) return byName;
        }
        return null;
      };

      const loadedSlots = emptySlots(size);
      firstRound.forEach((m) => {
        [1, 2].forEach((side) => {
          const index = Number(m.match_index) * 2 + (side - 1);
          if (index < 0 || index >= size) return;
          const name = m[`player${side}_name`];
          const authId = m[`player${side}_auth_id`];
          const participantId = m[`player${side}_participant_id`];
          if (!name && !authId && !participantId) return;
          const participant = findParticipant(participantId, authId, name);
          loadedSlots[index] = {
            participant_id: participant?.id || participantId || makeId("participant"),
            auth_id: participant?.user_auth_id || authId || null,
            name: participant?.display_name || name || "Spieler",
            external: !(participant?.user_auth_id || authId),
          };
        });
      });

      participantRows.forEach((participant) => {
        const seedIndex = Number(participant.seed) - 1;
        if (seedIndex >= 0 && seedIndex < size && !loadedSlots[seedIndex]) {
          loadedSlots[seedIndex] = {
            participant_id: participant.id,
            auth_id: participant.user_auth_id || null,
            name: participant.display_name,
            external: !participant.user_auth_id,
          };
        }
      });

      const protectedEdit = drawHasStarted(allMatches);
      setEditingDrawId(draw.id);
      setEditingDrawProtected(protectedEdit);
      setEditingSnapshot({
        draw: { ...draw },
        participants: participantRows.map((x) => ({ ...x })),
        matches: allMatches.map((x) => ({ ...x })),
      });
      setDrawName(draw.name || "");
      setDrawType(draw.draw_type || "main");
      setBracketSize(size);
      setSlots(loadedSlots);
      const firstEmpty = loadedSlots.findIndex((x) => !x);
      setTargetSlot(firstEmpty >= 0 ? firstEmpty : 0);
      setSearch("");
      setManualName("");
      msg(
        protectedEdit ? "Turnierbaum geöffnet" : "Turnierbaum bearbeiten",
        protectedEdit
          ? "Es gibt bereits Ergebnisse oder Buchungen. Name und Bereich kannst du weiter ändern; Paarungen und Feldgröße bleiben zum Schutz des laufenden Turniers gesperrt."
          : "Du kannst Feldgröße, Paarungen, App-Mitglieder und externe Spieler jetzt nachträglich ändern."
      );
    } catch (e) {
      msg("Turnierbaum konnte nicht geladen werden", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const restoreEditingSnapshot = async () => {
    const snap = editingSnapshot;
    if (!snap?.draw?.id) return;
    try {
      await supabase.from("tournament_matches").delete().eq("draw_id", snap.draw.id);
      await supabase.from("tournament_participants").delete().eq("draw_id", snap.draw.id);
      await supabase.from("tournament_draws").update({
        name: snap.draw.name,
        draw_type: snap.draw.draw_type,
        bracket_size: snap.draw.bracket_size,
        sort_order: snap.draw.sort_order,
      }).eq("id", snap.draw.id);
      if (snap.participants?.length) await supabase.from("tournament_participants").insert(snap.participants);
      if (snap.matches?.length) await supabase.from("tournament_matches").insert(snap.matches);
    } catch (restoreError) {
      console.log("Turnierbaum Wiederherstellung fehlgeschlagen:", restoreError?.message || restoreError);
    }
  };

  const createDraw = async () => {
    if (!activeTournament) return msg("Hinweis", "Zuerst eine Vereinsmeisterschaft anlegen.");
    if (!drawName.trim()) return msg("Hinweis", "Name des Turnierbaums fehlt.");

    if (editingDrawId && editingDrawProtected) {
      setBusy(true);
      try {
        const { error } = await supabase
          .from("tournament_draws")
          .update({ name: drawName.trim(), draw_type: drawType })
          .eq("id", editingDrawId);
        if (error) throw error;
        msg("Änderungen gespeichert", "Name und Bereich des laufenden Turnierbaums wurden aktualisiert.");
        beginNewDraw();
        await loadDraws(activeTournament.id);
      } catch (e) {
        msg("Änderung fehlgeschlagen", e?.message || String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    const occupied = slots.filter(Boolean);
    if (occupied.length < 2) return msg("Hinweis", "Mindestens zwei Spieler eintragen.");

    const emptyPairs = [];
    for (let i = 0; i < bracketSize; i += 2) {
      if (!slots[i] && !slots[i + 1]) emptyPairs.push(i / 2 + 1);
    }
    if (emptyPairs.length) {
      return msg(
        "Feld noch zu groß",
        `In Erstrunden-Match ${emptyPairs.join(", ")} steht noch niemand. Bitte kleineres Feld wählen oder Teilnehmer so verteilen, dass jedes Match mindestens einen Spieler enthält.`
      );
    }

    setBusy(true);
    const drawId = editingDrawId || makeId("draw");
    try {
      if (editingDrawId) {
        const { data: freshMatches, error: freshErr } = await supabase
          .from("tournament_matches")
          .select("id,status,score,booking_group_id")
          .eq("draw_id", editingDrawId);
        if (freshErr) throw freshErr;
        if (drawHasStarted(freshMatches || [])) {
          setEditingDrawProtected(true);
          throw new Error("Der Turnierbaum wurde inzwischen begonnen. Paarungen können deshalb nicht mehr komplett neu aufgebaut werden.");
        }
      }

      const participantRows = occupied.map((p) => ({
        id: p.participant_id,
        draw_id: drawId,
        user_auth_id: p.auth_id || null,
        display_name: p.name,
        seed: slots.findIndex((x) => x?.participant_id === p.participant_id) + 1,
      }));

      const { rows } = buildManualBracketRows({ drawId, slots, bracketSize });
      const drawRow = {
        id: drawId,
        tournament_id: activeTournament.id,
        name: drawName.trim(),
        draw_type: drawType,
        sort_order: draws.length,
        bracket_size: bracketSize,
      };

      if (editingDrawId) {
        const delMatches = await supabase.from("tournament_matches").delete().eq("draw_id", drawId);
        if (delMatches.error) throw delMatches.error;
        const delParticipants = await supabase.from("tournament_participants").delete().eq("draw_id", drawId);
        if (delParticipants.error) throw delParticipants.error;
        const d = await supabase.from("tournament_draws").update({
          name: drawRow.name,
          draw_type: drawRow.draw_type,
          bracket_size: drawRow.bracket_size,
        }).eq("id", drawId);
        if (d.error) throw d.error;
      } else {
        const d = await supabase.from("tournament_draws").insert(drawRow);
        if (d.error) throw d.error;
      }

      const p = await supabase.from("tournament_participants").insert(participantRows);
      if (p.error) throw p.error;
      const m = await supabase.from("tournament_matches").insert(rows);
      if (m.error) throw m.error;

      const savedName = drawName.trim();
      const savedSize = bracketSize;
      const wasEditing = !!editingDrawId;
      beginNewDraw();
      await loadDraws(activeTournament.id);
      msg(
        wasEditing ? "Turnierbaum aktualisiert" : "Turnierbaum erstellt",
        `${savedName} · ${savedSize}er Feld · ${occupied.length} Teilnehmer.`
      );
    } catch (e) {
      if (editingDrawId) {
        await restoreEditingSnapshot();
      } else {
        try { await supabase.from("tournament_draws").delete().eq("id", drawId); } catch {}
      }
      msg(editingDrawId ? "Turnierbaum konnte nicht geändert werden" : "Turnierbaum konnte nicht erstellt werden", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteDraw = async (draw) => {
    const ok = await confirmDelete(`Turnierbaum „${draw.name}“ inklusive aller Matches und Ergebnisse löschen?`);
    if (!ok) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("tournament_draws").delete().eq("id", draw.id);
      if (error) throw error;
      await loadDraws(activeTournament.id);
    } catch (e) {
      msg("Löschen fehlgeschlagen", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const reopenTournamentForEdit = async (tournament) => {
    if (!tournament?.id) return;

    const switchNeeded = activeTournament && activeTournament.id !== tournament.id;
    let ok = true;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      ok = window.confirm(
        switchNeeded
          ? `„${tournament.name}“ zum Bearbeiten öffnen?\n\nDie aktuell aktive Meisterschaft wird dabei archiviert.`
          : `„${tournament.name}“ wieder zum Bearbeiten öffnen?`
      );
    } else {
      ok = await new Promise((resolve) =>
        Alert.alert(
          "Meisterschaft öffnen?",
          switchNeeded
            ? `„${tournament.name}“ wird aktiv gesetzt. Die aktuell aktive Meisterschaft wird archiviert.`
            : `„${tournament.name}“ wird wieder aktiv gesetzt und kann danach bearbeitet werden.`,
          [
            { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
            { text: "Öffnen", onPress: () => resolve(true) },
          ]
        )
      );
    }
    if (!ok) return;

    setBusy(true);
    try {
      if (switchNeeded) {
        const { error: archiveErr } = await supabase
          .from("tournaments")
          .update({ status: "archived" })
          .eq("id", activeTournament.id);
        if (archiveErr) throw archiveErr;
      }

      const { error } = await supabase
        .from("tournaments")
        .update({ status: "active" })
        .eq("id", tournament.id);
      if (error) throw error;

      setShowTournamentEdit(false);
      beginNewDraw();
      await loadAll();
    } catch (e) {
      msg("Meisterschaft konnte nicht geöffnet werden", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => !q || u.name.toLowerCase().includes(q));
  }, [users, search]);

  const occupiedCount = slots.filter(Boolean).length;
  const currentRoundLabel = bracketLabelForSize(bracketSize);

  if (checking || loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <TennisLoader />
      </View>
    );
  }

  if (!allowed) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="lock-closed-outline" size={30} color="#F28B25" />
        <Text style={styles.denied}>Kein Admin-Zugriff.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}><Text style={styles.primaryText}>Zurück</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={22} color="#FFFFFF" /></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={styles.headerKicker}>ADMIN CENTER</Text><Text style={styles.headerTitle}>Vereinsmeisterschaft</Text></View>
        <View style={styles.adminIcon}><Ionicons name="trophy-outline" size={19} color="#F28B25" /></View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!activeTournament ? (
          <>
            <View style={styles.hero}><Ionicons name="sparkles-outline" size={24} color="#F28B25" /><View style={{ flex: 1 }}><Text style={styles.heroTitle}>Neue Meisterschaft starten</Text><Text style={styles.heroText}>Lege zuerst die Meisterschaft an. Die einzelnen Turnierbäume kannst du danach komplett selbst zusammenstellen.</Text></View></View>
            <Text style={styles.sectionTitle}>Turnier anlegen</Text>
            <View style={styles.panel}>
              <Text style={styles.label}>Name</Text>
              <TextInput style={styles.input} value={tournamentName} onChangeText={setTournamentName} placeholder="Vereinsmeisterschaft 2026" placeholderTextColor="#607A99" />
              <Text style={styles.label}>Jahr</Text>
              <TextInput style={styles.input} value={tournamentYear} onChangeText={setTournamentYear} keyboardType="number-pad" />
              <TouchableOpacity style={styles.primaryBtn} onPress={createTournament} disabled={busy}><Ionicons name="add-circle-outline" size={18} color="#001738" /><Text style={styles.primaryText}>{busy ? "Erstelle …" : "Meisterschaft starten"}</Text></TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <View style={styles.activeHero}>
              <View style={styles.activeTrophy}><Ionicons name="trophy" size={22} color="#001738" /></View>
              <View style={{ flex: 1 }}><Text style={styles.activeYear}>{activeTournament.year} · AKTIV</Text><Text style={styles.activeTitle}>{activeTournament.name}</Text><Text style={styles.activeSub}>{draws.length} Turnierbäume</Text></View>
              <View style={styles.heroActions}>
                <TouchableOpacity style={styles.finishBtn} onPress={startEditTournament}><Ionicons name="pencil-outline" size={18} color="#B9CAE0" /></TouchableOpacity>
                <TouchableOpacity style={styles.finishBtn} onPress={finishTournament}><Ionicons name="checkmark-done-outline" size={20} color="#8FA7C7" /></TouchableOpacity>
              </View>
            </View>

            {showTournamentEdit && (
              <View style={[styles.panel, { marginBottom: 18 }]}>
                <View style={styles.editPanelHeader}>
                  <View><Text style={styles.miniKicker}>MEISTERSCHAFT BEARBEITEN</Text><Text style={styles.editPanelTitle}>Name & Jahr ändern</Text></View>
                  <TouchableOpacity onPress={() => setShowTournamentEdit(false)}><Ionicons name="close-circle-outline" size={22} color="#6F86A5" /></TouchableOpacity>
                </View>
                <Text style={styles.label}>Name</Text>
                <TextInput style={styles.input} value={tournamentName} onChangeText={setTournamentName} />
                <Text style={styles.label}>Jahr</Text>
                <TextInput style={styles.input} value={tournamentYear} onChangeText={setTournamentYear} keyboardType="number-pad" />
                <TouchableOpacity style={styles.primaryBtn} onPress={saveTournamentMeta} disabled={busy}>
                  <Ionicons name="save-outline" size={18} color="#001738" />
                  <Text style={styles.primaryText}>Meisterschaft speichern</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.sectionTitle}>Bestehende Turnierbäume</Text>
            {draws.length === 0 ? <Text style={styles.empty}>Noch kein Turnierbaum angelegt.</Text> : draws.map((draw) => (
              <View key={draw.id} style={styles.drawRow}>
                <View style={styles.drawIcon}><Ionicons name={draw.draw_type === "consolation" ? "shield-outline" : "git-network-outline"} size={19} color="#F28B25" /></View>
                <View style={{ flex: 1 }}><Text style={styles.drawName}>{draw.name}</Text><Text style={styles.drawMeta}>{draw.bracket_size}er Feld · {bracketLabelForSize(draw.bracket_size)}</Text></View>
                <TouchableOpacity style={styles.smallBtn} onPress={() => startEditDraw(draw)}><Ionicons name="pencil-outline" size={17} color="#F5A04A" /></TouchableOpacity>
                <TouchableOpacity style={styles.smallBtn} onPress={() => navigation.navigate("TournamentBracket", { drawId: draw.id })}><Ionicons name="eye-outline" size={18} color="#B7C8DB" /></TouchableOpacity>
                <TouchableOpacity style={styles.smallDanger} onPress={() => deleteDraw(draw)}><Ionicons name="trash-outline" size={17} color="#FF8A8A" /></TouchableOpacity>
              </View>
            ))}

            <View style={styles.builderHeadingRow}>
              <Text style={[styles.sectionTitle, { marginTop: 22, marginBottom: 0 }]}>{editingDrawId ? "Turnierbaum bearbeiten" : "Neuen Turnierbaum bauen"}</Text>
              {editingDrawId && (
                <TouchableOpacity style={styles.cancelEditBtn} onPress={beginNewDraw}>
                  <Ionicons name="close-outline" size={16} color="#AFC0D5" />
                  <Text style={styles.cancelEditText}>Abbrechen</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.builderPanel}>
              {editingDrawId && (
                <View style={[styles.editInfo, editingDrawProtected && styles.editInfoProtected]}>
                  <Ionicons name={editingDrawProtected ? "lock-closed-outline" : "create-outline"} size={18} color={editingDrawProtected ? "#F0B36A" : "#67D4B2"} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.editInfoTitle}>{editingDrawProtected ? "Laufender Turnierbaum" : "Nachträglich vollständig bearbeitbar"}</Text>
                    <Text style={styles.editInfoText}>
                      {editingDrawProtected
                        ? "Ergebnisse oder Buchungen existieren bereits. Paarungen und Feldgröße sind deshalb geschützt; Name und Bereich kannst du weiterhin ändern."
                        : "Dieser Baum ist noch nicht gestartet. Du kannst Spieler, externe Teilnehmer, Paarungen und Feldgröße frei ändern."}
                    </Text>
                  </View>
                </View>
              )}
              <Text style={styles.miniKicker}>1 · BEREICH</Text>
              <Text style={styles.presetGroupLabel}>Hauptfelder</Text>
              <View style={styles.presetRow}>
                {MAIN_PRESETS.map((p) => {
                  const active = drawName === p.name && drawType === p.type;
                  return (
                    <TouchableOpacity key={p.name} style={[styles.preset, active && styles.presetActive]} onPress={() => choosePreset(p)}>
                      <Ionicons name={p.icon} size={18} color={active ? "#001738" : "#8EA5C1"} />
                      <Text style={[styles.presetText, active && styles.presetTextActive]}>{p.short}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.presetGroupLabel, { marginTop: 10 }]}>Nebenrunden</Text>
              <View style={styles.presetGrid}>
                {SIDE_PRESETS.map((p) => {
                  const active = drawName === p.name && drawType === p.type;
                  return (
                    <TouchableOpacity key={p.name} style={[styles.sidePreset, active && styles.presetActive]} onPress={() => choosePreset(p)}>
                      <Ionicons name={p.icon} size={17} color={active ? "#001738" : p.type === "consolation" ? "#8FB4D5" : "#B7A1D8"} />
                      <Text style={[styles.sidePresetText, active && styles.presetTextActive]}>{p.short}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.roundInfo}>
                <Ionicons name="add-circle-outline" size={16} color="#67D4B2" />
                <Text style={styles.roundInfoText}>Du kannst beliebig viele Nebenrunden anlegen. Für Sonderfälle den Namen unten einfach frei überschreiben.</Text>
              </View>
              <Text style={styles.label}>Name des Turnierbaums</Text>
              <TextInput style={styles.input} value={drawName} onChangeText={setDrawName} placeholder="z. B. Damen Schneiderrunde" placeholderTextColor="#607A99" />

              <Text style={[styles.miniKicker, { marginTop: 18 }]}>2 · FELDGRÖSSE</Text>
              <View style={styles.sizeRow}>{BRACKET_SIZES.map((item) => {
                const active = bracketSize === item.size;
                return <TouchableOpacity key={item.size} style={[styles.sizeChip, active && styles.sizeChipActive, editingDrawProtected && styles.disabledChip]} onPress={() => changeBracketSize(item.size)} disabled={editingDrawProtected}><Text style={[styles.sizeNo, active && styles.sizeNoActive]}>{item.label}</Text><Text style={[styles.sizeRound, active && styles.sizeRoundActive]}>{item.round}</Text></TouchableOpacity>;
              })}</View>
              <View style={styles.infoStrip}><Ionicons name="information-circle-outline" size={17} color="#67D4B2" /><Text style={styles.infoText}>{bracketSize}er Feld startet im {currentRoundLabel}. Leere Einzelplätze werden als Freilos behandelt.</Text></View>

              <View style={styles.builderTitleRow}>
                <View><Text style={styles.miniKicker}>3 · AUSLOSUNG / PAARUNGEN</Text><Text style={styles.builderHint}>Spielerplatz antippen und anschließend Mitglied oder externen Spieler auswählen.</Text></View>
                <View style={styles.countPill}><Text style={styles.countText}>{occupiedCount}/{bracketSize}</Text></View>
              </View>

              <View style={styles.matchSetupList}>
                {Array.from({ length: bracketSize / 2 }, (_, matchIndex) => (
                  <View key={matchIndex} style={styles.setupMatch}>
                    <View style={styles.setupMatchHeader}><Text style={styles.setupMatchNo}>{currentRoundLabel.toUpperCase()} · MATCH {matchIndex + 1}</Text><View style={styles.matchLine} /></View>
                    {[0, 1].map((side) => {
                      const index = matchIndex * 2 + side;
                      const entry = slots[index];
                      const targeted = targetSlot === index;
                      return (
                        <TouchableOpacity key={side} style={[styles.slotRow, targeted && styles.slotRowTarget, entry && styles.slotRowFilled, editingDrawProtected && styles.protectedSlot]} onPress={() => !editingDrawProtected && setTargetSlot(index)} activeOpacity={0.85} disabled={editingDrawProtected}>
                          <View style={[styles.slotNo, targeted && styles.slotNoTarget]}><Text style={[styles.slotNoText, targeted && styles.slotNoTextTarget]}>{index + 1}</Text></View>
                          <View style={{ flex: 1 }}>
                            {entry ? <><Text style={styles.slotName} numberOfLines={1}>{entry.name}</Text><View style={styles.slotMetaRow}><Ionicons name={entry.auth_id ? "phone-portrait-outline" : "person-outline"} size={11} color={entry.auth_id ? "#61D6B1" : "#F4A04A"} /><Text style={[styles.slotMeta, !entry.auth_id && styles.externalMeta]}>{entry.auth_id ? "App-Mitglied" : "Extern · Ergebnis durch Admin"}</Text></View></> : <><Text style={styles.slotEmpty}>Spieler auswählen</Text><Text style={styles.slotEmptySub}>{targeted ? "Auswahl wird hier eingefügt" : "Antippen zum Befüllen"}</Text></>}
                          </View>
                          {entry ? <TouchableOpacity onPress={() => clearSlot(index)} hitSlop={10}><Ionicons name="close-circle" size={20} color="#6F86A5" /></TouchableOpacity> : <Ionicons name={targeted ? "radio-button-on" : "radio-button-off"} size={18} color={targeted ? "#F28B25" : "#4F6B8B"} />}
                        </TouchableOpacity>
                      );
                    })}
                    <View style={styles.swapRow}>
                      <TouchableOpacity style={[styles.swapBtn, editingDrawProtected && styles.disabledChip]} onPress={() => swapSlots(matchIndex * 2, matchIndex * 2 + 1)} disabled={editingDrawProtected}><Ionicons name="swap-vertical-outline" size={14} color="#7890AD" /><Text style={styles.swapText}>Seiten tauschen</Text></TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>

              {!editingDrawProtected && (
                <>
              <Text style={[styles.miniKicker, { marginTop: 18 }]}>4 · SPIELER HINZUFÜGEN</Text>
              <View style={styles.externalBox}>
                <View style={styles.externalIcon}><Ionicons name="person-add-outline" size={18} color="#F4A04A" /></View>
                <TextInput style={styles.externalInput} value={manualName} onChangeText={setManualName} placeholder="Spieler nicht in der App …" placeholderTextColor="#607A99" onSubmitEditing={addManual} />
                <TouchableOpacity style={styles.externalAdd} onPress={addManual}><Ionicons name="add" size={20} color="#001738" /></TouchableOpacity>
              </View>
              <Text style={styles.externalHint}>Externe Spieler erscheinen normal im Baum. Ergebnisse ihrer Matches kann nur ein Admin offiziell eintragen.</Text>

              <View style={styles.searchBox}><Ionicons name="search-outline" size={17} color="#6F86A5" /><TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="App-Mitglieder suchen …" placeholderTextColor="#607A99" /></View>
              <View style={styles.usersList}>{filteredUsers.map((u) => {
                const usedAt = slots.findIndex((x) => x?.auth_id === u.auth_id);
                return (
                  <TouchableOpacity key={u.auth_id} style={[styles.userRow, usedAt >= 0 && styles.userRowUsed]} onPress={() => addMember(u)}>
                    <View style={[styles.avatar, usedAt >= 0 && styles.avatarUsed]}><Text style={[styles.avatarText, usedAt >= 0 && styles.avatarTextUsed]}>{u.name.charAt(0).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}><Text style={styles.userName}>{u.name}</Text>{usedAt >= 0 && <Text style={styles.usedText}>bereits auf Position {usedAt + 1} · Antippen verschiebt</Text>}</View>
                    <Ionicons name="add-circle-outline" size={20} color="#7189A8" />
                  </TouchableOpacity>
                );
              })}</View>
                </>
              )}

              <TouchableOpacity style={[styles.primaryBtn, !editingDrawProtected && occupiedCount < 2 && styles.disabled]} onPress={createDraw} disabled={busy || (!editingDrawProtected && occupiedCount < 2)}>
                <Ionicons name="git-network-outline" size={18} color="#001738" />
                <Text style={styles.primaryText}>{busy ? "Speichere …" : editingDrawId ? "Änderungen speichern" : `${drawName || "Turnierbaum"} erstellen`}</Text>
              </TouchableOpacity>
              <Text style={styles.note}>{editingDrawId ? "Bestehende Turnierbäume kannst du jederzeit wieder über das Stift-Symbol öffnen. Sobald Ergebnisse oder Buchungen existieren, schützt die App die laufenden Paarungen vor versehentlichen Änderungen." : "Die Positionen oben sind exakt die erste Runde des späteren Turnierbaums. Du bestimmst also selbst, wer gegen wen startet."}</Text>
            </View>
          </>
        )}

        {tournaments.filter((t) => t.id !== activeTournament?.id).length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Bestehende / frühere Turniere</Text>
            {tournaments.filter((t) => t.id !== activeTournament?.id).slice(0, 10).map((t) => (
              <View key={t.id} style={styles.archiveRow}>
                <Ionicons name={t.status === "completed" ? "checkmark-circle-outline" : "archive-outline"} size={17} color="#6F86A4" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.archiveName}>{t.name}</Text>
                  <Text style={styles.archiveStatus}>{t.status === "completed" ? "Abgeschlossen" : t.status === "archived" ? "Archiviert" : "Entwurf"}</Text>
                </View>
                <Text style={styles.archiveYear}>{t.year}</Text>
                <TouchableOpacity style={styles.archiveEditBtn} onPress={() => reopenTournamentForEdit(t)} disabled={busy}>
                  <Ionicons name="pencil-outline" size={17} color="#F5A04A" />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738" },
  centered: { alignItems: "center", justifyContent: "center", padding: 24 },
  loadingText: { color: "#9FB0C8", marginTop: 10 },
  denied: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", marginVertical: 15 },
  header: { paddingTop: 48, paddingHorizontal: 15, paddingBottom: 13, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderBottomColor: "#123356" },
  backBtn: { width: 41, height: 41, borderRadius: 13, backgroundColor: "#08264A", alignItems: "center", justifyContent: "center" },
  headerKicker: { color: "#748CAA", fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  headerTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "900", marginTop: 2 },
  adminIcon: { width: 41, height: 41, borderRadius: 13, backgroundColor: "#302719", borderWidth: 1, borderColor: "#6C4B28", alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  content: { padding: 15, paddingBottom: 45 },
  hero: { backgroundColor: "#061F40", borderRadius: 18, borderWidth: 1, borderColor: "#163E66", padding: 15, flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 18 },
  heroTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  heroText: { color: "#8399B6", fontSize: 10.5, lineHeight: 15, marginTop: 3 },
  activeHero: { backgroundColor: "#07264A", borderRadius: 20, borderWidth: 1, borderColor: "#1A4A76", padding: 15, flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 20 },
  activeTrophy: { width: 46, height: 46, borderRadius: 15, backgroundColor: "#F28B25", alignItems: "center", justifyContent: "center" },
  activeYear: { color: "#F6A04A", fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  activeTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", marginTop: 2 },
  activeSub: { color: "#8EA6C3", fontSize: 10, marginTop: 2 },
  finishBtn: { width: 37, height: 37, borderRadius: 12, backgroundColor: "#0C3155", alignItems: "center", justifyContent: "center" },
  heroActions: { flexDirection: "row", gap: 7 },
  editPanelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  editPanelTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "900", marginTop: 2 },
  builderHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 9 },
  cancelEditBtn: { marginTop: 22, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: "#0A2B4D" },
  cancelEditText: { color: "#AFC0D5", fontSize: 9.5, fontWeight: "800" },
  editInfo: { flexDirection: "row", gap: 9, alignItems: "flex-start", backgroundColor: "rgba(70,185,151,0.08)", borderWidth: 1, borderColor: "rgba(103,212,178,0.25)", borderRadius: 13, padding: 11, marginBottom: 14 },
  editInfoProtected: { backgroundColor: "rgba(242,139,37,0.07)", borderColor: "rgba(242,139,37,0.26)" },
  editInfoTitle: { color: "#EAF2FB", fontSize: 10.5, fontWeight: "900" },
  editInfoText: { color: "#8399B6", fontSize: 9.5, lineHeight: 14, marginTop: 2 },
  protectedSlot: { opacity: 0.78 },
  disabledChip: { opacity: 0.45 },
  sectionTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", marginBottom: 9 },
  panel: { backgroundColor: "#061F40", borderRadius: 18, borderWidth: 1, borderColor: "#163D64", padding: 13 },
  builderPanel: { backgroundColor: "#041B37", borderRadius: 20, borderWidth: 1, borderColor: "#183D61", padding: 13 },
  label: { color: "#8299B7", fontSize: 9.5, fontWeight: "800", marginBottom: 6, marginTop: 9 },
  input: { backgroundColor: "#02172F", borderRadius: 12, borderWidth: 1, borderColor: "#163A5E", color: "#FFFFFF", minHeight: 43, paddingHorizontal: 12, fontSize: 12 },
  primaryBtn: { marginTop: 14, backgroundColor: "#F28B25", borderRadius: 13, minHeight: 47, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12 },
  primaryText: { color: "#001738", fontWeight: "900", fontSize: 11.5 },
  disabled: { opacity: 0.45 },
  drawRow: { backgroundColor: "#061E3B", borderRadius: 15, borderWidth: 1, borderColor: "#153A5D", padding: 11, flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 8 },
  drawIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#302719", alignItems: "center", justifyContent: "center" },
  drawName: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  drawMeta: { color: "#7189A7", fontSize: 9.5, marginTop: 2 },
  smallBtn: { width: 35, height: 35, borderRadius: 11, backgroundColor: "#0A2B4D", alignItems: "center", justifyContent: "center" },
  smallDanger: { width: 35, height: 35, borderRadius: 11, backgroundColor: "#2A1B25", alignItems: "center", justifyContent: "center" },
  empty: { color: "#7189A7", fontSize: 11, marginBottom: 12 },
  miniKicker: { color: "#6E88A8", fontSize: 9, fontWeight: "900", letterSpacing: 0.9, marginBottom: 8 },
  presetGroupLabel: { color: "#8EA5C1", fontSize: 10, fontWeight: "800", marginBottom: 7 },
  presetRow: { flexDirection: "row", gap: 7 },
  preset: { flex: 1, minHeight: 58, borderRadius: 13, borderWidth: 1, borderColor: "#183B5F", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#061F3B" },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  sidePreset: { width: "48%", flexGrow: 1, minHeight: 56, borderRadius: 13, borderWidth: 1, borderColor: "#183B5F", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#061F3B", paddingHorizontal: 8 },
  sidePresetText: { color: "#8EA5C1", fontSize: 9.5, fontWeight: "900", textAlign: "center" },
  presetActive: { backgroundColor: "#F28B25", borderColor: "#F28B25" },
  presetText: { color: "#8EA5C1", fontSize: 10, fontWeight: "900" },
  presetTextActive: { color: "#001738" },
  roundInfo: { marginTop: 9, backgroundColor: "#062640", borderRadius: 11, paddingHorizontal: 10, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  roundInfoText: { color: "#85A2BB", fontSize: 9.5, lineHeight: 13, flex: 1 },
  sizeRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  sizeChip: { minWidth: 78, flexGrow: 1, backgroundColor: "#061F3B", borderWidth: 1, borderColor: "#173C60", borderRadius: 12, paddingVertical: 9, paddingHorizontal: 9 },
  sizeChipActive: { backgroundColor: "#0D3153", borderColor: "#F28B25" },
  sizeNo: { color: "#B6C7D9", fontSize: 12, fontWeight: "900" },
  sizeNoActive: { color: "#F4A04A" },
  sizeRound: { color: "#627D9E", fontSize: 8.5, marginTop: 2 },
  sizeRoundActive: { color: "#9FB4CB" },
  infoStrip: { marginTop: 9, borderRadius: 11, backgroundColor: "#062640", flexDirection: "row", gap: 7, alignItems: "center", padding: 10 },
  infoText: { color: "#85A2BB", fontSize: 9.5, lineHeight: 13, flex: 1 },
  builderTitleRow: { marginTop: 18, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  builderHint: { color: "#637E9E", fontSize: 9.5, lineHeight: 13, maxWidth: 280 },
  countPill: { minWidth: 42, height: 27, borderRadius: 999, backgroundColor: "#102F50", alignItems: "center", justifyContent: "center" },
  countText: { color: "#F28B25", fontWeight: "900", fontSize: 10 },
  matchSetupList: { gap: 9, marginTop: 10 },
  setupMatch: { borderRadius: 15, borderWidth: 1, borderColor: "#173B5F", backgroundColor: "#03182F", padding: 8 },
  setupMatchHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  setupMatchNo: { color: "#637D9D", fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  matchLine: { flex: 1, height: 1, backgroundColor: "#123554" },
  slotRow: { minHeight: 50, borderRadius: 11, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "transparent" },
  slotRowTarget: { borderColor: "#F28B25", backgroundColor: "rgba(242,139,37,0.06)" },
  slotRowFilled: { backgroundColor: "#061F3C" },
  slotNo: { width: 28, height: 28, borderRadius: 9, backgroundColor: "#0D2B4A", alignItems: "center", justifyContent: "center" },
  slotNoTarget: { backgroundColor: "#F28B25" },
  slotNoText: { color: "#7E96B3", fontSize: 9, fontWeight: "900" },
  slotNoTextTarget: { color: "#001738" },
  slotName: { color: "#E7EFF8", fontSize: 11.5, fontWeight: "900" },
  slotMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  slotMeta: { color: "#61D6B1", fontSize: 8.5, fontWeight: "700" },
  externalMeta: { color: "#F4A04A" },
  slotEmpty: { color: "#8298B5", fontSize: 10.5, fontWeight: "800" },
  slotEmptySub: { color: "#4F6989", fontSize: 8.5, marginTop: 2 },
  swapRow: { alignItems: "flex-end", marginTop: 4 },
  swapBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 4 },
  swapText: { color: "#6F87A5", fontSize: 8.5, fontWeight: "700" },
  externalBox: { minHeight: 43, borderRadius: 12, backgroundColor: "#02172F", borderWidth: 1, borderColor: "#26415C", flexDirection: "row", alignItems: "center", overflow: "hidden" },
  externalIcon: { width: 38, alignItems: "center" },
  externalInput: { flex: 1, color: "#FFFFFF", fontSize: 11.5, minHeight: 43 },
  externalAdd: { width: 43, alignSelf: "stretch", backgroundColor: "#F28B25", alignItems: "center", justifyContent: "center" },
  externalHint: { color: "#6E85A2", fontSize: 8.8, lineHeight: 13, marginTop: 5 },
  searchBox: { marginTop: 11, minHeight: 41, borderRadius: 12, backgroundColor: "#02172F", borderWidth: 1, borderColor: "#163A5E", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10 },
  searchInput: { flex: 1, color: "#FFFFFF", fontSize: 11.5, outlineStyle: "none" },
  usersList: { marginTop: 7, maxHeight: 270 },
  userRow: { minHeight: 45, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: "#123250", paddingHorizontal: 2 },
  userRowUsed: { backgroundColor: "rgba(97,214,177,0.035)" },
  avatar: { width: 29, height: 29, borderRadius: 9, backgroundColor: "#102E50", alignItems: "center", justifyContent: "center" },
  avatarUsed: { backgroundColor: "#163F4A" },
  avatarText: { color: "#AFC1D7", fontWeight: "900", fontSize: 11 },
  avatarTextUsed: { color: "#61D6B1" },
  userName: { color: "#DCE7F2", fontSize: 11.5, fontWeight: "700" },
  usedText: { color: "#5E947F", fontSize: 8.2, marginTop: 1 },
  note: { color: "#6F86A5", fontSize: 9.5, lineHeight: 14, marginTop: 8 },
  archiveRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#102F50" },
  archiveName: { color: "#AFC2D7", flex: 1, fontSize: 11.5, fontWeight: "700" },
  archiveYear: { color: "#667E9E", fontSize: 10 },
  archiveStatus: { color: "#607A99", fontSize: 8.5, marginTop: 2 },
  archiveEditBtn: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#0A2B4D", alignItems: "center", justifyContent: "center", marginLeft: 4 },
});
