(() => {
    const statCanvas = document.getElementById("logo-stat");
    const animCanvas = document.getElementById("logo-anim");
    
    if (!statCanvas || !animCanvas) return;

    const statCtx = statCanvas.getContext("2d");
    const animCtx = animCanvas.getContext("2d");

    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastTime = 0;

    const particles = [];

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;

        // Resize both canvases to match viewport
        [statCanvas, animCanvas].forEach(canvas => {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = width + "px";
            canvas.style.height = height + "px";
        });

        statCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        animCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Re-render the static background and logo once on resize
        drawStatic();
    }

    function newParticle() {
        particles.push({
            angle: Math.random() * Math.PI * 2,
            radius: .35 + Math.random() * .65,
            speed: (.15 + Math.random() * .45) * (Math.random() < .5 ? -1 : 1),
            size: .4 + Math.random() * 1.2,
            phase: Math.random() * Math.PI * 2
        });
    }

    function roundedPath(ctx, points) {
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) {
            const p = points[i];
            const n = points[(i + 1) % points.length];
            const mx = (p[0] + n[0]) / 2;
            const my = (p[1] + n[1]) / 2;
            ctx.quadraticCurveTo(p[0], p[1], mx, my);
        }
        const p = points[0];
        const n = points[1];
        const mx = (p[0] + n[0]) / 2;
        const my = (p[1] + n[1]) / 2;
        ctx.quadraticCurveTo(p[0], p[1], mx, my);
        ctx.closePath();
    }

    function drawX(scale) {
        const [r, sx, sy, w] = [25, 150, 200, 50];

        function corner(x, y) {
            statCtx.lineTo(w * (x || y), 0);
            statCtx.lineTo((sx + 2 * w) * x, sy * y);
            statCtx.lineTo((sx + w) * x, sy * y);
            statCtx.quadraticCurveTo((sx) * x, sy * y, (sx - r) * x, (sy - r) * y);
            statCtx.lineTo(0, w * (y || x));
        }

        statCtx.beginPath();
        statCtx.lineWidth = 1.2;
        corner(1, 1);
        corner(1, -1);
        corner(-1, 1);
        corner(-1, -1);

        const gradient = statCtx.createLinearGradient(-200, -200, 200, 200);
        gradient.addColorStop(0, "#00eaff");
        gradient.addColorStop(.25, "#405cff");
        gradient.addColorStop(.5, "#d52cff");
        gradient.addColorStop(.75, "#ff3b9d");
        gradient.addColorStop(1, "#ffb52e");

        const gradient2 = statCtx.createLinearGradient(0, -sy, 0, sy);
        gradient2.addColorStop(0, "rgba(0,0,0,.75)");
        gradient2.addColorStop(.4, "rgba(0,0,0,0)");
        gradient2.addColorStop(.6, "rgba(0,0,0,0)");
        gradient2.addColorStop(1, "rgba(0,0,0,.75)");

        statCtx.save();

        // Heavy filters are now rendered ONCE, completely eliminating frame drops
        statCtx.globalAlpha = 1;
        statCtx.lineWidth = 15;
        statCtx.strokeStyle = gradient;
        statCtx.filter = "blur(10px)";
        statCtx.stroke();

        statCtx.lineWidth = 30;
        statCtx.filter = "blur(100px)";
        statCtx.stroke();

        statCtx.filter = "none";
        statCtx.lineWidth = 2.5;
        statCtx.strokeStyle = "#000";
        statCtx.fillStyle = "#000";//gradient2;
        statCtx.stroke();
        statCtx.fill();

        statCtx.restore();
    }

    function drawStatic() {
        statCtx.clearRect(0, 0, width, height);

        const scale = Math.min(width / 760, height / 650);
        const cx = width / 2;
        const cy = height / 2 - 35 * scale;

        statCtx.save();
        statCtx.translate(cx, cy);

        // Ambient radial background glow (drawn once)
        const glow = statCtx.createRadialGradient(0, 10, 20, 0, 10, 330 * scale);
        glow.addColorStop(0, "rgba(190,70,255,.10)");
        glow.addColorStop(.38, "rgba(90,90,255,.055)");
        glow.addColorStop(.7, "rgba(255,100,70,.025)");
        glow.addColorStop(1, "rgba(0,0,0,0)");
        
        statCtx.fillStyle = glow;
        statCtx.beginPath();
        statCtx.arc(0, 10, 330 * scale, 0, Math.PI * 2);
        statCtx.fill();

        drawX(scale);
        statCtx.restore();
    }

    function drawParticles(time, scale) {
        for (const p of particles) {
            const a = p.angle + time * .0001 * p.speed;
            const r = p.radius * 340 * scale;
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r * .27;
            const alpha = .08 + (Math.sin(time * .002 + p.phase) + 1) * .13;

            animCtx.beginPath();
            animCtx.arc(x, y, p.size * 5, 0, Math.PI * 2);
            animCtx.fillStyle = `rgba(255,150,110,${alpha})`;
            animCtx.fill();
        }
    }

    function animate(time) {
        const delta = Math.min(time - lastTime || 16, 50);
        lastTime = time;

        // Clear only the animation canvas
        animCtx.clearRect(0, 0, width, height);

        const scale = Math.min(width / 760, height / 650);
        const cx = width / 2;
        const cy = height / 2 - 35 * scale;

        animCtx.save();
        animCtx.translate(cx, cy);
        drawParticles(time, scale);
        animCtx.restore();

        requestAnimationFrame(animate);
    }

    for (let i = 0; i < 42; i++) newParticle();

    window.addEventListener("resize", resize);
    resize();
    requestAnimationFrame(animate);
})();
