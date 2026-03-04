import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
  Alert,
  TextInput,
  Platform,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabaseClient";

const SLOT_DURATION_HOURS = 0.5;
const SLOT_ROW_HEIGHT = 74; // geschätzte Höhe pro Zeitzeile inkl. Abstand

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
const getDateKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};


function confirmDelete(title, message) {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(message));
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
      { text: "Löschen", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

function showMessage(title, message) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}
function isSameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

export default function BookingScreen({ route, navigation }) {
  const params = route?.params || {};
  const userName = params.userName || "Gast";
  const isAdmin = !!params.isAdmin;

  const [date, setDate] = useState(new Date());
  const [maxHoursPerDay, setMaxHoursPerDay] = useState(2);
  const [sessionReady, setSessionReady] = useState(false);


  const [bookings, setBookings] = useState([]);
  const [blockedSlots, setBlockedSlots] = useState([]);
  const [weeklyRules, setWeeklyRules] = useState([]);

  // Modal für „von–bis“ + Mitspieler
  const [bookingModalVisible, setBookingModalVisible] = useState(false);
  const [pendingSlot, setPendingSlot] = useState(null); // { courtIndex, startTime, isSingleSlot }
  const [endOptions, setEndOptions] = useState([]);
  const [selectedEndTime, setSelectedEndTime] = useState(null);
  const [coPlayerNameInput, setCoPlayerNameInput] = useState("");
const pendingDeleteRef = useRef(new Set()); // merkt sich Slots, die gerade gelöscht werden
const gridScrollRef = useRef(null);
const [nowTick, setNowTick] = useState(Date.now());
const [didAutoScrollToday, setDidAutoScrollToday] = useState(false);
const [rowLayouts, setRowLayouts] = useState({}); 
// rowLayouts[time] = { y: number, h: number }

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
  const isTodaySelected = isSameCalendarDay(date, new Date());
  const today = new Date();
today.setHours(0, 0, 0, 0);

const selectedDay = new Date(date);
selectedDay.setHours(0, 0, 0, 0);

const isPastDaySelected = selectedDay.getTime() < today.getTime();
const isFutureDaySelected = selectedDay.getTime() > today.getTime();

const now = new Date(nowTick);
const nowMinutes = now.getHours() * 60 + now.getMinutes();

const firstSlotMinutes = timeToMinutes(TIME_SLOTS[0]); // 08:00
const lastVisibleEndMinutes = timeToMinutes(TIME_SLOTS[TIME_SLOTS.length - 1]) + 30; // 21:00

const showNowLine =
  isTodaySelected &&
  nowMinutes >= firstSlotMinutes; // ✅ bleibt auch nach 21:00 Uhr sichtbar

// Position der "Jetzt"-Linie innerhalb des Grids (in px)
const nowLineTop = (() => {
  if (!showNowLine) return null;

  const minutesFromStart = nowMinutes - firstSlotMinutes;
  const rowIndex = Math.floor(minutesFromStart / 30);

  // Sicherheits-Clamp
  const safeIndex = Math.max(0, Math.min(TIME_SLOTS.length - 1, rowIndex));
  const rowTime = TIME_SLOTS[safeIndex];

  const layout = rowLayouts[rowTime];
  if (!layout) return null; // noch nicht gemessen

  const slotStartMinutes = firstSlotMinutes + safeIndex * 30;
  const withinMinutes = nowMinutes - slotStartMinutes; // 0..29
  const frac = Math.max(0, Math.min(1, withinMinutes / 30));

  // Pixelgenau: y + Anteil der echten Row-Höhe
  return layout.y + frac * layout.h;
})();

// Slot ist vorbei? (nur heute)
const isPastSlot = (time) => {
  if (!isTodaySelected) return false;
  const slotStart = timeToMinutes(time);
  // ✅ sobald "jetzt" nach Slot-Start ist, gilt der Slot als vergangen/grau
  return nowMinutes > slotStart;
};
useEffect(() => {
  // Wenn NICHT heute ausgewählt ist -> immer nach oben scrollen
  if (!isTodaySelected) {
    try {
      gridScrollRef.current?.scrollTo?.({ y: 0, animated: false });
    } catch {}
    // wichtig: wenn du später wieder auf "heute" gehst, soll Auto-Scroll wieder gehen
    setDidAutoScrollToday(false);
  }
}, [currentDateKey, isTodaySelected]);
useEffect(() => {
  let sub = null;

  const boot = async () => {
    try {
      // 1) Session lesen
      const { data: s1 } = await supabase.auth.getSession();

      // 2) iOS Home-Screen: manchmal erst nach refreshSession da
      if (!s1?.session) {
        await supabase.auth.refreshSession();
      }

      // 3) nochmal prüfen
      const { data: s2 } = await supabase.auth.getSession();
      setSessionReady(!!s2?.session?.user?.id);

      // 4) bei Änderungen updaten (Login/Logout/Refresh)
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        setSessionReady(!!session?.user?.id);
      });
      sub = data?.subscription;
    } catch (e) {
      console.log("boot session error:", e);
      setSessionReady(false);
    }
  };

  boot();

  return () => {
    try {
      sub?.unsubscribe?.();
    } catch {}
  };
}, []);

useEffect(() => {
  const interval = setInterval(() => {
    setNowTick(Date.now());
  }, 60 * 1000); // jede Minute aktualisieren

  return () => clearInterval(interval);
}, []);

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
// Helper (oberhalb von loadBookingsForDate einfügen)
async function ensureSupabaseSession() {
  try {
    const { data: s1, error: e1 } = await supabase.auth.getSession();
    if (e1) console.log("getSession error:", e1.message);
    if (s1?.session) return s1.session;

    // iOS PWA: Session ist manchmal erst nach refreshSession verfügbar
    const { data: s2, error: e2 } = await supabase.auth.refreshSession();
    if (e2) console.log("refreshSession error:", e2.message);
    return s2?.session || null;
  } catch (e) {
    console.log("ensureSupabaseSession exception:", String(e));
    return null;
  }
}

// ✅ ERSETZEN: deine Funktion komplett so übernehmen
const loadBookingsForDate = async (dateKey) => {
  try {
    const { data: s } = await supabase.auth.getSession();
if (!s?.session?.user?.id) {
  console.log("No session yet -> skip bookings load");
  setBookings([]);
  return;
}

    // 1) Session erzwingen (WICHTIG für iOS Home-Screen + RLS)
    const session = await ensureSupabaseSession();
    if (!session?.user?.id) {
      console.log("No session in loadBookingsForDate (likely iOS PWA storage issue)");
      showMessage(
        "Nicht eingeloggt",
        "Bitte einmal neu einloggen. (iOS Home-Bildschirm kann Sessions verlieren.)"
      );
      setBookings([]);
      return;
    }

    // 2) Query
    const { data, error } = await supabase
      .from("bookings123")
      .select("*")
      .eq("date_key", dateKey);

    if (error) {
      console.log("Supabase load error:", error.message);
      showMessage("DB-Fehler (Buchungen laden)", error.message);
      return;
    }

    // 3) Mapping
    const mapped = (data || []).map((row) => ({
      id: `${row.court_index}-${row.time}-${row.date_key}`,
      courtIndex: row.court_index,
      time: row.time,
      dateKey: row.date_key,
      userName: row.user_name,
      coPlayerName: row.player2 || "",
    }));

    // 4) Pending deletes filtern (dein Code)
    const filtered = mapped.filter((b) => !pendingDeleteRef.current.has(b.id));
    setBookings(filtered);

    // (Optional) Debug
    console.log(`Bookings loaded for ${dateKey}:`, filtered.length);
  } catch (e) {
    console.log("Supabase load exception:", e);
    showMessage("DB-Fehler (Exception)", String(e));
  }
};


// ======= AUTO REFRESH ALLE 5 SEKUNDEN =======
useEffect(() => {
  if (!sessionReady) return;

  const interval = setInterval(() => {
    loadBookingsForDate(currentDateKey);
    loadWeeklyRules();
  }, 5000);

  return () => clearInterval(interval);
}, [currentDateKey, sessionReady]);

useEffect(() => {
  if (!sessionReady) return;
  loadBookingsForDate(currentDateKey);
}, [currentDateKey, sessionReady]);


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

  useEffect(() => {
  // Nur wenn "heute" ausgewählt ist
  if (!isTodaySelected) {
    setDidAutoScrollToday(false);
    return;
  }

  // Nur einmal pro Tagesansicht auto-scrollen
  if (didAutoScrollToday) return;

  // Nur wenn Linie sichtbar ist
  if (!showNowLine || nowLineTop == null) return;

  // kleines Delay, damit ScrollView sicher gerendert ist
  const t = setTimeout(() => {
    try {
      const y = Math.max(0, nowLineTop - 140); // etwas oberhalb der aktuellen Zeit landen
      gridScrollRef.current?.scrollTo?.({ y, animated: true });
      setDidAutoScrollToday(true);
    } catch (e) {
      console.log("auto-scroll error:", e);
    }
  }, 250);

  return () => clearTimeout(t);
}, [isTodaySelected, didAutoScrollToday, showNowLine, nowLineTop, currentDateKey]);

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
  const id = `${courtIndex}-${time}-${currentDateKey}`;

  // ✅ Pending merken, damit Auto-Refresh sie nicht zurückholt
  pendingDeleteRef.current.add(id);

  try {
    const { error } = await supabase
      .from("bookings123")
      .delete()
      .eq("court_index", courtIndex)
      .eq("time", time)
      .eq("date_key", currentDateKey);

    if (error) {
      // ❌ rollback: pending entfernen + reload
      pendingDeleteRef.current.delete(id);
      console.log("Supabase delete error:", error.message);
      showMessage("DB-Fehler (Löschen)", error.message);
      await loadBookingsForDate(currentDateKey);
      return;
    }

    // ✅ Erfolgreich: pending entfernen und einmal hart nachladen (optional aber sauber)
    pendingDeleteRef.current.delete(id);
    // await loadBookingsForDate(currentDateKey);
  } catch (e) {
    pendingDeleteRef.current.delete(id);
    console.log("Supabase delete exception:", e);
    showMessage("DB-Fehler (Exception)", String(e));
    await loadBookingsForDate(currentDateKey);
  }
};


const insertMultipleBookingsToSupabase = async (courtIndex, times, coPlayerName) => {
  try {
    // ✅ Session holen -> user_id
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.log("getSession error:", sessionError.message);
      Alert.alert("Login-Fehler", "Session konnte nicht gelesen werden.");
      return;
    }

    const userId = sessionData?.session?.user?.id || null;

    if (!userId) {
      Alert.alert("Nicht eingeloggt", "Bitte neu einloggen, um zu buchen.");
      return;
    }

    const rows = times.map((t) => ({
      court_index: courtIndex,
      time: t,
      date_key: currentDateKey,
      user_name: userName,
      player2: coPlayerName || null,
      user_id: userId, // ✅ NEU (WICHTIG für RLS)
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
    const past = isPastSlot(time);

if (past && !isAdmin) {
  showMessage("Vergangen", "Diese Uhrzeit ist bereits vergangen.");
  return;
}

    // 1) bestehende Buchung -> löschen
    if (existing) {
      if (existing.userName !== userName && !isAdmin) {
        showMessage(
          "Nicht erlaubt",
          "Diesen Slot hat jemand anders reserviert. Nur Admins können fremde Buchungen ändern."
        );
        return;
      }

      (async () => {
        const ok = await confirmDelete(
          "Buchung löschen?",
          `Möchtest du diese Buchung wirklich löschen?\n\nPlatz: ${courtName}\nDatum: ${dateLabel}\nZeit: ${time}\nSpieler: ${existing.userName}${
            existing.coPlayerName ? " / " + existing.coPlayerName : ""
          }`
        );

        if (!ok) return;

        setBookings((prev) => prev.filter((b) => b.id !== id));
        await deleteBookingFromSupabase(courtIndex, time);
      })();
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
        showMessage("Hinweis", "Bitte eine Endzeit auswählen.");
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
      showMessage(
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

{/* oben: Admin / Teams / Profil rechts */}
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

{/* ✅ Neuer Reiter: Teams/Liga */}
<TouchableOpacity
  style={styles.teamsBtn}
  onPress={() =>
    navigation.navigate("Teams", {
      userName,
      isAdmin,
    })
  }
>
  <Text style={styles.teamsIcon}>🎾</Text>
</TouchableOpacity>

{/* ✅ Neuer Reiter: LK */}
<TouchableOpacity
  style={styles.lkBtn}
  onPress={() => navigation.navigate("LK", { userName, isAdmin })}

>
  <Text style={styles.lkIcon}>📈</Text>
</TouchableOpacity>




    <TouchableOpacity
      style={styles.profileBtn}
      onPress={() => navigation.navigate("Profile")}
    >
      <Text style={styles.profileIcon}>👤</Text>
    </TouchableOpacity>
  </View>
</View>


      {/* Datum + Pfeile */}
      <View style={[styles.subHeader, isTodaySelected && styles.subHeaderToday]}>
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
<ScrollView
  ref={gridScrollRef}
  contentContainerStyle={styles.gridContainer}
>
<View style={styles.gridInner}>
  {/* ✅ Wenn ein vergangener Tag ausgewählt ist: alles grau */}
  {isPastDaySelected && (
    <View pointerEvents="none" style={styles.pastShadeFull} />
  )}

  {/* ✅ Heute: nur bis zur orange Linie grau */}
  {showNowLine && nowLineTop != null && (
    <>
      <View
        pointerEvents="none"
        style={[styles.pastShadePartial, { height: nowLineTop }]}
      />

      <View pointerEvents="none" style={[styles.nowLineWrap, { top: nowLineTop }]}>
        <View style={styles.nowLine} />
      </View>
    </>
  )}

{TIME_SLOTS.map((time) => (
  <View
    key={time}
    style={styles.row}
    onLayout={(e) => {
      const { y, height } = e.nativeEvent.layout;
      setRowLayouts((prev) => {
        const old = prev[time];
        if (old && old.y === y && old.h === height) return prev;
        return { ...prev, [time]: { y, h: height } };
      });
    }}
  >
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
            <Text style={styles.bookingNameText} numberOfLines={1}>
              {booking.userName}
              {booking.coPlayerName ? ` / ${booking.coPlayerName}` : ""}
            </Text>
          )}

          {blocked && !booked && (
            <Text style={styles.blockedLabel}>
              {manualBlocked ? "GESPERRT" : autoRule?.reason || "AUTO"}
            </Text>
          )}
        </TouchableOpacity>
      );
    })}
  </View>
))}
</View>
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
  pastShadePartial: {
  position: "absolute",
  left: 0,
  right: 0,
  top: 0,
  zIndex: 5,
  backgroundColor: "rgba(0,0,0,0.22)",
},

pastShadeFull: {
  position: "absolute",
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  zIndex: 5,
  backgroundColor: "rgba(0,0,0,0.22)",
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
  teamsBtn: {
  paddingVertical: 5,
  paddingHorizontal: 10,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "#355a8a",
  backgroundColor: "#022449",
},
lkBtn: {
  paddingVertical: 5,
  paddingHorizontal: 10,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "#355a8a",
  backgroundColor: "#022449",
},
lkIcon: {
  fontSize: 16,
},
subHeaderToday: {
  borderBottomWidth: 2,
  borderBottomColor: "#f28b25",
  backgroundColor: "#00265f", // minimal heller als #001e4f
},

teamsIcon: {
  fontSize: 16,
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
    fontSize: 16,
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
  slotText: { color: "#ffffff", fontSize: 14, zIndex: 2 },
  slotTextEmphasis: { fontWeight: "700" },
  bookingNameText: {
    color: "#001738",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  gridInner: {
  position: "relative",
},
slotCellPast: {
  backgroundColor: "rgba(0,0,0,0.28)",   // dunkler Overlay-Look
  borderColor: "rgba(255,255,255,0.08)",
  opacity: 0.90,
},
slotTextPast: {
  color: "rgba(255,255,255,0.55)",
},
slotCellBookedPast: {
  opacity: 0.78, // gebuchte vergangene Slots leicht dimmen, aber gut sichtbar
},

nowLineWrap: {
  position: "absolute",
  left: 0,
  right: 0,
  zIndex: 20, // ✅ niedrig
  pointerEvents: "none",
},

nowLine: {
  height: 2,
  backgroundColor: "#f28b25",
  borderRadius: 2,
  marginHorizontal: 4, // passt optisch zu den slot margins
  opacity: 0.95,
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
    alignItems: "center",      // Modal zentriert horizontal
  },
  modalBox: {
    backgroundColor: "#001e4f",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 30,         // genug Platz für die Buttons
    borderRadius: 22,          // alle 4 Ecken rund
    minHeight: 260,
    width: "96%",              // kleiner als Bildschirmbreite
    marginBottom: 24,          // Abstand zur Samsung-Leiste unten
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
