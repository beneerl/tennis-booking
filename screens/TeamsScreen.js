import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import BottomNav from "../components/BottomNav";

export default function TeamsScreen({ navigation }) {
  const [category, setCategory] = useState(null); // "herren" | "mixed" | null
  const [season, setSeason] = useState(null); // "sommer" | "winter" | null

  const step = useMemo(() => {
    if (!category) return "CATEGORY";
    if (category === "herren" && !season) return "SEASON";
    return "TEAMS";
  }, [category, season]);

  const headerTitle = useMemo(() => {
    if (step === "CATEGORY") return "Teams";
    if (step === "SEASON") return "Herren";
    if (category === "herren") return season === "sommer" ? "Herren · Sommer" : "Herren · Winter";
    return "Mixed";
  }, [step, category, season]);

  const headerSub = useMemo(() => {
    if (step === "CATEGORY") return "Mannschaften & Spielpläne";
    if (step === "SEASON") return "Saison auswählen";
    return "Team auswählen";
  }, [step]);

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
    navigation.navigate("Booking");
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        {step !== "CATEGORY" ? (
          <TouchableOpacity onPress={goBackSmart} style={styles.backBtn} activeOpacity={0.85}>
            <Ionicons name="chevron-back" size={20} color="#F28B25" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerIconBox}>
            <Ionicons name="people-outline" size={20} color="#F28B25" />
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={styles.headerKicker}>TENNIS TACHERTING</Text>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          <Text style={styles.headerSub}>{headerSub}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {step === "CATEGORY" && (
          <>
            <Text style={styles.sectionLabel}>MANNSCHAFTEN</Text>
            <Text style={styles.sectionTitle}>Dein Team im Blick</Text>
            <Text style={styles.sectionText}>Spielpläne, Ergebnisse und Tabellen übersichtlich an einem Ort.</Text>

            <CategoryCard
              icon="people-outline"
              title="Herren"
              subtitle="Sommer & Winter"
              meta="Saison auswählen"
              accent="#F28B25"
              onPress={() => {
                setCategory("herren");
                setSeason(null);
              }}
            />

            <CategoryCard
              icon="git-compare-outline"
              title="Mixed"
              subtitle="Mixed I & Mixed II"
              meta="Teams anzeigen"
              accent="#61D6B1"
              onPress={() => {
                setCategory("mixed");
                setSeason(null);
              }}
            />
          </>
        )}

        {step === "SEASON" && (
          <>
            <Text style={styles.sectionLabel}>HERREN</Text>
            <Text style={styles.sectionTitle}>Saison auswählen</Text>
            <Text style={styles.sectionText}>Sommer draußen oder Winter in der Halle.</Text>

            <View style={styles.seasonGrid}>
              <SeasonCard
                icon="sunny-outline"
                title="Sommer"
                subtitle="Freiluft"
                accent="#F28B25"
                onPress={() => setSeason("sommer")}
              />
              <SeasonCard
                icon="snow-outline"
                title="Winter"
                subtitle="Halle"
                accent="#86B9FF"
                onPress={() => setSeason("winter")}
              />
            </View>
          </>
        )}

        {step === "TEAMS" && (
          <>
            <Text style={styles.sectionLabel}>AUSWAHL</Text>
            <Text style={styles.sectionTitle}>Mannschaft öffnen</Text>
            <Text style={styles.sectionText}>Spielplan, Tabelle und Liga-Übersicht öffnen.</Text>

            {category === "herren" && season === "sommer" && (
              <>
                <TeamCard
                  title="Herren I"
                  subtitle="Sommer"
                  icon="shield-outline"
                  onPress={() => goTeam("herren_s1", "Herren I (Sommer)")}
                />
                <TeamCard
                  title="Herren II"
                  subtitle="Sommer"
                  icon="shield-half-outline"
                  onPress={() => goTeam("herren_s2", "Herren II (Sommer)")}
                />
              </>
            )}

            {category === "herren" && season === "winter" && (
              <TeamCard
                title="Herren"
                subtitle="Winter"
                icon="snow-outline"
                onPress={() => goTeam("herren_w1", "Herren (Winter)")}
              />
            )}

            {category === "mixed" && (
              <>
                <TeamCard
                  title="Mixed I"
                  subtitle="Liga & Spielplan"
                  icon="git-compare-outline"
                  onPress={() => goTeam("mixed_1", "Mixed I")}
                />
                <TeamCard
                  title="Mixed II"
                  subtitle="Liga & Spielplan"
                  icon="git-compare-outline"
                  onPress={() => goTeam("mixed_2", "Mixed II")}
                />
              </>
            )}
          </>
        )}
      </ScrollView>

      <BottomNav navigation={navigation} active="Teams" />
    </View>
  );
}

function CategoryCard({ icon, title, subtitle, meta, accent, onPress }) {
  return (
    <TouchableOpacity style={styles.categoryCard} onPress={onPress} activeOpacity={0.86}>
      <View style={[styles.accentBar, { backgroundColor: accent }]} />
      <View style={[styles.categoryIcon, { borderColor: `${accent}44`, backgroundColor: `${accent}12` }]}>
        <Ionicons name={icon} size={24} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.categoryTitle}>{title}</Text>
        <Text style={styles.categorySub}>{subtitle}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>{meta}</Text>
          <Ionicons name="arrow-forward" size={12} color="#627C9A" />
        </View>
      </View>
      <View style={styles.chevronBox}>
        <Ionicons name="chevron-forward" size={18} color="#F28B25" />
      </View>
    </TouchableOpacity>
  );
}

function SeasonCard({ icon, title, subtitle, accent, onPress }) {
  return (
    <TouchableOpacity style={styles.seasonCard} onPress={onPress} activeOpacity={0.86}>
      <View style={[styles.seasonIcon, { backgroundColor: `${accent}12`, borderColor: `${accent}38` }]}>
        <Ionicons name={icon} size={23} color={accent} />
      </View>
      <Text style={styles.seasonTitle}>{title}</Text>
      <Text style={styles.seasonSub}>{subtitle}</Text>
      <View style={styles.openRow}>
        <Text style={styles.openText}>Öffnen</Text>
        <Ionicons name="arrow-forward" size={13} color="#7187A4" />
      </View>
    </TouchableOpacity>
  );
}

function TeamCard({ title, subtitle, icon, onPress }) {
  return (
    <TouchableOpacity style={styles.teamCard} onPress={onPress} activeOpacity={0.86}>
      <View style={styles.teamIcon}>
        <Ionicons name={icon} size={20} color="#F28B25" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.teamTitle}>{title}</Text>
        <Text style={styles.teamSub}>{subtitle}</Text>
      </View>
      <View style={styles.chevronBoxSmall}>
        <Ionicons name="chevron-forward" size={17} color="#8198B4" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#001738", paddingTop: Platform.OS === "web" ? 26 : 44 },
  header: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 15, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#123356" },
  headerIconBox: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#08264A", borderWidth: 1, borderColor: "#173F66", alignItems: "center", justifyContent: "center" },
  backBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#08264A", borderWidth: 1, borderColor: "#173F66", alignItems: "center", justifyContent: "center" },
  headerKicker: { color: "#7187A4", fontSize: 8.5, fontWeight: "900", letterSpacing: 0.8 },
  headerTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginTop: 1 },
  headerSub: { color: "#637D9A", fontSize: 9, fontWeight: "700", marginTop: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 15, paddingTop: 17, paddingBottom: 26 },
  sectionLabel: { color: "#7187A4", fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  sectionTitle: { color: "#FFFFFF", fontSize: 22, fontWeight: "900", letterSpacing: -0.5, marginTop: 3 },
  sectionText: { color: "#7188A4", fontSize: 10, lineHeight: 15, marginTop: 4, marginBottom: 15, maxWidth: 390 },
  categoryCard: { minHeight: 110, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#051E3B", borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "#173F66", marginBottom: 10, overflow: "hidden" },
  accentBar: { position: "absolute", left: 0, top: 17, bottom: 17, width: 3, borderRadius: 99 },
  categoryIcon: { width: 50, height: 50, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  categoryTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  categorySub: { color: "#9BAFC5", marginTop: 3, fontSize: 10.5, fontWeight: "700" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  metaText: { color: "#637D9A", fontSize: 8.7, fontWeight: "800" },
  chevronBox: { width: 35, height: 35, borderRadius: 11, backgroundColor: "#08264A", borderWidth: 1, borderColor: "#173A5D", alignItems: "center", justifyContent: "center" },
  seasonGrid: { flexDirection: "row", gap: 10 },
  seasonCard: { flex: 1, minHeight: 154, backgroundColor: "#051E3B", borderRadius: 19, borderWidth: 1, borderColor: "#173F66", padding: 14 },
  seasonIcon: { width: 45, height: 45, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  seasonTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  seasonSub: { color: "#7890AC", fontSize: 9.5, marginTop: 3, fontWeight: "700" },
  openRow: { marginTop: "auto", flexDirection: "row", alignItems: "center", gap: 5 },
  openText: { color: "#7187A4", fontSize: 8.8, fontWeight: "800" },
  teamCard: { minHeight: 75, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#051E3B", borderRadius: 17, borderWidth: 1, borderColor: "#173F66", padding: 11, marginBottom: 9 },
  teamIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: "#302719", borderWidth: 1, borderColor: "#654725", alignItems: "center", justifyContent: "center" },
  teamTitle: { color: "#E7EFF7", fontSize: 14.5, fontWeight: "900" },
  teamSub: { color: "#7188A4", fontSize: 9.3, marginTop: 2, fontWeight: "700" },
  chevronBoxSmall: { width: 31, height: 31, borderRadius: 10, backgroundColor: "#071D38", alignItems: "center", justifyContent: "center" },
});
