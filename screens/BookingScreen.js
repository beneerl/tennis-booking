import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  Alert,
  TextInput,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabaseClient";

const SLOT_DURATION_HOURS = 0.5;

const generateTimeSlots = () => {
  const slots = [];
  let hour = 8;
  let minute = 0;

  // Letzter Startslot = 20:30 → Ende 21:00
  while (hour < 21) {
    const hh = hour.toString().padStart(2, "0");
    const mm = minute.toString().padStart(2, "0");
    slots.push(`${hh}:${mm}`);
    minute += 30;
    if (minute === 60) {
      minute = 0;
      hour += 1;
    }
  }
  return slots;
};

const TIME_SLOTS = generateTimeSlots();
const COURTS = ["P1", "P2", "P3"];
const getDateKey = (d) => d.toISOString().split("T")[0];

export default function BookingScreen({ route, navigation }) {
  const params = route?.params || {};
  const userName = params.userName || "Gast";
  const isAdmin = !!params.isAdmin;

  const [date, setDate] = useState(new Date());
  const [maxHoursPerDay, setMaxHoursPerDay] = useState(2);

  const [bookings, setBookings] = useState([]);
  const [blockedSlots, setBlockedSlots] = useState([]);
  const [weeklyRules, setWeeklyRules] = useState([]);

  // Modal für „von–bis“ + Mitspieler
  const [bookingModalVisible, setBookingModalVisible] = useState(false);
  const [pendingSlot, setPendingSlot] = useState(null); // { courtIndex, startTime, isSingleSlot }
  const [endOptions, setEndOptions] = useState([]);
  const [selectedEndTime, setSelectedEndTime] = useState(null);
  const [coPlayerNameInput, setCoPlayerNameInput] = useState("");

  const formatDate = (d) =>
    d.toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const changeDate = (days) => {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + days);
    setDate(newDate);
  };

  const currentDateKey = getDateKey(date);
  const currentWeekday = date.getDay();

  // -------- Max-Stunden aus AsyncStorage laden --------
  useEffect(() => {
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
        console.log("Fehler beim Laden von maxHoursPerDay:", e);
      }
    };
    loadMaxHours();
  }, []);

  // -------- Buchungen laden --------
  const loadBookingsForDate = async (dateKey) => {
    try {
      const { data, error } = await supabase
        .from("bookings123")
        .select("*")
        .eq("date_key", dateKey);

      if (error) {
        console.log("Supabase load error:", error.message);
        Alert.alert("DB-Fehler (Buchungen laden)", error.message);
        return;
      }

      const mapped = (data || []).map((row) => ({
        id: `${row.court_index}-${row.time}-${row.date_key}`,
        courtIndex: row.court_index,
        time: row.time,
        dateKey: row.date_key,
        userName: row.user_name,
        coPlayerName: row.player2 || "",
      }));

      setBookings(mapped);
    } catch (e) {
      console.log("Supabase load exception:", e);
      Alert.alert("DB-Fehler (Exception)", String(e));
    }
  };

  useEffect(() => {
    loadBookingsForDate(currentDateKey);
  }, [currentDateKey]);

  // -------- weekly_blocks laden --------
  const loadWeeklyRules = async () => {
    try {
      const { data, error } = await supabase.from("weekly_blocks").select("*");

      if (error) {
        console.log("Supabase weekly_blocks load error:", error.message);
        Alert.alert("DB-Fehler (weekly_blocks)", error.message);
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

  useEffect(() => {
    loadWeeklyRules();
  }, []);

  // -------- Hilfsfunktionen Sperren/Buchungen --------
  const getManualBlock = (courtIndex, time) => {
    const id = `${courtIndex}-${time}-${currentDateKey}`;
    return blockedSlots.find((b) => b.id === id);
  };

  const isManuallyBlocked = (courtIndex, time) =>
    !!getManualBlock(courtIndex, time);

  const getAutoRuleForSlot = (courtIndex, time) => {
    return weeklyRules.find((rule) => {
      if (rule.courtIndex !== courtIndex) return false;
      if (rule.weekday !== currentWeekday) return false;
      return time >= rule.from && time < rule.to;
    });
  };

  const isAutomaticallyBlocked = (courtIndex, time) =>
    !!getAutoRuleForSlot(courtIndex, time);

  const isBlocked = (courtIndex, time) =>
    isManuallyBlocked(courtIndex, time) ||
    isAutomaticallyBlocked(courtIndex, time);

  const toggleManualBlocked = (courtIndex, time) => {
    const id = `${courtIndex}-${time}-${currentDateKey}`;
    setBlockedSlots((prev) => {
      if (prev.some((b) => b.id === id)) {
        return prev.filter((b) => b.id !== id);
      }
      return [...prev, { id, courtIndex, time, dateKey: currentDateKey }];
    });
  };

  const isBooked = (courtIndex, time) => {
    const id = `${courtIndex}-${time}-${currentDateKey}`;
    return bookings.some((b) => b.id === id);
  };

  const getBookingForSlot = (courtIndex, time) => {
    const id = `${courtIndex}-${time}-${currentDateKey}`;
    return bookings.find((b) => b.id === id);
  };

  const deleteBookingFromSupabase = async (courtIndex, time) => {
    try {
      const { error } = await supabase
        .from("bookings123")
        .delete()
        .eq("court_index", courtIndex)
        .eq("time", time)
        .eq("date_key", currentDateKey);

      if (error) {
        console.log("Supabase delete error:", error.message);
        Alert.alert("DB-Fehler (Löschen)", error.message);
      }
    } catch (e) {
      console.log("Supabase delete exception:", e);
      Alert.alert("DB-Fehler (Exception)", String(e));
    }
  };

  const insertMultipleBookingsToSupabase = async (
    courtIndex,
    times,
    coPlayerName
  ) => {
    try {
      const rows = times.map((t) => ({
        court_index: courtIndex,
        time: t,
        date_key: currentDateKey,
        user_name: userName,
        player2: coPlayerName || null,
      }));

      const { error } = await supabase.from("bookings123").insert(rows);

      if (error) {
        console.log("Supabase insert error:", error.message);
        Alert.alert("DB-Fehler (Insert)", error.message);
      }
    } catch (e) {
      console.log("Supabase insert exception:", e);
      Alert.alert("DB-Fehler (Exception)", String(e));
    }
  };

  // mögliche Endzeiten für Start-Slot berechnen
  const getAvailableEndTimesForStart = (courtIndex, startTime) => {
    const startIndex = TIME_SLOTS.indexOf(startTime);
    if (startIndex === -1) return [];

    const options = [];
    let idx = startIndex + 1;

    while (idx < TIME_SLOTS.length) {
      const prevTime = TIME_SLOTS[idx - 1];
      const blocked = isBlocked(courtIndex, prevTime);
      const booked = isBooked(courtIndex, prevTime);

      if (blocked || booked) break;

      const endTime = TIME_SLOTS[idx];
      options.push(endTime);
      idx += 1;
    }

    return options;
  };

  // -------- Slot-Klick mit Von/Bis + Mitspieler --------
  const handleSlotPress = (courtIndex, time) => {
    const id = `${courtIndex}-${time}-${currentDateKey}`;
    const existing = bookings.find((b) => b.id === id);
    const courtName = COURTS[courtIndex];
    const dateLabel = formatDate(date);

    // 1) bestehende Buchung -> löschen
    if (existing) {
      if (existing.userName !== userName && !isAdmin) {
        Alert.alert(
          "Nicht erlaubt",
          "Diesen Slot hat jemand anders reserviert. Nur Admins können fremde Buchungen ändern."
        );
        return;
      }

      Alert.alert(
        "Buchung löschen?",
        `Möchtest du diese Buchung wirklich löschen?\n\nPlatz: ${courtName}\nDatum: ${dateLabel}\nZeit: ${time}\nSpieler: ${existing.userName}${
          existing.coPlayerName ? " / " + existing.coPlayerName : ""
        }`,
        [
          { text: "Abbrechen", style: "cancel" },
          {
            text: "Löschen",
            style: "destructive",
            onPress: async () => {
              setBookings((prev) => prev.filter((b) => b.id !== id));
              await deleteBookingFromSupabase(courtIndex, time);
            },
          },
        ]
      );
      return;
    }

    // 2) Slot ist gesperrt
    if (isBlocked(courtIndex, time)) {
      const autoRule = getAutoRuleForSlot(courtIndex, time);
      const reasonText = autoRule?.reason
        ? autoRule.reason
        : isManuallyBlocked(courtIndex, time)
        ? "Manuell gesperrt"
        : "Automatisch gesperrt";

      if (!isAdmin) {
        Alert.alert(
          "Gesperrt",
          `Dieser Zeitraum ist gesperrt.\n\nGrund: ${reasonText}\n\nNur Admins können Sperrzeiten bearbeiten.`
        );
        return;
      }

      Alert.alert(
        "Sperrzeit",
        `Dieser Zeitraum ist gesperrt.\n\nGrund: ${reasonText}`
      );
      return;
    }

    // 3) Neue Buchung → Endzeiten berechnen
    const options = getAvailableEndTimesForStart(courtIndex, time);

    // Modal öffnen – egal ob Single-Slot oder mit Endzeit
    const isSingleSlot = options.length === 0;

    setPendingSlot({ courtIndex, startTime: time, isSingleSlot });
    setEndOptions(options);
    setSelectedEndTime(options[0] || null);
    setCoPlayerNameInput("");
    setBookingModalVisible(true);
  };

  const handleConfirmBookingRange = async () => {
    if (!pendingSlot) {
      setBookingModalVisible(false);
      return;
    }

    const { courtIndex, startTime, isSingleSlot } = pendingSlot;
    const coName = coPlayerNameInput.trim();

    let timesToBook = [];

    if (isSingleSlot) {
      // nur 1 Slot
      timesToBook = [startTime];
    } else {
      if (!selectedEndTime) {
        Alert.alert("Hinweis", "Bitte eine Endzeit auswählen.");
        return;
      }
      const startIndex = TIME_SLOTS.indexOf(startTime);
      const endIndex = TIME_SLOTS.indexOf(selectedEndTime);
      if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
        setBookingModalVisible(false);
        return;
      }
      timesToBook = TIME_SLOTS.slice(startIndex, endIndex);
    }

    // Limit prüfen
    const bookingsTodayForUser = bookings.filter(
      (b) => b.dateKey === currentDateKey && b.userName === userName
    );
    const hoursAlready = bookingsTodayForUser.length * SLOT_DURATION_HOURS;
    const hoursNew = timesToBook.length * SLOT_DURATION_HOURS;
    const hoursAfter = hoursAlready + hoursNew;

    if (hoursAfter > maxHoursPerDay && !isAdmin) {
      Alert.alert(
        "Limit erreicht",
        `Mit dieser Buchung würdest du das Tageslimit von ${maxHoursPerDay} Stunden überschreiten.`
      );
      setBookingModalVisible(false);
      return;
    }

    const newBookings = timesToBook.map((t) => ({
      id: `${courtIndex}-${t}-${currentDateKey}`,
      courtIndex,
      time: t,
      dateKey: currentDateKey,
      userName,
      coPlayerName: coName,
    }));

    setBookings((prev) => [...prev, ...newBookings]);
    await insertMultipleBookingsToSupabase(courtIndex, timesToBook, coName);

    setBookingModalVisible(false);
    setPendingSlot(null);
    setEndOptions([]);
    setSelectedEndTime(null);
    setCoPlayerNameInput("");
  };

  const handleCancelBookingRange = () => {
    setBookingModalVisible(false);
    setPendingSlot(null);
    setEndOptions([]);
    setSelectedEndTime(null);
    setCoPlayerNameInput("");
  };

  const getCourtName = (courtIndex) =>
    COURTS[courtIndex] || `Platz ${courtIndex + 1}`;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* oben: nur Admin/Profil rechts */}
      <View style={styles.infoRow}>
        <View style={{ flex: 1 }} />
        <View style={styles.infoButtons}>
          {isAdmin && (
            <TouchableOpacity
              style={styles.adminBtn}
              onPress={() =>
                navigation.navigate("AdminSettings", {
                  userName,
                  isAdmin,
                })
              }
            >
              <Text style={styles.adminBtnText}>Admin</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.profileBtn}
            onPress={() => navigation.navigate("Profile")}
          >
            <Text style={styles.profileIcon}>👤</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Datum + Pfeile */}
      <View style={styles.subHeader}>
        <TouchableOpacity onPress={() => changeDate(-1)} style={styles.arrow}>
          <Text style={styles.arrowText}>{"<"}</Text>
        </TouchableOpacity>

        <Text style={styles.dateText}>{formatDate(date)}</Text>

        <TouchableOpacity onPress={() => changeDate(1)} style={styles.arrow}>
          <Text style={styles.arrowText}>{">"}</Text>
        </TouchableOpacity>
      </View>

      {/* Kopfzeile: Platznamen */}
      <View style={styles.courtHeaderRow}>
        {COURTS.map((court) => (
          <View key={court} style={styles.courtHeaderCell}>
            <Text style={styles.courtHeaderText}>{court}</Text>
          </View>
        ))}
      </View>

      {/* Grid */}
      <ScrollView contentContainerStyle={styles.gridContainer}>
        {TIME_SLOTS.map((time) => (
          <View key={time} style={styles.row}>
            {COURTS.map((_, courtIndex) => {
              const blocked = isBlocked(courtIndex, time);
              const manualBlocked = isManuallyBlocked(courtIndex, time);
              const booked = isBooked(courtIndex, time);
              const booking = getBookingForSlot(courtIndex, time);
              const autoRule = getAutoRuleForSlot(courtIndex, time);

              return (
                <TouchableOpacity
                  key={`${courtIndex}-${time}`}
                  style={[
                    styles.slotCell,
                    blocked && styles.slotCellBlocked,
                    booked && styles.slotCellBooked,
                  ]}
                  onPress={() => handleSlotPress(courtIndex, time)}
                  onLongPress={() => {
                    if (!isAdmin) return;
                    if (!isAutomaticallyBlocked(courtIndex, time)) {
                      toggleManualBlocked(courtIndex, time);
                    }
                  }}
                  delayLongPress={300}
                >
                  <Text
                    style={[
                      styles.slotText,
                      (booked || blocked) && styles.slotTextEmphasis,
                    ]}
                  >
                    {time}
                  </Text>
                  {booking && (
                    <Text style={styles.bookingNameText}>
                      {booking.userName}
                      {booking.coPlayerName
                        ? ` / ${booking.coPlayerName}`
                        : ""}
                  </Text>
                  )}
                  {blocked && !booked && (
                    <Text style={styles.blockedLabel}>
                      {manualBlocked
                        ? "GESPERRT"
                        : autoRule?.reason || "AUTO"}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {/* Modal für Von/Bis + Mitspieler */}
      {bookingModalVisible && pendingSlot && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Buchung bestätigen</Text>
            <Text style={styles.modalSubtitle}>
              Platz: {getCourtName(pendingSlot.courtIndex)}
              {"\n"}
              Datum: {formatDate(date)}
              {"\n"}
              Startzeit: {pendingSlot.startTime}
            </Text>

            {!pendingSlot.isSingleSlot ? (
              <>
                <Text style={styles.modalLabel}>Endzeit wählen</Text>
                <ScrollView
                  style={styles.endTimeList}
                  contentContainerStyle={{ paddingVertical: 6 }}
                >
                  {endOptions.map((endTime) => {
                    const active = selectedEndTime === endTime;
                    return (
                      <TouchableOpacity
                        key={endTime}
                        style={[
                          styles.endTimeOption,
                          active && styles.endTimeOptionActive,
                        ]}
                        onPress={() => setSelectedEndTime(endTime)}
                      >
                        <Text
                          style={[
                            styles.endTimeText,
                            active && styles.endTimeTextActive,
                          ]}
                        >
                          bis {endTime}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            ) : (
              <Text style={[styles.modalLabel, { marginBottom: 10 }]}>
                Dauer: 30 Minuten (keine Verlängerung möglich)
              </Text>
            )}

            <Text style={styles.modalLabel}>Mitspieler (optional)</Text>
            <TextInput
              style={styles.coPlayerInput}
              value={coPlayerNameInput}
              onChangeText={setCoPlayerNameInput}
              placeholder="Name des 2. Spielers"
              placeholderTextColor="#9fb0c8"
            />

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={handleCancelBookingRange}
              >
                <Text style={styles.modalButtonCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonConfirm]}
                onPress={handleConfirmBookingRange}
              >
                <Text style={styles.modalButtonConfirmText}>Buchen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738", paddingTop: 40 },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingBottom: 6,
    alignItems: "center",
  },
  infoButtons: { flexDirection: "row", alignItems: "center", gap: 6 },
  adminBtn: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#f28b25",
  },
  adminBtnText: { color: "#001738", fontSize: 13, fontWeight: "700" },
  profileBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#f28b25",
    marginLeft: 4,
  },
  profileIcon: {
    color: "#f28b25",
    fontSize: 16,
  },
  subHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#001e4f",
  },
  arrow: { padding: 8 },
  arrowText: { fontSize: 26, color: "#ffffff" },
  dateText: { fontSize: 20, color: "#ffffff", fontWeight: "800" },

  courtHeaderRow: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 2,
  },
  courtHeaderCell: {
    flex: 1,
    marginHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  courtHeaderText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },

  gridContainer: {
    paddingHorizontal: 8,
    paddingBottom: 20,
    paddingTop: 8,
  },
  row: { flexDirection: "row", marginBottom: 10 },
  slotCell: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 18,
    minHeight: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#183b63",
    backgroundColor: "rgba(8, 35, 80, 0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  slotCellBooked: {
    backgroundColor: "rgba(242, 139, 37, 0.95)",
    borderColor: "#f28b25",
  },
  slotCellBlocked: {
    backgroundColor: "rgba(80, 80, 90, 0.95)",
    borderColor: "#999999",
  },
  slotText: { color: "#ffffff", fontSize: 14 },
  slotTextEmphasis: { fontWeight: "700" },
  bookingNameText: {
    color: "#001738",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  blockedLabel: {
    color: "#ffffff",
    fontSize: 12,
    marginTop: 3,
    textAlign: "center",
  },

  // Modal
  modalOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalBox: {
    backgroundColor: "#001e4f",
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    minHeight: 260,
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8,
  },
  modalSubtitle: {
    color: "#c3d0ea",
    fontSize: 15,
    marginBottom: 12,
    lineHeight: 22,
  },
  modalLabel: {
    color: "#d6e0f0",
    fontSize: 15,
    marginBottom: 6,
    fontWeight: "600",
  },
  endTimeList: {
    maxHeight: 180,
    marginBottom: 14,
  },
  endTimeOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#355a8a",
    marginBottom: 6,
  },
  endTimeOptionActive: {
    backgroundColor: "#f28b25",
    borderColor: "#f28b25",
  },
  endTimeText: {
    color: "#ffffff",
    fontSize: 15,
  },
  endTimeTextActive: {
    color: "#001738",
    fontWeight: "800",
  },
  coPlayerInput: {
    backgroundColor: "#022449",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: "#ffffff",
    borderWidth: 1,
    borderColor: "#355a8a",
    fontSize: 14,
    marginBottom: 10,
  },
  modalButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
  modalButton: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
  },
  modalButtonCancel: {
    borderWidth: 1,
    borderColor: "#f28b25",
  },
  modalButtonCancelText: {
    color: "#f28b25",
    fontSize: 15,
    fontWeight: "600",
  },
  modalButtonConfirm: {
    backgroundColor: "#f28b25",
  },
  modalButtonConfirmText: {
    color: "#001738",
    fontSize: 15,
    fontWeight: "700",
  },
});
