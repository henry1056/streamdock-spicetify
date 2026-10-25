// Stream Dock N3 Plugin & Spicetify Bridge
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

const BRIDGE_PORT = 8974;

// Logging helper for troubleshooting
const LOG_FILE = process.env.STREAMDOCK_LOG_FILE || path.join(__dirname, '..', 'debug.log');
function logDebug(msg) {
    try {
        const line = `[${new Date().toISOString()}] ${typeof msg === 'object' ? JSON.stringify(msg) : msg}\n`;
        fs.appendFileSync(LOG_FILE, line);
    } catch (e) {}
}

logDebug('Plugin process started. PID: ' + process.pid + ', argv: ' + JSON.stringify(process.argv));

// Track active StreamDock button contexts
const activeButtons = new Map(); // context -> { action, device, settings }
let sdWs = null; // StreamDock host connection

// Pending long-poll HTTP clients
const pendingPolls = [];

// Cached playlists from Spotify
let cachedPlaylists = [];

// Cached Spotify player state
let playerState = {
    connected: false,
    isPlaying: false,
    title: '',
    artist: '',
    album: '',
    volume: 1.0,
    progress: 0,
    duration: 0,
    coverUrl: ''
};

let currentCoverDataUrl = '';
let lastFetchedCoverUrl = '';
const playlistCovers = new Map(); // uri -> base64 dataUrl

function fetchPlaylistCover(uri, url, context) {
    if (!url) return;
    if (url.startsWith('spotify:mosaic:')) {
        url = 'https://mosaic.scdn.co/300/' + url.replace('spotify:mosaic:', '').replace(/:/g, '');
    } else if (url.startsWith('spotify:image:')) {
        url = 'https://i.scdn.co/image/' + url.replace('spotify:image:', '');
    }

    if (playlistCovers.has(uri)) {
        const cached = playlistCovers.get(uri);
        if (cached && context) {
            sendToStreamDock({
                event: 'setImage',
                context: context,
                payload: {
                    image: cached,
                    target: 0
                }
            });
        }
        return;
    }

    try {
        const client = url.startsWith('https') ? require('https') : require('http');
        client.get(url, (res) => {
            if (res.statusCode !== 200) {
                logDebug(`Playlist cover HTTP ${res.statusCode} for ${url}`);
                return;
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const contentType = res.headers['content-type'] || 'image/jpeg';
                const dataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
                playlistCovers.set(uri, dataUrl);
                logDebug(`Downloaded playlist cover for ${uri} (${buffer.length} bytes, ${contentType})`);
                if (context) {
                    sendToStreamDock({
                        event: 'setImage',
                        context: context,
                        payload: {
                            image: dataUrl,
                            target: 0
                        }
                    });
                }
            });
        }).on('error', (err) => {
            logDebug(`Error downloading playlist cover: ${err.message}`);
        });
    } catch (e) {
        logDebug(`fetchPlaylistCover error: ${e.message}`);
    }
}

function fetchAlbumCover(url) {
    if (!url) return;
    if (url.startsWith('spotify:image:')) {
        url = 'https://i.scdn.co/image/' + url.replace('spotify:image:', '');
    }
    if (url === lastFetchedCoverUrl && currentCoverDataUrl) {
        syncStreamDockUi();
        return;
    }
    lastFetchedCoverUrl = url;

    try {
        const client = url.startsWith('https') ? require('https') : require('http');
        client.get(url, (res) => {
            if (res.statusCode !== 200) {
                logDebug(`Cover download HTTP ${res.statusCode} for ${url}`);
                return;
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const contentType = res.headers['content-type'] || 'image/jpeg';
                currentCoverDataUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
                logDebug(`Downloaded album cover (${buffer.length} bytes, ${contentType})`);
                syncStreamDockUi();
            });
        }).on('error', (err) => {
            logDebug(`Error downloading cover: ${err.message}`);
        });
    } catch (e) {
        logDebug(`Fetch album cover error: ${e.message}`);
    }
}

// -------------------------------------------------------------
// 1. Spicetify Bridge (HTTP + Long-Polling on port 8974)
// -------------------------------------------------------------
function sendToSpotify(action, payload = {}) {
    const command = { action, ...payload };
    logDebug({ dispatching: command, activePolls: pendingPolls.length });
    console.log(`[Bridge] Dispatching command to Spotify: ${action}`, payload);

    if (pendingPolls.length > 0) {
        while (pendingPolls.length > 0) {
            const res = pendingPolls.shift();
            try {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Private-Network': 'true'
                });
                res.end(JSON.stringify(command));
            } catch (e) {}
        }
        return true;
    }

    // Fallback forwarding: If another process currently holds port 8974, forward via HTTP
    try {
        let reqPath = `/${action}`;
        if (payload.uri) {
            reqPath = `/playplaylist?uri=${encodeURIComponent(payload.uri)}`;
        }
        const req = http.get(`http://127.0.0.1:${BRIDGE_PORT}${reqPath}`, (res) => {
            logDebug(`Forwarded ${action} to 127.0.0.1:${BRIDGE_PORT}, status=${res.statusCode}`);
        });
        req.on('error', (err) => {
            logDebug(`Forward error for ${action}: ${err.message}`);
        });
    } catch (e) {}

    return false;
}

const httpServer = http.createServer((req, res) => {
    // CORS & Private Network Access headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams);

    // Endpoint 1: Spotify client long-poll
    if (pathname === '/poll') {
        playerState.connected = true;

        // If we haven't received initial state yet, request it immediately
        if (!playerState.title) {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Private-Network': 'true'
            });
            res.end(JSON.stringify({ action: 'get_state' }));
            return;
        }

        // Wait up to 25 seconds for a command
        pendingPolls.push(res);

        const timer = setTimeout(() => {
            const idx = pendingPolls.indexOf(res);
            if (idx !== -1) {
                pendingPolls.splice(idx, 1);
                try {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ action: 'heartbeat' }));
                } catch (e) {}
            }
        }, 25000);

        req.on('close', () => {
            clearTimeout(timer);
            const idx = pendingPolls.indexOf(res);
            if (idx !== -1) {
                pendingPolls.splice(idx, 1);
            }
        });
        return;
    }

    // Endpoint 2: Spotify client state update
    if (pathname === '/update-state' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                playerState = {
                    ...playerState,
                    ...data,
                    connected: true
                };
                if (playerState.coverUrl) {
                    fetchAlbumCover(playerState.coverUrl);
                }
                syncStreamDockUi();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    // Endpoint: Update Playlists from Spotify
    if (pathname === '/update-playlists' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (Array.isArray(data.playlists) && data.playlists.length > 0) {
                    cachedPlaylists = data.playlists;
                    logDebug(`Received ${cachedPlaylists.length} playlists from Spotify`);
                    syncStreamDockUi();
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, count: cachedPlaylists.length }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
        return;
    }

    if (pathname === '/log' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            logDebug(`[Spotify Remote Log] ${body}`);
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
        });
        return;
    }

    // Endpoints 3+: Actions called by hardware or external scripts
    res.setHeader('Content-Type', 'application/json');

    if (pathname === '/playlists') {
        if (cachedPlaylists.length === 0) {
            sendToSpotify('get_playlists');
        }
        res.writeHead(200);
        res.end(JSON.stringify({ playlists: cachedPlaylists }));
        return;
    } else if (pathname === '/refresh_playlists' || pathname === '/refresh-playlists') {
        sendToSpotify('get_playlists');
        res.writeHead(200);
        res.end(JSON.stringify({ requested: true }));
        return;
    } else if (pathname === '/playplaylist' || pathname === '/play_uri' || pathname === '/playuri') {
        const uri = query.uri || query.url;
        if (uri) {
            sendToSpotify('play_playlist', { uri });
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, action: 'play_playlist', uri }));
        } else {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing uri parameter' }));
        }
        return;
    }

    if (pathname === '/playpause' || pathname === '/toggle') {
        sendToSpotify('playpause');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action: 'playpause', state: playerState }));
    } else if (pathname === '/play') {
        sendToSpotify('play');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action: 'play' }));
    } else if (pathname === '/pause') {
        sendToSpotify('pause');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action: 'pause' }));
    } else if (pathname === '/next') {
        sendToSpotify('next');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action: 'next' }));
    } else if (pathname === '/prev' || pathname === '/previous') {
        sendToSpotify('previous');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action: 'previous' }));
    } else if (pathname === '/volume') {
        if (query.delta !== undefined) {
            sendToSpotify('volume_delta', { delta: parseFloat(query.delta) || 0.05 });
        } else if (query.set !== undefined) {
            sendToSpotify('volume_set', { value: parseFloat(query.set) || 0.5 });
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action: 'volume' }));
    } else if (pathname === '/mute') {
        sendToSpotify('mute');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action: 'mute' }));
    } else if (pathname === '/like') {
        sendToSpotify('like');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action: 'like' }));
    } else if (pathname === '/status' || pathname === '/state') {
        res.writeHead(200);
        res.end(JSON.stringify(playerState));
    } else {
        res.writeHead(200);
        res.end(JSON.stringify({
            name: 'StreamDock Spicetify Bridge',
            version: '1.0.0',
            status: 'online',
            spotifyConnected: playerState.connected,
            playerState: playerState,
            endpoints: [
                '/playpause',
                '/play',
                '/pause',
                '/next',
                '/previous',
                '/volume?delta=0.05',
                '/volume?set=0.5',
                '/mute',
                '/like',
                '/status'
            ]
        }));
    }
});

httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        logDebug(`Port ${BRIDGE_PORT} already in use.`);
        if (sdPort && pluginUUID) {
            logDebug(`Hardware plugin detected. Reclaiming port ${BRIDGE_PORT}...`);
            try {
                const { execSync } = require('child_process');
                if (process.platform === 'win32') {
                    execSync(`powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort ${BRIDGE_PORT} -ErrorAction SilentlyContinue; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }"`);
                } else {
                    execSync(`fuser -k ${BRIDGE_PORT}/tcp || (lsof -ti:${BRIDGE_PORT} | xargs -r kill -9) 2>/dev/null || true`);
                }
                setTimeout(() => {
                    httpServer.listen(BRIDGE_PORT, '127.0.0.1');
                }, 1000);
            } catch (e) {
                logDebug(`Reclaim error: ${e.message}`);
            }
        } else {
            logDebug(`Running as auxiliary client.`);
        }
    } else {
        logDebug(`HTTP Server Error: ${err.message}`);
        console.error('[Bridge] HTTP Server Error:', err);
    }
});

httpServer.listen(BRIDGE_PORT, '127.0.0.1', () => {
    logDebug(`Listening on http://127.0.0.1:${BRIDGE_PORT}`);
    console.log(`[Bridge] Local HTTP & Long-Poll bridge listening at http://127.0.0.1:${BRIDGE_PORT}`);
});

// -------------------------------------------------------------
// 2. Stream Dock Hardware UI Synchronization
// -------------------------------------------------------------
function sendToStreamDock(payload) {
    if (sdWs && sdWs.readyState === WebSocket.OPEN) {
        try {
            sdWs.send(JSON.stringify(payload));
        } catch (e) {}
    }
}

function syncStreamDockUi() {
    if (!sdWs) return;

    for (const [context, info] of activeButtons.entries()) {
        const action = info.action || '';

        if (action.endsWith('.playpause') || action.includes('playpause')) {
            sendToStreamDock({
                event: 'setState',
                context: context,
                payload: {
                    state: playerState.isPlaying ? 1 : 0
                }
            });

            const label = playerState.isPlaying 
                ? (playerState.title ? playerState.title.slice(0, 10) : 'Playing')
                : 'Paused';

            sendToStreamDock({
                event: 'setTitle',
                context: context,
                payload: {
                    title: label,
                    target: 0
                }
            });
        } else if (action.endsWith('.volume') || action.includes('volume')) {
            const volPct = Math.round((playerState.volume || 0) * 100);
            sendToStreamDock({
                event: 'setTitle',
                context: context,
                payload: {
                    title: `${volPct}%`,
                    target: 0
                }
            });
        } else if (action.endsWith('.nowplaying') || action.includes('nowplaying')) {
            const title = playerState.title || 'No Music';
            const artist = playerState.artist || '';

            sendToStreamDock({
                event: 'setTitle',
                context: context,
                payload: {
                    title: artist ? `${title}\n${artist}` : title,
                    target: 0
                }
            });

            if (currentCoverDataUrl) {
                logDebug(`Sending setImage for nowplaying to context ${context}`);
                sendToStreamDock({
                    event: 'setImage',
                    context: context,
                    payload: {
                        image: currentCoverDataUrl,
                        target: 0
                    }
                });
            } else {
                logDebug(`nowplaying active, but currentCoverDataUrl is empty`);
            }
        } else if (action.endsWith('.playplaylist') || action.includes('playplaylist')) {
            const settings = info.settings || {};
            const uri = settings.uri || settings.playlistUri;
            if (uri) {
                const pl = cachedPlaylists.find(p => p.uri === uri);
                const name = (pl && pl.name) || settings.name || '';
                const imgUrl = (pl && pl.image) || settings.image || '';

                if (settings.autoTitle !== false && name) {
                    sendToStreamDock({
                        event: 'setTitle',
                        context: context,
                        payload: {
                            title: name,
                            target: 0
                        }
                    });
                }

                if (imgUrl) {
                    fetchPlaylistCover(uri, imgUrl, context);
                }
            }
        }
    }
}

// -------------------------------------------------------------
// 3. VSD Craft Stream Dock Plugin Protocol Handler
// -------------------------------------------------------------
function parseCommandLineArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('-') && i + 1 < args.length) {
            const key = args[i].replace(/^-+/, '');
            parsed[key] = args[i + 1];
            i++;
        }
    }
    return parsed;
}

const streamDockArgs = parseCommandLineArgs();
const sdPort = streamDockArgs.port;
const pluginUUID = streamDockArgs.pluginUUID;
const registerEvent = streamDockArgs.registerEvent || 'registerPlugin';

if (sdPort && pluginUUID) {
    logDebug(`Connecting to VSD Craft host on port ${sdPort}...`);
    console.log(`[StreamDock] Connecting to VSD Craft host on port ${sdPort}...`);

    function connectStreamDockHost() {
        const ws = new WebSocket(`ws://127.0.0.1:${sdPort}`);

        ws.on('open', () => {
            logDebug('Connected to VSD Craft WebSocket host!');
            console.log('[StreamDock] Connected to VSD Craft!');
            sdWs = ws;

            ws.send(JSON.stringify({
                event: registerEvent,
                uuid: pluginUUID
            }));
        });

        ws.on('message', (raw) => {
            try {
                const data = JSON.parse(raw.toString());
                handleStreamDockEvent(data);
            } catch (e) {
                console.error('[StreamDock] Error parsing message:', e);
            }
        });

        ws.on('close', () => {
            logDebug('Connection to VSD Craft lost. Reconnecting in 3s...');
            console.warn('[StreamDock] Connection to VSD Craft lost. Reconnecting in 3s...');
            sdWs = null;
            setTimeout(connectStreamDockHost, 3000);
        });

        ws.on('error', (err) => {
            logDebug(`VSD Craft WebSocket error: ${err.message}`);
        });
    }

    connectStreamDockHost();
} else {
    logDebug('No VSD Craft parameters detected. Running in STANDALONE bridge mode.');
    console.log('[StreamDock] No VSD Craft parameters detected. Running in STANDALONE bridge mode.');
}

let lastKeyEventTime = 0;

function handleStreamDockEvent(msg) {
    logDebug({ incomingEvent: msg });
    const event = msg.event;
    const action = msg.action || (msg.payload && msg.payload.action) || '';
    const context = msg.context;
    const payload = msg.payload || {};

    switch (event) {
        case 'willAppear':
            activeButtons.set(context, { action, device: msg.device, settings: payload.settings || {} });
            syncStreamDockUi();
            setTimeout(syncStreamDockUi, 100);
            setTimeout(syncStreamDockUi, 300);
            break;

        case 'titleParametersDidChange':
        case 'propertyInspectorDidAppear':
            setTimeout(syncStreamDockUi, 50);
            break;

        case 'willDisappear':
            activeButtons.delete(context);
            break;

        case 'didReceiveSettings':
            if (activeButtons.has(context)) {
                const btn = activeButtons.get(context);
                btn.settings = payload.settings || {};
                syncStreamDockUi();
            }
            break;

        case 'sendToPlugin':
            if (payload.action === 'getPlaylists' || payload.type === 'getPlaylists' || payload.type === 'refresh') {
                sendToSpotify('get_playlists');
                sendToStreamDock({
                    event: 'sendToPropertyInspector',
                    action: action,
                    context: context,
                    payload: { playlists: cachedPlaylists }
                });
            }
            break;

        case 'keyDown':
        case 'keyUp':
            // Debounce within 150ms to prevent duplicate triggers if both keyDown and keyUp arrive
            const now = Date.now();
            if (event === 'keyDown' || (now - lastKeyEventTime > 250)) {
                lastKeyEventTime = now;
                logDebug(`Triggering action: ${action} on event ${event}`);
                console.log(`[StreamDock] Key event (${event}) on action: ${action}`);

                if (action.endsWith('.playpause') || action.includes('playpause')) {
                    sendToSpotify('playpause');
                } else if (action.endsWith('.next') || action.includes('next')) {
                    sendToSpotify('next');
                } else if (action.endsWith('.previous') || action.includes('previous') || action.includes('prev')) {
                    sendToSpotify('previous');
                } else if (action.endsWith('.mute') || action.includes('mute')) {
                    sendToSpotify('mute');
                } else if (action.endsWith('.like') || action.includes('like')) {
                    sendToSpotify('like');
                } else if (action.endsWith('.volume') || action.includes('volume')) {
                    sendToSpotify('playpause');
                } else if (action.endsWith('.nowplaying') || action.includes('nowplaying')) {
                    sendToSpotify('playpause');
                } else if (action.endsWith('.playplaylist') || action.includes('playplaylist')) {
                    const btn = activeButtons.get(context);
                    const settings = (btn && btn.settings) || payload.settings || {};
                    const uri = settings.uri || settings.playlistUri;
                    logDebug(`playplaylist triggered for context ${context}, uri: ${uri}`);
                    if (uri) {
                        sendToSpotify('play_playlist', { uri });
                    } else {
                        logDebug('No playlist URI configured for this key.');
                    }
                }
            }
            break;

        case 'dialRotate':
            console.log(`[StreamDock] Knob rotated: ticks=${payload.ticks}`);
            const ticks = Number(payload.ticks) || 1;
            sendToSpotify('volume_delta', { delta: ticks * 0.03 });
            break;

        case 'dialDown':
        case 'dialPress':
        case 'touchTap':
            console.log(`[StreamDock] Knob pressed (${event})!`);
            sendToSpotify('playpause');
            break;

        default:
            break;
    }
}
