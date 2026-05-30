'use strict';

const GitHub = (() => {
  const TOKEN_KEY = 'gh_pat';

  function cfg() { return window.APP_CONFIG || {}; }
  function owner()  { return cfg().github_owner  || 'josh-sea'; }
  function repo()   { return cfg().github_repo   || 'playball'; }
  function dir()    { return cfg().playlists_dir  || 'playlists'; }
  function branch() { return cfg().playlists_branch || 'main'; }

  function getToken()       { return localStorage.getItem(TOKEN_KEY); }
  function saveToken(t)     { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken()     { localStorage.removeItem(TOKEN_KEY); }
  function hasToken()       { return !!getToken(); }

  async function call(path, opts = {}) {
    const tok = getToken();
    if (!tok) throw new Error('No GitHub token');
    const res = await fetch('https://api.github.com' + path, {
      ...opts,
      headers: {
        Authorization:        'Bearer ' + tok,
        Accept:               'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type':       'application/json',
        ...(opts.headers || {}),
      },
    });
    if (res.status === 404) return null;
    if (res.status === 204) return null;
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || 'GitHub API ' + res.status);
    }
    return res.json();
  }

  async function verifyToken() {
    const d = await call('/user');
    return d?.login || null;
  }

  // Returns [{name, path, sha}]
  async function listPlaylists(spotifyUserId) {
    const safeid = _safe(spotifyUserId);
    const data = await call(`/repos/${owner()}/${repo()}/contents/${dir()}/${safeid}`);
    if (!Array.isArray(data)) return [];
    return data
      .filter(f => f.type === 'file' && f.name.endsWith('.json'))
      .map(f => ({ name: f.name.replace(/\.json$/, ''), path: f.path, sha: f.sha }));
  }

  // Returns { playlist, sha }
  async function loadPlaylist(filePath) {
    const data = await call(`/repos/${owner()}/${repo()}/contents/${filePath}`);
    if (!data) return null;
    const json = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
    return { playlist: JSON.parse(json), sha: data.sha };
  }

  async function savePlaylist(spotifyUserId, playlistName, playlistData) {
    const safeid  = _safe(spotifyUserId);
    const safenm  = _safe(playlistName, true);
    const path    = `${dir()}/${safeid}/${safenm}.json`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(playlistData, null, 2))));

    const existing = await call(`/repos/${owner()}/${repo()}/contents/${path}`);
    const body = {
      message: `Update playlist: ${playlistName}`,
      content,
      branch: branch(),
    };
    if (existing?.sha) body.sha = existing.sha;

    await call(`/repos/${owner()}/${repo()}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return path;
  }

  async function deletePlaylist(filePath, sha) {
    await call(`/repos/${owner()}/${repo()}/contents/${filePath}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: 'Delete playlist', sha, branch: branch() }),
    });
  }

  function _safe(str, allowSpaces = false) {
    return (str || 'unknown')
      .replace(/[^a-z0-9_\- ]/gi, '_')
      .replace(allowSpaces ? / /g : / /g, '_')
      .toLowerCase();
  }

  return { getToken, saveToken, clearToken, hasToken, verifyToken, listPlaylists, loadPlaylist, savePlaylist, deletePlaylist };
})();
