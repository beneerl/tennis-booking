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
