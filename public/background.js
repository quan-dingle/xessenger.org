(function() {
    let scriptChange = false;
    let loop;

    const POINT_COUNT = 200;
    const MIN_LENGTH = 5;
    const MAX_LENGTH = 15;
    const MIN_LIFE = 2500;
    const MAX_LIFE = 7500;
    const MIN_TIMEOUT = 1500;
    const MAX_TIMEOUT = 3000;
    const ROTATION_SPEED = 500;
    const FOV = 0.2;
    const SIZE = 0.4;

    const POINT_SIZE = 2.2;
    const POINT_COLOR = "255,255,255";
    const CONNECTION_WIDTH = 1.5;
    const CONNECTION_COLOR = "255,255,255";

    const canvas = document.getElementById("background");
    const ctx = canvas.getContext("2d");

    const points = [];
    const connections = [];

    let targetRotationX = 0;
    let targetRotationY = 0;
    let rotationX = 0;
    let rotationY = 0;
    let autoRotation = 0;

    let isDragging = false;
    let startX = 0;
    let startY = 0;

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + "px";
        canvas.style.height = window.innerHeight + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function generatePoints() {
        for (let i = 0; i < POINT_COUNT; i++) {
            const z = Math.random() * 2 - 1;
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(1 - z * z);
            points.push({ x: r * Math.cos(a), y: r * Math.sin(a), z: z });
        }
    }
    generatePoints();

    function newConnection() {
        const count = Math.floor(Math.random() * (MAX_LENGTH - MIN_LENGTH)) + MIN_LENGTH;
        const selected = [];
        while (selected.length < count) {
            const i = Math.floor(Math.random() * points.length);
            if (!selected.includes(i)) selected.push(i);
        }
        connections.push({
            points: selected,
            created: performance.now(),
            lifetime: MIN_LIFE + Math.random() * (MAX_LIFE - MIN_LIFE)
        });
        setTimeout(newConnection, MIN_TIMEOUT + Math.random() * (MAX_TIMEOUT - MIN_TIMEOUT));
    }
    newConnection();

    // Named event handler functions for clean removal
    const handlePointerDown = (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
    };

    const handlePointerMove = (e) => {
        if (!isDragging) return;
        const deltaX = -e.clientX + startX;
        const deltaY = e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;
        targetRotationY += deltaX * 0.005;
        targetRotationX += deltaY * 0.005;
    };

    const handlePointerUp = () => { isDragging = false; };

    const handleDeviceOrientation = (e) => {
        if (e.gamma !== null && e.beta !== null) {
            targetRotationY = e.gamma * (Math.PI / 180);
            targetRotationX = e.beta * (Math.PI / 180);
        }
    };

    window.addEventListener("resize", resize);
    resize();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("deviceorientation", handleDeviceOrientation);

    function frame(time) {
        if (scriptChange) return;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        if (!isDragging) {
            autoRotation += 1 / ROTATION_SPEED;
        }

        rotationX += (targetRotationX - rotationX) * 0.1;
        rotationY += (targetRotationY - rotationY) * 0.1;

        const totalY = autoRotation + rotationY;
        const projected = [];

        for (const p of points) {
            let x = p.x, y = p.y, z = p.z;

            const cosX = Math.cos(rotationX), sinX = Math.sin(rotationX);
            const y1 = y * cosX - z * sinX;
            const z1 = y * sinX + z * cosX;
            y = y1; z = z1;

            const cosY = Math.cos(totalY), sinY = Math.sin(totalY);
            const x2 = x * cosY - z * sinY;
            const z2 = x * sinY + z * cosY;
            x = x2; z = z2;

            const distance = 1 / FOV;
            const scale = distance / (distance - z);
            const radius = Math.min(window.innerWidth, window.innerHeight) * SIZE;

            projected.push({
                x: window.innerWidth / 2 + x * radius * scale,
                y: window.innerHeight / 2 + y * radius * scale,
                z: z,
                scale: scale
            });
        }

        for (let i = connections.length - 1; i >= 0; i--) {
            if (time - connections[i].created > connections[i].lifetime)
                connections.splice(i, 1);
        }

        for (const connection of connections) {
            const age = time - connection.created;
            const progress = age / connection.lifetime;
            let alpha = 1;
            if (progress < 0.15) alpha = progress / 0.15;
            if (progress > 0.75) alpha = 1 - (progress - 0.75) / 0.25;

            ctx.beginPath();
            for (let i = 0; i < connection.points.length; i++) {
                const p = projected[connection.points[i]];
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = `rgba(${CONNECTION_COLOR},${alpha * 0.3})`;
            ctx.lineWidth = CONNECTION_WIDTH;
            ctx.stroke();
        }

        for (const p of projected) {
            const depth = (p.z + 1) / 2;
            const alpha = 0.15 + depth * 0.85;
            const size = POINT_SIZE * p.scale;

            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${POINT_COLOR},${alpha})`;
            ctx.fill();
        }
        loop = requestAnimationFrame(frame);
    }
    loop = requestAnimationFrame(frame);

    // Clean teardown using the exact named references
    window.remove_script = function() {
        scriptChange = true;
        cancelAnimationFrame(loop);
        window.removeEventListener("resize", resize);
        window.removeEventListener("pointerdown", handlePointerDown);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        window.removeEventListener("deviceorientation", handleDeviceOrientation);
    };
})();