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

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [bookingCountYear, setBookingCountYear] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const json = await AsyncStorage.getItem("user_login");
        if (!json) {
          navigation.replace("Login");
          return;
        }
        const u = JSON.parse(json);
        setUser(u);

        // PIN laden
        const { data: userRow, error: userErr } = await supabase
          .from("users")
          .select("pin")
          .eq("id", u.id)
          .single();

        if (userErr) {
          console.log("Supabase user pin error:", userErr.message);
        } else {
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
        } else {
          setBookingCountYear(bookings.length);
        }
      } catch (e) {
        console.log("Profile load exception:", e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem("user_login");
    } catch (e) {
      console.log("Error clearing user:", e);
    }
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.backText}>{"< Zurück"}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Benutzerprofil</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.card}>
        <Text style={styles.nameText}>{user.name}</Text>
        <Text style={styles.roleText}>
          {user.is_admin ? "Administrator" : "Vereinsmitglied"}
        </Text>

        {/* PIN-Bereich */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PIN</Text>
          <View style={styles.row}>
            <Text style={styles.pinText}>
              {showPin ? pin || "—" : pin ? "••••" : "—"}
            </Text>
            <TouchableOpacity
              style={styles.smallBtn}
              onPress={() => setShowPin((prev) => !prev)}
            >
              <Text style={styles.smallBtnText}>
                {showPin ? "verstecken" : "anzeigen"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Statistik */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Statistik</Text>
          <Text style={styles.statText}>
            Buchungen {year}:{" "}
            {bookingCountYear === null ? "—" : bookingCountYear}
          </Text>
        </View>

        {/* Logout */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#001738",
    paddingTop: 40,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  backBtn: {
    paddingVertical: 8,
    paddingRight: 12,
  },
  backText: {
    color: "#f28b25",
    fontSize: 14,
  },
  title: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  card: {
    backgroundColor: "#022449",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#355a8a",
  },
  nameText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },
  roleText: {
    color: "#c3d0ea",
    fontSize: 13,
    marginBottom: 16,
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    color: "#d6e0f0",
    fontSize: 14,
    marginBottom: 4,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pinText: {
    color: "#ffffff",
    fontSize: 18,
    letterSpacing: 2,
  },
  smallBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f28b25",
  },
  smallBtnText: {
    color: "#f28b25",
    fontSize: 12,
    fontWeight: "600",
  },
  statText: {
    color: "#ffffff",
    fontSize: 14,
  },
  logoutBtn: {
    marginTop: 8,
    backgroundColor: "#f28b25",
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
  },
  logoutText: {
    color: "#001738",
    fontSize: 16,
    fontWeight: "700",
  },
  infoText: {
    color: "#ffffff",
    fontSize: 14,
  },
});
