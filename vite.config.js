import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Served from the custom domain root (https://kianimationstudio.com),
  // not from a /<repo-name>/ subpath.
  base: '/',
  plugins: [react()],

  /* ------------------------------------------------------------------ *
   * Local network testing
   *
   * `host: true` binds the dev server to every interface on this machine
   * instead of loopback only, so http://localhost:5173 keeps working AND
   * phones and tablets on the same Wi-Fi can reach it at the Mac's LAN
   * address. Vite prints both URLs on startup, so `npm run dev` alone is
   * enough — no `--host` flag needed.
   *
   * A LAN address (192.168.x.x / 10.x.x.x / 172.16-31.x.x) is private and
   * not routable from the internet: only devices on the same router can
   * reach it, and nothing here opens a port to the outside world.
   *
   * `strictPort` makes a clash fail loudly rather than quietly moving to
   * 5174, which would silently invalidate the URL typed into the tablet.
   *
   * To go back to loopback-only for one run — worth doing on public
   * Wi-Fi — use `npm run dev -- --host localhost`.
   * ------------------------------------------------------------------ */
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Vite rejects unknown Host headers, which is what stops a stranger's
    // domain being pointed at this machine. Bare IPs and localhost are
    // always allowed; this line additionally lets the tablet use the Mac's
    // Bonjour name, e.g. http://Jerrys-MacBook-Air.local:5173
    allowedHosts: ['.local'],
  },

  // Same treatment for `npm run preview`, which serves the real production
  // build — useful for checking the game the way GitHub Pages will serve it.
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    allowedHosts: ['.local'],
  },
})
