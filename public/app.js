const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const state = {
  maps: [{ id: "default", name: "云隐山水", builtIn: true, width: 720, height: 1280 }],
  characters: [
    { id: "spine", name: "剑侠 · move-right", src: "/hero-male.png", spine: true },
    { id: "male", name: "少侠", src: "/hero-male.png" },
    { id: "female", name: "小师妹", src: "/hero-female.png" },
  ],
  mapId: "default", characterId: "spine", width: 720, height: 1280,
  zoom: 100, size: 135, x: 50, y: 68,
};

let database;
let move = { x: 0, y: 0 };
let moving = false;
let spineReady = false;

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

function renderGallery() {
  const gallery = $("mapGallery");
  gallery.innerHTML = state.maps.map((map) => {
    const preview = map.builtIn
      ? '<div class="map-cover built-in-cover"><i></i><i></i><i></i></div>'
      : `<img class="map-cover" src="${assetUrl(map)}" alt="${map.name}">`;
    return `<button class="map-tile" data-map-id="${map.id}">${preview}<span class="map-tile-info"><b>${map.name}</b><small>${map.width} × ${map.height}</small></span><i class="enter-mark">进入</i></button>`;
  }).join("") + '<label class="map-tile add-map-tile"><span>＋</span><b>上传新地图</b><small>PNG / JPG / WEBP</small><input id="galleryMapUpload" type="file" accept="image/*" multiple></label>';
  $("mapCount").textContent = state.maps.length;
  $("galleryMapUpload").onchange = (event) => importMaps(event.target.files);
}

function renderSideMaps() {
  $("sideMapList").innerHTML = state.maps.map((map) => {
    const image = map.builtIn ? '<span class="mini-built-in"></span>' : `<img src="${assetUrl(map)}" alt="">`;
    return `<button data-map-id="${map.id}" class="side-map ${map.id === state.mapId ? "active" : ""}">${image}<span>${map.name}</span></button>`;
  }).join("");
}

function renderCharacters() {
  $("characterList").innerHTML = state.characters.map((character) =>
    `<button class="character-option ${character.id === state.characterId ? "active" : ""}" data-character-id="${character.id}"><img src="${assetUrl(character)}" alt=""><span>${character.name}</span></button>`
  ).join("");
}

function renderExplorer() {
  const map = currentMap();
  const character = currentCharacter();
  $("currentMapName").textContent = map.name;
  $("hudMapName").textContent = map.name;
  $("builtIn").hidden = !map.builtIn;
  $("scene").style.backgroundImage = map.builtIn ? "" : `url("${assetUrl(map)}")`;
  $("scene").style.transform = `scale(${state.zoom / 100})`;
  $("zoomValue").textContent = `${state.zoom}%`;
  $("zoomRange").value = state.zoom;
  $("sizeValue").textContent = `${state.size} × ${state.size}`;
  $("characterSize").value = state.size;
  $("resolutionLabel").textContent = `${state.width} × ${state.height}`;
  $("devicePreset").value = `${state.width}x${state.height}`;
  $("posX").value = Math.round(state.x);
  $("posY").value = Math.round(state.y);
  $("characterName").textContent = character.name;
  $("previewCharacter").src = assetUrl(character);
  $("stageCharacter").src = assetUrl(character);
  $("stageCharacter").hidden = character.spine && spineReady;
  $("spineCharacter").hidden = !character.spine || !spineReady;
  [$("stageCharacter"), $("spineCharacter")].forEach((node) => {
    node.style.width = `${state.size}px`; node.style.height = `${state.size}px`;
    node.style.left = `${state.x}%`; node.style.top = `${state.y}%`;
  });
  const aspect = state.width / state.height;
  $("deviceFrame").style.aspectRatio = `${state.width} / ${state.height}`;
  $("deviceFrame").style.width = aspect > .8 ? "min(62vh, 520px)" : "min(48vh, 390px)";
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
    const info = await imageInfo(file);
    const map = { id: `map-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: file.name.replace(/\.[^.]+$/, ""), blob: file, width: info.width, height: info.height, createdAt: Date.now() };
    state.maps.push(map); dbWrite("maps", map);
  }
  renderGallery(); renderSideMaps();
}

async function importCharacters(fileList) {
  for (const file of [...(fileList || [])]) {
    const info = await imageInfo(file);
    const character = { id: `character-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: file.name.replace(/\.[^.]+$/, ""), blob: file, width: info.width, height: info.height, createdAt: Date.now() };
    state.characters.push(character); state.characterId = character.id; dbWrite("characters", character);
  }
  renderExplorer();
}

function initSpine() {
  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "https://unpkg.com/@esotericsoftware/spine-player@3.8.*/dist/spine-player.css";
  document.head.appendChild(css);
  const script = document.createElement("script");
  script.src = "https://unpkg.com/@esotericsoftware/spine-player@3.8.*/dist/iife/spine-player.js";
  script.onload = () => {
    try {
      new spine.SpinePlayer("spinePlayer", { skelUrl: "/player.skel", atlasUrl: "/player.atlas", animation: "move-right", showControls: false, showLoading: false, alpha: true, backgroundColor: "#00000000", premultipliedAlpha: false });
      const timer = setInterval(() => {
        if ($("spinePlayer").querySelector("canvas")) { spineReady = true; clearInterval(timer); renderExplorer(); }
      }, 250);
      setTimeout(() => clearInterval(timer), 8000);
    } catch { spineReady = false; }
  };
  document.head.appendChild(script);
}

function updateStick(event) {
  const rect = $("joystick").getBoundingClientRect();
  const radius = rect.width / 2;
  const dx = event.clientX - rect.left - radius;
  const dy = event.clientY - rect.top - radius;
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;
  move = { x: dx * scale / radius, y: dy * scale / radius };
  $("knob").style.transform = `translate(calc(-50% + ${move.x * 28}px), calc(-50% + ${move.y * 28}px))`;
  const target = currentCharacter().spine && spineReady ? $("spineCharacter") : $("stageCharacter");
  if (Math.abs(move.x) > .08) target.style.transform = `translate(-50%, -50%) scaleX(${move.x < 0 ? -1 : 1})`;
}

function bindEvents() {
  $("mapGallery").onclick = (event) => { const card = event.target.closest("[data-map-id]"); if (card) enterMap(card.dataset.mapId); };
  $("sideMapList").onclick = (event) => { const card = event.target.closest("[data-map-id]"); if (card) { state.mapId = card.dataset.mapId; renderExplorer(); } };
  $("characterList").onclick = (event) => { const card = event.target.closest("[data-character-id]"); if (card) { state.characterId = card.dataset.characterId; renderExplorer(); } };
  $("homeMapUpload").onchange = (event) => importMaps(event.target.files);
  $("sideMapUpload").onchange = async (event) => { await importMaps(event.target.files); state.mapId = state.maps.at(-1).id; renderExplorer(); };
  $("characterUpload").onchange = (event) => importCharacters(event.target.files);
  $("backHome").onclick = goHome;
  $("resetScene").onclick = () => { state.x = 50; state.y = 68; state.zoom = 100; renderExplorer(); };
  $("zoomRange").oninput = (event) => { state.zoom = +event.target.value; renderExplorer(); };
  $("characterSize").oninput = (event) => { state.size = +event.target.value; renderExplorer(); };
  $("devicePreset").onchange = (event) => { [state.width, state.height] = event.target.value.split("x").map(Number); renderExplorer(); };
  $("posX").onchange = (event) => { state.x = clamp(+event.target.value, 0, 100); renderExplorer(); };
  $("posY").onchange = (event) => { state.y = clamp(+event.target.value, 0, 100); renderExplorer(); };
  $("joystick").onpointerdown = (event) => { moving = true; $("joystick").setPointerCapture(event.pointerId); updateStick(event); };
  $("joystick").onpointermove = (event) => { if (moving) updateStick(event); };
  const stop = () => { moving = false; move = { x: 0, y: 0 }; $("knob").style.transform = "translate(-50%, -50%)"; };
  $("joystick").onpointerup = stop; $("joystick").onpointercancel = stop;
}

function movementLoop() {
  if (moving) {
    state.x = clamp(state.x + move.x * .4, 4, 96); state.y = clamp(state.y + move.y * .4, 5, 95);
    const target = currentCharacter().spine && spineReady ? $("spineCharacter") : $("stageCharacter");
    target.style.left = `${state.x}%`; target.style.top = `${state.y}%`;
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
