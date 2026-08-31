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
import { Ionicons } from "@expo/vector-icons";

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
        // 1) Supabase-Session ist die einzige Login-Wahrheit.
        // user_login ist nur Komfort-Cache und darf einen gueltigen Login nicht blockieren.
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionEmail = sessionData?.session?.user?.email
          ? String(sessionData.session.user.email).toLowerCase()
          : null;

        if (!sessionEmail) {
          try {
            await AsyncStorage.removeItem("user_login");
          } catch {}
          return;
        }

        const emailToCheck = sessionEmail;


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

        navigation.replace("Booking");
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
          navigation.replace("Booking");
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
// ✅ WICHTIG: Nach signUp (Migration) ist oft KEINE Session vorhanden.
// Deshalb sofort sicher einloggen, sonst ist auth.uid() leer -> user_id bleibt NULL.
const { error: signInAfterSignUpErr } = await supabase.auth.signInWithPassword({
  email: trimmedEmail,
  password: trimmedPin,
});

if (signInAfterSignUpErr) {
  console.log("signInAfterSignUpErr:", signInAfterSignUpErr.message);
  showMessage(
    "Login fehlgeschlagen",
    "Bitte nochmal einloggen: " + signInAfterSignUpErr.message
  );
  setLoading(false);
  return;
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

      <View style={styles.loginShell}>
        <View style={styles.brandMark}>
          <Ionicons name="tennisball-outline" size={33} color="#F28B25" />
        </View>
        <Text style={styles.title}>Tennis Booking</Text>
        <Text style={styles.subtitle}>Tacherting · Platzreservierung</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Willkommen</Text>
            <Text style={styles.cardSubtitle}>Melde dich an oder registriere dich als neues Vereinsmitglied.</Text>
          </View>

          <Text style={styles.label}>E-Mail</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={18} color="#6F86A8" />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="name@beispiel.de"
              placeholderTextColor="#6F86A8"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <Text style={styles.label}>Name</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="person-outline" size={18} color="#6F86A8" />
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Nur bei neuer Registrierung nötig"
              placeholderTextColor="#6F86A8"
            />
          </View>

          <Text style={styles.label}>Passwort</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color="#6F86A8" />
            <TextInput
              style={styles.input}
              value={pin}
              onChangeText={setPin}
              placeholder="Mindestens 6 Zeichen"
              placeholderTextColor="#6F86A8"
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            style={[styles.loginButton, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.88}
          >
            {loading ? (
              <ActivityIndicator color="#001738" />
            ) : (
              <>
                <Text style={styles.loginButtonText}>Weiter</Text>
                <Ionicons name="arrow-forward" size={18} color="#001738" />
              </>
            )}
          </TouchableOpacity>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={17} color="#7F93B0" />
            <Text style={styles.infoText}>
              Neue Accounts werden nach der Registrierung einmalig vom Admin freigeschaltet.
            </Text>
          </View>
        </View>

        <Text style={styles.footerText}>TEG Altstadt · Tennis</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#00152F",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 28,
  },
  loginShell: { width: "100%", maxWidth: 440, alignItems: "center" },
  brandMark: {
    width: 66,
    height: 66,
    borderRadius: 22,
    backgroundColor: "#082A52",
    borderWidth: 1,
    borderColor: "#173F69",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 13,
  },
  title: { color: "#FFFFFF", fontSize: 28, fontWeight: "900", letterSpacing: -0.6 },
  subtitle: { color: "#7F93B0", fontSize: 12, marginTop: 3, marginBottom: 22, fontWeight: "700" },
  card: {
    width: "100%",
    backgroundColor: "#062447",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#173F69",
  },
  cardHeader: { marginBottom: 12 },
  cardTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  cardSubtitle: { color: "#8EA2BB", fontSize: 11.5, lineHeight: 17, marginTop: 4 },
  label: { color: "#C7D4E3", fontSize: 11, fontWeight: "900", marginTop: 10, marginBottom: 6 },
  inputWrap: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#031B36",
    borderRadius: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#123B63",
  },
  input: { flex: 1, color: "#FFFFFF", fontSize: 14, paddingVertical: 11 },
  loginButton: {
    minHeight: 50,
    marginTop: 18,
    backgroundColor: "#F28B25",
    borderRadius: 15,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  loginButtonDisabled: { opacity: 0.7 },
  loginButtonText: { color: "#001738", fontSize: 14, fontWeight: "900" },
  infoBox: {
    marginTop: 14,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.025)",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  infoText: { flex: 1, color: "#8398B2", fontSize: 10.5, lineHeight: 15 },
  footerText: { color: "#536B88", fontSize: 10, fontWeight: "800", marginTop: 16, letterSpacing: 0.8 },
});
