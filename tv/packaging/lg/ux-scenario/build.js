// Builds the LG UX Scenario Document deck for Lumen Player.
// Prereqs:  python3 prep-images.py  (fills ./img)  +  npm i pptxgenjs
// Run:      node build.js           (writes ./Lumen_Player_UX_Scenario.pptx)
const path = require("path");
const pptxgen = require("pptxgenjs");
const IMG = path.join(__dirname, "img") + path.sep;

const p = new pptxgen();
p.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
const W = 13.333, H = 7.5;
p.author = "Andrew Hany";
p.company = "Lumen Player";
p.title = "Lumen Player — UX Scenario Document";

// ---- palette ----
const BG    = "0F1320";
const SURF  = "1A2032";
const SURF2 = "252E44";
const INDIGO= "6C5CE7";
const CYAN  = "56C6E6";
const LIGHT = "F5F7FB";
const CARD  = "FFFFFF";
const INK   = "1B2233";
const MUTE  = "6B7688";
const BORD  = "E3E8F1";
const GREEN = "2FA36B";
const AMBER = "B8860B";
const AMBERBG = "FFF7E0";

const HF = "Trebuchet MS";
const BF = "Arial";

const mkShadow = () => ({ type: "outer", color: "0F1320", blur: 8, offset: 3, angle: 135, opacity: 0.18 });
const mkSoft   = () => ({ type: "outer", color: "9AA6BC", blur: 10, offset: 3, angle: 135, opacity: 0.28 });

function pageNo(slide, n) {
  slide.addText(String(n).padStart(2, "0"), { x: W - 1.1, y: H - 0.55, w: 0.7, h: 0.35,
    align: "right", fontFace: BF, fontSize: 10, color: MUTE, margin: 0 });
  slide.addText("Lumen Player · UX Scenario Document", { x: 0.6, y: H - 0.55, w: 6, h: 0.35,
    align: "left", fontFace: BF, fontSize: 9, color: MUTE, margin: 0 });
}

function header(slide, num, title, sub) {
  slide.background = { color: LIGHT };
  if (num !== null) {
    slide.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 0.5, w: 0.82, h: 0.82,
      rectRadius: 0.16, fill: { color: INDIGO }, shadow: mkSoft() });
    slide.addText(String(num), { x: 0.6, y: 0.5, w: 0.82, h: 0.82, align: "center", valign: "middle",
      fontFace: HF, fontSize: 30, bold: true, color: "FFFFFF", margin: 0 });
  }
  const tx = num !== null ? 1.65 : 0.6;
  slide.addText(title, { x: tx, y: 0.5, w: W - tx - 0.6, h: 0.55, align: "left", valign: "middle",
    fontFace: HF, fontSize: 27, bold: true, color: INK, margin: 0 });
  if (sub) slide.addText(sub, { x: tx, y: 1.02, w: W - tx - 0.6, h: 0.35, align: "left", valign: "middle",
    fontFace: BF, fontSize: 13, color: MUTE, margin: 0 });
}

function badge(slide, ix, iy, iw, ih, fx, fy, n, r) {
  r = r || 0.32;
  const cx = ix + fx * iw, cy = iy + fy * ih;
  slide.addShape(p.shapes.OVAL, { x: cx - r / 2, y: cy - r / 2, w: r, h: r,
    fill: { color: CYAN }, line: { color: "FFFFFF", width: 2 }, shadow: mkShadow() });
  slide.addText(String(n), { x: cx - r / 2, y: cy - r / 2, w: r, h: r, align: "center", valign: "middle",
    fontFace: HF, fontSize: r >= 0.34 ? 13 : 12, bold: true, color: BG, margin: 0 });
}

function legend(slide, x, y, w, items, rowH) {
  rowH = rowH || 0.72;
  items.forEach((it, i) => {
    const ry = y + i * rowH;
    slide.addShape(p.shapes.OVAL, { x: x, y: ry + 0.02, w: 0.34, h: 0.34, fill: { color: INDIGO } });
    slide.addText(String(it.n), { x: x, y: ry + 0.02, w: 0.34, h: 0.34, align: "center", valign: "middle",
      fontFace: HF, fontSize: 12, bold: true, color: "FFFFFF", margin: 0 });
    slide.addText([
      { text: it.t + "  ", options: { bold: true, color: INK } },
      { text: it.d, options: { color: MUTE } },
    ], { x: x + 0.5, y: ry - 0.06, w: w - 0.5, h: rowH, align: "left", valign: "top",
      fontFace: BF, fontSize: 12.5, margin: 0, lineSpacingMultiple: 1.02 });
  });
}

function screenFrame(slide, x, y, w, h) {
  slide.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1,
    fill: { color: BG }, line: { color: SURF2, width: 1.5 }, shadow: mkShadow() });
}
function poster(slide, x, y, w, h, focused) {
  slide.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.06,
    fill: { color: focused ? SURF2 : SURF }, line: focused ? { color: CYAN, width: 2 } : { color: "2E3852", width: 0.75 } });
}
function tab(slide, x, y, label, active) {
  slide.addText(label, { x, y, w: 1.05, h: 0.34, align: "center", valign: "middle",
    fontFace: BF, fontSize: 11.5, bold: active, color: active ? "FFFFFF" : "7A879E", margin: 0 });
  if (active) slide.addShape(p.shapes.ROUNDED_RECTANGLE, { x: x + 0.25, y: y + 0.34, w: 0.55, h: 0.05,
    rectRadius: 0.02, fill: { color: INDIGO } });
}
function imgFrame(slide, ix, iy, iw, ih) {
  slide.addShape(p.shapes.ROUNDED_RECTANGLE, { x: ix - 0.07, y: iy - 0.07, w: iw + 0.14, h: ih + 0.14,
    rectRadius: 0.09, fill: { color: BG }, line: { color: SURF2, width: 1 }, shadow: mkShadow() });
}
// real top navigation bar used by the wireframe screens: Lumen · Home/Live/Movies/Series · icons
function topNav(slide, ix, iy, iw, active) {
  slide.addText("Lumen", { x: ix + 0.35, y: iy + 0.26, w: 1.3, h: 0.34, fontFace: HF, fontSize: 14, bold: true, color: INDIGO, margin: 0 });
  const tabs = ["Home", "Live", "Movies", "Series"], tx = ix + 2.05;
  tabs.forEach((t, i) => {
    const x = tx + i * 0.82;
    slide.addText(t, { x, y: iy + 0.3, w: 0.78, h: 0.32, align: "center", valign: "middle", fontFace: BF, fontSize: 11.5, bold: i === active, color: i === active ? "FFFFFF" : "7A879E", margin: 0 });
    if (i === active) slide.addShape(p.shapes.ROUNDED_RECTANGLE, { x: x + 0.19, y: iy + 0.63, w: 0.4, h: 0.045, rectRadius: 0.02, fill: { color: INDIGO } });
  });
  const rx = ix + iw - 1.28;
  slide.addText("(•)", { x: rx, y: iy + 0.3, w: 0.32, h: 0.32, align: "center", valign: "middle", fontFace: BF, fontSize: 11, color: "8894AC", margin: 0 });
  slide.addText("☀", { x: rx + 0.42, y: iy + 0.28, w: 0.32, h: 0.34, align: "center", valign: "middle", fontFace: BF, fontSize: 13, color: "8894AC", margin: 0 });
  slide.addShape(p.shapes.ROUNDED_RECTANGLE, { x: rx + 0.86, y: iy + 0.3, w: 0.32, h: 0.32, rectRadius: 0.06, fill: { color: SURF2 } });
  return rx + 0.86 + 0.16; // x-centre of the account/menu button (for badge placement)
}
function searchBar(slide, x, y, w, label) {
  slide.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.42, rectRadius: 0.08, fill: { color: SURF }, line: { color: "2E3852", width: 0.75 } });
  slide.addText("⌕  " + label, { x: x + 0.2, y, w: w - 0.4, h: 0.42, valign: "middle", fontFace: BF, fontSize: 10.5, color: "7A879E", margin: 0 });
}

// ============================================================ SLIDE 1 — COVER
{
  const s = p.addSlide();
  s.background = { color: BG };
  s.addShape(p.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.14, fill: { color: INDIGO } });
  s.addShape(p.shapes.RECTANGLE, { x: 0, y: 0.14, w: W, h: 0.05, fill: { color: CYAN } });
  s.addImage({ path: IMG + "lumen-logo-tagline.png", x: 1.1, y: 1.55, w: 4.6, h: 1.645, altText: "Lumen Player logo" });
  s.addText("UX Scenario Document", { x: 1.1, y: 3.5, w: 9, h: 0.8, fontFace: HF, fontSize: 40, bold: true, color: "FFFFFF", margin: 0 });
  s.addText("Application walkthrough for LG Content Store QA review", { x: 1.12, y: 4.35, w: 9, h: 0.4, fontFace: BF, fontSize: 15, color: CYAN, margin: 0 });
  const mx = 8.15, mw = 4.0;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: mx, y: 1.55, w: mw, h: 3.05, rectRadius: 0.1, fill: { color: SURF }, line: { color: SURF2, width: 1 }, shadow: mkShadow() });
  const meta = [["App Title", "Lumen Player"], ["App ID", "com.andrew1h1.lumenplayer"], ["App Ver.", "1.0.0"], ["App Developer", "Andrew Hany"], ["Submission Date", "2026-07-08"]];
  meta.forEach((r, i) => {
    const ry = 1.8 + i * 0.56;
    s.addText(r[0].toUpperCase(), { x: mx + 0.3, y: ry, w: mw - 0.6, h: 0.22, fontFace: BF, fontSize: 9, bold: true, color: CYAN, charSpacing: 1, margin: 0 });
    s.addText(r[1], { x: mx + 0.3, y: ry + 0.21, w: mw - 0.6, h: 0.3, fontFace: BF, fontSize: 13.5, bold: true, color: "FFFFFF", margin: 0 });
  });
  s.addText("Based on LG UX Scenario Document File Version 4.4    ·    Platform: webOS (web app type)", { x: 1.1, y: 6.55, w: 11, h: 0.4, fontFace: BF, fontSize: 11, color: "8894AC", margin: 0 });
}

// ============================================================ SLIDE 2 — TOC
{
  const s = p.addSlide();
  header(s, null, "Table of Contents");
  const toc = [
    ["1", "Basic Information", "App identity, category, platform and content policy"],
    ["2", "Flow Chart", "End-to-end navigation from launch to playback"],
    ["3", "Page Description — Guideline", "How the numbered call-outs map to descriptions"],
    ["4", "Detailed Login Information", "Sign-in, register, test accounts and profile selection"],
    ["5", "Main Page Description", "Home (My List & History) and top navigation"],
    ["6", "Sub Page Description", "Browse shelves, A–Z grid, Accounts and the player"],
    ["7", "Paid Content", "In-app purchase / payment methods"],
    ["8", "In-App Ad", "Advertising placements"],
  ];
  const colW = 5.85, x0 = 0.7, y0 = 1.7, rh = 1.28;
  toc.forEach((t, i) => {
    const col = i < 4 ? 0 : 1, row = i % 4;
    const x = x0 + col * (colW + 0.4), y = y0 + row * rh;
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: colW, h: 1.08, rectRadius: 0.08, fill: { color: CARD }, line: { color: BORD, width: 1 }, shadow: mkSoft() });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: x + 0.22, y: y + 0.26, w: 0.56, h: 0.56, rectRadius: 0.1, fill: { color: i >= 6 ? "AEB7C6" : INDIGO } });
    s.addText(t[0], { x: x + 0.22, y: y + 0.26, w: 0.56, h: 0.56, align: "center", valign: "middle", fontFace: HF, fontSize: 22, bold: true, color: "FFFFFF", margin: 0 });
    s.addText(t[1], { x: x + 1.0, y: y + 0.2, w: colW - 1.2, h: 0.4, valign: "middle", fontFace: HF, fontSize: 15.5, bold: true, color: INK, margin: 0 });
    s.addText(t[2] + (i >= 6 ? "  —  Not applicable" : ""), { x: x + 1.0, y: y + 0.58, w: colW - 1.2, h: 0.4, valign: "middle", fontFace: BF, fontSize: 11.5, color: i >= 6 ? GREEN : MUTE, margin: 0 });
  });
  pageNo(s, 2);
}

// ============================================================ SLIDE 3 — BASIC INFO
{
  const s = p.addSlide();
  header(s, 1, "Basic Information", "Application identity and content policy at a glance");
  // left info table
  const rows = [
    ["App Title", "Lumen Player"], ["App ID", "com.andrew1h1.lumenplayer"], ["Version", "1.0.0"],
    ["Developer / Vendor", "Andrew Hany"], ["Category", "Video · Media Player"], ["App Type", "webOS web application (HTML/JS)"],
    ["Permissions", "internet, network.state"], ["Languages", "English (UI)"], ["DRM / Hardware", "None required"],
  ];
  const lx = 0.7, lw = 5.55, lrh = 0.46, ly = 1.55;
  const lh = rows.length * lrh + 0.3;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: lx, y: ly, w: lw, h: lh, rectRadius: 0.08, fill: { color: CARD }, line: { color: BORD, width: 1 }, shadow: mkSoft() });
  rows.forEach((r, i) => {
    const ry = ly + 0.15 + i * lrh;
    if (i > 0) s.addShape(p.shapes.LINE, { x: lx + 0.25, y: ry, w: lw - 0.5, h: 0, line: { color: BORD, width: 0.75 } });
    s.addText(r[0], { x: lx + 0.3, y: ry, w: 2.1, h: lrh, valign: "middle", fontFace: BF, fontSize: 12, bold: true, color: MUTE, margin: 0 });
    s.addText(r[1], { x: lx + 2.4, y: ry, w: lw - 2.7, h: lrh, valign: "middle", fontFace: BF, fontSize: 12, color: INK, margin: 0 });
  });
  // right column: description card
  const rx = 6.85, rw = 5.75;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: rx, y: ly, w: rw, h: 2.15, rectRadius: 0.08, fill: { color: CARD }, line: { color: BORD, width: 1 }, shadow: mkSoft() });
  s.addText("What the app does", { x: rx + 0.3, y: ly + 0.16, w: rw - 0.6, h: 0.35, fontFace: HF, fontSize: 14, bold: true, color: INK, margin: 0 });
  s.addText("Lumen Player is a media player for the playlist the user already owns. The user points it at their own playlist source; the app organises that media into Live, Movies and Series sections, remembers playback position, and keeps favourites and history in sync across the user's devices — with a 10-foot D-pad interface built for the remote. It ships with no content of its own: it hosts, bundles and supplies no channels, streams or media.",
    { x: rx + 0.3, y: ly + 0.54, w: rw - 0.6, h: 1.5, fontFace: BF, fontSize: 11.5, color: INK, margin: 0, lineSpacingMultiple: 1.04, valign: "top" });
  // right column: content policy card
  const cy = ly + 2.35, ch = lh - 2.35;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: rx, y: cy, w: rw, h: ch, rectRadius: 0.08, fill: { color: CARD }, line: { color: BORD, width: 1 }, shadow: mkSoft() });
  s.addText("Content policy", { x: rx + 0.3, y: cy + 0.16, w: rw - 0.6, h: 0.3, fontFace: HF, fontSize: 14, bold: true, color: INK, margin: 0 });
  const pol = [["Login required", "Yes — free account", CYAN], ["Paid content", "None", GREEN], ["In-app purchase", "None", GREEN], ["In-app advertising", "None", GREEN], ["Bundled content", "None", GREEN]];
  pol.forEach((c, i) => {
    const py = cy + 0.58 + i * 0.3;
    s.addShape(p.shapes.OVAL, { x: rx + 0.32, y: py + 0.05, w: 0.15, h: 0.15, fill: { color: c[2] } });
    s.addText(c[0], { x: rx + 0.6, y: py, w: 2.6, h: 0.28, valign: "middle", fontFace: BF, fontSize: 11.5, color: INK, margin: 0 });
    s.addText(c[1], { x: rx + 3.0, y: py, w: rw - 3.2, h: 0.28, valign: "middle", fontFace: BF, fontSize: 11.5, bold: true, color: c[2], margin: 0 });
  });
  // footnote — full width, below both columns (no overlap)
  s.addText("Base content rating is low; user-supplied media is outside the application's control.",
    { x: lx, y: ly + lh + 0.12, w: W - lx - 0.6, h: 0.4, fontFace: BF, fontSize: 11, italic: true, color: MUTE, margin: 0, valign: "middle" });
  pageNo(s, 3);
}

// ============================================================ SLIDE 4 — FLOW CHART
{
  const s = p.addSlide();
  header(s, 2, "Flow Chart", "End-to-end navigation from app launch to playback");
  const steps = [
    ["Launch", "App starts,\nsession restored"], ["Sign In /\nRegister", "Account for\ncross-device sync"],
    ["Who's\nWatching?", "Select or add\na profile"], ["Home", "Home · Live ·\nMovies · Series"],
    ["Browse", "Shelves &\nA–Z grid"], ["Video\nPlayer", "Full-screen\nplayback"],
  ];
  const bw = 1.78, bh = 1.5, gap = 0.32, y = 2.35;
  const totalW = steps.length * bw + (steps.length - 1) * gap;
  let x = (W - totalW) / 2;
  steps.forEach((st, i) => {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: bw, h: bh, rectRadius: 0.1, fill: { color: i === 3 ? INDIGO : CARD }, line: { color: i === 3 ? INDIGO : BORD, width: 1 }, shadow: mkSoft() });
    s.addShape(p.shapes.OVAL, { x: x + bw / 2 - 0.19, y: y - 0.19, w: 0.38, h: 0.38, fill: { color: CYAN }, line: { color: "FFFFFF", width: 1.5 } });
    s.addText(String(i + 1), { x: x + bw / 2 - 0.19, y: y - 0.19, w: 0.38, h: 0.38, align: "center", valign: "middle", fontFace: HF, fontSize: 13, bold: true, color: BG, margin: 0 });
    s.addText(st[0], { x: x + 0.1, y: y + 0.28, w: bw - 0.2, h: 0.62, align: "center", valign: "middle", fontFace: HF, fontSize: 14.5, bold: true, color: i === 3 ? "FFFFFF" : INK, margin: 0 });
    s.addText(st[1], { x: x + 0.1, y: y + 0.9, w: bw - 0.2, h: 0.52, align: "center", valign: "top", fontFace: BF, fontSize: 10, color: i === 3 ? "E6E2FF" : MUTE, margin: 0 });
    if (i < steps.length - 1) s.addText("›", { x: x + bw + 0.02, y: y, w: gap, h: bh, align: "center", valign: "middle", fontFace: HF, fontSize: 30, bold: true, color: INDIGO, margin: 0 });
    x += bw + gap;
  });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: (W - bw) / 2, y: 4.5, w: bw + 1.2, h: 0.95, rectRadius: 0.1, fill: { color: "FFFFFF" }, line: { color: CYAN, width: 1.5, dashType: "dash" }, shadow: mkSoft() });
  s.addText([
    { text: "Accounts / Settings", options: { bold: true, color: INK, breakLine: true, fontSize: 13 } },
    { text: "Reachable from any Main Page tab (gear icon) — add or switch playlist, manage profiles.", options: { color: MUTE, fontSize: 10 } },
  ], { x: (W - bw) / 2 + 0.2, y: 4.62, w: bw + 0.8, h: 0.75, valign: "middle", fontFace: BF, margin: 0, lineSpacingMultiple: 1.02 });
  s.addText("↑ modal overlay", { x: (W - bw) / 2 - 1.7, y: 4.75, w: 1.6, h: 0.4, align: "right", valign: "middle", fontFace: BF, fontSize: 10, italic: true, color: MUTE, margin: 0 });
  s.addText("Steps 5–6 are described generically because they display only the media the user has supplied; the application provides none of its own.",
    { x: 0.7, y: 6.4, w: 11.9, h: 0.5, fontFace: BF, fontSize: 11, italic: true, color: MUTE, margin: 0 });
  pageNo(s, 4);
}

// ============================================================ SLIDE 5 — GUIDELINE
{
  const s = p.addSlide();
  header(s, 3, "Page Description — Guideline", "How to read the page walk-throughs that follow");
  const ix = 0.9, iy = 2.0, iw = 4.6, ih = 3.9;
  screenFrame(s, ix, iy, iw, ih);
  s.addText("Lumen Player", { x: ix + 0.3, y: iy + 0.25, w: 2, h: 0.3, fontFace: HF, fontSize: 12, bold: true, color: "FFFFFF", margin: 0 });
  s.addShape(p.shapes.OVAL, { x: ix + iw - 0.6, y: iy + 0.25, w: 0.3, h: 0.3, fill: { color: SURF2 } });
  poster(s, ix + 0.3, iy + 0.85, iw - 0.6, 1.1, false);
  poster(s, ix + 0.3, iy + 2.15, 1.15, 1.45, true);
  poster(s, ix + 1.6, iy + 2.15, 1.15, 1.45, false);
  poster(s, ix + 2.9, iy + 2.15, 1.15, 1.45, false);
  badge(s, ix, iy, iw, ih, 0.46, 0.135, 1);   // right of the brand title
  badge(s, ix, iy, iw, ih, 0.9, 0.14, 2);      // top-right control
  badge(s, ix, iy, iw, ih, 0.5, 0.36, 3);      // featured banner
  badge(s, ix, iy, iw, ih, 0.22, 0.72, 4);     // focused tile
  s.addText("Each page shows one real screen (or a wireframe of it). Numbered markers on the screen correspond to the numbered list beside it:",
    { x: 6.0, y: 2.0, w: 6.4, h: 0.9, fontFace: BF, fontSize: 13, color: INK, margin: 0, lineSpacingMultiple: 1.05, valign: "top" });
  legend(s, 6.0, 3.0, 6.5, [
    { n: 1, t: "App title / brand", d: "identifies the current screen." },
    { n: 2, t: "Profile & settings", d: "switch profile, open Accounts/Settings." },
    { n: 3, t: "Focused / featured item", d: "the element the D-pad highlight is on." },
    { n: 4, t: "Selectable content tile", d: "OK opens detail or starts playback." },
  ], 0.72);
  s.addText([
    { text: "Note on screenshots:  ", options: { bold: true, color: INK } },
    { text: "content areas show sample/placeholder media only — no broadcaster logos, channel names or programme guides — because all media is user-supplied.", options: { color: MUTE } },
  ], { x: 6.0, y: 5.95, w: 6.5, h: 0.9, fontFace: BF, fontSize: 11.5, italic: true, margin: 0, lineSpacingMultiple: 1.03, valign: "top" });
  pageNo(s, 5);
}

// ============================================================ SLIDE 6 — LOGIN
{
  const s = p.addSlide();
  header(s, 4, "Detailed Login Information", "Start page — Sign in to an existing account");
  const iw = 4.4, ih = iw * (735 / 717), ix = 0.9, iy = 2.0;
  imgFrame(s, ix, iy, iw, ih);
  s.addImage({ path: IMG + "02-login-crop.png", x: ix, y: iy, w: iw, h: ih, altText: "Sign in screen" });
  badge(s, ix, iy, iw, ih, 0.10, 0.486, 1);
  badge(s, ix, iy, iw, ih, 0.10, 0.623, 2);
  badge(s, ix, iy, iw, ih, 0.79, 0.623, 3);
  badge(s, ix, iy, iw, ih, 0.10, 0.748, 4);
  badge(s, ix, iy, iw, ih, 0.10, 0.857, 5);   // Register link — left edge, off the word
  legend(s, 6.0, 2.05, 6.4, [
    { n: 1, t: "Email", d: "input field for the account email address." },
    { n: 2, t: "Password", d: "input field for the account password." },
    { n: 3, t: "Show / hide", d: "toggles password visibility." },
    { n: 4, t: "Sign In", d: "authenticates and continues to profile selection." },
    { n: 5, t: "Register", d: "switches to the create-account screen." },
  ], 0.7);
  s.addText("The account is a free Lumen Player account used only to sync favourites, history and profiles across the user's devices. It is not a content subscription.",
    { x: 6.0, y: 5.75, w: 6.4, h: 0.9, fontFace: BF, fontSize: 11.5, italic: true, color: MUTE, margin: 0, lineSpacingMultiple: 1.04, valign: "top" });
  pageNo(s, 6);
}

// ============================================================ SLIDE 7 — REGISTER
{
  const s = p.addSlide();
  header(s, 4, "Detailed Login Information", "Start page — Create a new account (Register)");
  const ih = 4.7, iw = ih * (714 / 891), ix = 0.9, iy = 1.95;
  imgFrame(s, ix, iy, iw, ih);
  s.addImage({ path: IMG + "01-register-crop.png", x: ix, y: iy, w: iw, h: ih, altText: "Create account screen" });
  badge(s, ix, iy, iw, ih, 0.10, 0.379, 1);
  badge(s, ix, iy, iw, ih, 0.10, 0.493, 2);
  badge(s, ix, iy, iw, ih, 0.10, 0.606, 3);
  badge(s, ix, iy, iw, ih, 0.10, 0.719, 4);
  badge(s, ix, iy, iw, ih, 0.10, 0.823, 5);
  badge(s, ix, iy, iw, ih, 0.10, 0.912, 6);   // Sign In link — left edge, off the word
  legend(s, 5.4, 2.0, 7.1, [
    { n: 1, t: "Username", d: "display name for the account." },
    { n: 2, t: "Email", d: "account email address." },
    { n: 3, t: "Password", d: "account password (each field has a show/hide toggle)." },
    { n: 4, t: "Confirm Password", d: "re-enter to confirm." },
    { n: 5, t: "Create Account", d: "creates the account and continues." },
    { n: 6, t: "Sign In", d: "returns to the sign-in screen." },
  ], 0.66);
  pageNo(s, 7);
}

// ============================================================ SLIDE 8 — TEST ACCOUNTS
{
  const s = p.addSlide();
  header(s, 4, "Test Accounts for QA", "Mandatory — credentials the review team can use to test the app");
  // account card
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 1.75, w: 5.9, h: 2.35, rectRadius: 0.08, fill: { color: CARD }, line: { color: BORD, width: 1 }, shadow: mkSoft() });
  s.addText("Test Account  (ID / PW)", { x: 0.95, y: 1.9, w: 5.4, h: 0.35, fontFace: HF, fontSize: 14, bold: true, color: INK, margin: 0 });
  const fill = [["Email / ID", "enter test account email"], ["Password", "enter test account password"]];
  fill.forEach((r, i) => {
    const ry = 2.38 + i * 0.62;
    s.addText(r[0], { x: 0.95, y: ry, w: 1.6, h: 0.48, valign: "middle", fontFace: BF, fontSize: 12, bold: true, color: MUTE, margin: 0 });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 2.55, y: ry, w: 3.85, h: 0.48, rectRadius: 0.05, fill: { color: AMBERBG }, line: { color: "E7C15A", width: 1, dashType: "dash" } });
    s.addText("‹ " + r[1] + " ›", { x: 2.65, y: ry, w: 3.7, h: 0.48, valign: "middle", fontFace: BF, fontSize: 11, italic: true, color: AMBER, margin: 0 });
  });
  s.addText("One profile is pre-created; more can be added on the profile screen.", { x: 0.95, y: 3.66, w: 5.5, h: 0.35, valign: "middle", fontFace: BF, fontSize: 10.5, italic: true, color: MUTE, margin: 0 });
  // playlist card
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 6.75, y: 1.75, w: 5.85, h: 2.35, rectRadius: 0.08, fill: { color: CARD }, line: { color: BORD, width: 1 }, shadow: mkSoft() });
  s.addText("Sample Playlist  (to load media)", { x: 7.0, y: 1.9, w: 5.4, h: 0.35, fontFace: HF, fontSize: 14, bold: true, color: INK, margin: 0 });
  s.addText([
    { text: "In ", options: {} }, { text: "Settings › Accounts", options: { bold: true } },
    { text: " the reviewer adds a playlist source. Use the sample source below to load sample media for testing:", options: {} },
  ], { x: 7.0, y: 2.34, w: 5.4, h: 0.62, fontFace: BF, fontSize: 11, color: INK, margin: 0, lineSpacingMultiple: 1.02, valign: "top" });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 7.0, y: 3.02, w: 5.4, h: 0.92, rectRadius: 0.05, fill: { color: AMBERBG }, line: { color: "E7C15A", width: 1, dashType: "dash" } });
  s.addText("‹ enter sample M3U or Xtream URL + login ›", { x: 7.15, y: 3.02, w: 5.1, h: 0.92, valign: "middle", fontFace: BF, fontSize: 11.5, italic: true, color: AMBER, margin: 0 });
  // warning banner
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 4.28, w: 11.9, h: 0.55, rectRadius: 0.06, fill: { color: AMBERBG }, line: { color: "E7C15A", width: 1 } });
  s.addText([
    { text: "⚠  Before uploading to Seller Lounge:  ", options: { bold: true, color: AMBER } },
    { text: "replace the highlighted fields above with a real test account and a sample playlist URL. QA cannot review playback without them.", options: { color: "8A6A0A" } },
  ], { x: 0.95, y: 4.28, w: 11.4, h: 0.55, valign: "middle", fontFace: BF, fontSize: 11.5, margin: 0 });
  // notes strip
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 5.0, w: 11.9, h: 1.6, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: CYAN, width: 1.25 }, shadow: mkSoft() });
  s.addShape(p.shapes.RECTANGLE, { x: 0.7, y: 5.18, w: 0.08, h: 1.24, fill: { color: CYAN } });
  s.addText("Reviewer notes (LG QA)", { x: 1.0, y: 5.12, w: 11.2, h: 0.32, fontFace: HF, fontSize: 13, bold: true, color: INK, margin: 0 });
  s.addText([
    { text: "•  Either the test account (ID/PW) or an access/activation flow is required to test the app; the account above is provided.", options: { breakLine: true } },
    { text: "•  A single account may be signed in on multiple devices at once — no per-device limit — so one test account is sufficient for QA.", options: { breakLine: true } },
    { text: "•  Lumen Player ships with no media. To exercise playback, add the sample playlist under Settings › Accounts.", options: { breakLine: true } },
    { text: "•  The application hosts and supplies no content; all media shown during testing originates from the sample playlist the reviewer loads.", options: {} },
  ], { x: 1.0, y: 5.46, w: 11.4, h: 1.05, fontFace: BF, fontSize: 11, color: INK, margin: 0, lineSpacingMultiple: 1.1, valign: "top" });
  pageNo(s, 8);
}

// ============================================================ SLIDE 9 — PROFILES
{
  const s = p.addSlide();
  header(s, 4, "Profile Selection", "“Who’s watching?” — choose or add a profile after sign-in");
  const ih = 4.85, iw = ih * (1023 / 962), ix = 0.8, iy = 1.95;
  imgFrame(s, ix, iy, iw, ih);
  s.addImage({ path: IMG + "03-profiles-crop.png", x: ix, y: iy, w: iw, h: ih, altText: "Profile selection screen" });
  badge(s, ix, iy, iw, ih, 0.27, 0.165, 1, 0.34);
  badge(s, ix, iy, iw, ih, 0.62, 0.165, 2, 0.34);
  badge(s, ix, iy, iw, ih, 0.395, 0.85, 3, 0.34);   // above "Manage Profiles"
  badge(s, ix, iy, iw, ih, 0.645, 0.85, 4, 0.34);   // above "Sign Out"
  const lx = ix + iw + 0.5;
  legend(s, lx, 2.4, W - lx - 0.6, [
    { n: 1, t: "Profile tile", d: "select a profile to enter the app." },
    { n: 2, t: "Add Profile", d: "create a new viewing profile." },
    { n: 3, t: "Manage Profiles", d: "rename / remove profiles." },
    { n: 4, t: "Sign Out", d: "returns to the sign-in screen." },
  ], 0.72);
  s.addText("Profiles keep each viewer's favourites, history and resume points separate. They are local personalisation only — not separate accounts or logins.",
    { x: lx, y: 5.5, w: W - lx - 0.6, h: 1.0, fontFace: BF, fontSize: 11.5, italic: true, color: MUTE, margin: 0, lineSpacingMultiple: 1.04, valign: "top" });
  pageNo(s, 9);
}

// ============================================================ SLIDE 10 — MAIN PAGE
{
  const s = p.addSlide();
  header(s, 5, "Main Page Description", "Home — My List & History (favourites and resume)");
  const ix = 0.7, iy = 2.0, iw = 7.1, ih = 4.4;
  screenFrame(s, ix, iy, iw, ih);
  const acct = topNav(s, ix, iy, iw, 0); // Home active
  s.addText("My List & History", { x: ix + 0.35, y: iy + 0.9, w: 5, h: 0.36, fontFace: HF, fontSize: 15, bold: true, color: "FFFFFF", margin: 0 });
  s.addText("Favourites", { x: ix + 0.35, y: iy + 1.4, w: 3, h: 0.26, fontFace: BF, fontSize: 11, bold: true, color: "C8D2E6", margin: 0 });
  for (let i = 0; i < 4; i++) poster(s, ix + 0.35 + i * 1.32, iy + 1.72, 1.15, 1.15, i === 0);
  s.addText("Watch History", { x: ix + 0.35, y: iy + 3.05, w: 3, h: 0.26, fontFace: BF, fontSize: 11, bold: true, color: "C8D2E6", margin: 0 });
  for (let i = 0; i < 4; i++) {
    const px = ix + 0.35 + i * 1.32;
    poster(s, px, iy + 3.35, 1.15, 0.82, i === 0);
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: px + 0.1, y: iy + 4.05, w: 0.95, h: 0.06, rectRadius: 0.03, fill: { color: "3A455F" } });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: px + 0.1, y: iy + 4.05, w: (i === 0 ? 0.6 : 0.32), h: 0.06, rectRadius: 0.03, fill: { color: INDIGO } });
  }
  badge(s, ix, iy, iw, ih, 0.27, 0.12, 1);           // left of tab group
  badge(s, ix, iy, iw, ih, (acct - ix) / iw, 0.145, 2); // account / menu icon
  badge(s, ix, iy, iw, ih, 0.13, 0.52, 3);           // favourites tile
  badge(s, ix, iy, iw, ih, 0.13, 0.86, 4);           // watch-history tile (progress)
  legend(s, 8.1, 2.1, W - 8.1 - 0.6, [
    { n: 1, t: "Top navigation", d: "Home, Live, Movies, Series — D-pad left/right." },
    { n: 2, t: "Account / menu", d: "opens Accounts (playlist, profiles, settings)." },
    { n: 3, t: "Favourites", d: "items the viewer saved; OK opens / plays." },
    { n: 4, t: "Watch History", d: "recently played, with a resume progress bar." },
  ], 0.72);
  s.addText("Wireframe — tiles are placeholders; the live app shows only the artwork of media in the user's own playlist.",
    { x: 8.1, y: 5.5, w: W - 8.1 - 0.6, h: 0.9, fontFace: BF, fontSize: 10.5, italic: true, color: MUTE, margin: 0, lineSpacingMultiple: 1.03, valign: "top" });
  pageNo(s, 10);
}

// ============================================================ SLIDE 11 — SUB PAGE
{
  const s = p.addSlide();
  header(s, 6, "Sub Page Description", "Browse — Movies & Series shelves");
  const ix = 0.7, iy = 2.0, iw = 7.1, ih = 4.4;
  screenFrame(s, ix, iy, iw, ih);
  topNav(s, ix, iy, iw, 2); // Movies active
  s.addText("Movies", { x: ix + 0.35, y: iy + 0.9, w: 3, h: 0.36, fontFace: HF, fontSize: 15, bold: true, color: "FFFFFF", margin: 0 });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: ix + 0.35, y: iy + 1.4, w: 1.7, h: 0.4, rectRadius: 0.2, fill: { color: SURF2 }, line: { color: CYAN, width: 1 } });
  s.addText("▦  All Movies  ›", { x: ix + 0.35, y: iy + 1.4, w: 1.7, h: 0.4, align: "center", valign: "middle", fontFace: BF, fontSize: 10.5, bold: true, color: CYAN, margin: 0 });
  s.addText("Movies · 527", { x: ix + 0.35, y: iy + 2.0, w: 3, h: 0.26, fontFace: BF, fontSize: 10.5, bold: true, color: "C8D2E6", margin: 0 });
  for (let i = 0; i < 5; i++) poster(s, ix + 0.35 + i * 1.32, iy + 2.32, 1.15, 1.0, i === 0);
  s.addText("Movies · Series · 80", { x: ix + 0.35, y: iy + 3.45, w: 3.5, h: 0.26, fontFace: BF, fontSize: 10.5, bold: true, color: "C8D2E6", margin: 0 });
  for (let i = 0; i < 5; i++) poster(s, ix + 0.35 + i * 1.32, iy + 3.75, 1.15, 0.5, false);
  badge(s, ix, iy, iw, ih, 0.27, 0.12, 1);      // Movies tab
  badge(s, ix, iy, iw, ih, 0.325, 0.365, 2);    // right of "All Movies" pill
  badge(s, ix, iy, iw, ih, 0.13, 0.64, 3);      // focused shelf poster
  badge(s, ix, iy, iw, ih, 0.13, 0.915, 4);     // second shelf
  legend(s, 8.1, 2.1, W - 8.1 - 0.6, [
    { n: 1, t: "Section tab", d: "Movies (Series is identical)." },
    { n: 2, t: "All Movies", d: "opens the full A–Z grid (next page)." },
    { n: 3, t: "Poster (focused)", d: "OK opens the detail view, then playback." },
    { n: 4, t: "More shelves", d: "rows grouped by the playlist's own categories." },
  ], 0.72);
  s.addText([
    { text: "Live ", options: { bold: true, color: INK } },
    { text: "uses the same browsable layout as a grid of content categories (General, Music, Sports, News …).", options: { color: MUTE } },
  ], { x: 8.1, y: 5.35, w: W - 8.1 - 0.6, h: 1.0, fontFace: BF, fontSize: 11, margin: 0, lineSpacingMultiple: 1.05, valign: "top" });
  pageNo(s, 11);
}

// ============================================================ SLIDE 12 — ALL A–Z GRID
{
  const s = p.addSlide();
  header(s, 6, "Sub Page Description — All Movies / Series", "Full A–Z catalogue with search");
  const ix = 0.7, iy = 2.0, iw = 7.1, ih = 4.4;
  screenFrame(s, ix, iy, iw, ih);
  topNav(s, ix, iy, iw, 2);
  s.addText("‹", { x: ix + 0.35, y: iy + 0.87, w: 0.3, h: 0.4, valign: "middle", fontFace: HF, fontSize: 18, bold: true, color: "FFFFFF", margin: 0 });
  s.addText("All Movies", { x: ix + 0.74, y: iy + 0.9, w: 3.5, h: 0.34, valign: "middle", fontFace: HF, fontSize: 14, bold: true, color: "FFFFFF", margin: 0 });
  s.addText("651", { x: ix + iw - 1.2, y: iy + 0.9, w: 0.85, h: 0.34, align: "right", valign: "middle", fontFace: BF, fontSize: 11, color: "7A879E", margin: 0 });
  searchBar(s, ix + 0.35, iy + 1.35, iw - 0.7, "Search movies…");
  const az = "ALL A B C D E F G H I J K L M N O P Q R S T U V W X Y Z".split(" ");
  s.addText(az.map((c, i) => ({ text: c + (i < az.length - 1 ? "   " : ""), options: { color: c === "ALL" ? CYAN : "7A879E", bold: c === "ALL" } })),
    { x: ix + 0.35, y: iy + 1.92, w: iw - 0.7, h: 0.3, fontFace: BF, fontSize: 10, margin: 0, valign: "middle" });
  for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) poster(s, ix + 0.35 + c * 1.32, iy + 2.35 + r * 1.02, 1.15, 0.88, r === 0 && c === 0);
  badge(s, ix, iy, iw, ih, 0.06, 0.243, 1);   // back
  badge(s, ix, iy, iw, ih, 0.9, 0.354, 2);     // search bar (right end)
  badge(s, ix, iy, iw, ih, 0.9, 0.47, 3);      // A–Z row (right end)
  badge(s, ix, iy, iw, ih, 0.13, 0.634, 4);    // focused tile
  legend(s, 8.1, 2.1, W - 8.1 - 0.6, [
    { n: 1, t: "Back", d: "returns to the Movies / Series shelves." },
    { n: 2, t: "Search", d: "type-to-filter the catalogue by title." },
    { n: 3, t: "A–Z filter", d: "jump to titles starting with a letter." },
    { n: 4, t: "Poster (focused)", d: "OK opens the detail view, then playback." },
  ], 0.72);
  s.addText("Series uses the identical layout (Search series…, count, A–Z). Titles under the tiles come only from the user's playlist.",
    { x: 8.1, y: 5.5, w: W - 8.1 - 0.6, h: 0.9, fontFace: BF, fontSize: 10.5, italic: true, color: MUTE, margin: 0, lineSpacingMultiple: 1.03, valign: "top" });
  pageNo(s, 12);
}

// ============================================================ SLIDE 13 — ACCOUNTS
{
  const s = p.addSlide();
  header(s, 6, "Sub Page Description — Accounts", "How the reviewer adds a playlist (Settings › Accounts)");
  const ix = 0.7, iy = 2.0, iw = 7.1, ih = 4.4;
  screenFrame(s, ix, iy, iw, ih);
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: ix + 1.05, y: iy + 0.4, w: iw - 2.1, h: ih - 0.8, rectRadius: 0.1, fill: { color: SURF }, line: { color: SURF2, width: 1 } });
  const mx = ix + 1.35, mw = iw - 2.7;
  s.addText("Accounts", { x: mx, y: iy + 0.62, w: mw, h: 0.34, fontFace: HF, fontSize: 14, bold: true, color: "FFFFFF", margin: 0 });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: mx, y: iy + 1.08, w: mw, h: 0.5, rectRadius: 0.08, fill: { color: SURF2 }, line: { color: CYAN, width: 1 } });
  s.addText("+  Add account", { x: mx, y: iy + 1.08, w: mw, h: 0.5, align: "center", valign: "middle", fontFace: BF, fontSize: 11.5, bold: true, color: CYAN, margin: 0 });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: mx, y: iy + 1.74, w: mw, h: 0.86, rectRadius: 0.08, fill: { color: SURF2 } });
  s.addText([
    { text: "Sample Playlist", options: { bold: true, color: "FFFFFF", fontSize: 11.5, breakLine: true } },
    { text: "‹ your M3U / Xtream URL ›", options: { color: "8894AC", fontSize: 9.5, italic: true, breakLine: true } },
    { text: "✓ Active", options: { color: CYAN, fontSize: 9.5 } },
  ], { x: mx + 0.22, y: iy + 1.84, w: mw - 2.0, h: 0.68, fontFace: BF, margin: 0, lineSpacingMultiple: 1.05, valign: "top" });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: mx + mw - 1.72, y: iy + 2.03, w: 0.76, h: 0.34, rectRadius: 0.05, fill: { color: "313A52" } });
  s.addText("Edit", { x: mx + mw - 1.72, y: iy + 2.03, w: 0.76, h: 0.34, align: "center", valign: "middle", fontFace: BF, fontSize: 9.5, color: "C8D2E6", margin: 0 });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: mx + mw - 0.9, y: iy + 2.03, w: 0.8, h: 0.34, rectRadius: 0.05, fill: { color: SURF }, line: { color: "8A3A3A", width: 1 } });
  s.addText("Delete", { x: mx + mw - 0.9, y: iy + 2.03, w: 0.8, h: 0.34, align: "center", valign: "middle", fontFace: BF, fontSize: 9.5, color: "E08585", margin: 0 });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: mx, y: iy + 2.76, w: mw, h: 0.6, rectRadius: 0.08, fill: { color: SURF2 } });
  s.addText([
    { text: "TV Layout", options: { bold: true, color: "FFFFFF", fontSize: 11, breakLine: true } },
    { text: "How Movies & Series browse", options: { color: "8894AC", fontSize: 9 } },
  ], { x: mx + 0.22, y: iy + 2.82, w: mw - 1.6, h: 0.5, fontFace: BF, margin: 0, valign: "middle" });
  s.addText("▤ Shelves", { x: mx + mw - 1.5, y: iy + 2.82, w: 1.3, h: 0.5, align: "right", valign: "middle", fontFace: BF, fontSize: 10, color: CYAN, margin: 0 });
  badge(s, ix, iy, iw, ih, 0.20, 0.31, 1);    // Add account (left of centred label)
  badge(s, ix, iy, iw, ih, 0.165, 0.48, 2);   // playlist entry — left of text
  badge(s, ix, iy, iw, ih, 0.55, 0.505, 3);   // between URL and Edit/Delete buttons
  badge(s, ix, iy, iw, ih, 0.165, 0.70, 4);   // TV Layout — left of text
  legend(s, 8.1, 2.1, W - 8.1 - 0.6, [
    { n: 1, t: "Add account", d: "paste an M3U or Xtream playlist URL." },
    { n: 2, t: "Playlist entry", d: "the active source; “✓ Active” is in use now." },
    { n: 3, t: "Edit / Delete", d: "update or remove a saved playlist." },
    { n: 4, t: "TV Layout", d: "toggle how Movies & Series browse (shelves / grid)." },
  ], 0.72);
  s.addText("Reviewers enter the sample playlist from the Test Accounts page here. Lumen Player stores and supplies no playlists of its own.",
    { x: 8.1, y: 5.5, w: W - 8.1 - 0.6, h: 0.9, fontFace: BF, fontSize: 10.5, italic: true, color: MUTE, margin: 0, lineSpacingMultiple: 1.03, valign: "top" });
  pageNo(s, 13);
}

// ============================================================ SLIDE 14 — VIDEO PLAYER
{
  const s = p.addSlide();
  header(s, 6, "Sub Page Description — Video Player", "Full-screen playback and on-screen controls");
  const ix = 0.7, iy = 2.0, iw = 7.1, ih = 4.4;
  screenFrame(s, ix, iy, iw, ih);
  s.addShape(p.shapes.OVAL, { x: ix + iw / 2 - 0.55, y: iy + ih / 2 - 0.75, w: 1.1, h: 1.1, fill: { color: INDIGO }, line: { color: "FFFFFF", width: 2 } });
  s.addText("▶", { x: ix + iw / 2 - 0.5, y: iy + ih / 2 - 0.75, w: 1.0, h: 1.1, align: "center", valign: "middle", fontFace: HF, fontSize: 26, color: "FFFFFF", margin: 0 });
  s.addText("Now playing", { x: ix + 0.35, y: iy + 0.3, w: 4, h: 0.28, fontFace: BF, fontSize: 10, color: CYAN, margin: 0 });
  s.addText("Sample media title", { x: ix + 0.35, y: iy + 0.55, w: 4.5, h: 0.35, fontFace: HF, fontSize: 15, bold: true, color: "FFFFFF", margin: 0 });
  const barY = iy + ih - 0.95;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: ix + 0.35, y: barY + 0.2, w: iw - 3.3, h: 0.12, rectRadius: 0.06, fill: { color: "3A455F" } });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: ix + 0.35, y: barY + 0.2, w: 2.4, h: 0.12, rectRadius: 0.06, fill: { color: INDIGO } });
  s.addShape(p.shapes.OVAL, { x: ix + 0.35 + 2.4 - 0.09, y: barY + 0.14, w: 0.24, h: 0.24, fill: { color: "FFFFFF" } });
  s.addText("12:34", { x: ix + iw - 2.8, y: barY + 0.12, w: 1, h: 0.3, valign: "middle", fontFace: BF, fontSize: 10, color: "C8D2E6", margin: 0 });
  ["⏮", "⏯", "⏭"].forEach((g, i) => {
    s.addShape(p.shapes.OVAL, { x: ix + 0.7 + i * 0.9, y: barY - 0.55, w: 0.55, h: 0.55, fill: { color: i === 1 ? INDIGO : SURF2 } });
    s.addText(g, { x: ix + 0.7 + i * 0.9, y: barY - 0.55, w: 0.55, h: 0.55, align: "center", valign: "middle", fontFace: BF, fontSize: 13, color: "FFFFFF", margin: 0 });
  });
  badge(s, ix, iy, iw, ih, 0.264, 0.72, 1);    // transport controls
  badge(s, ix, iy, iw, ih, 0.317, 0.845, 2);   // progress bar
  badge(s, ix, iy, iw, ih, 0.40, 0.16, 3);     // right of title text
  badge(s, ix, iy, iw, ih, 0.72, 0.33, 4);     // open playback surface
  legend(s, 8.1, 2.15, W - 8.1 - 0.6, [
    { n: 1, t: "Play / Pause & seek", d: "transport controls; OK toggles play/pause." },
    { n: 2, t: "Progress bar", d: "shows position; left/right seek." },
    { n: 3, t: "Title & metadata", d: "current item; Back returns to the grid." },
    { n: 4, t: "Playback surface", d: "auto-recovers from network hiccups." },
  ], 0.72);
  s.addText("Controls auto-hide during playback and reappear on any remote key. The player recovers automatically from transient network drops.",
    { x: 8.1, y: 5.35, w: W - 8.1 - 0.6, h: 1.0, fontFace: BF, fontSize: 11, italic: true, color: MUTE, margin: 0, lineSpacingMultiple: 1.04, valign: "top" });
  pageNo(s, 14);
}

// ============================================================ SLIDE 15 — PAID CONTENT
function naSlide(num, title, sub, body, page) {
  const s = p.addSlide();
  header(s, num, title, sub);
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 2.0, w: 11.9, h: 3.7, rectRadius: 0.1, fill: { color: CARD }, line: { color: BORD, width: 1 }, shadow: mkSoft() });
  s.addShape(p.shapes.OVAL, { x: 5.9, y: 2.55, w: 1.55, h: 1.55, fill: { color: "EAF6EF" }, line: { color: GREEN, width: 2 } });
  s.addText("✓", { x: 5.9, y: 2.5, w: 1.55, h: 1.6, align: "center", valign: "middle", fontFace: HF, fontSize: 44, bold: true, color: GREEN, margin: 0 });
  s.addText("Not applicable", { x: 0.7, y: 4.25, w: 11.9, h: 0.5, align: "center", fontFace: HF, fontSize: 22, bold: true, color: INK, margin: 0 });
  s.addText(body, { x: 2.5, y: 4.8, w: 8.3, h: 0.8, align: "center", fontFace: BF, fontSize: 13, color: MUTE, margin: 0, lineSpacingMultiple: 1.06 });
  pageNo(s, page);
}
naSlide(7, "Paid Content", "In-app purchase and payment methods",
  "Lumen Player contains no paid content and offers no in-app purchases, subscriptions, or payment flows. There are no credit-card, voucher-code, or SMS payment methods to test.", 13);
naSlide(8, "In-App Ad", "Advertising placements (banner / video)",
  "Lumen Player displays no advertising of any kind — no banner ads and no video ads. There are no ad placements, locations, or ad-network integrations to describe.", 14);

// ============================================================ SLIDE 15 — CLOSING
{
  const s = p.addSlide();
  s.background = { color: BG };
  s.addShape(p.shapes.RECTANGLE, { x: 0, y: H - 0.19, w: W, h: 0.05, fill: { color: CYAN } });
  s.addShape(p.shapes.RECTANGLE, { x: 0, y: H - 0.14, w: W, h: 0.14, fill: { color: INDIGO } });
  s.addImage({ path: IMG + "lumen-mark.png", x: W / 2 - 0.85, y: 1.9, w: 1.7, h: 1.7, altText: "Lumen Player mark" });
  s.addText("Thank you for reviewing Lumen Player", { x: 1, y: 3.85, w: W - 2, h: 0.6, align: "center", fontFace: HF, fontSize: 26, bold: true, color: "FFFFFF", margin: 0 });
  s.addText("A generic media player for the playlists you already own — it bundles, hosts and supplies no content.", { x: 1, y: 4.5, w: W - 2, h: 0.5, align: "center", fontFace: BF, fontSize: 13, color: CYAN, margin: 0 });
  s.addText("com.andrew1h1.lumenplayer   ·   v1.0.0   ·   Andrew Hany", { x: 1, y: 5.2, w: W - 2, h: 0.4, align: "center", fontFace: BF, fontSize: 12, color: "8894AC", margin: 0 });
}

p.writeFile({ fileName: path.join(__dirname, "..", "Lumen_Player_UX_Scenario.pptx") }).then((f) => console.log("WROTE", f)).catch((e) => { console.error("ERR", e); process.exit(1); });
