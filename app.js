const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const state = {
  maps: [{ id: "default", name: "云隐山水", builtIn: true, width: 720, height: 1280, zoom: 140 }],
  characters: [
    { id: "spine", name: "剑侠", src: "./hero-male.png", spine: true },
    { id: "female", name: "小师妹", src: "./hero-female.png" },
  ],
  mapId: "default", characterId: "spine", width: 720, height: 1280,
  zoom: 140, size: 96, speed: 100, x: 50, y: 68,
};

let database;
let move = { x: 0, y: 0 };
let moving = false;
let spineReady = false;
let spinePlayer = null;
let spineAnimation = "";
let facing = "right";
let stickOrigin = null;
let lastFrameTime = 0;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fuguang-scene-library", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("maps")) db.createObjectStore("maps", { keyPath: "id" });
      if (!db.objectStoreNames.contains("characters")) db.createObjectStore("characters", { keyPath: "id" });
    };
    request.onsuccess = () => { database = request.result; resolve(database); };
    request.onerror = () => reject(request.error);
  });
}

function dbRead(storeName) {
  if (!database) return Promise.resolve([]);
  return new Promise((resolve) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
}

function dbWrite(storeName, value) {
  if (!database) return;
  database.transaction(storeName, "readwrite").objectStore(storeName).put(value);
}

function dbDelete(storeName, key) {
  if (!database) return;
  database.transaction(storeName, "readwrite").objectStore(storeName).delete(key);
}

function assetUrl(item) {
  if (item.src) return item.src;
  if (item.blob) {
    item.src = URL.createObjectURL(item.blob);
    return item.src;
  }
  return "";
}

function currentMap() { return state.maps.find((item) => item.id === state.mapId) || state.maps[0]; }
function currentCharacter() { return state.characters.find((item) => item.id === state.characterId) || state.characters[0]; }

function setSpineAnimation(name) {
  if (!spineReady || !spinePlayer || spineAnimation === name) return;
  spinePlayer.setAnimation?.(name);
  spinePlayer.play?.();
  spineAnimation = name;
}

const directionalAnimations = {
  "idle-right": { clip: "idle-right", scaleX: "1" },
  "idle-left": { clip: "idle-right", scaleX: "-1" },
  "move-right": { clip: "move-right", scaleX: "1" },
  "move-left": { clip: "move-right", scaleX: "-1" },
};

function setDirectionalAnimation(action) {
  const animation = directionalAnimations[`${action}-${facing}`];
  [$("stageCharacter"), $("spineCharacter")].forEach((node) => node.style.setProperty("--facing", animation.scaleX));
  setSpineAnimation(animation.clip);
}

function renderGallery() {
  const gallery = $("mapGallery");
  gallery.innerHTML = state.maps.map((map) => {
    const preview = map.builtIn
      ? '<div class="map-cover built-in-cover"><i></i><i></i><i></i></div>'
      : `<img class="map-cover" src="${assetUrl(map)}" alt="${map.name}">`;
    const remove = map.builtIn ? "" : `<button class="map-delete" type="button" data-delete-map="${map.id}" aria-label="删除场景 ${map.name}" title="删除场景">×</button>`;
    return `<article class="map-tile" data-map-id="${map.id}" tabindex="0">${preview}<span class="map-tile-info"><b>${map.name}</b><small>${map.width} × ${map.height}</small></span><i class="enter-mark">进入</i>${remove}</article>`;
  }).join("") + '<label class="map-tile add-map-tile"><span>＋</span><b>上传新地图</b><small>PNG / JPG / WEBP · 最大 100MB</small><input id="galleryMapUpload" type="file" accept="image/*" multiple></label>';
  $("mapCount").textContent = state.maps.length;
  $("galleryMapUpload").onchange = (event) => importMaps(event.target.files);
}

function renderSideMaps() {
  $("sideMapList").innerHTML = state.maps.map((map) => {
    const image = map.builtIn ? '<span class="mini-built-in"></span>' : `<img src="${assetUrl(map)}" alt="">`;
    const remove = map.builtIn ? "" : `<button class="side-map-delete" type="button" data-delete-map="${map.id}" aria-label="删除场景 ${map.name}" title="删除场景">×</button>`;
    return `<div data-map-id="${map.id}" class="side-map ${map.id === state.mapId ? "active" : ""}" role="button" tabindex="0">${image}<span>${map.name}</span>${remove}</div>`;
  }).join("");
}

function renderCharacters() {
  $("characterList").innerHTML = state.characters.map((character) =>
    `<button class="character-option ${character.id === state.characterId ? "active" : ""}" data-character-id="${character.id}"><img src="${assetUrl(character)}" alt=""><span>${character.name}</span></button>`
  ).join("");
}

function renderCamera() {
  const frame = $("deviceFrame");
  const scale = state.zoom / 100;
  const worldX = state.x / 100;
  const worldY = state.y / 100;
  const cameraMin = scale >= 1 ? .5 / scale : .5;
  const cameraMax = scale >= 1 ? 1 - cameraMin : .5;
  const cameraX = scale >= 1 ? clamp(worldX, cameraMin, cameraMax) : .5;
  const cameraY = scale >= 1 ? clamp(worldY, cameraMin, cameraMax) : .5;
  const panX = -(cameraX - .5) * scale * frame.clientWidth;
  const panY = -(cameraY - .5) * scale * frame.clientHeight;
  $("sceneBackground").style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
  const characterX = scale >= 1 ? 50 + (worldX - cameraX) * scale * 100 : state.x;
  const characterY = scale >= 1 ? 50 + (worldY - cameraY) * scale * 100 : state.y;
  [$("stageCharacter"), $("spineCharacter")].forEach((node) => {
    node.style.left = `${characterX}%`;
    node.style.top = `${characterY}%`;
  });
}

function renderExplorer() {
  const map = currentMap();
  const character = currentCharacter();
  $("currentMapName").textContent = map.name;
  $("hudMapName").textContent = map.name;
  $("builtIn").hidden = !map.builtIn;
  $("sceneBackground").style.backgroundImage = map.builtIn ? "" : `url("${assetUrl(map)}")`;
  state.zoom = map.zoom ?? 140;
  $("zoomValue").textContent = `${state.zoom}%`;
  $("zoomRange").value = state.zoom;
  $("sizeValue").textContent = `${state.size} × ${state.size}`;
  $("characterSize").value = state.size;
  $("speedValue").textContent = `${state.speed}%`;
  $("movementSpeed").value = state.speed;
  $("resolutionLabel").textContent = `${state.width} × ${state.height}`;
  $("devicePreset").value = `${state.width}x${state.height}`;
  $("posX").value = Math.round(state.x);
  $("posY").value = Math.round(state.y);
  $("characterName").textContent = character.name;
  $("previewCharacter").src = assetUrl(character);
  $("stageCharacter").src = assetUrl(character);
  $("stageCharacter").hidden = character.spine && spineReady;
  $("spineCharacter").hidden = !character.spine || !spineReady;
  const aspect = state.width / state.height;
  $("deviceFrame").style.aspectRatio = `${state.width} / ${state.height}`;
  $("deviceFrame").style.width = aspect > .8 ? "min(62vh, 520px)" : "min(48vh, 390px)";
  const displayScale = $("deviceFrame").clientWidth / state.width || 1;
  const renderedSize = state.size * displayScale;
  [$("stageCharacter"), $("spineCharacter")].forEach((node) => {
    node.style.width = `${renderedSize}px`; node.style.height = `${renderedSize}px`;
  });
  renderCamera();
  renderSideMaps(); renderCharacters();
}

function enterMap(id) {
  state.mapId = id;
  $("homeView").hidden = true;
  $("explorerView").hidden = false;
  renderExplorer();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goHome() {
  $("explorerView").hidden = true;
  $("homeView").hidden = false;
  renderGallery();
}

function deleteMap(id) {
  const map = state.maps.find((item) => item.id === id);
  if (!map || map.builtIn) return;
  if (!window.confirm(`确定删除场景“${map.name}”吗？`)) return;
  if (map.src?.startsWith("blob:")) URL.revokeObjectURL(map.src);
  state.maps = state.maps.filter((item) => item.id !== id);
  dbDelete("maps", id);
  if (state.mapId === id) state.mapId = "default";
  if ($("explorerView").hidden) renderGallery(); else renderExplorer();
}

function setSceneZoom(value) {
  const map = currentMap();
  map.zoom = clamp(value, 60, 400);
  state.zoom = map.zoom;
  renderExplorer();
}

async function imageInfo(file) {
  const url = URL.createObjectURL(file);
  const info = await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = url;
  });
  URL.revokeObjectURL(url);
  return info;
}

async function importMaps(fileList) {
  const files = [...(fileList || [])];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      window.alert(`“${file.name}”超过 100MB，已跳过。`);
      continue;
    }
    const info = await imageInfo(file);
    const map = { id: `map-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: file.name.replace(/\.[^.]+$/, ""), blob: file, width: info.width, height: info.height, createdAt: Date.now() };
    state.maps.push(map); dbWrite("maps", map);
  }
  renderGallery(); renderSideMaps();
}

async function importCharacters(fileList) {
  for (const file of [...(fileList || [])]) {
    if (file.size > MAX_UPLOAD_BYTES) {
      window.alert(`“${file.name}”超过 100MB，已跳过。`);
      continue;
    }
    const info = await imageInfo(file);
    const character = { id: `character-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: file.name.replace(/\.[^.]+$/, ""), blob: file, width: info.width, height: info.height, createdAt: Date.now() };
    state.characters.push(character); state.characterId = character.id; dbWrite("characters", character);
  }
  renderExplorer();
}

function initSpine() {
  if (!window.spine?.SpinePlayer) return;
  try {
    spinePlayer = new spine.SpinePlayer("spinePlayer", {
      skelUrl: "./player.skel",
      atlasUrl: "./player.atlas",
      animation: "idle-right",
      showControls: false,
      showLoading: false,
      alpha: true,
      backgroundColor: "#00000000",
      premultipliedAlpha: false,
      success(player) {
        spinePlayer = player;
        spineReady = true;
        spineAnimation = "";
        setDirectionalAnimation(moving ? "move" : "idle");
        renderExplorer();
      },
    });
  } catch { spineReady = false; }
}

function updateStick(event) {
  if (!stickOrigin) return;
  const radius = $("joystick").offsetWidth / 2;
  const dx = event.clientX - stickOrigin.x;
  const dy = event.clientY - stickOrigin.y;
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;
  move = { x: dx * scale / radius, y: dy * scale / radius };
  $("knob").style.transform = `translate(calc(-50% + ${move.x * 28}px), calc(-50% + ${move.y * 28}px))`;
  const target = currentCharacter().spine && spineReady ? $("spineCharacter") : $("stageCharacter");
  if (Math.abs(move.x) > .08) {
    facing = move.x < 0 ? "left" : "right";
    setDirectionalAnimation(moving ? "move" : "idle");
  }
}

function bindEvents() {
  $("mapGallery").onclick = (event) => { const remove = event.target.closest("[data-delete-map]"); if (remove) { event.stopPropagation(); deleteMap(remove.dataset.deleteMap); return; } const card = event.target.closest("[data-map-id]"); if (card) enterMap(card.dataset.mapId); };
  $("sideMapList").onclick = (event) => { const remove = event.target.closest("[data-delete-map]"); if (remove) { event.stopPropagation(); deleteMap(remove.dataset.deleteMap); return; } const card = event.target.closest("[data-map-id]"); if (card) { state.mapId = card.dataset.mapId; renderExplorer(); } };
  $("characterList").onclick = (event) => { const card = event.target.closest("[data-character-id]"); if (card) { state.characterId = card.dataset.characterId; renderExplorer(); } };
  $("sideMapUpload").onchange = async (event) => { await importMaps(event.target.files); state.mapId = state.maps.at(-1).id; renderExplorer(); };
  $("characterUpload").onchange = (event) => importCharacters(event.target.files);
  $("backHome").onclick = goHome;
  $("resetScene").onclick = () => { state.x = 50; state.y = 68; setSceneZoom(140); };
  $("zoomRange").oninput = (event) => setSceneZoom(+event.target.value);
  $("zoomOut").onclick = () => setSceneZoom(state.zoom - 10);
  $("zoomIn").onclick = () => setSceneZoom(state.zoom + 10);
  $("characterSize").oninput = (event) => { state.size = +event.target.value; renderExplorer(); };
  $("movementSpeed").oninput = (event) => { state.speed = +event.target.value; $("speedValue").textContent = `${state.speed}%`; };
  $("devicePreset").onchange = (event) => { [state.width, state.height] = event.target.value.split("x").map(Number); renderExplorer(); };
  $("posX").onchange = (event) => { state.x = clamp(+event.target.value, 0, 100); renderExplorer(); };
  $("posY").onchange = (event) => { state.y = clamp(+event.target.value, 0, 100); renderExplorer(); };
  const frame = $("deviceFrame");
  frame.onpointerdown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    const rect = frame.getBoundingClientRect();
    stickOrigin = { x: event.clientX, y: event.clientY };
    const joystick = $("joystick");
    joystick.style.left = `${event.clientX - rect.left}px`;
    joystick.style.top = `${event.clientY - rect.top}px`;
    joystick.style.bottom = "auto";
    joystick.classList.add("is-active");
    moving = true;
    move = { x: 0, y: 0 };
    const target = currentCharacter().spine && spineReady ? $("spineCharacter") : $("stageCharacter");
    if (target === $("stageCharacter")) target.classList.add("is-walking");
    if (currentCharacter().spine && spineReady) {
      setDirectionalAnimation("move");
    }
    frame.setPointerCapture(event.pointerId);
    updateStick(event);
  };
  frame.onpointermove = (event) => { if (moving) updateStick(event); };
  const stop = () => {
    moving = false;
    move = { x: 0, y: 0 };
    stickOrigin = null;
    if (currentCharacter().spine && spineReady) setDirectionalAnimation("idle");
    $("stageCharacter").classList.remove("is-walking");
    $("spineCharacter").classList.remove("is-walking");
    $("knob").style.transform = "translate(-50%, -50%)";
    $("joystick").classList.remove("is-active");
  };
  frame.onpointerup = stop;
  frame.onpointercancel = stop;
  frame.onlostpointercapture = () => { if (moving) stop(); };
  window.addEventListener("resize", () => { if (!$("explorerView").hidden) renderExplorer(); });
}

function movementLoop(timestamp = 0) {
  const deltaSeconds = lastFrameTime ? clamp((timestamp - lastFrameTime) / 1000, 0, .05) : 0;
  lastFrameTime = timestamp;
  if (moving) {
    const distance = 24 * deltaSeconds * (state.speed / 100);
    state.x = clamp(state.x + move.x * distance, 4, 96); state.y = clamp(state.y + move.y * distance, 5, 95);
    renderCamera();
    $("posX").value = Math.round(state.x); $("posY").value = Math.round(state.y);
  }
  requestAnimationFrame(movementLoop);
}

async function start() {
  try {
    await openDatabase();
    const [maps, characters] = await Promise.all([dbRead("maps"), dbRead("characters")]);
    state.maps.push(...maps); state.characters.push(...characters);
  } catch { /* IndexedDB unavailable: the current session still works. */ }
  bindEvents(); renderGallery(); renderExplorer(); initSpine(); movementLoop();
}

start();
