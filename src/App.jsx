import { useRef, useState } from "react";
import "./App.css";

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
    title: "Lion vs Dragon Part 2",
    description:
      "Former enemies become unlikely allies when a darker force threatens their world.",
    src: "https://www.youtube.com/embed/nEiQ5ERGzWs?si=CwFBCA99y-fu0aju",
    label: "Chapter 02",
    accent: "violet",
  },
  {
    title: "Funny Lion Restaurant",
    description:
      "A very serious lion walks into a fancy restaurant and orders dinner like a human. What could possibly go wrong?",
    src: "https://www.youtube.com/embed/Sv_tlCpX9Ec?si=tj9y9Ep_qVTCykX0",
    label: "Comedy",
    accent: "blue",
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
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app">
      <header className="navbar">
        <a className="brand" href="#home" onClick={closeMenu}>
          <span className="brandMark">AI</span>
          <span>Story World</span>
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
        <a className="brand footerBrand" href="#home"><span className="brandMark">AI</span><span>Story World</span></a>
        <p>Original worlds. Artificial intelligence. Human imagination.</p>
        <p>© 2026 AI Story World</p>
      </footer>
    </div>
  );
}

export default App;
