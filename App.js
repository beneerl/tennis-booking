import React, { useEffect, useMemo, useState } from "react";
import { AppState, Platform, StatusBar, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";

import LoginScreen from "./screens/LoginScreen";
import BookingScreen from "./screens/BookingScreen";
import AdminSettingsScreen from "./screens/AdminSettingsScreen";
import ProfileScreen from "./screens/ProfileScreen";
import TeamsScreen from "./screens/TeamsScreen";
import TeamDetailsScreen from "./screens/TeamDetailsScreen";
import LKScreen from "./screens/LKScreen";
import TournamentScreen from "./screens/TournamentScreen";
import TournamentBracketScreen from "./screens/TournamentBracketScreen";
import TournamentAdminScreen from "./screens/TournamentAdminScreen";
import TennisLoader from "./components/TennisLoader";
import { supabase } from "./supabaseClient";
import { getCurrentUserProfile, normalizeUserStatus } from "./authProfile";

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

const LAST_MAIN_SCREEN_KEY = "teg_last_main_screen_v2";
const MAIN_SCREENS = new Set(["Booking", "Tournament", "Teams", "LK", "Profile"]);
const AUTH_RETRY_DELAYS = [0, 350, 900];

const linking = {
  prefixes:
    Platform.OS === "web" && typeof window !== "undefined"
      ? [window.location.origin]
      : [""],
  config: {
    screens: {
      Login: "",
      Booking: "booking",
      AdminSettings: "admin",
      Profile: "profile",
      Teams: "teams",
      TeamDetails: "teams/:teamId",
      LK: "lk",
      Tournament: "turnier",
      TournamentBracket: "turnier/baum/:drawId",
      TournamentAdmin: "admin/turnier",
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readLastMainScreen() {
  try {
    const stored = await AsyncStorage.getItem(LAST_MAIN_SCREEN_KEY);
    if (stored && MAIN_SCREENS.has(stored)) return stored;
  } catch {}
  return "Booking";
}

async function clearLegacyLoginCache() {
  try {
    await AsyncStorage.removeItem("user_login");
  } catch {}
}

async function bootstrapSession() {
  // getSession() liest zuerst die bereits lokal gespeicherte Supabase-Session.
  // Dadurch muss ein bestehender Nutzer beim App-Start nicht erneut einloggen.
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const localSession = data?.session || null;
  if (!localSession?.user?.id) {
    return { authenticated: false, startScreen: "Login" };
  }

  let profileResult = null;
  let profileError = null;

  // Netzwerkfehler beim Start sollen nicht sofort einen Logout erzwingen.
  // Wir versuchen die Profil-/Statuspruefung kurz erneut.
  for (const delay of AUTH_RETRY_DELAYS) {
    if (delay) await sleep(delay);
    try {
      profileResult = await getCurrentUserProfile({ refreshIfMissing: false });
      profileError = null;
      break;
    } catch (err) {
      profileError = err;
    }
  }

  // Wenn die Session lokal vorhanden ist, aber Supabase beim Start kurz nicht
  // erreichbar ist, bleibt der Nutzer eingeloggt. Die einzelnen Screens pruefen
  // Auth/Rolle weiterhin selbst, sobald Daten wieder erreichbar sind.
  if (profileError) {
    console.log("Auth bootstrap profile check deferred:", profileError?.message || profileError);
    return {
      authenticated: true,
      startScreen: await readLastMainScreen(),
      degraded: true,
    };
  }

  const session = profileResult?.session || localSession;
  const profile = profileResult?.profile || null;

  // Eine echte Session ohne zugehoeriges Vereinsprofil soll nicht still in die
  // App gelangen. Alte Login-Logik bleibt als Fallback auf dem Login-Screen bestehen.
  if (!session?.user?.id || !profile) {
    return { authenticated: false, startScreen: "Login" };
  }

  const status = normalizeUserStatus(profile.status);
  const isAdmin = !!profile.is_admin;

  if (status === "blocked" || (status !== "approved" && !isAdmin)) {
    try {
      await supabase.auth.signOut();
    } catch {}
    await clearLegacyLoginCache();
    return { authenticated: false, startScreen: "Login" };
  }

  // Den bisherigen Cache behalten wir absichtlich weiter. Alte App-Versionen und
  // bestehende Screens koennen dadurch parallel weiterarbeiten.
  try {
    await AsyncStorage.setItem(
      "user_login",
      JSON.stringify({
        email: profile.email || session.user.email || "",
        name: profile.name || "",
        is_admin: isAdmin,
      })
    );
  } catch {}

  return {
    authenticated: true,
    startScreen: await readLastMainScreen(),
  };
}

export default function App() {
  const [bootState, setBootState] = useState({
    ready: false,
    authenticated: false,
    startScreen: "Booking",
  });

  // Web / PWA weiterhin wie bisher auf eine app-aehnliche Breite begrenzen.
  if (Platform.OS === "web" && typeof document !== "undefined") {
    document.documentElement.style.height = "100%";
    document.body.style.height = "100%";
    document.body.style.margin = "0";
    document.body.style.overscrollBehavior = "none";
    document.body.style.background = "#000B1B";

    const root = document.getElementById("root");
    if (root) {
      root.style.height = "100%";
      root.style.maxWidth = "560px";
      root.style.margin = "0 auto";
      root.style.background = "#00152F";
      root.style.boxShadow = "0 0 60px rgba(0,0,0,0.28)";
    }
  }

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const result = await bootstrapSession();
        if (!active) return;
        setBootState({
          ready: true,
          authenticated: !!result.authenticated,
          startScreen: result.authenticated ? result.startScreen || "Booking" : "Login",
        });
      } catch (err) {
        console.log("Auth bootstrap error:", err?.message || err);

        // Bei einem unerwarteten Bootstrap-Fehler nicht die gespeicherte Session
        // loeschen. Wir zeigen den bestehenden Login als sicheren Fallback.
        if (active) {
          setBootState({ ready: true, authenticated: false, startScreen: "Login" });
        }
      }
    };

    run();
    return () => {
      active = false;
    };
  }, []);

  // Auf Android/iOS Token-Refresh an den App-Zustand koppeln. So wird eine lange
  // im Hintergrund liegende App beim Zurueckkehren sauber weiter angemeldet.
  useEffect(() => {
    if (Platform.OS === "web") return undefined;

    if (AppState.currentState === "active") {
      supabase.auth.startAutoRefresh();
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    return () => {
      subscription.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  // Wenn eine Session wirklich beendet wird (z. B. Logout), sofort sauber zum
  // Login zurueck. SIGNED_IN bleibt beim bestehenden LoginScreen, damit wir den
  // aktuellen Login-/Registrierungsablauf nicht brechen.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;

      setTimeout(() => {
        if (!navigationRef.isReady()) return;
        navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
      }, 0);
    });

    return () => data?.subscription?.unsubscribe();
  }, []);

  const initialRouteName = useMemo(
    () => (bootState.authenticated ? bootState.startScreen : "Login"),
    [bootState]
  );

  // Auf Web war "/" historisch der Login-Pfad. Bei bereits angemeldeten Nutzern
  // ignorieren wir nur beim ALLERERSTEN Laden genau diese Root-URL, damit
  // initialRouteName greifen kann und der Login nicht kurz aufblitzt. Tiefe Links
  // wie /turnier oder /teams bleiben weiterhin voll funktionsfaehig.
  const webLinking = useMemo(() => {
    if (Platform.OS !== "web") return undefined;

    return {
      ...linking,
      getInitialURL: async () => {
        if (typeof window === "undefined") return null;
        const path = window.location.pathname || "/";
        const isRoot = path === "/" || path === "";
        if (bootState.authenticated && isRoot) return null;
        return window.location.href;
      },
    };
  }, [bootState.authenticated]);

  if (!bootState.ready) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: "#00152F" }}>
          <StatusBar barStyle="light-content" />
          <TennisLoader />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer
        ref={navigationRef}
        linking={webLinking}
        onStateChange={() => {
          const routeName = navigationRef.getCurrentRoute()?.name;
          if (routeName && MAIN_SCREENS.has(routeName)) {
            AsyncStorage.setItem(LAST_MAIN_SCREEN_KEY, routeName).catch(() => {});
          }
        }}
      >
        <Stack.Navigator
          initialRouteName={initialRouteName}
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Booking" component={BookingScreen} />
          <Stack.Screen name="AdminSettings" component={AdminSettingsScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="Teams" component={TeamsScreen} />
          <Stack.Screen name="TeamDetails" component={TeamDetailsScreen} />
          <Stack.Screen name="LK" component={LKScreen} />
          <Stack.Screen name="Tournament" component={TournamentScreen} />
          <Stack.Screen name="TournamentBracket" component={TournamentBracketScreen} />
          <Stack.Screen name="TournamentAdmin" component={TournamentAdminScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
