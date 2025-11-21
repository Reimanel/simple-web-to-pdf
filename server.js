const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const archiver = require('archiver');

const app = express();
const upload = multer();
const OUTPUT_DIR = path.join(__dirname, "output");
const TMP_DIR = path.join(os.tmpdir(), "simple-web-to-pdf");

// IMPORTANT: adjust this path to match your system
const chrome = "/usr/bin/chromium-browser"; // or '/usr/bin/chromium'

function safeName(s) {
  return String(s).replace(/[^a-zA-Z0-9]/g, "_").slice(0,40) + '_' + Date.now();
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function chromeCmd(url, pdfPath) {
  return `\"${chrome}\" --headless --no-sandbox --disable-gpu --disable-web-security --disable-software-rasterizer --run-all-compositor-stages-before-draw --virtual-time-budget=5000 --font-render-hinting=none --print-to-pdf=\"${pdfPath}\" ${url}`;
}

app.post("/bulk", upload.none(), async (req, res) => {
  let urls = req.body.urls || "";
  urls = urls.split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
  if (!urls.length) return res.status(400).send("No URLs submitted.");
  const task = safeName("bulkpdf");
  const tmp = path.join(TMP_DIR,task);
  fs.mkdirSync(tmp);
  let pdfs = [];
  let idx = 1;
  for(const url of urls) {
    const name = `page_${idx.toString().padStart(3,'0')}.pdf`;
    const pdfPath = path.join(tmp,name);
    const cmd = chromeCmd(url, pdfPath);
    try {
      await new Promise((resolve,reject)=>exec(cmd,err=>err?reject(err):resolve()));
      pdfs.push({pdf: name, path: pdfPath,url});
      idx++;
    } catch(e) { fs.writeFileSync(path.join(tmp,"fail_"+name+".txt"),`FAILED: ${url}\n${e}`); }
  }
  const zipPath = path.join(OUTPUT_DIR,task+".zip");
  const out = fs.createWriteStream(zipPath);
  const archive = archiver('zip',{zlib:{level:9}});
  out.on('close', ()=>{
    fs.rmSync(tmp,{recursive:true,force:true});
    res.download(zipPath,`bulkpdf_${Date.now()}.zip`);
  });
  archive.pipe(out);
  for(const p of pdfs) { archive.file(p.path, {name: p.pdf}); }
  archive.finalize();
});

app.get("/health",(req,res)=>res.json({ok:true,time:new Date().toISOString()}));

app.listen(4000,()=>console.log("Simple Web-to-PDF server running on :4000 (Chromium system binary)"));
