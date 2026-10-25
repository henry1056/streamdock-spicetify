// ws-helper.js: Pure Node.js zero-dependency RFC 6455 WebSocket implementation
const crypto = require('crypto');
const net = require('net');
const EventEmitter = require('events');

function encodeFrame(data, isBinary = false, isMasked = false) {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const length = payload.length;
    let headerLength = 2;
    if (length >= 126 && length <= 65535) {
        headerLength += 2;
    } else if (length > 65535) {
        headerLength += 8;
    }
    if (isMasked) headerLength += 4;

    const frame = Buffer.alloc(headerLength + length);
    frame[0] = 0x80 | (isBinary ? 0x02 : 0x01); // FIN + opcode

    let offset = 1;
    if (length < 126) {
        frame[offset] = length | (isMasked ? 0x80 : 0x00);
        offset += 1;
    } else if (length <= 65535) {
        frame[offset] = 126 | (isMasked ? 0x80 : 0x00);
        frame.writeUInt16BE(length, offset + 1);
        offset += 3;
    } else {
        frame[offset] = 127 | (isMasked ? 0x80 : 0x00);
        frame.writeBigUInt64BE(BigInt(length), offset + 1);
        offset += 9;
    }

    if (isMasked) {
        const mask = crypto.randomBytes(4);
        mask.copy(frame, offset);
        offset += 4;
        for (let i = 0; i < length; i++) {
            frame[offset + i] = payload[i] ^ mask[i % 4];
        }
    } else {
        payload.copy(frame, offset);
    }

    return frame;
}

class WsConnection extends EventEmitter {
    constructor(socket, isClient = false) {
        super();
        this.socket = socket;
        this.isClient = isClient;
        this.buffer = Buffer.alloc(0);

        socket.on('data', chunk => this._handleData(chunk));
        socket.on('close', () => this.emit('close'));
        socket.on('error', err => {
            if (this.listenerCount('error') > 0) {
                this.emit('error', err);
            }
        });
    }

    send(data) {
        if (!this.socket.writable) return;
        try {
            const frame = encodeFrame(data, false, this.isClient);
            this.socket.write(frame);
        } catch (e) {
            this.emit('error', e);
        }
    }

    close() {
        if (!this.socket.writable) return;
        try {
            // Close frame
            this.socket.write(Buffer.from([0x88, 0x00]));
            this.socket.end();
        } catch (e) {}
    }

    _handleData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 2) {
            const byte1 = this.buffer[0];
            const byte2 = this.buffer[1];
            const opcode = byte1 & 0x0f;
            const isMasked = (byte2 & 0x80) !== 0;
            let payloadLen = byte2 & 0x7f;
            let offset = 2;

            if (payloadLen === 126) {
                if (this.buffer.length < 4) return;
                payloadLen = this.buffer.readUInt16BE(2);
                offset = 4;
            } else if (payloadLen === 127) {
                if (this.buffer.length < 10) return;
                payloadLen = Number(this.buffer.readBigUInt64BE(2));
                offset = 10;
            }

            let mask = null;
            if (isMasked) {
                if (this.buffer.length < offset + 4) return;
                mask = this.buffer.slice(offset, offset + 4);
                offset += 4;
            }

            if (this.buffer.length < offset + payloadLen) return;

            const rawPayload = this.buffer.slice(offset, offset + payloadLen);
            this.buffer = this.buffer.slice(offset + payloadLen);

            if (isMasked && mask) {
                for (let i = 0; i < rawPayload.length; i++) {
                    rawPayload[i] ^= mask[i % 4];
                }
            }

            if (opcode === 0x08) { // Close
                this.close();
                this.emit('close');
                return;
            } else if (opcode === 0x09) { // Ping
                this.socket.write(Buffer.from([0x8a, 0x00])); // Pong
            } else if (opcode === 0x01 || opcode === 0x02) { // Text or Binary
                const message = opcode === 0x01 ? rawPayload.toString('utf8') : rawPayload;
                this.emit('message', message);
            }
        }
    }
}

class WsServer extends EventEmitter {
    constructor(httpServer) {
        super();
        this.clients = new Set();

        httpServer.on('upgrade', (req, socket, head) => {
            const key = req.headers['sec-websocket-key'];
            if (!key) {
                socket.destroy();
                return;
            }

            const acceptKey = crypto
                .createHash('sha1')
                .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
                .digest('base64');

            socket.write(
                'HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
            );

            const ws = new WsConnection(socket, false);
            this.clients.add(ws);

            ws.on('close', () => {
                this.clients.delete(ws);
            });

            this.emit('connection', ws, req);
        });
    }

    broadcast(data) {
        for (const client of this.clients) {
            client.send(data);
        }
    }
}

function connectWs(urlString) {
    const emitter = new EventEmitter();
    const url = new URL(urlString);
    const host = url.hostname || '127.0.0.1';
    const port = Number(url.port) || 80;
    const path = url.pathname || '/';

    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.createConnection({ host, port }, () => {
        socket.write(
            `GET ${path} HTTP/1.1\r\n` +
            `Host: ${host}:${port}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n'
        );
    });

    let upgraded = false;
    let handshakeBuffer = '';

    socket.on('data', function onHandshake(data) {
        if (!upgraded) {
            handshakeBuffer += data.toString('utf8');
            if (handshakeBuffer.includes('\r\n\r\n')) {
                upgraded = true;
                socket.removeListener('data', onHandshake);
                const ws = new WsConnection(socket, true);
                emitter.emit('open', ws);
                
                // any remaining data
                const splitIndex = handshakeBuffer.indexOf('\r\n\r\n') + 4;
                const remaining = Buffer.from(handshakeBuffer.slice(splitIndex), 'utf8');
                if (remaining.length > 0) {
                    ws._handleData(remaining);
                }
            }
        }
    });

    socket.on('error', err => emitter.emit('error', err));
    socket.on('close', () => emitter.emit('close'));

    return emitter;
}

module.exports = {
    WsServer,
    WsConnection,
    connectWs
};
