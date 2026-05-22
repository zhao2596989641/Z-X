const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Parse JSON
app.use(express.json());

// ---------- helpers: image list & meta ----------
const META_DIR = path.join(__dirname, 'meta');

function insertArticleHTML(section, articleHTML) {
  const filePath = path.join(__dirname, 'pages', section, 'index.html');
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, 'utf-8');
  if (html.includes('<!-- GALLERY_INSERT -->')) {
    html = html.replace('<!-- GALLERY_INSERT -->', articleHTML + '\n<!-- GALLERY_INSERT -->');
    fs.writeFileSync(filePath, html, 'utf-8');
  }
}

function removeArticleHTML(section, filename) {
  const filePath = path.join(__dirname, 'pages', section, 'index.html');
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, 'utf-8');
  // 移除包含该文件名的 <article> 整块（不跨越 article 边界）
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 用非贪婪 + 否定前瞻：匹配一个 article，内容不包含另一个 <article 开头
  const re = new RegExp('<article[^>]*>(?:(?!<article[^>]*>)[\\s\\S])*?' + escaped + '(?:(?!<article[^>]*>)[\\s\\S])*?<\\/article>', 'g');
  if (re.test(html)) {
    html = html.replace(re, '');
    fs.writeFileSync(filePath, html, 'utf-8');
  }
}

function buildArticleForTemplate(section, filename) {
  const full = 'images/fulls/' + filename;
  const thumb = full;  // 缩略图=原图
  // Detect template type
  const filePath = path.join(__dirname, 'pages', section, 'index.html');
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (raw.includes('id="thumbnails"')) {
    // Lens template (daily, hhh)
    return '<article>\n<a class="thumbnail" href="' + full + '"><img src="' + thumb + '" alt="" /></a>\n<h2></h2>\n<p></p>\n</article>';
  }
  if (raw.includes('class="items"')) {
    // Parallel template (travel)
    const spans = ['span-1', 'span-1', 'span-2', 'span-2', 'span-3'];
    const span = spans[Math.floor(Math.random() * spans.length)];
    return '<article class="item thumb ' + span + '">\n<h2></h2>\n<a href="' + full + '" class="image"><img src="' + thumb + '" alt="" class="imgthumb"></a>\n</article>';
  }
  // Multiverse template (beauty) — default
  return '<article class="thumb">\n<a href="' + full + '" class="image"><img src="' + thumb + '" alt="" /></a>\n<h2></h2>\n<p></p>\n</article>';
}
function getImageList(section) {
  const fullsDir = path.join(__dirname, 'pages', section, 'images', 'fulls');
  if (!fs.existsSync(fullsDir)) return [];
  return fs.readdirSync(fullsDir)
    .filter(f => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(f))
    .sort((a, b) => {
      // 数字前缀的排前面，非数字（用户上传）排后面
      const numA = parseInt((a.match(/^(\d+)/) || [])[1] || '999999', 10);
      const numB = parseInt((b.match(/^(\d+)/) || [])[1] || '999999', 10);
      if (numA !== numB) return numA - numB;
      // 用户上传的文件按修改时间排序（先上传的在前），保证插入顺序
      if (numA === 999999) {
        try {
          return fs.statSync(path.join(fullsDir, a)).mtimeMs - fs.statSync(path.join(fullsDir, b)).mtimeMs;
        } catch (e) { return a.localeCompare(b); }
      }
      return a.localeCompare(b);
    });
}
function readMeta(section) {
  try {
    const p = path.join(META_DIR, section + '.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
  } catch (e) { return {}; }
}
function writeMeta(section, data) {
  fs.mkdirSync(META_DIR, { recursive: true });
  fs.writeFileSync(path.join(META_DIR, section + '.json'), JSON.stringify(data, null, 2), 'utf-8');
}

// ---------- inject image list into gallery pages ----------
app.use((req, res, next) => {
  const match = req.path.match(/^\/pages\/(beauty|daily|hhh|travel)\/index\.html$/);
  if (!match) return next();

  const section = match[1];
  const filePath = path.join(__dirname, 'pages', section, 'index.html');

  if (!fs.existsSync(filePath)) return next();

  let html = fs.readFileSync(filePath, 'utf-8');
  const images = getImageList(section);
  const meta = readMeta(section);

  // Clean meta: remove entries for files that no longer exist
  const imageSet = new Set(images);
  let cleaned = false;
  for (const k of Object.keys(meta)) {
    if (!imageSet.has(k)) { delete meta[k]; cleaned = true; }
  }
  if (cleaned) writeMeta(section, meta);

  const injectScript =
    `<script>window.__IMAGE_LIST__ = ${JSON.stringify(images)};</script>\n` +
    `<script>window.__IMAGE_META__ = ${JSON.stringify(meta)};</script>`;

  // Inject before </head> so it's available before any other scripts
  html = html.replace('</head>', injectScript + '\n</head>');

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Serve static files from project root
app.use(express.static(__dirname));

// ---------- multer config ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  }
});

const SECTIONS = ['beauty', 'daily', 'hhh', 'travel'];

// ---------- upload ----------
app.post('/api/upload/:section', upload.single('image'), async (req, res) => {
  try {
    const { section } = req.params;
    if (!SECTIONS.includes(section)) {
      return res.status(400).json({ error: '无效的板块' });
    }

    const fullsDir = path.join(__dirname, 'pages', section, 'images', 'fulls');
    fs.mkdirSync(fullsDir, { recursive: true });

    // Safe filename
    const ext = path.extname(req.file.originalname) || '.jpg';
    const base = path.basename(req.file.originalname, ext)
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    const filename = `${base}_${Date.now()}${ext}`;

    // Save image
    const fullPath = path.join(fullsDir, filename);
    fs.writeFileSync(fullPath, req.file.buffer);

    // Return thumbnail as base64 for immediate preview
    const thumbBase64 = req.file.buffer.toString('base64');
    const mime = req.file.mimetype || 'image/jpeg';

    // Update metadata
    const meta = readMeta(section);
    meta[filename] = meta[filename] || { title: '', caption: '' };
    writeMeta(section, meta);

    // Sync article into static HTML (for GitHub Pages deployment)
    insertArticleHTML(section, buildArticleForTemplate(section, filename));

    res.json({
      success: true,
      filename,
      thumbnail: `data:${mime};base64,${thumbBase64}`
    });
  } catch (err) {
    console.error('上传失败:', err);
    res.status(500).json({ error: '上传失败，请重试' });
  }
});

// ---------- list images ----------
app.get('/api/images/:section', (req, res) => {
  try {
    const { section } = req.params;
    if (!SECTIONS.includes(section)) {
      return res.status(400).json({ error: '无效的板块' });
    }
    res.json({ images: getImageList(section) });
  } catch (err) {
    console.error('读取图片列表失败:', err);
    res.status(500).json({ error: '读取失败' });
  }
});

// ---------- delete ----------
app.delete('/api/image/:section/:filename', (req, res) => {
  try {
    const { section, filename } = req.params;
    if (!SECTIONS.includes(section)) {
      return res.status(400).json({ error: '无效的板块' });
    }
    // Prevent directory traversal
    if (/[\\/]|\.\./.test(filename)) {
      return res.status(400).json({ error: '无效的文件名' });
    }

    const fullPath = path.join(__dirname, 'pages', section, 'images', 'fulls', filename);

    let deleted = false;
    if (fs.existsSync(fullPath)) { fs.unlinkSync(fullPath); deleted = true; }

    if (deleted) {
      // Sync removal from static HTML
      removeArticleHTML(section, filename);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: '文件不存在' });
    }
  } catch (err) {
    console.error('删除失败:', err);
    res.status(500).json({ error: '删除失败，请重试' });
  }
});

// ---------- save meta ----------
app.post('/api/meta/:section', (req, res) => {
  try {
    const { section } = req.params;
    if (!SECTIONS.includes(section)) return res.status(400).json({ error: '无效的板块' });
    const { filename, title, caption } = req.body;
    if (!filename) return res.status(400).json({ error: '缺少文件名' });
    const meta = readMeta(section);
    meta[filename] = { title: title || '', caption: caption || '' };
    writeMeta(section, meta);
    res.json({ success: true });
  } catch (err) {
    console.error('保存元数据失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

// ---------- save letter ----------
app.post('/api/letter', (req, res) => {
  try {
    const { letterHTML } = req.body;
    if (!letterHTML || typeof letterHTML !== 'string') {
      return res.status(400).json({ error: '缺少信件内容' });
    }

    const letterPath = path.join(__dirname, 'pages', 'letter', 'index.html');
    let html = fs.readFileSync(letterPath, 'utf-8');

    // Replace everything inside <div id="letter"> ... </div>
    html = html.replace(
      /(<div id="letter">)[\s\S]*?(<\/div>)/,
      `$1\n                    ${letterHTML}\n                $2`
    );

    fs.writeFileSync(letterPath, html, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    console.error('保存信件失败:', err);
    res.status(500).json({ error: '保存失败，请重试' });
  }
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`\n✨ 服务器已启动:  http://localhost:${PORT}`);
  console.log('   按 Ctrl+C 停止\n');
});
