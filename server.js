let openConnections = {};
let history = {0:[{
    "id": 1,
    "sender": "SERVER",
    "content": "This is the Start of your Conversation",
    "timestamp": new Date().getTime()
}]}
loadHistory();

/*
TODO:|\/\|\/\|\/\|\/\|\/\|\/\|\/
- migrate history loading from /stream endpoint to /history because stream keeps failing
- user settings
- privacy types
- better room selector
*/

import http from "http";
import path from "path";
import crypto from "crypto";
import { promisify } from "util";
import fs from "fs";
import webpush from "web-push";

let DB = loadJson("database.json", {validTokens: [], users: {}, admins: []});
let roomsDB = loadJson("rooms.json", {});
const PORT = Number(process.env.PORT || 5000);
const scrypt = promisify(crypto.scrypt);
const AUTH_HTML = fs.readFileSync("public/auth.html", "utf8");
const AUTH_CSS = fs.readFileSync("public/auth.css", "utf8");
const AUTH_JS = fs.readFileSync("public/auth.js", "utf8");
const uploadsRoot = path.resolve("uploads");
fs.mkdirSync(uploadsRoot, {recursive: true, mode: 0o700});
let accountsDB = loadJson("accounts.json", {accounts: {}, sessions: {}});
let uploadsDB = loadJson("uploads.json", {});
const logFile = "logs.json";
//const CSS = fs.readFileSync("public/style.css").toString();
//const JS = fs.readFileSync("public/app.js").toString();
//const HTML = fs.readFileSync("public/index.html").toString();
//const BG = fs.readFileSync("public/background.js").toString();
const ICON = fs.readFileSync("public/favicon.ico");
const TOKEN_PROMPT = fs.readFileSync("public/tokenPrompt.html").toString();
const SIGNUP_PROMPT = fs.readFileSync("public/signUpPrompt.html").toString();

const pushConfig = loadJson(".push-config.json", {});
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || pushConfig.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || pushConfig.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || pushConfig.VAPID_SUBJECT || "mailto:admin@antrox.org";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
    console.log("push notifications disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set");
}

console.log("running on port " + PORT);

// MAIN SERVER
const server = http.createServer(async (req, res) => {
    if (req.url === "/manifest.json") {
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(fs.readFileSync("public/manifest.json")); return;
    }
    if (req.url === "/icon-192.png") {
        res.writeHead(200, {"Content-Type": "image/png"});
        res.end(fs.readFileSync("assets/icon-192.png")); return;
    }
    if (req.url === "/icon-512.png") {
        res.writeHead(200, {"Content-Type": "image/png"});
        res.end(fs.readFileSync("assets/icon-512.png")); return;
    }


    refreshDBs();
    const pathname = new URL(req.url, "http://localhost").pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    if (pathname === "/favicon.ico") {
        res.writeHead(200, {"Content-Type": "image/x-icon", "Cache-Control": "public, max-age=86400"});
        res.end(ICON);
        return;
    }
    let clientToken = getCookie(req, "token");
    let sessionRecord = clientToken ? accountsDB.sessions[clientToken] : null;
    let legacyCookieMigration = false;
    if (sessionRecord?.expiresAt && sessionRecord.expiresAt <= Date.now()) {
        delete accountsDB.sessions[clientToken];
        saveAccounts();
        sessionRecord = null;
    }
    if (!sessionRecord && clientToken && isValid(clientToken) && DB.users[clientToken]) {
        const legacyAccount = Object.values(accountsDB.accounts).find(a => a.legacyToken === clientToken);
        if (legacyAccount) {
            clientToken = createSession(legacyAccount.id, req);
            sessionRecord = accountsDB.sessions[clientToken];
            saveAccounts();
            legacyCookieMigration = true;
        }
    }
    const account = sessionRecord ? accountsDB.accounts[sessionRecord.accountId] : null;
    const token = account?.legacyToken ?? null;
    const user = token ? (DB.users[token] ?? {}) : {};
    const setSessionCookie = (value, maxAge = 60 * 60 * 24 * 30) => {
        const secure = req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
        res.setHeader("Set-Cookie", "token=" + encodeURIComponent(value) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (secure ? "; Secure" : ""));
    };
    if (legacyCookieMigration) setSessionCookie(clientToken);

    if (pathname === "/auth.css") {
        res.writeHead(200, {"Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache"});
        res.end(AUTH_CSS); return;
    }
    if (pathname === "/auth.js") {
        res.writeHead(200, {"Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache"});
        res.end(AUTH_JS); return;
    }
    if (pathname === "/api/auth/session" && req.method === "GET") {
        res.writeHead(200, {"Content-Type": "application/json", "Cache-Control": "no-store"});
        res.end(JSON.stringify({authenticated: !!account, username: account?.username ?? null, needsSetup: !!account?.needsSetup}));
        return;
    }
    if (pathname === "/api/auth/signup" && req.method === "POST") {
        try {
            const body = await readJson(req, 16384);
            const username = String(body.username || "").trim();
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");
            if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) throw httpError(400, "Username must be 3–24 characters using letters, numbers, dots, underscores or hyphens.");
            if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Enter a valid email address.");
            if (password.length < 10 || password.length > 256) throw httpError(400, "Password must be at least 10 characters.");
            const nameKey = username.toLowerCase();
            if (Object.values(accountsDB.accounts).some(a => a.username.toLowerCase() === nameKey)) throw httpError(409, "That username is already taken.");
            if (Object.values(accountsDB.accounts).some(a => a.email && a.email.toLowerCase() === email)) throw httpError(409, "An account with that email already exists.");
            const accountId = crypto.randomUUID();
            const legacyToken = crypto.randomBytes(24).toString("hex");
            DB.users[legacyToken] = {name: username, rooms: [0], created: {timestamp: Date.now()}, pushSubscriptions: []};
            DB.validTokens ||= [];
            DB.validTokens.push(legacyToken);
            accountsDB.accounts[accountId] = {id: accountId, username, email, passwordHash: await hashPassword(password), legacyToken, createdAt: Date.now(), needsSetup: false};
            const sessionToken = createSession(accountId, req);
            dumpDBs();
            saveAccounts();
            setSessionCookie(sessionToken);
            res.writeHead(201, {"Content-Type": "application/json", "Cache-Control": "no-store"});
            res.end(JSON.stringify({ok: true, username}));
        } catch (e) { sendApiError(res, e); }
        return;
    }
    if (pathname === "/api/auth/login" && req.method === "POST") {
        try {
            const body = await readJson(req, 16384);
            const identifier = String(body.identifier || "").trim().toLowerCase();
            const password = String(body.password || "");
            const found = Object.values(accountsDB.accounts).find(a => a.username.toLowerCase() === identifier || (a.email && a.email.toLowerCase() === identifier));
            if (!found) throw httpError(401, "Invalid username/email or password.");
            if (found.needsSetup || !found.passwordHash) throw httpError(409, "This is an older Xessenger account. Use “Link existing token” once to set a password.");
            if (!await verifyPassword(password, found.passwordHash)) throw httpError(401, "Invalid username/email or password.");
            const sessionToken = createSession(found.id, req);
            saveAccounts();
            setSessionCookie(sessionToken);
            res.writeHead(200, {"Content-Type": "application/json", "Cache-Control": "no-store"});
            res.end(JSON.stringify({ok: true, username: found.username}));
        } catch (e) { sendApiError(res, e); }
        return;
    }
    if (pathname === "/api/auth/claim-legacy" && req.method === "POST") {
        try {
            const body = await readJson(req, 16384);
            const legacyToken = String(body.token || "").trim();
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");
            const found = Object.values(accountsDB.accounts).find(a => a.legacyToken === legacyToken && a.needsSetup);
            if (!found || !isValid(legacyToken)) throw httpError(401, "That legacy token is not valid for account setup.");
            if (password.length < 10 || password.length > 256) throw httpError(400, "Password must be at least 10 characters.");
            if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Enter a valid email address.");
            if (Object.values(accountsDB.accounts).some(a => a.id !== found.id && a.email && a.email.toLowerCase() === email)) throw httpError(409, "An account with that email already exists.");
            found.email = email;
            found.passwordHash = await hashPassword(password);
            found.needsSetup = false;
            const sessionToken = createSession(found.id, req);
            saveAccounts();
            setSessionCookie(sessionToken);
            res.writeHead(200, {"Content-Type": "application/json", "Cache-Control": "no-store"});
            res.end(JSON.stringify({ok: true, username: found.username}));
        } catch (e) { sendApiError(res, e); }
        return;
    }
    if (pathname === "/api/auth/logout" && req.method === "POST") {
        if (clientToken && accountsDB.sessions[clientToken]) {
            delete accountsDB.sessions[clientToken];
            saveAccounts();
        }
        setSessionCookie("", 0);
        res.writeHead(200, {"Content-Type": "application/json", "Cache-Control": "no-store"});
        res.end('{"ok":true}'); return;
    }
    if (pathname === "/token" || pathname.startsWith("/token/")) {
        res.writeHead(302, {Location: "/login?legacy=1", "Cache-Control": "no-store"});
        res.end(); return;
    }
    if (pathname === "/register" || pathname.startsWith("/register/")) {
        res.writeHead(410, {"Content-Type": "application/json"});
        res.end(JSON.stringify({error: "Use account signup instead."})); return;
    }
    if (!account || !token || !isValid(token)) {
        if (pathname.startsWith("/api/") || pathname === "/send" || pathname === "/stream") {
            res.writeHead(401, {"Content-Type": "application/json", "Cache-Control": "no-store"});
            res.end(JSON.stringify({error: "Authentication required"})); return;
        }
        res.writeHead(200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"});
        res.end(AUTH_HTML); return;
    }
    if (pathname === "/login" || pathname === "/signup") {
        res.writeHead(302, {Location: "/", "Cache-Control": "no-store"});
        res.end(); return;
    }
    // ---------------------------- AUTHORIZED ------------------------------
    // statics (mostly)
    if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, {"Content-Type": "text/html"});
        res.end(fs.readFileSync("public/index.html").toString());
        return;
    }
    if (pathname === "/style.css" || pathname === "/designs/style2.css") {
        const cssFile = pathname === "/style.css" ? "public/style.css" : "public/designs/style2.css";
        res.writeHead(200, {"Content-Type": "text/css; charset=utf-8"});
        res.end(fs.readFileSync(cssFile).toString());
        return;
    }
    if (req.url === "/app.js") {
        res.writeHead(200, {"Content-Type": "application/javascript"});
        res.end(fs.readFileSync("public/app.js").toString());
        return;
    }
    if (req.url === "/push-worker.js") {
        res.writeHead(200, {
            "Content-Type": "application/javascript",
            "Service-Worker-Allowed": "/"
        });
        res.end(fs.readFileSync("public/push-worker.js").toString());
        return;
    }
    if (req.url === "/favicon.ico") {
        res.writeHead(200, {"Content-Type": "image/x-icon"});
        res.end(ICON);
        return;
    }
    if (req.url === "/geodata.json") {
        res.writeHead(200, {"Content-Type": "text/plain"});
        res.end(fs.readFileSync("assets/geodata.json").toString()); return;
    }


    if (pathname === "/api/profile" && req.method === "GET") {
        const profile = DB.users[token] || {};
        res.writeHead(200, {"Content-Type":"application/json", "Cache-Control":"no-store"});
        res.end(JSON.stringify({name: profile.name || "", bio: profile.bio || "", avatar: profile.avatar || ""}));
        return;
    }
    if (pathname === "/api/profile" && req.method === "POST") {
        try {
            const body = await readJson(req, 180000);
            const name = String(body.name || "").trim();
            const bio = String(body.bio || "").trim();
            const avatar = String(body.avatar || "");
            if (!/^[\p{L}\p{N}_. -]{2,32}$/u.test(name)) throw httpError(400, "Display name must be 2–32 characters.");
            if (bio.length > 240) throw httpError(400, "Bio is limited to 240 characters.");
            if (avatar && (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar) || avatar.length > 140000)) throw httpError(400, "Avatar must be a PNG, JPEG or WebP under 100 KB.");
            if (Object.entries(DB.users).some(([otherToken, u]) => otherToken !== token && String(u.name || "").toLowerCase() === name.toLowerCase())) throw httpError(409, "That display name is already in use.");
            DB.users[token].name = name;
            DB.users[token].bio = bio;
            DB.users[token].avatar = avatar;
            const linked = Object.values(accountsDB.accounts).find(a => a.legacyToken === token);
            if (linked) linked.username = name.slice(0,24);
            dumpDBs(); saveAccounts();
            res.writeHead(200, {"Content-Type":"application/json", "Cache-Control":"no-store"});
            res.end(JSON.stringify({ok:true, name, bio, avatar}));
        } catch (e) { sendApiError(res, e); }
        return;
    }
    if (pathname === "/api/join-room" && req.method === "POST") {
        try {
            const body = await readJson(req, 4096);
            const id = String(body.id || "");
            const invite = String(body.invite || "");
            const target = roomsDB[id];
            if (!target || target.privacy !== "Public" || !target.inviteCode || !crypto.timingSafeEqual(Buffer.from(invite.padEnd(64, "0").slice(0,64)), Buffer.from(String(target.inviteCode).padEnd(64, "0").slice(0,64))) || invite.length !== target.inviteCode.length) throw httpError(403, "This invite is invalid or the room is not public.");
            if (!target.members.includes(token)) { target.members.push(token); DB.users[token].rooms ||= []; if (!DB.users[token].rooms.some(r => String(r) === id)) DB.users[token].rooms.push(id); target.size = target.members.length; dumpDBs(); }
            res.writeHead(200, {"Content-Type":"application/json"}); res.end(JSON.stringify({ok:true,id}));
        } catch (e) { sendApiError(res, e); }
        return;
    }
    if (pathname === "/api/create-room" && req.method === "POST") {
        try {
            const body = await readJson(req, 32768);
            const alias = String(body.alias || "").trim().slice(0, 64);
            const desc = String(body.desc || "").trim().slice(0, 500);
            const privacy = ["Public", "Private", "Confidential", "Top-Secret"].includes(body.privacy) ? body.privacy : "Public";
            if (!alias) throw httpError(400, "Room name is required.");
            if (privacy === "Confidential") throw httpError(501, "Confidential rooms are not available until end-to-end encryption and secure key sharing are implemented.");
            const id = createRoom(token, alias, desc, privacy);
            res.writeHead(201, {"Content-Type": "application/json"});
            res.end(JSON.stringify({ok: true, id}));
        } catch (e) { sendApiError(res, e); }
        return;
    }

    // further auth (room checks)
    if (req.url === "/UserName") {
        res.writeHead(200, { "Content-Type": "application/json" });

        const rawUser = DB["users"]?.[token];
        const defaultName = `user_${token.slice(0, 8)}`;
        const rooms = rawUser?.rooms ?? [0];

        const roomAliases = rooms.reduce((acc, roomId) => {
            acc[roomId] = roomsDB[roomId]?.alias ?? roomId;
            return acc;
        }, {});

        const userData = {
            name: rawUser?.name ?? defaultName,
            bio: rawUser?.bio ?? "",
            avatar: rawUser?.avatar ?? "",
            rooms: roomAliases
        };

        res.end(JSON.stringify(userData));
        return;
    }

    // push notifications:
    if (req.url === "/push/vapid-public-key" && req.method === "GET") {
        if (!VAPID_PUBLIC_KEY) {
            res.writeHead(503, {"Content-Type": "application/json"});
            res.end(JSON.stringify({
                ok: false,
                error: "push notifications are not configured"
            }));
            return;
        }

        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({publicKey: VAPID_PUBLIC_KEY}));
        return;
    }

    if (pathname === "/api/upload" && req.method === "POST") {
        try {
            const match = String(req.headers["content-type"] || "").match(/multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
            if (!match) throw httpError(415, "Use a multipart file upload.");
            const boundary = match[1] || match[2].trim();
            const body = await readBuffer(req, 50 * 1024 * 1024 + 65536);
            const filePart = findMultipartFile(body, boundary, "file");
            if (!filePart) throw httpError(400, "No file was supplied.");
            if (!filePart.data.length) throw httpError(400, "The selected file is empty.");
            if (filePart.data.length > 50 * 1024 * 1024) throw httpError(413, "Files are limited to 50 MiB.");
            const id = crypto.randomBytes(24).toString("hex");
            let type = (filePart.type || "application/octet-stream").split(";")[0].toLowerCase();
            if (["image/svg+xml", "application/xhtml+xml", "text/html", "text/javascript", "application/javascript"].includes(type)) {
                type = "application/octet-stream";
            }
            const filename = cleanFilename(filePart.filename || "download");
            fs.writeFileSync(path.join(uploadsRoot, id), filePart.data, {flag: "wx", mode: 0o600});
            uploadsDB[id] = {id, filename, type, size: filePart.data.length, storageName: id, uploadedBy: account.id, createdAt: Date.now()};
            saveUploads();
            res.writeHead(201, {"Content-Type": "application/json", "Cache-Control": "no-store"});
            res.end(JSON.stringify(publicAttachment(uploadsDB[id])));
        } catch (e) { sendApiError(res, e); }
        return;
    }
    const fileRoute = pathname.match(/^\/(media|download)\/([a-f0-9]{48})$/);
    if (fileRoute && req.method === "GET") {
        const record = uploadsDB[fileRoute[2]];
        if (!record) { res.writeHead(404); res.end("File not found"); return; }
        const sharedRooms = Array.isArray(record.sharedRooms) ? record.sharedRooms : [];
        const userRooms = DB.users[token]?.rooms || [];
        const hasFileAccess = record.uploadedBy === account.id || sharedRooms.some(sharedRoom =>
            userRooms.some(userRoom => String(userRoom) === String(sharedRoom)));
        if (!hasFileAccess) { res.writeHead(403); res.end("You do not have access to this file."); return; }
        const target = path.join(uploadsRoot, record.storageName);
        if (!fs.existsSync(target)) { res.writeHead(404); res.end("File not found"); return; }
        const inline = fileRoute[1] === "media" && /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp|tiff)|audio\/(?:mpeg|ogg|wav|webm|mp4|aac|flac)|video\/(?:mp4|webm|ogg|quicktime))$/i.test(record.type);
        if (fileRoute[1] === "media" && !inline) { res.writeHead(415); res.end("This file type is download-only."); return; }
        const disposition = inline ? "inline" : "attachment";
        const asciiName = record.filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
        res.writeHead(200, {
            "Content-Type": record.type,
            "Content-Length": record.size,
            "Content-Disposition": disposition + '; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodeURIComponent(record.filename),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=3600"
        });
        fs.createReadStream(target).pipe(res);
        return;
    }

    const rooms = DB["users"][token]["rooms"].map(r=>""+r)
    const room = ""+(getCookie(req, "room") ?? rooms[0]);
    if (!rooms.includes(room)) {
        res.writeHead(401, {"Content-Type": "text/html"});
        console.log(token,"with authorization for rooms",rooms.join(", "),"tried to access room",room)
        res.end("you are not authorized for this room!"); return;
    }

    if (req.url.startsWith("/api/room-data")) {
        const r = roomsDB[room];
        res.writeHead(200, {"Content-Type": "application/json"});
        if (r.privacy === "Public" && !r.inviteCode) { r.inviteCode = crypto.randomBytes(24).toString("base64url"); dumpDBs(); }
        res.end(JSON.stringify({
            id:room,
            alias:r.alias,
            description: r.description,
            members: r.members.map(m=>DB.users[m]?.name),
            admins: [DB.users[r.created.creator]?.name],
            privacy: r.privacy || "Public",
            inviteCode: r.privacy === "Public" ? (r.inviteCode || (r.inviteCode = crypto.randomBytes(24).toString("base64url"))) : null,
            created:r.created.timestamp
        })); return;
    }

    if (req.url === "/api/add-user") {
        let body = "";
        req.on("data", chunk => {body += chunk;});
        req.on("end", () => { try {
            if (roomsDB[room].created.creator !== token) throw new Error("Only room admins can add users");
            if (roomsDB[room].privacy === "Confidential") throw new Error("Confidential rooms are not enabled until end-to-end encryption is implemented");
            const newMembers = JSON.parse(body);
            newMembers.forEach((m) => {
                const nuToken = Object.entries(DB.users).find(([token, user]) => user.name === m)?.[0];
                if (!nuToken) throw new Error("User does not exist");
                if(roomsDB[room].members.includes(nuToken)) throw new Error("Already a member");
                console.log(token,"added",nuToken,"to room",room);
                DB.users[nuToken].rooms.push(room);
                roomsDB[room].members.push(nuToken);
                dumpDBs();
            })
            res.writeHead(200, {"Content-Type": "text/plain"});
            res.end("OK");
        } catch(err) {
            console.log(err,"- received invalid member invitation request from",token+":",body);
            res.writeHead(403, {"Content-Type": "text/plain"});
            res.end(err.toString());
        }});
        return;
    }

    if (req.url === "/api/kick-user") {
        let body = "";
        req.on("data", chunk => {body += chunk;});
        req.on("end", () => { try {
            const remMembers = JSON.parse(body);
            remMembers.forEach((m) => {
                if(![roomsDB[room].created.creator].includes(token)) {throw new Error("Permission denied")}
                const rmToken = Object.entries(DB.users).find(([token, user]) => user.name === m)?.[0];
                if (!rmToken) throw new Error("User does not exist");
                if (!roomsDB[room].members.includes(rmToken)) throw new Error("Not a member");
                console.log(token,"kicked",rmToken,"from room",room);
                DB.users[rmToken].rooms = DB.users[rmToken].rooms.filter(id => id !== room);
                roomsDB[room].members = roomsDB[room].members.filter(id => id !== rmToken);
                dumpDBs();
            })
            res.writeHead(200, {"Content-Type": "text/plain"});
            res.end("OK");
        } catch(err) {
            console.log(err,"- received invalid member removal request from",token+":",body);
            res.writeHead(403, {"Content-Type": "text/plain"});
            res.end(err.toString());
        }});
        return;
    }

    if (req.url.startsWith("/background.js")) {
        res.writeHead(200, {"Content-Type": "application/javascript", "Cache-Control": "no-cache"});
        if (room===0) res.end(fs.readFileSync("public/bg-globe.js").toString());
        else res.end(fs.readFileSync("public/background.js").toString());
        return;
    }

    // assets loading
    if (req.url === "/chat-icon") {
        res.writeHead(200, {"Content-Type": "image/jpeg"});
        if (room===0)
            res.end(fs.readFileSync("assets/global.jpeg"));
        else
            res.end(fs.readFileSync("assets/default-icon.jpeg"));
        return;
    }
    if (req.url === "/pfp") {
        res.writeHead(200, {"Content-Type": "image/jpeg"});
        res.end(fs.readFileSync("assets/default-pfp.jpeg"));
        return;
    }

    // send messages:
    if (req.url === "/send" && req.method === "POST") {
        let body = "";
        req.on("data", chunk => {body += chunk;});
        req.on("end", () => {
            try {
                const parsed = JSON.parse(body);
                const msg = {
                    sender: DB["users"][token]["name"] || "unknown",
                    content: parsed.message || "",
                    timestamp: new Date().toISOString(),
                    attachment: parsed.attachment?.id && uploadsDB[parsed.attachment.id]
                        ? publicAttachment(uploadsDB[parsed.attachment.id])
                        : null,
                };
                if (parsed.attachment && !msg.attachment) {
                    res.writeHead(400, {"Content-Type": "application/json"});
                    res.end(JSON.stringify({error: "Invalid attachment."}));
                    return;
                }
                if (msg.attachment) {
                    const uploadRecord = uploadsDB[parsed.attachment.id];
                    uploadRecord.sharedRooms ||= [];
                    if (!uploadRecord.sharedRooms.some(sharedRoom => String(sharedRoom) === String(room))) {
                        uploadRecord.sharedRooms.push(String(room));
                        saveUploads();
                    }
                }

                msg.id = parsed.id??deriveID(msg.sender, msg.timestamp, msg.content);
                if (!history[room]) history[room] = [];
                history[room].push(msg);
                (openConnections[room] || []).forEach(client => {
                    if (client !== res)
                    client.write(`data: ${JSON.stringify(msg)}\n\n`);
                    void sendPushNotifications(room, msg, token);
                });

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            } catch (e) {
                res.writeHead(400);
                res.end("bad body, congrats");
            }
        }); return;
    }

    // embed previews delivering
    const websiteAsset = pathname.match(/^\/assets\/websites\/([a-zA-Z0-9_-]+\.jpeg)$/);
    if (websiteAsset) {
        const assetRoot = path.resolve("assets/websites");
        const assetPath = path.resolve(assetRoot, websiteAsset[1]);
        if (!assetPath.startsWith(assetRoot + path.sep) || !fs.existsSync(assetPath)) {
            res.writeHead(404); res.end(); return;
        }
        res.writeHead(200, {"Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff"});
        fs.createReadStream(assetPath).pipe(res);
        return;
    }

    // subscribe to msg feed:
    if (req.url === '/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        // maybe send history here
        if (!history[room]) history[room] = [];
        else {/*
            //send buffered
            let i = 0;
            const sendNext = () => {
                if (i>=history[room].length) return;
                const msg = history[room][i];
                res.write(`data: ${JSON.stringify(msg)}\n\n`);
                i++;
                let t = 100;
                if (history[room].length-i>10) t = 50;
                if (history[room].length-i>20) t = 10;
                setTimeout(sendNext, t);

            }
            sendNext();*/
            //this will send instantly:
            history[room].forEach(msg => {
                res.write(`data: ${JSON.stringify(msg)}\n\n`);
            });

        }
        if (!openConnections[room]) openConnections[room] = [];
        openConnections[room].push(res);
        req.on('close', () => {
            openConnections[room] = openConnections[room].filter(client => client !== res);
        });
        return;
    }

    //  subscribe to push service
    if (req.url === "/push/subscribe" && req.method === "POST") {
        let body = "";

        req.on("data", chunk => {body += chunk;});

        req.on("end", () => {
            try {
                const subscription = JSON.parse(body);

                if (!subscription.endpoint ||
                    !subscription.keys?.p256dh ||
                    !subscription.keys?.auth) {

                    res.writeHead(400, {"Content-Type": "application/json"});
                    res.end(JSON.stringify({
                        ok: false,
                        error: "invalid subscription"
                    }));
                    return;
                }

                if (!DB.users[token].pushSubscriptions)
                    DB.users[token].pushSubscriptions = [];

                const subscriptions = DB.users[token].pushSubscriptions;

                const existing = subscriptions.findIndex(
                    s => s.endpoint === subscription.endpoint
                );

                if (existing >= 0)
                    subscriptions[existing] = subscription;
                else
                    subscriptions.push(subscription);

                dumpDBs();

                res.writeHead(200, {"Content-Type": "application/json"});
                res.end(JSON.stringify({ok: true}));

            } catch (e) {
                res.writeHead(400, {"Content-Type": "application/json"});
                res.end(JSON.stringify({
                    ok: false,
                    error: "bad body"
                }));
            }
        });

        return;
    }

    // revoke that subscription
    if (req.url === "/push/unsubscribe" && req.method === "POST") {
        let body = "";

        req.on("data", chunk => {body += chunk;});

        req.on("end", () => {
            try {
                const parsed = JSON.parse(body);

                if (DB.users[token].pushSubscriptions) {
                    DB.users[token].pushSubscriptions =
                        DB.users[token].pushSubscriptions.filter(
                            s => s.endpoint !== parsed.endpoint
                        );
                    dumpDBs();
                }

                res.writeHead(200, {"Content-Type": "application/json"});
                res.end(JSON.stringify({ok: true}));

            } catch (e) {
                res.writeHead(400, {"Content-Type": "application/json"});
                res.end(JSON.stringify({ok: false}));
            }
        });

        return;
    }

    // profile view
    if (req.url.startsWith("/profile")) {
        if (req.url.length === 8) {
            // view own profile
            const profile = profileView(DB["users"][token]);
            res.writeHead(200, {"Content-Type": "application/json"});
            res.end(JSON.stringify(profile));
        } else {
            // view foreign profile

        } return;
    }

    //crash the server
    if (req.url === "/crash-soft") {gracefulShutdown("User-induced by @"+user.name, true)}
    if (req.url === "/crash-hard") {gracefulShutdown("User-induced by @"+user.name, false)}

    // maybe log for fuzzer detection. definitely scary if anyone lands here
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(fs.readFileSync("patterns/Gravity.html"))
    //res.end("what the fuck did you request?");

}).listen(PORT,"127.0.0.1");



function loadJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) {
        if (error.code !== "ENOENT") console.error("Could not read", file, error.message);
        return structuredClone(fallback);
    }
}

function writeJsonAtomic(file, value) {
    const target = path.resolve(file);
    const temp = target + "." + process.pid + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), {encoding: "utf8", mode: 0o600});
    fs.renameSync(temp, target);
}
function saveAccounts() { writeJsonAtomic("accounts.json", accountsDB); }
function saveUploads() { writeJsonAtomic("uploads.json", uploadsDB); }

function ensureLegacyAccounts() {
    accountsDB.accounts ||= {};
    accountsDB.sessions ||= {};
    let changed = false;
    for (const [legacyToken, user] of Object.entries(DB.users || {})) {
        if (Object.values(accountsDB.accounts).some(a => a.legacyToken === legacyToken)) continue;
        const username = String(typeof user === "string" ? user : (user?.name || ("user_" + legacyToken.slice(0, 8)))).slice(0, 24);
        const id = crypto.createHash("sha256").update("xessenger-legacy:" + legacyToken).digest("hex").slice(0, 32);
        accountsDB.accounts[id] = {id, username, email: "", passwordHash: null, legacyToken, createdAt: user?.created?.timestamp || Date.now(), needsSetup: true, legacy: true};
        changed = true;
    }
    if (changed) saveAccounts();
}
function createSession(accountId, req) {
    const sessionToken = crypto.randomBytes(32).toString("base64url");
    accountsDB.sessions[sessionToken] = {accountId, createdAt: Date.now(), lastSeen: Date.now(), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, userAgent: String(req.headers["user-agent"] || "").slice(0, 220)};
    return sessionToken;
}
async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, 64);
    return salt.toString("hex") + ":" + key.toString("hex");
}
async function verifyPassword(password, encoded) {
    try {
        const parts = String(encoded).split(":");
        const salt = Buffer.from(parts[0], "hex");
        const expected = Buffer.from(parts[1], "hex");
        if (salt.length !== 16 || expected.length !== 64) return false;
        const actual = await scrypt(password, salt, expected.length);
        return crypto.timingSafeEqual(actual, expected);
    } catch { return false; }
}
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function sendApiError(res, error) {
    if (res.headersSent) return;
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error("Request failed:", error?.stack || error);
    res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-store"});
    res.end(JSON.stringify({error: status >= 500 ? "Internal server error." : error.message}));
}
async function readBuffer(req, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) throw httpError(413, "Request body is too large.");
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
}
async function readJson(req, maxBytes = 1048576) {
    const buffer = await readBuffer(req, maxBytes);
    try { return JSON.parse(buffer.toString("utf8") || "{}"); }
    catch { throw httpError(400, "Invalid JSON body."); }
}
function cleanFilename(input) {
    const name = String(input || "download").replace(/\\/g, "/").split("/").pop().replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return (name || "download").slice(0, 180);
}
function findMultipartFile(body, boundary, fieldName) {
    const marker = Buffer.from("--" + boundary);
    let cursor = 0;
    while (true) {
        const markerAt = body.indexOf(marker, cursor);
        if (markerAt < 0) return null;
        let start = markerAt + marker.length;
        if (body.subarray(start, start + 2).toString() === "--") return null;
        if (body.subarray(start, start + 2).toString() === "\r\n") start += 2;
        const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), start);
        if (headerEnd < 0) return null;
        const headerText = body.subarray(start, headerEnd).toString("latin1");
        const nextPart = body.indexOf(marker, headerEnd + 4);
        if (nextPart < 0) return null;
        const dataEnd = nextPart >= 2 && body.subarray(nextPart - 2, nextPart).toString() === "\r\n" ? nextPart - 2 : nextPart;
        const disposition = headerText.match(/content-disposition:\s*form-data;[^\r\n]*/i)?.[0] || "";
        const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1];
        const rawFilename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
        if (name === fieldName && rawFilename !== undefined) {
            const filename = Buffer.from(rawFilename, "latin1").toString("utf8");
            const type = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "application/octet-stream";
            return {filename: cleanFilename(filename), type, data: body.subarray(headerEnd + 4, dataEnd)};
        }
        cursor = nextPart;
    }
}
function publicAttachment(record) {
    return {id: record.id, name: record.filename, size: record.size, type: record.type, url: "/media/" + record.id, downloadUrl: "/download/" + record.id};
}

function createRoom(token, name=null, desc=null, privacy=null) {
    const roomId = crypto.randomBytes(16).toString("hex");
    const alias = name??"room #"+roomId.slice(0,5)
    console.log(`${DB.users[token].name} (${token}) opened a new room "${alias}"${privacy?"("+privacy+")":""} with id ${roomId}`);

    roomsDB[roomId] = {
        alias,
        description: desc??"",
        icon: "default-icon.jpeg",
        members: [token],
        size: 1,
        created: {
            creator: token,
            timestamp: Date.now()
        },
        privacy: privacy??"Public",
        inviteCode: (privacy ?? "Public") === "Public" ? crypto.randomBytes(24).toString("base64url") : null,
        builtin:false
    }
    DB.users[token].rooms.push(roomId);
    dumpDBs();
    return roomId
}

function profileView(username) {
    const header = username in DB["users"] ? [200, {"Content-Type": "application/json"}] : [404, {}];
    const pk = DB[username]["token"];

    let html = `
    <html lang="en">
    <head><meta charset="utf-8"><link href="/style.css" rel="stylesheet"></head>
    <body>
        <div class="settings-panel">
            <h2>${username}</h2>
            <p>${pk}</p>
            <p></p>
        </div>
    </body>
    </html>`;

    return [header, html];
}

// metadata-safe. maybe revert to simple checks during high load
function isValid(token) {
    return DB.validTokens.includes(token);
}

function getCookie(request, name) {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(";").reduce((acc, cookie) => {
        const [key, value] = cookie.trim().split("=");
        if (key && value) {
            acc[key] = decodeURIComponent(value);
        }
        return acc;
    }, {});

    return cookies[name] || null;
}

function deriveID(a,b,c) {
    return crypto.randomUUID();
}

async function sendPushNotifications(room, msg, senderToken) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY)
        return;

    const sends = [];

    Object.entries(DB.users).forEach(([token, user]) => {
        if (token === senderToken) return;
        if (!user || !Array.isArray(user.rooms)) return;
        if (!user.rooms.includes(room)) return;
        if (!Array.isArray(user.pushSubscriptions)) return;

        user.pushSubscriptions.forEach(subscription => {
            sends.push(
                webpush.sendNotification(
                    subscription,
                    JSON.stringify({
                        title: msg.sender,
                        body: "New message",
                        room: room
                    })
                ).catch(err => {
                    if (err.statusCode === 404 || err.statusCode === 410) {
                        user.pushSubscriptions =
                            user.pushSubscriptions.filter(
                                s => s.endpoint !== subscription.endpoint
                            );
                        dumpDBs();
                    } else {
                        console.error(
                            "Push notification failed:",
                            err.statusCode || err.message
                        );
                    }
                })
            );
        });
    });

    await Promise.allSettled(sends);
}

function loadHistory(historyFile="history.json") {
    try {
        history = JSON.parse(fs.readFileSync(historyFile));
        fs.unlinkSync(historyFile);
    }
    catch (e) {}
}

function refreshDBs() {
    roomsDB = loadJson("rooms.json", {});
    DB = loadJson("database.json", {validTokens: [], users: {}, admins: []});
    ensureDefaultRoom();
    ensureLegacyAccounts();
}

function ensureDefaultRoom() {
    let changed = false;
    if (!roomsDB["0"]) {
        roomsDB["0"] = {
            alias: "global",
            icon: "default-icon.jpeg",
            members: [],
            size: 0,
            created: {creator: "SERVER", timestamp: Date.now()},
            description: "The public Xessenger room.",
            privacy: "Public",
            builtin: true
        };
        changed = true;
    }
    const room = roomsDB["0"];
    if (!Array.isArray(room.members)) {
        room.members = [];
        changed = true;
    }
    for (const [userToken, user] of Object.entries(DB.users || {})) {
        if ((user?.rooms || []).some(id => String(id) === "0") && !room.members.includes(userToken)) {
            room.members.push(userToken);
            changed = true;
        }
    }
    if (room.size !== room.members.length) {
        room.size = room.members.length;
        changed = true;
    }
    if (!room.created) {
        room.created = {creator: "SERVER", timestamp: Date.now()};
        changed = true;
    }
    if (!room.description) room.description = "";
    if (!room.privacy) room.privacy = "Public";
    if (changed) dumpDBs();
}

function dumpDBs() {
    writeJsonAtomic("rooms.json", roomsDB);
    writeJsonAtomic("database.json", DB);
}

function gracefulShutdown(signalOrError, SAVE_MESSAGES=false, historyFile="history.json", originUser="", originPath="") {
    console.log(`\nInitiating ${SAVE_MESSAGES?"soft":"hard"} shutdown due to: ${signalOrError}`);
    //console.log(`this happened when user ${originUser} accessed ${originPath}`);
    if (SAVE_MESSAGES) {
        console.log("saving history to", historyFile);
        fs.writeFileSync(historyFile,JSON.stringify(history));
    }
    process.exit(1)
}
process.on("SIGINT", () => gracefulShutdown("SIGINT (Ctrl+C)", false));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM (PM2)", true));
process.on("uncaughtException", (err) => {gracefulShutdown("uncaughtException: "+err, true);});
process.on("unhandledRejection", (reason, promise) => {gracefulShutdown("unhandledRejection"+reason, true);});
