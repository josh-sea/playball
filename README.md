# Timed Playlist Editor

A GitHub Pages web app that lets anyone log into their Spotify account, search songs, and build playlists where each track plays from a specific **start time** to a specific **stop time**. Playlists are saved as JSON files in this repo under `playlists/{spotify-user-id}/`.

## Live site

`https://josh-sea.github.io/playball`

---

## One-time setup (repo owner)

### 1. Create a Spotify app

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app.
2. In the app settings, add this **Redirect URI** exactly:
   ```
   https://josh-sea.github.io/playball
   ```
3. Copy your **Client ID**.

### 2. Edit `config.js`

Open `config.js` and paste your Client ID:

```js
window.APP_CONFIG = {
  spotify_client_id: 'abc123...your-id-here',
  // other fields are fine as-is
};
```

Commit and push to `main` — GitHub Actions will redeploy automatically.

### 3. Enable GitHub Pages

In the repo **Settings → Pages**:
- Source: **GitHub Actions**

The `deploy.yml` workflow handles the rest.

---

## How it works for users

1. **Connect Spotify** — PKCE OAuth, no backend needed. Requires Spotify Premium for in-browser playback.
2. **(Optional) Add a GitHub token** — paste a [fine-grained PAT](https://github.com/settings/tokens) with `Contents: Read & Write` on this repo to save playlists. Without a token, you can still build and play playlists in the session.
3. **Search** songs in the header bar and click **Add** to add them to the current playlist.
4. **Set start / end times** — each track row has a `Start` and `End` field in `M:SS` format.
5. **Play All** plays every track from its start to its end time, then auto-advances.
6. **Save to Repo** commits the playlist JSON to `playlists/{your-spotify-id}/{playlist-name}.json` on the `main` branch.

---

## Playlist file format

```json
{
  "name": "Morning Run",
  "owner": "spotify_user_id",
  "created": "2024-01-01T00:00:00.000Z",
  "updated": "2024-01-02T00:00:00.000Z",
  "tracks": [
    {
      "id": "spotify_track_id",
      "name": "Track Name",
      "artist": "Artist",
      "album": "Album",
      "image": "https://...",
      "duration_ms": 240000,
      "start_ms": 30000,
      "end_ms": 90000
    }
  ]
}
```

---

## Notes

- **Spotify Premium** is required for the Web Playback SDK (in-browser audio). Free accounts can still build and export playlists but cannot play them.
- GitHub tokens are stored only in your browser's `localStorage` — they are never sent anywhere except the GitHub API.
- All saved playlist data is **public** in this repo (as intended).
