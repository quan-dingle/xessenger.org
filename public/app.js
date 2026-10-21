let myName = "";
let roomName = "";
let aliases = {};
let activeRoom = 0;
let selectedFile = null;
let scriptChange = false;
let history = [];

let editingMessage = false;

const print = console.log;

const appContainer = document.getElementById('app-container');

/*
TODO:
- embeds for tt, reels
- room config
- admin panel
*/

// loads user data
async function init() {
    try {
        const response = await fetch("/UserName");
        const data = await response.json();

        myName = data.name;
        const roomsMap = data.rooms || {};
        const pfp = document.getElementById("pfp");
        if (pfp) pfp.src = data.avatar || "/pfp";
        const roomIds = Object.keys(roomsMap);

        activeRoom = ""+(getCookie("room") || (roomIds[0]) || 0);
        document.cookie = `room=${activeRoom}; path=/`;

        roomName = roomsMap[activeRoom] || activeRoom;
        document.title = `XS - ${roomName}`;

        const roomSelector = document.getElementById("room-selector");
        if (roomSelector) {
            roomSelector.innerHTML = roomIds.map(room => {
                const alias = roomsMap[room];
                const isSelected = ""+(room) === ""+(activeRoom) ? "selected" : "";
                return `<option value="${room}" ${isSelected}>${alias}</option>`;
            }).join("");//+ `<option value="create_room">+</option>`;
        }

        const query = new URLSearchParams(location.search);
        if (query.has("join") && query.has("invite")) {
            const joinResponse = await fetch("/api/join-room", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:query.get("join"),invite:query.get("invite")})});
            const joinData = await joinResponse.json().catch(()=>({}));
            if (!joinResponse.ok) alert(joinData.error || "Could not join this room.");
            else { document.cookie=`room=${joinData.id}; path=/`; location.replace(location.pathname); }
        }
        const prefs = localStorage.getItem("prefs");
        if (prefs) applyPrefs(JSON.parse(prefs));

    } catch (err) {
        console.error("Initialization failed:", err);
    }
}

// sets up SSEs
async function start() {
    await init();
    document.getElementById("chat").innerHTML = "";
    await void askForPushes();

    //const h = await (await fetch("/history")).text();
    //h.forEach(m => {history.push(m);addMessage(m)});

    const stream = new EventSource("/stream");
    stream.onmessage = event => {
        const data = JSON.parse(event.data);
        history.push(data);
        addMessage(data);
    };
    stream.onerror = e=> {Object.entries(document.getElementsByClassName("message-container")).forEach((k,v) => k[1].remove());history=[]}
}
void start();

// Push opt-in lives in a fixed app-level card, never inside the scrolling transcript.
async function askForPushes() {
    const prefs = JSON.parse(localStorage.getItem("prefs")) || {};
    if (prefs.dontAskPushes || prefs.pushNotifications || !("Notification" in window)) return;
    const host = document.getElementById("push-prompt-host");
    if (!host || document.getElementById("push-prompt")) return;
    const card = document.createElement("section");
    card.id = "push-prompt";
    card.innerHTML = `<button type="button" id="push-dismiss" aria-label="Close">×</button><div class="push-copy"><strong>Stay in the loop</strong><span>Get notified when new messages arrive.</span><small id="push-status">Notifications are optional.</small></div><button type="button" id="push-confirmation">Enable</button><button type="button" id="stop-asking">Not now</button>`;
    host.appendChild(card);
    card.querySelector("#stop-asking").onclick = card.querySelector("#push-dismiss").onclick = () => {
        prefs.dontAskPushes = true; localStorage.setItem("prefs", JSON.stringify(prefs)); card.remove();
    };
    card.querySelector("#push-confirmation").onclick = async event => {
        const button = event.currentTarget, status = card.querySelector("#push-status");
        button.disabled = true; button.textContent = "Enabling…"; status.textContent = "Waiting for browser permission and registering this device…";
        try {
            const ok = await setupPushNotifications();
            if (!ok) throw new Error("Could not register push notifications. Check VAPID configuration and browser permission, then retry.");
            prefs.pushNotifications = true; prefs.dontAskPushes = false; localStorage.setItem("prefs", JSON.stringify(prefs));
            const registration = await navigator.serviceWorker.ready;
            await registration.showNotification("Xessenger test notification", {body:"Push notifications are working on this device.", icon:"/favicon.ico", tag:"xsngr-test"});
            card.remove();
        } catch (error) {
            status.textContent = error.message || "Setup failed. Please try again.";
            button.disabled = false; button.textContent = "Try again";
        }
    };
}

document.getElementById("room-selector").addEventListener("change", e => {changeRoom(e.target.value);});
document.getElementById("msg").addEventListener("keydown", e => { if (e.key === "Enter") void send(); });
document.getElementById("send-msg").addEventListener("click", e => { e.preventDefault(); void send(); });
document.getElementById("open-prefs").addEventListener("click", () => { open_prefs(); });
document.getElementById("pfp").addEventListener("click", openProfileEditor);
document.getElementById("pfp").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") openProfileEditor(); });
document.getElementById("upload").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = false;
    input.onchange = event => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) {
            alert("Files are limited to 50 MiB.");
            return;
        }
        selectedFile = file;
        const old = document.getElementById("preview");
        if (old) old.remove();
        const preview = document.createElement("div");
        preview.id = "preview";
        preview.className = "preview";
        if (file.type && file.type.startsWith("image/")) {
            const img = document.createElement("img");
            img.src = URL.createObjectURL(file);
            img.alt = file.name;
            preview.appendChild(img);
        } else {
            const info = document.createElement("div");
            info.className = "file-preview";
            const name = document.createElement("strong");
            name.textContent = file.name;
            const size = document.createElement("span");
            size.textContent = formatFileSize(file.size);
            info.append(name, size);
            preview.appendChild(info);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-upload";
        remove.textContent = "×";
        remove.setAttribute("aria-label", "Remove attachment");
        remove.addEventListener("click", event => {
            event.stopPropagation();
            preview.remove();
            selectedFile = null;
        });
        preview.appendChild(remove);
        document.body.append(preview);
    };
    input.click();
});
document.addEventListener("keypress", e => { if (e.key === "Escape") open_prefs(); });

// switch chatroom
function changeRoom(room) {
    //if (room==="create_room") return createRoom();
    document.cookie = "room=" + room+"; path=/";
    if (activeRoom!==room&&(activeRoom||room)) { //room!==activeRoom&&(!room||!activeRoom
        scriptChange = true;
        window.remove_script();
        delete window.remove_script;

        document.getElementById("bg-script").remove();

        const newScript = document.createElement("script");
        newScript.src = "/background.js?v=" + Date.now();
        newScript.id = "bg-script";
        document.body.appendChild(newScript);
    }
    activeRoom = ""+(room);
    void start();
}

// compress and convert before sending
function compressImage(file, maxWidth = 1280, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = (err) => reject(err);
    });
}

// IDK what this function is for, but it's prolly used to send messages
async function send() {
    const input = document.getElementById("msg");
    const msg = input.value.trim();
    const file = selectedFile;
    if (!msg && !file) return;
    input.value = "";
    const temp = addTempMessage(myName, msg, "pending", file);
    try {
        let attachment = null;
        if (file) {
            const form = new FormData();
            form.append("file", file, file.name);
            const uploadResponse = await fetch("/api/upload", {method: "POST", body: form});
            const uploadData = await uploadResponse.json().catch(() => ({}));
            if (!uploadResponse.ok) throw new Error(uploadData.error || "Upload failed.");
            attachment = uploadData;
        }
        const response = await fetch("/send", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({message: msg, attachment})
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Message could not be sent.");
        }
        selectedFile = null;
        const preview = document.getElementById("preview");
        if (preview) preview.remove();
    } catch (error) {
        input.value = msg;
        alert(error.message || "Could not send message.");
    } finally {
        temp.remove();
    }
}

// pipeline for rendering new messages
// get link and generate preview if applicable
function createPreviewElement(content) {
    const match = content && content.match(/https?:\/\/[^\s<>"']+/);
    if (!match) return null;
    const link = match[0].replace(/[),.;!?]+$/, "");
    let url;
    try { url = new URL(link); } catch { return null; }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let embedUrl = "";
    let label = url.hostname;
    if (host === "youtu.be") {
        const id = url.pathname.split("/").filter(Boolean)[0];
        if (id) { embedUrl = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id); label = "YouTube"; }
    } else if (host === "youtube.com" || host === "m.youtube.com") {
        const id = url.searchParams.get("v") || (url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/) || [])[1];
        if (id) { embedUrl = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id); label = "YouTube"; }
    } else if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
        const id = (url.pathname.match(/\/video\/(\d+)/) || [])[1];
        if (id) { embedUrl = "https://www.tiktok.com/embed/v2/" + encodeURIComponent(id); label = "TikTok"; }
    } else if (host === "instagram.com" || host.endsWith(".instagram.com")) {
        const matchPath = url.pathname.match(/^\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
        if (matchPath) {
            const type = matchPath[1] === "reels" ? "reel" : matchPath[1];
            embedUrl = "https://www.instagram.com/" + type + "/" + encodeURIComponent(matchPath[2]) + "/embed";
            label = "Instagram";
        }
    } else if (host === "x.com" || host === "twitter.com") {
        label = "X / Twitter";
    }

    const preview = document.createElement("div");
    preview.className = "link-preview";
    const body = document.createElement("div");
    body.className = "link-preview-body";
    const card = document.createElement("a");
    card.className = "external-link-card";
    card.href = url.href;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    const icon = document.createElement("span");
    icon.className = "external-link-icon";
    icon.textContent = "↗";
    const info = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = label;
    const detail = document.createElement("small");
    detail.textContent = url.hostname + url.pathname;
    info.append(title, detail);
    card.append(icon, info);
    body.appendChild(card);

    if (embedUrl) {
        const reveal = document.createElement("button");
        reveal.className = "embed-reveal";
        reveal.type = "button";
        reveal.textContent = "Load " + label + " embed";
        reveal.addEventListener("click", () => {
            const iframe = document.createElement("iframe");
            iframe.src = embedUrl;
            iframe.title = label + " preview";
            iframe.loading = "lazy";
            iframe.referrerPolicy = "strict-origin-when-cross-origin";
            iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
            iframe.allowFullscreen = true;
            body.replaceChildren(iframe);
        }, {once: true});
        body.appendChild(reveal);
    }
    const controls = document.createElement("div");
    controls.className = "link-preview-footer";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "▴";
    toggle.title = "Collapse preview";
    toggle.addEventListener("click", () => {
        body.hidden = !body.hidden;
        toggle.textContent = body.hidden ? "▾" : "▴";
    });
    const open = document.createElement("a");
    open.href = url.href;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "Open ↗";
    controls.append(toggle, open);
    preview.append(body, controls);
    return preview;
}

function renderAttachmentHtml(attachment) {
    if (typeof attachment === "string") {
        if (attachment.startsWith("data:image/")) {
            return '<div class="attachment-bubble"><img src="' + escapeHtml(attachment) + '" alt="[image attachment]"></div>';
        }
        return "";
    }
    if (attachment instanceof Blob || attachment instanceof File) {
        const url = URL.createObjectURL(attachment);
        const name = attachment.name || "Attachment";
        if (attachment.type && attachment.type.startsWith("image/")) {
            return '<div class="attachment-bubble"><img src="' + escapeHtml(url) + '" alt="' + escapeHtml(name) + '"></div>';
        }
        return '<div class="attachment-bubble file-card"><span class="file-type">' + escapeHtml(name.split(".").pop().slice(0,8).toUpperCase()) + '</span><span class="file-info"><strong>' + escapeHtml(name) + '</strong><small>' + formatFileSize(attachment.size || 0) + '</small></span></div>';
    }
    const name = attachment.name || "Attachment";
    const type = attachment.type || "application/octet-stream";
    const url = attachment.url || "";
    const downloadUrl = attachment.downloadUrl || url;
    const size = formatFileSize(attachment.size || 0);
    const safeName = escapeHtml(name);
    const safeUrl = escapeHtml(url);
    const safeDownload = escapeHtml(downloadUrl);
    if (type.startsWith("image/") && url) {
        return '<div class="attachment-bubble file-image"><a href="' + safeDownload + '" download="' + safeName + '"><img src="' + safeUrl + '" alt="' + safeName + '" loading="lazy"></a><a class="file-download" href="' + safeDownload + '" download="' + safeName + '">Download ' + safeName + ' · ' + size + '</a></div>';
    }
    if (type.startsWith("audio/") || type.startsWith("video/")) {
        const player = type.startsWith("audio/") ? "audio" : "video";
        return '<div class="attachment-bubble file-card"><span class="file-type">' + escapeHtml(name.split(".").pop().slice(0,8).toUpperCase()) + '</span><span class="file-info"><strong>' + safeName + '</strong><small>' + size + '</small></span><a class="file-download" href="' + safeDownload + '" download="' + safeName + '">Download</a><' + player + ' controls preload="none" src="' + safeUrl + '"></' + player + '></div>';
    }
    return '<div class="attachment-bubble file-card"><span class="file-type">' + escapeHtml(name.split(".").pop().slice(0,8).toUpperCase()) + '</span><span class="file-info"><strong>' + safeName + '</strong><small>' + escapeHtml(type) + ' · ' + size + '</small></span><a class="file-download" href="' + safeDownload + '" download="' + safeName + '">Download ↧</a></div>';
}

function formatFileSize(size) {
    size = Number(size);
    if (!Number.isFinite(size) || size < 0) return "file";
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + " MB";
    return (size / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// message edits and deletions
function handleMessageEdit(id, content) {
    const prev = document.getElementById(id);
    if (!prev) return false;

    if (!content) { // deleted message
        prev.classList.add("deleted-message");
        prev.querySelectorAll(".bubble").forEach(b=>b.innerHTML = "(this message was deleted)");
        prev.querySelectorAll(".attachment-bubble").forEach(a=>a.remove());
        prev.querySelectorAll(".edited-tag").forEach(a=>a.remove());

        return true;
    }

    // edited counter
    let editedTag = document.getElementById("tag" + id);
    if (!editedTag) {
        editedTag = document.createElement("div");
        editedTag.id = "tag" + id;
        editedTag.className = "edited-tag";
        editedTag.innerText = "edited";
        editedTag.dataset.counter = 1;
    } else {
        editedTag.dataset.counter = (+editedTag.dataset.counter || 0) + 1;
        editedTag.innerText = "edited - " + editedTag.dataset.counter;
    }

    const bubble = prev.querySelector(".bubble");
    if (bubble) bubble.innerText = content;

    prev.appendChild(editedTag);
    prev.classList.add("edited");
    return true;
}

// is same sender? and is yours or foreign?
function applySenderStyling(chat, container, sender) {
    if (sender === myName) container.classList.add("self");

    const lastMessage = chat.lastElementChild;
    const isSameSender = lastMessage && lastMessage.dataset.sender === sender;

    if (isSameSender) {
        container.classList.add("consecutive");
        container.style.marginTop = "5px";

        lastMessage.classList.remove("bottom");
        const secondLastMessage = lastMessage.previousSibling;
        if (secondLastMessage && secondLastMessage.dataset.sender === sender) {
            lastMessage.classList.add("middle");
        } else {
            lastMessage.classList.add("top");
        }
    }
    return isSameSender;
}


function addMessage(data) {
    const { sender, content, timestamp, attachment, id, previewLink } = data;
    const chat = document.getElementById("chat");

    if (!id) return print(id, "received message without ID from", sender + ":", content);

    if (handleMessageEdit(id, content)) return;

    const container = document.createElement("div");
    container.className = "message-container bottom";
    container.dataset.sender = sender;
    container.dataset.timestamp = timestamp;
    container.id = id;

    const isSameSender = applySenderStyling(chat, container, sender);
    const bubbleHtml = content ? `<div class="bubble">${escapeHtml(content)}</div>` : '';

    const attachmentHtml = attachment ? renderAttachmentHtml(attachment) : "";

    container.innerHTML = `
        ${!isSameSender ? `
        <div class="message-header">
            <span class="sender">${escapeHtml(aliases[sender] || sender)}</span>
            <span class="time">${escapeHtml(getTime(timestamp))}</span>
        </div>` : ''}
        ${attachmentHtml}
        ${bubbleHtml}
    `;

    if(previewLink)print("preview link:",previewLink);
    const previewElement = createPreviewElement(content, previewLink);
    if (previewElement) container.appendChild(previewElement);
    chat.appendChild(container);

    const bubble = container.querySelector(".bubble");
    const attachmentBubble = container.querySelector(".attachment-bubble");
    if (bubble) bubble.onclick = () => contextMenu(container);
    if (attachmentBubble) attachmentBubble.addEventListener("click", () => {
    	  if (document.fullscreenElement) document.exitFullscreen();
    	  else attachmentBubble.requestFullscreen();
    	  });
    chat.scrollTop = chat.scrollHeight;
}

// before SSE returns your msg, a silhouette/temp message is shown
function addTempMessage(sender, msg, time = "pending", attachment = null) {
    const chat = document.getElementById("chat");
    const container = document.createElement("div");
    container.className = "message-container self-temp";
    container.dataset.sender = sender;

    if (sender === myName) {
        container.classList.add("self bottom");
    }

    // Check consecutive sender for temp messages too
    const lastMessage = chat.lastElementChild;
    const isSameSender = lastMessage && lastMessage.dataset.sender === sender;
    if (isSameSender) {
        container.classList.add("consecutive");
    }

    let bubbleHtml = msg ? `<div class="bubble">${escapeHtml(msg)}</div>` : '';

    const attachmentHtml = attachment ? renderAttachmentHtml(attachment) : "";

    container.innerHTML = `
        ${!isSameSender ? `
        <div class="message-header">
            <span class="sender">${escapeHtml(aliases[sender] || sender)}</span>
            <span class="time">pending</span>
        </div>` : ''}
        ${attachmentHtml}
        ${bubbleHtml}
    `;

    chat.appendChild(container);
    chat.scrollTop = chat.scrollHeight;
    return container;
}

// tine helpers
function getTime(t) {return new Date(t).toISOString().split("T")[1].split(".")[0];}
function escapeHtml(text) {
    const div = document.createElement("div");
    div.innerText = String(text ?? "");
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const hexToRgb = hex => `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`;
function getCookie(name) {return ('; ' + document.cookie).split("; " + name + "=").pop().split(';')[0];}
function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const rawData = atob(base64);

    return Uint8Array.from(
        [...rawData].map(char => char.charCodeAt(0))
    );
}
async function setupPushNotifications() {
    if (!("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)) {

        print("push notifications are not supported by this browser");
        return false;
    }

    try {
        const permission = await Notification.requestPermission();

        if (permission !== "granted") {
            print("notification permission was not granted");
            return false;
        }

        const keyResponse = await fetch("/push/vapid-public-key");

        if (!keyResponse.ok)
            throw new Error("could not get VAPID public key");

        const keyData = await keyResponse.json();

        const registration =
            await navigator.serviceWorker.register("/push-worker.js");

        let subscription =
            await registration.pushManager.getSubscription();

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey:
                    urlBase64ToUint8Array(keyData.publicKey)
            });
        }

        const response = await fetch("/push/subscribe", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(subscription)
        });

        if (!response.ok)
            throw new Error("could not save push subscription");

        print("push notifications enabled");
        return true;

    } catch (e) {
        console.error("push notification setup failed:", e);
        return false;
    }
}

// user settings ("preferences" sounded fancier)
function applyPrefs(p) {
    if (!p) return;
    document.body.classList.toggle("light-mode", p.lightMode);
    if (p.bub) document.documentElement.style.setProperty('--bub', hexToRgb(p.bub));
    if (p.myBub) document.documentElement.style.setProperty('--my-bub', hexToRgb(p.myBub));
    if (p.alpha) document.documentElement.style.setProperty('--alpha', p.alpha);
    if (p.fsize) document.documentElement.style.setProperty("--fsize", p.fsize);

    // Handle push notification preference
    if (p.pushNotifications && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    aliases = p.aliases || {};
    document.querySelectorAll(".message-container").forEach(c => {
        const c2 = c.querySelector(".sender");
        if (c2) c2.innerText = escapeHtml(aliases[c.dataset.sender] || c.dataset.sender)
    });
}
function open_prefs() {
    const p = JSON.parse(localStorage.getItem("prefs")) || {}, overlay = document.createElement("div");
    overlay.className = "modal-overlay"; overlay.id = "prefs-modal";
    const als = p.aliases ? Object.entries(p.aliases).map(([k,v]) => `${k}=${v}`).join(",") : "";

    overlay.innerHTML = `<div class="modal-panel"><h2>Settings</h2>
        <div class="setting"><label class="settings-switch"><p>Light Mode</p><input type="checkbox" id="p-light" ${p.lightMode?"checked":""}><span class="switch-slider"></span></label></div>
        <div class="setting"><label class="settings-switch"><p>Push Notifications</p><input type="checkbox" id="p-push" ${p.pushNotifications?"checked":""}><span class="switch-slider"></span></label></div>
        <div class="form-field"><label>Other Bubble</label><input type="color" id="p-bub" value="${p.bub||'#2b2d31'}"></div>
        <div class="form-field"><label>My Bubble</label><input type="color" id="p-mybub" value="${p.myBub||'#2563eb'}"></div>
        <div class="form-field"><label>Opacity</label><input type="range" id="p-alpha" min="0.1" max="1" step="0.005" value="${p.alpha||'0.75'}"></div>
        <div class="form-field"><label>Font Size</label><input type="range" id="p-fsize" min="0.5" max="2" step="0.001" value="${p.fsize||'1.0'}"></div>
        <div class="form-field"><label>Aliases (user=alias,...)</label><input type="text" id="p-alias" value="${als}"></div>
        <div class="btn-group"><button class="btn-cancel btn" onclick="close_prefs()">Cancel</button><button class="btn-save btn" onclick="save_prefs()">Save</button></div></div>`;

    document.body.appendChild(overlay); document.getElementById("app-container").style.filter = "blur(8px)";

    // listeners for live preview
    const opacity = document.getElementById("p-alpha");
    opacity.addEventListener("input", () => {document.documentElement.style.setProperty('--alpha', opacity.value.trim());});
    const scaler = document.getElementById("p-fsize");
    scaler.addEventListener("input", () => {document.documentElement.style.setProperty("--fsize", scaler.value.trim());});
}
function close_prefs() {
    document.getElementById("prefs-modal").remove();
    document.getElementById("app-container").style.filter = "none";
}
function save_prefs() {
    const aliasObj = {};
    document.getElementById("p-alias").value.split(",").forEach(x => { const [k,v] = x.split("="); if(v) aliasObj[k.trim()] = v.trim(); });

    const pushChecked = document.getElementById("p-push").checked;

    // Request browser notification permission if checked and not already granted
    if (pushChecked && "Notification" in window && Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    const prefs = {
        lightMode: document.getElementById("p-light").checked,
        pushNotifications: pushChecked,
        bub: document.getElementById("p-bub").value,
        myBub: document.getElementById("p-mybub").value,
        alpha: document.getElementById("p-alpha").value,
        aliases: aliasObj,
        fsize: document.getElementById("p-fsize").value
    };

    localStorage.setItem("prefs", JSON.stringify(prefs));
    applyPrefs(prefs);
    close_prefs();
}

async function openProfileEditor() {
    const existing = document.getElementById("profile-modal"); if (existing) existing.remove();
    const overlay = document.createElement("div"); overlay.className = "modal-overlay"; overlay.id = "profile-modal";
    overlay.innerHTML = `<section class="modal-panel profile-editor"><button class="room-close profile-close" type="button" aria-label="Close">×</button><h2>Your profile</h2><div class="profile-avatar-row"><img id="profile-avatar-preview" src="/pfp" alt="Profile picture"><label class="btn btn-cancel" for="profile-avatar-file">Change photo</label><input id="profile-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><label class="form-field"><span>Display name</span><input id="profile-edit-name" maxlength="32" autocomplete="nickname"></label><label class="form-field"><span>About you</span><textarea id="profile-edit-bio" maxlength="240" rows="3" placeholder="A short bio (optional)"></textarea></label><p class="profile-status" id="profile-status"></p><div class="btn-group"><button class="btn btn-cancel" id="profile-cancel" type="button">Cancel</button><button class="btn btn-save" id="profile-save" type="button">Save profile</button></div></section>`;
    document.body.appendChild(overlay); overlay.querySelector(".profile-close").onclick = overlay.querySelector("#profile-cancel").onclick = () => overlay.remove();
    const status = overlay.querySelector("#profile-status"), avatar = overlay.querySelector("#profile-avatar-preview"); let avatarData = "";
    try { const response = await fetch("/api/profile"); if (!response.ok) throw new Error("Could not load profile."); const data = await response.json(); overlay.querySelector("#profile-edit-name").value = data.name || myName; overlay.querySelector("#profile-edit-bio").value = data.bio || ""; avatarData = data.avatar || ""; avatar.src = avatarData || "/pfp"; }
    catch (e) { status.textContent = e.message; }
    overlay.querySelector("#profile-avatar-file").onchange = async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2*1024*1024) { status.textContent = "Choose an image under 2 MB."; return; } try { avatarData = await compressImage(file, 256, .78); avatar.src = avatarData; status.textContent = "Photo ready to save."; } catch { status.textContent = "Could not read that image."; } };
    overlay.querySelector("#profile-save").onclick = async e => { const button=e.currentTarget; button.disabled=true; button.textContent="Saving…"; status.textContent=""; try { const response=await fetch("/api/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:overlay.querySelector("#profile-edit-name").value,bio:overlay.querySelector("#profile-edit-bio").value,avatar:avatarData})}); const data=await response.json().catch(()=>({})); if(!response.ok) throw new Error(data.error||"Could not save profile."); myName=data.name; document.getElementById("pfp").src=data.avatar||"/pfp"; overlay.remove(); } catch(error) { status.textContent=error.message; button.disabled=false; button.textContent="Save profile"; } };
}

//room management utils
function createRoom() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const panel = document.createElement("div");
    panel.className = "modal-panel";
    panel.innerHTML = `
        <h2>Create Room</h2>
        <div class="modal-body">
            <label class="form-field"><span>Name</span><input id="room-name" type="text" autocomplete="off"></label>
            <label class="form-field"> <span>Description</span><input id="room-description" type="text" autocomplete="off"></label>
            <label class="form-field">
                <span>Privacy Level</span>
                <select id="room-privacy">
                    <option value="Public">Public</option>
                    <option value="Private">Private</option>
                    <option value="Confidential">Confidential</option>
                    <option value="Top-Secret">Top-Secret</option>
                </select>
            </label>
        </div>

        <div class="btn-group">
            <button class="btn btn-cancel" id="cancel-room" type="button">Cancel</button>
            <button class="btn btn-save" id="create-room" type="button">Continue</button>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.appendChild(panel);

    const close = () => overlay.remove();
    overlay.addEventListener("click", event => {if (event.target === overlay) close();});

    panel.querySelector("#cancel-room").addEventListener("click", close);

    panel.querySelector("#create-room").addEventListener("click", async () => {
        const alias = panel.querySelector("#room-name").value.trim();
        const desc = panel.querySelector("#room-description").value.trim();
        const privacy = panel.querySelector("#room-privacy").value;

        if (!alias) {
            panel.querySelector("#room-name").focus();
            return;
        }

        const button = panel.querySelector("#create-room");
        button.disabled = true;
        button.textContent = "Creating...";

        try {
            const res = await fetch("/api/create-room", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    alias,
                    privacy,
                    desc
                })
            });

            if (!res.ok) {return print(`HTTP ${res.status}`);}
            location.reload();
            /* TODO maybe load from server instead of refresh
            const newRoomId = (await res.json()).id;
            document.getElementById("room-name").innerHTML += "<option>"
             */
            // TODO: successful animation
            close();

        } catch (error) {
            console.error("Failed to create room:", error);
            button.disabled = false;
            button.textContent = "Continue";
        }
    });

    panel.querySelector("#room-name").focus();
}

async function showRoomOverview(id) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const panel = document.createElement("div");
    panel.className = "modal-panel room-overview";

    panel.innerHTML = `<div class="room-loading">loading room data...</div>`;

    document.body.appendChild(overlay);
    overlay.appendChild(panel);

    const close = () => overlay.remove();

    overlay.addEventListener("click", event => {
        if (event.target === overlay) close();
    });

    try {
        const res = await fetch(`/api/room-data`);

        if (!res.ok) {
            panel.innerHTML = `<div class="room-error">failed to load room [HTTP ${res.status}]</div>`;
            return;
        }

        const room = await res.json();
        print(room)

        panel.innerHTML = `
            <div class="room-overview-header">
                <div class="room-icon">
                    ${escapeHtml((room.alias || "?")[0].toUpperCase())}
                </div>

                <div class="room-title">
                    <h2>${escapeHtml(room.alias)}</h2>
                    <span>room #${escapeHtml(room.id)}</span>
                </div>

                <button class="room-close" type="button">×</button>
            </div>

            <div class="room-description">
                ${escapeHtml(room.description || "No description.")}
            </div>

            <div class="room-meta">
                <span>created ${escapeHtml(room.created)}</span>
                <span>•</span>
                <span>${room.members?.length || 0} members</span>
            </div>

            <div class="room-divider"></div>

            <div class="room-members-header">
                <span>MEMBERS — ${room.members?.length || 0}</span>
                ${
            room.admins?.includes(myName)
                ? `<button id="room-add-user" type="button">+ add user</button>`
                : ""
        }
            </div>

            <div class="room-members">
    ${(room.members || []).map(name => {
            const parts = name.split("-");
            const initials = parts.map(part => part[0]).join("").toUpperCase();

            return `
            <div class="room-member ${room.admins?.includes(name) ? "admin" : ""}" data-name="${name}">
                <div class="member-pfp">
                    ${escapeHtml(initials)}
                </div>

                <span class="member-name">
                    ${escapeHtml(aliases[name] || name)}
                </span>

                ${
                room.admins?.includes(name)
                    ? `<span class="member-role">ADMIN</span>`
                    : room.admins.includes(myName) ?
                        `<span class="member-kick">remove</span>`
                            : ""
            }
            </div>
        `;
        }).join("")}
</div>
        `;

        panel.querySelectorAll(".member-kick").forEach(b=>{b.onclick=()=>kickUser(b,panel);});
        panel.querySelector(".room-close").onclick = close;

        if (room.privacy === "Public" && room.inviteCode) {
            const invite = document.createElement("div"); invite.className="room-invite";
            invite.innerHTML=`<span>Invite link</span><button type="button" id="copy-room-invite">Copy link</button>`;
            panel.querySelector(".room-divider").after(invite);
            invite.querySelector("button").onclick=async()=>{const url=new URL(location.href);url.searchParams.set("join",room.id);url.searchParams.set("invite",room.inviteCode);try{await navigator.clipboard.writeText(url.href);invite.querySelector("button").textContent="Copied";}catch{prompt("Copy this invite link",url.href);}};
        }
        const addUser = panel.querySelector("#room-add-user");

        if (addUser) {
            addUser.onclick = () => showAddRoomUser(id, panel);
        }

    } catch (error) {
        console.error("Failed to load room:", error);
        panel.innerHTML = `
            <div class="room-error">
                failed to load room data
            </div>
        `;
    }
}

async function kickUser(b) {
    const name = b.parentElement.dataset.name;
    print("kicking member", name);
    const res = await fetch("/api/kick-user", {method: "POST", body: JSON.stringify([name])});
    if(!res.ok) return alert("Failed to kick user: "+ await res.text());
    b.parentElement.remove();
    //this actually reloads it:
    //panel.parentElement.remove();
    //await showRoomOverview(activeRoom);
}

async function showAddRoomUser(roomId, panel) {
    const old = panel.querySelector(".room-add-user-panel");
    if (old) old.remove();

    const box = document.createElement("div");
    box.className = "room-add-user-panel";

    box.innerHTML = `
        <div class="room-add-title">ADD USER</div>

        <div class="room-add-row">
            <input
                id="room-user-name"
                type="text"
                autocomplete="off"
                placeholder="username"
            >
            <button id="room-user-submit" type="button">ADD</button>
        </div>

        <div id="room-add-status"></div>
    `;

    panel.appendChild(box);

    const input = box.querySelector("#room-user-name");
    const button = box.querySelector("#room-user-submit");
    const status = box.querySelector("#room-add-status");

    input.focus();

    const add = async () => {
        const name = input.value.trim();

        if (!name) {
            input.focus();
            return;
        }

        button.disabled = true;
        button.textContent = "...";

        try {
            const res = await fetch("/api/add-user", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify([name])
            });

            if (!res.ok) {
                status.textContent = `Error: `+await res.text();
                button.disabled = false;
                button.textContent = "ADD";
                return;
            }

            status.textContent = "user added";

            setTimeout(() => {
                panel.parentElement.remove();
                showRoomOverview(roomId);
            }, 300);

        } catch (error) {
            console.error("Failed to add user:", error);
            status.textContent = "request failed";

            button.disabled = false;
            button.textContent = "ADD";
        }
    };

    button.onclick = add;

    input.addEventListener("keydown", event => {
        if (event.key === "Enter") add();
        if (event.key === "Escape") box.remove();
    });
}
document.getElementById("chat-icon").onclick = showRoomOverview;

//mssg manipulating utils
function editMessage(container, bg) {
    editingMessage = true;
	const composer = document.getElementById("msg");
	composer.inert = true;

    const bubble = container.querySelector(".bubble") || container;
    const oldText = bubble.textContent;

    bubble.classList.add("editing-message");

    const input = document.createElement("input");
    input.value = oldText;

    input.style.cssText = `
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        outline: none;
        font: inherit;
        color: inherit;
        width: 100%;
        z-index: 9999;
    `;

    bubble.innerHTML = "";
    bubble.appendChild(input);

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollIntoView({behavior: "smooth",block: "end"});

    const finish = () => {
    	composer.inert = false;
        bubble.classList.remove("editing-message");
        bubble.classList.add("self-temp");
        bubble.textContent = input.value;
        bg.remove();
        editingMessage = false;

        fetch("/send", {
            method: "POST",
            body: JSON.stringify({
                id: container.id,
                message: input.value
            })
        }).then(res => {
            if (res.ok) {
                bubble.innerHTML = input.value;
            } else {
                alert("failed to edit message");
                bubble.innerHTML = oldText;
            }
            bubble.classList.remove("self-temp");
        });
    };

    input.onkeydown = e => {
        if (e.key === "Enter" && input.value!==oldText) finish();
        if (e.key === "Escape") {
            bubble.classList.remove("editing-message");
            bubble.textContent = oldText;
            bg.remove();
            editingMessage = false;
        }
    };
}
function copyMessage (container) {
    const bubble = container.querySelector(".bubble") || container;
    void navigator.clipboard.writeText(bubble.textContent);
}
function deleteMessage (container) {
    fetch("/send", {method:"POST", body:JSON.stringify({id:container.id, message:""})})
        .then(res => {
            if (!res.ok) alert("failed to delete message");
        })
}
function showMessageInfo(container) {
    const bg = document.createElement("div");
        bg.className = "modal-overlay";
        document.body.appendChild(bg);
        bg.onclick = ()=>bg.remove();
    const infoPanel = document.createElement("div");
        infoPanel.className = "modal-panel";
        bg.appendChild(infoPanel);
        infoPanel.innerHTML = `
        <h2>Message Info</h2>
        <p>sender - ${container.dataset.sender}</p>
        <p>timestamp - ${container.dataset.timestamp}</p>
        <button id="show-logs" class="btn">Show past Versions of this Message</button>
        `;
        infoPanel.onclick=(e)=>e.stopPropagation();
    const previewBubble = container.querySelector(".bubble").cloneNode(true);
        bg.prepend(previewBubble);
    const showHistory=id=>{
        const list = document.createElement("div"); list.className="chat";
        bg.style.backdropFilter="brightness(0.5)";
        history.forEach(i=>{
            if(i.id===id)list.innerHTML+=`
                <div class="history-message">
                    <div class="bubble">${escapeHtml(i.content||"[deleted]")}</div>
                    <span class="history-time">${escapeHtml(getTime(i.timestamp))}</span>
                </div>`;
        });
        return list;
    }
    document.getElementById("show-logs").onclick=()=> {
        bg.innerHTML = ""; bg.prepend(showHistory(container.id))
    };

}
// and ctx menu
let activeContextMenu = null;
function contextMenu(container) {
    if (editingMessage) return
    if (activeContextMenu) activeContextMenu.remove();

    const bg = document.createElement("div"); bg.className = "blur-overlay"; document.body.prepend(bg);
    const bubble = container.querySelector(".bubble") || container;
    bubble.classList.add("editing-message");
    const rect = bubble.getBoundingClientRect();

    const menu = document.createElement("div");
    menu.className = "context-menu";

    const addButton = (text, fn) => {
        const b = document.createElement("div");
        b.className = "btn";
        b.innerHTML = text;
        b.onclick = () => {fn(); close();};
        menu.appendChild(b);
    };
    if(!container.classList.contains("deleted-message")) {
        if (container.classList.contains("self")) {
            addButton("Edit", () => editMessage(container, bg));
            addButton("Delete", () => deleteMessage(container));
        }
        addButton("Copy", () => close() || copyMessage(bubble));
    }
    addButton("Info", () => close() || showMessageInfo(container));

    document.body.appendChild(menu);
    activeContextMenu = menu;
    const menuRect = menu.getBoundingClientRect();
    let left = container.classList.contains("self") ? rect.right - menuRect.width : rect.left;
    let top = rect.bottom + 5;

    if (left + menuRect.width > window.innerWidth - 10) left = window.innerWidth - menuRect.width - 10;
    if (left < 10) left = 10;
    if (top+menuRect.height>window.innerHeight-10) top = rect.top - menuRect.height - 5;
    if (top < 10) top = 10;

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const close = () => {
        bg.remove()
        menu.remove();
        activeContextMenu = null;
        bubble.classList.remove("editing-message");
        document.removeEventListener("click", outsideClick);
    };
    bg.onclick = close;
    const outsideClick = e => {if (!menu.contains(e.target)) {close();bg.remove()}};

    setTimeout(() => document.addEventListener("click", outsideClick), 0);
}


// Deliberately dormant: callers can swap to the alternate stylesheet at runtime.
function applyDesign(name = "default") {
    const designs = {default: "/style.css", alternate: "/designs/style2.css"};
    const href = designs[name];
    const link = document.getElementById("app-style");
    if (!href || !link) return false;
    link.href = href;
    return true;
}
window.applyDesign = applyDesign;

const logoutButton = document.getElementById("logout");
if (logoutButton) logoutButton.addEventListener("click", async () => {
    await fetch("/api/auth/logout", {method: "POST"});
    location.replace("/login");
});
