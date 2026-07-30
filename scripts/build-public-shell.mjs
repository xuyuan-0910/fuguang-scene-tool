import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const output = "public-deploy";
await mkdir(output, { recursive: true });

let html = await readFile("public/index.html", "utf8");
html = html
  .replace('href="/styles.css"', 'href="./styles.css"')
  .replace('src="/app.js"', 'src="./app.js"')
  .replaceAll('src="/hero-male.png"', 'src="./hero-male.png"')
  .replaceAll('src="/hero-female.png"', 'src="./hero-female.png"');

let js = await readFile("public/app.js", "utf8");
js = js
  .replaceAll("'/hero-male.png'", "'./hero-male.png'")
  .replaceAll("'/hero-female.png'", "'./hero-female.png'")
  .replaceAll("'/player.skel'", "'./player.skel'")
  .replaceAll("'/player.atlas'", "'./player.atlas'");

let css = await readFile("app/globals.css", "utf8");
css = css.replace("url('/8dc458cc-bc1e-4a18-a9da-45372ae547fe.png')", "url('./8dc458cc-bc1e-4a18-a9da-45372ae547fe.png')");

await writeFile(`${output}/index.html`, html);
await writeFile(`${output}/styles.css`, css);
await writeFile(`${output}/app.js`, js);
await writeFile(`${output}/.nojekyll`, "");

for (const file of [
  "hero-male.png",
  "hero-female.png",
  "player.skel",
  "player.atlas",
  "player.png",
  "8dc458cc-bc1e-4a18-a9da-45372ae547fe.png",
]) await cp(`public/${file}`, `${output}/${file}`);

console.log("Public simulator built with visitor-accessible character assets");
