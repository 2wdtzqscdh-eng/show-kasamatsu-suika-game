window.addEventListener("load", () => {
  const { Engine, Render, Runner, World, Bodies, Body, Events, Composite } = Matter;

  // ===== 설정 =====
  let W = 420;
  let H = 720;

  const MAX_LV = 10;
  const SPAWN_LV_MAX = 3;
  const GAME_OVER_Y = 120;

  // ✅ 너가 최종 지정한 크기 (반지름 기준)
  // lv0 3, lv1 5, lv2 6, lv3 7.5, lv4 8.5, lv5 10, lv6 11, lv7 13, lv8 14.5, lv9 17, lv10 23
  const RADII = [
    9,    // lv0
    15,   // lv1
    18,   // lv2
    22.5, // lv3
    30,   // lv4
    35,   // lv5
    37,   // lv6
    40,   // lv7
    45,   // lv8
    55,   // lv9
    74    // lv10
  ];
  // how many times larger the sprite is drawn compared to the logical RADII
  const SPRITE_DISPLAY_MULT = 2;
  const SPAWN_GRACE_MS = 900; // 스폰 후 게임오버 판정 유예(0.9초)

  // ===== DOM =====
  const scoreEl = document.getElementById("score");
  const gameEl = document.getElementById("game");
  const restartBtn = document.getElementById("restart");

  // start / ranking elems
  const startOverlay = document.getElementById("startOverlay");
  const nameInput = document.getElementById("nameInput");
  const startBtn = document.getElementById("startBtn");
  const playerNameEl = document.getElementById("playerName");
  const rankListEl = document.getElementById("rankList");
  const clearRankBtn = document.getElementById("clearRank");
  const nextImgEl = document.getElementById("nextImg");

  function updateNextPreview() {
    if (!nextImgEl) return;
    nextImgEl.src = spritePath(nextLv);
  }

  // ===== 상태 =====
  let engine, world, render, runner;
  let score = 0;

  // physics bounds and thickness
  let bounds = []; // [floor, leftWall, rightWall]
  const t = 60;    // thickness used for walls/floor

  let nextLv = 0;
  let previewX = W / 2;
  let canDrop = true;
  let gameOver = false;
  let dropsCount = 0; // 몇 번 떨어뜨렸는지

  const merging = new Set();
  let dangerTimerStart = null;
  const DANGER_HEIGHT = 20; // px, matches CSS #danger-line height
  const DANGER_TOUCH_MS = 3000; // ms to trigger game over when touching danger zone (≈3s)

  // ✅ 각 lv 이미지 실제 크기 읽어서 스케일 맞추기
  const spriteImgs = Array.from({ length: MAX_LV + 1 }, () => null);

  function spritePath(lv) { return `assets/lv${lv}.png`; }
  function randSpawnLv() {
    // 초반 4번 드롭까지
    if (dropsCount < 4) {
      // lv0 65%, lv1 30%, lv2 5%
      const r = Math.random();
      if (r < 0.65) return 0;
      if (r < 0.95) return 1;
      return 2;
    }

    // 그 이후 기본 분포
    // lv0 30%, lv1 30%, lv2 20%, lv3 15%, lv4 5%
    const r = Math.random();
    if (r < 0.30) return 0;
    if (r < 0.60) return 1;
    if (r < 0.80) return 2;
    if (r < 0.95) return 3;
    return 4;
  }

  function resetScore() {
    score = 0;
    scoreEl.textContent = "0";
  }

  function addScore(newLv) {
    // 동일 이미지 합체 시 레벨 상관없이 항상 100점 증가
    const pts = 100;
    score += pts;
    scoreEl.textContent = String(score);
  }

  function preloadSprites() {
    const tasks = [];
    for (let lv = 0; lv <= MAX_LV; lv++) {
      tasks.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { spriteImgs[lv] = img; resolve(); };
        img.onerror = () => { spriteImgs[lv] = null; resolve(); };
        img.src = spritePath(lv);
      }));
    }
    return Promise.all(tasks);
  }

  // ---- Bounds / resize helpers ----
  function rebuildBounds() {
    if (!world) return;
    // remove existing
    try {
      if (bounds && bounds.length) {
        World.remove(world, bounds);
        bounds = [];
      }
    } catch (e) { /* ignore */ }

    const floor = Bodies.rectangle(W / 2, H + t / 2, W + 2 * t, t, { isStatic: true });
    const left  = Bodies.rectangle(-t / 2, H / 2, t, H * 2, { isStatic: true });
    const right = Bodies.rectangle(W + t / 2, H / 2, t, H * 2, { isStatic: true });

    bounds = [floor, left, right];
    World.add(world, bounds);
  }

  function updateDangerLine() {
    const y = Math.round(H * 0.16);
    document.documentElement.style.setProperty('--lineY', `${y}px`);
  }

  function resizeGameToWrapper() {
    const wrapper = document.getElementById('wrapper');
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    // update W/H
    W = Math.max(100, Math.round(rect.width));
    H = Math.max(100, Math.round(rect.height));

    // update render size if available
    try {
      if (render) {
        render.options.width = W;
        render.options.height = H;
        if (render.canvas) {
          render.canvas.style.width = '100%';
          render.canvas.style.height = '100%';
          // pixel resize
          const dpr = Math.max(1, window.devicePixelRatio || 1);
          render.canvas.width = Math.round(rect.width * dpr);
          render.canvas.height = Math.round(rect.height * dpr);
          try { Render.lookAt(render, { min: { x: 0, y: 0 }, max: { x: W, y: H } }); } catch (e) {}
        }
      }
    } catch (e) { /* ignore */ }

    rebuildBounds();
    updateDangerLine();
  }

  // ===== 랭킹 저장: 플레이어별 최고점 맵 =====
  const RANK_KEY = "kasamatsu_ranking_v1";
  // 개발 편의용 로컬 폴백 비밀번호 (배포 시엔 CLEAR_RANK_SECRET로 덮어써야 함)
  const DEV_DEFAULT_SECRET = 'Jiin0104!!';

  async function loadRankMap() {
    // 서버가 제공되면 서버에서 최신 랭킹을 가져오고, 실패하면 localStorage로 폴백
    try {
      const r = await fetch('/api/get-ranking');
      if (r.ok) {
        const j = await r.json();
        if (j.ok) return j.map || {};
      }
    } catch (e) {
      // ignore and fallback
    }

    try {
      const raw = localStorage.getItem(RANK_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  async function saveRankMap(map) {
    // Prefer server-side upsert if available (but we expose submitScore for single-player upsert)
    try {
      // best-effort: try to set entire map via submit endpoint per-entry
      // fallback: save locally
      localStorage.setItem(RANK_KEY, JSON.stringify(map));
    } catch {}
  }

  // 같은 이름 중복 방지: 플레이어당 최고점만 유지
  async function upsertBestScore(playerName, newScore) {
    const name = (playerName || '').trim();
    if (!name) return;

    // Try server upsert first
    try {
      const r = await fetch('/api/submit-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, score: newScore })
      });
      if (r.ok) {
        const j = await r.json();
        if (j.ok) return;
      }
    } catch (e) {
      // ignore and fallback to local
    }

    // fallback: localStorage
    try {
      const map = await loadRankMap();
      const prev = map[name];
      if (prev == null || newScore > prev) {
        map[name] = newScore;
        localStorage.setItem(RANK_KEY, JSON.stringify(map));
      }
    } catch {}
  }

  // TOP3(서로 다른 이름)
  async function getTop3() {
    const map = await loadRankMap();
    return Object.entries(map)
      .map(([name, score]) => ({ name, score: Number(score) || 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  async function clearRanking(password) {
    // Try server clear first (requires admin password). If server responds 401 -> do NOT clear.
    // If server missing/unreachable, allow local fallback only when provided password matches DEV_DEFAULT_SECRET.
    try {
      if (password != null) {
        const r = await fetch('/api/clear-ranking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        if (r.status === 401) {
          return { ok: false, error: 'unauthorized' };
        }

        if (r.ok) {
          const j = await r.json();
          if (j.ok) return { ok: true };
          return { ok: false, error: j.error || 'clear failed' };
        }
        // non-OK (e.g., 404) -> treat as server not configured and fall through to fallback logic
      }
    } catch (e) {
      // network/server unreachable -> fallback logic below
    }

    // Fallback: only allow local clear when password matches DEV_DEFAULT_SECRET
    try {
      if (password === DEV_DEFAULT_SECRET) {
        localStorage.removeItem(RANK_KEY);
        return { ok: true, fallback: true };
      }
      return { ok: false, error: 'no server and invalid local admin password' };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }

  async function updateRankUI(){
    const rank = await getTop3();
    rankListEl.innerHTML = "";
    for (let i=0;i<3;i++){
      const item = rank[i] || { name: "-", score: 0 };
      const row = document.createElement("div"); row.className = "rank-item";
      row.innerHTML = `<div class="rank-left"><div class="badge">${i+1}</div><div class="name">${escapeHtml(item.name)}</div></div><div class="scorev">${item.name === "-" ? "-" : item.score}</div>`;
      rankListEl.appendChild(row);
    }
  }

  async function submitScore(name, score){ if (!name) return; await upsertBestScore(name, score); updateRankUI(); }

  clearRankBtn?.addEventListener("click", async ()=>{
    // 관리자 전용: 비밀번호를 입력하지 않으면 아무 동작 없이 닫힘
    const password = prompt("관리자 비밀번호를 입력하세요");
    if (password === null) return; // cancel -> do nothing
    if (String(password).trim() === '') return; // empty -> do nothing

    const r = await clearRanking(password);
    if (r.ok) {
      alert('랭킹이 초기화되었습니다.');
      updateRankUI();
    } else {
      // 인증 실패 또는 기타 오류인 경우: 아무 동작 없이 닫힘 (요청대로)
      return;
    }
  });

  function makeBall(x, y, lv, extra = {}) {
    const r = RADII[lv];
    const physR = r * SPRITE_DISPLAY_MULT;

    // ✅ 이미지 실제 픽셀 크기 기준으로 스케일 계산
    const img = spriteImgs[lv];
    const iw = img?.naturalWidth || 52;
    const ih = img?.naturalHeight || 52;

    const ball = Bodies.circle(x, y, physR, {
      label: "ball",
      restitution: 0.0,     // 튕김 최소(차곡차곡)
      friction: 0.18,
      frictionStatic: 0.25,
      frictionAir: 0.002,
      density: 0.003,
      render: {
        sprite: {
          texture: spritePath(lv),
          xScale: (4 * r) / iw,
          yScale: (4 * r) / ih,
        }
      },
      ...extra,
    });

    // ✅ 관통/겹침 최소화
    ball.slop = 0;
    ball.plugin = ball.plugin || {};
    ball.plugin.lv = lv;
    ball.plugin.spawnAt = Date.now();
    return ball;
  }

  function clearGameArea() { gameEl.innerHTML = ""; }

  // player name
  let playerName = "";

  function initGame(){
    restartBtn.disabled = true;
    updateRankUI();
    // show overlay (index.html default visible)
    startOverlay.style.display = "flex";
    dropsCount = 0;
  }

  startBtn.addEventListener("click", ()=>{ startGameWithName(nameInput.value); });
  nameInput.addEventListener("keydown", (e)=>{ if (e.key === "Enter") startGameWithName(nameInput.value); });

  function startGameWithName(name){
    playerName = String(name || "").trim() || "Anonymous";
    playerNameEl.textContent = playerName;
    startOverlay.style.display = "none";
    restartBtn.disabled = false;
    setup();
  }

  function setup() {
    engine = Engine.create();
    world = engine.world;

    // ✅ 겹침/파고듦 줄이기: 물리 정확도 업
    engine.enableSleeping = true;
    engine.positionIterations = 14;
    engine.velocityIterations = 12;
    engine.constraintIterations = 2;

    world.gravity.y = 1;

    render = Render.create({
      element: gameEl,
      engine,
      options: {
        width: W,
        height: H,
        wireframes: false,
        background: "transparent",
        pixelRatio: window.devicePixelRatio || 1,
      },
    });

    Render.run(render);
    // ensure renderer view matches world size
    try { Render.lookAt(render, { min: { x: 0, y: 0 }, max: { x: W, y: H } }); } catch (e) {}
    runner = Runner.create();
    Runner.run(runner, engine);

    // build bounds according to current W/H
    rebuildBounds();

    resetScore();
    dropsCount = 0;
    nextLv = randSpawnLv();
    updateNextPreview();
    previewX = W / 2;
    canDrop = true;
    gameOver = false;
    merging.clear();
    dangerTimerStart = null;

    const canvas = render.canvas;

    // Ensure canvas pixel size matches CSS layout (handles DPR and responsive resize)
    function fitCanvasToCSS(canvasEl){
      try {
        let rect = canvasEl.getBoundingClientRect();
        // fallback to parent size when canvas itself reports zero (sometimes on mobile)
        if ((rect.width === 0 || rect.height === 0) && canvasEl.parentElement) {
          rect = canvasEl.parentElement.getBoundingClientRect();
        }
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        canvasEl.width  = Math.round(rect.width * dpr);
        canvasEl.height = Math.round(rect.height * dpr);
      } catch (e) { /* ignore */ }
    }

    fitCanvasToCSS(canvas);
    window.addEventListener('resize', () => fitCanvasToCSS(canvas));
    window.addEventListener('orientationchange', () => setTimeout(()=>fitCanvasToCSS(canvas), 150));

    // observe wrapper size to keep physics bounds and render aligned
    try {
      const wrapperEl = document.getElementById('wrapper');
      if (wrapperEl && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          // small timeout to allow layout to settle on mobile
          setTimeout(resizeGameToWrapper, 60);
        });
        ro.observe(wrapperEl);
      }
      window.addEventListener('orientationchange', () => setTimeout(resizeGameToWrapper, 150));
      // initial align
      resizeGameToWrapper();
    } catch (e) { /* ignore */ }

    canvas.addEventListener("mousemove", (e) => {
      if (gameOver) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // ✅ 너무 작은 r에도 안정적으로 컵 안에 들어가게
      const r = RADII[nextLv];
      const displayR = r * SPRITE_DISPLAY_MULT;
      const margin = Math.max(10, displayR + 4);
      previewX = Math.max(margin, Math.min(W - margin, x));
    });

    canvas.addEventListener("click", () => {
      if (gameOver || !canDrop) return;
      dropNext();
    });

    // ✅ 합체: 같은 레벨만 -> 다음 레벨
    Events.on(engine, "collisionStart", (evt) => {
      if (gameOver) return;

      for (const pair of evt.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;

        if (a.label !== "ball" || b.label !== "ball") continue;

        const la = a.plugin?.lv;
        const lb = b.plugin?.lv;
        if (la == null || lb == null) continue;

        // 다른 레벨이면 합체 X (그냥 튕김)
        if (la !== lb) continue;
        if (la >= MAX_LV) continue;

        // 중복 합체 방지
        if (merging.has(a.id) || merging.has(b.id)) continue;
        merging.add(a.id);
        merging.add(b.id);

        const nx = (a.position.x + b.position.x) / 2;
        const ny = (a.position.y + b.position.y) / 2;

        setTimeout(() => {
          if (!Composite.get(world, a.id, "body") || !Composite.get(world, b.id, "body")) return;

          World.remove(world, a);
          World.remove(world, b);

          const newLv = la + 1;
          const newBall = makeBall(nx, ny - 1, newLv);
          Body.setVelocity(newBall, { x: 0, y: 0 });
          World.add(world, newBall);

          addScore(newLv);

          setTimeout(() => {
            merging.delete(a.id);
            merging.delete(b.id);
          }, 90);
        }, 0);
      }
    });

    // 게임오버: 점선 위로 올라가면
    Events.on(engine, "afterUpdate", () => {
      if (gameOver) return;

      const bodies = Composite.allBodies(world);
      let touchingCount = 0;
      const now = Date.now();

      for (const body of bodies) {
        if (body.label !== "ball") continue;
        const r = body.circleRadius || 0;
        const topY = body.position.y - r;

        const spawnAt = body.plugin?.spawnAt;
        const isFresh = spawnAt && (now - spawnAt) < SPAWN_GRACE_MS;
        const speed = body.speed || 0;
        const settling = speed < 0.15;

        // only consider settled, non-fresh balls for critical-line game over
        if (!isFresh && settling && topY < GAME_OVER_Y) {
          endGame();
          break;
        }

        // count stacked/touching settled balls for danger-zone timer
        if (!isFresh && settling && topY < GAME_OVER_Y + DANGER_HEIGHT) touchingCount++;
      }

      if (gameOver) return;

      if (touchingCount > 0) {
        if (dangerTimerStart == null) dangerTimerStart = now;
        else if (now - dangerTimerStart >= DANGER_TOUCH_MS) endGame();
      } else {
        dangerTimerStart = null;
      }
    });

    // 프리뷰 원
    Events.on(render, "afterRender", () => {
      if (gameOver) return;
      const ctx = render.context;
      const r = RADII[nextLv];
      const displayR = r * SPRITE_DISPLAY_MULT;

      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(previewX, GAME_OVER_Y + displayR + 10, displayR, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    });

    restartBtn.onclick = () => restart();
  }

  function dropNext() {
    canDrop = false;

    const lv = nextLv;
    const r = RADII[lv];
    const displayR = r * SPRITE_DISPLAY_MULT;
    const x = previewX;
    const y = GAME_OVER_Y + displayR + 10;
    dropsCount++;
    const ball = makeBall(x, y, lv);
    World.add(world, ball);

    nextLv = randSpawnLv();
    updateNextPreview();
    setTimeout(() => (canDrop = true), 180);
  }

  function endGame() {
    gameOver = true;
    Runner.stop(runner);

    // 점수 제출(Top3 갱신)
    submitScore(playerName, score);
    // Show DOM overlay for 4 seconds so message remains visible
    try {
      const go = document.getElementById('gameOverOverlay');
      const fs = document.getElementById('finalScore');
      if (fs) fs.textContent = String(score);
      if (go) {
        go.style.display = 'flex';
        setTimeout(() => {
          go.style.display = 'none';
        }, 4000);
      }
    } catch (e) {
      // fallback: draw on canvas if DOM not available
      const ctx = render.context;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.font = "700 28px system-ui";
      ctx.fillText("GAME OVER", W / 2, H / 2 - 10);
      ctx.font = "500 16px system-ui";
      ctx.fillText(`Score: ${score}`, W / 2, H / 2 + 20);
      ctx.restore();
    }
  }

  function restart() {
    try { Render.stop(render); } catch {}
    try { Runner.stop(runner); } catch {}
    clearGameArea();
    setup();
  }

  // ✅ 스프라이트 먼저 로딩한 뒤 초기 화면(오버레이) 표시
  preloadSprites().then(() => {
    initGame();
  });
});
