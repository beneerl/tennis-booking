import React from "react";
import { Platform } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

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

const Stack = createNativeStackNavigator();

// ✅ Web URL-Routing / PWA support
const linking = {
prefixes: Platform.OS === "web" && typeof window !== "undefined"
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

export default function App() {
  // ✅ Web: iOS/PWA "appiger" machen (kein Seitenrand, weniger Bounce/Scroll-Kette)
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

  return (
    <NavigationContainer linking={Platform.OS === "web" ? linking : undefined}>

      <Stack.Navigator screenOptions={{ headerShown: false }}>
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
  );
}
