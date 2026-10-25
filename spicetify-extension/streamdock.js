// @ts-check
// NAME: StreamDock N3 Spotify Bridge
// AUTHOR: Antigravity
// DESCRIPTION: Local Spicetify extension to connect Spotify with VSDinside Stream Dock N3

(function StreamDockBridge() {
    const BASE_URL = 'http://127.0.0.1:8974';
    
    // Announce script entry immediately
    try {
        fetch(`${BASE_URL}/ping?stage=entry&hasSpicetify=${Boolean(window.Spicetify)}&hasPlayer=${Boolean(window.Spicetify && window.Spicetify.Player)}`, { mode: 'no-cors' }).catch(() => {});
    } catch (e) {}

    if (!window.Spicetify || !Spicetify.Player) {
        setTimeout(StreamDockBridge, 300);
        return;
    }

    try {
        fetch(`${BASE_URL}/ping?stage=ready`, { mode: 'no-cors' }).catch(() => {});
    } catch (e) {}

    console.log('[StreamDock] Spicetify ready. Initializing bridge link...');
    let lastVolume = 0.5;

    function getState() {
        try {
            const p = Spicetify.Player;
            const data = p.data || {};
            const item = data.item || {};

            let isPlaying = false;
            if (typeof p.isPlaying === 'function') {
                isPlaying = p.isPlaying();
            } else if (typeof p.isPlaying === 'boolean') {
                isPlaying = p.isPlaying;
            } else if (data.isPlaying !== undefined) {
                isPlaying = Boolean(data.isPlaying);
            }

            const title = item.name || '';
            const artist = (item.artists && item.artists[0]) ? item.artists[0].name : '';
            const album = (item.album && item.album.name) ? item.album.name : '';
            const volume = typeof p.getVolume === 'function' ? p.getVolume() : 1.0;

            let coverUrl = '';
            if (item.metadata && item.metadata.image_url) {
                coverUrl = item.metadata.image_url;
            } else if (item.album && item.album.images && item.album.images.length > 0) {
                coverUrl = item.album.images[0].url;
            }
            if (coverUrl && coverUrl.startsWith('spotify:image:')) {
                coverUrl = 'https://i.scdn.co/image/' + coverUrl.replace('spotify:image:', '');
            }

            return {
                isPlaying: Boolean(isPlaying),
                title: String(title),
                artist: String(artist),
                album: String(album),
                volume: Number(volume),
                coverUrl: String(coverUrl)
            };
        } catch (e) {
            return { isPlaying: false, title: '', artist: '' };
        }
    }

    function pushState() {
        try {
            fetch(`${BASE_URL}/update-state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getState()),
                mode: 'cors'
            }).catch(() => {});
        } catch (e) {}
    }

    function executeCommand(action, payload = {}) {
        const p = Spicetify.Player;
        const act = (action || '').toLowerCase();
        console.log(`[StreamDock] Executing action: ${act}`, payload);

        try {
            switch (act) {
                case 'playpause':
                case 'toggle':
                    if (typeof p.playPause === 'function') {
                        p.playPause();
                    } else if (typeof p.togglePlay === 'function') {
                        p.togglePlay();
                    } else if (p.isPlaying && p.isPlaying()) {
                        p.pause();
                    } else {
                        p.play();
                    }
                    break;

                case 'play':
                    if (typeof p.play === 'function') p.play();
                    break;

                case 'pause':
                    if (typeof p.pause === 'function') p.pause();
                    break;

                case 'next':
                case 'skip':
                    if (typeof p.next === 'function') p.next();
                    break;

                case 'previous':
                case 'prev':
                case 'back':
                    if (typeof p.back === 'function') {
                        p.back();
                    } else if (typeof p.previous === 'function') {
                        p.previous();
                    }
                    break;

                case 'volume_delta':
                    if (typeof p.getVolume === 'function' && typeof p.setVolume === 'function') {
                        const cur = p.getVolume();
                        const delta = Number(payload.delta) || 0;
                        p.setVolume(Math.max(0, Math.min(1, cur + delta)));
                    }
                    break;

                case 'volume_set':
                    if (typeof p.setVolume === 'function' && payload.value !== undefined) {
                        p.setVolume(Math.max(0, Math.min(1, Number(payload.value))));
                    }
                    break;

                case 'mute':
                    if (typeof p.getVolume === 'function' && typeof p.setVolume === 'function') {
                        const cur = p.getVolume();
                        if (cur > 0.01) {
                            lastVolume = cur;
                            p.setVolume(0);
                        } else {
                            p.setVolume(lastVolume || 0.5);
                        }
                    }
                    break;

                case 'like':
                    if (typeof p.toggleHeart === 'function') p.toggleHeart();
                    break;

                case 'play_uri':
                case 'playuri':
                case 'play_playlist':
                case 'playplaylist':
                    let targetUri = payload.uri || payload.url || '';
                    if (targetUri.includes('open.spotify.com/playlist/')) {
                        const m = targetUri.match(/playlist\/([a-zA-Z0-9]+)/);
                        if (m) targetUri = 'spotify:playlist:' + m[1];
                    } else if (targetUri.includes('open.spotify.com/album/')) {
                        const m = targetUri.match(/album\/([a-zA-Z0-9]+)/);
                        if (m) targetUri = 'spotify:album:' + m[1];
                    }
                    logRemote('Playing playlist URI', targetUri);
                    if (targetUri) {
                        try {
                            if (typeof p.playUri === 'function') {
                                p.playUri(targetUri);
                            } else if (Spicetify.Platform && Spicetify.Platform.PlayerAPI && Spicetify.Platform.PlayerAPI.play) {
                                Spicetify.Platform.PlayerAPI.play({ uri: targetUri }, { context_uri: targetUri }, {});
                            }
                        } catch (e) {
                            logRemote('playUri error', e.message);
                        }
                    }
                    break;

                case 'get_state':
                case 'sync_state':
                    pushState();
                    break;

                case 'get_playlists':
                case 'refresh_playlists':
                    pushPlaylists();
                    break;

                default:
                    break;
            }
        } catch (err) {
            console.error('[StreamDock] Command execution error:', err);
        }

        setTimeout(pushState, 100);
        setTimeout(pushState, 400);
    }

    let isPolling = false;
    async function poll() {
        if (isPolling) return;
        isPolling = true;

        try {
            const resp = await fetch(`${BASE_URL}/poll`, {
                cache: 'no-store',
                mode: 'cors'
            });

            if (resp.ok) {
                const data = await resp.json();
                if (data && data.action && data.action !== 'noop') {
                    executeCommand(data.action, data);
                }
            }
        } catch (err) {
            // Wait 2s before retry if bridge server is currently down
            await new Promise(res => setTimeout(res, 2000));
        } finally {
            isPolling = false;
            poll();
        }
    }

    function logRemote(msg, data) {
        try {
            fetch(`${BASE_URL}/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ msg, data }),
                mode: 'cors'
            }).catch(() => {});
        } catch (e) {}
    }

    async function pushPlaylists() {
        try {
            let playlists = [];
            const extract = (items) => {
                let list = [];
                if (!Array.isArray(items)) return list;
                for (const it of items) {
                    if (it.type === 'playlist' || (it.uri && it.uri.includes('playlist'))) {
                        let img = (it.images && it.images[0]) ? (it.images[0].url || '') : '';
                        if (img.startsWith('spotify:mosaic:')) {
                            img = 'https://mosaic.scdn.co/300/' + img.replace('spotify:mosaic:', '').replace(/:/g, '');
                        } else if (img.startsWith('spotify:image:')) {
                            img = 'https://i.scdn.co/image/' + img.replace('spotify:image:', '');
                        }
                        list.push({
                            uri: it.uri,
                            name: it.name,
                            image: img
                        });
                    } else if (it.type === 'folder' && it.items) {
                        list = list.concat(extract(it.items));
                    }
                }
                return list;
            };

            // 1. Try RootlistAPI
            if (Spicetify.Platform && Spicetify.Platform.RootlistAPI && typeof Spicetify.Platform.RootlistAPI.getContents === 'function') {
                try {
                    const res = await Spicetify.Platform.RootlistAPI.getContents();
                    logRemote('RootlistAPI result keys', { keys: res ? Object.keys(res) : null, raw: res ? JSON.stringify(res).slice(0, 500) : null });
                    if (res && res.items) {
                        playlists = extract(res.items);
                    }
                } catch (e) {
                    logRemote('RootlistAPI error', e.message);
                }
            }

            // 2. Try Cosmos internal endpoint
            if (playlists.length === 0 && Spicetify.CosmosAsync) {
                try {
                    const res = await Spicetify.CosmosAsync.get('sp://core-playlist/v1/rootlist');
                    if (res && res.rows) {
                        playlists = res.rows.map(r => ({
                            uri: r.link,
                            name: r.name
                        }));
                    }
                } catch (e) {
                    logRemote('Cosmos rootlist error', e.message);
                }
            }

            // 3. Try Web API via CosmosAsync
            if (playlists.length === 0 && Spicetify.CosmosAsync) {
                try {
                    const res = await Spicetify.CosmosAsync.get('https://api.spotify.com/v1/me/playlists?limit=50');
                    if (res && res.items) {
                        playlists = res.items.map(p => {
                            let img = (p.images && p.images[0]) ? (p.images[0].url || '') : '';
                            if (img.startsWith('spotify:mosaic:')) {
                                img = 'https://mosaic.scdn.co/300/' + img.replace('spotify:mosaic:', '').replace(/:/g, '');
                            } else if (img.startsWith('spotify:image:')) {
                                img = 'https://i.scdn.co/image/' + img.replace('spotify:image:', '');
                            }
                            return {
                                uri: p.uri,
                                name: p.name,
                                image: img
                            };
                        });
                    }
                } catch (e) {
                    logRemote('Cosmos web api error', e.message);
                }
            }

            logRemote('Playlists found', { count: playlists.length, sample: playlists.slice(0, 3) });
            fetch(`${BASE_URL}/update-playlists`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlists }),
                mode: 'cors'
            }).catch(() => {});
        } catch (e) {
            logRemote('pushPlaylists error', e.message);
        }
    }

    // Initial state sync & start long polling
    pushState();
    pushPlaylists();
    poll();

    // Hook Spotify player events for immediate reactive updates
    if (Spicetify.Player.addEventListener) {
        Spicetify.Player.addEventListener('onplaypause', () => setTimeout(pushState, 100));
        Spicetify.Player.addEventListener('songchange', () => setTimeout(pushState, 150));
    }
})();
