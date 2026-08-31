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

  const breadcrumb = useMemo(() => {
    if (step === "CATEGORY") return "Mannschaften & Spielpläne";
    if (step === "SEASON") return "Herren · Saison auswählen";
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
    navigation.navigate("Booking");
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.headerRow}>
        {step !== "CATEGORY" ? (
          <TouchableOpacity onPress={goBackSmart} style={styles.headerIconBtn} activeOpacity={0.85}>
            <Ionicons name="chevron-back" size={20} color="#F28B25" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerIconSpacer} />
        )}

        <View style={styles.headerCenter}>
          <Text style={styles.title}>Teams</Text>
          <Text style={styles.breadcrumb}>{breadcrumb}</Text>
        </View>

        <View style={styles.headerIconSpacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {step === "CATEGORY" && (
          <>
            <Text style={styles.eyebrow}>ÜBERSICHT</Text>
            <Text style={styles.sectionHeading}>Welche Mannschaft suchst du?</Text>
            <Text style={styles.sectionIntro}>Spielpläne, Ergebnisse und Teamdetails an einem Ort.</Text>

            <CategoryCard
              icon="people-outline"
              title="Herren"
              subtitle="Sommer & Winter"
              hint="Saison auswählen"
              onPress={() => {
                setCategory("herren");
                setSeason(null);
              }}
            />

            <CategoryCard
              icon="git-compare-outline"
              title="Mixed"
              subtitle="Mixed I & Mixed II"
              hint="Team auswählen"
              onPress={() => {
                setCategory("mixed");
                setSeason(null);
              }}
            />
          </>
        )}

        {step === "SEASON" && (
          <>
            <Text style={styles.eyebrow}>HERREN</Text>
            <Text style={styles.sectionHeading}>Saison auswählen</Text>
            <Text style={styles.sectionIntro}>Wähle den Wettbewerb, den du ansehen möchtest.</Text>

            <View style={styles.seasonGrid}>
              <SeasonCard
                icon="sunny-outline"
                title="Sommer"
                subtitle="Freiluft-Saison"
                onPress={() => setSeason("sommer")}
              />
              <SeasonCard
                icon="snow-outline"
                title="Winter"
                subtitle="Hallen-Saison"
                onPress={() => setSeason("winter")}
              />
            </View>
          </>
        )}

        {step === "TEAMS" && (
          <>
            <Text style={styles.eyebrow}>MANNSCHAFTEN</Text>
            <Text style={styles.sectionHeading}>Team auswählen</Text>
            <Text style={styles.sectionIntro}>Tippe auf ein Team für Spielplan und Details.</Text>

            {category === "herren" && season === "sommer" && (
              <>
                <TeamCard title="Herren I" subtitle="Sommer" onPress={() => goTeam("herren_s1", "Herren I (Sommer)")} />
                <TeamCard title="Herren II" subtitle="Sommer" onPress={() => goTeam("herren_s2", "Herren II (Sommer)")} />
              </>
            )}

            {category === "herren" && season === "winter" && (
              <TeamCard title="Herren" subtitle="Winter" onPress={() => goTeam("herren_w1", "Herren (Winter)")} />
            )}

            {category === "mixed" && (
              <>
                <TeamCard title="Mixed I" subtitle="Liga & Spielplan" onPress={() => goTeam("mixed_1", "Mixed I")} />
                <TeamCard title="Mixed II" subtitle="Liga & Spielplan" onPress={() => goTeam("mixed_2", "Mixed II")} />
              </>
            )}
          </>
        )}
      </ScrollView>

      <BottomNav navigation={navigation} active="Teams" />
    </View>
  );
}

function CategoryCard({ icon, title, subtitle, hint, onPress }) {
  return (
    <TouchableOpacity style={styles.bigCard} onPress={onPress} activeOpacity={0.86}>
      <View style={styles.cardIcon}>
        <Ionicons name={icon} size={24} color="#F28B25" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.bigTitle}>{title}</Text>
        <Text style={styles.bigSub}>{subtitle}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <View style={styles.chevWrap}>
        <Ionicons name="chevron-forward" size={19} color="#F28B25" />
      </View>
    </TouchableOpacity>
  );
}

function SeasonCard({ icon, title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={styles.seasonCard} onPress={onPress} activeOpacity={0.86}>
      <View style={styles.seasonIcon}>
        <Ionicons name={icon} size={24} color="#F28B25" />
      </View>
      <Text style={styles.seasonTitle}>{title}</Text>
      <Text style={styles.seasonSub}>{subtitle}</Text>
      <Ionicons name="arrow-forward" size={18} color="#7187A4" style={{ marginTop: 13 }} />
    </TouchableOpacity>
  );
}

function TeamCard({ title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={styles.teamCard} onPress={onPress} activeOpacity={0.86}>
      <View style={styles.teamIcon}>
        <Ionicons name="shield-outline" size={21} color="#F28B25" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.teamTitle}>{title}</Text>
        <Text style={styles.teamSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={19} color="#7187A4" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#00152F", paddingTop: Platform.OS === "web" ? 26 : 44 },
  headerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 14 },
  headerIconBtn: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#082A52", borderWidth: 1, borderColor: "#173F69" },
  headerIconSpacer: { width: 40, height: 40 },
  headerCenter: { flex: 1, alignItems: "center" },
  title: { color: "#FFFFFF", fontSize: 19, fontWeight: "900" },
  breadcrumb: { color: "#7187A4", fontSize: 10.5, marginTop: 2, fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  eyebrow: { color: "#F28B25", fontSize: 9, fontWeight: "900", letterSpacing: 1.3, marginBottom: 5 },
  sectionHeading: { color: "#FFFFFF", fontSize: 22, fontWeight: "900", letterSpacing: -0.4 },
  sectionIntro: { color: "#8398B2", fontSize: 11.5, lineHeight: 17, marginTop: 5, marginBottom: 17 },
  bigCard: { minHeight: 112, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#062447", borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "#173F69", marginBottom: 11 },
  cardIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(242,139,37,0.10)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(242,139,37,0.23)" },
  bigTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  bigSub: { color: "#A6B6C8", marginTop: 3, fontSize: 11.5, fontWeight: "700" },
  hint: { color: "#637B98", fontSize: 9.5, marginTop: 7, fontWeight: "700" },
  chevWrap: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#082A52", alignItems: "center", justifyContent: "center" },
  seasonGrid: { flexDirection: "row", gap: 10 },
  seasonCard: { flex: 1, minHeight: 158, backgroundColor: "#062447", borderRadius: 20, padding: 15, borderWidth: 1, borderColor: "#173F69" },
  seasonIcon: { width: 45, height: 45, borderRadius: 15, backgroundColor: "rgba(242,139,37,0.10)", alignItems: "center", justifyContent: "center", marginBottom: 15 },
  seasonTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  seasonSub: { color: "#8398B2", fontSize: 10.5, lineHeight: 15, marginTop: 4 },
  teamCard: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#062447", borderRadius: 18, padding: 12, borderWidth: 1, borderColor: "#173F69", marginBottom: 10 },
  teamIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#082A52", alignItems: "center", justifyContent: "center" },
  teamTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  teamSub: { color: "#8398B2", marginTop: 3, fontSize: 10.5, fontWeight: "700" },
});
