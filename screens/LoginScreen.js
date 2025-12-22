import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  StatusBar,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../supabaseClient";

export default function LoginScreen({ navigation }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  // Auto-Login, wenn schon gespeichert
  useEffect(() => {
    const loadStoredUser = async () => {
      try {
        const json = await AsyncStorage.getItem("user_login");
        if (json) {
          const user = JSON.parse(json);
          navigation.replace("Booking", {
            userName: user.name,
            isAdmin: user.is_admin,
          });
        }
      } catch (e) {
        console.log("Error reading stored user:", e);
      }
    };
    loadStoredUser();
  }, []);

  const handleLogin = async () => {
    const trimmedName = name.trim();
    const trimmedPin = pin.trim();

    if (!trimmedName || !trimmedPin) {
      Alert.alert("Fehlende Angaben", "Bitte Name und PIN eingeben.");
      return;
    }

    setLoading(true);

    try {
      // 1. Prüfen, ob es den Namen schon gibt (Name eindeutig)
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("name", trimmedName);

      if (error) {
        console.log("Supabase users error:", error.message);
      }

      const existingUser = data && data.length > 0 ? data[0] : null;

      // A) User existiert → Login
      if (existingUser) {
        if (existingUser.pin !== trimmedPin) {
          Alert.alert(
            "PIN falsch",
            "Der Name ist bereits registriert, aber die PIN ist falsch."
          );
          setLoading(false);
          return;
        }

        if (existingUser.status === "blocked") {
          Alert.alert(
            "Gesperrt",
            "Dein Zugang wurde vom Admin gesperrt. Bitte wende dich an den Verein."
          );
          setLoading(false);
          return;
        }

        if (existingUser.status !== "approved" && !existingUser.is_admin) {
          Alert.alert(
            "Noch nicht freigeschaltet",
            "Dein Konto wurde noch nicht vom Admin freigegeben."
          );
          setLoading(false);
          return;
        }

        await AsyncStorage.setItem(
          "user_login",
          JSON.stringify({
            id: existingUser.id,
            name: existingUser.name,
            is_admin: existingUser.is_admin,
          })
        );

        navigation.replace("Booking", {
          userName: existingUser.name,
          isAdmin: existingUser.is_admin,
        });
        setLoading(false);
        return;
      }

      // B) User existiert noch nicht → Registrierung (immer normaler User)
      const { data: inserted, error: insertError } = await supabase
        .from("users")
        .insert({
          name: trimmedName,
          pin: trimmedPin,
          is_admin: false,        // <--- NEU: niemals automatisch Admin
          status: "pending",      // muss von dir freigegeben werden
        })
        .select()
        .single();

      if (insertError) {
        console.log("Insert user error:", insertError.message);
        Alert.alert(
          "Fehler",
          "Konto konnte nicht erstellt werden. Bitte später erneut versuchen."
        );
        setLoading(false);
        return;
      }

      Alert.alert(
        "Registriert",
        "Dein Konto wurde angelegt und muss vom Admin freigeschaltet werden."
      );
      setLoading(false);
    } catch (e) {
      console.log("Login exception:", e);
      Alert.alert("Fehler", "Es ist ein Fehler aufgetreten.");
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

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="z.B. Benedikt Erl"
          placeholderTextColor="#9fb0c8"
        />

        <Text style={styles.label}>PIN</Text>
        <TextInput
          style={styles.input}
          value={pin}
          onChangeText={setPin}
          placeholder="Eigene 4-stellige PIN"
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
          Neue Spieler werden automatisch registriert und anschließend vom
          Admin freigeschaltet.
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
