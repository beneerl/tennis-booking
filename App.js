import React from "react";
import { Platform } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import LoginScreen from "./screens/LoginScreen";
import BookingScreen from "./screens/BookingScreen";
import AdminSettingsScreen from "./screens/AdminSettingsScreen";
import ProfileScreen from "./screens/ProfileScreen";

const Stack = createNativeStackNavigator();

// ✅ Web URL-Routing / PWA support
const linking = {
  prefixes: [
    // Für Web reicht meistens der Root
    // Wenn du später eine eigene Domain nutzt, kannst du sie hier ergänzen.
    ""
  ],
  config: {
    screens: {
      Login: "",
      Booking: "booking",
      AdminSettings: "admin",
      Profile: "profile",
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
  }

  return (
    <NavigationContainer linking={Platform.OS === "web" ? linking : undefined}>

      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Booking" component={BookingScreen} />
        <Stack.Screen name="AdminSettings" component={AdminSettingsScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
