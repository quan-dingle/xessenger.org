let openConnections = {};
let screenshots = {};
let history = {0:[{
    "id": 1,
    "sender": "SERVER",
    "content": "This is the Start of your Conversation",
    "timestamp": new Date().getTime()
}]}
loadHistory();

/*
TODO:|\/\|\/\|\/\|\/\|\/\|\/\|\/
- migrate history loading from /stream endpoint on connection to /history to avoid duplicate sent messages
- user and server settings
- privacy types
- better room selector
*/

const isServer = true;//os.hostname() === "vmd197130";
console.log("launched as",os.hostname()+", currently in",isServer?"prod":"dev")
import os from "os";
import http from "http";
import {chromium} from "playwright";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import webpush from "web-push";
//import {promisify} from "util";
//import {execFile} from "child_process";

let DB = JSON.parse(fs.readFileSync("database.json"));
let roomsDB = JSON.parse(fs.readFileSync("rooms.json"));
const PORT = 5000;
const logFile = "logs.json";
//const CSS = fs.readFileSync("public/style.css").toString();
//const JS = fs.readFileSync("public/app.js").toString();
//const HTML = fs.readFileSync("public/index.html").toString();
//const BG = fs.readFileSync("public/background.js").toString();
const ICON = fs.readFileSync("public/favicon.ico");
const TOKEN_PROMPT = fs.readFileSync("public/tokenPrompt.html").toString();
const SIGNUP_PROMPT = fs.readFileSync("public/signUpPrompt.html").toString();

const VAPID_PUBLIC_KEY = "BJtwdRA1F6eurSRB4zZxM9d5iFieUegC9LkpbtIyZkcz0r1ODzl6WB1c3RxdYQ7yLU52Z4mi0UCFij0fTyj4J-Y";
const VAPID_PRIVATE_KEY = "KiWOnseM2PISigCgrjT5F_CnhdfS19a1D18LRFjVBM8";
const VAPID_SUBJECT = "mailto:admin@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
    console.log("push notifications disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set");
}

console.log("running on port " + PORT);

// MAIN SERVER
const server = http.createServer((req, res) => {
    roomsDB = JSON.parse(fs.readFileSync("rooms.json"));
    DB = JSON.parse(fs.readFileSync("database.json"))
    const token = getCookie(req, "token");
    const user = DB.users[token] ?? {};

    // UNAUTHORIZED USER - token prompt
    if (!token || !isValid(token)) {
        res.writeHead(404, {"Content-Type": "text/html"});
        res.end(TOKEN_PROMPT); return;
    }

    // let user sign up (see next)
    if (req.url.startsWith("/register")) {
        let usr;
        try {usr = decodeURIComponent(req.url.split("/").at(-1));} catch (e) {console.log(url);return;}

        const nameExists = Object.entries(DB.users).some(([t, u]) => {
            const existingName = typeof u === 'string' ? u : u?.name;
            return existingName === usr && t !== token;
        });
        if (nameExists) {
            res.writeHead(400, {"Content-Type": "application/json"});
            res.end(JSON.stringify({error: "Username already taken"}));return;
        }

        DB.users[token] = {name:usr, rooms: [0], created: {ip: req.remoteAddress, timestamp: Date.now()}};
        fs.writeFileSync("database.json", JSON.stringify(DB, null, 2));
        console.log(token, "signed up via", req.url);
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end("all well"); return;
    }

    // UNKNOWN USER - send signup prompt
    if (!DB.users[token]) {
        console.log(DB["users"][token]);
        res.writeHead(200, {"Content-Type": "text/html"});
        res.end(SIGNUP_PROMPT); return;
    }

    // ---------------------------- AUTHORIZED ------------------------------
    // statics (mostly)
    if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, {"Content-Type": "text/html"});
        res.end(fs.readFileSync("public/index.html").toString());
        return;
    }
    if (req.url === "/style.css") {
        res.writeHead(200, {"Content-Type": "text/css"});
        res.end(fs.readFileSync("public/style.css").toString());
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

    if (req.url === "/api/create-room") {
        let data = "";
        req.on("data", (chunk) => data += chunk);
        req.on("end", () => {
            let body = JSON.parse(data);
            const alias = body.alias;
            const desc = body.desc;
            const privacy = body.privacy;

            const do_it = new Promise(() =>
            createRoom(token, alias, desc, privacy))
                .then(r => res.writeHead(r?200:400))
                .then(res.end());
        })
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

    const rooms = DB["users"][token]["rooms"]
    const room = Number(getCookie(req, "room")) || rooms[0];
    if (!rooms.includes(room)) {
        res.writeHead(200, {"Content-Type": "text/html"});
        console.log(token,"with authorization for rooms",rooms.join(", "),"tried to access room",room)
        res.end("you are not authorized for this room!"); return;
    }

    if (req.url.startsWith("/api/room-data")) {
        const r = roomsDB[room];
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({
            id:room,
            alias:r.alias,
            description: r.description,
            members: [r.members.map(m=>DB.users[m])],
            admins: [r.created.creator],
            created:r.created.timestamp
        })); return;
    }

    if (req.url === "/api/add-user") {
        //TODO
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
                    attachment: parsed.attachment,
                };

                const hyperlink = msg.content.match(/https?:\/\/[^\s]+/)?.[0]??"";
                if (hyperlink) {
                    if (screenshots[hyperlink]) {
                        msg.previewLink = screenshots[hyperlink];
                        console.log("successfully provided the link", msg.previewLink,"to user",user.name)
                    }
                    else{
                        screenshotWebsite(hyperlink).then((lnk)=>{
                        screenshots[hyperlink]=lnk;
                        msg.previewLink = lnk;
                        console.log(user.name,"requested to load",hyperlink+". saved file to:",lnk);
                    });}

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
    if(req.url.startsWith("/assets/websites/")) {
        res.writeHead(200, {"Content-Type": "image/jpeg"});
        let f = null;
        try {res.end(fs.readFileSync(req.url.toString().replace("/","",1)));}
        catch {
            console.log("invalid asset req from", user.name)
            res.end("");}
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
        else {
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
            sendNext();
            /* this will send instantly:
            history[room].forEach(msg => {
                res.write(`data: ${JSON.stringify(msg)}\n\n`);
            });
            */
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

                fs.writeFileSync(
                    "database.json",
                    JSON.stringify(DB, null, 2)
                );

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

                    fs.writeFileSync(
                        "database.json",
                        JSON.stringify(DB, null, 2)
                    );
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
    res.end(fs.readFileSync("patterns/background.html"))
    //res.end("what the fuck did you request?");

}).listen(PORT,"127.0.0.1");


function addUserToRoom(userid,roomid,initiator=null) {
    if (roomsDB[roomid].members.includes(userid)) return false
    DB[userid].rooms.push(roomid);
    roomsDB[roomid].members.push(userid);
    roomsDB[roomid].size += 1;

    fs.writeFileSync("rooms.json",JSON.stringify(roomsDB));
    fs.writeFileSync("database.json",JSON.stringify(DB));
}

function leaveRoom(userid, roomid, initiator=null) {
    if (!DB[userid].rooms.includes(roomid)) return false;
    DB[userid].rooms = DB[userid].rooms.filter(id => id !== roomid);
    roomsDB[roomid].members = roomsDB[roomid].members.filter(id => id !== userid);

    fs.writeFileSync("rooms.json",JSON.stringify(roomsDB));
    fs.writeFileSync("database.json",JSON.stringify(DB));
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
        builtin:false
    }
    DB.users[token].rooms.push(roomId);

    fs.writeFileSync("rooms.json",JSON.stringify(roomsDB));
    fs.writeFileSync("database.json",JSON.stringify(DB));
    return true
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
    return crypto.createHash("sha256").update(a+b+c+crypto.randomBytes(20).toString("hex")).digest().toString();
}

async function screenshotWebsite(url, width = 800, height = 450) {
    const browser = await chromium.launch({headless: !isServer,channel:"chromium"});
    try {
        const page = await browser.newPage({
            viewport: {width, height}
        });

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 10000
        });

        await page.waitForTimeout(300);

        const name = crypto.randomBytes(12).toString("hex") + ".jpeg";
        const file = path.join("assets/websites", name);

        await page.screenshot({
            path: file,
            type: "jpeg",
            quality: 80,
            animations: "disabled"
        });

        return file;
    } finally {
        await browser.close();
    }
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

                        fs.writeFileSync(
                            "database.json",
                            JSON.stringify(DB, null, 2)
                        );
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
