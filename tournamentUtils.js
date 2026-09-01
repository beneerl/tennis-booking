export const makeId = (prefix = "id") =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const nextPowerOfTwo = (n) => {
  let size = 2;
  while (size < Math.max(2, n)) size *= 2;
  return size;
};

export const roundNameFor = (roundIndex, totalRounds) => {
  const remaining = totalRounds - roundIndex;
  if (remaining === 1) return "Finale";
  if (remaining === 2) return "Halbfinale";
  if (remaining === 3) return "Viertelfinale";
  if (remaining === 4) return "Achtelfinale";
  if (remaining === 5) return "Sechzehntelfinale";
  return `Runde ${roundIndex + 1}`;
};

export const bracketLabelForSize = (size) => {
  const rounds = Math.log2(size);
  return roundNameFor(0, rounds);
};

export const participantKeyFor = (match, side) => {
  if (!match) return null;
  const participantId = match[`player${side}_participant_id`];
  const authId = match[`player${side}_auth_id`];
  return participantId || (authId ? `auth:${authId}` : null);
};

export const winnerKeyFor = (match) => {
  if (!match) return null;
  return match.winner_participant_id || (match.winner_auth_id ? `auth:${match.winner_auth_id}` : null);
};

export const pendingWinnerKeyFor = (match) => {
  if (!match) return null;
  return match.pending_winner_participant_id || (match.pending_winner_auth_id ? `auth:${match.pending_winner_auth_id}` : null);
};

const normalizeSlotEntry = (entry, index) => {
  if (!entry) return null;
  return {
    participant_id: entry.participant_id || entry.id || makeId(`participant_${index}`),
    auth_id: entry.auth_id || null,
    name: String(entry.name || "").trim(),
  };
};

export const buildManualBracketRows = ({ drawId, slots, bracketSize }) => {
  const size = Number(bracketSize) || nextPowerOfTwo(slots?.length || 2);
  const totalRounds = Math.log2(size);
  const normalizedSlots = Array.from({ length: size }, (_, i) => normalizeSlotEntry(slots?.[i] || null, i));
  const ids = [];

  for (let r = 0; r < totalRounds; r += 1) {
    const count = size / 2 ** (r + 1);
    ids[r] = Array.from({ length: count }, (_, m) => makeId(`match_r${r}_${m}`));
  }

  // outcome per match: { type: 'known'|'pending'|'empty', participant? }
  const outcomes = [];
  const rows = [];

  for (let r = 0; r < totalRounds; r += 1) {
    outcomes[r] = [];
    const count = ids[r].length;
    for (let m = 0; m < count; m += 1) {
      let source1;
      let source2;

      if (r === 0) {
        const p1 = normalizedSlots[m * 2] || null;
        const p2 = normalizedSlots[m * 2 + 1] || null;
        source1 = p1 ? { type: "known", participant: p1 } : { type: "empty" };
        source2 = p2 ? { type: "known", participant: p2 } : { type: "empty" };
      } else {
        source1 = outcomes[r - 1][m * 2] || { type: "empty" };
        source2 = outcomes[r - 1][m * 2 + 1] || { type: "empty" };
      }

      const p1 = source1.type === "known" ? source1.participant : null;
      const p2 = source2.type === "known" ? source2.participant : null;

      const row = {
        id: ids[r][m],
        draw_id: drawId,
        round_index: r,
        match_index: m,
        round_name: roundNameFor(r, totalRounds),
        player1_participant_id: p1?.participant_id || null,
        player1_auth_id: p1?.auth_id || null,
        player1_name: p1?.name || null,
        player2_participant_id: p2?.participant_id || null,
        player2_auth_id: p2?.auth_id || null,
        player2_name: p2?.name || null,
        winner_participant_id: null,
        winner_auth_id: null,
        winner_name: null,
        score: null,
        status: "open",
        next_match_id: r < totalRounds - 1 ? ids[r + 1][Math.floor(m / 2)] : null,
        next_slot: r < totalRounds - 1 ? (m % 2) + 1 : null,
      };

      if (source1.type === "empty" && source2.type === "empty") {
        outcomes[r][m] = { type: "empty" };
      } else if (source1.type === "known" && source2.type === "empty") {
        row.winner_participant_id = p1.participant_id;
        row.winner_auth_id = p1.auth_id;
        row.winner_name = p1.name;
        row.score = "Freilos";
        row.status = "completed";
        outcomes[r][m] = { type: "known", participant: p1 };
      } else if (source1.type === "empty" && source2.type === "known") {
        row.winner_participant_id = p2.participant_id;
        row.winner_auth_id = p2.auth_id;
        row.winner_name = p2.name;
        row.score = "Freilos";
        row.status = "completed";
        outcomes[r][m] = { type: "known", participant: p2 };
      } else {
        // Entweder zwei bekannte Spieler oder mindestens ein noch offener Zulieferer.
        outcomes[r][m] = { type: "pending" };
      }

      rows.push(row);
    }
  }

  return { rows, bracketSize: size };
};

// Legacy helper für ältere Aufrufer.
export const buildBracketRows = ({ drawId, participants }) => {
  const size = nextPowerOfTwo(participants.length);
  const slots = Array.from({ length: size }, (_, index) => {
    const p = participants[index];
    if (!p) return null;
    return {
      participant_id: p.participant_id || makeId(`participant_${index}`),
      auth_id: p.auth_id || null,
      name: p.name,
    };
  });
  return buildManualBracketRows({ drawId, slots, bracketSize: size });
};

export const formatTournamentDate = (dateKey) => {
  if (!dateKey) return "";
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(dateKey);
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
};
