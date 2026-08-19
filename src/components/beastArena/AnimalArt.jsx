/* ------------------------------------------------------------------ *
 * Original vector artwork for the fighters.
 * Everything is hand-built SVG geometry — no external images, no
 * copyrighted assets, a few KB of markup per animal.
 * Group class names (bHead, bLegFront, ...) are the animation handles
 * used by BeastBattleArena.css.
 * ------------------------------------------------------------------ */

/* shared shading helpers ------------------------------------------------ */

function CoatDefs({ id, top, mid, deep, belly, glow }) {
  return (
    <defs>
      <linearGradient id={`${id}-coat`} x1="0.25" y1="0" x2="0.55" y2="1">
        <stop offset="0" stopColor={top} />
        <stop offset="0.48" stopColor={mid} />
        <stop offset="1" stopColor={deep} />
      </linearGradient>
      <linearGradient id={`${id}-limb`} x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0" stopColor={mid} />
        <stop offset="1" stopColor={deep} />
      </linearGradient>
      <radialGradient id={`${id}-muscle`} cx="0.38" cy="0.34" r="0.75">
        <stop offset="0" stopColor={top} stopOpacity="0.95" />
        <stop offset="1" stopColor={deep} stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}-belly`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={belly} stopOpacity="0" />
        <stop offset="1" stopColor={belly} stopOpacity="0.85" />
      </linearGradient>
      <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor={glow} stopOpacity="0" />
        <stop offset="0.45" stopColor={glow} stopOpacity="0.85" />
        <stop offset="1" stopColor={glow} stopOpacity="0.15" />
      </linearGradient>
    </defs>
  );
}

function Eye({ x, y, iris = "#f3c34a", scale = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse rx="5.4" ry="3.9" fill="#1b1208" />
      <ellipse rx="4.2" ry="2.9" fill={iris} />
      <ellipse rx="1.5" ry="2.6" fill="#120c05" />
      <circle cx="-1.4" cy="-1.2" r="1.1" fill="#fff" opacity="0.92" />
    </g>
  );
}

/* ------------------------------- big cats ------------------------------- */
/* Lion, tiger and wolf share one anatomy and diverge on coat, head,
   ears, tail and markings. */

const CAT_SHAPES = {
  /* deep chest at the front, tucked waist, heavy haunch at the rear */
  torso:
    "M50,80 C48,62 62,50 84,48 C106,46 128,49 146,54 C159,58 168,70 168,84 C168,97 160,107 148,111 C139,114 127,105 111,103 C97,101 87,107 77,107 C61,105 52,95 50,80 Z",
  haunch:
    "M50,76 C50,58 65,49 82,54 C99,59 105,79 101,97 C97,114 80,120 66,111 C53,103 50,90 50,76 Z",
  shoulder:
    "M127,57 C146,53 162,66 163,84 C164,99 152,109 138,106 C123,103 117,86 119,72 C121,63 123,59 127,57 Z",
  belly:
    "M74,102 C88,110 104,106 116,101 C128,96 142,100 152,108 C140,116 120,116 104,112 C90,109 80,108 74,102 Z",
  neck: "M134,52 C145,39 162,33 178,35 L185,80 C165,87 142,75 134,60 Z",
  /* front limb: upper arm, forearm, paw — the joints read as elbow/wrist */
  legFrontUpper: "M130,84 C147,80 161,94 158,112 L146,116 C136,110 126,98 130,84 Z",
  legFrontLower: "M147,108 C157,110 160,122 158,133 L157,143 L145,143 L145,131 C143,120 139,111 147,108 Z",
  pawFront:
    "M141,139 C152,135 165,140 165,148 C165,152 156,153 147,153 L141,153 C135,153 135,141 141,139 Z",
  /* hind limb: thigh, shank, paw — digitigrade hock */
  legBackUpper: "M66,82 C86,76 104,94 99,116 L86,120 C71,113 59,98 66,82 Z",
  legBackLower: "M88,112 C98,116 99,129 93,138 L91,146 L79,146 L82,131 C82,122 80,114 88,112 Z",
  pawBack:
    "M75,139 C86,135 99,140 99,148 C99,152 90,153 81,153 L75,153 C69,153 69,141 75,139 Z",
  /* shaggy edges — small tufts break up the silhouette so it is not a blob */
  backFur:
    "M56,72 C60,64 66,58 76,54 C92,47 118,47 140,52 C130,53 108,53 88,58 C74,62 63,67 56,72 Z",
  chestFur:
    "M150,98 L160,104 L151,107 L159,115 L148,114 L152,122 L141,115 L143,124 L134,113 Z",
};

const CATS = {
  lion: {
    top: "#f0c076",
    mid: "#c98c3c",
    deep: "#7d4d16",
    belly: "#f6e2b8",
    dark: "#5e3a10",
    glow: "#ffd98a",
    iris: "#f0b53c",
    ear: "round",
    muzzle: "cat",
    mane: true,
    tail: "tuft",
    stripes: null,
  },
  tiger: {
    top: "#ffb35e",
    mid: "#e07b23",
    deep: "#a1490c",
    belly: "#fbead0",
    dark: "#3a1c06",
    glow: "#ffcf87",
    iris: "#ffd24a",
    ear: "round",
    muzzle: "cat",
    mane: false,
    tail: "long",
    stripes: [
      "M92,54 C95,66 95,76 92,86 L84,84 C87,74 87,64 84,55 Z",
      "M108,52 C111,66 111,78 108,90 L100,88 C103,76 103,64 100,53 Z",
      "M124,55 C127,68 127,80 124,92 L117,90 C120,78 120,66 117,56 Z",
      "M140,60 C143,72 143,84 140,95 L134,93 C137,82 137,71 134,61 Z",
      "M64,66 C70,74 74,84 74,96 L66,98 C66,86 63,76 58,70 Z",
      "M56,86 C64,90 70,98 72,108 L64,112 C62,102 57,95 51,92 Z",
      "M180,46 C183,54 183,60 181,66 L175,64 C177,58 177,52 175,47 Z",
      "M194,44 C197,52 197,58 195,64 L189,62 C191,56 191,50 189,45 Z",
    ],
  },
  cheetah: {
    top: "#f0cd7e",
    mid: "#d9a94a",
    deep: "#9c7020",
    belly: "#fbf0d5",
    dark: "#3a2a10",
    glow: "#ffe9a8",
    iris: "#e8a93c",
    ear: "round",
    muzzle: "cat",
    mane: false,
    tail: "long",
    stripes: null,
    slim: true,
    spots: [
      [78, 66, 4.6], [92, 58, 4.2], [106, 62, 4.8], [120, 56, 4.2], [134, 62, 4.4],
      [86, 80, 4.4], [100, 76, 4], [116, 78, 4.6], [132, 80, 4], [148, 74, 3.8],
      [74, 94, 4], [92, 96, 3.6], [110, 94, 4.2], [128, 96, 3.6], [146, 92, 3.4],
      [64, 78, 3.8], [156, 86, 3.2],
    ],
    tearLine: true,
  },
  wolf: {
    top: "#b6bec9",
    mid: "#77808e",
    deep: "#414855",
    belly: "#e2e6ec",
    dark: "#2b3038",
    glow: "#cfe0f2",
    iris: "#e0b23c",
    ear: "point",
    muzzle: "long",
    mane: false,
    tail: "bushy",
    stripes: [
      "M62,70 C82,54 118,50 148,58 C154,72 152,88 146,100 C120,88 88,88 64,100 C58,90 58,78 62,70 Z",
    ],
  },
};

function CatFighter({ id }) {
  const c = CATS[id];
  const coat = `url(#${id}-coat)`;
  const limb = `url(#${id}-limb)`;

  const muzzle =
    c.muzzle === "long"
      ? "M190,64 C210,57 235,63 237,74 C239,86 216,93 197,90 C186,88 182,69 190,64 Z"
      : "M196,66 C211,60 227,66 228,77 C229,88 214,94 200,91 C190,89 188,71 196,66 Z";
  const noseX = c.muzzle === "long" ? 232 : 223;

  const tail =
    c.tail === "bushy"
      ? "M56,92 C40,100 22,94 11,77 C5,66 16,54 25,61 C33,72 44,80 57,79 Z"
      : c.tail === "long"
        ? "M52,92 C33,97 17,88 7,71 C3,63 12,56 17,63 C26,78 40,84 55,79 Z"
        : "M52,92 C36,92 21,84 13,69 C9,61 18,54 23,61 C31,74 42,80 55,79 Z";

  return (
    <svg
      className="beastSvg"
      viewBox="0 0 240 160"
      preserveAspectRatio="xMidYMax meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <CoatDefs id={id} top={c.top} mid={c.mid} deep={c.deep} belly={c.belly} glow={c.glow} />

      <g className="bTail">
        <path d={tail} fill={limb} />
        {c.tail === "tuft" && <ellipse cx="15" cy="65" rx="10" ry="9" fill={c.dark} />}
        {c.tail === "bushy" && (
          <path d="M26,62 C16,54 6,60 8,72 C10,82 20,88 28,84 Z" fill={c.top} opacity="0.55" />
        )}
        {c.tail === "long" && (
          <>
            <path d="M40,84 C44,88 44,92 41,95 L35,90 Z" fill={c.dark} />
            <path d="M22,72 C26,76 26,80 23,83 L17,77 Z" fill={c.dark} />
            <ellipse cx="10" cy="67" rx="7" ry="6" fill={c.dark} />
          </>
        )}
      </g>

      {/* far side limbs sit behind the body and read darker */}
      <g className="bLegBackFar" opacity="0.55">
        <g transform="translate(-16 2)">
          <path d={CAT_SHAPES.legBackUpper} fill={c.deep} />
          <path d={CAT_SHAPES.legBackLower} fill={c.deep} />
          <path d={CAT_SHAPES.pawBack} fill={c.dark} />
        </g>
      </g>
      <g className="bLegFrontFar" opacity="0.55">
        <g transform="translate(-17 2)">
          <path d={CAT_SHAPES.legFrontUpper} fill={c.deep} />
          <path d={CAT_SHAPES.legFrontLower} fill={c.deep} />
          <path d={CAT_SHAPES.pawFront} fill={c.dark} />
        </g>
      </g>

      <g className="bBody" transform={c.slim ? "translate(0 6) scale(1.02 0.9)" : undefined}>
        <path d={CAT_SHAPES.torso} fill={coat} />
        <path d={CAT_SHAPES.haunch} fill={coat} />
        <path d={CAT_SHAPES.haunch} fill={`url(#${id}-muscle)`} opacity="0.75" />
        <path d={CAT_SHAPES.shoulder} fill={coat} />
        <path d={CAT_SHAPES.shoulder} fill={`url(#${id}-muscle)`} opacity="0.7" />
        <path d={CAT_SHAPES.belly} fill={`url(#${id}-belly)`} />
        {/* muscle contours */}
        <path
          d="M96,70 C104,82 104,96 96,108"
          fill="none"
          stroke={c.deep}
          strokeOpacity="0.32"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M132,74 C140,84 140,98 133,108"
          fill="none"
          stroke={c.deep}
          strokeOpacity="0.28"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        {/* rim light along the spine */}
        <path
          d={`M58,76 C74,56 112,50 148,60`}
          fill="none"
          stroke={`url(#${id}-rim)`}
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        {c.stripes?.map((d, i) => (
          <path key={i} d={d} fill={c.dark} opacity={id === "wolf" ? 0.22 : 0.88} />
        ))}
        {c.spots?.map(([cx, cy, r], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={r} ry={r * 0.86} fill={c.dark} opacity="0.8" />
        ))}
        {/* shaggy silhouette edges + underside shadow */}
        <path d={CAT_SHAPES.backFur} fill={c.top} opacity="0.4" />
        <path d={CAT_SHAPES.chestFur} fill={c.belly} opacity="0.5" />
        <path
          d="M62,96 C84,112 122,114 156,102 C150,116 120,124 92,118 C76,114 66,106 62,96 Z"
          fill={c.deep}
          opacity="0.35"
        />
        {/* short fur strokes catch the light on the shoulder and haunch */}
        <g stroke={c.top} strokeOpacity="0.28" strokeWidth="1.6" fill="none" strokeLinecap="round">
          <path d="M70,66 C76,72 78,80 77,88" />
          <path d="M82,60 C88,68 90,78 89,86" />
          <path d="M132,66 C138,74 140,84 139,92" />
          <path d="M144,70 C149,78 150,86 149,93" />
        </g>
      </g>

      <g className="bLegBack">
        <path d={CAT_SHAPES.legBackUpper} fill={coat} />
        <path d={CAT_SHAPES.legBackLower} fill={limb} />
        <path d={CAT_SHAPES.pawBack} fill={c.mid} />
        <path
          d="M84,116 C90,120 92,128 90,134"
          fill="none"
          stroke={c.deep}
          strokeOpacity="0.4"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path className="bClaws" d="M78,153 L81,147 L84,153 Z M86,153 L89,147 L92,153 Z" fill="#f3ecdc" />
      </g>

      <g className="bLegFront">
        <path d={CAT_SHAPES.legFrontUpper} fill={coat} />
        <path d={CAT_SHAPES.legFrontLower} fill={limb} />
        <path d={CAT_SHAPES.pawFront} fill={c.mid} />
        <path
          d="M147,110 C153,114 155,122 154,129"
          fill="none"
          stroke={c.deep}
          strokeOpacity="0.4"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          className="bClaws"
          d="M146,153 L149,146 L152,153 Z M154,153 L157,146 L160,153 Z M162,152 L164,147 L166,152 Z"
          fill="#f3ecdc"
        />
      </g>

      <g className="bHead">
        <path d={CAT_SHAPES.neck} fill={coat} />
        {c.mane && (
          <g className="bMane">
            <path
              d="M150,58 C140,52 134,42 138,32 L146,36 C144,26 150,16 160,14 L162,24 C166,14 176,8 186,10 L186,20 C194,12 206,12 212,20 L206,28 C216,26 226,32 228,42 L218,44 C228,48 232,58 228,68 L218,64 C226,72 226,84 218,90 L210,84 C214,94 210,104 200,108 L196,100 C196,110 188,118 178,118 L178,110 C172,118 160,120 152,114 L156,106 C146,110 136,104 134,94 L144,92 C134,88 130,78 134,68 L144,70 C138,66 144,60 150,58 Z"
              fill={c.deep}
            />
            <path
              d="M154,60 C144,54 141,40 150,33 C149,22 161,16 169,22 C176,12 191,13 195,24 C206,21 215,30 212,40 C223,44 224,59 215,65 C223,74 218,88 207,89 C209,100 198,109 189,105 C184,114 171,115 166,105 C157,111 146,105 146,95 C137,92 134,79 141,73 C135,66 145,59 154,60 Z"
              fill={c.mid}
              opacity="0.85"
            />
          </g>
        )}
        <path
          d="M166,44 C182,33 205,37 215,52 C223,64 222,79 214,88 C204,99 183,100 171,91 C159,82 155,57 166,44 Z"
          fill={coat}
        />
        {c.ear === "point" ? (
          <>
            <path d="M166,50 L168,18 L190,42 Z" fill={c.mid} />
            <path d="M170,46 L171,27 L184,42 Z" fill={c.dark} opacity="0.65" />
          </>
        ) : (
          <>
            <path d="M170,44 C164,32 175,22 185,27 C193,31 193,45 187,50 Z" fill={c.mid} />
            <path d="M175,42 C172,34 179,29 185,32 C189,35 188,43 184,46 Z" fill={c.dark} opacity="0.6" />
          </>
        )}
        <path d={muzzle} fill={c.top} opacity="0.92" />
        {id === "tiger" && (
          <path d="M186,44 C189,50 189,56 187,61 L181,59 C183,54 183,49 181,45 Z" fill={c.dark} opacity="0.85" />
        )}
        <path
          d={`M${noseX - 6},70 C${noseX + 1},67 ${noseX + 6},72 ${noseX + 2},77 C${noseX - 3},81 ${noseX - 9},76 ${noseX - 6},70 Z`}
          fill={c.dark}
        />
        <path
          d={`M${noseX - 4},80 C${noseX - 2},85 ${noseX - 9},88 ${noseX - 14},85`}
          fill="none"
          stroke={c.dark}
          strokeOpacity="0.75"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* fangs appear when the mouth opens (attack / special) */}
        <g className="bFangs">
          <path d={`M${noseX - 10},84 L${noseX - 7},93 L${noseX - 4},84 Z`} fill="#fff8ea" />
          <path d={`M${noseX - 18},84 L${noseX - 15},92 L${noseX - 12},84 Z`} fill="#fff8ea" />
        </g>
        {c.spots && (
          <g fill={c.dark} opacity="0.75">
            <ellipse cx="176" cy="52" rx="3" ry="2.6" />
            <ellipse cx="188" cy="46" rx="2.6" ry="2.2" />
            <ellipse cx="200" cy="50" rx="2.4" ry="2" />
          </g>
        )}
        {c.tearLine && (
          <path
            d="M191,66 C193,74 198,80 205,84"
            fill="none"
            stroke={c.dark}
            strokeOpacity="0.85"
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}
        <Eye x={192} y={60} iris={c.iris} />
        <path
          d="M178,52 C184,47 192,46 198,48"
          fill="none"
          stroke={c.dark}
          strokeOpacity="0.45"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        {/* whiskers */}
        <g stroke={c.belly} strokeOpacity="0.5" strokeWidth="1.2" fill="none" strokeLinecap="round">
          <path d={`M${noseX - 12},76 C${noseX - 2},74 ${noseX + 4},70 ${noseX + 10},66`} />
          <path d={`M${noseX - 12},80 C${noseX - 2},80 ${noseX + 5},78 ${noseX + 12},76`} />
        </g>
      </g>
    </svg>
  );
}

/* -------------------------------- gorilla -------------------------------- */

function GorillaFighter() {
  const id = "gorilla";
  const coat = `url(#${id}-coat)`;
  const limb = `url(#${id}-limb)`;
  return (
    <svg
      className="beastSvg"
      viewBox="0 0 240 160"
      preserveAspectRatio="xMidYMax meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <CoatDefs id={id} top="#6d6d7c" mid="#3f3f4b" deep="#1e1e26" belly="#8b8b9c" glow="#c2d2e6" />

      {/* far arm and leg sit behind the trunk */}
      <g className="bLegFrontFar" opacity="0.5">
        <path
          d="M120,62 C136,58 150,74 148,96 L146,124 C145,134 148,140 154,146 L132,146 C128,140 130,130 131,120 L130,96 C120,84 112,70 120,62 Z"
          fill="#1e1e26"
        />
        <path d="M128,138 C142,133 158,140 158,148 C158,153 146,154 136,154 L130,154 C124,154 122,141 128,138 Z" fill="#191920" />
      </g>
      <g className="bLegBackFar" opacity="0.5">
        <path d="M74,100 C90,96 104,112 100,130 L96,142 C94,148 96,151 100,154 L74,154 C72,149 73,142 76,136 L78,126 C68,120 66,108 74,100 Z" fill="#1e1e26" />
      </g>

      <g className="bBody">
        {/* huge sloping shoulders tapering to narrow hips */}
        <path
          d="M66,96 C66,74 82,56 108,48 C132,41 158,44 170,58 C182,72 182,94 172,112 C160,132 130,142 104,136 C80,131 66,116 66,96 Z"
          fill={coat}
        />
        {/* the silverback saddle */}
        <path
          d="M84,62 C104,48 140,46 164,60 C172,74 172,92 166,104 C142,90 110,90 86,102 C78,90 78,72 84,62 Z"
          fill="#9aa0ad"
          opacity="0.72"
        />
        <path
          d="M90,66 C108,55 140,54 160,66 C166,76 166,88 162,96 C140,84 112,84 90,94 C86,84 87,74 90,66 Z"
          fill="#ced4de"
          opacity="0.42"
        />
        {/* muscled chest */}
        <path
          d="M120,100 C142,96 164,104 172,120 C156,134 124,136 108,126 C104,114 110,102 120,100 Z"
          fill="#4e4e5c"
        />
        <path
          d="M128,106 C138,104 148,108 152,116"
          fill="none"
          stroke="#1b1b22"
          strokeOpacity="0.45"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        {/* shaggy shoulder and flank fur */}
        <g fill="#2c2c36" opacity="0.55">
          <path d="M70,92 L62,100 L72,102 L64,112 L76,110 L72,120 L84,112 Z" />
          <path d="M170,86 L180,92 L170,96 L178,106 L166,104 Z" />
        </g>
        <path
          d="M72,92 C78,66 106,48 146,50"
          fill="none"
          stroke={`url(#${id}-rim)`}
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>

      <g className="bLegBack">
        <path d="M76,98 C94,94 108,112 104,130 L100,142 C98,148 100,152 104,155 L76,155 C74,150 75,143 78,137 L80,126 C70,120 68,106 76,98 Z" fill={limb} />
        <path d="M76,147 C90,143 106,148 106,155 C106,158 95,159 84,159 L78,159 C71,159 70,149 76,147 Z" fill="#3a3a46" />
        <path d="M82,155 L86,150 L90,155 Z M92,155 L96,150 L100,155 Z" fill="#8b8b9c" opacity="0.7" />
      </g>

      {/* long near arm planted on the knuckles — the silverback silhouette */}
      <g className="bLegFront bArm">
        <path
          d="M138,60 C160,56 176,74 174,98 L170,126 C169,136 172,142 178,148 L152,148 C148,142 150,131 152,120 L150,98 C138,86 128,70 138,60 Z"
          fill={limb}
        />
        <path
          d="M144,64 C160,62 170,76 169,94"
          fill="none"
          stroke="#6d6d7c"
          strokeOpacity="0.5"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path d="M150,140 C166,135 184,142 184,151 C184,156 171,157 159,157 L152,157 C145,157 143,143 150,140 Z" fill="#55555f" />
        <path d="M156,148 L160,142 L164,148 Z M166,148 L170,142 L174,148 Z" fill="#25252e" opacity="0.85" />
      </g>

      <g className="bHead">
        {/* thick neck, head carried low and forward */}
        <path d="M142,48 C148,34 164,26 178,30 L184,64 C166,72 146,62 142,52 Z" fill="#33333e" />
        <path
          d="M154,30 C166,16 190,16 200,30 C208,42 206,60 194,70 C180,81 158,78 150,64 C144,52 146,38 154,30 Z"
          fill={coat}
        />
        {/* sagittal crest */}
        <path d="M166,18 C176,6 194,10 198,22 C188,15 176,14 166,18 Z" fill="#5e5e6c" />
        {/* heavy brow ridge */}
        <path d="M160,44 C174,34 194,36 202,46 C192,43 174,44 162,50 Z" fill="#17171d" opacity="0.9" />
        {/* forward-jutting muzzle */}
        <path
          d="M180,50 C198,46 212,54 210,66 C208,77 190,81 179,74 C170,68 171,53 180,50 Z"
          fill="#55555f"
        />
        <path d="M200,56 C206,55 209,59 207,63 C204,66 199,64 199,60 Z" fill="#141419" />
        <path
          d="M198,70 C202,74 195,77 190,74"
          fill="none"
          stroke="#141419"
          strokeOpacity="0.85"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <g className="bFangs">
          <path d="M186,72 L189,80 L192,72 Z" fill="#fff8ea" />
          <path d="M177,71 L180,78 L183,71 Z" fill="#fff8ea" />
        </g>
        <Eye x={180} y={50} iris="#8a5a2a" scale={0.8} />
        <path d="M148,46 C142,42 142,33 149,31 C153,30 155,36 154,42 Z" fill="#33333e" />
      </g>
    </svg>
  );
}

/* --------------------------------- eagle --------------------------------- */

function EagleFighter() {
  const id = "eagle";
  return (
    <svg
      className="beastSvg"
      viewBox="0 0 240 160"
      preserveAspectRatio="xMidYMax meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <CoatDefs id={id} top="#a4733f" mid="#6d4826" deep="#3d2716" belly="#c99a5c" glow="#ffd98a" />

      {/* far wing */}
      <g className="bWingFar" opacity="0.55">
        <path
          d="M132,74 C112,58 84,44 56,40 C40,38 30,46 36,56 C44,70 66,82 86,88 C102,93 124,94 136,88 Z"
          fill="#3d2716"
        />
      </g>

      {/* tail fan */}
      <g className="bTail">
        <path
          d="M96,98 C76,100 56,110 42,124 C36,131 42,139 50,134 C68,124 88,116 102,114 Z"
          fill="#57381e"
        />
        <path
          d="M98,104 C82,108 66,116 54,126"
          fill="none"
          stroke="#2b1a0d"
          strokeOpacity="0.6"
          strokeWidth="2"
        />
        <path
          d="M100,110 C86,114 72,120 62,128"
          fill="none"
          stroke="#2b1a0d"
          strokeOpacity="0.5"
          strokeWidth="2"
        />
      </g>

      <g className="bBody">
        <path
          d="M96,86 C100,66 120,54 142,56 C164,58 178,72 179,90 C180,110 166,124 144,127 C120,130 102,120 96,104 C94,98 94,91 96,86 Z"
          fill={`url(#${id}-coat)`}
        />
        {/* breast feathering */}
        <g fill="#8a5f33" opacity="0.55">
          <path d="M128,92 C134,90 140,94 138,100 C134,104 126,102 126,96 Z" />
          <path d="M144,88 C150,86 156,90 154,96 C150,100 142,98 142,92 Z" />
          <path d="M134,106 C140,104 146,108 144,114 C140,118 132,116 132,110 Z" />
          <path d="M150,102 C156,100 162,104 160,110 C156,114 148,112 148,106 Z" />
          <path d="M118,102 C124,100 130,104 128,110 C124,114 116,112 116,106 Z" />
        </g>
        <path
          d="M100,82 C112,64 138,56 164,62"
          fill="none"
          stroke={`url(#${id}-rim)`}
          strokeWidth="3.4"
          strokeLinecap="round"
        />
      </g>

      {/* talons */}
      <g className="bLegFront">
        <path d="M138,120 L136,140" stroke="#e0a63a" strokeWidth="7" strokeLinecap="round" />
        <path d="M152,118 L152,138" stroke="#c98d2c" strokeWidth="6" strokeLinecap="round" />
        <path
          d="M128,140 C136,136 146,138 148,146 L142,150 C138,144 132,142 126,144 Z"
          fill="#e0a63a"
        />
        <path
          d="M144,138 C152,134 162,136 164,145 L158,149 C154,143 150,141 144,143 Z"
          fill="#c98d2c"
        />
        <g fill="#f3ecdc">
          <path d="M126,144 L120,150 L128,149 Z" />
          <path d="M142,150 L138,156 L146,154 Z" />
          <path d="M158,149 L154,155 L162,153 Z" />
        </g>
      </g>

      {/* near wing — the animated one */}
      <g className="bWing">
        <path
          d="M138,72 C118,52 88,34 56,28 C36,24 22,34 28,46 C38,64 64,78 88,86 C106,92 128,92 142,84 Z"
          fill="#7a5330"
        />
        <path
          d="M134,74 C116,58 92,44 66,38 C50,34 38,40 42,50 C50,64 72,76 92,82 C108,87 124,86 136,80 Z"
          fill="#946139"
          opacity="0.85"
        />
        <g stroke="#2f1d0e" strokeOpacity="0.45" strokeWidth="1.8" fill="none">
          <path d="M60,32 C74,46 92,62 116,74" />
          <path d="M44,36 C58,50 76,66 100,78" />
          <path d="M32,42 C46,56 62,70 84,82" />
        </g>
        <g fill="#33200f" opacity="0.75">
          <path d="M28,44 L14,42 L30,52 Z" />
          <path d="M40,36 L24,30 L44,44 Z" />
          <path d="M56,29 L42,20 L62,36 Z" />
        </g>
      </g>

      <g className="bHead">
        <path d="M140,64 C146,52 160,46 172,48 L176,74 C160,80 144,74 140,66 Z" fill="#6d4826" />
        {/* white head */}
        <path
          d="M160,50 C176,40 198,46 204,60 C209,72 200,86 184,88 C168,90 156,80 156,66 C156,59 157,53 160,50 Z"
          fill="#f4f1e8"
        />
        <path
          d="M162,54 C174,46 192,50 198,60 C186,54 172,52 162,58 Z"
          fill="#d9d4c6"
          opacity="0.8"
        />
        {/* hooked beak */}
        <path
          d="M198,58 C214,56 228,62 228,69 C228,75 218,78 208,77 C212,85 204,91 198,86 C193,81 192,64 198,58 Z"
          fill="#f0b53c"
        />
        <path
          d="M200,62 C212,60 222,64 224,69 C214,66 206,65 200,67 Z"
          fill="#ffd970"
          opacity="0.9"
        />
        <path d="M198,72 C206,73 214,73 220,72" stroke="#a3701a" strokeWidth="1.6" fill="none" />
        {/* brow gives the fierce look */}
        <path d="M176,52 C186,48 196,50 202,56 L196,60 C190,55 182,54 176,56 Z" fill="#cfc9b8" />
        <Eye x={186} y={60} iris="#f0b53c" scale={0.85} />
      </g>
    </svg>
  );
}

/* -------------------------------- elephant -------------------------------- */

function ElephantFighter() {
  const id = "elephant";
  const coat = `url(#${id}-coat)`;
  const limb = `url(#${id}-limb)`;
  return (
    <svg className="beastSvg" viewBox="0 0 240 160" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
      <CoatDefs id={id} top="#b3b9c8" mid="#8d93a6" deep="#4e5464" belly="#c9cedb" glow="#e6ecf8" />

      <g className="bLegBackFar" opacity="0.55">
        <path d="M62,92 C80,88 94,102 92,124 L90,146 L68,146 L70,124 C58,116 54,100 62,92 Z" fill="#41465a" />
      </g>
      <g className="bLegFrontFar" opacity="0.55">
        <path d="M132,92 C150,88 164,102 162,124 L160,146 L138,146 L140,124 C128,116 124,100 132,92 Z" fill="#41465a" />
      </g>

      <g className="bTail">
        <path d="M52,88 C40,90 30,98 26,110 C24,117 32,120 35,113 C38,104 46,98 55,96 Z" fill={limb} />
        <path d="M28,108 L24,122 L34,116 Z" fill="#3d4252" />
      </g>

      <g className="bBody">
        <path d="M50,86 C50,60 74,44 110,42 C146,40 172,52 178,76 C186,104 170,128 142,134 C112,141 76,138 62,120 C52,108 48,96 50,86 Z" fill={coat} />
        <path d="M62,104 C92,120 140,120 170,102 C166,120 132,132 100,128 C80,125 66,116 62,104 Z" fill={`url(#${id}-belly)`} />
        <path d="M60,78 C74,54 110,42 152,48" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="4" strokeLinecap="round" />
        {/* wrinkled hide */}
        <g stroke="#5b6274" strokeOpacity="0.4" strokeWidth="1.8" fill="none" strokeLinecap="round">
          <path d="M76,58 C82,72 82,92 76,108" />
          <path d="M94,52 C100,68 100,92 94,112" />
          <path d="M114,50 C120,68 120,94 114,116" />
        </g>
      </g>

      <g className="bLegBack">
        <path d="M66,90 C86,86 102,102 100,126 L98,148 L72,148 L74,126 C62,118 58,98 66,90 Z" fill={limb} />
        <path d="M70,140 C84,136 100,141 100,149 C100,153 88,154 76,154 L70,154 C64,154 63,142 70,140 Z" fill="#5b6274" />
        <path d="M74,152 L78,147 L82,152 Z M84,152 L88,147 L92,152 Z" fill="#dfe4ee" opacity="0.75" />
      </g>

      <g className="bLegFront">
        <path d="M138,90 C158,86 174,102 172,126 L170,148 L144,148 L146,126 C134,118 130,98 138,90 Z" fill={limb} />
        <path d="M142,140 C156,136 172,141 172,149 C172,153 160,154 148,154 L142,154 C136,154 135,142 142,140 Z" fill="#5b6274" />
        <path className="bClaws" d="M146,152 L150,147 L154,152 Z M156,152 L160,147 L164,152 Z" fill="#f0ead9" />
      </g>

      <g className="bHead">
        {/* domed skull */}
        <path d="M154,50 C168,32 198,32 210,48 C220,62 216,84 202,92 C186,101 164,96 156,82 C148,70 148,58 154,50 Z" fill={coat} />
        {/* the ear, the elephant's signature */}
        <path d="M152,46 C134,40 124,60 127,84 C130,104 148,113 160,102 C168,94 166,58 152,46 Z" fill="#7b8296" />
        <path d="M150,54 C138,50 132,64 134,82 C136,96 148,102 156,95 C161,89 159,62 150,54 Z" fill="#646b7e" opacity="0.7" />
        {/* trunk */}
        <path d="M197,82 C212,92 218,112 216,130 C215,142 212,150 204,152 C196,154 190,148 193,141 C198,131 204,124 203,112 C202,100 194,96 189,90 C186,85 191,79 197,82 Z" fill={limb} />
        <path d="M204,146 C210,146 213,150 210,153 C206,156 200,154 200,150 Z" fill="#6c7386" />
        <g stroke="#4e5464" strokeOpacity="0.45" strokeWidth="1.6" fill="none">
          <path d="M196,96 C204,99 209,104 210,109" />
          <path d="M199,108 C207,111 211,116 212,121" />
          <path d="M200,120 C208,123 211,128 211,133" />
          <path d="M198,132 C205,135 208,140 207,145" />
        </g>
        {/* tusks */}
        <path d="M184,92 C198,98 210,112 214,128 C215,133 209,135 206,130 C201,116 191,104 179,99 Z" fill="#f8f4e8" />
        <path d="M172,94 C185,100 195,112 199,126 C200,131 194,133 191,128 C187,115 179,105 168,101 Z" fill="#e6e0cd" opacity="0.92" />
        <Eye x={186} y={62} iris="#8a6a3a" scale={0.72} />
      </g>
    </svg>
  );
}

/* -------------------------------- crocodile ------------------------------- */

function CrocodileFighter() {
  const id = "crocodile";
  const coat = `url(#${id}-coat)`;
  const limb = `url(#${id}-limb)`;
  return (
    <svg className="beastSvg" viewBox="0 0 240 160" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
      <CoatDefs id={id} top="#6fae5c" mid="#4f8a4a" deep="#26512c" belly="#c6d98a" glow="#b8e878" />

      <g className="bLegBackFar" opacity="0.55">
        <path d="M62,112 C76,108 88,118 86,132 L84,142 L66,142 L68,132 C58,128 54,118 62,112 Z" fill="#1e4224" />
      </g>
      <g className="bLegFrontFar" opacity="0.55">
        <path d="M136,110 C150,106 162,116 160,130 L158,142 L140,142 L142,130 C132,126 128,116 136,110 Z" fill="#1e4224" />
      </g>

      <g className="bTail">
        <path d="M52,106 C34,106 16,114 4,126 C-1,131 5,139 13,134 C28,124 44,118 56,116 Z" fill={limb} />
        <g fill="#2f6334">
          <path d="M40,110 L36,100 L48,108 Z" />
          <path d="M26,116 L22,106 L34,114 Z" />
          <path d="M13,123 L9,114 L21,121 Z" />
        </g>
      </g>

      <g className="bBody">
        {/* long, low and flat */}
        <path d="M46,110 C46,96 66,88 98,86 C130,84 156,88 170,96 C179,101 180,112 172,118 C156,130 118,134 84,130 C60,127 46,120 46,110 Z" fill={coat} />
        <path d="M60,118 C92,130 140,128 170,114 C160,126 120,132 88,128 C72,126 64,123 60,118 Z" fill={`url(#${id}-belly)`} />
        {/* armoured scutes down the spine */}
        <g fill="#356b38">
          <path d="M62,92 L58,80 L72,90 Z" />
          <path d="M80,88 L76,76 L90,86 Z" />
          <path d="M98,86 L94,74 L108,84 Z" />
          <path d="M116,85 L112,73 L126,84 Z" />
          <path d="M134,86 L130,75 L144,85 Z" />
          <path d="M152,90 L148,80 L162,90 Z" />
        </g>
        {/* scale rows */}
        <g stroke="#2b5730" strokeOpacity="0.45" strokeWidth="1.6" fill="none">
          <path d="M70,100 C100,108 140,108 168,100" />
          <path d="M66,110 C98,120 140,120 170,110" />
        </g>
      </g>

      <g className="bLegBack">
        <path d="M66,110 C82,106 96,118 94,134 L92,144 L70,144 L72,134 C60,130 56,116 66,110 Z" fill={limb} />
        <path className="bClaws" d="M68,148 L72,140 L76,148 Z M78,148 L82,140 L86,148 Z M88,148 L92,141 L95,148 Z" fill="#e9e3c8" />
      </g>
      <g className="bLegFront">
        <path d="M140,108 C156,104 170,116 168,132 L166,144 L144,144 L146,132 C134,128 130,114 140,108 Z" fill={limb} />
        <path className="bClaws" d="M142,148 L146,140 L150,148 Z M152,148 L156,140 L160,148 Z M162,148 L166,141 L169,148 Z" fill="#e9e3c8" />
      </g>

      <g className="bHead">
        {/* flat skull with the long jaw */}
        <path d="M158,88 C170,78 190,78 200,86 C206,91 206,102 200,106 C188,113 166,112 158,104 C152,99 152,92 158,88 Z" fill={coat} />
        <path d="M196,88 C214,84 234,88 237,95 C240,102 230,108 214,109 C202,110 192,106 190,100 C189,94 191,89 196,88 Z" fill={coat} />
        {/* lower jaw */}
        <path d="M194,104 C210,104 230,102 236,99 C236,107 222,113 206,113 C198,113 193,110 194,104 Z" fill="#3d6f3c" />
        {/* teeth */}
        <g fill="#fbf7e6">
          <path d="M200,103 L203,110 L206,103 Z" />
          <path d="M210,103 L213,110 L216,103 Z" />
          <path d="M220,102 L223,108 L226,102 Z" />
          <path d="M205,104 L208,98 L211,104 Z" />
          <path d="M216,103 L219,97 L222,103 Z" />
        </g>
        {/* raised eye ridge */}
        <path d="M166,80 C172,72 184,72 189,79 C184,77 172,77 166,84 Z" fill="#5c9a52" />
        <Eye x={176} y={82} iris="#e0c24a" scale={0.72} />
        <path d="M162,90 C168,88 176,88 182,90" fill="none" stroke="#26512c" strokeOpacity="0.5" strokeWidth="1.6" />
      </g>
    </svg>
  );
}

/* ---------------------------------- rhino --------------------------------- */

function RhinoFighter() {
  const id = "rhino";
  const coat = `url(#${id}-coat)`;
  const limb = `url(#${id}-limb)`;
  return (
    <svg className="beastSvg" viewBox="0 0 240 160" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
      <CoatDefs id={id} top="#a3adbb" mid="#7d8794" deep="#464d58" belly="#b9c2cf" glow="#dbe4ee" />

      <g className="bLegBackFar" opacity="0.55">
        <path d="M64,96 C80,92 94,106 92,126 L90,146 L70,146 L72,126 C60,118 56,104 64,96 Z" fill="#3b4149" />
      </g>
      <g className="bLegFrontFar" opacity="0.55">
        <path d="M136,96 C152,92 166,106 164,126 L162,146 L142,146 L144,126 C132,118 128,104 136,96 Z" fill="#3b4149" />
      </g>

      <g className="bTail">
        <path d="M50,92 C38,94 28,102 24,112 C22,118 30,121 33,115 C36,107 44,101 53,99 Z" fill={limb} />
        <path d="M26,110 L22,122 L32,116 Z" fill="#3b4149" />
      </g>

      <g className="bBody">
        <path d="M48,90 C48,66 72,50 108,48 C144,46 168,58 174,80 C181,104 166,126 140,132 C110,139 76,136 62,120 C51,108 46,100 48,90 Z" fill={coat} />
        <path d="M60,106 C92,122 138,122 168,104 C162,122 130,132 98,128 C78,125 64,117 60,106 Z" fill={`url(#${id}-belly)`} />
        {/* armour plating — the folds that make a rhino a rhino */}
        <path d="M92,52 C96,72 96,102 90,126 L82,124 C88,100 88,72 84,54 Z" fill="#5e6672" opacity="0.75" />
        <path d="M136,54 C140,74 140,102 134,126 L126,124 C132,102 132,74 128,56 Z" fill="#5e6672" opacity="0.6" />
        <path d="M58,84 C74,60 108,48 146,54" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="4" strokeLinecap="round" />
        <g stroke="#40464f" strokeOpacity="0.4" strokeWidth="1.6" fill="none">
          <path d="M66,96 C86,106 130,106 158,96" />
        </g>
      </g>

      <g className="bLegBack">
        <path d="M68,94 C88,90 104,106 102,128 L100,148 L74,148 L76,128 C64,120 58,102 68,94 Z" fill={limb} />
        <path d="M72,142 C86,138 102,143 102,150 C102,154 90,155 78,155 L72,155 C66,155 65,144 72,142 Z" fill="#565e6a" />
        <path d="M76,153 L80,148 L84,153 Z M86,153 L90,148 L94,153 Z" fill="#d5dde8" opacity="0.75" />
      </g>
      <g className="bLegFront">
        <path d="M140,94 C160,90 176,106 174,128 L172,148 L146,148 L148,128 C136,120 130,102 140,94 Z" fill={limb} />
        <path d="M144,142 C158,138 174,143 174,150 C174,154 162,155 150,155 L144,155 C138,155 137,144 144,142 Z" fill="#565e6a" />
        <path className="bClaws" d="M148,153 L152,148 L156,153 Z M158,153 L162,148 L166,153 Z" fill="#e7edf5" />
      </g>

      <g className="bHead">
        {/* head carried low, horn leading */}
        <path d="M158,72 C168,54 194,50 208,62 C220,72 219,92 206,100 C192,109 168,105 160,92 C154,84 154,78 158,72 Z" fill={coat} />
        {/* the horns */}
        <path d="M204,62 C214,36 226,20 231,30 C236,44 226,72 210,82 Z" fill="#efe9da" />
        <path d="M207,64 C215,44 223,32 226,40 C229,52 220,70 211,78 Z" fill="#fffaf0" opacity="0.8" />
        <path d="M186,56 C192,38 200,30 202,40 C204,50 197,64 189,68 Z" fill="#e2dbc9" />
        {/* small tube ears */}
        <path d="M168,58 C164,44 172,38 178,44 C182,48 181,58 177,62 Z" fill="#6d7684" />
        <path d="M180,54 C177,44 184,39 189,44 C192,48 191,55 188,58 Z" fill="#5e6672" opacity="0.8" />
        <path d="M200,88 C210,86 216,90 214,95 C211,101 198,101 194,96 Z" fill="#666e7b" />
        <path d="M206,92 C210,91 212,93 211,95 C209,97 205,96 205,94 Z" fill="#2f353d" />
        <Eye x={182} y={76} iris="#8d7a4e" scale={0.7} />
      </g>
    </svg>
  );
}

/* --------------------------------- dragon --------------------------------- */
/* Deliberately mythic: membrane wings, spined ridge, horns and ember glow —
   never dressed up as one of the real animals. */

function DragonFighter() {
  const id = "dragon";
  const coat = `url(#${id}-coat)`;
  const limb = `url(#${id}-limb)`;
  return (
    <svg className="beastSvg" viewBox="0 0 240 160" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
      <CoatDefs id={id} top="#a97cff" mid="#6d43c4" deep="#331c63" belly="#d8b8ff" glow="#ff9a4d" />
      <defs>
        <linearGradient id="dragon-wing" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#8d5ae0" />
          <stop offset="0.6" stopColor="#532d9e" />
          <stop offset="1" stopColor="#2a1553" />
        </linearGradient>
        <radialGradient id="dragon-ember" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff0c0" />
          <stop offset="0.45" stopColor="#ff9a3d" />
          <stop offset="1" stopColor="#ff5a1f" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* far wing */}
      <g className="bWingFar" opacity="0.45">
        <path d="M118,68 C98,44 66,24 36,20 C22,18 14,30 22,42 C34,60 64,78 88,86 C102,90 114,86 120,78 Z" fill="#2a1553" />
      </g>

      <g className="bLegBackFar" opacity="0.55">
        <path d="M66,96 C82,92 94,106 92,124 L90,142 L72,142 L74,124 C62,116 58,104 66,96 Z" fill="#2a1553" />
      </g>

      {/* spaded tail */}
      <g className="bTail">
        <path d="M54,96 C36,98 20,108 10,122 C5,129 13,136 20,130 C33,118 46,110 58,106 Z" fill={limb} />
        <path d="M16,116 L2,110 L14,128 L4,132 L22,134 Z" fill="#6d43c4" />
        <g fill="#8d5ae0">
          <path d="M42,102 L38,92 L50,100 Z" />
          <path d="M28,110 L24,100 L36,108 Z" />
        </g>
      </g>

      <g className="bBody">
        <path d="M52,92 C52,68 74,52 106,50 C138,48 164,58 172,80 C180,102 166,124 140,130 C110,137 78,134 64,118 C54,107 50,100 52,92 Z" fill={coat} />
        {/* pale scaled underbelly */}
        <path d="M64,108 C94,124 138,122 168,106 C160,124 128,132 96,128 C78,125 68,118 64,108 Z" fill="#c9a6f5" opacity="0.75" />
        <g stroke="#4a2a8f" strokeOpacity="0.5" strokeWidth="1.4" fill="none">
          <path d="M78,112 C96,120 130,120 156,110" />
          <path d="M74,120 C94,128 128,128 152,118" />
        </g>
        {/* spined ridge */}
        <g fill="#c98cff">
          <path d="M66,80 L60,64 L78,76 Z" />
          <path d="M86,72 L80,54 L98,68 Z" />
          <path d="M108,68 L104,48 L120,64 Z" />
          <path d="M130,68 L128,50 L144,66 Z" />
          <path d="M150,74 L150,58 L164,74 Z" />
        </g>
        <path d="M60,84 C78,58 112,46 152,54" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="3.6" strokeLinecap="round" />
      </g>

      <g className="bLegBack">
        <path d="M70,94 C88,90 102,106 100,126 L98,144 L76,144 L78,126 C66,118 62,102 70,94 Z" fill={limb} />
        <path className="bClaws" d="M74,148 L78,140 L82,148 Z M84,148 L88,140 L92,148 Z M94,147 L97,141 L100,147 Z" fill="#ffe9b8" />
      </g>
      <g className="bLegFront bArm">
        <path d="M138,92 C156,88 170,104 168,124 L166,142 L144,142 L146,124 C134,116 130,100 138,92 Z" fill={limb} />
        <path className="bClaws" d="M142,146 L146,138 L150,146 Z M152,146 L156,138 L160,146 Z M162,145 L165,139 L168,145 Z" fill="#ffe9b8" />
      </g>

      {/* the big membrane wing */}
      <g className="bWing">
        <path d="M126,66 C108,42 78,22 48,18 C32,16 24,28 32,40 C44,58 74,78 96,86 C110,91 122,86 128,78 Z" fill="url(#dragon-wing)" />
        <g stroke="#2a1553" strokeOpacity="0.65" strokeWidth="2" fill="none">
          <path d="M50,20 C68,38 90,60 118,76" />
          <path d="M36,26 C54,46 78,66 104,82" />
          <path d="M29,36 C47,54 68,72 92,84" />
        </g>
        {/* wing fingers */}
        <g fill="#8d5ae0">
          <path d="M50,18 L40,10 L60,22 Z" />
          <path d="M33,25 L21,18 L43,32 Z" />
          <path d="M27,38 L16,36 L37,47 Z" />
        </g>
      </g>

      <g className="bHead">
        <path d="M148,54 C156,38 176,30 192,36 L198,72 C180,80 156,72 148,60 Z" fill={coat} />
        {/* angular reptilian skull */}
        <path d="M164,38 C178,26 202,28 212,42 C220,53 218,70 206,78 C192,87 170,84 162,70 C156,60 157,45 164,38 Z" fill={coat} />
        {/* swept horns */}
        <path d="M172,32 C166,16 172,6 180,12 C187,18 186,30 182,38 Z" fill="#e8d2ff" />
        <path d="M186,30 C182,16 189,8 195,14 C200,20 198,30 194,36 Z" fill="#cfb0f5" />
        {/* jaw and snout */}
        <path d="M204,54 C220,50 234,56 234,64 C234,72 220,77 206,75 C196,73 195,57 204,54 Z" fill="#7d4fd6" />
        <path d="M210,70 C222,70 232,68 234,65 C234,73 222,79 210,78 C204,78 205,73 210,70 Z" fill="#4f2b9c" />
        <g fill="#fff3d6">
          <path d="M212,69 L215,76 L218,69 Z" />
          <path d="M222,68 L225,74 L228,68 Z" />
          <path d="M216,70 L219,64 L222,70 Z" />
        </g>
        {/* ember breath glow at the jaw — the fantasy tell */}
        <circle className="bEmber" cx="232" cy="70" r="11" fill="url(#dragon-ember)" opacity="0.85" />
        <path d="M166,44 C176,36 192,36 200,42" fill="none" stroke="#4a2a8f" strokeOpacity="0.55" strokeWidth="2.2" strokeLinecap="round" />
        {/* slit pupil, lit from within */}
        <g transform="translate(186 52)">
          <ellipse rx="6.4" ry="4.6" fill="#2a1553" />
          <ellipse rx="5" ry="3.4" fill="#ffb951" />
          <ellipse rx="1.5" ry="3" fill="#2a1006" />
          <circle cx="-1.6" cy="-1.2" r="1.1" fill="#fff" opacity="0.9" />
        </g>
        {/* frill spikes */}
        <g fill="#c98cff">
          <path d="M162,58 L148,56 L162,66 Z" />
          <path d="M160,70 L146,72 L162,78 Z" />
        </g>
      </g>
    </svg>
  );
}

/* --------------------------------- export -------------------------------- */

export default function AnimalArt({ id }) {
  if (id === "gorilla") return <GorillaFighter />;
  if (id === "eagle") return <EagleFighter />;
  if (id === "elephant") return <ElephantFighter />;
  if (id === "crocodile") return <CrocodileFighter />;
  if (id === "rhino") return <RhinoFighter />;
  if (id === "dragon") return <DragonFighter />;
  return <CatFighter id={id} />; // lion, tiger, wolf, cheetah
}
