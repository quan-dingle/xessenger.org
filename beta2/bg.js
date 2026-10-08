const canvas = document.getElementById("background");
const ctx = canvas.getContext("2d");

const blobs = [
    {
        x: 0.20, y: 0.25,
        tx: 0.20, ty: 0.25,
        r: 0.32,
        color: [90, 40, 255],
        speed: 0.00035
    },
    {
        x: 0.75, y: 0.25,
        tx: 0.75, ty: 0.25,
        r: 0.40,
        color: [255,150,50],
        speed: 0.00028
    },
    {
        x: 0.70, y: 0.80,
        tx: 0.70, ty: 0.80,
        r: 0.35,
        color: [255, 40, 140],
        speed: 0.00032
    },
    {
        x: 0.25, y: 0.75,
        tx: 0.25, ty: 0.75,
        r: 0.28,
        color: [40, 220, 150],
        speed: 0.00025
    }
];

let width = 0;
let height = 0;

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function updateBlob(blob, time) {

    const phase = blob.x * 13.7 + blob.y * 7.3;
    blob.tx = 0.5 + Math.sin(time * blob.speed + phase) * 0.38;
    blob.ty = 0.5 + Math.cos(time * blob.speed * 0.73 + phase) * 0.38;
    blob.x += (blob.tx - blob.x) * 0.003;
    blob.y += (blob.ty - blob.y) * 0.003;
}

function drawBlob(blob) {
    const x = blob.x * width;
    const y = blob.y * height;

    const radius = blob.r * Math.min(width, height);

    const [r, g, b] = blob.color;

    const gradient = ctx.createRadialGradient(
        x, y, 0,
        x, y, radius
    );

    gradient.addColorStop(
        0,
        `rgba(${r}, ${g}, ${b}, 0.75)`
    );

    gradient.addColorStop(
        0.35,
        `rgba(${r}, ${g}, ${b}, 0.35)`
    );

    gradient.addColorStop(
        0.75,
        `rgba(${r}, ${g}, ${b}, 0.08)`
    );

    gradient.addColorStop(
        1,
        `rgba(${r}, ${g}, ${b}, 0)`
    );

    ctx.fillStyle = gradient;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
}

function animate(time) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    for (const blob of blobs) {
        updateBlob(blob, time);
        drawBlob(blob);
    }

    requestAnimationFrame(animate);
}

window.addEventListener("resize", resize);

resize();
requestAnimationFrame(animate);
