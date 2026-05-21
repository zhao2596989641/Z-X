/**
 * 图库编辑器 v4
 * - 利用服务器注入的 __IMAGE_LIST__ + __IMAGE_META__ 持久化标题/文案
 * - 新图片在动画初始化前同步补齐 DOM，自动套用原有效果
 * - travel: 无文案输入、随机 span、均衡分布到两个 .items
 * - 缩略图=原图（服务器不再压缩）
 */
(function () {
  'use strict';

  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return;

  var pathParts = window.location.pathname.split('/');
  var pagesIdx = pathParts.lastIndexOf('pages');
  var section = pagesIdx >= 0 ? pathParts[pagesIdx + 1] : null;
  var VALID = ['beauty', 'daily', 'hhh', 'travel'];
  if (!section || VALID.indexOf(section) === -1) return;

  var editing = false;
  var DEL_KEY = 'deleted_' + section;

  /* ========== 模板检测 ========== */
  function detectTemplate() {
    if (document.getElementById('thumbnails')) return 'lens';
    if (document.querySelector('.items'))         return 'parallel';
    return 'multiverse';
  }
  var template = detectTemplate();

  /* ========== DOM 工具 ========== */
  function el(tag, cls, html, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function toast(msg, ms) {
    var t = document.querySelector('.upload-toast');
    if (t) t.remove();
    t = el('div', 'upload-toast', msg);
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, ms || 2500);
  }

  /* ========== 元数据（标题/文案） ========== */
  function getMeta() {
    return window.__IMAGE_META__ || {};
  }

  function saveMetaToServer(filename, title, caption) {
    fetch('/api/meta/' + section, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filename, title: title, caption: caption })
    }).catch(function () {});
  }

  /* ========== 查找 article & 容器 ========== */
  function findArticles() {
    if (template === 'lens')     return document.querySelectorAll('#thumbnails > article');
    if (template === 'parallel') return document.querySelectorAll('.item.thumb');
    return document.querySelectorAll('#main > .thumb');
  }

  function getContainer() {
    if (template === 'lens')     return document.getElementById('thumbnails');
    if (template === 'parallel') {
      // 均衡分布：选总元素（含 .item.intro）少的那个 .items
      var containers = document.querySelectorAll('.items');
      if (containers.length === 0) return document.getElementById('main');
      var best = containers[0];
      for (var i = 1; i < containers.length; i++) {
        if (containers[i].children.length < best.children.length) {
          best = containers[i];
        }
      }
      return best;
    }
    return document.getElementById('main');
  }

  /* ========== 文件名提取/匹配 ========== */
  function getFilename(article) {
    var img = article.querySelector('img');
    if (!img) return null;
    return (img.getAttribute('src') || '').split('/').pop();
  }

  function findArticleByFilename(filename) {
    var articles = findArticles();
    for (var i = 0; i < articles.length; i++) {
      if (getFilename(articles[i]) === filename) return articles[i];
    }
    return null;
  }

  /* ========== 构建 article HTML ========== */
  function buildArticleHTML(filename, title, caption) {
    var full = 'images/fulls/' + filename;
    var thumb = 'images/thumbs/' + filename;
    title = title || '';
    caption = caption || '';

    if (template === 'multiverse') {
      return '<article class="thumb">' +
        '<a href="' + full + '" class="image"><img src="' + thumb + '" alt="" /></a>' +
        (title ? '<h2>' + title + '</h2>' : '<h2></h2>') +
        (caption ? '<p>' + caption + '</p>' : '<p></p>') +
        '</article>';
    }
    if (template === 'lens') {
      return '<article>' +
        '<a class="thumbnail" href="' + full + '"><img src="' + thumb + '" alt="" /></a>' +
        (title ? '<h2>' + title + '</h2>' : '<h2></h2>') +
        (caption ? '<p>' + caption + '</p>' : '<p></p>') +
        '</article>';
    }
    // parallel: 随机 span + delay
    var spans = ['span-1', 'span-1', 'span-2', 'span-2', 'span-3'];  // 加权随机
    var span = spans[Math.floor(Math.random() * spans.length)];
    var delay = 'delay-' + (Math.floor(Math.random() * 6) + 1);
    return '<article class="item thumb ' + span + ' ' + delay + '">' +
      (title ? '<h2>' + title + '</h2>' : '<h2></h2>') +
      '<a href="' + full + '" class="image"><img src="' + thumb + '" alt="" class="imgthumb"></a>' +
      '</article>';
  }

  function addArticleToDOM(filename, title, caption) {
    var container = getContainer();
    var div = document.createElement('div');
    div.innerHTML = buildArticleHTML(filename, title, caption);
    var art = div.firstElementChild;
    container.appendChild(art);

    // Multiverse 模板：设置 background-image
    if (template === 'multiverse') setupMultiverseThumb(art);
    return art;
  }

  function setupMultiverseThumb(article) {
    var imgEl = article.querySelector('.image img');
    var imageEl = article.querySelector('.image');
    if (imgEl && imageEl) {
      imageEl.style.backgroundImage = 'url(' + imgEl.getAttribute('src') + ')';
      imgEl.style.display = 'none';
    }
  }

  /* ========== 删除记录 (localStorage) ========== */
  function getDeletedList() {
    try { return JSON.parse(localStorage.getItem(DEL_KEY)) || []; } catch (e) { return []; }
  }
  function addDeleted(filename) {
    var list = getDeletedList();
    if (list.indexOf(filename) === -1) list.push(filename);
    localStorage.setItem(DEL_KEY, JSON.stringify(list));
  }

  /* ========== 同步 DOM（在 main.js 之前执行） ========== */
  function syncFromImageList() {
    var serverFiles = window.__IMAGE_LIST__ || [];
    var meta = getMeta();
    var deletedList = getDeletedList();
    var serverSet = {};
    serverFiles.forEach(function (f) { serverSet[f] = true; });

    // 1) 移除 DOM 中文件已不存在的 article
    findArticles().forEach(function (art) {
      var fn = getFilename(art);
      if (fn && !serverSet[fn]) {
        if (art.parentNode) art.parentNode.removeChild(art);
      }
    });

    // 2) 添加缺失的 article（不在删除记录中）
    serverFiles.forEach(function (fn) {
      if (deletedList.indexOf(fn) !== -1) return;
      if (findArticleByFilename(fn)) return;
      var info = meta[fn] || {};
      addArticleToDOM(fn, info.title || '', info.caption || '');
    });

    // 3) 用 meta 数据更新已有 article 的标题/文案（处理原文件中标题为空的情况）
    if (Object.keys(meta).length > 0) {
      findArticles().forEach(function (art) {
        var fn = getFilename(art);
        if (!fn || !meta[fn]) return;
        var h2 = art.querySelector('h2');
        var p = art.querySelector('p');
        if (h2 && meta[fn].title && !h2.textContent.trim()) {
          h2.textContent = meta[fn].title;
        }
        if (p && meta[fn].caption && !p.textContent.trim()) {
          p.textContent = meta[fn].caption;
        }
      });
    }

    // 4) multiverse: 确保所有 thumb 的 background-image 已设置
    if (template === 'multiverse') {
      findArticles().forEach(function (art) { setupMultiverseThumb(art); });
    }
  }

  /* ========== 删除图片 ========== */
  function deleteImage(article) {
    var filename = getFilename(article);
    if (!filename) return;
    if (!confirm('确定要删除「' + filename + '」吗？此操作不可恢复。')) return;

    article.style.opacity = '0.3';
    article.style.pointerEvents = 'none';

    fetch('/api/image/' + section + '/' + encodeURIComponent(filename), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          addDeleted(filename);
          if (article.parentNode) article.parentNode.removeChild(article);
          toast('已删除');
        } else {
          article.style.opacity = '';
          article.style.pointerEvents = '';
          toast('删除失败：' + (data.error || '未知错误'));
        }
      })
      .catch(function () {
        article.style.opacity = '';
        article.style.pointerEvents = '';
        toast('删除失败：网络错误');
      });
  }

  /* ========== 删除按钮刷新 ========== */
  function refreshDeleteButtons() {
    document.querySelectorAll('.btn-delete-image').forEach(function (b) { b.remove(); });
    if (!editing) return;
    findArticles().forEach(function (art) {
      art.style.position = 'relative';
      var btn = el('button', 'btn-delete-image', '&#10005;');
      btn.title = '删除此图片';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        deleteImage(art);
      });
      art.appendChild(btn);
    });
  }

  /* ========== 上传弹窗 ========== */
  var modal, dropZone, titleInput, captionInput, fileInputModal, selectedFile;
  var hasCaption = (template !== 'parallel'); // travel 没有文案

  function buildModal() {
    modal = el('div', 'upload-modal-overlay');
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

    var box = el('div', 'upload-modal-box');

    dropZone = el('div', 'upload-dropzone',
      '<div class="dropzone-icon">&#128247;</div>' +
      '<div class="dropzone-text">拖拽或点击选择照片</div>' +
      '<div class="dropzone-hint">支持 JPG / PNG / GIF / WebP</div>'
    );
    dropZone.addEventListener('click', function () { fileInputModal.click(); });
    dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) handleModalFile(e.dataTransfer.files[0]);
    });

    fileInputModal = el('input', 'upload-file-hidden', '', { type: 'file', accept: 'image/*' });
    fileInputModal.addEventListener('change', function () {
      if (fileInputModal.files.length) handleModalFile(fileInputModal.files[0]);
    });

    var preview = el('div', 'upload-preview', '', { id: 'uploadPreview' });

    var label1 = el('label', 'upload-label', '标题');
    titleInput = el('input', 'upload-input', '', { type: 'text', placeholder: '输入图片标题...', maxlength: '50' });

    box.appendChild(dropZone);
    box.appendChild(fileInputModal);
    box.appendChild(preview);
    box.appendChild(label1);
    box.appendChild(titleInput);

    if (hasCaption) {
      var label2 = el('label', 'upload-label', '文案');
      captionInput = el('textarea', 'upload-textarea', '', { placeholder: '输入图片描述...', rows: '3', maxlength: '200' });
      box.appendChild(label2);
      box.appendChild(captionInput);
    }

    var btnRow = el('div', 'upload-btn-row');
    var cancelBtn = el('button', 'upload-btn upload-btn-cancel', '取消');
    var confirmBtn = el('button', 'upload-btn upload-btn-confirm', '确认添加');
    cancelBtn.addEventListener('click', closeModal);
    confirmBtn.addEventListener('click', doUpload);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    box.appendChild(btnRow);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  function handleModalFile(file) {
    if (!file.type.startsWith('image/')) { toast('请选择图片文件'); return; }
    selectedFile = file;
    var reader = new FileReader();
    reader.onload = function (e) {
      var preview = document.getElementById('uploadPreview');
      preview.innerHTML = '<img src="' + e.target.result + '" alt="预览" />';
      preview.style.display = 'block';
      dropZone.style.display = 'none';
      if (!titleInput.value) {
        titleInput.value = file.name.replace(/\.[^.]+$/, '');
      }
    };
    reader.readAsDataURL(file);
  }

  function doUpload() {
    if (!selectedFile) { toast('请先选择一张图片'); return; }
    var formData = new FormData();
    formData.append('image', selectedFile);

    var confirmBtn = modal.querySelector('.upload-btn-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = '上传中...';

    fetch('/api/upload/' + section, { method: 'POST', body: formData })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认添加';
        if (data.success) {
          var title = titleInput.value.trim();
          var caption = hasCaption ? (captionInput ? captionInput.value.trim() : '') : '';
          var newArt = addArticleToDOM(data.filename, title, caption);

          // 持久化元数据到服务器 + 更新本地 window.__IMAGE_META__
          saveMetaToServer(data.filename, title, caption);
          if (window.__IMAGE_META__) {
            window.__IMAGE_META__[data.filename] = { title: title, caption: caption };
          }

          // 从删除记录中移除
          var list = getDeletedList();
          var idx = list.indexOf(data.filename);
          if (idx !== -1) { list.splice(idx, 1); localStorage.setItem(DEL_KEY, JSON.stringify(list)); }

          closeModal();
          refreshDeleteButtons();
          toast('已添加：' + (title || data.filename));
        } else {
          toast('上传失败：' + (data.error || '未知错误'), 3000);
        }
      })
      .catch(function () {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认添加';
        toast('上传失败：网络错误', 3000);
      });
  }

  function openModal() {
    if (!modal) buildModal();
    selectedFile = null;
    titleInput.value = '';
    if (captionInput) captionInput.value = '';
    var preview = document.getElementById('uploadPreview');
    if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
    dropZone.style.display = '';
    fileInputModal.value = '';
    modal.style.display = 'flex';
  }

  function closeModal() {
    if (modal) modal.style.display = 'none';
  }

  /* ========== 编辑模式切换 ========== */
  function toggleEdit() {
    editing = !editing;
    if (editing) {
      document.body.classList.add('editing');
      if (editBtn) { editBtn.classList.add('active'); editBtn.innerHTML = '&#10005;'; editBtn.title = '退出编辑模式'; }
    } else {
      document.body.classList.remove('editing');
      if (editBtn) { editBtn.classList.remove('active'); editBtn.innerHTML = '&#9998;'; editBtn.title = '编辑模式'; }
      toast('正在刷新...', 600);
      setTimeout(function () { window.location.reload(); }, 700);
      return;
    }
    refreshDeleteButtons();
    if (addBtn) addBtn.style.display = editing ? 'flex' : 'none';
  }

  /* ========== 构建 UI ========== */
  var editBtn, addBtn;

  function buildUI() {
    var isLens = (template === 'lens');

    if (isLens) {
      var mainEl = document.getElementById('main');
      if (mainEl) {
        var btnBar = el('div', 'lens-edit-bar');
        editBtn = el('button', 'btn-edit-toggle lens-edit-btn', '&#9998;');
        editBtn.title = '编辑模式';
        editBtn.addEventListener('click', toggleEdit);
        addBtn = el('button', 'btn-add-image lens-add-btn', '&#xFF0B;');
        addBtn.title = '添加图片';
        addBtn.addEventListener('click', openModal);
        btnBar.appendChild(editBtn);
        btnBar.appendChild(addBtn);
        mainEl.appendChild(btnBar);
      }
    } else {
      // 非 Lens：按钮组（右上角横向排列）
      var group = el('div', 'editor-btn-group');
      editBtn = el('button', 'btn-edit-toggle', '&#9998;');
      editBtn.title = '编辑模式';
      editBtn.addEventListener('click', toggleEdit);
      addBtn = el('button', 'btn-add-image', '&#xFF0B;');
      addBtn.title = '添加图片';
      addBtn.addEventListener('click', openModal);
      group.appendChild(editBtn);
      group.appendChild(addBtn);
      document.body.appendChild(group);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
  }

  /* ========== 初始化 ========== */
  syncFromImageList();
  buildUI();
})();
