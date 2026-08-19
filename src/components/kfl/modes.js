/* ------------------------------------------------------------------ *
 * KFL game modes.
 *
 * Quick Match is the mode that ships. The rest are declared here with
 * the shape they will need so league, cup and career work can be added
 * without touching the match engine: every mode ultimately produces a
 * match config for makeMatch() and consumes its result.
 * ------------------------------------------------------------------ */

import { CLUBS, autoLineup, clubById } from "./teams.js";
import { FORMATIONS } from "./formations.js";

export const MODES = [
  {
    id: "quick",
    name: "Quick Match",
    blurb: "Pick two clubs, pick your XI, play a full match.",
    available: true,
  },
  {
    id: "league",
    name: "KFL League",
    blurb: "Eight clubs, home and away, three points for a win.",
    available: false,
  },
  {
    id: "cup",
    name: "Cup Tournament",
    blurb: "Straight knockout with extra time and penalties.",
    available: false,
  },
  {
    id: "career",
    name: "Career Mode",
    blurb: "Seasons, transfers, training and promotion.",
    available: false,
  },
];

/** Everything a match needs, ready for makeMatch(). */
export function quickMatchConfig({
  home,
  away,
  homeSetup,
  awaySetup,
  userTeam = 0,
  halfSeconds = 180,
  difficulty = "normal",
  knockout = false,
  seed = Date.now() % 100000,
}) {
  return { home, away, homeSetup, awaySetup, userTeam, halfSeconds, difficulty, knockout, seed };
}

export function defaultSetup(clubId, formationId = "4-3-3") {
  const club = clubById(clubId);
  const formation = FORMATIONS[formationId] || FORMATIONS["4-3-3"];
  return { formation: formation.id, ...autoLineup(club.squad, formation) };
}

/* ------------------------- season scaffolding -------------------------- */
/* Used by the league and career modes when they are built. */

export function generateFixtures(clubIds, doubleRound = true) {
  const ids = [...clubIds];
  if (ids.length % 2) ids.push(null);
  const rounds = [];
  const half = ids.length / 2;
  let list = ids.slice(1);

  for (let r = 0; r < ids.length - 1; r += 1) {
    const pairs = [];
    const order = [ids[0], ...list];
    for (let i = 0; i < half; i += 1) {
      const home = order[i];
      const away = order[order.length - 1 - i];
      if (home && away) pairs.push(r % 2 ? { home: away, away: home } : { home, away });
    }
    rounds.push(pairs);
    list = [list[list.length - 1], ...list.slice(0, -1)];
  }

  if (!doubleRound) return rounds;
  const second = rounds.map((round) => round.map((f) => ({ home: f.away, away: f.home })));
  return [...rounds, ...second];
}

export function emptyTable(clubIds) {
  return clubIds.map((id) => ({
    club: id,
    played: 0, won: 0, drawn: 0, lost: 0,
    goalsFor: 0, goalsAgainst: 0, points: 0,
  }));
}

export function applyResult(table, homeId, awayId, homeGoals, awayGoals) {
  const row = (id) => table.find((t) => t.club === id);
  const h = row(homeId);
  const a = row(awayId);
  if (!h || !a) return table;
  h.played += 1;
  a.played += 1;
  h.goalsFor += homeGoals;
  h.goalsAgainst += awayGoals;
  a.goalsFor += awayGoals;
  a.goalsAgainst += homeGoals;
  if (homeGoals > awayGoals) {
    h.won += 1; h.points += 3; a.lost += 1;
  } else if (awayGoals > homeGoals) {
    a.won += 1; a.points += 3; h.lost += 1;
  } else {
    h.drawn += 1; a.drawn += 1; h.points += 1; a.points += 1;
  }
  return table;
}

export function sortTable(table) {
  return [...table].sort((x, y) =>
    y.points - x.points
    || (y.goalsFor - y.goalsAgainst) - (x.goalsFor - x.goalsAgainst)
    || y.goalsFor - x.goalsFor);
}

export const LEAGUE_CLUBS = CLUBS.map((c) => c.id);
