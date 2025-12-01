// screens/LoginScreen.js
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Platform,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../supabaseClient";

// Alerts, die auf Web UND Handy funktionieren
function showMessage(title, message) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  // 🔁 Auto-Login: wenn user_login in AsyncStorage liegt, direkt weiter
  useEffect(() => {
    const loadStoredUser = async () => {
      try {
        const json = await AsyncStorage.getItem("user_login");
        if (!json) return;

        const stored = JSON.parse(json);

        navigation.replace("Booking", {
          userName: stored.name,
          isAdmin: stored.is_admin,
        });
      } catch (e) {
        console.log("Error reading stored user:", e);
      }
    };

    loadStoredUser();
  }, [navigation]);

  // 🧹 Immer wenn der Login-Screen wieder im Fokus ist: Felder leeren
  useFocusEffect(
    React.useCallback(() => {
      setEmail("");
      setName("");
      setPin("");
      setLoading(false);
    }, [])
  );

  const handleLogin = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const trimmedPin = pin.trim();

    if (!trimmedEmail || !trimmedName || !trimmedPin) {
      showMessage("Fehlende Angaben", "Bitte E-Mail, Name und PIN eingeben.");
      return;
    }

    setLoading(true);

    try {
      // 1) Gibt es schon einen User mit dieser E-Mail?
      const { data: existingUsers, error: existingError } = await supabase
        .from("users")
        .select("*")
        .eq("email", trimmedEmail)
        .order("created_at", { ascending: false }); // neuester Eintrag zuerst

      if (existingError) {
        console.log("existingError:", existingError.message);
        showMessage("Fehler", "Benutzerabfrage fehlgeschlagen.");
        setLoading(false);
        return;
      }

      const existingUser =
        existingUsers && existingUsers.length > 0 ? existingUsers[0] : null;

      // --------------------------------------------------------
      // FALL A: User existiert -> NUR EINLOGGEN
      // --------------------------------------------------------
      if (existingUser) {
        const { data: signInData, error: signInError } =
          await supabase.auth.signInWithPassword({
            email: trimmedEmail,
            password: trimmedPin,
          });

        if (signInError) {
          console.log("signInError:", signInError.message);
          const msg = (signInError.message || "").toLowerCase();

          if (msg.includes("invalid login credentials")) {
            showMessage(
              "Login fehlgeschlagen",
              "PIN oder E-Mail ist falsch."
            );
          } else {
            showMessage("Login fehlgeschlagen", signInError.message);
          }

          setLoading(false);
          return;
        }

        // Status & Admin robust normalisieren
        const rawStatus = existingUser.status;
        const status =
          rawStatus === null || rawStatus === undefined
            ? ""
            : String(rawStatus).trim().toLowerCase();
        const isAdmin = !!existingUser.is_admin;

        console.log("LOGIN STATUS CHECK:", {
          email: trimmedEmail,
          rawStatus,
          status,
          isAdmin,
        });

        if (status === "blocked") {
          showMessage(
            "Gesperrt",
            "Dein Zugang wurde vom Admin gesperrt. Bitte wende dich an den Verein."
          );
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }

        if (status !== "approved" && !isAdmin) {
          showMessage(
            "Noch nicht freigeschaltet",
            "Dein Konto wurde noch nicht vom Admin freigegeben."
          );
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }

        // ✅ Erfolgreich eingeloggt → lokal merken für Auto-Login
        await AsyncStorage.setItem(
          "user_login",
          JSON.stringify({
            email: trimmedEmail,
            name: existingUser.name,
            is_admin: isAdmin,
          })
        );

        showMessage(
          "Login erfolgreich",
          "Willkommen, " + existingUser.name + "!"
        );
        navigation.replace("Booking", {
          userName: existingUser.name,
          isAdmin: isAdmin,
        });
        setLoading(false);
        return;
      }

      // --------------------------------------------------------
      // FALL B: User existiert noch nicht -> REGISTRIEREN
      // --------------------------------------------------------
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({
          email: trimmedEmail,
          password: trimmedPin,
        });

      if (signUpError) {
        console.log("signUpError:", signUpError.message);
        showMessage("Registrierung fehlgeschlagen", signUpError.message);
        setLoading(false);
        return;
      }

      if (!signUpData || !signUpData.user) {
        showMessage(
          "Registrierung fehlgeschlagen",
          "Keine Nutzerdaten von Supabase erhalten."
        );
        setLoading(false);
        return;
      }

      const authUser = signUpData.user;

      const { error: insertError } = await supabase.from("users").insert({
        auth_id: authUser.id,
        email: trimmedEmail,
        name: trimmedName,
        status: "pending",
        is_admin: false,
      });

      if (insertError) {
        console.log("insertError:", insertError.message);
        showMessage(
          "Fehler",
          "User registriert, aber Profil konnte nicht gespeichert werden: " +
            insertError.message
        );
        setLoading(false);
        return;
      }

      showMessage(
        "Registriert",
        "Dein Konto wurde angelegt und muss vom Admin freigeschaltet werden."
      );
      setLoading(false);
    } catch (err) {
      console.log("handleLogin exception:", err);
      showMessage("Fehler", err.message || String(err));
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>Tennis-Platzreservierung</Text>
      <Text style={styles.subtitle}>Tacherting</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Anmeldung</Text>

        <Text style={styles.label}>E-Mail</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="z.B. bene@example.com"
          placeholderTextColor="#9fb0c8"
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="z.B. Benedikt Erl"
          placeholderTextColor="#9fb0c8"
        />

        <Text style={styles.label}>Passwort</Text>
        <TextInput
          style={styles.input}
          value={pin}
          onChangeText={setPin}
          placeholder="min. 6 Zeichen"
          placeholderTextColor="#9fb0c8"
          secureTextEntry
        />

        <TouchableOpacity
          style={styles.loginButton}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.loginButtonText}>Weiter</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.infoText}>
          Neue Spieler werden registriert und anschließend vom Admin
          freigeschaltet. Login erfolgt mit E-Mail + PIN.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#001738",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  title: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    color: "#c3d0ea",
    fontSize: 14,
    marginBottom: 16,
  },
  card: {
    width: "100%",
    backgroundColor: "#022449",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#355a8a",
  },
  cardTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
    textAlign: "center",
  },
  label: {
    color: "#d6e0f0",
    fontSize: 13,
    marginTop: 6,
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#001738",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#ffffff",
    borderWidth: 1,
    borderColor: "#355a8a",
    fontSize: 14,
  },
  loginButton: {
    marginTop: 16,
    backgroundColor: "#f28b25",
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: "center",
  },
  loginButtonText: {
    color: "#001738",
    fontSize: 16,
    fontWeight: "700",
  },
  infoText: {
    color: "#9fb0c8",
    fontSize: 11,
    marginTop: 10,
    textAlign: "center",
  },
});
