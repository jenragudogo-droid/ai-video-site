/* ------------------------------------------------------------------ *
 * Kianimation Endless Rush — optional glTF character layer.
 *
 * The game ships with the procedural runner in runner.js and needs
 * nothing else. This module is the seam for swapping in a real
 * character — a Meshy export, a Mixamo rig, anything glTF:
 *
 *     1. Export your character as `runner.glb`, facing +Z, standing on
 *        the origin, roughly 1.75 units tall (the game will rescale it
 *        to that height anyway, so exact scale is not critical).
 *     2. Drop it in `public/models/`.
 *     3. Reload. That is the whole procedure.
 *
 * It follows the same pattern as the Bus Simulator's vehicle layer: the
 * world stays on the software renderer, and only the character is drawn
 * by three.js into an offscreen WebGL canvas whose camera is matched to
 * the software camera exactly. The result is composited into the 2D
 * canvas as one sprite, at the runner's own depth, so it sorts correctly
 * against obstacles in front of and behind it.
 *
 * Every step here is optional and every failure is silent. No file, no
 * WebGL, a corrupt model, a browser that refuses the dynamic import —
 * all of them end with `ready` staying false and the procedural runner
 * carrying on as though this file did not exist. three.js is imported
 * dynamically so the home page never downloads it for a game nobody has
 * opened yet.
 * ------------------------------------------------------------------ */

/* ── The switch ───────────────────────────────────────────────────────
   Flip this to true once `runner.glb` is sitting in `public/models/`.
   It is opt-in rather than automatic so that the shipped game never
   fires a request for a file that is not there — a 404 in the console
   on every visit is a poor greeting on a public site.
   Everything downstream is still defensive: with the switch on and no
   usable model, three.js is never even imported and the procedural
   runner carries on. */
const USE_GLB_CHARACTER = false;

const MODEL_FILE = "models/runner.glb";
const TARGET_HEIGHT = 1.78;

const base = () => (typeof import.meta.env !== "undefined" ? import.meta.env.BASE_URL : "/");

/* Clip names are matched loosely, because every exporter names them
   differently: "Run", "running", "Armature|Run", "mixamo.com" and so on. */
const CLIP_HINTS = {
  run: ["run", "sprint", "jog"],
  jump: ["jump", "leap", "air"],
  slide: ["slide", "roll", "crouch", "duck"],
  idle: ["idle", "stand"],
};

function matchClip(clips, kind) {
  const hints = CLIP_HINTS[kind] || [];
  for (const hint of hints) {
    const found = clips.find((c) => c.name.toLowerCase().includes(hint));
    if (found) return found;
  }
  return null;
}

/** Cheap existence check, so a missing model never pulls in three.js. */
async function modelExists(url) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "force-cache" });
    if (res.ok) {
      const type = res.headers.get("content-type") || "";
      // a dev server that rewrites unknown paths to index.html would 200 here
      return !type.includes("text/html");
    }
    return false;
  } catch {
    return false;
  }
}

export function createCharacter({ onReady, onError } = {}) {
  let THREE = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let pivot = null;
  let mixer = null;
  let actions = null;
  let current = null;
  let disposed = false;
  let ready = false;
  let W = 0, H = 0, dpr = 1;

  const url = `${base()}${MODEL_FILE}`;

  async function boot() {
    if (!USE_GLB_CHARACTER) return;
    if (!await modelExists(url)) {
      onError?.("no runner.glb — using the built-in runner");
      return;
    }
    let GLTFLoader;
    try {
      const [three, loaderMod] = await Promise.all([
        import("three"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
      ]);
      THREE = three;
      GLTFLoader = loaderMod.GLTFLoader;
    } catch (e) {
      onError?.(`three.js unavailable: ${e?.message || e}`);
      return;
    }
    if (disposed) return;

    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
      renderer.setClearAlpha(0);
    } catch (e) {
      onError?.(`no WebGL: ${e?.message || e}`);
      return;
    }

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.2, 400);

    const key = new THREE.DirectionalLight(0xfff2dd, 2.1);
    key.position.set(-3, 6, -3);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xbcd4e8, 0x37302a, 1.15));

    pivot = new THREE.Group();
    scene.add(pivot);

    const loader = new GLTFLoader();
    loader.load(url, (gltf) => {
      if (disposed) return;
      const model = gltf.scene;

      // normalise: drop it on the origin and scale to the game's height
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = size.y > 0.01 ? TARGET_HEIGHT / size.y : 1;
      model.scale.setScalar(scale);
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y -= box2.min.y;
      model.position.x -= (box2.min.x + box2.max.x) * 0.5;
      model.position.z -= (box2.min.z + box2.max.z) * 0.5;

      pivot.add(model);

      if (gltf.animations?.length) {
        mixer = new THREE.AnimationMixer(model);
        actions = {};
        for (const kind of ["run", "jump", "slide", "idle"]) {
          const clip = matchClip(gltf.animations, kind);
          if (clip) actions[kind] = mixer.clipAction(clip);
        }
        if (!actions.run) actions.run = mixer.clipAction(gltf.animations[0]);
        current = actions.run;
        current?.play();
      }

      ready = true;
      onReady?.();
    }, undefined, (e) => {
      onError?.(`runner.glb failed to load: ${e?.message || e}`);
    });
  }

  boot();

  function crossFade(next, dur) {
    if (!actions || !next || next === current) return;
    next.reset().play();
    if (current) current.crossFadeTo(next, dur, false);
    current = next;
  }

  return {
    get ready() { return ready && !!renderer; },
    get canvas() { return renderer?.domElement || null; },

    setSize(w, h, ratio) {
      W = w; H = h; dpr = Math.min(ratio || 1, 1.75);
      if (renderer) {
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
      }
      if (camera) {
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
      }
    },

    /**
     * Matches the software camera, poses the character and renders one
     * frame. Returns false when it could not draw, which tells runner.js
     * to fall back to the procedural rig for this frame.
     */
    draw(r, pose, ev, tint) {
      if (!ready || !renderer || !scene || !camera || !THREE) return false;
      if (!W || !H) return false;

      // fov must track the software renderer, which changes it by aspect
      const fovY = 2 * Math.atan(H * 0.5 / r.focal) * (180 / Math.PI);
      if (Math.abs(camera.fov - fovY) > 0.01) {
        camera.fov = fovY;
        camera.updateProjectionMatrix();
      }

      const cam = r.cam;
      camera.position.set(cam.x, cam.y, cam.z);
      camera.rotation.set(0, 0, 0);
      camera.rotateY(Math.PI - cam.yaw);   // software +Z forward → three −Z forward
      camera.rotateX(cam.pitch);
      camera.rotateZ(-cam.roll);

      const dt = Math.min(0.05, ev.dt || 0.016);
      if (mixer) {
        if (actions) {
          const want = pose.sliding ? (actions.slide || actions.run)
            : pose.airborne ? (actions.jump || actions.run)
              : actions.run;
          crossFade(want, 0.14);
        }
        mixer.timeScale = Math.max(0.4, pose.speed / 9);
        mixer.update(dt);
      }

      // world placement, matching the procedural rig exactly
      pivot.position.set(pose.wx, pose.wy, pose.wz);
      pivot.rotation.set(
        mixer ? 0 : -ev.slide * 1.2,
        Math.PI + pose.lean * 0.2,
        -pose.lean * 0.3,
      );
      if (!mixer) {
        // static mesh: fake a run cycle with a bob so it is not frozen
        pivot.position.y += Math.abs(Math.sin(pose.phase)) * 0.06;
      }

      scene.traverse?.((o) => { if (o.isLight) o.intensity = o.isDirectionalLight ? 2.1 * tint : 1.15 * tint; });

      renderer.render(scene, camera);

      r.custom(pose.wx, pose.wy + 0.9, pose.wz, (ctx) => {
        const c = renderer.domElement;
        if (c.width && c.height) ctx.drawImage(c, 0, 0, W, H);
      }, null);
      return true;
    },

    dispose() {
      disposed = true;
      ready = false;
      try { renderer?.dispose(); } catch { /* already gone */ }
      renderer = null;
      scene = null;
      camera = null;
      mixer = null;
      actions = null;
    },
  };
}
