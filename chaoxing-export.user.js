// ==UserScript==
// @name         tiku-builder · 学习通习题导出
// @namespace    https://github.com/gaon7455-cmd/tiku-builder
// @version      1.0.0
// @description  在你已经登录学习通的前提下，把当前习题/测验/作业页面的题目导出为 JSON，供 tiku-builder 生成题库。只读本页内容，不登录、不存密码、不上传、不自动答题、不自动提交、不刷视频。
// @author       gaon7455-cmd
// @license      MIT
// @match        https://mooc1.chaoxing.com/*
// @match        https://mooc1-1.chaoxing.com/*
// @match        https://mooc2.chaoxing.com/*
// @match        https://i.mooc.chaoxing.com/*
// @match        https://mobilelearn.chaoxing.com/*
// @match        https://*.chaoxing.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * tiku-builder 学习通习题导出脚本
 * ================================
 * 用法（全部在你自己的浏览器里完成）：
 *   1. 在 Tampermonkey 里安装本脚本。
 *   2. 自己在浏览器里登录学习通（超星），打开一门课的某个测验/作业/章节习题页面。
 *   3. 页面右下角会出现「导出本页习题（JSON）」按钮，点一下即下载 JSON 文件。
 *   4. 把下载的 JSON 拿到 tiku-builder 向导页第 3 步导入。
 *
 * 本脚本的底线（写在代码里，也写在这里）：
 *   - 只读：只读你已经打开的页面内容，绝不替你登录。
 *   - 不存密码、不发请求：不读取、不保存、不上传任何账号、密码、token、cookie。
 *   - 不代答：不自动答题、不自动提交、不自动播放视频、不改任何页面数据。
 *   - 不编答案：页面显示什么就导出什么。页面只显示“我的答案”和 ✓/✗、不显示
 *     “正确答案”的题，导出时 officialAnswer 为 null；生成题库时这类题会显示
 *     “页面未显示标准答案”，要靠向导页第 5 步人工核实，绝不凭推测补写。
 *
 * 诚实说明：学习通页面结构经常变，下面的选择器是按 2026 年 11 月的页面写的
 * （题干 .TiMu、选项 .ulBg、答案区含“正确答案”字样）。如果某天抓不到题目，
 * 脚本仍会把页面全文（pageText）一起导出，你可以把 pageText 贴到向导页
 * 第 3 步的导入框里手工整理，或按 README 的说明自己改选择器。
 */

(function () {
  'use strict';

  var VERSION = '1.0.0';

  function text(el) {
    return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function download(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // 课程名 / 章节：从页面标题、面包屑、课程名元素里尽力找，找不到就留空，导入时手动填。
  function courseInfo() {
    var name = '';
    var el = document.querySelector('.course-name, .coursename, [class*="courseName"], .ztt, h1');
    if (el) name = text(el);
    if (!name) name = (document.title || '').replace(/[-_].*$/, '').trim();
    var crumb = '';
    var bc = document.querySelector('.breadcrumb, .navcrumb, [class*="crumb"], .pos, .location');
    if (bc) crumb = text(bc);
    var m = location.href.match(/courseId=(\d+)/) || location.href.match(/course[_-]?id\/(\d+)/i);
    return { name: name, crumb: crumb, courseId: m ? m[1] : '', url: location.href };
  }

  // 判断题型：按题干里的（ ）、选项内容、题目前的“多选/单选/判断”字样猜。
  function guessType(stem, opts, headText) {
    var h = (headText || '') + stem;
    if (/填空/.test(h) || /（\s*）/.test(stem)) return 'fill';
    if (/判断/.test(h)) return 'judge';
    if (/多选/.test(h)) return 'multi';
    if (/连线|配对|对应/.test(h)) return 'match';
    if (/简答|论述|计算/.test(h)) return 'short';
    if (opts && opts.length === 2 && opts[0] === '对' && opts[1] === '错') return 'judge';
    return 'single';
  }

  // 从一个题目块里抽：题干、选项、页面显示的正确答案、页面显示的我的答案、分值。
  function parseBlock(block, index) {
    var stemEl = block.querySelector('.TiMu, .question-title, .timu, [class*="TiMu"], [class*="timu"]');
    var stem = stemEl ? text(stemEl) : '';
    if (!stem) {
      // 退化：取块内第一段较长的文字当题干。
      var ps = block.querySelectorAll('p, div');
      for (var i = 0; i < ps.length; i++) {
        var t = text(ps[i]);
        if (t.length > 8 && t.length < 300) { stem = t; break; }
      }
    }
    if (!stem) return null;

    var opts = [];
    var optEls = block.querySelectorAll('.ulBg li, .options li, .answer li, [class*="option"] li, .choice li');
    optEls.forEach(function (li) {
      var t = text(li).replace(/^[A-ZＡ-Ｚ][\.、\s]*/, '');
      if (t) opts.push(t);
    });

    var all = text(block);
    var official = null, mine = null, score = '';
    var mOff = all.match(/正确答案[：:]\s*([^。；\n]{1,80})/);
    if (mOff) official = mOff[1].trim();
    var mMine = all.match(/我的答案[：:]\s*([^。；\n]{1,80})/);
    if (mMine) mine = mMine[1].trim();
    var mScore = all.match(/(\d+(?:\.\d+)?)\s*分/);
    if (mScore) score = mScore[1];

    return {
      index: index + 1,
      sec: '',
      q: stem,
      type: guessType(stem, opts, all.slice(0, 40)),
      opts: opts,
      // officialAnswer 为 null = 页面未显示标准答案（最常见的情况），不要自己编。
      officialAnswer: official,
      myAnswer: mine,
      score: score
    };
  }

  function collect() {
    var info = courseInfo();
    var blocks = document.querySelectorAll(
      '.TiMu, .question, .exam-question, .topic, [class*="question"], [class*="examQue"], .test-question'
    );
    var seen = new Set();
    var questions = [];
    blocks.forEach(function (b, i) {
      // 跳过嵌套在别的题目块里的重复块。
      var key = text(b).slice(0, 60);
      if (seen.has(key)) return;
      seen.add(key);
      var q = parseBlock(b, questions.length);
      if (q) questions.push(q);
    });
    return {
      tool: 'tiku-builder-chaoxing-export',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      course: info,
      questions: questions,
      // 页面全文兜底：选择器失效时，向导页可用它手工整理。
      pageText: (document.body.innerText || '').slice(0, 200000)
    };
  }

  function looksLikeQuizPage() {
    var url = location.href;
    if (/work|exam|test|quiz|homework|task/i.test(url)) return true;
    var t = (document.body.innerText || '');
    return /测验|作业|考试|章节测试|小测/.test(t) && /正确答案|我的答案|提交|题/.test(t);
  }

  function mount() {
    if (!looksLikeQuizPage()) return;
    if (document.getElementById('tiku-export-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'tiku-export-btn';
    btn.textContent = '导出本页习题（JSON）';
    btn.title = 'tiku-builder：只导出本页已显示的题目与答案，不登录、不上传、不自动答题';
    btn.style.cssText = 'position:fixed;right:16px;bottom:90px;z-index:99999;padding:12px 16px;border-radius:999px;border:1.5px solid #141414;background:#141414;color:#fff;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);';
    btn.onclick = function () {
      try {
        var data = collect();
        if (!data.questions.length) {
          alert('本页没有识别到题目（学习通页面结构可能变了）。\n已把页面全文一起导出，请把 JSON 拿到 tiku-builder 向导页第 3 步，用“页面全文”方式导入。');
        }
        var name = (data.course.name || 'chaoxing') .replace(/[\\/:*?"<>|]/g, '_');
        download('tiku-' + name + '-' + new Date().toISOString().slice(0, 10) + '.json', data);
      } catch (e) {
        alert('导出失败：' + e.message);
      }
    };
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
  // 学习通很多内容是后加载的，5 秒后再补挂一次按钮。
  setTimeout(mount, 5000);
})();
