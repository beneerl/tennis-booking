import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
} from "react-native";

export default function TeamsScreen({ navigation }) {
  const [category, setCategory] = useState(null); // "herren" | "mixed" | null
  const [season, setSeason] = useState(null); // "sommer" | "winter" | null

  const step = useMemo(() => {
    if (!category) return "CATEGORY";
    if (category === "herren" && !season) return "SEASON";
    return "TEAMS";
  }, [category, season]);

  const breadcrumb = useMemo(() => {
    if (step === "CATEGORY") return "Auswahl";
    if (step === "SEASON") return "Herren · Saison";
    if (category === "herren") return `Herren · ${season === "sommer" ? "Sommer" : "Winter"}`;
    return "Mixed";
  }, [step, category, season]);

  const goTeam = (teamId, teamTitle) => {
    navigation.navigate("TeamDetails", { teamId, teamTitle });
  };

  const goBackSmart = () => {
    if (step === "TEAMS") {
      if (category === "herren") setSeason(null);
      else setCategory(null);
      return;
    }
    if (step === "SEASON") {
      setCategory(null);
      setSeason(null);
      return;
    }
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={goBackSmart} style={styles.backBtn}>
          <Text style={styles.backText}>{"< Zurück"}</Text>
        </TouchableOpacity>

        <View style={{ alignItems: "center" }}>
          <Text style={styles.title}>Mannschaften</Text>
          <Text style={styles.breadcrumb}>{breadcrumb}</Text>
        </View>

        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {/* STEP 1: CATEGORY */}
        {step === "CATEGORY" && (
          <>
            

            <TouchableOpacity
              style={styles.bigCard}
              onPress={() => {
                setCategory("herren");
                setSeason(null);
              }}
              activeOpacity={0.9}
            >
              <View style={styles.bigCardTop}>
                <Text style={styles.bigEmoji}>🎾</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bigTitle}>Herren</Text>
                  <Text style={styles.bigSub}>Sommer & Winter</Text>
                </View>
                <Text style={styles.chev}>›</Text>
              </View>

              <View style={styles.bigCardBottom}>
                <Text style={styles.hint}>Tippe für Saison-Auswahl</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.bigCard}
              onPress={() => {
                setCategory("mixed");
                setSeason(null);
              }}
              activeOpacity={0.9}
            >
              <View style={styles.bigCardTop}>
                <Text style={styles.bigEmoji}>🤝</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bigTitle}>Mixed</Text>
                  <Text style={styles.bigSub}>Mixed I & Mixed II</Text>
                </View>
                <Text style={styles.chev}>›</Text>
              </View>

              <View style={styles.bigCardBottom}>
                <Text style={styles.hint}>Tippe für Team-Auswahl</Text>
              </View>
            </TouchableOpacity>
          </>
        )}

        {/* STEP 2: SEASON */}
        {step === "SEASON" && (
          <>
            <Text style={styles.sectionTitle}>Wähle die Saison</Text>

            <View style={styles.chipsRow}>
              <Chip
                label="Sommer"
                active={season === "sommer"}
                onPress={() => setSeason("sommer")}
              />
              <Chip
                label="Winter"
                active={season === "winter"}
                onPress={() => setSeason("winter")}
              />
            </View>


          </>
        )}

        {/* STEP 3: TEAMS */}
        {step === "TEAMS" && (
          <>
            <Text style={styles.sectionTitle}>Teams</Text>

            {/* Herren Sommer */}
            {category === "herren" && season === "sommer" && (
              <>
                <TeamCard
                  title="Herren I"
                  subtitle="Sommer"
                  onPress={() => goTeam("herren_s1", "Herren I (Sommer)")}
                />
                <TeamCard
                  title="Herren II"
                  subtitle="Sommer"
                  onPress={() => goTeam("herren_s2", "Herren II (Sommer)")}
                />
              </>
            )}

            {/* Herren Winter */}
            {category === "herren" && season === "winter" && (
              <TeamCard
                title="Herren"
                subtitle="Winter"
                onPress={() => goTeam("herren_w1", "Herren (Winter)")}
              />
            )}

            {/* Mixed */}
            {category === "mixed" && (
              <>
                <TeamCard
                  title="Mixed I"
                  subtitle="Liga/Spielplan"
                  onPress={() => goTeam("mixed_1", "Mixed I")}
                />
                <TeamCard
                  title="Mixed II"
                  subtitle="Liga/Spielplan"
                  onPress={() => goTeam("mixed_2", "Mixed II")}
                />
              </>
            )}


          </>
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      activeOpacity={0.9}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function TeamCard({ title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={styles.teamCard} onPress={onPress} activeOpacity={0.9}>
      <View style={{ flex: 1 }}>
        <Text style={styles.teamTitle}>{title}</Text>
        <Text style={styles.teamSub}>{subtitle}</Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738", paddingTop: 40, paddingHorizontal: 16 },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  backBtn: { paddingVertical: 8, paddingRight: 12 },
  backText: { color: "#f28b25", fontSize: 14, fontWeight: "700" },
  title: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
  breadcrumb: { color: "#9fb0c8", fontSize: 12, marginTop: 2 },

  sectionTitle: { color: "#ffffff", fontSize: 14, fontWeight: "800", marginTop: 8, marginBottom: 10 },

  bigCard: {
    backgroundColor: "#022449",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
    marginBottom: 12,
  },
  bigCardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  bigEmoji: { fontSize: 22 },
  bigTitle: { color: "#ffffff", fontSize: 18, fontWeight: "900" },
  bigSub: { color: "#c3d0ea", marginTop: 2, fontSize: 12 },
  bigCardBottom: { marginTop: 10 },
  hint: { color: "#9fb0c8", fontSize: 12 },

  chipsRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
chip: {
  flex: 1,
  backgroundColor: "rgba(8, 35, 80, 0.55)",
  borderRadius: 18,
  borderWidth: 1,
  borderColor: "#355a8a",
  paddingVertical: 18,     // vorher 10
  alignItems: "center",
  justifyContent: "center",
  minHeight: 120,          // neu: macht die Fläche groß
},

  chipActive: { backgroundColor: "#f28b25", borderColor: "#f28b25" },
  chipText: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
  chipTextActive: { color: "#001738" },

  card: {
    backgroundColor: "#022449",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
  },
  cardTitle: { color: "#ffffff", fontSize: 14, fontWeight: "800", marginBottom: 6 },
  cardSub: { color: "#c3d0ea", fontSize: 12, lineHeight: 18 },

  teamCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#022449",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#355a8a",
    marginBottom: 10,
  },
  teamTitle: { color: "#ffffff", fontSize: 16, fontWeight: "900" },
  teamSub: { color: "#c3d0ea", marginTop: 4, fontSize: 12 },

  chev: { color: "#f28b25", fontSize: 22, fontWeight: "900" },

  linkBtn: { paddingVertical: 12 },
  linkText: { color: "#f28b25", fontSize: 13, fontWeight: "700" },
});
