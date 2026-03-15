const fs = require("fs");
const path = require("path");

const pkgPath = path.join(__dirname, "..", "node_modules", "youtube-transcript", "package.json");

if (!fs.existsSync(pkgPath)) return;

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

if (!pkg.exports) {
  pkg.exports = {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/youtube-transcript.esm.js"
    },
    "./package.json": "./package.json"
  };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  console.log("Patched youtube-transcript with exports field");
}
