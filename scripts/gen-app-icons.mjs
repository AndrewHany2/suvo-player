#!/usr/bin/env node
// Rasterize the Lumen SVG mark into every platform's PNG icon assets.
// Source of truth: assets/lumen-mark-*.svg (equalizer bars + orb, brand gradient).
// Run: node scripts/gen-app-icons.mjs
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = path.join(ROOT, 'assets', 'lumen-mark-2048.svg'); // highest-res source
const BG = '#0f0f23'; // matches app.json splash + adaptive backgroundColor

const p = (...a) => path.join(ROOT, ...a);

// Render the SVG mark to a transparent PNG buffer at the given pixel size.
const mark = (size) =>
  sharp(SVG, { density: 384 }).resize(size, size, { fit: 'contain', background: '#00000000' }).png().toBuffer();

// Transparent canvas with a centered buffer composited on top.
const centeredOn = (canvas, buf) =>
  sharp({ create: { width: canvas, height: canvas, channels: 4, background: '#00000000' } })
    .composite([{ input: buf, gravity: 'center' }])
    .png();

async function filledIcon(size, outPath) {
  const m = await mark(size);
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: m, gravity: 'center' }])
    .png()
    .toFile(outPath);
  console.log('filled  ', path.relative(ROOT, outPath), `${size}x${size}`);
}

async function transparentMark(size, outPath, scale = 1) {
  const inner = Math.round(size * scale);
  const m = await mark(inner);
  await centeredOn(size, m).toFile(outPath);
  console.log('glyph   ', path.relative(ROOT, outPath), `${size}x${size} @${scale}`);
}

async function solid(size, outPath) {
  await sharp({ create: { width: size, height: size, channels: 3, background: BG } }).png().toFile(outPath);
  console.log('solid   ', path.relative(ROOT, outPath), `${size}x${size}`);
}

async function monochrome(size, outPath, scale = 0.68) {
  const inner = Math.round(size * scale);
  const m = await mark(inner);
  // threshold drops the soft glow, leaving only the solid bars + orb shapes
  const alpha = await sharp(m).extractChannel(3).toColourspace('b-w').threshold(180).toBuffer();
  const white = sharp({ create: { width: inner, height: inner, channels: 3, background: '#ffffff' } });
  const silo = await white.joinChannel(alpha).png().toBuffer(); // white filled by mark alpha
  await centeredOn(size, silo).toFile(outPath);
  console.log('mono    ', path.relative(ROOT, outPath), `${size}x${size}`);
}

// Filled square app icons (OS applies its own rounding/mask) ----------------
await filledIcon(1024, p('assets', 'icon.png'));            // Expo -> iOS/web/favicon
await filledIcon(1024, p('electron', 'assets', 'icon.png')); // Electron desktop
await filledIcon(1024, p('ios', 'IPTVPlayer', 'Images.xcassets', 'AppIcon.appiconset', 'App-Icon-1024x1024@1x.png'));

// TV launcher icons (filled, small) ------------------------------------------
await filledIcon(80, p('tv', 'packaging', 'lg', 'icon.png'));
await filledIcon(130, p('tv', 'packaging', 'lg', 'largeIcon.png'));
await filledIcon(80, p('tv', 'packaging', 'samsung', 'icon.png'));

// Android adaptive icon layers -----------------------------------------------
await transparentMark(1024, p('assets', 'android-icon-foreground.png'), 0.68); // safe zone
await solid(1024, p('assets', 'android-icon-background.png'));
await monochrome(1024, p('assets', 'android-icon-monochrome.png'), 0.68);

// Splash (transparent mark, backgroundColor supplied by app.json) ------------
await transparentMark(2048, p('assets', 'splash-icon.png'), 0.82);

console.log('done');
