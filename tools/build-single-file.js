const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexPath = path.join(root, "index.html");
const cssPath = path.join(root, "styles.css");
const jsPath = path.join(root, "app.js");
const distDir = path.join(root, "dist");
const outputPath = path.join(distDir, "dashboard.html");

const version = "bumping-dashboard-20260531-a1b1-layout";
const css = fs.readFileSync(cssPath, "utf8");
const js = fs.readFileSync(jsPath, "utf8");
let html = fs.readFileSync(indexPath, "utf8");

html = html.replace(
  /<link rel="stylesheet" href="styles\.css" \/>/,
  `<style>\n${css}\n</style>`
);

html = html.replace(
  /<script src="app\.js\?v=[^"]+"><\/script>/,
  `<script>\n${js}\n</script>`
);

html = html.replace(
  "<!doctype html>",
  `<!doctype html>\n<!-- VERSION: ${version} -->\n<!-- NO CHART.JS REQUIRED -->\n<!-- SINGLE FILE OFFLINE BUILD: copy this file only -->`
);

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(outputPath, html, "utf8");

console.log(`Built ${path.relative(root, outputPath)}`);
