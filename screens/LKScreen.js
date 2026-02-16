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

const STORAGE_PROFILE = "lk_profile_v1";
const STORAGE_HISTORY = "lk_history_v1";

// ===== Helpers =====
const toNumber = (v) => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
};

const round3 = (n) => Math.round(n * 1000) / 1000;

// LK grob begrenzen (DTB LK-System geht typ. 1..25)
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

// A.1 Punktefunktion P (d = Sieger-LK - Verlierer-LK)
const calcP = (d) => {
  if (d <= -4) return 10;
  if (d > -4 && d <= -2) return 1.25 * d ** 3 + 15 * d ** 2 + 60 * d + 90;
  if (d > -2 && d <= 4) return 15 * d + 50;
  if (d > 4 && d <= 6) return -3.75 * d ** 2 + 45 * d - 10;
  return 125; // d > 6
};

// A.2 Hürde H (abhängig von Sieger-LK)
const calcH = (lkWinner) => {
  if (lkWinner >= 10) return 10 * (30 - lkWinner);
  return (
    10 * (30 - lkWinner) +
    (6435 / 289) * ((20 * (5 - lkWinner)) / (lkWinner ** 2 + 1))
  );
};

// A.3 Altersklassenfaktor A – für Herren (m)
// Für euch i. d. R. "Offene Klasse" => 100%
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

// A.4 Zählweisenfaktor Z – Standard: 100%, Kurzsatz: 75%
const calcZ = (format = "standard") => (format === "short" ? 0.75 : 1.0);

// LK-Verbesserung für Sieger (Einzel): (P/H) * A * Z
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

// Doppelregel: mit arithm. Mitteln; Ergebnis zu 50% auf beide Sieger verteilt
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
  const [loading, setLoading] = useState(true);

  // Profil
  const [currentLK, setCurrentLK] = useState(16.0);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [useMotivation, setUseMotivation] = useState(false);

  // Formular
  const [opponentLK, setOpponentLK] = useState("");
  const [type, setType] = useState("single"); // single | double
  const [result, setResult] = useState("W"); // W | L

  // Doppel optional
  const [partnerLK, setPartnerLK] = useState("");
  const [opponentPartnerLK, setOpponentPartnerLK] = useState("");

  // Verlauf
  const [history, setHistory] = useState([]);

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
    } catch {}
    setLoading(false);
  };

  const saveProfile = async (next) => {
    await AsyncStorage.setItem(STORAGE_PROFILE, JSON.stringify(next));
  };
  const saveHistory = async (next) => {
    await AsyncStorage.setItem(STORAGE_HISTORY, JSON.stringify(next));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (loading) return;
    saveProfile({ currentLK, autoUpdate, useMotivation });
  }, [currentLK, autoUpdate, useMotivation, loading]);

  const onAddMatch = async () => {
    const own = toNumber(currentLK);
    const opp = toNumber(opponentLK);
    if (!own || !opp) return;

    const nowIso = new Date().toISOString();
    const lastIso = history?.[0]?.date || null;

    // optional Motivationsaufschlag: +0,025 je volle Woche seit letztem Eintrag (bis LK 25)
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

    // Punktspiel-Bonus +10% (bei euch: immer Punktspiel)
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
        // Doppel: Partner LK optional, Gegner-Partner optional
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
      lkAfter = clampLK(round3(lkBefore - delta)); // Sieg => Zahl wird kleiner (besser)
    } else {
      // Niederlage: Verlierer bleibt unberührt (delta = 0)
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

    if (autoUpdate) setCurrentLK(lkAfter);

    setOpponentLK("");
    setPartnerLK("");
    setOpponentPartnerLK("");
  };

  const onUndo = async () => {
    if (history.length === 0) return;
    const [latest, ...rest] = history;
    setHistory(rest);
    await saveHistory(rest);

    if (autoUpdate && latest?.lkBefore != null) setCurrentLK(latest.lkBefore);
  };

  const headerLK = useMemo(() => round3(toNumber(currentLK) ?? 0), [currentLK]);

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.title}>LK</Text>
        <Text style={styles.muted}>Lade…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={styles.title}>LK</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Aktuelle LK</Text>
          <TextInput
            value={fmt(currentLK)}
            onChangeText={(t) => {
              const n = toNumber(t);
              if (n == null) return;
              setCurrentLK(n);
            }}
            keyboardType="decimal-pad"
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

          <Text style={styles.label}>Gegner-LK</Text>
          <TextInput
            value={opponentLK}
            onChangeText={setOpponentLK}
            keyboardType="decimal-pad"
            style={styles.input}
            placeholder="z.B. 14,8"
            placeholderTextColor="#7f93b0"
          />

          {type === "double" && (
            <>
              <Text style={styles.label}>Partner-LK (optional, für korrekte Doppelrechnung)</Text>
              <TextInput
                value={partnerLK}
                onChangeText={setPartnerLK}
                keyboardType="decimal-pad"
                style={styles.input}
                placeholder="z.B. 18,5"
                placeholderTextColor="#7f93b0"
              />

              <Text style={styles.label}>Gegner Partner-LK (optional)</Text>
              <TextInput
                value={opponentPartnerLK}
                onChangeText={setOpponentPartnerLK}
                keyboardType="decimal-pad"
                style={styles.input}
                placeholder="z.B. 16,2"
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738", paddingTop: 40, paddingHorizontal: 14 },
  title: { color: "#fff", fontSize: 18, fontWeight: "900", marginBottom: 12 },

  card: {
    backgroundColor: "#022449",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
    marginBottom: 12,
  },
  cardTitle: { color: "#fff", fontSize: 14, fontWeight: "900", marginBottom: 10 },
  muted: { color: "#9fb0c8" },

  input: {
    borderWidth: 1,
    borderColor: "#355a8a",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    fontWeight: "800",
  },
  bigLK: { marginTop: 10, color: "#f28b25", fontSize: 28, fontWeight: "900", textAlign: "center" },

  row: { marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  rowLabel: { color: "#c3d0ea", fontSize: 12, fontWeight: "800", flex: 1 },

  note: { marginTop: 10, color: "#9fb0c8", fontSize: 12, lineHeight: 16 },

  label: { marginTop: 12, color: "#c3d0ea", fontSize: 12, fontWeight: "900", marginBottom: 6 },

  segRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  seg: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "rgba(8, 35, 80, 0.55)",
  },
  segActive: { backgroundColor: "#f28b25", borderColor: "#f28b25" },
  segText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  segTextActive: { color: "#001738" },

  primaryBtn: {
    marginTop: 12,
    backgroundColor: "#f28b25",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryText: { color: "#001738", fontWeight: "900" },

  secondaryBtn: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryText: { color: "#fff", fontWeight: "900" },

  historyRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" },
  hMain: { color: "#fff", fontWeight: "900", fontSize: 12 },
  hSub: { color: "#9fb0c8", marginTop: 4, fontSize: 12, fontWeight: "800" },
});
