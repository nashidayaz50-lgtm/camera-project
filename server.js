const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config');
const socketHandler = require('./routes/socketHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

socketHandler(io);

server.listen(config.PORT, () => {
    console.log(?? Modular Server running on port \!);
});
