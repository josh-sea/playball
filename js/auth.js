'use strict';

const SpotifyAuth = (() => {
  const KEYS = {
    token:    'sp_access_token',
    refresh:  'sp_refresh_token',
    expires:  'sp_expires_at',
    verifier: 'sp_code_verifier',
    user:     'sp_user',
    scopes:   'sp_scopes',
  };

  const SCOPES = [
    'streaming',
    'user-read-email',
    'user-read-private',
    'user-read-playback-state',
    'user-modify-playback-state',
    'playlist-read-private',
    'playlist-read-collaborative',
  ].join(' ');

  function clientId() { return window.APP_CONFIG?.spotify_client_id || ''; }

  function redirectUri() {
    const { origin, pathname } = window.location;
    const base = pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
    return origin + base;
  }

  function rand(len) {
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(buf, b => chars[b % chars.length]).join('');
  }

  async function sha256(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  }

  function b64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function login() {
    const verifier  = rand(64);
    const challenge = b64url(await sha256(verifier));
    sessionStorage.setItem(KEYS.verifier, verifier);
    const p = new URLSearchParams({
      client_id: clientId(), response_type: 'code',
      redirect_uri: redirectUri(), scope: SCOPES,
      code_challenge_method: 'S256', code_challenge: challenge,
    });
    window.location.href = 'https://accounts.spotify.com/authorize?' + p;
  }

  async function handleCallback(code) {
    const verifier = sessionStorage.getItem(KEYS.verifier);
    if (!verifier) throw new Error('No PKCE verifier — try logging in again.');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId(), grant_type: 'authorization_code',
        code, redirect_uri: redirectUri(), code_verifier: verifier,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error_description || 'Token exchange failed');
    }
    _storeTokens(await res.json());
    sessionStorage.removeItem(KEYS.verifier);
  }

  async function _refresh() {
    const rt = localStorage.getItem(KEYS.refresh);
    if (!rt) throw new Error('No refresh token');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId(), grant_type: 'refresh_token', refresh_token: rt }),
    });
    if (!res.ok) throw new Error('Token refresh failed — please log in again.');
    const data = await res.json();
    _storeTokens(data);
    return data.access_token;
  }

  function _storeTokens(data) {
    localStorage.setItem(KEYS.token,   data.access_token);
    if (data.refresh_token) localStorage.setItem(KEYS.refresh, data.refresh_token);
    localStorage.setItem(KEYS.expires, String(Date.now() + (data.expires_in - 60) * 1000));
    if (data.scope) localStorage.setItem(KEYS.scopes, data.scope);
  }

  function hasScope(scope) {
    return (localStorage.getItem(KEYS.scopes) || '').split(' ').includes(scope);
  }

  async function getToken() {
    const exp = parseInt(localStorage.getItem(KEYS.expires) || '0');
    if (Date.now() > exp) return _refresh();
    return localStorage.getItem(KEYS.token);
  }

  function isLoggedIn() { return !!localStorage.getItem(KEYS.token); }

  function logout() {
    Object.values(KEYS).forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
  }

  async function getUser() {
    const cached = localStorage.getItem(KEYS.user);
    if (cached) return JSON.parse(cached);
    const u = await apiCall('/me');
    localStorage.setItem(KEYS.user, JSON.stringify(u));
    return u;
  }

  async function apiCall(path, opts = {}) {
    const token = await getToken();
    const res = await fetch('https://api.spotify.com/v1' + path, {
      ...opts,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || 'Spotify API ' + res.status);
    }
    return res.json();
  }

  async function search(q) {
    const d = await apiCall('/search?q=' + encodeURIComponent(q) + '&type=track&limit=10');
    return d.tracks.items;
  }

  async function startPlayback(deviceId, trackId, positionMs) {
    const token = await getToken();
    const res = await fetch('https://api.spotify.com/v1/me/player/play?device_id=' + deviceId, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: ['spotify:track:' + trackId], position_ms: positionMs }),
    });
    if (!res.ok && res.status !== 204) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || 'Playback failed (' + res.status + ')');
    }
  }

  // Returns up to 50 of the user's playlists
  async function getUserPlaylists() {
    const data = await apiCall('/me/playlists?limit=50');
    return data.items || [];
  }

  // Returns track objects for a playlist (up to 100 tracks, filters out local files)
  async function getPlaylistTracks(playlistId) {
    const data = await apiCall(
      `/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100`
    );
    return (data.items || []).map(i => i.track).filter(t => t?.id);
  }

  return { login, handleCallback, getToken, isLoggedIn, logout, getUser,
           search, startPlayback, getUserPlaylists, getPlaylistTracks, apiCall, hasScope };
})();
