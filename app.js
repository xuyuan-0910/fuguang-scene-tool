const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const SCENE_SETTINGS_KEY = "fuguang-scene-settings-v2";
const state = {
  maps: [{ id: "default", name: "云隐山水", builtIn: true, width: 720, height: 1280, zoom: 140, fit: "cover" }],
  characters: [
    { id: "spine", name: "剑侠", src: "./hero-male.png", spine: true, builtIn: true },
    { id: "female", name: "小师妹", src: "./hero-female.png", builtIn: true },
  ],
  mapId: "default", characterId: "spine", width: 720, height: 1280,
  zoom: 140, size: 96, sizeWidth: 96, sizeHeight: 96, speed: 100, x: 50, y: 68, controlMode: "joystick",
};

let database;
let move = { x: 0, y: 0 };
let moving = false;
let spineReady = false;
let spinePlayer = null;
let spineAnimation = "";
let loadedSpineCharacterId = "";
let spineLoadNonce = 0;
let facing = "right";
let stickOrigin = null;
let clickTarget = null;
let lastFrameTime = 0;
let selectedBuildingId = null;
let draggingBuildingId = null;
let buildingDragOffset = { x: 0, y: 0 };

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
  const storedValue = { ...value };
  delete storedValue.src;
  if (Array.isArray(storedValue.buildings)) {
    storedValue.buildings = storedValue.buildings.map((building) => {
      const storedBuilding = { ...building };
      delete storedBuilding.src;
      return storedBuilding;
    });
  }
  database.transaction(storeName, "readwrite").objectStore(storeName).put(storedValue);
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
function currentCharacter() { return state.characters.find((item) => item.id === state.characterId) || state.characters[0] || { id: "", name: "", src: "" }; }

function saveSceneSettings() {
  try {
    localStorage.setItem(SCENE_SETTINGS_KEY, JSON.stringify({
      mapId: state.mapId, characterId: state.characterId, width: state.width, height: state.height,
      size: state.size, sizeWidth: state.sizeWidth, sizeHeight: state.sizeHeight, speed: state.speed, x: state.x, y: state.y, controlMode: state.controlMode,
    }));
  } catch { /* Storage is unavailable: the current session still works. */ }
}

function restoreSceneSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SCENE_SETTINGS_KEY) || "null");
    if (!saved) return;
    ["width", "height", "size", "speed", "x", "y"].forEach((key) => { if (Number.isFinite(saved[key])) state[key] = saved[key]; });
    state.sizeWidth = Number.isFinite(saved.sizeWidth) ? saved.sizeWidth : state.size;
    state.sizeHeight = Number.isFinite(saved.sizeHeight) ? saved.sizeHeight : state.size;
    if (["click", "joystick"].includes(saved.controlMode)) state.controlMode = saved.controlMode;
    state.mapId = state.maps.some((map) => map.id === saved.mapId) ? saved.mapId : state.maps[0]?.id || null;
    state.characterId = state.characters.some((character) => character.id === saved.characterId) ? saved.characterId : state.characters[0]?.id || "";
  } catch { /* Ignore malformed old settings. */ }
}

function setSpineAnimation(name) {
  if (!name || !spineReady || !spinePlayer || spineAnimation === name) return;
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
  const character = currentCharacter();
  const clips = character.spineAnimations || [];
  const preferred = [`${action}-${facing}`, action, `idle-${facing}`, "idle", clips[0]].find((clip) => !clips.length || clips.includes(clip));
  setSpineAnimation(character.customSpine ? preferred : animation.clip);
}

function stopCharacterMovement() {
  moving = false;
  move = { x: 0, y: 0 };
  stickOrigin = null;
  clickTarget = null;
  if (currentCharacter().spine && spineReady) setDirectionalAnimation("idle");
  $("stageCharacter").classList.remove("is-walking");
  $("spineCharacter").classList.remove("is-walking");
  $("knob").style.transform = "translate(-50%, -50%)";
  $("joystick").classList.remove("is-active");
  saveSceneSettings();
}

function renderControlMode() {
  document.querySelectorAll("[data-control-mode]").forEach((button) => {
    const active = button.dataset.controlMode === state.controlMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const clickMode = state.controlMode === "click";
  $("joystick").hidden = clickMode;
  $("movementHelp").textContent = clickMode
    ? "点击地图上的目标位置，角色会自动行走过去"
    : "在地图任意位置按住并拖动即可移动角色，松手停止";
  $("controlModeHelp").textContent = clickMode
    ? "点击地图上的任意位置，角色会自动走向目标；再次点击可立即更换目标。"
    : "在地图任意位置按住并拖动摇杆，角色会沿拖动方向持续行走。";
}

function setControlMode(mode) {
  if (mode !== "click" && mode !== "joystick") return;
  stopCharacterMovement();
  state.controlMode = mode;
  saveSceneSettings();
  renderControlMode();
}

function renderGallery() {
  const gallery = $("mapGallery");
  gallery.innerHTML = state.maps.map((map) => {
    const preview = map.builtIn
      ? '<div class="map-cover built-in-cover"><i></i><i></i><i></i></div>'
      : `<img class="map-cover" src="${assetUrl(map)}" alt="${map.name}">`;
    const remove = `<button class="map-delete" type="button" data-delete-map="${map.id}" aria-label="删除场景 ${map.name}" title="删除场景">×</button>`;
    const shortName = Array.from(map.name).length > 12 ? `${Array.from(map.name).slice(0, 12).join("")}…` : map.name;
    return `<article class="map-tile" data-map-id="${map.id}" tabindex="0">${preview}<span class="map-tile-info"><b title="${map.name}">${shortName}</b><small>${map.width} × ${map.height}</small></span><i class="enter-mark">进入</i>${remove}</article>`;
  }).join("") + '<label class="map-tile add-map-tile"><span class="add-map-title"><i>＋</i><b>上传新地图</b></span><small><span>PNG / JPG / WEBP</span><span>最大 100MB</span></small><input id="galleryMapUpload" type="file" accept="image/*" multiple></label>';
  $("mapCount").textContent = state.maps.length;
  $("galleryMapUpload").onchange = (event) => importMaps(event.target.files);
}

function renderSideMaps() {
  $("sideMapList").classList.toggle("scrollable", state.maps.length > 4);
  $("sideMapList").innerHTML = state.maps.map((map) => {
    const image = map.builtIn ? '<span class="mini-built-in"></span>' : `<img src="${assetUrl(map)}" alt="">`;
    const remove = `<button class="side-map-delete" type="button" data-delete-map="${map.id}" aria-label="删除场景 ${map.name}" title="删除场景">×</button>`;
    return `<div data-map-id="${map.id}" class="side-map ${map.id === state.mapId ? "active" : ""}" role="button" tabindex="0">${image}<span>${map.name}</span>${remove}</div>`;
  }).join("");
}

function renderCharacters() {
  $("characterList").innerHTML = state.characters.length ? state.characters.map((character) => {
    const preview = character.customSpine ? '<span class="spine-preview">SPINE</span>' : `<img src="${assetUrl(character)}" alt="">`;
    return `<div class="character-option ${character.id === state.characterId ? "active" : ""}" data-character-id="${character.id}" role="button" tabindex="0">${preview}<span>${character.name}</span><button class="character-delete" type="button" data-delete-character="${character.id}" aria-label="删除角色 ${character.name}" title="删除角色">×</button></div>`;
  }).join("") : '<p class="character-empty">暂无角色</p>';
}

function renderBuildings() {
  const map = currentMap();
  map.buildings ??= [];
  map.buildings.forEach((building) => { building.inScene ??= true; });
  if (!map.buildings.some((building) => building.id === selectedBuildingId)) selectedBuildingId = null;
  $("buildingLayer").innerHTML = map.buildings.filter((building) => building.inScene).map((building) =>
    `<img class="scene-building ${building.id === selectedBuildingId ? "selected" : ""}" data-building-id="${building.id}" src="${assetUrl(building)}" alt="" style="left:${building.x}%;top:${building.y}%;width:${building.size / state.width * 100}%">`
  ).join("");
  $("buildingList").innerHTML = map.buildings.length ? map.buildings.map((building, index) =>
    `<div class="building-preview ${building.id === selectedBuildingId ? "selected" : ""} ${building.inScene ? "" : "off-scene"}" data-building-select="${building.id}"><img src="${assetUrl(building)}" alt="建筑 ${index + 1}">${building.inScene ? "" : '<span class="building-status">未放入</span>'}</div>`
  ).join("") : '<p class="building-empty">当前地图还没有建筑</p>';
  const selected = map.buildings.find((building) => building.id === selectedBuildingId);
  $("buildingConfig").hidden = !selected;
  if (selected) {
    $("buildingSize").value = Math.round(selected.size);
    $("buildingSceneAction").textContent = selected.inScene ? "删除场景内建筑" : "重新添加到场景";
  }
}

function selectBuilding(id) {
  selectedBuildingId = id;
  const map = currentMap();
  const selected = map.buildings?.find((building) => building.id === id);
  document.querySelectorAll("[data-building-id]").forEach((node) => node.classList.toggle("selected", node.dataset.buildingId === id));
  document.querySelectorAll("[data-building-select]").forEach((node) => node.classList.toggle("selected", node.dataset.buildingSelect === id));
  $("buildingConfig").hidden = !selected;
  if (selected) {
    $("buildingSize").value = Math.round(selected.size);
    $("buildingSceneAction").textContent = selected.inScene ? "删除场景内建筑" : "重新添加到场景";
  }
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

function refreshHighResolutionRendering() {
  if ($("explorerView").hidden) return;
  const resizeSpineCanvas = () => {
    if ($("explorerView").hidden || !spinePlayer?.sceneRenderer || !window.spine?.webgl?.ResizeMode) return;
    spinePlayer.sceneRenderer.resize(spine.webgl.ResizeMode.Expand);
  };
  requestAnimationFrame(() => {
    renderCamera();
    resizeSpineCanvas();
    requestAnimationFrame(() => {
      renderCamera();
      resizeSpineCanvas();
    });
  });
}

function renderExplorer() {
  const map = currentMap();
  const character = currentCharacter();
  if (!$("explorerView").hidden && character.spine) ensureSpineCharacter(character);
  $("currentMapName").textContent = map.name;
  $("hudMapName").textContent = map.name;
  $("builtIn").hidden = !map.builtIn;
  $("sceneBackground").style.backgroundImage = map.builtIn ? "" : `url("${assetUrl(map)}")`;
  map.fit ??= map.builtIn ? "cover" : "contain";
  state.zoom = map.zoom ?? (map.builtIn ? 140 : 100);
  $("sceneBackground").style.backgroundSize = map.fit;
  $("mapFit").value = map.fit;
  $("fitValue").textContent = map.fit === "contain" ? "完整显示" : "填满裁切";
  $("zoomValue").textContent = `${state.zoom}%`;
  $("zoomRange").value = state.zoom;
  $("characterSize").value = clamp(state.size, 48, 260);
  $("characterSizeInput").value = state.sizeWidth;
  $("characterHeightInput").value = state.sizeHeight;
  $("speedValue").textContent = `${state.speed}%`;
  $("movementSpeed").value = state.speed;
  $("resolutionLabel").textContent = `${state.width} × ${state.height}`;
  $("devicePreset").value = `${state.width}x${state.height}`;
  $("posX").value = Math.round(state.x);
  $("posY").value = Math.round(state.y);
  $("stageCharacter").src = assetUrl(character);
  $("stageCharacter").hidden = !character.id || (character.spine && spineReady);
  $("spineCharacter").hidden = !character.id || !character.spine || !spineReady;
  const aspect = state.width / state.height;
  $("deviceFrame").style.aspectRatio = `${state.width} / ${state.height}`;
  $("deviceFrame").style.width = aspect > .8 ? "min(62vh, 520px)" : "min(48vh, 390px)";
  const displayScale = $("deviceFrame").clientWidth / state.width || 1;
  const renderedWidth = state.sizeWidth * displayScale;
  const renderedHeight = state.sizeHeight * displayScale;
  [$("stageCharacter"), $("spineCharacter")].forEach((node) => {
    node.style.width = `${renderedWidth}px`; node.style.height = `${renderedHeight}px`;
  });
  renderBuildings();
  renderCamera();
  renderSideMaps(); renderCharacters(); renderControlMode();
  refreshHighResolutionRendering();
}

function enterMap(id) {
  state.mapId = id;
  $("homeView").hidden = true;
  $("explorerView").hidden = false;
  renderExplorer();
  saveSceneSettings();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function goHome() {
  $("explorerView").hidden = true;
  $("homeView").hidden = false;
  renderGallery();
}

function deleteMap(id) {
  const map = state.maps.find((item) => item.id === id);
  if (!map) return;
  if (!window.confirm(`确定删除场景“${map.name}”吗？`)) return;
  if (map.src?.startsWith("blob:")) URL.revokeObjectURL(map.src);
  state.maps = state.maps.filter((item) => item.id !== id);
  dbDelete("maps", id);
  if (map.builtIn) localStorage.setItem("fuguang-default-map-deleted", "1");
  if (state.mapId === id) state.mapId = state.maps[0]?.id || null;
  if (!state.maps.length) goHome();
  else if ($("explorerView").hidden) renderGallery();
  else renderExplorer();
}

function setSceneZoom(value) {
  const map = currentMap();
  map.zoom = clamp(value, 60, 1000);
  state.zoom = map.zoom;
  dbWrite("maps", map); saveSceneSettings();
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
    const map = { id: `map-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: file.name.replace(/\.[^.]+$/, ""), blob: file, width: info.width, height: info.height, zoom: 100, fit: "contain", createdAt: Date.now() };
    state.maps.push(map); dbWrite("maps", map);
  }
  renderGallery(); renderSideMaps();
}

async function addBuildingsAt(fileList, baseX, baseY) {
  const map = currentMap();
  map.buildings ??= [];
  let added = 0;
  for (const file of [...(fileList || [])]) {
    if (file.size > MAX_UPLOAD_BYTES) {
      window.alert(`“${file.name}”超过 100MB，已跳过。`);
      continue;
    }
    const info = await imageInfo(file);
    map.buildings.push({
      id: `building-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: file.name.replace(/\.[^.]+$/, ""),
      blob: file,
      width: info.width,
      height: info.height,
      x: clamp(baseX + added * 3, 0, 100),
      y: clamp(baseY + added * 3, 0, 100),
      size: 180,
      inScene: true,
    });
    added += 1;
  }
  if (added) {
    selectedBuildingId = map.buildings.at(-1).id;
    dbWrite("maps", map);
    renderExplorer();
  }
}

async function importBuildings(fileList, clientX, clientY) {
  const rect = $("sceneBackground").getBoundingClientRect();
  const x = clamp((clientX - rect.left) / rect.width * 100, 0, 100);
  const y = clamp((clientY - rect.top) / rect.height * 100, 0, 100);
  await addBuildingsAt(fileList, x, y);
}

function deleteBuildingFromLibrary(id) {
  const map = currentMap();
  const building = map.buildings?.find((item) => item.id === id);
  if (!building) return;
  if (building.src?.startsWith("blob:")) URL.revokeObjectURL(building.src);
  map.buildings = map.buildings.filter((item) => item.id !== id);
  if (selectedBuildingId === id) selectedBuildingId = null;
  dbWrite("maps", map);
  renderExplorer();
}

function toggleBuildingInScene(id) {
  const map = currentMap();
  const building = map.buildings?.find((item) => item.id === id);
  if (!building) return;
  building.inScene = !building.inScene;
  if (building.inScene) {
    building.x = clamp(state.x, 5, 95);
    building.y = clamp(state.y - 6, 10, 95);
  }
  dbWrite("maps", map);
  renderExplorer();
}

function moveBuildingFromPointer(id, event) {
  const building = currentMap().buildings?.find((item) => item.id === id);
  if (!building) return;
  const rect = $("sceneBackground").getBoundingClientRect();
  building.x = clamp((event.clientX - buildingDragOffset.x - rect.left) / rect.width * 100, 0, 100);
  building.y = clamp((event.clientY - buildingDragOffset.y - rect.top) / rect.height * 100, 0, 100);
  const node = document.querySelector(`[data-building-id="${id}"]`);
  if (node) { node.style.left = `${building.x}%`; node.style.top = `${building.y}%`; }
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
  saveSceneSettings(); renderExplorer();
}

function deleteCharacter(id) {
  const character = state.characters.find((item) => item.id === id);
  if (!character || !window.confirm(`确定删除角色“${character.name}”吗？`)) return;
  if (character.src?.startsWith("blob:")) URL.revokeObjectURL(character.src);
  state.characters = state.characters.filter((item) => item.id !== id);
  dbDelete("characters", id);
  if (character.builtIn) {
    const deleted = new Set(JSON.parse(localStorage.getItem("fuguang-deleted-built-in-characters") || "[]"));
    deleted.add(id);
    localStorage.setItem("fuguang-deleted-built-in-characters", JSON.stringify([...deleted]));
  }
  if (state.characterId === id) state.characterId = state.characters[0]?.id || "";
  saveSceneSettings(); renderExplorer();
}

function dataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function importSpineCharacter(fileList) {
  const files = [...(fileList || [])];
  const skeleton = files.find((file) => /\.(skel|json)$/i.test(file.name));
  const atlas = files.find((file) => /\.atlas$/i.test(file.name));
  const textures = files.filter((file) => /^image\//.test(file.type) || /\.(png|webp)$/i.test(file.name));
  if (!skeleton || !atlas || !textures.length) {
    window.alert("请一次选择 Spine 的 .skel 或 .json、.atlas，以及至少一张 PNG/WebP 贴图。");
    return;
  }
  if (files.some((file) => file.size > MAX_UPLOAD_BYTES)) { window.alert("Spine 文件单个最大 100MB。"); return; }
  const character = {
    id: `spine-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: skeleton.name.replace(/\.(skel|json)$/i, ""), spine: true, customSpine: true,
    skeletonName: skeleton.name, atlasName: atlas.name,
    spineFiles: files.map((file) => ({ name: file.name, blob: file })), createdAt: Date.now(),
  };
  state.characters.push(character); state.characterId = character.id;
  dbWrite("characters", character); saveSceneSettings(); renderExplorer();
}

async function ensureSpineCharacter(character = currentCharacter()) {
  if (!character?.spine || !window.spine?.SpinePlayer || loadedSpineCharacterId === character.id) return;
  const requestId = ++spineLoadNonce;
  loadedSpineCharacterId = character.id;
  spineReady = false;
  spineAnimation = "";
  try { spinePlayer?.stopRendering?.(); spinePlayer?.dom?.remove(); } catch { /* Replace the previous player safely. */ }
  $("spinePlayer").replaceChildren();
  try {
    const rawDataURIs = character.customSpine ? Object.fromEntries(await Promise.all((character.spineFiles || []).map(async (entry) => [entry.name, await dataUrl(entry.blob)]))) : undefined;
    if (requestId !== spineLoadNonce || currentCharacter().id !== character.id) return;
    const config = {
      atlasUrl: character.customSpine ? character.atlasName : "./player.atlas",
      showControls: false, showLoading: false, alpha: true, backgroundColor: "#00000000", premultipliedAlpha: false,
      rawDataURIs,
      success(player) {
        if (requestId !== spineLoadNonce || currentCharacter().id !== character.id) return;
        spinePlayer = player; spineReady = true; spineAnimation = "";
        if (character.customSpine) {
          character.spineAnimations = player.skeleton?.data?.animations?.map((animation) => animation.name) || [];
          dbWrite("characters", character);
        }
        setDirectionalAnimation(moving ? "move" : "idle");
        if (state.maps.length) renderExplorer();
      },
      error() { if (requestId === spineLoadNonce) { spineReady = false; } },
    };
    if (character.customSpine && /\.json$/i.test(character.skeletonName)) config.jsonUrl = character.skeletonName;
    else config.skelUrl = character.customSpine ? character.skeletonName : "./player.skel";
    if (!character.customSpine) config.animation = "idle-right";
    spinePlayer = new spine.SpinePlayer("spinePlayer", config);
  } catch { spineReady = false; }
}

function initSpine() { /* Spine is loaded only after the user opens a scene. */ }

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
  $("sideMapList").onclick = (event) => { const remove = event.target.closest("[data-delete-map]"); if (remove) { event.stopPropagation(); deleteMap(remove.dataset.deleteMap); return; } const card = event.target.closest("[data-map-id]"); if (card) { state.mapId = card.dataset.mapId; saveSceneSettings(); renderExplorer(); } };
  $("characterList").onclick = (event) => {
    const remove = event.target.closest("[data-delete-character]");
    if (remove) { event.stopPropagation(); deleteCharacter(remove.dataset.deleteCharacter); return; }
    const card = event.target.closest("[data-character-id]");
    if (card) { state.characterId = card.dataset.characterId; saveSceneSettings(); renderExplorer(); }
  };
  $("sideMapUpload").onchange = async (event) => { await importMaps(event.target.files); state.mapId = state.maps.at(-1).id; saveSceneSettings(); renderExplorer(); };
  $("buildingUpload").onchange = async (event) => {
    const offsets = [[-12, -10], [12, -10], [-12, 8], [12, 8], [0, -18], [0, 16]];
    const offset = offsets[(currentMap().buildings?.length || 0) % offsets.length];
    await addBuildingsAt(event.target.files, clamp(state.x + offset[0], 5, 95), clamp(state.y + offset[1], 10, 95));
    event.target.value = "";
  };
  $("buildingList").onclick = (event) => {
    const preview = event.target.closest("[data-building-select]");
    if (preview) selectBuilding(preview.dataset.buildingSelect);
  };
  $("buildingSize").oninput = (event) => {
    const building = currentMap().buildings?.find((item) => item.id === selectedBuildingId);
    if (!building) return;
    building.size = clamp(+event.target.value || 20, 20, 3000);
    const node = document.querySelector(`[data-building-id="${building.id}"]`);
    if (node) node.style.width = `${building.size / state.width * 100}%`;
  };
  $("buildingSize").onchange = () => { if (selectedBuildingId) dbWrite("maps", currentMap()); };
  $("buildingSceneAction").onclick = () => { if (selectedBuildingId) toggleBuildingInScene(selectedBuildingId); };
  $("buildingLibraryDelete").onclick = () => {
    if (!selectedBuildingId) return;
    if (window.confirm("确定从建筑栏彻底删除这个建筑吗？")) deleteBuildingFromLibrary(selectedBuildingId);
  };
  $("characterUpload").onchange = async (event) => { await importCharacters(event.target.files); event.target.value = ""; };
  $("spineUpload").onchange = async (event) => { await importSpineCharacter(event.target.files); event.target.value = ""; };
  $("backHome").onclick = goHome;
  $("resetScene").onclick = () => { state.x = 50; state.y = 68; setSceneZoom(currentMap().fit === "contain" ? 100 : 140); saveSceneSettings(); };
  $("zoomRange").oninput = (event) => setSceneZoom(+event.target.value);
  $("zoomOut").onclick = () => setSceneZoom(state.zoom - 10);
  $("zoomIn").onclick = () => setSceneZoom(state.zoom + 10);
  $("mapFit").onchange = (event) => {
    const map = currentMap();
    map.fit = event.target.value;
    if (map.fit === "contain") map.zoom = 100;
    dbWrite("maps", map); saveSceneSettings();
    renderExplorer();
  };
  $("characterSize").oninput = (event) => { state.size = +event.target.value; state.sizeWidth = state.size; state.sizeHeight = state.size; saveSceneSettings(); renderExplorer(); };
  $("characterSizeInput").onchange = (event) => { state.sizeWidth = clamp(+event.target.value || 96, 20, 600); state.size = clamp(state.sizeWidth, 48, 260); saveSceneSettings(); renderExplorer(); };
  $("characterHeightInput").onchange = (event) => { state.sizeHeight = clamp(+event.target.value || 96, 20, 600); state.size = clamp(Math.round((state.sizeWidth + state.sizeHeight) / 2), 48, 260); saveSceneSettings(); renderExplorer(); };
  $("characterSizeInput").onkeydown = (event) => { if (event.key === "Enter") event.target.blur(); };
  $("characterHeightInput").onkeydown = (event) => { if (event.key === "Enter") event.target.blur(); };
  $("movementSpeed").oninput = (event) => { state.speed = +event.target.value; $("speedValue").textContent = `${state.speed}%`; saveSceneSettings(); };
  $("controlMode").onclick = (event) => {
    const button = event.target.closest("[data-control-mode]");
    if (button) setControlMode(button.dataset.controlMode);
  };
  $("devicePreset").onchange = (event) => { [state.width, state.height] = event.target.value.split("x").map(Number); saveSceneSettings(); renderExplorer(); };
  $("posX").onchange = (event) => { state.x = clamp(+event.target.value, 0, 100); saveSceneSettings(); renderExplorer(); };
  $("posY").onchange = (event) => { state.y = clamp(+event.target.value, 0, 100); saveSceneSettings(); renderExplorer(); };
  const buildingLayer = $("buildingLayer");
  buildingLayer.onpointerdown = (event) => {
    const building = event.target.closest("[data-building-id]");
    if (!building || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    draggingBuildingId = building.dataset.buildingId;
    selectBuilding(draggingBuildingId);
    const item = currentMap().buildings?.find((entry) => entry.id === draggingBuildingId);
    const rect = $("sceneBackground").getBoundingClientRect();
    buildingDragOffset = item ? {
      x: event.clientX - (rect.left + item.x / 100 * rect.width),
      y: event.clientY - (rect.top + item.y / 100 * rect.height),
    } : { x: 0, y: 0 };
    building.setPointerCapture(event.pointerId);
  };
  buildingLayer.onpointermove = (event) => {
    if (!draggingBuildingId) return;
    event.preventDefault();
    event.stopPropagation();
    moveBuildingFromPointer(draggingBuildingId, event);
  };
  const stopBuildingDrag = (event) => {
    if (!draggingBuildingId) return;
    event?.stopPropagation();
    moveBuildingFromPointer(draggingBuildingId, event);
    dbWrite("maps", currentMap());
    draggingBuildingId = null;
    buildingDragOffset = { x: 0, y: 0 };
  };
  buildingLayer.onpointerup = stopBuildingDrag;
  buildingLayer.onpointercancel = () => { if (draggingBuildingId) { dbWrite("maps", currentMap()); draggingBuildingId = null; buildingDragOffset = { x: 0, y: 0 }; } };
  const frame = $("deviceFrame");
  frame.onpointerdown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    if (state.controlMode === "click") {
      const rect = $("sceneBackground").getBoundingClientRect();
      clickTarget = {
        x: clamp((event.clientX - rect.left) / rect.width * 100, 4, 96),
        y: clamp((event.clientY - rect.top) / rect.height * 100, 5, 95),
      };
      const dx = clickTarget.x - state.x;
      const dy = clickTarget.y - state.y;
      if (Math.hypot(dx, dy) < .2) return;
      moving = true;
      move = { x: dx, y: dy };
      if (Math.abs(dx) > .08) facing = dx < 0 ? "left" : "right";
      if (currentCharacter().spine && spineReady) setDirectionalAnimation("move");
      else $("stageCharacter").classList.add("is-walking");
      return;
    }
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
  frame.onpointermove = (event) => { if (state.controlMode === "joystick" && moving) updateStick(event); };
  frame.onpointerup = () => { if (state.controlMode === "joystick") stopCharacterMovement(); };
  frame.onpointercancel = () => { if (state.controlMode === "joystick") stopCharacterMovement(); };
  frame.onlostpointercapture = () => { if (state.controlMode === "joystick" && moving) stopCharacterMovement(); };
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("[data-building-id], [data-building-select], #buildingConfig")) selectBuilding(null);
  });
  window.addEventListener("resize", () => { if (!$("explorerView").hidden) renderExplorer(); });
}

function bindMapDrop() {
  const overlay = $("dropOverlay");
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
  const hideOverlay = () => document.body.classList.remove("is-dragging-map");

  document.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    document.body.classList.add("is-dragging-map");
  });
  document.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    document.body.classList.add("is-dragging-map");
    const addingBuilding = !$("explorerView").hidden && event.target.closest?.("#deviceFrame");
    $("dropTitle").textContent = addingBuilding ? "松开添加建筑" : "松开上传地图";
    $("dropDescription").textContent = addingBuilding ? "建筑会放在当前指向的位置" : "拖到手机地图画布内可添加为建筑";
  });
  document.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) hideOverlay();
  });
  document.addEventListener("dragend", hideOverlay);
  document.addEventListener("drop", async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    hideOverlay();
    const files = [...(event.dataTransfer?.files || [])].filter((file) =>
      file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)
    );
    if (!files.length) {
      window.alert("请拖入图片文件作为场景地图。");
      return;
    }
    if (!$("explorerView").hidden && event.target.closest?.("#deviceFrame")) {
      await importBuildings(files, event.clientX, event.clientY);
      return;
    }
    const previousIds = new Set(state.maps.map((map) => map.id));
    await importMaps(files);
    if (!$("explorerView").hidden) {
      const addedMaps = state.maps.filter((map) => !previousIds.has(map.id));
      if (addedMaps.length) state.mapId = addedMaps.at(-1).id;
      renderExplorer();
    }
  });
  overlay.setAttribute("aria-hidden", "true");
}

function movementLoop(timestamp = 0) {
  const deltaSeconds = lastFrameTime ? clamp((timestamp - lastFrameTime) / 1000, 0, .05) : 0;
  lastFrameTime = timestamp;
  if (moving) {
    const distance = 24 * deltaSeconds * (state.speed / 100);
    if (state.controlMode === "click" && clickTarget) {
      const dx = clickTarget.x - state.x;
      const dy = clickTarget.y - state.y;
      const remaining = Math.hypot(dx, dy);
      if (remaining <= distance || remaining < .05) {
        state.x = clickTarget.x;
        state.y = clickTarget.y;
        stopCharacterMovement();
      } else {
        move = { x: dx / remaining, y: dy / remaining };
        state.x = clamp(state.x + move.x * distance, 4, 96);
        state.y = clamp(state.y + move.y * distance, 5, 95);
      }
    } else {
      state.x = clamp(state.x + move.x * distance, 4, 96);
      state.y = clamp(state.y + move.y * distance, 5, 95);
    }
    renderCamera();
    $("posX").value = Math.round(state.x); $("posY").value = Math.round(state.y);
  }
  requestAnimationFrame(movementLoop);
}

async function start() {
  try {
    const defaultDeleted = localStorage.getItem("fuguang-default-map-deleted") === "1";
    const deletedCharacters = new Set(JSON.parse(localStorage.getItem("fuguang-deleted-built-in-characters") || "[]"));
    if (defaultDeleted) state.maps = state.maps.filter((map) => !map.builtIn);
    state.characters = state.characters.filter((character) => !deletedCharacters.has(character.id));
    await openDatabase();
    const [maps, characters] = await Promise.all([dbRead("maps"), dbRead("characters")]);
    maps.forEach((map) => {
      if (defaultDeleted && map.id === "default") { dbDelete("maps", map.id); return; }
      delete map.src;
      map.buildings?.forEach((building) => delete building.src);
      const existing = state.maps.find((item) => item.id === map.id);
      if (existing) Object.assign(existing, map); else state.maps.push(map);
    });
    state.characters.push(...characters.map((character) => { delete character.src; return character; }));
    restoreSceneSettings();
  } catch { /* IndexedDB unavailable: the current session still works. */ }
  bindEvents(); bindMapDrop(); renderGallery(); initSpine(); movementLoop();
}

start();
