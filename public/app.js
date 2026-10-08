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
- profile config
- admin panel
*/

// loads user data
async function init() {
    try {
        const response = await fetch("/UserName");
        const data = await response.json();

        myName = data.name;
        const roomsMap = data.rooms || {};
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

// asks for push service
async function askForPushes() {
    const prefs = JSON.parse(localStorage.getItem("prefs")) || {};

    if (!prefs.dontAskPushes && !prefs.pushNotifications) {
        const pushPrompt = document.createElement("div");
        pushPrompt.id = "push-prompt";
        pushPrompt.innerHTML = "<h3>want to get notified of new messages?</h3><p id='push-confirmation'>click here to receive push notifications</p><p id='stop-asking'>don't ask me again</p>";
        document.getElementById("chat").appendChild(pushPrompt);
        const pushConfirmation = document.getElementById("push-confirmation");
        const pushRefusal = document.getElementById("stop-asking");

        pushRefusal.addEventListener("click", () => {
            prefs.dontAskPushes=true;
            localStorage.setItem("prefs", JSON.stringify(prefs));

            pushPrompt.remove();
        })

        pushConfirmation.addEventListener("click", async () => {
            if (await setupPushNotifications()) {
                prefs.pushNotifications = true;
                localStorage.setItem("prefs", JSON.stringify(prefs));

                new Notification("All Set!", {
                    body: "You will start receiving notifications. Disable this in your settings."
                });
                pushPrompt.remove();
            }
        });
    }
}

document.getElementById("room-selector").addEventListener("change", e => {changeRoom(e.target.value);});
document.getElementById("msg").addEventListener("keydown", e => { if (e.key === "Enter") void send(); });
document.getElementById("send-msg").addEventListener("click", e => { e.preventDefault(); void send(); });
document.getElementById("open-prefs").addEventListener("click", () => { open_prefs(); });
document.getElementById("upload").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = false;
    input.onchange = (e) => {
        if (e.target.files.length > 0) selectedFile = e.target.files[0];
        if (selectedFile) {
            const preview = document.createElement("div");
            preview.innerHTML = `<img src="${URL.createObjectURL(selectedFile)}" alt="${selectedFile.name}"/>`;
            preview.alt = selectedFile.name;
            preview.id = "preview";
            preview.className = "preview";
            preview.style.left = "5%"
            document.body.append(preview);
            const x = document.createElement("div");
            x.innerHTML = "<p>x</p>";
            x.className = "remove-upload";
            preview.appendChild(x);
            preview.addEventListener("click",() => {preview.remove();selectedFile=null});
        }
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
    if (!msg && !selectedFile) return;
    input.value = "";

    // helper function to handle the fetch request once we have text or base64 data
    const executeSend = async (attachmentData = null) => {
        const temp = addTempMessage("", msg, "pending", selectedFile);

        await fetch("/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: msg, attachment: attachmentData })
        });

        temp.remove();
        selectedFile = null;
        const p = document.getElementById("preview"); if(p) p.remove();
    };

    if (selectedFile) {
        try {
            const base64Data = await compressImage(selectedFile);
            await executeSend(base64Data);
        } catch (e) {
            console.error("Image compression failed", e);
        }
    } else {
        await executeSend(null);
    }
}

// pipeline for rendering new messages
// get link and generate preview if applicable
function createPreviewElement(content, previewLink = "") {
    const link = content?.match(/https?:\/\/[^\s]+/)?.[0];
    if (!link) return null;

    print("recv hyperlink", link);

    // main preview container
    const preview = document.createElement("div");
    preview.classList.add("link-preview");
    // body/iframe
    const previewBody = document.createElement("div");
    previewBody.className = "link-preview-body";
    // placeholder
    previewBody.innerHTML = `<div class="link-preview-placeholder">${previewLink ? `<img src="${escapeHtml(previewLink)}" alt="">` : ''}</div>`;
    previewBody.onclick = () => {
        previewBody.innerHTML = `<iframe src="${escapeHtml(link)}" title="Embedded Content"></iframe>`;
        previewBody.onclick = null;
    };

    // footer controls
    const previewControls = document.createElement("div");
        previewControls.classList.add("link-preview-footer");
    const openInNewTab = document.createElement("button");
        openInNewTab.innerText = "⧉";
        openInNewTab.onclick = (e) => {e.stopPropagation();window.open(link, "_blank");};
    const fullScreenPreview = document.createElement("button");
        fullScreenPreview.innerText = "⛶";
        fullScreenPreview.onclick = (e) => {e.stopPropagation();
        previewBody.requestFullscreen();
        document.body.onclick=document.exitFullscreen();
        // TODO: re-center the fucking iframe
        };
    const hidePreview = document.createElement("button");
        hidePreview.innerText = "▴";
        hidePreview.onclick = (e) => {e.stopPropagation();
            previewBody.hidden = !previewBody.hidden;
            hidePreview.innerText = previewBody.hidden ? "▾" : "▴";}
    [openInNewTab, fullScreenPreview, hidePreview].forEach(btn => {
        previewControls.appendChild(btn);});

    preview.appendChild(previewBody);
    preview.appendChild(previewControls);

    if (link.includes("openguessr.com/?join=")) {
        preview.classList.add("openguessr-preview");
        return preview;
    }

    print("recv unk link - passive / no embed");
    return preview;
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

    let attachmentHtml = "";
    if (attachment) {
        let imgSrc = attachment;
        if (attachment instanceof Blob || attachment instanceof File) {
            imgSrc = URL.createObjectURL(attachment);
        }
        attachmentHtml = `<div class="attachment-bubble"><img src="${escapeHtml(imgSrc)}" alt="[file]"></div>`;
    }

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

    let attachmentHtml = "";
    if (attachment) {
        let imgSrc = attachment;
        if (attachment instanceof Blob || attachment instanceof File) {
            imgSrc = URL.createObjectURL(attachment);
        }
        attachmentHtml = `<div class="attachment-bubble"><img src="${escapeHtml(imgSrc)}" alt="[file]"></div>`;
    }

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
function escapeHtml(text) { const div = document.createElement("div"); div.innerText = text; return div.innerHTML; }
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
            <div class="room-member ${room.admins?.includes(name) ? "admin" : ""}">
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

        panel.querySelector(".room-close").onclick = close;

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

