import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const ITEMS = [
  { route: "Booking", label: "Buchen", icon: "calendar-outline", activeIcon: "calendar" },
  { route: "Tournament", label: "Turnier", icon: "trophy-outline", activeIcon: "trophy" },
  { route: "Teams", label: "Teams", icon: "people-outline", activeIcon: "people" },
  { route: "LK", label: "LK", icon: "stats-chart-outline", activeIcon: "stats-chart" },
  { route: "Profile", label: "Profil", icon: "person-outline", activeIcon: "person" },
];

export default function BottomNav({ navigation, active }) {
  return (
    <View style={styles.wrap}>
      {ITEMS.map((item) => {
        const selected = active === item.route;
        return (
          <TouchableOpacity
            key={item.route}
            style={styles.item}
            onPress={() => {
              if (!selected) navigation.navigate(item.route);
            }}
            activeOpacity={0.82}
          >
            <View style={[styles.iconWrap, selected && styles.iconWrapActive]}>
              <Ionicons
                name={selected ? item.activeIcon : item.icon}
                size={20}
                color={selected ? "#F28B25" : "#7187A4"}
              />
            </View>
            <Text style={[styles.label, selected && styles.labelActive]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    backgroundColor: "#061C37",
    borderTopWidth: 1,
    borderTopColor: "#153A60",
    paddingTop: 7,
    paddingBottom: Platform.OS === "ios" ? 18 : 9,
    paddingHorizontal: 6,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 50 },
  iconWrap: {
    width: 34,
    height: 27,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapActive: { backgroundColor: "rgba(242,139,37,0.10)" },
  label: { color: "#7187A4", fontSize: 9.5, fontWeight: "800", marginTop: 2 },
  labelActive: { color: "#F28B25" },
});
