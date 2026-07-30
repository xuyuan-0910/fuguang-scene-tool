const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const state = {
  maps: [{ id: "default", name: "云隐山水", builtIn: true, width: 720, height: 1280, zoom: 140, fit: "cover" }],
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

function renderBuildings() {
  const map = currentMap();
  map.buildings ??= [];
  if (!map.buildings.some((building) => building.id === selectedBuildingId)) selectedBuildingId = null;
  $("buildingLayer").innerHTML = map.buildings.map((building) =>
    `<img class="scene-building ${building.id === selectedBuildingId ? "selected" : ""}" data-building-id="${building.id}" src="${assetUrl(building)}" alt="" style="left:${building.x}%;top:${building.y}%;width:${building.size / state.width * 100}%">`
  ).join("");
  $("buildingList").innerHTML = map.buildings.length ? map.buildings.map((building, index) =>
    `<div class="building-preview ${building.id === selectedBuildingId ? "selected" : ""}" data-building-select="${building.id}"><img src="${assetUrl(building)}" alt="建筑 ${index + 1}"><button type="button" data-delete-building="${building.id}" title="删除建筑" aria-label="删除建筑 ${index + 1}">×</button></div>`
  ).join("") : '<p class="building-empty">当前地图还没有建筑</p>';
  const selected = map.buildings.find((building) => building.id === selectedBuildingId);
  $("buildingConfig").hidden = !selected;
  if (selected) $("buildingSize").value = Math.round(selected.size);
}

function selectBuilding(id) {
  selectedBuildingId = id;
  const map = currentMap();
  const selected = map.buildings?.find((building) => building.id === id);
  document.querySelectorAll("[data-building-id]").forEach((node) => node.classList.toggle("selected", node.dataset.buildingId === id));
  document.querySelectorAll("[data-building-select]").forEach((node) => node.classList.toggle("selected", node.dataset.buildingSelect === id));
  $("buildingConfig").hidden = !selected;
  if (selected) $("buildingSize").value = Math.round(selected.size);
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
  map.fit ??= map.builtIn ? "cover" : "contain";
  state.zoom = map.zoom ?? (map.builtIn ? 140 : 100);
  $("sceneBackground").style.backgroundSize = map.fit;
  $("mapFit").value = map.fit;
  $("fitValue").textContent = map.fit === "contain" ? "完整显示" : "填满裁切";
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
  renderBuildings();
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
  map.zoom = clamp(value, 60, 1000);
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

function deleteBuilding(id) {
  const map = currentMap();
  const building = map.buildings?.find((item) => item.id === id);
  if (!building) return;
  if (building.src?.startsWith("blob:")) URL.revokeObjectURL(building.src);
  map.buildings = map.buildings.filter((item) => item.id !== id);
  if (selectedBuildingId === id) selectedBuildingId = null;
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
  $("buildingUpload").onchange = async (event) => {
    const offsets = [[-12, -10], [12, -10], [-12, 8], [12, 8], [0, -18], [0, 16]];
    const offset = offsets[(currentMap().buildings?.length || 0) % offsets.length];
    await addBuildingsAt(event.target.files, clamp(state.x + offset[0], 5, 95), clamp(state.y + offset[1], 10, 95));
    event.target.value = "";
  };
  $("buildingList").onclick = (event) => {
    const remove = event.target.closest("[data-delete-building]");
    if (remove) { deleteBuilding(remove.dataset.deleteBuilding); return; }
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
  $("characterUpload").onchange = (event) => importCharacters(event.target.files);
  $("backHome").onclick = goHome;
  $("resetScene").onclick = () => { state.x = 50; state.y = 68; setSceneZoom(currentMap().fit === "contain" ? 100 : 140); };
  $("zoomRange").oninput = (event) => setSceneZoom(+event.target.value);
  $("zoomOut").onclick = () => setSceneZoom(state.zoom - 10);
  $("zoomIn").onclick = () => setSceneZoom(state.zoom + 10);
  $("mapFit").onchange = (event) => {
    const map = currentMap();
    map.fit = event.target.value;
    if (map.fit === "contain") map.zoom = 100;
    if (!map.builtIn) dbWrite("maps", map);
    renderExplorer();
  };
  $("characterSize").oninput = (event) => { state.size = +event.target.value; renderExplorer(); };
  $("movementSpeed").oninput = (event) => { state.speed = +event.target.value; $("speedValue").textContent = `${state.speed}%`; };
  $("devicePreset").onchange = (event) => { [state.width, state.height] = event.target.value.split("x").map(Number); renderExplorer(); };
  $("posX").onchange = (event) => { state.x = clamp(+event.target.value, 0, 100); renderExplorer(); };
  $("posY").onchange = (event) => { state.y = clamp(+event.target.value, 0, 100); renderExplorer(); };
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
    maps.forEach((map) => {
      delete map.src;
      map.buildings?.forEach((building) => delete building.src);
      const existing = state.maps.find((item) => item.id === map.id);
      if (existing) Object.assign(existing, map); else state.maps.push(map);
    });
    state.characters.push(...characters.map((character) => { delete character.src; return character; }));
  } catch { /* IndexedDB unavailable: the current session still works. */ }
  bindEvents(); bindMapDrop(); renderGallery(); renderExplorer(); initSpine(); movementLoop();
}

start();
