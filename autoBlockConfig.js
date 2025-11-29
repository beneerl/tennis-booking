// Globale Liste für automatische Sperr-Regeln
// Jede Regel: { id, courtIndex, weekday, from, to, reason }

export const autoBlockedRules = [];

/**
 * Neue automatische Sperr-Regel hinzufügen
 */
export const addAutoBlockedRule = (rule) => {
  autoBlockedRules.push(rule);
};

/**
 * Automatische Sperr-Regel per id entfernen
 */
export const removeAutoBlockedRule = (id) => {
  const index = autoBlockedRules.findIndex((r) => r.id === id);
  if (index !== -1) {
    autoBlockedRules.splice(index, 1);
  }
};
