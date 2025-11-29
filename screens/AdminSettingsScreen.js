import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  StatusBar,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabaseClient";

const COURTS = ["P1", "P2", "P3"];
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export default function AdminSettingsScreen({ route, navigation }) {
  const { userName, isAdmin } = route.params || {};

  const [activeTab, setActiveTab] = useState("blocks"); // "blocks" oder "users"

  // Sperrzeiten-Formular
  const [selectedCourtIndices, setSelectedCourtIndices] = useState([0]); // mehrere Plätze möglich
  const [selectedWeekday, setSelectedWeekday] = useState(1);
  const [fromTime, setFromTime] = useState("18:00");
  const [toTime, setToTime] = useState("20:00");
  const [ruleReason, setRuleReason] = useState("");

  // Max. Stunden
  const [maxHoursPerDay, setMaxHoursPerDay] = useState(2);

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [weeklyRules, setWeeklyRules] = useState([]);

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.forbiddenText}>
          Kein Admin-Zugriff. Bitte als Admin einloggen.
        </Text>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backBtnText}>Zurück</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---- Max-Stunden laden/speichern (AsyncStorage) ----
  const loadMaxHours = async () => {
    try {
      const stored = await AsyncStorage.getItem("maxHoursPerDay");
      if (stored) {
        const value = parseFloat(stored);
        if (!isNaN(value) && value > 0) {
          setMaxHoursPerDay(value);
        }
      }
    } catch (e) {
      console.log("loadMaxHours error:", e);
    }
  };

  const saveMaxHours = async (value) => {
    try {
      await AsyncStorage.setItem("maxHoursPerDay", String(value));
    } catch (e) {
      console.log("saveMaxHours error:", e);
    }
  };

  const handleChangeMaxHours = (delta) => {
    setMaxHoursPerDay((prev) => {
      let next = prev + delta;
      if (next < 0.5) next = 0.5;
      if (next > 8) next = 8;
      const rounded = Number(next.toFixed(1));
      saveMaxHours(rounded);
      return rounded;
    });
  };

  // ---- weekly_blocks laden ----
  const loadWeeklyRules = async () => {
    try {
      const { data, error } = await supabase
        .from("weekly_blocks")
        .select("*")
        .order("court_index", { ascending: true });

      if (error) {
        console.log("Supabase weekly_blocks load error:", error.message);
        Alert.alert("DB-Fehler (weekly_blocks laden)", error.message);
        return;
      }

      const mapped = (data || []).map((row) => ({
        id: row.id,
        courtIndex: row.court_index,
        weekday: row.weekday,
        from: row.from_time,
        to: row.to_time,
        reason: row.reason || "",
      }));

      setWeeklyRules(mapped);
    } catch (e) {
      console.log("weekly_blocks load exception:", e);
      Alert.alert("DB-Fehler (weekly_blocks Exception)", String(e));
    }
  };

  // ---- Users laden ----
  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) {
        console.log("Supabase users load error:", error.message);
        return;
      }

      setUsers(data || []);
    } catch (e) {
      console.log("Users load exception:", e);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    loadWeeklyRules();
    loadUsers();
    loadMaxHours();
  }, []);

  // ---- neue Auto-Regel speichern ----
  const handleAddRule = async () => {
  if (!fromTime.match(/^\d{2}:\d{2}$/) || !toTime.match(/^\d{2}:\d{2}$/)) {
    Alert.alert(
      "Zeitformat falsch",
      "Bitte Zeit im Format HH:MM eingeben, z.B. 18:00."
    );
    return;
  }
  if (toTime <= fromTime) {
    Alert.alert("Ungültiger Bereich", "Endzeit muss nach der Startzeit liegen.");
    return;
  }
  if (selectedCourtIndices.length === 0) {
    Alert.alert(
      "Kein Platz gewählt",
      "Bitte wähle mindestens einen Platz aus."
    );
    return;
  }

  try {
    const rowsToInsert = selectedCourtIndices.map((courtIndex) => ({
      court_index: courtIndex,
      weekday: selectedWeekday,
      from_time: fromTime,
      to_time: toTime,
      reason: ruleReason.trim() || null,
    }));

    const { error } = await supabase
      .from("weekly_blocks")
      .insert(rowsToInsert);

    if (error) {
      console.log("Insert weekly_block error:", error.message);
      Alert.alert("Fehler", "Regel konnte nicht gespeichert werden.");
      return;
    }

    setRuleReason("");
    await loadWeeklyRules();

    const platzText =
      selectedCourtIndices.length === 1
        ? COURTS[selectedCourtIndices[0]]
        : selectedCourtIndices.map((i) => COURTS[i]).join(", ");

    Alert.alert(
      "Regel hinzugefügt",
      `Sperre für ${platzText} am ${
        WEEKDAYS[selectedWeekday]
      } von ${fromTime} bis ${toTime}${
        ruleReason.trim() ? ` – ${ruleReason.trim()}` : ""
      }.`
    );
  } catch (e) {
    console.log("Insert weekly_block exception:", e);
    Alert.alert("Fehler", "Regel konnte nicht gespeichert werden.");
  }
};


  // ---- Regel löschen ----
  const handleDeleteRule = async (id) => {
    try {
      const { error } = await supabase
        .from("weekly_blocks")
        .delete()
        .eq("id", id);

      if (error) {
        console.log("Delete weekly_block error:", error.message);
        Alert.alert("Fehler", "Regel konnte nicht gelöscht werden.");
        return;
      }

      await loadWeeklyRules();
    } catch (e) {
      console.log("Delete weekly_block exception:", e);
      Alert.alert("Fehler", "Regel konnte nicht gelöscht werden.");
    }
  };

  // ---- Nutzerstatus ändern ----
  const updateUserStatus = async (id, newStatus) => {
    try {
      const { error } = await supabase
        .from("users")
        .update({ status: newStatus })
        .eq("id", id);

      if (error) {
        console.log("Update user status error:", error.message);
        Alert.alert("Fehler", "Status konnte nicht geändert werden.");
        return;
      }

      loadUsers();
    } catch (e) {
      console.log("Update user status exception:", e);
    }
  };

  // ---- UI ----
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtnHeader}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backText}>{"< Zurück"}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Admin-Einstellungen</Text>
        <View style={{ width: 60 }} />
      </View>

      <Text style={styles.subtitle}>
        Angemeldet als {userName} (Admin)
      </Text>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === "blocks" && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab("blocks")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "blocks" && styles.tabTextActive,
            ]}
          >
            Sperrzeiten
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === "users" && styles.tabButtonActive,
          ]}
          onPress={() => setActiveTab("users")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "users" && styles.tabTextActive,
            ]}
          >
            Benutzer
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === "blocks" && (
        <ScrollView
          style={styles.tabContent}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <Text style={styles.sectionTitle}>Automatische Sperrzeiten</Text>

          {/* Sperrzeiten-Form */}
  <Text style={styles.label}>Platz / Plätze</Text>
<View style={styles.rowBtns}>
  {COURTS.map((court, index) => {
    const active = selectedCourtIndices.includes(index);
    return (
      <TouchableOpacity
        key={court}
        style={[styles.chip, active && styles.chipActive]}
        onPress={() => {
          setSelectedCourtIndices((prev) => {
            if (prev.includes(index)) {
              // abwählen
              const next = prev.filter((i) => i !== index);
              // mindestens ein Platz muss ausgewählt bleiben
              return next.length === 0 ? prev : next;
            } else {
              // hinzufügen
              return [...prev, index];
            }
          });
        }}
      >
        <Text
          style={[styles.chipText, active && styles.chipTextActive]}
        >
          {court}
        </Text>
      </TouchableOpacity>
    );
  })}
</View>


          <Text style={styles.label}>Wochentag</Text>
          <View style={styles.rowBtns}>
            {WEEKDAYS.map((day, index) => {
              const active = index === selectedWeekday;
              return (
                <TouchableOpacity
                  key={day}
                  style={[styles.chipSmall, active && styles.chipActive]}
                  onPress={() => setSelectedWeekday(index)}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Von (HH:MM)</Text>
          <TextInput
            style={styles.input}
            value={fromTime}
            onChangeText={setFromTime}
            placeholder="z.B. 18:00"
            placeholderTextColor="#9fb0c8"
          />

          <Text style={styles.label}>Bis (HH:MM)</Text>
          <TextInput
            style={styles.input}
            value={toTime}
            onChangeText={setToTime}
            placeholder="z.B. 20:00"
            placeholderTextColor="#9fb0c8"
          />

          <Text style={styles.label}>Grund (optional)</Text>
          <TextInput
            style={styles.input}
            value={ruleReason}
            onChangeText={setRuleReason}
            placeholder='z.B. "Herren-Training"'
            placeholderTextColor="#9fb0c8"
          />

          <TouchableOpacity style={styles.addBtn} onPress={handleAddRule}>
            <Text style={styles.addBtnText}>Regel hinzufügen</Text>
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>
            Max. Stunden pro Tag / Spieler
          </Text>
          <View style={styles.maxRow}>
            <TouchableOpacity
              style={styles.maxButton}
              onPress={() => handleChangeMaxHours(-0.5)}
            >
              <Text style={styles.maxButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.maxValue}>
              {maxHoursPerDay.toString().replace(".", ",")}
            </Text>
            <TouchableOpacity
              style={styles.maxButton}
              onPress={() => handleChangeMaxHours(0.5)}
            >
              <Text style={styles.maxButtonText}>+</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>
            Aktive automatische Sperrzeiten
          </Text>
          {weeklyRules.length === 0 ? (
            <Text style={styles.rulesEmpty}>Noch keine Regeln angelegt.</Text>
          ) : (
            weeklyRules.map((rule) => (
              <View key={rule.id} style={styles.ruleCard}>
                <Text style={styles.ruleText}>
                  {COURTS[rule.courtIndex]} – {WEEKDAYS[rule.weekday]}{" "}
                  {rule.from}–{rule.to}
                  {rule.reason ? ` – ${rule.reason}` : ""}
                </Text>
                <TouchableOpacity
                  style={styles.ruleDeleteBtn}
                  onPress={() => handleDeleteRule(rule.id)}
                >
                  <Text style={styles.ruleDeleteText}>Löschen</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {activeTab === "users" && (
        <ScrollView
          style={styles.tabContent}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <Text style={styles.sectionTitle}>Benutzerverwaltung</Text>

          <TouchableOpacity style={styles.reloadBtn} onPress={loadUsers}>
            <Text style={styles.reloadText}>
              {loadingUsers ? "Aktualisiere..." : "Neu laden"}
            </Text>
          </TouchableOpacity>

          {users.length === 0 ? (
            <Text style={styles.rulesEmpty}>Noch keine Nutzer registriert.</Text>
          ) : (
            users.map((u) => (
              <View key={u.id} style={styles.userCard}>
                <Text style={styles.userName}>
                  {u.name}{" "}
                  <Text style={styles.userStatus}>
                    ({u.status || "unbekannt"})
                  </Text>
                </Text>
                <View style={styles.userActions}>
                  {u.status === "pending" && (
                    <>
                      <TouchableOpacity
                        style={styles.userBtnApprove}
                        onPress={() => updateUserStatus(u.id, "approved")}
                      >
                        <Text style={styles.userBtnTextDark}>Freischalten</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.userBtnBlock}
                        onPress={() => updateUserStatus(u.id, "blocked")}
                      >
                        <Text style={styles.userBtnText}>Sperren</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {u.status === "approved" && (
                    <TouchableOpacity
                      style={styles.userBtnBlock}
                      onPress={() => updateUserStatus(u.id, "blocked")}
                    >
                      <Text style={styles.userBtnText}>Sperren</Text>
                    </TouchableOpacity>
                  )}
                  {u.status === "blocked" && (
                    <TouchableOpacity
                      style={styles.userBtnApprove}
                      onPress={() => updateUserStatus(u.id, "approved")}
                    >
                      <Text style={styles.userBtnTextDark}>Freischalten</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738", paddingTop: 40 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    alignItems: "center",
    marginBottom: 4,
  },
  backBtnHeader: {
    paddingVertical: 8,
    paddingRight: 12,
  },
  backText: { color: "#f28b25", fontSize: 14 },
  title: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: "#c3d0ea",
    fontSize: 12,
    textAlign: "center",
    marginBottom: 8,
  },
  tabRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "#022449",
    borderRadius: 999,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  tabButtonActive: {
    backgroundColor: "#f28b25",
  },
  tabText: { color: "#c3d0ea", fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#001738", fontWeight: "700" },
  tabContent: { flex: 1, paddingHorizontal: 16, marginTop: 4 },
  sectionTitle: {
    color: "#ffffff",
    fontWeight: "700",
    marginBottom: 6,
    fontSize: 14,
  },
  label: {
    color: "#d6e0f0",
    fontSize: 13,
    marginBottom: 4,
    marginTop: 8,
  },
  rowBtns: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 4,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#355a8a",
  },
  chipSmall: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#355a8a",
  },
  chipActive: {
    backgroundColor: "#f28b25",
    borderColor: "#f28b25",
  },
  chipText: { color: "#ffffff", fontSize: 13 },
  chipTextActive: { color: "#001738", fontWeight: "700" },
  input: {
    backgroundColor: "#022449",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: "#ffffff",
    borderWidth: 1,
    borderColor: "#355a8a",
    fontSize: 14,
  },
  addBtn: {
    marginTop: 12,
    backgroundColor: "#f28b25",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  addBtnText: { color: "#001738", fontWeight: "700", fontSize: 14 },
  rulesEmpty: { color: "#9fb0c8", fontSize: 12 },
  ruleCard: {
    backgroundColor: "#022449",
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#355a8a",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  ruleText: { color: "#ffffff", fontSize: 13, flex: 1, marginRight: 8 },
  ruleDeleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#f28b25",
  },
  ruleDeleteText: {
    color: "#f28b25",
    fontSize: 12,
    fontWeight: "600",
  },
  userCard: {
    backgroundColor: "#022449",
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#355a8a",
  },
  userName: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  userStatus: { color: "#c3d0ea", fontSize: 12 },
  userActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  userBtnApprove: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: "#f28b25",
  },
  userBtnBlock: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#f28b25",
  },
  userBtnText: { color: "#f28b25", fontSize: 12, fontWeight: "600" },
  userBtnTextDark: { color: "#001738", fontSize: 12, fontWeight: "700" },
  forbiddenText: {
    color: "#ffffff",
    textAlign: "center",
    marginTop: 80,
    fontSize: 14,
  },
  backBtn: {
    marginTop: 12,
    alignSelf: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f28b25",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  backBtnText: { color: "#f28b25", fontSize: 13 },
  reloadBtn: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#355a8a",
    marginBottom: 4,
    backgroundColor: "#022449",
  },
  reloadText: { color: "#c3d0ea", fontSize: 12 },
  maxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  maxButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f28b25",
    alignItems: "center",
    justifyContent: "center",
  },
  maxButtonText: {
    color: "#f28b25",
    fontSize: 18,
    fontWeight: "700",
  },
  maxValue: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
});
