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
  ActivityIndicator,
  Modal,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabaseClient";
import { getCurrentUserProfile, normalizeUserStatus } from "../authProfile";
import { Ionicons } from "@expo/vector-icons";
import BottomNav from "../components/BottomNav";

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

function isNetworkFetchError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("networkerror")
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function BookingScreen({ navigation }) {
  // WICHTIG: Identitaet und Admin-Rolle kommen nie aus route.params/URL.
  const [userName, setUserName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const [date, setDate] = useState(new Date());
  const [maxHoursPerDay, setMaxHoursPerDay] = useState(2);
  const [sessionReady, setSessionReady] = useState(false);
const [isRetryingBookings, setIsRetryingBookings] = useState(false);
const lastFetchWarnRef = useRef(0);

  const [bookings, setBookings] = useState([]);
  const [blockedSlots, setBlockedSlots] = useState([]);
  const [weeklyRules, setWeeklyRules] = useState([]);
  const [weeklyExceptions, setWeeklyExceptions] = useState([]);

  const [courtClosures, setCourtClosures] = useState({ 0: false, 1: false, 2: false });
const [courtClosureReason, setCourtClosureReason] = useState({ 0: "", 1: "", 2: "" });

  // Modal für „von–bis“ + Mitspieler
  const [bookingModalVisible, setBookingModalVisible] = useState(false);
  const [pendingSlot, setPendingSlot] = useState(null); // { courtIndex, startTime, isSingleSlot }
  const [endOptions, setEndOptions] = useState([]);
  const [selectedEndTime, setSelectedEndTime] = useState(null);
  const [coPlayerNameInput, setCoPlayerNameInput] = useState("");
  // --- Co-Player Picker ---
  const [coPickerOpen, setCoPickerOpen] = useState(false);
  const [coPickerSearch, setCoPickerSearch] = useState("");
  const [allUsers, setAllUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
const pendingDeleteRef = useRef(new Set()); // merkt sich Slots, die gerade gelöscht werden
const gridScrollRef = useRef(null);
const retryBookingsRef = useRef(false);
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

  const goToday = () => {
    setDate(new Date());
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
  let active = true;
  let sub = null;

  const goToLogin = async () => {
    try {
      await AsyncStorage.removeItem("user_login");
    } catch {}

    if (!active) return;
    setSessionReady(false);
    setMyUserId(null);
    setUserName("");
    setIsAdmin(false);
    setAuthChecked(true);
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  };

  const boot = async (attempt = 0) => {
    try {
      const { session, profile } = await getCurrentUserProfile();
      if (!active) return;

      if (!session?.user?.id || !profile) {
        await goToLogin();
        return;
      }

      const status = normalizeUserStatus(profile.status);
      const admin = !!profile.is_admin;

      if (status === "blocked" || (status !== "approved" && !admin)) {
        try {
          await supabase.auth.signOut();
        } catch {}
        await goToLogin();
        return;
      }

      setUserName(profile.name || session.user.email || "Spieler");
      setIsAdmin(admin);
      setMyUserId(session.user.id);
      setSessionReady(true);
      setAuthChecked(true);

      // Der lokale Komfort-Cache darf die Rolle spiegeln, ist aber nie Berechtigungsquelle.
      try {
        await AsyncStorage.setItem(
          "user_login",
          JSON.stringify({
            email: profile.email || session.user.email || "",
            name: profile.name || "",
            is_admin: admin,
          })
        );
      } catch {}
    } catch (e) {
      console.log("boot session/profile error:", e?.message || e);

      // Bei einem kurzen iOS-/Netzwerk-Hänger nicht sofort ausloggen.
      if (isNetworkFetchError(e) && attempt < 2) {
        setTimeout(() => {
          if (active) boot(attempt + 1);
        }, 700 * (attempt + 1));
        return;
      }

      await goToLogin();
    }
  };

  boot();

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (!active) return;
    setSessionReady(!!session?.user?.id);
    setMyUserId(session?.user?.id || null);

    if (event === "SIGNED_OUT" || !session?.user?.id) {
      // Nicht im Callback auf weitere Supabase-Abfragen warten.
      setTimeout(() => {
        if (active) goToLogin();
      }, 0);
    }
  });
  sub = data?.subscription;

  return () => {
    active = false;
    try {
      sub?.unsubscribe?.();
    } catch {}
  };
}, [navigation]);

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
// Helper (oberhalb von loadBookingsForDate einfügen)
async function ensureSupabaseSession() {
  try {
    const { data: s1, error: e1 } = await supabase.auth.getSession();
    if (e1) console.log("getSession error:", e1.message);
    if (s1?.session) return s1.session;

    // iOS PWA/Home-Screen: Session ist manchmal erst nach refreshSession verfügbar
    const { data: s2, error: e2 } = await supabase.auth.refreshSession();
    if (e2) console.log("refreshSession error:", e2.message);
    return s2?.session || null;
  } catch (e) {
    console.log("ensureSupabaseSession exception:", String(e));
    return null;
  }
}

const loadBookingsForDate = async (dateKey) => {
  try {
    // 1) Session erzwingen (WICHTIG iOS PWA/Home-Screen)
    const session = await ensureSupabaseSession();

    // ❗WICHTIG: NICHT bookings leeren, sonst bleibt UI bei iOS leer hängen
    if (!session?.user?.id) {
      console.log(
        "No session in loadBookingsForDate -> skip (keep previous bookings)"
      );
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

    // 4) Pending deletes filtern
    const filtered = mapped.filter((b) => !pendingDeleteRef.current.has(b.id));
    setBookings(filtered);

    console.log(`Bookings loaded for ${dateKey}:`, filtered.length);
  } catch (e) {
    const msg = String(e?.message || e);
    const low = msg.toLowerCase();

    const isNet =
      low.includes("failed to fetch") ||
      low.includes("network request failed") ||
      low.includes("load failed") ||
      low.includes("networkerror");

    if (isNet) {
      console.log("Transient fetch error -> retry once...", msg);

      if (retryBookingsRef.current) return;
      retryBookingsRef.current = true;

      setTimeout(async () => {
        try {
          await loadBookingsForDate(dateKey);
        } finally {
          retryBookingsRef.current = false;
        }
      }, 900);

      return;
    }

    console.log("Supabase load exception:", e);
    showMessage("DB-Fehler (Buchungen laden)", msg);
  }
};


// ======= AUTO REFRESH ALLE 5 SEKUNDEN =======
useEffect(() => {
  if (!sessionReady) return;

const interval = setInterval(() => {
  loadBookingsForDate(currentDateKey);
  loadWeeklyRules();
  loadWeeklyExceptions(currentDateKey);
  loadCourtClosures(); // ✅ NEU
}, 5000);

  return () => clearInterval(interval);
}, [currentDateKey, sessionReady]);

useEffect(() => {
  if (!sessionReady) return;
  loadBookingsForDate(currentDateKey);
  loadWeeklyExceptions(currentDateKey);
  loadCourtClosures(); // ✅ NEU
}, [currentDateKey, sessionReady]);

// ✅ Web/PWA Resume-Fix (iOS Home-Screen + Android Web)
useEffect(() => {
  if (Platform.OS !== "web" || !sessionReady) return;

  const onResume = async () => {
    // kleiner Delay nach Unlock/Tab-Wechsel
    setTimeout(async () => {
      try {
        await supabase.auth.refreshSession();
      } catch {}

      loadBookingsForDate(currentDateKey);
      loadWeeklyRules();
      loadWeeklyExceptions(currentDateKey);
    }, 600);
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") onResume();
  };

  window.addEventListener("focus", onResume);
  window.addEventListener("online", onResume);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.removeEventListener("focus", onResume);
    window.removeEventListener("online", onResume);
    document.removeEventListener("visibilitychange", onVisibility);
  };
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
  const msg = String(e?.message || e);
  if (msg.toLowerCase().includes("failed to fetch")) {
    console.log("Transient weekly_rules fetch error, retrying...", msg);
    setTimeout(() => loadWeeklyRules(), 800);
    return;
  }
  console.log("weekly_blocks load exception:", e);
  showMessage("DB-Fehler (weekly_blocks Exception)", msg);
}
  };

  const loadWeeklyExceptions = async (dateKey) => {
  try {
    const { data, error } = await supabase
      .from("weekly_block_exceptions")
      .select("court_index, from_time, to_time, reason")
      .eq("date_key", dateKey);

    if (error) {
      console.log("weekly_block_exceptions load error:", error.message);
      return;
    }

    const mapped = (data || []).map((r) => ({
      courtIndex: r.court_index,
      from: r.from_time,
      to: r.to_time,
      reason: r.reason || "",
    }));

    setWeeklyExceptions(mapped);
  } catch (e) {
    console.log("weekly_block_exceptions load exception:", String(e));
  }
};

const loadCourtClosures = async () => {
  try {
    const { data, error } = await supabase
      .from("court_closures")
      .select("court_index, is_closed, reason");

    if (error) {
      console.log("court_closures load error:", error.message);
      return;
    }

    const map = { 0: false, 1: false, 2: false };
    const reasons = { 0: "", 1: "", 2: "" };

    (data || []).forEach((r) => {
      map[r.court_index] = !!r.is_closed;
      reasons[r.court_index] = r.reason || "";
    });

    setCourtClosures(map);
    setCourtClosureReason(reasons);
  } catch (e) {
    console.log("court_closures load exception:", String(e));
  }
};

const loadAllUsers = async () => {
  setUsersLoading(true);
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, name, status")
      .eq("status", "approved")
      .order("name", { ascending: true });

    if (error) {
      console.log("users picker load error:", error.message);
      setAllUsers([]);
      return;
    }

    setAllUsers((data || []).filter((u) => u?.name));
  } catch (e) {
    console.log("users picker load exception:", e?.message || e);
    setAllUsers([]);
  } finally {
    setUsersLoading(false);
  }
};

  useEffect(() => {
    if (!sessionReady) return;
    loadWeeklyRules();
  }, [sessionReady]);

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

  const isExceptionForSlot = (courtIndex, time) => {
  return weeklyExceptions.some((ex) => {
    if (ex.courtIndex !== courtIndex) return false;
    return time >= ex.from && time < ex.to;
  });
};

  const isAutomaticallyBlocked = (courtIndex, time) => {
  const hasWeekly = !!getAutoRuleForSlot(courtIndex, time);
  if (!hasWeekly) return false;

  // ✅ Ausnahme schlägt Weekly Block (für genau dieses Datum)
  if (isExceptionForSlot(courtIndex, time)) return false;

  return true;
};

const isCourtClosed = (courtIndex) => !!courtClosures?.[courtIndex];

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
    // Session holen -> user_id
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.log("getSession error:", sessionError.message);
      showMessage("Login-Fehler", "Session konnte nicht gelesen werden.");
      return false;
    }

    const userId = sessionData?.session?.user?.id || null;

    if (!userId) {
      showMessage("Nicht eingeloggt", "Bitte neu einloggen, um zu buchen.");
      return false;
    }

    const rows = times.map((t) => ({
      court_index: courtIndex,
      time: t,
      date_key: currentDateKey,
      user_name: userName,
      player2: coPlayerName || null,
      user_id: userId,
    }));

    const { error } = await supabase.from("bookings123").insert(rows);

    if (error) {
      console.log("Supabase insert error:", error.message);
      showMessage("Buchung fehlgeschlagen", error.message);
      return false;
    }

    return true;
  } catch (e) {
    console.log("Supabase insert exception:", e);
    showMessage("Buchung fehlgeschlagen", String(e));
    return false;
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
    if (isCourtClosed(courtIndex)) {
  showMessage(
    "Platz gesperrt",
    `Dieser Platz ist aktuell gesperrt.${
      courtClosureReason?.[courtIndex]
        ? `\n\nGrund: ${courtClosureReason[courtIndex]}`
        : ""
    }`
  );
  return;
}
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
    const saved = await insertMultipleBookingsToSupabase(
      courtIndex,
      timesToBook,
      coName
    );

    if (!saved) {
      const failedIds = new Set(newBookings.map((b) => b.id));
      setBookings((prev) => prev.filter((b) => !failedIds.has(b.id)));
      await loadBookingsForDate(currentDateKey);
    }

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

  if (!authChecked || !sessionReady || !userName) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.loadingLogo}>
          <Ionicons name="tennisball-outline" size={28} color="#F28B25" />
        </View>
        <ActivityIndicator color="#F28B25" />
        <Text style={styles.loadingText}>Anmeldung wird geprüft …</Text>
      </View>
    );
  }

  const firstName = String(userName || "Spieler").trim().split(/\s+/)[0];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* App header */}
      <View style={styles.appHeader}>
        <View style={styles.brandWrap}>
          <View style={styles.brandIcon}>
            <Ionicons name="tennisball-outline" size={23} color="#F28B25" />
          </View>
          <View>
            <Text style={styles.brandTitle}>Tennis Booking</Text>
            <Text style={styles.brandSubtitle}>Hallo {firstName}</Text>
          </View>
        </View>

        {isAdmin && (
          <TouchableOpacity
            style={styles.adminBtn}
            onPress={() => navigation.navigate("AdminSettings")}
            activeOpacity={0.85}
          >
            <Ionicons name="settings-outline" size={17} color="#F28B25" />
            <Text style={styles.adminBtnText}>Admin</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Date navigation */}
      <View style={[styles.dateCard, isTodaySelected && styles.dateCardToday]}>
        <TouchableOpacity onPress={() => changeDate(-1)} style={styles.dateArrow} activeOpacity={0.8}>
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.dateCenter}>
          <Text style={styles.dateText}>{formatDate(date)}</Text>
          <Text style={styles.dateHint}>{isTodaySelected ? "Heute" : isPastDaySelected ? "Vergangener Tag" : "Buchungstag"}</Text>
        </View>

        <TouchableOpacity onPress={() => changeDate(1)} style={styles.dateArrow} activeOpacity={0.8}>
          <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        {!isTodaySelected && (
          <TouchableOpacity onPress={goToday} style={styles.todayBtn} activeOpacity={0.85}>
            <Text style={styles.todayBtnText}>Heute</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Court headers */}
      <View style={styles.courtHeaderRow}>
        <View style={styles.timeHeaderCell}>
          <Ionicons name="time-outline" size={15} color="#6F86A8" />
        </View>
        {COURTS.map((court, index) => (
          <View key={court} style={styles.courtHeaderCell}>
            <Text style={styles.courtHeaderText}>Platz {index + 1}</Text>
            <Text style={styles.courtHeaderSub}>Court</Text>
          </View>
        ))}
      </View>

      {/* Booking grid */}
      <ScrollView
        ref={gridScrollRef}
        style={styles.gridScroll}
        contentContainerStyle={styles.gridContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.gridInner}>
          {isPastDaySelected && <View pointerEvents="none" style={styles.pastShadeFull} />}

          {showNowLine && nowLineTop != null && (
            <>
              <View pointerEvents="none" style={[styles.pastShadePartial, { height: nowLineTop }]} />
              <View pointerEvents="none" style={[styles.nowLineWrap, { top: nowLineTop }]}>
                <View style={styles.nowLineDot} />
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
              <View style={styles.timeCell}>
                <Text style={styles.timeText}>{time}</Text>
              </View>

              {COURTS.map((_, courtIndex) => {
                const blocked = isBlocked(courtIndex, time);
                const manualBlocked = isManuallyBlocked(courtIndex, time);
                const booked = isBooked(courtIndex, time);
                const booking = getBookingForSlot(courtIndex, time);
                const autoRule = getAutoRuleForSlot(courtIndex, time);
                const closed = isCourtClosed(courtIndex);
                const ownBooking = !!booking && booking.userName === userName;

                return (
                  <TouchableOpacity
                    key={`${courtIndex}-${time}`}
                    style={[
                      styles.slotCell,
                      closed && styles.slotCellCourtClosed,
                      !closed && blocked && styles.slotCellBlocked,
                      booked && !ownBooking && styles.slotCellBookedOther,
                      booked && ownBooking && styles.slotCellBookedOwn,
                    ]}
                    onPress={() => handleSlotPress(courtIndex, time)}
                    onLongPress={() => {
                      if (!isAdmin) return;
                      if (!isAutomaticallyBlocked(courtIndex, time)) {
                        toggleManualBlocked(courtIndex, time);
                      }
                    }}
                    delayLongPress={300}
                    activeOpacity={0.82}
                  >
                    {closed ? (
                      <>
                        <Ionicons name="lock-closed-outline" size={15} color="#7F91A8" />
                        <Text style={styles.closedText}>Gesperrt</Text>
                      </>
                    ) : booking ? (
                      <>
                        {ownBooking && (
                          <View style={styles.ownBadge}>
                            <Text style={styles.ownBadgeText}>DEINE</Text>
                          </View>
                        )}
                        <Text
                          style={[styles.bookingNameText, ownBooking && styles.bookingNameOwn]}
                          numberOfLines={2}
                        >
                          {ownBooking ? "Deine Buchung" : booking.userName}
                        </Text>
                        {!!booking.coPlayerName && (
                          <Text
                            style={[styles.coPlayerText, ownBooking && styles.coPlayerOwn]}
                            numberOfLines={1}
                          >
                            + {booking.coPlayerName}
                          </Text>
                        )}
                      </>
                    ) : blocked ? (
                      <>
                        <Ionicons name="ban-outline" size={15} color="#B7C1CF" />
                        <Text style={styles.blockedLabel} numberOfLines={2}>
                          {manualBlocked ? "Gesperrt" : autoRule?.reason || "Gesperrt"}
                        </Text>
                      </>
                    ) : (
                      <>
                        <View style={styles.freeDot} />
                        <Text style={styles.freeText}>Frei</Text>
                      </>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <BottomNav navigation={navigation} active="Booking" />

      {/* Booking confirmation sheet */}
      {bookingModalVisible && pendingSlot && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.sheetHandle} />

            <View style={styles.modalTitleRow}>
              <View style={styles.modalIconWrap}>
                <Ionicons name="calendar-outline" size={22} color="#F28B25" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Buchung bestätigen</Text>
                <Text style={styles.modalSubline}>Prüfe kurz die Details deiner Reservierung.</Text>
              </View>
            </View>

            <View style={styles.bookingSummaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Platz</Text>
                <Text style={styles.summaryValue}>{getCourtName(pendingSlot.courtIndex).replace("P", "Platz ")}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Datum</Text>
                <Text style={styles.summaryValue}>{formatDate(date)}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Beginn</Text>
                <Text style={styles.summaryValue}>{pendingSlot.startTime}</Text>
              </View>
            </View>

            {!pendingSlot.isSingleSlot ? (
              <>
                <Text style={styles.modalLabel}>Ende wählen</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.endTimeChips}
                >
                  {endOptions.map((endTime) => {
                    const active = selectedEndTime === endTime;
                    const mins = timeToMinutes(endTime) - timeToMinutes(pendingSlot.startTime);
                    const duration = mins < 60 ? `${mins} Min.` : `${String(mins / 60).replace(".5", ",5")} Std.`;
                    return (
                      <TouchableOpacity
                        key={endTime}
                        style={[styles.endTimeOption, active && styles.endTimeOptionActive]}
                        onPress={() => setSelectedEndTime(endTime)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.endTimeText, active && styles.endTimeTextActive]}>{endTime}</Text>
                        <Text style={[styles.endTimeDuration, active && styles.endTimeDurationActive]}>{duration}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            ) : (
              <View style={styles.singleDurationPill}>
                <Ionicons name="time-outline" size={16} color="#9FB0C8" />
                <Text style={styles.singleDurationText}>30 Minuten · keine Verlängerung möglich</Text>
              </View>
            )}

            <Text style={styles.modalLabel}>Mitspieler (optional)</Text>
            <View style={styles.coPlayerRow}>
              <View style={styles.coPlayerInputWrap}>
                <Ionicons name="person-add-outline" size={17} color="#7F93B0" />
                <TextInput
                  style={styles.coPlayerInput}
                  value={coPlayerNameInput}
                  onChangeText={setCoPlayerNameInput}
                  placeholder="Name des 2. Spielers"
                  placeholderTextColor="#7F93B0"
                />
              </View>

              <TouchableOpacity
                style={styles.coPickBtn}
                onPress={async () => {
                  setCoPickerSearch("");
                  setCoPickerOpen(true);
                  if (allUsers.length === 0) await loadAllUsers();
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="search-outline" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.confirmBookingBtn}
              onPress={handleConfirmBookingRange}
              activeOpacity={0.88}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color="#001738" />
              <Text style={styles.confirmBookingText}>Buchung bestätigen</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBookingBtn} onPress={handleCancelBookingRange} activeOpacity={0.8}>
              <Text style={styles.cancelBookingText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {coPickerOpen && (
        <Modal
          visible={coPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setCoPickerOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <View style={styles.sheetHandle} />
              <View style={styles.modalTitleRow}>
                <View style={styles.modalIconWrap}>
                  <Ionicons name="people-outline" size={22} color="#F28B25" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Spieler auswählen</Text>
                  <Text style={styles.modalSubline}>Wähle ein freigeschaltetes Vereinsmitglied.</Text>
                </View>
              </View>

              <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={18} color="#7F93B0" />
                <TextInput
                  value={coPickerSearch}
                  onChangeText={setCoPickerSearch}
                  placeholder="Spieler suchen …"
                  placeholderTextColor="#7F93B0"
                  style={styles.coSearchInput}
                />
              </View>

              {usersLoading ? (
                <View style={styles.usersLoading}>
                  <ActivityIndicator color="#F28B25" />
                  <Text style={styles.loadingText}>Lade Spieler …</Text>
                </View>
              ) : (
                <ScrollView style={styles.userList} showsVerticalScrollIndicator={false}>
                  {(allUsers || [])
                    .filter((u) => u.name.toLowerCase().includes(coPickerSearch.trim().toLowerCase()))
                    .map((u) => (
                      <TouchableOpacity
                        key={u.id || u.name}
                        style={styles.coUserRow}
                        onPress={() => {
                          setCoPlayerNameInput(u.name);
                          setCoPickerOpen(false);
                        }}
                        activeOpacity={0.85}
                      >
                        <View style={styles.userAvatarSmall}>
                          <Text style={styles.userAvatarLetter}>{String(u.name || "?").charAt(0).toUpperCase()}</Text>
                        </View>
                        <Text style={styles.coUserName} numberOfLines={1}>{u.name}</Text>
                        <Ionicons name="chevron-forward" size={17} color="#6F86A8" />
                      </TouchableOpacity>
                    ))}
                </ScrollView>
              )}

              <TouchableOpacity style={styles.cancelBookingBtn} onPress={() => setCoPickerOpen(false)}>
                <Text style={styles.cancelBookingText}>Schließen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#00152F",
    paddingTop: Platform.OS === "web" ? 26 : 44,
  },
  centered: { alignItems: "center", justifyContent: "center" },
  loadingLogo: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: "#082A52",
    borderWidth: 1,
    borderColor: "#173F69",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  loadingText: { color: "#9FB0C8", marginTop: 10, fontSize: 13 },

  appHeader: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandWrap: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#082A52",
    borderWidth: 1,
    borderColor: "#173F69",
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "900", letterSpacing: -0.4 },
  brandSubtitle: { color: "#7F93B0", fontSize: 12, marginTop: 1, fontWeight: "600" },
  adminBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: "rgba(242,139,37,0.10)",
    borderWidth: 1,
    borderColor: "rgba(242,139,37,0.35)",
  },
  adminBtnText: { color: "#F6A04B", fontSize: 12, fontWeight: "800" },

  dateCard: {
    marginHorizontal: 14,
    marginBottom: 12,
    minHeight: 64,
    paddingHorizontal: 8,
    borderRadius: 18,
    backgroundColor: "#062447",
    borderWidth: 1,
    borderColor: "#173F69",
    flexDirection: "row",
    alignItems: "center",
  },
  dateCardToday: { borderColor: "rgba(242,139,37,0.55)", backgroundColor: "#08284D" },
  dateArrow: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  dateCenter: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  dateText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  dateHint: { color: "#7F93B0", fontSize: 10, fontWeight: "700", marginTop: 3, textTransform: "uppercase", letterSpacing: 0.7 },
  todayBtn: { marginLeft: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 11, backgroundColor: "#F28B25" },
  todayBtnText: { color: "#001738", fontSize: 11, fontWeight: "900" },

  courtHeaderRow: { flexDirection: "row", alignItems: "stretch", paddingHorizontal: 10, marginBottom: 5 },
  timeHeaderCell: { width: 50, alignItems: "center", justifyContent: "center" },
  courtHeaderCell: {
    flex: 1,
    marginHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
  },
  courtHeaderText: { color: "#EAF0F8", fontSize: 12, fontWeight: "900" },
  courtHeaderSub: { color: "#607897", fontSize: 9, fontWeight: "700", marginTop: 1, textTransform: "uppercase", letterSpacing: 0.7 },

  gridScroll: { flex: 1 },
  gridContainer: { paddingHorizontal: 10, paddingBottom: 18, paddingTop: 3 },
  gridInner: { position: "relative" },
  row: { flexDirection: "row", minHeight: 68, marginBottom: 7 },
  timeCell: { width: 50, alignItems: "center", justifyContent: "center" },
  timeText: { color: "#8195AF", fontSize: 12, fontWeight: "800" },
  slotCell: {
    flex: 1,
    marginHorizontal: 3,
    minHeight: 68,
    paddingHorizontal: 5,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#143B64",
    backgroundColor: "#08284D",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  slotCellBookedOwn: { backgroundColor: "#F28B25", borderColor: "#F6A04B" },
  slotCellBookedOther: { backgroundColor: "#0D467A", borderColor: "#17609C" },
  slotCellBlocked: { backgroundColor: "#293545", borderColor: "#3C4B5E" },
  slotCellCourtClosed: { backgroundColor: "#171F2B", borderColor: "#293545" },
  freeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#7FDCB2", marginBottom: 4 },
  freeText: { color: "#BEECD6", fontSize: 12, fontWeight: "800" },
  ownBadge: { position: "absolute", top: 5, right: 5, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2, backgroundColor: "rgba(0,23,56,0.12)" },
  ownBadgeText: { color: "rgba(0,23,56,0.75)", fontSize: 7, fontWeight: "900", letterSpacing: 0.5 },
  bookingNameText: { color: "#FFFFFF", fontSize: 10.5, lineHeight: 13, fontWeight: "900", textAlign: "center" },
  bookingNameOwn: { color: "#001738" },
  coPlayerText: { color: "#C9DBEC", fontSize: 9, fontWeight: "700", marginTop: 3, textAlign: "center" },
  coPlayerOwn: { color: "rgba(0,23,56,0.75)" },
  blockedLabel: { color: "#CBD3DC", fontSize: 9.5, lineHeight: 12, fontWeight: "800", marginTop: 4, textAlign: "center" },
  closedText: { color: "#8C9BAF", fontSize: 9.5, fontWeight: "800", marginTop: 4 },

  pastShadePartial: { position: "absolute", left: 0, right: 0, top: 0, zIndex: 5, backgroundColor: "rgba(0,10,25,0.46)" },
  pastShadeFull: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 5, backgroundColor: "rgba(0,10,25,0.52)" },
  nowLineWrap: { position: "absolute", left: 42, right: 0, zIndex: 20, pointerEvents: "none", flexDirection: "row", alignItems: "center" },
  nowLineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#F28B25" },
  nowLine: { height: 2, backgroundColor: "#F28B25", borderRadius: 2, flex: 1, opacity: 0.95 },

  modalOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    backgroundColor: "rgba(0, 8, 20, 0.72)",
    justifyContent: "flex-end",
    alignItems: "center",
    zIndex: 100,
  },
  modalBox: {
    backgroundColor: "#071F3D",
    width: "96%",
    maxWidth: 520,
    maxHeight: "88%",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 30 : 22,
    borderRadius: 24,
    marginBottom: Platform.OS === "web" ? 14 : 10,
    borderWidth: 1,
    borderColor: "#19456F",
  },
  sheetHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: "#33516F", alignSelf: "center", marginBottom: 14 },
  modalTitleRow: { flexDirection: "row", gap: 11, alignItems: "center", marginBottom: 14 },
  modalIconWrap: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(242,139,37,0.10)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(242,139,37,0.25)" },
  modalTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", letterSpacing: -0.3 },
  modalSubline: { color: "#8195AF", fontSize: 11, marginTop: 2 },
  bookingSummaryCard: { backgroundColor: "#0A294D", borderWidth: 1, borderColor: "#16436C", borderRadius: 16, paddingHorizontal: 13, marginBottom: 15 },
  summaryRow: { minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  summaryDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.055)" },
  summaryLabel: { color: "#8195AF", fontSize: 11, fontWeight: "700" },
  summaryValue: { color: "#FFFFFF", fontSize: 12, fontWeight: "900", flex: 1, textAlign: "right" },
  modalLabel: { color: "#D9E3EF", fontSize: 12, fontWeight: "900", marginBottom: 8 },
  endTimeChips: { paddingBottom: 14, gap: 8 },
  endTimeOption: { minWidth: 76, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 13, borderWidth: 1, borderColor: "#1B4B77", backgroundColor: "#0A294D", alignItems: "center" },
  endTimeOptionActive: { backgroundColor: "#F28B25", borderColor: "#F28B25" },
  endTimeText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  endTimeTextActive: { color: "#001738" },
  endTimeDuration: { color: "#7F93B0", fontSize: 9, fontWeight: "700", marginTop: 2 },
  endTimeDurationActive: { color: "rgba(0,23,56,0.70)" },
  singleDurationPill: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 12, backgroundColor: "#0A294D", marginBottom: 14 },
  singleDurationText: { color: "#AFC0D2", fontSize: 11, fontWeight: "700" },
  coPlayerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  coPlayerInputWrap: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#0A294D", borderRadius: 13, paddingHorizontal: 11, borderWidth: 1, borderColor: "#16436C" },
  coPlayerInput: { flex: 1, color: "#FFFFFF", fontSize: 13, paddingVertical: 10 },
  coPickBtn: { width: 44, height: 44, borderRadius: 13, backgroundColor: "#123B66", borderWidth: 1, borderColor: "#1B4B77", alignItems: "center", justifyContent: "center" },
  confirmBookingBtn: { minHeight: 48, borderRadius: 14, backgroundColor: "#F28B25", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  confirmBookingText: { color: "#001738", fontSize: 14, fontWeight: "900" },
  cancelBookingBtn: { minHeight: 38, alignItems: "center", justifyContent: "center", marginTop: 4 },
  cancelBookingText: { color: "#91A4BC", fontSize: 12, fontWeight: "800" },
  searchWrap: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#0A294D", borderRadius: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: "#16436C", marginBottom: 10 },
  coSearchInput: { flex: 1, color: "#FFFFFF", fontSize: 13, paddingVertical: 10 },
  usersLoading: { paddingVertical: 18, alignItems: "center" },
  userList: { maxHeight: 320 },
  coUserRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.055)" },
  userAvatarSmall: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#123B66", alignItems: "center", justifyContent: "center" },
  userAvatarLetter: { color: "#F4A04C", fontSize: 13, fontWeight: "900" },
  coUserName: { flex: 1, color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
});
