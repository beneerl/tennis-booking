import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabaseClient";
import { getCurrentUserProfile, normalizeUserStatus } from "../authProfile";
import { Ionicons } from "@expo/vector-icons";
import BottomNav from "../components/BottomNav";

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [bookingCountYear, setBookingCountYear] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const { session, profile } = await getCurrentUserProfile();

        if (!session?.user?.id || !profile) {
          navigation.reset({ index: 0, routes: [{ name: "Login" }] });
          return;
        }

        const status = normalizeUserStatus(profile.status);
        const admin = !!profile.is_admin;
        if (status === "blocked" || (status !== "approved" && !admin)) {
          try {
            await supabase.auth.signOut();
          } catch {}
          try {
            await AsyncStorage.removeItem("user_login");
          } catch {}
          navigation.reset({ index: 0, routes: [{ name: "Login" }] });
          return;
        }

        if (!active) return;
        const u = {
          id: profile.id,
          auth_id: profile.auth_id,
          email: profile.email || session.user.email || "",
          name: profile.name || session.user.email || "Spieler",
          is_admin: admin,
        };
        setUser(u);

        // Legacy-PIN nur aus dem eigenen Profil laden.
        const { data: userRow, error: userErr } = await supabase
          .from("users")
          .select("pin")
          .eq("id", profile.id)
          .maybeSingle();

        if (userErr) {
          console.log("Supabase user pin error:", userErr.message);
        } else if (active) {
          setPin(userRow?.pin || "");
        }

        // Buchungen dieses Jahres laden
        const now = new Date();
        const year = now.getFullYear();
        const from = `${year}-01-01`;
        const to = `${year}-12-31`;

        const { data: bookings, error: bookErr } = await supabase
          .from("bookings123")
          .select("id, date_key, user_name")
          .eq("user_name", u.name)
          .gte("date_key", from)
          .lte("date_key", to);

        if (bookErr) {
          console.log("Supabase bookings count error:", bookErr.message);
        } else if (active) {
          setBookingCountYear((bookings || []).length);
        }
      } catch (e) {
        console.log("Profile load exception:", e?.message || e);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [navigation]);

const handleLogout = async () => {
  try {
    // 1) Erst local Auto-Login killen
    await AsyncStorage.removeItem("user_login");
  } catch (e) {
    console.log("Error clearing user_login:", e);
  }

  try {
    // 2) Dann Supabase Session wirklich beenden (wichtig für Web)
    await supabase.auth.signOut();
  } catch (e) {
    console.log("Error signing out:", e);
  }

  // 3) Navigation hart zurück auf Login
  navigation.reset({
    index: 0,
    routes: [{ name: "Login" }],
  });
};

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="#ffffff" />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.infoText}>Kein Benutzer geladen.</Text>
      </View>
    );
  }

  const year = new Date().getFullYear();
  const initials = String(user.name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x.charAt(0).toUpperCase())
    .join("");

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>MEIN KONTO</Text>
          <Text style={styles.title}>Profil</Text>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons name="person-outline" size={21} color="#F28B25" />
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || "?"}</Text>
          </View>
          <Text style={styles.nameText}>{user.name}</Text>
          <Text style={styles.emailText}>{user.email}</Text>
          <View style={styles.roleBadge}>
            <Ionicons name={user.is_admin ? "shield-checkmark-outline" : "checkmark-circle-outline"} size={14} color="#F28B25" />
            <Text style={styles.roleText}>{user.is_admin ? "Administrator" : "Vereinsmitglied"}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={styles.statIcon}>
              <Ionicons name="calendar-outline" size={19} color="#F28B25" />
            </View>
            <Text style={styles.statValue}>{bookingCountYear === null ? "—" : bookingCountYear}</Text>
            <Text style={styles.statLabel}>Buchungen {year}</Text>
          </View>

          <View style={styles.statCard}>
            <View style={styles.statIcon}>
              <Ionicons name="key-outline" size={19} color="#F28B25" />
            </View>
            <Text style={styles.statValue}>{showPin ? pin || "—" : pin ? "••••" : "—"}</Text>
            <TouchableOpacity onPress={() => setShowPin((prev) => !prev)} activeOpacity={0.8}>
              <Text style={styles.pinToggle}>{showPin ? "verbergen" : "PIN anzeigen"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.accountCard}>
          <View style={styles.accountRow}>
            <View style={styles.accountIconWrap}>
              <Ionicons name="mail-outline" size={18} color="#9FB0C8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountLabel}>E-Mail</Text>
              <Text style={styles.accountValue} numberOfLines={1}>{user.email || "—"}</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.88}>
          <Ionicons name="log-out-outline" size={19} color="#F28B25" />
          <Text style={styles.logoutText}>Abmelden</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }} />
      <BottomNav navigation={navigation} active="Profile" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#00152F", paddingTop: 40 },
  headerRow: { paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  eyebrow: { color: "#F28B25", fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginBottom: 3 },
  title: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  headerIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: "#082A52", borderWidth: 1, borderColor: "#173F69", alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16 },
  profileCard: { alignItems: "center", backgroundColor: "#062447", borderRadius: 22, borderWidth: 1, borderColor: "#173F69", paddingVertical: 22, paddingHorizontal: 16 },
  avatar: { width: 72, height: 72, borderRadius: 24, backgroundColor: "#F28B25", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  avatarText: { color: "#001738", fontSize: 24, fontWeight: "900" },
  nameText: { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  emailText: { color: "#8195AF", fontSize: 11, marginTop: 3 },
  roleBadge: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 999, backgroundColor: "rgba(242,139,37,0.10)" },
  roleText: { color: "#F6A04B", fontSize: 10, fontWeight: "900" },
  statsRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  statCard: { flex: 1, minHeight: 120, backgroundColor: "#062447", borderRadius: 18, borderWidth: 1, borderColor: "#173F69", padding: 13 },
  statIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: "rgba(242,139,37,0.10)", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  statValue: { color: "#FFFFFF", fontSize: 22, fontWeight: "900", letterSpacing: -0.4 },
  statLabel: { color: "#8195AF", fontSize: 9.5, marginTop: 4, fontWeight: "700" },
  pinToggle: { color: "#8195AF", fontSize: 9.5, marginTop: 4, fontWeight: "700" },
  accountCard: { marginTop: 10, backgroundColor: "#062447", borderRadius: 18, borderWidth: 1, borderColor: "#173F69", padding: 12 },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  accountIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#082A52", alignItems: "center", justifyContent: "center" },
  accountLabel: { color: "#6F86A8", fontSize: 9, fontWeight: "800" },
  accountValue: { color: "#DCE6F1", fontSize: 12, fontWeight: "800", marginTop: 2 },
  logoutBtn: { marginTop: 14, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: "rgba(242,139,37,0.35)", backgroundColor: "rgba(242,139,37,0.07)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  logoutText: { color: "#F28B25", fontSize: 13, fontWeight: "900" },
  infoText: { color: "#FFFFFF", fontSize: 14 },
});
