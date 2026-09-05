import { lazy, Suspense, useRef, useState } from "react";
import "./App.css";
// Beast Battle Arena, Kianimation Football League and Metro City Bus are
// unlisted for now. Their source still lives in src/components/ — re-import
// them here, restore their cards in the games grid and their mounts below to
// bring them back. Metro City Bus is `./components/BusSimulator`, and its
// models are already in public/models.

/* Endless Rush is a whole game — renderer, world generator, audio — and
   it adds about 26 kB gzipped to the bundle. Nobody needs any of that
   until they press Play, so it is fetched on demand: the landing page
   stays exactly as light as it was before the game existed. */
const EndlessRush = lazy(() => import("./components/EndlessRush"));

/* Neon Space Shooter is a 2D canvas arcade shooter — engine, renderer
   and synth audio — and none of it is needed until the player presses
   Play, so it is fetched on demand like the others. */
const NeonSpaceShooter = lazy(() => import("./components/NeonSpaceShooter"));

/* Castle Defender is a full defence game — engine, painted renderer,
   synth music, campaign save — and is fetched only when opened. */
const CastleDefender = lazy(() => import("./components/CastleDefender"));

const videos = [
  {
    title: "Lion vs Dragon Part 1",
    description:
      "A fearless lion enters a forbidden realm and comes face to face with an ancient dragon.",
    src: "https://www.youtube.com/embed/ekvgU9epbnA?si=TKivt22T0PrGakWU",
    label: "Chapter 01",
    accent: "gold",
  },
  {
    title: "Alien Visits Accra",
    description:
      "A mysterious visitor arrives in Accra and turns a familiar city into a surreal adventure.",
    src: "https://www.youtube.com/embed/QYD6e6EEsoE?si=3LT7hJNa7YKq5BJ9",
    label: "Featured",
    accent: "gold",
  },
];

function VideoCard({ video }) {
  const player = useRef(null);
  const [videoReady, setVideoReady] = useState(Boolean(video.src));

  const playPreview = () => {
    player.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <article className={`videoCard videoCard--${video.accent}`}>
      <div className="videoFrame">
        {video.src ? (
          <iframe
            ref={player}
            src={video.src}
            title={`${video.title} video preview`}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="youtubeEmbed"
          />
        ) : (
          <div className="comingSoonVisual" aria-hidden="true">
            <span className="cloche">♨</span>
          </div>
        )}

        <span className="episodeLabel">{video.label}</span>
        {!videoReady && video.src && (
          <div className="missingVideo">
            <span className="playIcon">▶</span>
            <small>Video unavailable</small>
          </div>
        )}
      </div>

      <div className="cardContent">
        <h3>{video.title}</h3>
        <p>{video.description}</p>
        {video.src ? (
          <button type="button" onClick={playPreview} disabled={!videoReady}>
            {videoReady ? "Watch preview" : "Video unavailable"}
          </button>
        ) : (
          <span className="placeholderButton" aria-label="Video coming soon">
            In production
          </span>
        )}
      </div>
    </article>
  );
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [rushOpen, setRushOpen] = useState(false);
  const [shooterOpen, setShooterOpen] = useState(false);
  const [castleOpen, setCastleOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app">
      <header className="navbar">
        <a className="brand" href="#home" onClick={closeMenu}>
          <span className="brandMark">KS</span>
          <span>kianimationstudios</span>
        </a>

        <button
          className="menuButton"
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          aria-controls="main-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
        </button>

        <nav id="main-navigation" className={menuOpen ? "navOpen" : ""}>
          <a href="#home" onClick={closeMenu}>Home</a>
          <a href="#videos" onClick={closeMenu}>Videos</a>
          <a href="#games" onClick={closeMenu}>Games</a>
          <a href="#about" onClick={closeMenu}>About</a>
          <a className="navCta" href="#social" onClick={closeMenu}>Follow</a>
        </nav>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="heroGlow" aria-hidden="true" />
          <div className="heroContent">
            <p className="eyebrow"><span /> Original AI mini movies</p>
            <h1>AI Stories<br /><em>Come Alive</em></h1>
            <p className="heroText">
              Enter a world of impossible creatures, legendary battles and
              unexpected comedy—imagined with AI and told one frame at a time.
            </p>
            <div className="heroActions">
              <a className="mainButton" href="#videos"><span>▶</span> Watch stories</a>
              <a className="textButton" href="#about">Discover the world <span>↘</span></a>
            </div>
          </div>
          <div className="scrollCue" aria-hidden="true"><span /> Scroll to explore</div>
        </section>

        <section className="videosSection" id="videos">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">Now showing</p>
              <h2>Stories from another world</h2>
            </div>
            <p>Short cinematic adventures created through imagination, artificial intelligence and a love of storytelling.</p>
          </div>

          <div className="videoGrid">
            {videos.map((video) => <VideoCard video={video} key={video.title} />)}
          </div>
          <p className="videoHint">
            MP4 setup: place your finished files in <code>public/videos</code> using the filenames configured for each preview.
          </p>
        </section>

        <section className="gamesSection" id="games">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">Play games</p>
              <h2>Step into the arena</h2>
            </div>
            <p>Playable browser games built around the creatures of kianimationstudio. No download, no sign up—just pick a game and go.</p>
          </div>

          <div className="gameGrid">
            <article className="gameCard">
              <div className="gameArt gameArt--rush" aria-hidden="true">
                <span className="rushSky" />
                <span className="rushSun" />
                <span className="rushTower rushTower--l1" />
                <span className="rushTower rushTower--l2" />
                <span className="rushTower rushTower--r1" />
                <span className="rushTower rushTower--r2" />
                <span className="rushRoad" />
                <span className="rushKerb" />
                <span className="rushDash rushDash--l1" />
                <span className="rushDash rushDash--l2" />
                <span className="rushDash rushDash--l3" />
                <span className="rushDash rushDash--r1" />
                <span className="rushDash rushDash--r2" />
                <span className="rushDash rushDash--r3" />
                <span className="rushCoin rushCoin--1" />
                <span className="rushCoin rushCoin--2" />
                <span className="rushCoin rushCoin--3" />
                <span className="rushShadow" />
                <span className="rushRunner">
                  <span className="rushHead" />
                  <span className="rushArm" />
                  <span className="rushLeg rushLeg--l" />
                  <span className="rushLeg rushLeg--r" />
                </span>
                <span className="episodeLabel">Game 04</span>
              </div>
              <div className="cardContent">
                <h3>Kianimation Endless Rush</h3>
                <p>
                  Sprint through five worlds that never stop coming —
                  downtown, the market district, the greenbelt, a mountain
                  pass and the night city. Dodge, jump, slide, and throw a
                  punch when the street gets crowded. Spend your coins on a
                  bicycle, a hoverboard or winged jet shoes, then grab a
                  jetpack and take the run up onto the rooftops.
                </p>
                <div className="gameTags">
                  <span>Endless runner</span>
                  <span>4 characters</span>
                  <span>Character shop</span>
                  <span>Jetpack + rooftops</span>
                  <span>Arcade combat</span>
                  <span>Power-ups</span>
                  <span>Swipe + keyboard</span>
                </div>
                <button type="button" onClick={() => setRushOpen((open) => !open)}>
                  {rushOpen ? "Close game" : "Play now"}
                </button>
              </div>
            </article>
            <article className="gameCard">
              <div className="gameArt gameArt--shooter" aria-hidden="true">
                <span className="shooterStars shooterStars--far" />
                <span className="shooterStars shooterStars--near" />
                <span className="shooterNebula" />
                <span className="shooterPlanet" />
                <span className="shooterEnemy shooterEnemy--1" />
                <span className="shooterEnemy shooterEnemy--2" />
                <span className="shooterEnemy shooterEnemy--3" />
                <span className="shooterLaser shooterLaser--1" />
                <span className="shooterLaser shooterLaser--2" />
                <span className="shooterBurst" />
                <span className="shooterShip">
                  <span className="shooterWing shooterWing--l" />
                  <span className="shooterWing shooterWing--r" />
                  <span className="shooterCockpit" />
                  <span className="shooterFlame" />
                </span>
                <span className="episodeLabel">Game 05</span>
              </div>
              <div className="cardContent">
                <h3>Neon Space Shooter</h3>
                <p>
                  Blast through waves of neon enemies, upgrade your weapons,
                  collect energy crystals and defeat powerful space bosses.
                </p>
                <div className="gameTags">
                  <span>2D arcade shooter</span>
                  <span>Auto-fire</span>
                  <span>7 power-ups</span>
                  <span>Weapon levels</span>
                  <span>Boss battles</span>
                  <span>Combos + crystals</span>
                  <span>Touch + keyboard</span>
                </div>
                <button type="button" onClick={() => setShooterOpen((open) => !open)}>
                  {shooterOpen ? "Close game" : "Play now"}
                </button>
              </div>
            </article>
            <article className="gameCard">
              <div className="gameArt gameArt--castle" aria-hidden="true">
                <span className="castleSky" />
                <span className="castleSun" />
                <span className="castleHill castleHill--far" />
                <span className="castleHill castleHill--near" />
                <span className="castleKeep" />
                <span className="castleTower castleTower--l" />
                <span className="castleTower castleTower--r" />
                <span className="castleWall" />
                <span className="castleGate" />
                <span className="castleFlag" />
                <span className="castleRoad" />
                <span className="castleTree castleTree--1" />
                <span className="castleTree castleTree--2" />
                <span className="castleKnight" />
                <span className="castleArrow castleArrow--1" />
                <span className="castleArrow castleArrow--2" />
                <span className="episodeLabel">Game 06</span>
              </div>
              <div className="cardContent">
                <h3>Castle Defender</h3>
                <p>
                  Hold the Realm of Ashford against the Blackmoor Warband.
                  Build archer towers, barracks, ballistas and catapults on a
                  painted battlefield, command Sir Edric and his Royal Charge,
                  and survive eight waves and a battering ram to earn three
                  stars. A historical-fantasy defence campaign, with more
                  kingdoms on the way.
                </p>
                <div className="gameTags">
                  <span>Castle defence</span>
                  <span>4 towers × 4 levels</span>
                  <span>Knight hero</span>
                  <span>Waves + mini-boss</span>
                  <span>Stars + endless</span>
                  <span>Original music</span>
                  <span>Touch + keyboard</span>
                </div>
                <button type="button" onClick={() => setCastleOpen((open) => !open)}>
                  {castleOpen ? "Close game" : "Play now"}
                </button>
              </div>
            </article>
          </div>

          {rushOpen && (
            <div className="gameStageWrap">
              <Suspense fallback={<div className="gameLoading">Loading Endless Rush…</div>}>
                <EndlessRush />
              </Suspense>
            </div>
          )}

          {shooterOpen && (
            <div className="gameStageWrap">
              <Suspense fallback={<div className="gameLoading">Loading Neon Space Shooter…</div>}>
                <NeonSpaceShooter />
              </Suspense>
            </div>
          )}

          {castleOpen && (
            <div className="gameStageWrap gameStageWrap--castle">
              <Suspense fallback={<div className="gameLoading">Raising the banners…</div>}>
                <CastleDefender />
              </Suspense>
            </div>
          )}
        </section>

        <section className="about" id="about">
          <div className="aboutArtwork" aria-hidden="true">
            <span className="orbit orbitOne" />
            <span className="orbit orbitTwo" />
            <span className="aboutMonogram">AI</span>
          </div>
          <div className="aboutContent">
            <p className="eyebrow">Behind the stories</p>
            <h2>Imagination has no limits.</h2>
            <p>I create AI-generated mini movies that blend cinematic visuals with original storytelling. From fantasy adventures and animal heroes to absurd comedy, every story begins with one simple question: <strong>what if?</strong></p>
            <div className="aboutStats">
              <div><strong>Fantasy</strong><span>Epic worlds</span></div>
              <div><strong>Comedy</strong><span>Wild moments</span></div>
              <div><strong>AI Film</strong><span>New possibilities</span></div>
            </div>
          </div>
        </section>

        <section className="social" id="social">
          <p className="eyebrow">The story continues</p>
          <h2>Follow the adventure.</h2>
          <p>New scenes, behind-the-scenes moments and AI stories are coming to TikTok.</p>
          <a className="tiktokButton" href="https://www.tiktok.com/@kianimation.studio" target="_blank" rel="noreferrer">
            <span>♪</span> Follow on TikTok
          </a>
        </section>
      </main>

      <footer>
        <a className="brand footerBrand" href="#home"><span className="brandMark">KS</span><span>kianimationstudio</span></a>
        <p>Original worlds. Artificial intelligence. Human imagination.</p>
        <p>© 2026 kianimationstudio</p>
      </footer>
    </div>
  );
}

export default App;
