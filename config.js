// ─── Site Configuration ──────────────────────────────────────────────────────
// 1. Create a Spotify app at https://developer.spotify.com/dashboard
// 2. Add your GitHub Pages URL as a Redirect URI:
//    https://josh-sea.github.io/playball
// 3. Client ID is set below (no secret needed — this app uses PKCE).

window.APP_CONFIG = {
  spotify_client_id: '9f589e7d793d4fd9bfe87cc9ab753cb1',
  github_owner: 'josh-sea',
  github_repo: 'playball',
  playlists_dir: 'playlists',
  playlists_branch: 'main',
};
