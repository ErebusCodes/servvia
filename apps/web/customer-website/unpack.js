import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const htmlPath = '/home/cyrus/Documents/VerduraDesignTemplete/KitchenDisplay.html';
const outDir = '/home/cyrus/Documents/verdura/frontend/unpacked';

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Helper to extract content of a specific script type
function extractScriptContent(type) {
  const regex = new RegExp(`<script type="${type}">([\\s\\S]*?)<\\/script>`, 'i');
  const match = htmlContent.match(regex);
  if (!match) {
    console.error(`Script type ${type} not found!`);
    return null;
  }
  return match[1].trim();
}

const manifestJSON = extractScriptContent('__bundler/manifest');
const templateJSON = extractScriptContent('__bundler/template');

if (!manifestJSON || !templateJSON) {
  process.exit(1);
}

const manifest = JSON.parse(manifestJSON);
const template = JSON.parse(templateJSON);

console.log('Manifest assets count:', Object.keys(manifest).length);
console.log('Template pages:', Object.keys(template.pages));
console.log('Entry page:', template.entry);

// 1. Unpack assets
const assetMap = {};
for (const [uuid, entry] of Object.entries(manifest)) {
  const buffer = Buffer.from(entry.data, 'base64');
  let decompressed;
  if (entry.compressed) {
    try {
      decompressed = zlib.gunzipSync(buffer);
    } catch (e) {
      console.error(`Failed to decompress ${uuid}:`, e);
      decompressed = buffer;
    }
  } else {
    decompressed = buffer;
  }

  // Save asset
  const ext = entry.mime.split('/')[1] || 'bin';
  const assetName = `${uuid}.${ext}`;
  const assetPath = path.join(outDir, assetName);
  fs.writeFileSync(assetPath, decompressed);
  
  // Create inline data URL or reference for the HTML
  if (entry.mime.startsWith('image/')) {
    assetMap[uuid] = `data:${entry.mime};base64,${decompressed.toString('base64')}`;
  } else {
    assetMap[uuid] = `./${assetName}`;
  }
}

// 2. Unpack pages
for (const [pageId, pageHtml] of Object.entries(template.pages)) {
  let resolvedHtml = pageHtml;
  // Replace UUIDs with our mapped paths or data URIs
  for (const [uuid, dataRef] of Object.entries(assetMap)) {
    resolvedHtml = resolvedHtml.split(uuid).join(dataRef);
  }
  
  // Clean SRI
  resolvedHtml = resolvedHtml.replace(/\s+integrity="[^"]*"/gi, '').replace(/\s+crossorigin="[^"]*"/gi, '');
  
  const pagePath = path.join(outDir, `${pageId}.html`);
  fs.writeFileSync(pagePath, resolvedHtml);
  console.log(`Saved page: ${pageId} to ${pagePath}`);
}

console.log('Unpacking completed successfully!');
