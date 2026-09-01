import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../supabaseClient";
import { getCurrentUserProfile, normalizeUserStatus } from "../authProfile";
import {
  BLOCK_TYPES,
  getBlockPresentation,
  getBlockType,
  inferBlockType,
} from "../blockTypes";

const COURTS = ["Platz 1", "Platz 2", "Platz 3"];
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const TRAINING_TYPES = [
  "mens_training",
  "womens_training",
  "kids_training",
  "youth_training",
  "mens_40",
  "old_men",
  "custom",
];
const SPECIAL_TYPES = ["matchday", "tournament", "maintenance", "closed", "custom"];

const getDateKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const todayKey = () => getDateKey(new Date());

const formatDate = (dateKey) => {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const addDaysToKey = (dateKey, amount) => {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setDate(d.getDate() + amount);
  return getDateKey(d);
};

const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));

function confirmAction(title, message, confirmText = "Löschen") {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
      { text: confirmText, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

function TypePicker({ keys, selected, onSelect }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.typePickerRow}
    >
      {keys.map((key) => {
        const item = getBlockType(key);
        const active = selected === key;
        return (
          <TouchableOpacity
            key={key}
            style={[
              styles.typeCard,
              active && { borderColor: item.accent, backgroundColor: item.surface },
            ]}
            onPress={() => onSelect(key)}
            activeOpacity={0.8}
          >
            <View style={[styles.typeIcon, { backgroundColor: item.surface }]}> 
              <Ionicons name={item.icon} size={20} color={item.accent} />
            </View>
            <Text style={[styles.typeText, active && { color: item.accent }]} numberOfLines={1}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function CourtPicker({ selected, onChange }) {
  return (
    <View style={styles.chipRow}>
      {COURTS.map((court, index) => {
        const active = selected.includes(index);
        return (
          <TouchableOpacity
            key={court}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => {
              onChange((prev) => {
                if (prev.includes(index)) {
                  const next = prev.filter((i) => i !== index);
                  return next.length ? next : prev;
                }
                return [...prev, index].sort();
              });
            }}
          >
            <Ionicons
              name={active ? "checkmark-circle" : "ellipse-outline"}
              size={16}
              color={active ? "#001738" : "#8FA7C7"}
            />
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{court}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function DateStepper({ value, onChange }) {
  return (
    <View style={styles.dateStepper}>
      <TouchableOpacity style={styles.squareBtn} onPress={() => onChange(addDaysToKey(value, -1))}>
        <Ionicons name="chevron-back" size={19} color="#FFFFFF" />
      </TouchableOpacity>
      <TouchableOpacity style={styles.dateCenter} onPress={() => onChange(todayKey())}>
        <Text style={styles.dateMain}>{formatDate(value)}</Text>
        <Text style={styles.dateHint}>{value === todayKey() ? "HEUTE" : "Tippen für heute"}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.squareBtn} onPress={() => onChange(addDaysToKey(value, 1))}>
        <Ionicons name="chevron-forward" size={19} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

export default function AdminSettingsScreen({ navigation }) {
  const [access, setAccess] = useState({ checking: true, allowed: false, userName: "" });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { session, profile } = await getCurrentUserProfile();
        if (!active) return;
        const allowed =
          !!session?.user?.id &&
          !!profile?.is_admin &&
          normalizeUserStatus(profile?.status) !== "blocked";
        setAccess({ checking: false, allowed, userName: profile?.name || "" });
      } catch (e) {
        console.log("Admin access check error:", e?.message || e);
        if (active) setAccess({ checking: false, allowed: false, userName: "" });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (access.checking) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="#F28B25" />
        <Text style={styles.loadingText}>Admin-Zugriff wird geprüft …</Text>
      </View>
    );
  }

  if (!access.allowed) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Ionicons name="lock-closed-outline" size={30} color="#F28B25" />
        <Text style={styles.forbiddenText}>Kein Admin-Zugriff.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.primaryBtnText}>Zurück</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <AdminSettingsContent navigation={navigation} userName={access.userName} />;
}

function AdminSettingsContent({ userName, navigation }) {
  const [activeTab, setActiveTab] = useState("blocks");
  const [busy, setBusy] = useState(false);

  const [weeklyRules, setWeeklyRules] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [specialBlocks, setSpecialBlocks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [maxHoursPerDay, setMaxHoursPerDay] = useState(2);

  const [weeklyCourts, setWeeklyCourts] = useState([0]);
  const [weeklyDay, setWeeklyDay] = useState(2);
  const [weeklyFrom, setWeeklyFrom] = useState("17:00");
  const [weeklyTo, setWeeklyTo] = useState("19:00");
  const [weeklyType, setWeeklyType] = useState("mens_training");
  const [weeklyLabel, setWeeklyLabel] = useState("");

  const [specialDate, setSpecialDate] = useState(todayKey());
  const [specialCourts, setSpecialCourts] = useState([0, 1]);
  const [specialFrom, setSpecialFrom] = useState("09:00");
  const [specialTo, setSpecialTo] = useState("14:00");
  const [specialType, setSpecialType] = useState("matchday");
  const [specialLabel, setSpecialLabel] = useState("");

  const [bookingDate, setBookingDate] = useState(todayKey());
  const [adminBookings, setAdminBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  const [exceptionDraft, setExceptionDraft] = useState(null);

  const loadMaxHours = async () => {
    try {
      const stored = await AsyncStorage.getItem("maxHoursPerDay");
      const value = Number(stored);
      if (value > 0) setMaxHoursPerDay(value);
    } catch {}
  };

  const saveMaxHours = async (value) => {
    setMaxHoursPerDay(value);
    try {
      await AsyncStorage.setItem("maxHoursPerDay", String(value));
    } catch {}
  };

  const loadWeeklyRules = async () => {
    const { data, error } = await supabase.from("weekly_blocks").select("*").order("weekday");
    if (error) {
      console.log("weekly rules load:", error.message);
      return;
    }
    setWeeklyRules(
      (data || []).map((row) => ({
        id: row.id,
        courtIndex: row.court_index,
        weekday: row.weekday,
        from: row.from_time,
        to: row.to_time,
        reason: row.reason || "",
        blockType: inferBlockType(row.reason || row.label, row.block_type),
        label: row.label || row.reason || "",
      }))
    );
  };

  const loadExceptions = async () => {
    const { data, error } = await supabase
      .from("weekly_block_exceptions")
      .select("*")
      .gte("date_key", todayKey())
      .order("date_key", { ascending: true })
      .limit(30);
    if (error) {
      console.log("exceptions load:", error.message);
      return;
    }
    setExceptions(data || []);
  };

  const loadSpecialBlocks = async () => {
    const { data, error } = await supabase
      .from("special_blocks")
      .select("*")
      .gte("date_key", todayKey())
      .order("date_key", { ascending: true })
      .order("from_time", { ascending: true });
    if (error) {
      console.log("special_blocks load:", error.message);
      return;
    }
    setSpecialBlocks(data || []);
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, name, email, status, is_admin, created_at")
        .order("created_at", { ascending: true });
      if (!error) setUsers(data || []);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadAdminBookings = async (dateKey = bookingDate) => {
    setLoadingBookings(true);
    try {
      const { data, error } = await supabase
        .from("bookings123")
        .select("*")
        .eq("date_key", dateKey)
        .order("court_index", { ascending: true })
        .order("time", { ascending: true });
      if (error) {
        Alert.alert("Fehler", error.message);
        return;
      }
      setAdminBookings(data || []);
    } finally {
      setLoadingBookings(false);
    }
  };

  useEffect(() => {
    loadWeeklyRules();
    loadExceptions();
    loadSpecialBlocks();
    loadUsers();
    loadMaxHours();
  }, []);

  useEffect(() => {
    if (activeTab === "bookings") loadAdminBookings(bookingDate);
  }, [activeTab, bookingDate]);

  const weeklyGroups = useMemo(() => {
    const map = new Map();
    weeklyRules.forEach((rule) => {
      const key = [rule.weekday, rule.from, rule.to, rule.blockType, rule.label || rule.reason].join("|");
      const existing = map.get(key) || { ...rule, ids: [], courts: [] };
      existing.ids.push(rule.id);
      existing.courts.push(rule.courtIndex);
      map.set(key, existing);
    });
    return [...map.values()].sort((a, b) => a.weekday - b.weekday || a.from.localeCompare(b.from));
  }, [weeklyRules]);

  const specialGroups = useMemo(() => {
    const map = new Map();
    specialBlocks.forEach((row) => {
      const key = [row.date_key, row.from_time, row.to_time, row.block_type, row.label || row.reason].join("|");
      const item = map.get(key) || { ...row, ids: [], courts: [] };
      item.ids.push(row.id);
      item.courts.push(row.court_index);
      map.set(key, item);
    });
    return [...map.values()];
  }, [specialBlocks]);

  const groupedBookings = useMemo(() => {
    const rows = [...adminBookings].sort((a, b) => a.court_index - b.court_index || a.time.localeCompare(b.time));
    const used = new Set();
    const result = [];

    rows.forEach((row, index) => {
      if (used.has(index)) return;
      const groupId = row.booking_group_id || null;
      let members = [];
      if (groupId) {
        rows.forEach((candidate, candidateIndex) => {
          if (candidate.booking_group_id === groupId) {
            members.push(candidate);
            used.add(candidateIndex);
          }
        });
      } else {
        members = [row];
        used.add(index);
        let lastMinutes = Number(row.time.slice(0, 2)) * 60 + Number(row.time.slice(3));
        for (let i = index + 1; i < rows.length; i += 1) {
          if (used.has(i)) continue;
          const candidate = rows[i];
          const candidateMinutes = Number(candidate.time.slice(0, 2)) * 60 + Number(candidate.time.slice(3));
          const sameOwner =
            candidate.court_index === row.court_index &&
            candidate.user_name === row.user_name &&
            (candidate.player2 || "") === (row.player2 || "");
          if (sameOwner && candidateMinutes === lastMinutes + 30 && !candidate.booking_group_id) {
            members.push(candidate);
            used.add(i);
            lastMinutes = candidateMinutes;
          }
        }
      }

      members.sort((a, b) => a.time.localeCompare(b.time));
      const start = members[0].time;
      const last = members[members.length - 1].time;
      const [h, m] = last.split(":").map(Number);
      const endDate = new Date(2000, 0, 1, h, m + 30);
      const end = `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;
      result.push({
        key: groupId || `${row.court_index}-${row.user_name}-${start}-${index}`,
        groupId,
        courtIndex: row.court_index,
        userName: row.user_name || "Unbekannt",
        player2: row.player2 || "",
        tournamentMatchId: row.tournament_match_id || members.find((m) => m.tournament_match_id)?.tournament_match_id || null,
        start,
        end,
        members,
      });
    });
    return result;
  }, [adminBookings]);

  const addWeeklyRule = async () => {
    if (!validTime(weeklyFrom) || !validTime(weeklyTo) || weeklyTo <= weeklyFrom) {
      Alert.alert("Zeit prüfen", "Bitte eine gültige Von-/Bis-Zeit eingeben.");
      return;
    }
    const type = getBlockType(weeklyType);
    const label = weeklyLabel.trim() || type.label;
    setBusy(true);
    try {
      const rows = weeklyCourts.map((courtIndex) => ({
        court_index: courtIndex,
        weekday: weeklyDay,
        from_time: weeklyFrom,
        to_time: weeklyTo,
        reason: label,
        block_type: weeklyType,
        label,
      }));
      const { error } = await supabase.from("weekly_blocks").insert(rows);
      if (error) throw error;
      setWeeklyLabel("");
      await loadWeeklyRules();
    } catch (e) {
      Alert.alert("Sperre nicht gespeichert", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const addSpecialBlock = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(specialDate) || !validTime(specialFrom) || !validTime(specialTo) || specialTo <= specialFrom) {
      Alert.alert("Angaben prüfen", "Bitte Datum und Von-/Bis-Zeit prüfen.");
      return;
    }
    const type = getBlockType(specialType);
    const label = specialLabel.trim() || type.label;
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const rows = specialCourts.map((courtIndex) => ({
        date_key: specialDate,
        court_index: courtIndex,
        from_time: specialFrom,
        to_time: specialTo,
        block_type: specialType,
        label,
        reason: label,
        created_by: sessionData?.session?.user?.id || null,
      }));
      const { error } = await supabase.from("special_blocks").insert(rows);
      if (error) throw error;
      setSpecialLabel("");
      await loadSpecialBlocks();
    } catch (e) {
      Alert.alert("Termin nicht gespeichert", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteWeeklyGroup = async (group) => {
    const ok = await confirmAction("Sperrzeit löschen?", `${getBlockPresentation(group).displayLabel} wirklich löschen?`);
    if (!ok) return;
    const { error } = await supabase.from("weekly_blocks").delete().in("id", group.ids);
    if (error) Alert.alert("Fehler", error.message);
    else loadWeeklyRules();
  };

  const deleteSpecialGroup = async (group) => {
    const ok = await confirmAction("Sondertermin löschen?", `${group.label || group.reason || "Sperre"} wirklich löschen?`);
    if (!ok) return;
    const { error } = await supabase.from("special_blocks").delete().in("id", group.ids);
    if (error) Alert.alert("Fehler", error.message);
    else loadSpecialBlocks();
  };

  const addExceptionForGroup = async (group) => {
    const groupKey = group.ids.join("-");
    if (!exceptionDraft || exceptionDraft.groupKey !== groupKey) {
      setExceptionDraft({
        groupKey,
        dateKey: todayKey(),
        courts: [...group.courts],
      });
      return;
    }

    const selectedCourts = exceptionDraft.courts?.length
      ? exceptionDraft.courts
      : [...group.courts];

    const rows = selectedCourts.map((courtIndex) => ({
      date_key: exceptionDraft.dateKey,
      court_index: courtIndex,
      from_time: group.from,
      to_time: group.to,
      reason: `${group.label || group.reason || "Training"} – Ausnahme`,
    }));

    const { error } = await supabase.from("weekly_block_exceptions").insert(rows);
    if (error) {
      Alert.alert("Fehler", error.message);
      return;
    }

    setExceptionDraft(null);
    await loadExceptions();
    const courtText = selectedCourts.length === group.courts.length
      ? "alle Trainingsplätze"
      : selectedCourts.map((i) => COURTS[i]).join(" + ");
    Alert.alert(
      "Ausnahme gespeichert",
      `${formatDate(rows[0].date_key)}: ${courtText} freigegeben.`
    );
  };

  const deleteException = async (id) => {
    const { error } = await supabase.from("weekly_block_exceptions").delete().eq("id", id);
    if (!error) loadExceptions();
  };

  const deleteBookingGroup = async (group) => {
    const ok = await confirmAction(
      "Gesamte Buchung löschen?",
      `${group.userName}\n${COURTS[group.courtIndex]} · ${group.start}–${group.end}\n\nAlle ${group.members.length} Zeitslots werden gelöscht.`
    );
    if (!ok) return;

    setBusy(true);
    try {
      let error = null;
      if (group.groupId) {
        const result = await supabase.from("bookings123").delete().eq("booking_group_id", group.groupId);
        error = result.error;
      } else {
        for (const row of group.members) {
          const result = await supabase
            .from("bookings123")
            .delete()
            .eq("date_key", bookingDate)
            .eq("court_index", row.court_index)
            .eq("time", row.time);
          if (result.error) {
            error = result.error;
            break;
          }
        }
      }
      if (error) throw error;
      if (group.tournamentMatchId) {
        const { error: unlinkError } = await supabase.rpc("tournament_unlink_booking", { p_match_id: group.tournamentMatchId });
        if (unlinkError) console.log("Tournament unlink admin:", unlinkError.message);
      }
      await loadAdminBookings(bookingDate);
    } catch (e) {
      Alert.alert("Löschen fehlgeschlagen", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateUserStatus = async (id, newStatus) => {
    const { error } = await supabase.from("users").update({ status: newStatus }).eq("id", id);
    if (error) Alert.alert("Fehler", error.message);
    else loadUsers();
  };

  const renderBlockCard = (group, recurring) => {
    const presentation = getBlockPresentation({
      blockType: group.blockType || group.block_type,
      label: group.label,
      reason: group.reason,
    });
    const courts = (group.courts || [group.court_index]).map((i) => COURTS[i]).join(" + ");
    const exceptionOpen = recurring && exceptionDraft?.groupKey === group.ids.join("-");
    return (
      <View key={(group.ids || [group.id]).join("-")} style={styles.ruleCard}>
        <View style={[styles.ruleIcon, { backgroundColor: presentation.surface }]}> 
          <Ionicons name={presentation.icon} size={23} color={presentation.accent} />
        </View>
        <View style={styles.ruleBody}>
          <View style={styles.ruleTitleRow}>
            <Text style={styles.ruleTitle}>{presentation.displayLabel}</Text>
            <View style={[styles.miniBadge, { borderColor: presentation.accent }]}> 
              <Text style={[styles.miniBadgeText, { color: presentation.accent }]}>
                {recurring ? "WÖCHENTLICH" : "EINMALIG"}
              </Text>
            </View>
          </View>
          <Text style={styles.ruleMeta}>
            {recurring ? `${WEEKDAYS[group.weekday]} · ` : `${formatDate(group.date_key)} · `}
            {group.from || group.from_time}–{group.to || group.to_time}
          </Text>
          <Text style={styles.ruleCourts}>{courts}</Text>
          <View style={styles.ruleActions}>
            {recurring && (
              <TouchableOpacity style={styles.softAction} onPress={() => addExceptionForGroup(group)}>
                <Ionicons name="calendar-clear-outline" size={15} color="#A9BED9" />
                <Text style={styles.softActionText}>Ausnahme</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.deleteAction}
              onPress={() => (recurring ? deleteWeeklyGroup(group) : deleteSpecialGroup(group))}
            >
              <Ionicons name="trash-outline" size={15} color="#FF8A8A" />
              <Text style={styles.deleteActionText}>Löschen</Text>
            </TouchableOpacity>
          </View>
          {exceptionOpen && (
            <View style={styles.exceptionInline}>
              <View style={styles.exceptionHeaderRow}>
                <View style={styles.exceptionHeaderIcon}>
                  <Ionicons name="calendar-clear-outline" size={17} color="#61D6B1" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exceptionInlineTitle}>Training kurzfristig freigeben</Text>
                  <Text style={styles.exceptionInlineHint}>Nur für diesen Termin – die Dauerregel bleibt erhalten.</Text>
                </View>
              </View>

              <Text style={styles.inlineLabel}>Datum</Text>
              <TextInput
                style={styles.inlineInput}
                value={exceptionDraft.dateKey}
                onChangeText={(dateKey) => setExceptionDraft((prev) => ({ ...prev, dateKey }))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#667E9E"
              />

              <Text style={styles.inlineLabel}>Welche Plätze freigeben?</Text>
              <View style={styles.exceptionCourtRow}>
                <TouchableOpacity
                  style={[
                    styles.exceptionCourtChip,
                    exceptionDraft.courts?.length === group.courts.length && styles.exceptionCourtChipActive,
                  ]}
                  onPress={() => setExceptionDraft((prev) => ({ ...prev, courts: [...group.courts] }))}
                >
                  <Ionicons
                    name="checkmark-done-outline"
                    size={15}
                    color={exceptionDraft.courts?.length === group.courts.length ? "#001738" : "#A9BED9"}
                  />
                  <Text style={[
                    styles.exceptionCourtChipText,
                    exceptionDraft.courts?.length === group.courts.length && styles.exceptionCourtChipTextActive,
                  ]}>Alle</Text>
                </TouchableOpacity>

                {group.courts.map((courtIndex) => {
                  const onlyThis = exceptionDraft.courts?.length === 1 && exceptionDraft.courts[0] === courtIndex;
                  return (
                    <TouchableOpacity
                      key={`exception-court-${courtIndex}`}
                      style={[styles.exceptionCourtChip, onlyThis && styles.exceptionCourtChipActive]}
                      onPress={() => setExceptionDraft((prev) => ({ ...prev, courts: [courtIndex] }))}
                    >
                      <Ionicons
                        name={onlyThis ? "radio-button-on" : "radio-button-off"}
                        size={15}
                        color={onlyThis ? "#001738" : "#A9BED9"}
                      />
                      <Text style={[styles.exceptionCourtChipText, onlyThis && styles.exceptionCourtChipTextActive]}>
                        {COURTS[courtIndex]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity style={styles.inlineSave} onPress={() => addExceptionForGroup(group)}>
                <Ionicons name="checkmark-circle-outline" size={18} color="#001738" />
                <Text style={styles.inlineSaveText}>Für diesen Termin freigeben</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBack} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Admin Center</Text>
          <Text style={styles.headerSubtitle}>{userName}</Text>
        </View>
        <View style={styles.adminBadge}>
          <Ionicons name="shield-checkmark-outline" size={17} color="#F28B25" />
        </View>
      </View>

      <View style={styles.tabs}>
        {[
          ["blocks", "calendar-outline", "Sperren"],
          ["bookings", "book-outline", "Buchungen"],
          ["tournament", "trophy-outline", "Turnier"],
          ["users", "people-outline", "Nutzer"],
        ].map(([key, icon, label]) => {
          const active = activeTab === key;
          return (
            <TouchableOpacity key={key} style={[styles.tab, active && styles.tabActive]} onPress={() => setActiveTab(key)}>
              <Ionicons name={icon} size={17} color={active ? "#001738" : "#7F96B6"} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === "blocks" && (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentPad} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}><Ionicons name="sparkles-outline" size={22} color="#F28B25" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Platzplan verwalten</Text>
              <Text style={styles.heroText}>Trainings dauerhaft planen oder einen Spieltag mit wenigen Klicks sperren.</Text>
            </View>
          </View>

          <Text style={styles.sectionEyebrow}>SCHNELL-AKTION</Text>
          <Text style={styles.sectionTitle}>Spieltag & Sondertermin</Text>
          <View style={styles.panel}>
            <TypePicker keys={SPECIAL_TYPES} selected={specialType} onSelect={setSpecialType} />
            <Text style={styles.fieldLabel}>Datum</Text>
            <DateStepper value={specialDate} onChange={setSpecialDate} />
            <Text style={styles.fieldLabel}>Plätze</Text>
            <CourtPicker selected={specialCourts} onChange={setSpecialCourts} />
            <View style={styles.twoCols}>
              <View style={styles.col}><Text style={styles.fieldLabel}>Von</Text><TextInput style={styles.input} value={specialFrom} onChangeText={setSpecialFrom} /></View>
              <View style={styles.col}><Text style={styles.fieldLabel}>Bis</Text><TextInput style={styles.input} value={specialTo} onChangeText={setSpecialTo} /></View>
            </View>
            <Text style={styles.fieldLabel}>Bezeichnung</Text>
            <TextInput
              style={styles.input}
              value={specialLabel}
              onChangeText={setSpecialLabel}
              placeholder={specialType === "matchday" ? "z.B. Herren 40 vs. Trostberg" : "Optional"}
              placeholderTextColor="#607A9C"
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={addSpecialBlock} disabled={busy}>
              <Ionicons name="add-circle-outline" size={19} color="#001738" />
              <Text style={styles.primaryBtnText}>{busy ? "Speichere …" : "Termin sperren"}</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionEyebrow, { marginTop: 24 }]}>DAUERHAFT</Text>
          <Text style={styles.sectionTitle}>Wöchentliches Training</Text>
          <View style={styles.panel}>
            <TypePicker keys={TRAINING_TYPES} selected={weeklyType} onSelect={setWeeklyType} />
            <Text style={styles.fieldLabel}>Wochentag</Text>
            <View style={styles.weekRow}>
              {WEEKDAYS.map((day, index) => (
                <TouchableOpacity key={day} style={[styles.weekChip, weeklyDay === index && styles.weekChipActive]} onPress={() => setWeeklyDay(index)}>
                  <Text style={[styles.weekChipText, weeklyDay === index && styles.weekChipTextActive]}>{day}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Plätze</Text>
            <CourtPicker selected={weeklyCourts} onChange={setWeeklyCourts} />
            <View style={styles.twoCols}>
              <View style={styles.col}><Text style={styles.fieldLabel}>Von</Text><TextInput style={styles.input} value={weeklyFrom} onChangeText={setWeeklyFrom} /></View>
              <View style={styles.col}><Text style={styles.fieldLabel}>Bis</Text><TextInput style={styles.input} value={weeklyTo} onChangeText={setWeeklyTo} /></View>
            </View>
            <Text style={styles.fieldLabel}>Eigener Name (optional)</Text>
            <TextInput style={styles.input} value={weeklyLabel} onChangeText={setWeeklyLabel} placeholder={getBlockType(weeklyType).label} placeholderTextColor="#607A9C" />
            <TouchableOpacity style={styles.secondaryPrimaryBtn} onPress={addWeeklyRule} disabled={busy}>
              <Ionicons name="repeat-outline" size={18} color="#F28B25" />
              <Text style={styles.secondaryPrimaryText}>Dauerhaft eintragen</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Aktive Sondertermine</Text>
          {specialGroups.length === 0 ? <Text style={styles.emptyText}>Keine kommenden Sondertermine.</Text> : specialGroups.map((group) => renderBlockCard(group, false))}

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Aktive Trainings</Text>
          {weeklyGroups.length === 0 ? <Text style={styles.emptyText}>Keine wöchentlichen Sperren.</Text> : weeklyGroups.map((group) => renderBlockCard(group, true))}

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Kommende Ausnahmen</Text>
          {exceptions.length === 0 ? (
            <Text style={styles.emptyText}>Keine Ausnahmen hinterlegt.</Text>
          ) : (
            exceptions.map((ex) => (
              <View key={ex.id} style={styles.exceptionCard}>
                <View style={styles.exceptionIcon}><Ionicons name="calendar-clear-outline" size={18} color="#61D6B1" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.exceptionTitle}>{formatDate(ex.date_key)}</Text>
                  <Text style={styles.exceptionMeta}>{COURTS[ex.court_index]} · {ex.from_time}–{ex.to_time}</Text>
                </View>
                <TouchableOpacity onPress={() => deleteException(ex.id)}><Ionicons name="close-circle-outline" size={21} color="#FF8A8A" /></TouchableOpacity>
              </View>
            ))
          )}

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Tageslimit</Text>
          <View style={styles.limitCard}>
            <View><Text style={styles.limitTitle}>Max. Stunden pro Spieler</Text><Text style={styles.limitHint}>Derzeit noch gerätebezogen gespeichert.</Text></View>
            <View style={styles.limitControl}>
              <TouchableOpacity style={styles.limitBtn} onPress={() => saveMaxHours(Math.max(0.5, maxHoursPerDay - 0.5))}><Ionicons name="remove" size={18} color="#F28B25" /></TouchableOpacity>
              <Text style={styles.limitValue}>{String(maxHoursPerDay).replace(".", ",")} h</Text>
              <TouchableOpacity style={styles.limitBtn} onPress={() => saveMaxHours(Math.min(8, maxHoursPerDay + 0.5))}><Ionicons name="add" size={18} color="#F28B25" /></TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      )}

      {activeTab === "tournament" && (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentPad} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}><Ionicons name="trophy-outline" size={22} color="#F28B25" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Vereinsmeisterschaft</Text>
              <Text style={styles.heroText}>Herren, Trostrunde und Damen verwalten, Turnierbäume erstellen und Ergebnisse kontrollieren.</Text>
            </View>
          </View>

          <Text style={styles.sectionEyebrow}>TURNIER CENTER</Text>
          <Text style={styles.sectionTitle}>Meisterschaft verwalten</Text>
          <Text style={styles.sectionIntro}>Teilnehmer setzen, Turnierbäume erzeugen, Ergebnisse als Admin direkt eintragen und laufende Matches ansehen.</Text>

          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate("TournamentAdmin")}>
            <Ionicons name="git-network-outline" size={19} color="#001738" />
            <Text style={styles.primaryBtnText}>Turnierverwaltung öffnen</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.secondaryPrimaryBtn, { marginTop: 10 }]} onPress={() => navigation.navigate("Tournament")}>
            <Ionicons name="eye-outline" size={18} color="#F28B25" />
            <Text style={styles.secondaryPrimaryText}>Mitgliederansicht ansehen</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {activeTab === "bookings" && (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentPad} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionEyebrow}>VERWALTUNG</Text>
          <Text style={styles.sectionTitle}>Buchungen eines Tages</Text>
          <Text style={styles.sectionIntro}>Lange Buchungen werden hier als ein Eintrag zusammengefasst und komplett gelöscht.</Text>
          <DateStepper value={bookingDate} onChange={setBookingDate} />
          <TouchableOpacity style={styles.reloadBtn} onPress={() => loadAdminBookings(bookingDate)}>
            <Ionicons name="refresh-outline" size={17} color="#A9BED9" />
            <Text style={styles.reloadText}>{loadingBookings ? "Lade …" : "Neu laden"}</Text>
          </TouchableOpacity>
          {groupedBookings.length === 0 && !loadingBookings ? (
            <Text style={styles.emptyText}>Keine Buchungen an diesem Tag.</Text>
          ) : (
            groupedBookings.map((group) => (
              <View key={group.key} style={styles.bookingCard}>
                <View style={styles.bookingIcon}><Ionicons name="tennisball-outline" size={20} color="#67C9FF" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bookingUser}>{group.userName}</Text>
                  {!!group.player2 && <Text style={styles.bookingPartner}>+ {group.player2}</Text>}
                  {!!group.tournamentMatchId && (
                    <View style={styles.adminVmPill}><Ionicons name="trophy-outline" size={12} color="#F28B25" /><Text style={styles.adminVmPillText}>Vereinsmeisterschaft</Text></View>
                  )}
                  <Text style={styles.bookingMeta}>{COURTS[group.courtIndex]} · {group.start}–{group.end}</Text>
                  <Text style={styles.bookingSlots}>{group.members.length * 0.5} Std. · {group.members.length} Slot{group.members.length === 1 ? "" : "s"}</Text>
                </View>
                <TouchableOpacity style={styles.trashBtn} onPress={() => deleteBookingGroup(group)} disabled={busy}>
                  <Ionicons name="trash-outline" size={19} color="#FF8A8A" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {activeTab === "users" && (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentPad} showsVerticalScrollIndicator={false}>
          <View style={styles.userHeaderRow}>
            <View><Text style={styles.sectionEyebrow}>MITGLIEDER</Text><Text style={styles.sectionTitle}>Benutzerverwaltung</Text></View>
            <TouchableOpacity style={styles.reloadBtn} onPress={loadUsers}><Ionicons name="refresh-outline" size={17} color="#A9BED9" /><Text style={styles.reloadText}>{loadingUsers ? "…" : "Laden"}</Text></TouchableOpacity>
          </View>
          {users.map((u) => {
            const approved = u.status === "approved";
            const pending = u.status === "pending";
            return (
              <View key={u.id} style={styles.userCard}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{String(u.name || "?").trim().slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <View style={styles.userNameRow}><Text style={styles.userName}>{u.name || "Unbekannt"}</Text>{u.is_admin && <Ionicons name="shield-checkmark" size={15} color="#F28B25" />}</View>
                  <Text style={styles.userEmail}>{u.email || ""}</Text>
                  <View style={[styles.statusPill, approved ? styles.statusApproved : pending ? styles.statusPending : styles.statusBlocked]}>
                    <Text style={styles.statusText}>{approved ? "Freigeschaltet" : pending ? "Wartet" : "Gesperrt"}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.userActionBtn, approved ? styles.userActionDanger : styles.userActionApprove]}
                  onPress={() => updateUserStatus(u.id, approved ? "blocked" : "approved")}
                >
                  <Ionicons name={approved ? "ban-outline" : "checkmark-outline"} size={17} color={approved ? "#FF8A8A" : "#61D6B1"} />
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738" },
  centered: { alignItems: "center", justifyContent: "center", padding: 24 },
  loadingText: { color: "#9FB0C8", marginTop: 10 },
  forbiddenText: { color: "#FFFFFF", fontSize: 17, fontWeight: "800", marginTop: 12, marginBottom: 18 },
  header: { paddingTop: 44, paddingHorizontal: 18, paddingBottom: 14, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#123356" },
  headerBack: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#08264A", alignItems: "center", justifyContent: "center" },
  headerTitleWrap: { flex: 1, marginLeft: 12 },
  headerTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "900" },
  headerSubtitle: { color: "#758CAB", fontSize: 12, marginTop: 2 },
  adminBadge: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#302718", borderWidth: 1, borderColor: "#76552C", alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", marginHorizontal: 16, marginTop: 14, backgroundColor: "#061F40", borderRadius: 16, padding: 4 },
  tab: { flex: 1, minHeight: 42, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  tabActive: { backgroundColor: "#F28B25" },
  tabText: { color: "#7F96B6", fontWeight: "800", fontSize: 10.5 },
  tabTextActive: { color: "#001738" },
  content: { flex: 1 },
  contentPad: { padding: 16, paddingBottom: 50 },
  heroCard: { flexDirection: "row", gap: 12, backgroundColor: "#071F40", borderRadius: 18, padding: 15, borderWidth: 1, borderColor: "#183A61", marginBottom: 22 },
  heroIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#342818", alignItems: "center", justifyContent: "center" },
  heroTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  heroText: { color: "#8EA4C0", fontSize: 12, lineHeight: 17, marginTop: 4 },
  sectionEyebrow: { color: "#F28B25", fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 4 },
  sectionTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginBottom: 10 },
  sectionIntro: { color: "#8EA4C0", fontSize: 12.5, lineHeight: 18, marginTop: -4, marginBottom: 14 },
  panel: { backgroundColor: "#061F40", borderRadius: 20, borderWidth: 1, borderColor: "#15385F", padding: 14 },
  typePickerRow: { gap: 9, paddingBottom: 4 },
  typeCard: { width: 104, minHeight: 82, borderRadius: 16, borderWidth: 1, borderColor: "#1B3D64", backgroundColor: "#08264A", padding: 10, justifyContent: "space-between" },
  typeIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  typeText: { color: "#A9BED9", fontWeight: "800", fontSize: 11, marginTop: 8 },
  fieldLabel: { color: "#A9BED9", fontSize: 11, fontWeight: "800", marginTop: 14, marginBottom: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 38, borderRadius: 12, borderWidth: 1, borderColor: "#23476F", paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#08264A" },
  chipActive: { backgroundColor: "#F28B25", borderColor: "#F28B25" },
  chipText: { color: "#B9C8DA", fontSize: 12, fontWeight: "800" },
  chipTextActive: { color: "#001738" },
  weekRow: { flexDirection: "row", gap: 5 },
  weekChip: { flex: 1, height: 36, borderRadius: 11, backgroundColor: "#08264A", borderWidth: 1, borderColor: "#23476F", alignItems: "center", justifyContent: "center" },
  weekChipActive: { backgroundColor: "#F28B25", borderColor: "#F28B25" },
  weekChipText: { color: "#A9BED9", fontSize: 11, fontWeight: "900" },
  weekChipTextActive: { color: "#001738" },
  twoCols: { flexDirection: "row", gap: 10 },
  col: { flex: 1 },
  input: { minHeight: 43, borderRadius: 12, borderWidth: 1, borderColor: "#23476F", backgroundColor: "#08264A", color: "#FFFFFF", paddingHorizontal: 12, fontSize: 13, fontWeight: "700" },
  primaryBtn: { marginTop: 16, minHeight: 46, borderRadius: 14, backgroundColor: "#F28B25", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryBtnText: { color: "#001738", fontWeight: "900", fontSize: 13 },
  secondaryPrimaryBtn: { marginTop: 16, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: "#F28B25", backgroundColor: "#2D251A", flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" },
  secondaryPrimaryText: { color: "#F28B25", fontSize: 13, fontWeight: "900" },
  dateStepper: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#08264A", borderWidth: 1, borderColor: "#23476F", borderRadius: 15, padding: 7 },
  squareBtn: { width: 43, height: 43, borderRadius: 12, backgroundColor: "#0B315B", alignItems: "center", justifyContent: "center" },
  dateCenter: { flex: 1, alignItems: "center" },
  dateMain: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  dateHint: { color: "#637D9E", fontSize: 9, fontWeight: "900", marginTop: 2, letterSpacing: 0.6 },
  ruleCard: { flexDirection: "row", gap: 12, backgroundColor: "#061F40", borderRadius: 18, borderWidth: 1, borderColor: "#16395F", padding: 13, marginBottom: 9 },
  ruleIcon: { width: 45, height: 45, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  ruleBody: { flex: 1 },
  ruleTitleRow: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  ruleTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  miniBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  miniBadgeText: { fontSize: 8, fontWeight: "900", letterSpacing: 0.7 },
  ruleMeta: { color: "#A9BED9", fontSize: 12, fontWeight: "700", marginTop: 5 },
  ruleCourts: { color: "#6F88A8", fontSize: 11, marginTop: 3 },
  ruleActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  softAction: { minHeight: 33, borderRadius: 10, borderWidth: 1, borderColor: "#294C73", paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  softActionText: { color: "#A9BED9", fontSize: 11, fontWeight: "800" },
  deleteAction: { minHeight: 33, borderRadius: 10, backgroundColor: "#351F2A", borderWidth: 1, borderColor: "#613648", paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  deleteActionText: { color: "#FF8A8A", fontSize: 11, fontWeight: "800" },
  exceptionInline: { marginTop: 10, padding: 11, backgroundColor: "#08264A", borderRadius: 14, borderWidth: 1, borderColor: "#21486F" },
  exceptionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 9 },
  exceptionHeaderIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#123A39", alignItems: "center", justifyContent: "center" },
  exceptionInlineTitle: { color: "#FFFFFF", fontSize: 11.5, fontWeight: "900" },
  exceptionInlineHint: { color: "#7890AE", fontSize: 9.5, marginTop: 2 },
  inlineLabel: { color: "#9FB0C8", fontSize: 10, fontWeight: "800", marginTop: 7, marginBottom: 5 },
  inlineInput: { minHeight: 39, borderRadius: 10, backgroundColor: "#061D3A", color: "#FFFFFF", borderWidth: 1, borderColor: "#294C73", paddingHorizontal: 10, fontSize: 12 },
  exceptionCourtRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  exceptionCourtChip: { minHeight: 34, borderRadius: 10, borderWidth: 1, borderColor: "#294C73", backgroundColor: "#061D3A", paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  exceptionCourtChipActive: { backgroundColor: "#61D6B1", borderColor: "#61D6B1" },
  exceptionCourtChipText: { color: "#A9BED9", fontSize: 10.5, fontWeight: "800" },
  exceptionCourtChipTextActive: { color: "#001738" },
  inlineSave: { marginTop: 10, minHeight: 38, borderRadius: 10, backgroundColor: "#61D6B1", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  inlineSaveText: { color: "#001738", fontWeight: "900", fontSize: 11 },
  exceptionCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#061F40", borderRadius: 14, padding: 11, marginBottom: 7, borderWidth: 1, borderColor: "#16395F" },
  exceptionIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: "#123A39", alignItems: "center", justifyContent: "center" },
  exceptionTitle: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  exceptionMeta: { color: "#7F96B6", fontSize: 10.5, marginTop: 2 },
  emptyText: { color: "#7189A8", fontSize: 12, paddingVertical: 7 },
  limitCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#061F40", borderRadius: 16, borderWidth: 1, borderColor: "#16395F", padding: 13 },
  limitTitle: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  limitHint: { color: "#6F88A8", fontSize: 9.5, marginTop: 3 },
  limitControl: { flexDirection: "row", alignItems: "center", gap: 9 },
  limitBtn: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: "#63451F", backgroundColor: "#2B241A", alignItems: "center", justifyContent: "center" },
  limitValue: { color: "#FFFFFF", minWidth: 40, textAlign: "center", fontWeight: "900", fontSize: 12 },
  reloadBtn: { alignSelf: "flex-start", marginTop: 10, marginBottom: 10, minHeight: 37, borderRadius: 11, borderWidth: 1, borderColor: "#284A72", backgroundColor: "#08264A", paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  reloadText: { color: "#A9BED9", fontSize: 11, fontWeight: "800" },
  bookingCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#061F40", borderRadius: 17, borderWidth: 1, borderColor: "#16395F", padding: 12, marginBottom: 9 },
  bookingIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#0E355A", alignItems: "center", justifyContent: "center" },
  bookingUser: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  bookingPartner: { color: "#8CA5C5", fontSize: 10.5, marginTop: 1 },
  bookingMeta: { color: "#67C9FF", fontSize: 11.5, fontWeight: "800", marginTop: 5 },
  bookingSlots: { color: "#647E9F", fontSize: 9.5, marginTop: 2 },
  trashBtn: { width: 39, height: 39, borderRadius: 12, backgroundColor: "#351F2A", borderWidth: 1, borderColor: "#613648", alignItems: "center", justifyContent: "center" },
  userHeaderRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  userCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#061F40", borderRadius: 17, borderWidth: 1, borderColor: "#16395F", padding: 12, marginBottom: 9 },
  avatar: { width: 43, height: 43, borderRadius: 14, backgroundColor: "#10345B", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#7DCBFF", fontWeight: "900", fontSize: 16 },
  userNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  userName: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  userEmail: { color: "#6F88A8", fontSize: 9.5, marginTop: 2 },
  statusPill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, marginTop: 6 },
  statusApproved: { backgroundColor: "#153B34" },
  statusPending: { backgroundColor: "#49391B" },
  statusBlocked: { backgroundColor: "#42232D" },
  statusText: { color: "#C8D5E5", fontSize: 8.5, fontWeight: "900" },
  userActionBtn: { width: 39, height: 39, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  userActionDanger: { backgroundColor: "#351F2A", borderColor: "#613648" },
  userActionApprove: { backgroundColor: "#143630", borderColor: "#286657" },
  adminVmPill: { alignSelf: "flex-start", marginTop: 5, marginBottom: 2, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#2C251B", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  adminVmPillText: { color: "#F28B25", fontSize: 8.5, fontWeight: "900" },

});
