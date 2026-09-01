// screens/LKScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  StatusBar,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "../supabaseClient";
import { getCurrentUserProfile, normalizeUserStatus } from "../authProfile";
import { Ionicons } from "@expo/vector-icons";
import BottomNav from "../components/BottomNav";


const STORAGE_PROFILE = "lk_profile_v1";
const STORAGE_HISTORY = "lk_history_v1";

// ===== Helpers =====
const toNumber = (v) => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
};

const round3 = (n) => Math.round(n * 1000) / 1000;
const clampLK = (n) => Math.max(1, Math.min(25, n));
const uid = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const weeksBetween = (isoA, isoB) => {
  if (!isoA || !isoB) return 0;
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  const days = (b - a) / (1000 * 60 * 60 * 24);
  return Math.floor(days / 7);
};

const fmt = (n) => String(n ?? "").replace(".", ",");

// ===== BTV/DTB LK-Berechnung (Anhänge A.1–A.4) =====
const calcP = (d) => {
  if (d <= -4) return 10;
  if (d > -4 && d <= -2) return 1.25 * d ** 3 + 15 * d ** 2 + 60 * d + 90;
  if (d > -2 && d <= 4) return 15 * d + 50;
  if (d > 4 && d <= 6) return -3.75 * d ** 2 + 45 * d - 10;
  return 125;
};

const calcH = (lkWinner) => {
  if (lkWinner >= 10) return 10 * (30 - lkWinner);
  return (
    10 * (30 - lkWinner) +
    (6435 / 289) * ((20 * (5 - lkWinner)) / (lkWinner ** 2 + 1))
  );
};

const A_TABLE_M = {
  10: 25,
  11: 30,
  12: 40,
  13: 50,
  14: 60,
  15: 70,
  16: 80,
  17: 90,
  18: 100,
  21: 100,
  "Offene Klasse": 100,
  30: 90,
  35: 85,
  40: 80,
  45: 75,
  50: 70,
  55: 65,
  60: 60,
  65: 55,
  70: 50,
  75: 45,
  80: 40,
  85: 35,
  90: 30,
};

const calcA = (ageClass = "Offene Klasse") => (A_TABLE_M[ageClass] ?? 100) / 100;
const calcZ = (format = "standard") => (format === "short" ? 0.75 : 1.0);

const calcImprovementSingle = ({
  winnerLK,
  loserLK,
  ageClass = "Offene Klasse",
  format = "standard",
}) => {
  const d = winnerLK - loserLK;
  const P = calcP(d);
  const H = calcH(winnerLK);
  const A = calcA(ageClass);
  const Z = calcZ(format);
  return (P / H) * A * Z;
};

const calcImprovementDoubleForOneWinner = ({
  winnerLK,
  winnerPartnerLK,
  loserLK,
  loserPartnerLK,
  ageClass = "Offene Klasse",
  format = "standard",
}) => {
  const winnerAvg = (winnerLK + winnerPartnerLK) / 2;
  const loserAvg = (loserLK + loserPartnerLK) / 2;
  const base = calcImprovementSingle({
    winnerLK: winnerAvg,
    loserLK: loserAvg,
    ageClass,
    format,
  });
  return base * 0.5;
};

export default function LKScreen() {
  const navigation = useNavigation();
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);

  // Profil
  const [currentLK, setCurrentLK] = useState(16.0);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [useMotivation, setUseMotivation] = useState(false);
  const [currentLKText, setCurrentLKText] = useState("25,0");

  // Formular
  const [opponentLK, setOpponentLK] = useState("");
  const [type, setType] = useState("single");
  const [result, setResult] = useState("W");
  const [partnerLK, setPartnerLK] = useState("");
  const [opponentPartnerLK, setOpponentPartnerLK] = useState("");

  // Verlauf
  const [history, setHistory] = useState([]);

  const saveProfileLocal = async (next) => {
    await AsyncStorage.setItem(STORAGE_PROFILE, JSON.stringify(next));
  };

  const saveHistory = async (next) => {
    await AsyncStorage.setItem(STORAGE_HISTORY, JSON.stringify(next));
  };

  const load = async () => {
    try {
      const pRaw = await AsyncStorage.getItem(STORAGE_PROFILE);
      const hRaw = await AsyncStorage.getItem(STORAGE_HISTORY);

      if (pRaw) {
        const p = JSON.parse(pRaw);
        if (typeof p?.currentLK === "number") setCurrentLK(p.currentLK);
        if (typeof p?.autoUpdate === "boolean") setAutoUpdate(p.autoUpdate);
        if (typeof p?.useMotivation === "boolean") setUseMotivation(p.useMotivation);
      }

      if (hRaw) {
        const h = JSON.parse(hRaw);
        if (Array.isArray(h)) setHistory(h);
      }

      // Identitaet und Anzeigename immer aus der echten Session/DB ableiten.
      try {
        const { session, profile } = await getCurrentUserProfile();
        const status = normalizeUserStatus(profile?.status);
        const admin = !!profile?.is_admin;

        if (
          !session?.user?.id ||
          !profile ||
          status === "blocked" ||
          (status !== "approved" && !admin)
        ) {
          setUserName("");
          navigation.reset({ index: 0, routes: [{ name: "Login" }] });
          return;
        }

        setUserName(profile.name || session.user.email || "Spieler");
      } catch (e) {
        console.log("LK auth/profile load error:", e?.message || e);
        setUserName("");
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
        return;
      }
    } catch (e) {
      console.log("LK load error:", e?.message || e);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (loading) return;
    setCurrentLKText(fmt(round3(toNumber(currentLK) ?? 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    if (loading) return;
    saveProfileLocal({ currentLK, autoUpdate, useMotivation });
  }, [currentLK, autoUpdate, useMotivation, loading]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session?.user?.id) {
        setUserName("");
        setTimeout(() => {
          navigation.reset({ index: 0, routes: [{ name: "Login" }] });
        }, 0);
      }
    });

    return () => sub?.subscription?.unsubscribe?.();
  }, [navigation]);

  const onAddMatch = async () => {
    const own = toNumber(currentLK);
    const opp = toNumber(opponentLK);
    if (!own || !opp) return;

    const nowIso = new Date().toISOString();
    const lastIso = history?.[0]?.date || null;

    let lkBefore = own;
    let motivationApplied = 0;

    if (useMotivation && lastIso) {
      const w = weeksBetween(lastIso, nowIso);
      if (w > 0) {
        motivationApplied = round3(Math.min(25 - lkBefore, w * 0.025));
        lkBefore = clampLK(round3(lkBefore + motivationApplied));
      }
    }

    let delta = 0;
    let lkAfter = lkBefore;
    const TEAM_BONUS = 1.1;

    if (result === "W") {
      if (type === "single") {
        const base = calcImprovementSingle({
          winnerLK: lkBefore,
          loserLK: opp,
          ageClass: "Offene Klasse",
          format: "standard",
        });
        delta = base * TEAM_BONUS;
      } else {
        const pLK = toNumber(partnerLK) ?? lkBefore;
        const oppPLK = toNumber(opponentPartnerLK) ?? opp;

        const base = calcImprovementDoubleForOneWinner({
          winnerLK: lkBefore,
          winnerPartnerLK: pLK,
          loserLK: opp,
          loserPartnerLK: oppPLK,
          ageClass: "Offene Klasse",
          format: "standard",
        });
        delta = base * TEAM_BONUS;
      }

      delta = round3(Math.max(0, delta));
      lkAfter = clampLK(round3(lkBefore - delta));
    } else {
      delta = 0;
      lkAfter = lkBefore;
    }

    const entry = {
      id: uid(),
      date: nowIso,
      type,
      opponentLK: opp,
      opponentPartnerLK: toNumber(opponentPartnerLK) ?? null,
      partnerLK: toNumber(partnerLK) ?? null,
      result,
      motivationApplied,
      delta,
      lkBefore: round3(lkBefore),
      lkAfter: round3(lkAfter),
    };

    const nextHistory = [entry, ...history];
    setHistory(nextHistory);
    await saveHistory(nextHistory);

    if (autoUpdate) {
      setCurrentLK(lkAfter);
      setCurrentLKText(fmt(lkAfter));
    }

    setOpponentLK("");
    setPartnerLK("");
    setOpponentPartnerLK("");
  };

  const onUndo = async () => {
    if (history.length === 0) return;

    const [latest, ...rest] = history;
    setHistory(rest);
    await saveHistory(rest);

    if (autoUpdate && latest?.lkBefore != null) {
      setCurrentLK(latest.lkBefore);
      setCurrentLKText(fmt(latest.lkBefore));
    }
  };

  const headerLK = useMemo(() => round3(toNumber(currentLK) ?? 0), [currentLK]);

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.headerRow}>
          <View style={styles.headerIconSpacer} />
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>LK</Text>
            <Text style={styles.headerSubtitle}>LK-Rechner</Text>
          </View>
          <View style={styles.headerIconWrap}>
            <Ionicons name="stats-chart-outline" size={20} color="#F28B25" />
          </View>
        </View>
        <Text style={styles.muted}>Lade…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.headerRow}>
        <View style={styles.headerIconSpacer} />
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>LK</Text>
          <Text style={styles.headerSubtitle}>LK-Rechner</Text>
        </View>
        <View style={styles.headerIconWrap}>
          <Ionicons name="stats-chart-outline" size={20} color="#F28B25" />
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 14 }}
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Aktuelle LK</Text>
          <TextInput
            value={currentLKText}
            onChangeText={(t) => {
              const cleaned = String(t).replace(".", ",");
              setCurrentLKText(cleaned);
              const n = toNumber(cleaned);
              if (n != null) setCurrentLK(n);
            }}
            keyboardType="numbers-and-punctuation"
            style={styles.input}
            placeholder="z.B. 16,3"
            placeholderTextColor="#7f93b0"
          />
          <Text style={styles.bigLK}>{fmt(headerLK)}</Text>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>LK nach Eintrag aktualisieren</Text>
            <Switch value={autoUpdate} onValueChange={setAutoUpdate} />
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Motivationsaufschlag berücksichtigen</Text>
            <Switch value={useMotivation} onValueChange={setUseMotivation} />
          </View>

          <Text style={styles.note}>
            Motivation: +0,025 je voller Woche seit dem letzten Eintrag (bis LK 25).
          </Text>
          <Text style={styles.note}>Dein Name: {userName}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Match eintragen</Text>

          <View style={styles.segRow}>
            <TouchableOpacity
              style={[styles.seg, type === "single" && styles.segActive]}
              onPress={() => setType("single")}
              activeOpacity={0.9}
            >
              <Text style={[styles.segText, type === "single" && styles.segTextActive]}>
                Einzel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.seg, type === "double" && styles.segActive]}
              onPress={() => setType("double")}
              activeOpacity={0.9}
            >
              <Text style={[styles.segText, type === "double" && styles.segTextActive]}>
                Doppel
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.segRow}>
            <TouchableOpacity
              style={[styles.seg, result === "W" && styles.segActive]}
              onPress={() => setResult("W")}
              activeOpacity={0.9}
            >
              <Text style={[styles.segText, result === "W" && styles.segTextActive]}>
                Sieg
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.seg, result === "L" && styles.segActive]}
              onPress={() => setResult("L")}
              activeOpacity={0.9}
            >
              <Text style={[styles.segText, result === "L" && styles.segTextActive]}>
                Niederlage
              </Text>
            </TouchableOpacity>
          </View>

          {type === "double" ? (
            <>
              <Text style={styles.label}>Partner-LK</Text>
              <TextInput
                value={partnerLK}
                onChangeText={setPartnerLK}
                keyboardType="numbers-and-punctuation"
                style={styles.input}
                placeholder="z.B. 18,5"
                placeholderTextColor="#7f93b0"
              />

              <Text style={styles.label}>Gegner-LK 1</Text>
              <TextInput
                value={opponentLK}
                onChangeText={setOpponentLK}
                keyboardType="numbers-and-punctuation"
                style={styles.input}
                placeholder="z.B. 14,8"
                placeholderTextColor="#7f93b0"
              />

              <Text style={styles.label}>Gegner-LK 2</Text>
              <TextInput
                value={opponentPartnerLK}
                onChangeText={setOpponentPartnerLK}
                keyboardType="numbers-and-punctuation"
                style={styles.input}
                placeholder="z.B. 16,2"
                placeholderTextColor="#7f93b0"
              />
            </>
          ) : (
            <>
              <Text style={styles.label}>Gegner-LK</Text>
              <TextInput
                value={opponentLK}
                onChangeText={setOpponentLK}
                keyboardType="numbers-and-punctuation"
                style={styles.input}
                placeholder="z.B. 14,8"
                placeholderTextColor="#7f93b0"
              />
            </>
          )}

          <TouchableOpacity style={styles.primaryBtn} onPress={onAddMatch} activeOpacity={0.9}>
            <Text style={styles.primaryText}>Eintrag speichern</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={onUndo} activeOpacity={0.9}>
            <Text style={styles.secondaryText}>Letzten Eintrag rückgängig</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Verlauf</Text>

          {history.length === 0 ? (
            <Text style={styles.muted}>Noch keine Einträge.</Text>
          ) : (
            history.map((h) => (
              <View key={h.id} style={styles.historyRow}>
                <Text style={styles.hMain}>
                  {h.result === "W" ? "✅ Sieg" : "❌ Niederlage"} ·{" "}
                  {h.type === "single" ? "Einzel" : "Doppel"} · Gegner {fmt(h.opponentLK)}
                </Text>
                <Text style={styles.hSub}>
                  LK {fmt(h.lkBefore)} → {fmt(h.lkAfter)} · Δ {fmt(h.delta)}
                  {h.motivationApplied ? ` · Motivation +${fmt(h.motivationApplied)}` : ""}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <BottomNav navigation={navigation} active="LK" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#00152F", paddingTop: 40 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    paddingHorizontal: 14,
  },
  headerIconSpacer: { width: 40, height: 40 },
  headerCenter: { flex: 1, alignItems: "center" },
  headerIconWrap: { width: 40, height: 40, borderRadius: 13, backgroundColor: "#082A52", borderWidth: 1, borderColor: "#173F69", alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#ffffff", fontSize: 19, fontWeight: "900" },
  headerSubtitle: { color: "#7187A4", fontSize: 10, marginTop: 2, fontWeight: "700" },

  tabsRow: { flexDirection: "row", gap: 8, marginBottom: 10, paddingHorizontal: 14 },
  tabBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#173F69",
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#082A52",
  },
  tabBtnActive: { backgroundColor: "#F28B25", borderColor: "#F28B25" },
  tabText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  tabTextActive: { color: "#001738" },

  card: {
    backgroundColor: "#062447",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#173F69",
    marginBottom: 12,
  },
  cardTitle: { color: "#fff", fontSize: 14, fontWeight: "900", marginBottom: 10 },
  muted: { color: "#9fb0c8" },

  input: {
    borderWidth: 1,
    borderColor: "#173F69",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    fontWeight: "800",
  },
  bigLK: { marginTop: 10, color: "#F28B25", fontSize: 28, fontWeight: "900", textAlign: "center" },

  row: { marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  rowLabel: { color: "#c3d0ea", fontSize: 12, fontWeight: "800", flex: 1 },

  note: { marginTop: 10, color: "#9fb0c8", fontSize: 12, lineHeight: 16 },

  label: { marginTop: 12, color: "#c3d0ea", fontSize: 12, fontWeight: "900", marginBottom: 6 },

  segRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  seg: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#173F69",
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#082A52",
  },
  segActive: { backgroundColor: "#F28B25", borderColor: "#F28B25" },
  segText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  segTextActive: { color: "#001738" },

  primaryBtn: {
    marginTop: 12,
    backgroundColor: "#F28B25",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryText: { color: "#001738", fontWeight: "900" },

  secondaryBtn: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#173F69",
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#fff", fontWeight: "900" },

  historyRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  hMain: { color: "#fff", fontWeight: "900", fontSize: 12 },
  hSub: { color: "#9fb0c8", marginTop: 4, fontSize: 12, fontWeight: "800" },

  // Rangliste
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  boardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },



  refreshBtn: {
    width: 44,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#173F69",
    alignItems: "center",
    justifyContent: "center",
  },
  refreshText: { color: "#ffffff", fontSize: 18, fontWeight: "900" },

  boardRank: { width: 36, color: "#9fb0c8", fontWeight: "900" },
  boardName: { color: "#ffffff", fontWeight: "900" },
  boardMeta: { color: "#9fb0c8", marginTop: 2, fontSize: 11, fontWeight: "800" },
  boardLK: { color: "#F28B25", fontWeight: "900", fontSize: 14 },

  // Partner Picker Modal
  pickBtn: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#173F69",
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#082A52",
  },
  pickBtnText: { color: "#ffffff", fontWeight: "900" },

  modalOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  modalBox: {
    width: "96%",
    backgroundColor: "#001e4f",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#173F69",
    marginBottom: 24,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  modalClose: { padding: 8 },
  modalCloseText: { color: "#fff", fontSize: 16, fontWeight: "900" },

  searchInput: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#173F69",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    fontWeight: "800",
  },

  pickerRow: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#173F69",
    backgroundColor: "#082A52",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pickerName: { color: "#fff", fontWeight: "900", flex: 1, paddingRight: 10 },
  pickerLK: { color: "#F28B25", fontWeight: "900" },
});
