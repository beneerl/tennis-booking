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

async function clearLocalLogin() {
  try {
    await supabase.auth.signOut();
  } catch {}
  try {
    await AsyncStorage.removeItem("user_login");
  } catch {}
}

async function loadUserByEmail(email) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .order("created_at", { ascending: false }); // neuester Eintrag zuerst
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

function normalizeStatus(rawStatus) {
  return rawStatus === null || rawStatus === undefined
    ? ""
    : String(rawStatus).trim().toLowerCase();
}

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  // 🔁 Auto-Login: Session/AsyncStorage prüfen, ABER Status in DB verifizieren
  useEffect(() => {
    const bootstrap = async () => {
      try {
        // 1) Supabase Session prüfen
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionEmail = sessionData?.session?.user?.email
          ? String(sessionData.session.user.email).toLowerCase()
          : null;

        // 2) Fallback: AsyncStorage
        const json = await AsyncStorage.getItem("user_login");
        const stored = json ? JSON.parse(json) : null;
        const storedEmail = stored?.email ? String(stored.email).toLowerCase() : null;

        const emailToCheck = sessionEmail || storedEmail;
        if (!emailToCheck) return;

        // 3) User in DB laden + Status checken
        const u = await loadUserByEmail(emailToCheck);
        if (!u) {
          await clearLocalLogin();
          return;
        }

        const status = normalizeStatus(u.status);
        const isAdmin = !!u.is_admin;

        if (status === "blocked") {
          await clearLocalLogin();
          showMessage(
            "Gesperrt",
            "Dein Zugang wurde vom Admin gesperrt. Bitte wende dich an den Verein."
          );
          return;
        }

        if (status !== "approved" && !isAdmin) {
          // pending -> bleibt im Login
          await clearLocalLogin();
          return;
        }

        // ✅ Auto-Login
        await AsyncStorage.setItem(
          "user_login",
          JSON.stringify({
            email: emailToCheck,
            name: u.name,
            is_admin: isAdmin,
          })
        );

        navigation.replace("Booking", {
          userName: u.name,
          isAdmin: isAdmin,
        });
      } catch (e) {
        console.log("Auto-login bootstrap error:", e?.message || e);
      }
    };

    bootstrap();
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

    if (!trimmedEmail || !trimmedPin) {
      showMessage("Fehlende Angaben", "Bitte E-Mail und Passwort eingeben.");
      return;
    }

    setLoading(true);

    try {
      // 1) Gibt es schon einen User mit dieser E-Mail in deiner Tabelle?
      let existingUser = null;
      try {
        existingUser = await loadUserByEmail(trimmedEmail);
      } catch (existingError) {
        console.log("existingError:", existingError?.message || existingError);
        showMessage("Fehler", "Benutzerabfrage fehlgeschlagen.");
        setLoading(false);
        return;
      }

      // --------------------------------------------------------
      // FALL A: User existiert -> EINLOGGEN (mit Auto-Migration)
      // --------------------------------------------------------
      if (existingUser) {
        const doStatusAndGo = async (u) => {
          const status = normalizeStatus(u.status);
          const isAdmin = !!u.is_admin;

          console.log("LOGIN STATUS CHECK:", {
            email: trimmedEmail,
            rawStatus: u.status,
            status,
            isAdmin,
          });

          if (status === "blocked") {
            showMessage(
              "Gesperrt",
              "Dein Zugang wurde vom Admin gesperrt. Bitte wende dich an den Verein."
            );
            await clearLocalLogin();
            setLoading(false);
            return;
          }

          if (status !== "approved" && !isAdmin) {
            showMessage(
              "Noch nicht freigeschaltet",
              "Dein Konto wurde noch nicht vom Admin freigegeben."
            );
            await clearLocalLogin();
            setLoading(false);
            return;
          }

          // ✅ Erfolgreich eingeloggt → lokal merken für Auto-Login
          await AsyncStorage.setItem(
            "user_login",
            JSON.stringify({
              email: trimmedEmail,
              name: u.name,
              is_admin: isAdmin,
            })
          );

          showMessage("Login erfolgreich", "Willkommen, " + u.name + "!");
          navigation.replace("Booking", {
            userName: u.name,
            isAdmin: isAdmin,
          });
          setLoading(false);
        };

        // 1) Erst normaler Sign-In Versuch
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: trimmedPin,
        });

        if (signInError) {
          const msg = (signInError.message || "").toLowerCase();
          console.log("signInError:", signInError.message);

          // Häufigster Fall: User in Tabelle existiert, aber Auth-Account existiert nicht (altbestand)
          if (msg.includes("invalid login credentials")) {
            // 2) Auto-Migration: einmal signUp versuchen
            const { data: signUpData, error: signUpError } =
              await supabase.auth.signUp({
                email: trimmedEmail,
                password: trimmedPin,
              });

            if (signUpError) {
              const su = (signUpError.message || "").toLowerCase();
              console.log("signUpError (migration):", signUpError.message);

              if (su.includes("already registered")) {
                showMessage("Login fehlgeschlagen", "Passwort oder E-Mail ist falsch.");
              } else {
                showMessage(
                  "Login fehlgeschlagen",
                  "Registrierung/Migration fehlgeschlagen: " + signUpError.message
                );
              }
              setLoading(false);
              return;
            }

            // 3) auth_id nachziehen (falls leer)
            const newAuthId = signUpData?.user?.id;
            if (newAuthId && !existingUser.auth_id) {
              const { error: updErr } = await supabase
                .from("users")
                .update({ auth_id: newAuthId })
                .eq("id", existingUser.id);

              if (updErr) {
                console.log("auth_id update error:", updErr.message);
                // Nicht hart abbrechen – Login kann trotzdem funktionieren
              }
            }

            // 4) Jetzt Status prüfen + rein
            await doStatusAndGo(existingUser);
            return;
          }

          showMessage("Login fehlgeschlagen", signInError.message);
          setLoading(false);
          return;
        }

        // Sign-In ok -> Status prüfen + rein
        await doStatusAndGo(existingUser);
        return;
      }

      // --------------------------------------------------------
      // FALL B: User existiert noch nicht -> REGISTRIEREN
      // --------------------------------------------------------
      if (!trimmedName) {
        showMessage("Fehlende Angaben", "Bitte Name angeben (nur bei Registrierung nötig).");
        setLoading(false);
        return;
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
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

        <Text style={styles.label}>Name (nur bei neuer Registrierung)</Text>
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
          freigeschaltet. Login erfolgt mit E-Mail + Passwort.
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
