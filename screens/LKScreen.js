// screens/LKScreen.js
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Switch } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_PROFILE = "lk_profile_v1";
const STORAGE_HISTORY = "lk_history_v1";

// Helpers
const toNumber = (v) => {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const round3 = (n) => Math.round(n * 1000) / 1000;
const clampLK = (n) => Math.max(1, Math.min(25, n)); // grob – kann man später präzisieren
const uid = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

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

  // Verlauf
  const [history, setHistory] = useState([]);

  // ---- Placeholder-Berechnung (wird ersetzt, sobald wir die BTV-Tabellen sauber drin haben) ----
  // Aktuell: nur simple "Schätzdifferenz" damit UI/Flow schon funktioniert.
  const computeDeltaPlaceholder = (own, opp, matchType) => {
    // Wenn Gegner besser (kleinere LK-Zahl) -> weniger Gewinn, wenn Gegner schlechter -> mehr Gewinn
    const diff = (opp - own); // positiv = Gegner schlechter
    let base = 0.12 + Math.max(-0.08, Math.min(0.18, diff * 0.02));
    if (matchType === "double") base *= 0.5; // Doppel grob halb
    // optional Motivation (rein als UI-Demo; später korrekt)
    if (useMotivation) base += 0.025;
    // Punktspiel-Bonus +10% (bei euch immer Punktspiel)
    base *= 1.1;
    return Math.max(0, base);
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

    const before = own;

    let delta = 0;
    let after = before;

    if (result === "W") {
      delta = computeDeltaPlaceholder(before, opp, type);
      // LK wird besser => Zahl wird kleiner
      after = clampLK(round3(before - delta));
    } else {
      // Verlierer bleibt (offiziell) unverändert -> delta = 0
      delta = 0;
      after = before;
    }

    const entry = {
      id: uid(),
      date: new Date().toISOString(),
      type,
      opponentLK: opp,
      result,
      delta: round3(delta),
      lkBefore: round3(before),
      lkAfter: round3(after),
    };

    const nextHistory = [entry, ...history];
    setHistory(nextHistory);
    await saveHistory(nextHistory);

    if (autoUpdate) setCurrentLK(after);
    setOpponentLK("");
  };

  const onUndo = async () => {
    if (history.length === 0) return;
    const [latest, ...rest] = history;
    setHistory(rest);
    await saveHistory(rest);

    // Wenn AutoUpdate: LK zurücksetzen auf "lkBefore" des letzten Eintrags
    if (autoUpdate && latest?.lkBefore) setCurrentLK(latest.lkBefore);
  };

  const headerLK = useMemo(() => round3(toNumber(currentLK) ?? 0), [currentLK]);

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>LK</Text>
        <Text style={styles.muted}>Lade…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={styles.title}>LK</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Aktuelle LK</Text>
          <TextInput
            value={String(currentLK).replace(".", ",")}
            onChangeText={(t) => setCurrentLK(toNumber(t) ?? currentLK)}
            keyboardType="decimal-pad"
            style={styles.input}
            placeholder="z.B. 16,3"
            placeholderTextColor="#7f93b0"
          />
          <Text style={styles.bigLK}>{String(headerLK).replace(".", ",")}</Text>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>LK nach Eintrag aktualisieren</Text>
            <Switch value={autoUpdate} onValueChange={setAutoUpdate} />
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Motivationsaufschlag berücksichtigen</Text>
            <Switch value={useMotivation} onValueChange={setUseMotivation} />
          </View>

          <Text style={styles.note}>
            Hinweis: Berechnung ist aktuell noch ein Platzhalter – als nächstes ersetzen wir das durch die offiziellen BTV-Tabellen (P/H/A/Z).
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
              <Text style={[styles.segText, type === "single" && styles.segTextActive]}>Einzel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.seg, type === "double" && styles.segActive]}
              onPress={() => setType("double")}
              activeOpacity={0.9}
            >
              <Text style={[styles.segText, type === "double" && styles.segTextActive]}>Doppel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.segRow}>
            <TouchableOpacity
              style={[styles.seg, result === "W" && styles.segActive]}
              onPress={() => setResult("W")}
              activeOpacity={0.9}
            >
              <Text style={[styles.segText, result === "W" && styles.segTextActive]}>Sieg</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.seg, result === "L" && styles.segActive]}
              onPress={() => setResult("L")}
              activeOpacity={0.9}
            >
              <Text style={[styles.segText, result === "L" && styles.segTextActive]}>Niederlage</Text>
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
                  {h.result === "W" ? "✅ Sieg" : "❌ Niederlage"} · {h.type === "single" ? "Einzel" : "Doppel"} · Gegner {String(h.opponentLK).replace(".", ",")}
                </Text>
                <Text style={styles.hSub}>
                  LK {String(h.lkBefore).replace(".", ",")} → {String(h.lkAfter).replace(".", ",")} · Δ {String(h.delta).replace(".", ",")}
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
