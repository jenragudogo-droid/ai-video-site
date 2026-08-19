/* ------------------------------------------------------------------ *
 * KFL commentary.
 *
 * Match events come out of the engine; this turns them into spoken
 * lines. Every event type has several phrasings, a cooldown and a
 * priority, so the commentator reacts to what actually happened
 * without repeating himself every few seconds.
 * ------------------------------------------------------------------ */

const surname = (name) => (name ? name.split(" ").slice(-1)[0] : "the striker");

/* priority: higher always interrupts lower. cooldown is in seconds. */
const LINES = {
  kickoff: {
    priority: 6, cooldown: 30,
    lines: [
      "And we are under way here at the Kianimation Arena.",
      "The referee blows, and we're off.",
      "Here we go then, the match is live.",
    ],
  },
  secondHalfStart: {
    priority: 6, cooldown: 30,
    lines: ["Back under way for the second half.", "We're going again. Second half."],
  },
  goal: {
    priority: 10, cooldown: 0,
    lines: [
      "GOAL! {player} finds the net!",
      "GOOOOAL! What a finish from {player}!",
      "It's in! {player} makes it {score}!",
      "Oh, that is superb! {player} scores!",
    ],
  },
  ownGoal: {
    priority: 10, cooldown: 0,
    lines: ["Oh no! That's an own goal!", "Into his own net! Disaster for {team}."],
  },
  shot: {
    priority: 6, cooldown: 3.5,
    lines: [
      "{player} has a go!",
      "He shoots!",
      "{player} lets fly from distance!",
      "Chance here for {player}!",
    ],
  },
  shotClose: {
    priority: 7, cooldown: 4,
    lines: [
      "That was close!",
      "Inches away!",
      "So nearly the opener there!",
      "He'll be disappointed with that.",
    ],
  },
  save: {
    priority: 8, cooldown: 2.5,
    lines: [
      "What a save!",
      "Brilliant goalkeeping!",
      "{player} keeps them out!",
      "Superb hands from the keeper!",
    ],
  },
  parry: {
    priority: 7, cooldown: 3,
    lines: ["He can only parry it away!", "Pushed away, and it's still live!"],
  },
  post: {
    priority: 8, cooldown: 2,
    lines: ["Off the post!", "The woodwork saves them!", "It smacks the upright!"],
  },
  crossbar: {
    priority: 8, cooldown: 2,
    lines: ["Off the crossbar!", "The bar comes to the rescue!"],
  },
  throughBall: {
    priority: 5, cooldown: 6,
    lines: [
      "He's through on goal!",
      "What a pass! That splits them open.",
      "Lovely ball in behind.",
      "That's a beautiful through ball.",
    ],
  },
  passComplete: {
    priority: 2, cooldown: 14,
    lines: [
      "Nicely worked.",
      "Good feet, good pass.",
      "They're knocking it about with confidence.",
      "Patient build up from {team}.",
    ],
  },
  cross: {
    priority: 4, cooldown: 7,
    lines: ["The cross comes in!", "Whipped into the box!", "He swings it over."],
  },
  header: {
    priority: 6, cooldown: 5,
    lines: ["He goes for the header!", "Up he rises!"],
  },
  interception: {
    priority: 4, cooldown: 7,
    lines: [
      "Great interception!",
      "Read it perfectly, {player}.",
      "He nips in and takes it.",
    ],
  },
  tackleWon: {
    priority: 4, cooldown: 7,
    lines: [
      "Superb tackle!",
      "Won cleanly by {player}.",
      "That's a strong challenge.",
    ],
  },
  foul: {
    priority: 6, cooldown: 4,
    lines: [
      "The referee blows for a foul.",
      "That's a free kick.",
      "He caught him there, no doubt about it.",
    ],
  },
  penaltyAwarded: {
    priority: 9, cooldown: 0,
    lines: ["It's a penalty!", "The referee points to the spot!"],
  },
  penaltyTaken: {
    priority: 8, cooldown: 0,
    lines: ["{player} steps up...", "Here's the penalty..."],
  },
  yellowCard: {
    priority: 7, cooldown: 2,
    lines: [
      "The referee gives a yellow card.",
      "That's a booking for {player}.",
      "Into the book he goes.",
    ],
  },
  redCard: {
    priority: 9, cooldown: 0,
    lines: [
      "It's a red card! He's off!",
      "Sent off! {team} are down to ten.",
    ],
  },
  offside: {
    priority: 6, cooldown: 5,
    lines: ["The flag is up. Offside.", "He strayed offside.", "Caught offside, and the whistle goes."],
  },
  corner: {
    priority: 5, cooldown: 6,
    lines: ["That's a corner.", "It's gone behind. Corner kick."],
  },
  throw: {
    priority: 2, cooldown: 20,
    lines: ["Throw in.", "Out of play, throw to {team}."],
  },
  goalkick: {
    priority: 2, cooldown: 22,
    lines: ["Goal kick.", "The keeper will restart it."],
  },
  subPrepared: {
    priority: 6, cooldown: 8,
    lines: [
      "They're preparing a substitution.",
      "A change is coming on the touchline.",
    ],
  },
  substitution: {
    priority: 6, cooldown: 3,
    lines: [
      "{off} makes way for {on}.",
      "{on} comes on for {team}.",
      "Fresh legs. {on} is on.",
    ],
  },
  tired: {
    priority: 4, cooldown: 45,
    lines: [
      "You can see the legs going now.",
      "They're tiring badly out there.",
      "The manager must be thinking about a change.",
    ],
  },
  fiveMinutesLeft: {
    priority: 6, cooldown: 0,
    lines: ["Five minutes remaining.", "Not long left in this one."],
  },
  halftime: {
    priority: 9, cooldown: 0,
    lines: ["That's the halftime whistle. {score}.", "Halftime here, {score}."],
  },
  fulltime: {
    priority: 10, cooldown: 0,
    lines: ["And that's full time!", "It's all over! {score}."],
  },
  shootoutStart: {
    priority: 9, cooldown: 0,
    lines: ["It all comes down to penalties.", "We go to a shootout."],
  },
  shootoutScored: {
    priority: 8, cooldown: 0,
    lines: ["Scored!", "He makes no mistake.", "Right in the corner!"],
  },
  shootoutMissed: {
    priority: 8, cooldown: 0,
    lines: ["Missed!", "Saved! What a moment!", "He's put it wide!"],
  },
  shootoutWin: {
    priority: 10, cooldown: 0,
    lines: ["{team} win the shootout!", "They've done it! {team} go through!"],
  },
  possessionWon: {
    priority: 3, cooldown: 12,
    lines: ["Turnover in midfield.", "They lose it cheaply there."],
  },
  keeperDistribution: {
    priority: 1, cooldown: 30,
    lines: ["The keeper looks to start something.", "Rolled out to begin the move."],
  },
};

const GLOBAL_GAP = 1.5;

export function createCommentator({ audio, teamNames, onLine }) {
  const lastAt = {};
  const lastIndex = {};
  let lastSpokeAt = -99;
  let currentPriority = 0;
  let now = 0;

  function fill(text, data) {
    return text
      .replace("{player}", surname(data.playerName))
      .replace("{team}", data.teamName || "the home side")
      .replace("{off}", surname(data.offName))
      .replace("{on}", surname(data.onName))
      .replace("{score}", data.score || "");
  }

  function say(key, data = {}) {
    const spec = LINES[key];
    if (!spec) return null;
    const since = now - (lastAt[key] ?? -999);
    if (since < spec.cooldown) return null;
    if (now - lastSpokeAt < GLOBAL_GAP && spec.priority <= currentPriority) return null;

    const pool = spec.lines;
    let idx = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && idx === lastIndex[key]) idx = (idx + 1) % pool.length;
    lastIndex[key] = idx;
    lastAt[key] = now;
    lastSpokeAt = now;
    currentPriority = spec.priority;

    const text = fill(pool[idx], data);
    if (spec.priority >= 9) audio?.cancelSpeech();
    audio?.speak(text, { excited: spec.priority >= 8 });
    onLine?.(text, spec.priority);
    return text;
  }

  function tick(dt) {
    now += dt;
    if (now - lastSpokeAt > 2.4) currentPriority = 0;
  }

  /** Turn one engine event into commentary plus its sound effects. */
  function handle(event, world) {
    const teamName = (i) => teamNames[i] || "";
    const scoreText = `${teamNames[0]} ${world.score[0]}, ${teamNames[1]} ${world.score[1]}`;

    switch (event.type) {
      case "kickoff":
        audio?.play("whistleShort");
        say(event.half > 1 ? "secondHalfStart" : "kickoff");
        break;
      case "goal":
        audio?.play("goalRoar");
        say(world.lastGoal?.ownGoal ? "ownGoal" : "goal", {
          playerName: event.scorer?.name,
          teamName: teamName(event.team),
          score: scoreText,
        });
        break;
      case "shot":
        audio?.play(event.finesse ? "kick" : "kickHard");
        say("shot", { playerName: event.player?.name, teamName: teamName(event.team) });
        break;
      case "header":
        audio?.play("header");
        say("header", { playerName: event.player?.name });
        break;
      case "save":
        audio?.play("crowdOoh");
        say("save", { playerName: event.player?.name });
        break;
      case "parry":
        say("parry", { playerName: event.player?.name });
        break;
      case "post":
        audio?.play("post");
        audio?.play("crowdOoh");
        say("post");
        break;
      case "crossbar":
        audio?.play("post");
        audio?.play("crowdOoh");
        say("crossbar");
        break;
      case "throughBall":
        audio?.play("kick");
        say("throughBall", { playerName: event.player?.name });
        break;
      case "pass":
      case "longPass":
        audio?.play("kick");
        break;
      case "passComplete":
        say("passComplete", { teamName: teamName(event.player ? 0 : 0) });
        break;
      case "cross":
        audio?.play("kick");
        say("cross", { playerName: event.player?.name });
        break;
      case "interception":
        say("interception", { playerName: event.player?.name });
        break;
      case "tackleWon":
        audio?.play("tackle");
        say("tackleWon", { playerName: event.player?.name });
        break;
      case "foul":
        audio?.play("whistleShort");
        say("foul", { playerName: event.player?.name });
        break;
      case "penaltyAwarded":
        audio?.play("crowdCheer");
        say("penaltyAwarded");
        break;
      case "penaltyTaken":
        audio?.play("kickHard");
        say("penaltyTaken", { playerName: event.player?.name });
        break;
      case "yellowCard":
        say("yellowCard", { playerName: event.player?.name });
        break;
      case "redCard":
        audio?.play("crowdOoh");
        say("redCard", { playerName: event.player?.name, teamName: teamName(event.team) });
        break;
      case "offside":
        audio?.play("whistleShort");
        say("offside", { playerName: event.player?.name });
        break;
      case "corner":
        say("corner");
        break;
      case "throw":
        say("throw", { teamName: teamName(event.team) });
        break;
      case "goalkick":
        say("goalkick");
        break;
      case "keeperDistribution":
        audio?.play("kick");
        say("keeperDistribution");
        break;
      case "subPrepared":
        say("subPrepared");
        break;
      case "substitution":
        audio?.play("applause");
        say("substitution", {
          onName: event.on?.name,
          offName: event.off?.name,
          teamName: teamName(event.team),
        });
        break;
      case "fiveMinutesLeft":
        say("fiveMinutesLeft");
        break;
      case "halftime":
        audio?.play("whistleDouble");
        say("halftime", { score: scoreText });
        break;
      case "fulltime":
        audio?.play("whistleLong");
        say("fulltime", { score: scoreText });
        break;
      case "fulltimeDraw":
        audio?.play("whistleLong");
        break;
      case "shootoutStart":
        say("shootoutStart");
        break;
      case "shootoutScored":
        audio?.play("goalRoar");
        say("shootoutScored");
        break;
      case "shootoutMissed":
        audio?.play("crowdOoh");
        say("shootoutMissed");
        break;
      case "shootoutWin":
        audio?.play("goalRoar");
        say("shootoutWin", { teamName: teamName(event.team) });
        break;
      case "freekickTaken":
      case "goalkickTaken":
      case "throwTaken":
      case "clearance":
      case "headerClear":
        audio?.play("kick");
        break;
      case "possessionWon":
        say("possessionWon");
        break;
      default:
        break;
    }
  }

  return { handle, say, tick };
}
