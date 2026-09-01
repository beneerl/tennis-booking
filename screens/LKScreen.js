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
import TennisLoader from "../components/TennisLoader";


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
        <TennisLoader />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <View style={styles.headerIconBox}>
          <Ionicons name="stats-chart-outline" size={20} color="#F28B25" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerKicker}>TENNIS TACHERTING</Text>
          <Text style={styles.headerTitle}>LK-Rechner</Text>
        </View>
        <View style={styles.headerMiniBadge}>
          <Text style={styles.headerMiniLabel}>LK</Text>
          <Text style={styles.headerMiniValue}>{fmt(headerLK)}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.lkHero}>
          <View style={styles.lkHeroTop}>
            <View>
              <Text style={styles.eyebrow}>DEINE AKTUELLE LK</Text>
              <Text style={styles.lkHeroValue}>{fmt(headerLK)}</Text>
            </View>
            <View style={styles.lkHeroIcon}>
              <Ionicons name="speedometer-outline" size={24} color="#F28B25" />
            </View>
          </View>

          <View style={styles.inlineField}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabelSmall}>LK manuell anpassen</Text>
              <TextInput
                value={currentLKText}
                onChangeText={(t) => {
                  const cleaned = String(t).replace(".", ",");
                  setCurrentLKText(cleaned);
                  const n = toNumber(cleaned);
                  if (n != null) setCurrentLK(n);
                }}
                keyboardType="numbers-and-punctuation"
                style={styles.compactInput}
                placeholder="z.B. 16,3"
                placeholderTextColor="#637B98"
              />
            </View>
            <View style={styles.profilePill}>
              <Ionicons name="person-outline" size={13} color="#7187A4" />
              <Text style={styles.profilePillText} numberOfLines={1}>{userName}</Text>
            </View>
          </View>

          <View style={styles.settingsBox}>
            <View style={styles.settingRow}>
              <View style={styles.settingIcon}>
                <Ionicons name="refresh-outline" size={17} color="#79E0BE" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Automatisch aktualisieren</Text>
                <Text style={styles.settingSub}>Neue Ergebnisse direkt auf deine LK anwenden.</Text>
              </View>
              <Switch
                value={autoUpdate}
                onValueChange={setAutoUpdate}
                trackColor={{ false: "#173A5D", true: "#8A5428" }}
                thumbColor={autoUpdate ? "#F28B25" : "#7187A4"}
              />
            </View>

            <View style={[styles.settingRow, styles.settingRowBorder]}>
              <View style={styles.settingIcon}>
                <Ionicons name="time-outline" size={17} color="#8EA9C6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>Motivationsaufschlag</Text>
                <Text style={styles.settingSub}>+0,025 je voller Woche seit dem letzten Eintrag.</Text>
              </View>
              <Switch
                value={useMotivation}
                onValueChange={setUseMotivation}
                trackColor={{ false: "#173A5D", true: "#8A5428" }}
                thumbColor={useMotivation ? "#F28B25" : "#7187A4"}
              />
            </View>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.eyebrow}>BERECHNUNG</Text>
            <Text style={styles.sectionTitle}>Match eintragen</Text>
          </View>
          <View style={styles.sectionIcon}>
            <Ionicons name="tennisball-outline" size={19} color="#F28B25" />
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.groupLabel}>MATCHART</Text>
          <View style={styles.segmentRow}>
            <TouchableOpacity
              style={[styles.segment, type === "single" && styles.segmentActive]}
              onPress={() => setType("single")}
              activeOpacity={0.88}
            >
              <Ionicons name="person-outline" size={16} color={type === "single" ? "#001738" : "#91A7C0"} />
              <Text style={[styles.segmentText, type === "single" && styles.segmentTextActive]}>Einzel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, type === "double" && styles.segmentActive]}
              onPress={() => setType("double")}
              activeOpacity={0.88}
            >
              <Ionicons name="people-outline" size={16} color={type === "double" ? "#001738" : "#91A7C0"} />
              <Text style={[styles.segmentText, type === "double" && styles.segmentTextActive]}>Doppel</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.groupLabel, { marginTop: 14 }]}>ERGEBNIS</Text>
          <View style={styles.segmentRow}>
            <TouchableOpacity
              style={[styles.segment, result === "W" && styles.segmentWin]}
              onPress={() => setResult("W")}
              activeOpacity={0.88}
            >
              <Ionicons name="trophy-outline" size={16} color={result === "W" ? "#001738" : "#91A7C0"} />
              <Text style={[styles.segmentText, result === "W" && styles.segmentTextActive]}>Sieg</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, result === "L" && styles.segmentLoss]}
              onPress={() => setResult("L")}
              activeOpacity={0.88}
            >
              <Ionicons name="close-circle-outline" size={16} color={result === "L" ? "#F5C1C1" : "#91A7C0"} />
              <Text style={[styles.segmentText, result === "L" && styles.segmentLossText]}>Niederlage</Text>
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
                placeholderTextColor="#637B98"
              />

              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Gegner-LK 1</Text>
                  <TextInput
                    value={opponentLK}
                    onChangeText={setOpponentLK}
                    keyboardType="numbers-and-punctuation"
                    style={styles.input}
                    placeholder="z.B. 14,8"
                    placeholderTextColor="#637B98"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Gegner-LK 2</Text>
                  <TextInput
                    value={opponentPartnerLK}
                    onChangeText={setOpponentPartnerLK}
                    keyboardType="numbers-and-punctuation"
                    style={styles.input}
                    placeholder="z.B. 16,2"
                    placeholderTextColor="#637B98"
                  />
                </View>
              </View>
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
                placeholderTextColor="#637B98"
              />
            </>
          )}

          <TouchableOpacity style={styles.primaryBtn} onPress={onAddMatch} activeOpacity={0.9}>
            <Ionicons name="add-circle-outline" size={18} color="#001738" />
            <Text style={styles.primaryText}>Eintrag speichern</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.undoBtn} onPress={onUndo} activeOpacity={0.88}>
            <Ionicons name="arrow-undo-outline" size={15} color="#8198B4" />
            <Text style={styles.undoText}>Letzten Eintrag rückgängig</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.eyebrow}>VERLAUF</Text>
            <Text style={styles.sectionTitle}>Letzte Matches</Text>
          </View>
          <View style={styles.historyCount}>
            <Text style={styles.historyCountText}>{history.length}</Text>
          </View>
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={24} color="#4E6988" />
            <Text style={styles.emptyTitle}>Noch keine Einträge</Text>
            <Text style={styles.emptyText}>Deine berechneten LK-Matches erscheinen hier.</Text>
          </View>
        ) : (
          history.map((h) => (
            <View key={h.id} style={styles.historyCard}>
              <View style={[styles.resultIcon, h.result === "W" ? styles.resultIconWin : styles.resultIconLoss]}>
                <Ionicons
                  name={h.result === "W" ? "trophy-outline" : "close-outline"}
                  size={17}
                  color={h.result === "W" ? "#F28B25" : "#F0A7A7"}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.historyTitle}>
                  {h.result === "W" ? "Sieg" : "Niederlage"} · {h.type === "single" ? "Einzel" : "Doppel"}
                </Text>
                <Text style={styles.historyMeta}>Gegner LK {fmt(h.opponentLK)}</Text>
                <Text style={styles.historyChange}>LK {fmt(h.lkBefore)} → {fmt(h.lkAfter)}</Text>
                {!!h.motivationApplied && (
                  <Text style={styles.historyMotivation}>Motivation +{fmt(h.motivationApplied)}</Text>
                )}
              </View>
              <View style={[styles.deltaPill, h.delta > 0 && styles.deltaPillPositive]}>
                <Text style={[styles.deltaText, h.delta > 0 && styles.deltaTextPositive]}>
                  {h.delta > 0 ? `−${fmt(h.delta)}` : "0"}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <BottomNav navigation={navigation} active="LK" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738", paddingTop: 40 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 15, paddingBottom: 26 },
  header: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 15, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#123356" },
  headerIconBox: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#08264A", borderWidth: 1, borderColor: "#173F66", alignItems: "center", justifyContent: "center" },
  headerKicker: { color: "#7187A4", fontSize: 8.5, fontWeight: "900", letterSpacing: 0.8 },
  headerTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginTop: 1 },
  headerMiniBadge: { minWidth: 54, height: 42, borderRadius: 13, backgroundColor: "#302719", borderWidth: 1, borderColor: "#6C4B28", alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  headerMiniLabel: { color: "#A78155", fontSize: 7, fontWeight: "900", letterSpacing: 0.6 },
  headerMiniValue: { color: "#F28B25", fontSize: 14, fontWeight: "900", marginTop: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  muted: { color: "#8DA4BF", fontSize: 11 },
  lkHero: { marginTop: 15, backgroundColor: "#051E3B", borderRadius: 20, borderWidth: 1, borderColor: "#173F66", padding: 15 },
  lkHeroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: "#7187A4", fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  lkHeroValue: { color: "#FFFFFF", fontSize: 42, lineHeight: 48, fontWeight: "900", letterSpacing: -1.5, marginTop: 2 },
  lkHeroIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: "rgba(242,139,37,0.09)", borderWidth: 1, borderColor: "rgba(242,139,37,0.23)", alignItems: "center", justifyContent: "center" },
  inlineField: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#123858", flexDirection: "row", alignItems: "flex-end", gap: 10 },
  fieldLabelSmall: { color: "#6F87A4", fontSize: 8.5, fontWeight: "800", marginBottom: 5 },
  compactInput: { minHeight: 40, borderRadius: 11, backgroundColor: "#03172E", borderWidth: 1, borderColor: "#153A5D", paddingHorizontal: 10, color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  profilePill: { maxWidth: 130, minHeight: 40, borderRadius: 11, backgroundColor: "#071D38", borderWidth: 1, borderColor: "#143858", paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  profilePillText: { color: "#8198B4", fontSize: 9.5, fontWeight: "800", flexShrink: 1 },
  settingsBox: { marginTop: 12, borderRadius: 14, backgroundColor: "#03172E", borderWidth: 1, borderColor: "#123858", overflow: "hidden" },
  settingRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, paddingVertical: 8 },
  settingRowBorder: { borderTopWidth: 1, borderTopColor: "#123858" },
  settingIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#092943", alignItems: "center", justifyContent: "center" },
  settingTitle: { color: "#DDE8F3", fontSize: 10.5, fontWeight: "900" },
  settingSub: { color: "#657F9D", fontSize: 8.4, lineHeight: 12, marginTop: 2, paddingRight: 6 },
  sectionHeader: { marginTop: 20, marginBottom: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "900", letterSpacing: -0.3, marginTop: 2 },
  sectionIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#302719", borderWidth: 1, borderColor: "#654725", alignItems: "center", justifyContent: "center" },
  formCard: { backgroundColor: "#051E3B", borderRadius: 20, borderWidth: 1, borderColor: "#173F66", padding: 14 },
  groupLabel: { color: "#6D86A5", fontSize: 7.8, fontWeight: "900", letterSpacing: 0.85, marginBottom: 6 },
  segmentRow: { flexDirection: "row", gap: 8 },
  segment: { flex: 1, minHeight: 43, borderRadius: 12, backgroundColor: "#03172E", borderWidth: 1, borderColor: "#173A5D", flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  segmentActive: { backgroundColor: "#F28B25", borderColor: "#F28B25" },
  segmentWin: { backgroundColor: "#F28B25", borderColor: "#F28B25" },
  segmentLoss: { backgroundColor: "#352331", borderColor: "#6F3D57" },
  segmentText: { color: "#91A7C0", fontSize: 10.5, fontWeight: "900" },
  segmentTextActive: { color: "#001738" },
  segmentLossText: { color: "#F5C1C1" },
  label: { marginTop: 13, color: "#829AB7", fontSize: 9, fontWeight: "800", marginBottom: 5 },
  input: { minHeight: 43, borderRadius: 12, backgroundColor: "#03172E", borderWidth: 1, borderColor: "#173A5D", paddingHorizontal: 11, color: "#FFFFFF", fontSize: 11.5, fontWeight: "800" },
  twoCol: { flexDirection: "row", gap: 8 },
  primaryBtn: { marginTop: 15, minHeight: 46, borderRadius: 13, backgroundColor: "#F28B25", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  primaryText: { color: "#001738", fontSize: 11, fontWeight: "900" },
  undoBtn: { marginTop: 8, minHeight: 39, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#061B35", borderWidth: 1, borderColor: "#123858" },
  undoText: { color: "#8198B4", fontSize: 9.5, fontWeight: "800" },
  historyCount: { minWidth: 34, height: 30, borderRadius: 10, backgroundColor: "#08264A", borderWidth: 1, borderColor: "#173F66", alignItems: "center", justifyContent: "center" },
  historyCountText: { color: "#9FB1C7", fontSize: 10, fontWeight: "900" },
  emptyCard: { minHeight: 120, borderRadius: 18, borderWidth: 1, borderColor: "#153A5D", backgroundColor: "#041A34", alignItems: "center", justifyContent: "center", padding: 18 },
  emptyTitle: { color: "#DCE6F1", fontSize: 12, fontWeight: "900", marginTop: 7 },
  emptyText: { color: "#667F9B", fontSize: 9, marginTop: 3, textAlign: "center" },
  historyCard: { minHeight: 78, backgroundColor: "#051E3B", borderRadius: 16, borderWidth: 1, borderColor: "#153A5D", padding: 10, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  resultIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  resultIconWin: { backgroundColor: "rgba(242,139,37,0.08)", borderColor: "rgba(242,139,37,0.24)" },
  resultIconLoss: { backgroundColor: "rgba(205,102,120,0.08)", borderColor: "rgba(205,102,120,0.23)" },
  historyTitle: { color: "#E4EDF5", fontSize: 11, fontWeight: "900" },
  historyMeta: { color: "#7790AD", fontSize: 8.7, marginTop: 2 },
  historyChange: { color: "#9FB1C7", fontSize: 9.3, fontWeight: "800", marginTop: 3 },
  historyMotivation: { color: "#6E88A5", fontSize: 7.8, marginTop: 2 },
  deltaPill: { minWidth: 40, minHeight: 30, borderRadius: 10, backgroundColor: "#0B2947", alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  deltaPillPositive: { backgroundColor: "#302719" },
  deltaText: { color: "#7189A6", fontSize: 9, fontWeight: "900" },
  deltaTextPositive: { color: "#F28B25" },
});
