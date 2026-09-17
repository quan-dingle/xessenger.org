(function ()
{
    let scriptChange = false;
    let loop;

    const MIN_LENGTH = 5;
    const MAX_LENGTH = 15;
    const MIN_LIFE = 2500;
    const MAX_LIFE = 7500;
    const MIN_TIMEOUT = 2500;
    const MAX_TIMEOUT = 5000;
    const ROTATION_SPEED = 500;
    const FOV = 0.2;
    const SIZE = 0.4;

    const POINT_SIZE = 1.5;
    const POINT_COLOR = "255,255,255";
    const CONNECTION_WIDTH = 1.5;
    const CONNECTION_COLOR = "255,255,255";


    const ARC_HEIGHT = 0.4;
    const CURVE_SEGMENTS = 30;

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

    function geoToSphere(lon, lat) {
        lon *= Math.PI / 180;
        lat *= Math.PI / 180;

        return {
            x: Math.cos(lat) * Math.cos(lon),
            y: Math.sin(lat),
            z: Math.cos(lat) * Math.sin(lon)
        };
    }

    function resize() {
        const dpr = window.devicePixelRatio || 1;

        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;

        canvas.style.width = window.innerWidth + "px";
        canvas.style.height = window.innerHeight + "px";

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener("resize", resize);
    resize();

    async function generateGlobe() {
        let geo = await fetch("/geodata.json");
        geo = await geo.json();
        geo.forEach((coord) => {
            if (Math.random() < 1)
                points.push(geoToSphere(
                    -coord[0] + (Math.random() * 3 - 1.5) ** 4,
                    -coord[1] + (Math.random() * 3 - 1.5) ** 4));
        });
    }
    void generateGlobe();

    function generatePoints(POINT_COUNT) {
        for (let i = 0; i < POINT_COUNT; i++) {
            const z = Math.random() * 2 - 1;
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(1 - z * z);

            points.push({
                x: r * Math.cos(a),
                y: r * Math.sin(a),
                z: z
            });
        }
    }

    void generatePoints(200);

    function newConnection() {
        const count = Math.min(
            Math.floor(Math.random() * (MAX_LENGTH - MIN_LENGTH)) + MIN_LENGTH,
            points.length // Safety: never try to pick more points than actually exist
        );
        const selected = [];

        let safetyCounter = 0; // Prevent infinite loops
        while (selected.length < count && safetyCounter < 1000) {
            const i = Math.floor(Math.random() * points.length);
            if (!selected.includes(i)) selected.push(i);
            safetyCounter++;
        }

        if (selected.length > 0) {
            connections.push({
                points: selected,
                created: performance.now(),
                lifetime: MIN_LIFE + Math.random() * (MAX_LIFE - MIN_LIFE)
            });
        }

        setTimeout(newConnection, MIN_TIMEOUT + Math.random() * (MAX_TIMEOUT - MIN_TIMEOUT));
    }
    newConnection();


    const handleDeviceorientation = (e) => {
        if (e.gamma !== null && e.beta !== null) {
            targetRotationY = e.gamma * (Math.PI / 180);
            targetRotationX = e.beta * (Math.PI / 180);
        }
    };
    const handlePointerdown = (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
    };
    const handlePointermove = (e) => {
        if (!isDragging) return;

        const deltaX = -e.clientX + startX;
        const deltaY = e.clientY - startY;

        startX = e.clientX;
        startY = e.clientY;

        targetRotationY += deltaX * 0.005;
        targetRotationX += deltaY * 0.005;
    };
    const handlePointerup = () => {
        isDragging = false;
    };

    window.addEventListener("pointerdown", handlePointerdown);
    window.addEventListener("pointermove", handlePointermove);
    window.addEventListener("pointerup", handlePointerup);
    window.addEventListener("pointercancel", handlePointerup);
    window.addEventListener("deviceorientation", handleDeviceorientation);

// Helper for spherical linear interpolation (slerp) with altitude arc modifier
    function getSlerpPoint(p1, p2, t) {
        const dot = p1.x * p2.x + p1.y * p2.y + p1.z * p2.z;
        const clampedDot = Math.max(-1, Math.min(1, dot));
        const theta = Math.acos(clampedDot);

        let rx, ry, rz;

        if (Math.sin(theta) < 0.001) {
            rx = p1.x;
            ry = p1.y;
            rz = p1.z;
        } else {
            const sinTheta = Math.sin(theta);
            const w1 = Math.sin((1 - t) * theta) / sinTheta;
            const w2 = Math.sin(t * theta) / sinTheta;
            rx = p1.x * w1 + p2.x * w2;
            ry = p1.y * w1 + p2.y * w2;
            rz = p1.z * w1 + p2.z * w2;
        }

        // Apply arched altitude modifier (parabolic curve peaking at t = 0.5)
        const altitude = 1 + ARC_HEIGHT * Math.sin(t * Math.PI);

        return {
            x: rx * altitude,
            y: ry * altitude,
            z: rz * altitude
        };
    }

    function frame(time) {
        if (scriptChange) {
            scriptChange = false;
            return;
        }
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        if (!isDragging) {
            autoRotation += 1 / ROTATION_SPEED;
        }

        rotationX += (targetRotationX - rotationX) * 0.1;
        rotationY += (targetRotationY - rotationY) * 0.1;

        const totalY = autoRotation + rotationY;
        const radius = Math.min(window.innerWidth, window.innerHeight) * SIZE;
        const distance = 1 / FOV;
        const cosX = Math.cos(rotationX), sinX = Math.sin(rotationX);
        const cosY = Math.cos(totalY), sinY = Math.sin(totalY);

        // Transform points for rendering base points
        const projectedPoints = points.map(p => {
            let x = p.x, y = p.y, z = p.z;
            let y1 = y * cosX - z * sinX;
            let z1 = y * sinX + z * cosX;
            let x2 = x * cosY - z1 * sinY;
            let z2 = x * sinY + z1 * cosY;
            const scale = distance / (distance - z2);

            return {
                x: window.innerWidth / 2 + x2 * radius * scale,
                y: window.innerHeight / 2 + y1 * radius * scale,
                z: z2,
                scale: scale
            };
        });

        for (let i = connections.length - 1; i >= 0; i--) {
            if (time - connections[i].created > connections[i].lifetime)
                connections.splice(i, 1);
        }

        // Render curved connections
        for (const connection of connections) {
            const age = time - connection.created;
            const progress = age / connection.lifetime;

            let alpha = 1;
            if (progress < 0.15) alpha = progress / 0.15;
            if (progress > 0.75) alpha = 1 - (progress - 0.75) / 0.25;

            ctx.beginPath();
            let first = true;

            for (let i = 0; i < connection.points.length - 1; i++) {
                const pA = points[connection.points[i]];
                const pB = points[connection.points[i + 1]];

                // Subdivide line segment into curved arc coordinates
                for (let j = 0; j <= CURVE_SEGMENTS; j++) {
                    if (i > 0 && j === 0) continue; // skip duplicate vertex joins
                    const t = j / CURVE_SEGMENTS;
                    const sp = getSlerpPoint(pA, pB, t);

                    // Rotate 3D arc point
                    let x = sp.x, y = sp.y, z = sp.z;
                    let y1 = y * cosX - z * sinX;
                    let z1 = y * sinX + z * cosX;
                    let x2 = x * cosY - z1 * sinY;
                    let z2 = x * sinY + z1 * cosY;
                    const scale = distance / (distance - z2);

                    const screenX = window.innerWidth / 2 + x2 * radius * scale;
                    const screenY = window.innerHeight / 2 + y1 * radius * scale;

                    if (first) {
                        ctx.moveTo(screenX, screenY);
                        first = false;
                    } else {
                        ctx.lineTo(screenX, screenY);
                    }
                }
            }

            ctx.strokeStyle = `rgba(${CONNECTION_COLOR},${alpha * 0.3})`;
            ctx.lineWidth = CONNECTION_WIDTH;
            ctx.stroke();
        }

        // Render points
        for (const p of projectedPoints) {
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


    window.remove_script = function () {
        cancelAnimationFrame(loop);
        window.removeEventListener("pointerdown", handlePointerdown);
        window.removeEventListener("pointermove", handlePointermove);
        window.removeEventListener("pointerup", handlePointerup);
        window.removeEventListener("pointercancel", handlePointerup);
        window.removeEventListener("deviceorientation", handleDeviceorientation);
    }
})();