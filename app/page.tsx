"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Asset = { id: string; name: string; src: string; width: number; height: number; kind: "scene" | "character" };
type SizePreset = { label: string; width: number; height: number };

const presets: SizePreset[] = [
  { label: "默认竖屏", width: 720, height: 1280 },
  { label: "iPhone 15", width: 1179, height: 2556 },
  { label: "iPhone SE", width: 750, height: 1334 },
  { label: "安卓高清", width: 1080, height: 2400 },
  { label: "平板竖屏", width: 1536, height: 2048 },
];

const starterCharacters: Asset[] = [
  { id: "male", name: "少侠", src: "/hero-male.png", width: 135, height: 135, kind: "character" },
  { id: "female", name: "小师妹", src: "/hero-female.png", width: 135, height: 135, kind: "character" },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function Home() {
  const [device, setDevice] = useState({ width: 720, height: 1280 });
  const [customWidth, setCustomWidth] = useState(720);
  const [customHeight, setCustomHeight] = useState(1280);
  const [zoom, setZoom] = useState(100);
  const [assets, setAssets] = useState<Asset[]>(starterCharacters);
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [activeCharacter, setActiveCharacter] = useState("male");
  const [characterSize, setCharacterSize] = useState(135);
  const [position, setPosition] = useState({ x: 50, y: 68 });
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const [panel, setPanel] = useState<"assets" | "device">("assets");
  const [playing, setPlaying] = useState(false);
  const joystickRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef({ x: 0, y: 0 });

  const scenes = assets.filter((item) => item.kind === "scene");
  const characters = assets.filter((item) => item.kind === "character");
  const selectedScene = scenes.find((item) => item.id === activeScene);
  const selectedCharacter = characters.find((item) => item.id === activeCharacter) ?? characters[0];

  const frameStyle = useMemo(() => {
    const aspect = device.width / device.height;
    return { aspectRatio: `${device.width} / ${device.height}`, width: aspect > 0.8 ? "min(58vh, 480px)" : "min(43vh, 360px)" };
  }, [device]);

  useEffect(() => {
    let raf = 0;
    const step = () => {
      const movement = moveRef.current;
      if (Math.abs(movement.x) > 0.04 || Math.abs(movement.y) > 0.04) {
        setPosition((prev) => ({
          x: clamp(prev.x + movement.x * 0.42, 4, 96),
          y: clamp(prev.y + movement.y * 0.42, 6, 94),
        }));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleFiles = async (files: FileList | null, kind: Asset["kind"]) => {
    if (!files) return;
    const created = await Promise.all(Array.from(files).map((file) => new Promise<Asset>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve({
          id: `${kind}-${Date.now()}-${file.name}`,
          name: file.name.replace(/\.[^.]+$/, ""),
          src: String(reader.result),
          width: kind === "character" ? 135 : img.naturalWidth,
          height: kind === "character" ? 135 : img.naturalHeight,
          kind,
        });
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    })));
    setAssets((prev) => [...prev, ...created]);
    if (kind === "scene" && created[0]) setActiveScene(created[0].id);
    if (kind === "character" && created[0]) setActiveCharacter(created[0].id);
  };

  const updateStick = useCallback((clientX: number, clientY: number) => {
    const rect = joystickRef.current?.getBoundingClientRect();
    if (!rect) return;
    const radius = rect.width / 2;
    const dx = clientX - (rect.left + radius);
    const dy = clientY - (rect.top + radius);
    const distance = Math.hypot(dx, dy);
    const scale = distance > radius ? radius / distance : 1;
    const next = { x: (dx * scale) / radius, y: (dy * scale) / radius };
    setStick(next);
    moveRef.current = next;
  }, []);

  const stopStick = useCallback(() => {
    setStick({ x: 0, y: 0 });
    moveRef.current = { x: 0, y: 0 };
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">境</span>
          <div><strong>浮光造境</strong><small>角色场景模拟器</small></div>
        </div>
        <div className="top-actions">
          <span className="save-state"><i /> 本机自动保存</span>
          <button className="ghost-button" onClick={() => { setPosition({ x: 50, y: 68 }); setZoom(100); }}>重置场景</button>
          <button className="primary-button" onClick={() => setPlaying((v) => !v)}>{playing ? "退出预览" : "沉浸预览"}</button>
        </div>
      </header>

      <section className={`workspace ${playing ? "is-playing" : ""}`}>
        <aside className="left-panel">
          <div className="panel-tabs">
            <button className={panel === "assets" ? "active" : ""} onClick={() => setPanel("assets")}>素材库</button>
            <button className={panel === "device" ? "active" : ""} onClick={() => setPanel("device")}>画布</button>
          </div>

          {panel === "assets" ? <>
            <div className="panel-heading"><div><small>场景素材</small><h2>地图</h2></div><label className="upload-mini">＋ 上传<input type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files, "scene")} /></label></div>
            <div className="asset-grid">
              <button className={`asset-card empty-scene ${activeScene === null ? "selected" : ""}`} onClick={() => setActiveScene(null)}><span className="scene-pattern"/><b>演示场景</b><small>内置山水</small></button>
              {scenes.map((scene) => <button key={scene.id} className={`asset-card ${activeScene === scene.id ? "selected" : ""}`} onClick={() => setActiveScene(scene.id)}><img src={scene.src} alt=""/><b>{scene.name}</b><small>{scene.width} × {scene.height}</small></button>)}
              <label className="asset-card upload-card"><span>＋</span><b>添加地图</b><small>PNG / JPG / WEBP</small><input type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files, "scene")} /></label>
            </div>

            <div className="panel-heading character-heading"><div><small>角色素材</small><h2>人物</h2></div><label className="upload-mini">＋ 上传<input type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files, "character")} /></label></div>
            <div className="character-list">
              {characters.map((character) => <button key={character.id} className={`character-row ${activeCharacter === character.id ? "selected" : ""}`} onClick={() => setActiveCharacter(character.id)}><span><img src={character.src} alt=""/></span><div><b>{character.name}</b><small>{character.width} × {character.height}</small></div><i>{activeCharacter === character.id ? "✓" : ""}</i></button>)}
            </div>
          </> : <>
            <div className="panel-heading"><div><small>显示设备</small><h2>手机分辨率</h2></div></div>
            <div className="preset-list">{presets.map((preset) => <button key={preset.label} className={device.width === preset.width && device.height === preset.height ? "selected" : ""} onClick={() => { setDevice({ width: preset.width, height: preset.height }); setCustomWidth(preset.width); setCustomHeight(preset.height); }}><span>{preset.label}</span><small>{preset.width} × {preset.height}</small></button>)}</div>
            <div className="custom-size"><label>宽度<input type="number" value={customWidth} onChange={(e) => setCustomWidth(Number(e.target.value))}/></label><span>×</span><label>高度<input type="number" value={customHeight} onChange={(e) => setCustomHeight(Number(e.target.value))}/></label></div>
            <button className="apply-size" onClick={() => setDevice({ width: clamp(customWidth, 240, 4096), height: clamp(customHeight, 320, 4096) })}>应用自定义分辨率</button>
          </>}
        </aside>

        <section className="stage-area">
          <div className="stage-toolbar"><div><button>−</button><span>{device.width} × {device.height}</span><button>＋</button></div><span className="stage-note">拖动摇杆探索场景</span></div>
          <div className="device-frame" style={frameStyle}>
            <div className="notch" />
            <div className="scene" style={{ transform: `scale(${zoom / 100})`, backgroundImage: selectedScene ? `url(${selectedScene.src})` : undefined }}>
              {!selectedScene && <div className="built-in-scene"><div className="sun"/><div className="mountain back"/><div className="mountain front"/><div className="cloud cloud-one"/><div className="cloud cloud-two"/><div className="ground"/><div className="path"/></div>}
              {selectedCharacter && <img className="stage-character" src={selectedCharacter.src} alt={selectedCharacter.name} style={{ width: `${characterSize}px`, height: `${characterSize}px`, left: `${position.x}%`, top: `${position.y}%`, transform: `translate(-50%, -50%) scaleX(${stick.x < -0.08 ? -1 : 1})` }}/>} 
            </div>
            <div className="hud"><span>云隐村</span><b>探索中</b></div>
            <div className="joystick" ref={joystickRef} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); updateStick(e.clientX, e.clientY); }} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) updateStick(e.clientX, e.clientY); }} onPointerUp={stopStick} onPointerCancel={stopStick} aria-label="角色移动摇杆">
              <div className="joystick-ring"/><div className="joystick-knob" style={{ transform: `translate(calc(-50% + ${stick.x * 31}px), calc(-50% + ${stick.y * 31}px))` }}/>
            </div>
          </div>
          <div className="zoom-dock"><span>近</span><input aria-label="场景远近缩放" type="range" min="60" max="180" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}/><span>远</span><b>{zoom}%</b></div>
        </section>

        <aside className="right-panel">
          <div className="inspector-title"><div><small>当前对象</small><h2>角色属性</h2></div><span>实时</span></div>
          <div className="character-preview">{selectedCharacter && <img src={selectedCharacter.src} alt=""/>}<div><b>{selectedCharacter?.name}</b><small>角色图层</small></div></div>
          <div className="control-block"><div className="control-label"><span>角色尺寸</span><b>{characterSize} × {characterSize}</b></div><input type="range" min="48" max="260" value={characterSize} onChange={(e) => setCharacterSize(Number(e.target.value))}/><div className="range-labels"><span>48 px</span><span>260 px</span></div></div>
          <div className="control-block"><div className="control-label"><span>场景缩放</span><b>{zoom}%</b></div><input type="range" min="60" max="180" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}/></div>
          <div className="coordinate-grid"><label>X 坐标<input type="number" value={Math.round(position.x)} onChange={(e) => setPosition((p) => ({ ...p, x: clamp(Number(e.target.value), 0, 100) }))}/></label><label>Y 坐标<input type="number" value={Math.round(position.y)} onChange={(e) => setPosition((p) => ({ ...p, y: clamp(Number(e.target.value), 0, 100) }))}/></label></div>
          <div className="tips"><b>移动提示</b><p>拖动画面左下角摇杆，角色会沿任意方向持续移动。松手即可停止。</p></div>
          <label className="big-upload">上传新角色<input type="file" accept="image/*" onChange={(e) => handleFiles(e.target.files, "character")}/></label>
        </aside>
      </section>
    </main>
  );
}
