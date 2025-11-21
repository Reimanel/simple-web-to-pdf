const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const puppeteer = require("puppeteer");
const archiver = require("archiver");

const app = express();
const upload = multer();
const OUTPUT_DIR = path.join(__dirname, "output");
const TMP_DIR = path.join(os.tmpdir(), "simple-web-to-pdf");

function safeName(s) {
  return String(s).replace(/[^a-zA-Z0-9]/g, "_").slice(0,40) + '_' + Date.now();
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

async function generatePDF(url, pdfPath, timeoutMs = 30000) {
  const browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});
  try {
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'networkidle2', timeout: timeoutMs});
    await page.waitForTimeout(2500); // extra delay for JS
    await page.pdf({path: pdfPath, format: 'A4', printBackground: true});
  } finally {
    await browser.close();
  }
}

// SINGLE PDF
app.post("/single", upload.none(), async (req, res) => {
  let url = req.body.url;
  if (!url) return res.status(400).send("No URL.");
  const fullName = safeName("single");
  const pdfPath = path.join(TMP_DIR, fullName+".pdf");
  try {
    await generatePDF(url, pdfPath);
    res.download(pdfPath, `site2pdf_${Date.now()}.pdf`, ()=>fs.unlinkSync(pdfPath));
  } catch(e){
    res.status(500).send("Failed to generate PDF.\n"+e.toString());
  }
});

// BULK
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
    try {
      await generatePDF(url, pdfPath,60000);
      pdfs.push({pdf: name, path: pdfPath, url});
      idx++;
    } catch(e) {
      fs.writeFileSync(path.join(tmp,"fail_"+name+".txt"),`FAILED: ${url}\n${e}`);
    }
  }
  const zipPath = path.join(OUTPUT_DIR,task+".zip");
  const out = fs.createWriteStream(zipPath);
  const archive = archiver('zip',{zlib:{level:9}});
  out.on('close', ()=>{
    fs.rmSync(tmp,{recursive:true,force:true});
    res.download(zipPath,`bulkpdf_${Date.now()}.zip`,()=>fs.unlinkSync(zipPath));
  });
  archive.pipe(out);
  for(const p of pdfs) { archive.file(p.path, {name: p.pdf}); }
  archive.finalize();
});

app.get("/health",(req,res)=>res.json({ok:true,time:new Date().toISOString()}));

app.listen(4000,()=>console.log("Modern Web-to-PDF server on :4000 (puppeteer powered)"));
