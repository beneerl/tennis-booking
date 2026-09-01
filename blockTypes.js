export const BLOCK_TYPES = [
  {
    key: "mens_training",
    label: "Herrentraining",
    shortLabel: "Herren",
    icon: "barbell-outline",
    accent: "#4C9AFF",
    surface: "#0B315E",
  },
  {
    key: "womens_training",
    label: "Damentraining",
    shortLabel: "Damen",
    icon: "ribbon-outline",
    accent: "#D493FF",
    surface: "#382451",
  },
  {
    key: "kids_training",
    label: "Kindertraining",
    shortLabel: "Kinder",
    icon: "happy-outline",
    accent: "#62D9B4",
    surface: "#123D3A",
  },
  {
    key: "youth_training",
    label: "Jugendtraining",
    shortLabel: "Jugend",
    icon: "school-outline",
    accent: "#69C6FF",
    surface: "#103A52",
  },
  {
    key: "mens_40",
    label: "Herren 40",
    shortLabel: "Herren 40",
    icon: "medal-outline",
    accent: "#A495FF",
    surface: "#302A5A",
  },
  {
    key: "old_men",
    label: "Alte Herren",
    shortLabel: "AH",
    icon: "shield-checkmark-outline",
    accent: "#D9AE67",
    surface: "#47361F",
  },
  {
    key: "matchday",
    label: "Spieltag",
    shortLabel: "Spieltag",
    icon: "trophy-outline",
    accent: "#F28B25",
    surface: "#4A2B10",
  },
  {
    key: "tournament",
    label: "Turnier",
    shortLabel: "Turnier",
    icon: "podium-outline",
    accent: "#F4B45D",
    surface: "#47351A",
  },
  {
    key: "maintenance",
    label: "Platzpflege",
    shortLabel: "Pflege",
    icon: "construct-outline",
    accent: "#AAB7C8",
    surface: "#273647",
  },
  {
    key: "closed",
    label: "Gesperrt",
    shortLabel: "Gesperrt",
    icon: "lock-closed-outline",
    accent: "#93A4B8",
    surface: "#223247",
  },
  {
    key: "custom",
    label: "Sonstiges",
    shortLabel: "Sperre",
    icon: "calendar-outline",
    accent: "#8CA6C9",
    surface: "#203858",
  },
];

export const getBlockType = (key) =>
  BLOCK_TYPES.find((item) => item.key === key) ||
  BLOCK_TYPES.find((item) => item.key === "custom");

export function inferBlockType(reason = "", explicitType = "") {
  if (explicitType && BLOCK_TYPES.some((item) => item.key === explicitType)) {
    return explicitType;
  }

  const text = String(reason || "").trim().toLowerCase();
  if (!text) return "custom";
  if (text.includes("spieltag") || text.includes("medenspiel") || text.includes("punktspiel")) return "matchday";
  if (text.includes("turnier")) return "tournament";
  if (text.includes("herren 40") || text.includes("h40")) return "mens_40";
  if (text.includes("alte herren") || text === "ah" || text.startsWith("ah ")) return "old_men";
  if (text.includes("damen")) return "womens_training";
  if (text.includes("kinder")) return "kids_training";
  if (text.includes("jugend")) return "youth_training";
  if (text.includes("herren")) return "mens_training";
  if (text.includes("wartung") || text.includes("pflege") || text.includes("platzpflege")) return "maintenance";
  if (text.includes("gesperrt") || text.includes("sperre")) return "closed";
  return "custom";
}

export function getBlockPresentation({ blockType, label, reason } = {}) {
  const key = inferBlockType(reason || label, blockType);
  const type = getBlockType(key);
  return {
    ...type,
    key,
    displayLabel: String(label || reason || type.label || "Gesperrt").trim(),
  };
}
