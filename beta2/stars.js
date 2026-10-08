(() => {
    const canvas = document.getElementById("stars");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const stars = [];

    let width = 0;
    let height = 0;
    let lastTime = 0;
    let targetX = 0;
    let targetY = 0;
    let offsetX = 0;
    let offsetY = 0;

    function newStar() {
        stars.push({
            x: Math.random(),
            y: Math.random(),
            r: Math.random() ** 2,
            t: 5000 * Math.random(),
            phase: Math.random() * Math.PI * 2
        });
    }

    for (let i = 0; i < 1000; i++) {
        newStar();
    }

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

    function updatePointer(e) {
        targetX = e.clientX / width - 0.5;
        targetY = e.clientY / height - 0.5;
    }

    function drawStar(star, time) {
        const depth = star.r;
        const x = star.x * width + offsetX * depth;
        const y = star.y * height + offsetY * depth;
        const alpha = 0.4 + Math.sin(star.t * 0.002) * 0.3;

        ctx.beginPath();
        ctx.arc(
            x,
            y,
            star.r,
            0,
            Math.PI * 2
        );

        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fill();
    }

    function animate(time) {
        const delta = time - lastTime;
        lastTime = time;

        offsetX += (targetX * 30 - offsetX) * 0.03;
        offsetY += (targetY * 30 - offsetY) * 0.03;

        ctx.clearRect(0, 0, width, height);

        for (const star of stars) {
            star.t -= delta;
            drawStar(star, time);
        }

        requestAnimationFrame(animate);
    }

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", updatePointer);

    resize();
    requestAnimationFrame(animate);
})();
