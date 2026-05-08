/* ================================================================
   樹人家商 活動家長同意書 共用前端程式
   - 簽名板（滑鼠 / 觸控）
   - 表單送出：fetch POST 至 GAS Web App
   - 送出前驗證：學號 6 位、家長姓名 ≠ 學生姓名、班級即時提示
   ================================================================ */

// 【部署後請填入你的 GAS Web App URL】
const GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycbwkNswb-wILdKn21cEq0mqLD9UxyMURxOROUeZJV2HSVYp33eslevNXszHsMe7LmhlU/exec";

/* ---------- 學號 → 班級推斷（樹人家商編碼規則） ---------- */
//   第 1 碼：年級（2=三年級, 3=二年級, 4=一年級）
//   第 3 碼：科別（1=商, 2=資處, 3=觀光, 4=餐飲, 5=幼保, 6=美容, 7=電子, 8=資訊, 9=影劇）
function inferDeptFromStudentId(sid) {
  if (!/^\d{6}$/.test(String(sid || ""))) return null;
  const s = String(sid);
  const grade = { "2": "三", "3": "二", "4": "一" }[s[0]];
  const dept  = { "1": "商", "2": "資處", "3": "觀", "4": "餐", "5": "幼", "6": "美", "7": "電", "8": "資訊", "9": "影" }[s[2]];
  if (!grade || !dept) return null;
  return `${dept}${grade}`;
}

/* ---------- 班級正規化（僅前端提示用，伺服器端會再做一次） ---------- */
function normalizeClass(cls) {
  if (!cls) return "";
  return String(cls)
    .replace(/^高[一二三12]?/, "")
    .replace(/ㄧ/g, "一")
    .replace(/2/g, "二").replace(/1/g, "一").replace(/3/g, "三")
    .replace(/^幼保(?=[一二三])/, "幼")
    .replace("商科", "商三")
    .replace(/(商|餐|幼|美|資處|資訊|觀|電|影)([一二三])終/, "$1$2忠")
    .trim();
}

/* ---------- 簽名板 ---------- */
let sigCanvas, sigCtx, drawing = false, hasSignature = false;

function initSigPad() {
  sigCanvas = document.getElementById("sigPad");
  if (!sigCanvas) return;
  const ratio = window.devicePixelRatio || 1;
  const resize = () => {
    const rect = sigCanvas.getBoundingClientRect();
    sigCanvas.width  = rect.width  * ratio;
    sigCanvas.height = rect.height * ratio;
    sigCtx = sigCanvas.getContext("2d");
    sigCtx.scale(ratio, ratio);
    sigCtx.lineWidth   = 2.5;
    sigCtx.lineCap     = "round";
    sigCtx.lineJoin    = "round";
    sigCtx.strokeStyle = "#111";
    sigCtx.fillStyle   = "#fff";
    sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);
  };
  resize();
  window.addEventListener("resize", () => { clearSig(); resize(); });

  const getPos = (e) => {
    const rect = sigCanvas.getBoundingClientRect();
    const t = (e.touches && e.touches[0]) ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };
  const start = (e) => { e.preventDefault(); drawing = true; const p = getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); };
  const move  = (e) => { if (!drawing) return; e.preventDefault(); const p = getPos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); hasSignature = true; };
  const end   = (e) => { if (drawing) { e.preventDefault(); drawing = false; } };

  sigCanvas.addEventListener("mousedown",  start);
  sigCanvas.addEventListener("mousemove",  move);
  sigCanvas.addEventListener("mouseup",    end);
  sigCanvas.addEventListener("mouseleave", end);
  sigCanvas.addEventListener("touchstart", start, { passive: false });
  sigCanvas.addEventListener("touchmove",  move,  { passive: false });
  sigCanvas.addEventListener("touchend",   end);
}

function clearSig() {
  if (!sigCtx) return;
  sigCtx.fillStyle = "#fff";
  sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);
  hasSignature = false;
}

/* ---------- 表單送出前驗證 ---------- */
function validateForm(data) {
  // A006 教職員工：跳過學號／班級科系驗證，僅檢手機與必填
  const isStaff = String(data.activity_id || "") === "A006";

  if (!isStaff) {
    // 學號：6 位數字
    if (!/^\d{6}$/.test(String(data.student_id || "").trim())) {
      return { ok: false, err: "學號格式錯誤：請填寫 6 位數字(例：314020)。" };
    }
    // 家長姓名 ≠ 學生姓名
    const sn = String(data.student_name || "").trim();
    const pn = String(data.parent_name  || "").trim();
    if (sn && pn && sn === pn) {
      return { ok: false, err: "家長姓名不可與學生姓名相同，請由家長親自填寫。" };
    }
    // 班級：去除前綴後不可為空
    const normCls = normalizeClass(data.class);
    if (!normCls) {
      return { ok: false, err: "班級欄位請填寫完整(例：商二忠)。" };
    }
    // 班級科別與學號是否一致(學號→科年級)
    const expected = inferDeptFromStudentId(data.student_id);
    if (expected && !normCls.startsWith(expected) && !(/^資[一二三]/.test(normCls) && (expected.startsWith("資處") || expected.startsWith("資訊")))) {
      return { ok: false, err: `班級「${data.class}」與學號 ${data.student_id} 推斷的「${expected}」不一致，請確認後再送出。` };
    }
    // 手機格式
    if (!/^09\d{8}$/.test(String(data.parent_phone || ""))) {
      return { ok: false, err: "家長手機格式錯誤：請填寫 09 開頭共 10 碼。" };
    }
    return { ok: true, normalizedClass: normCls };
  }

  // A006 教職員工驗證：簡化為「姓名、單位、手機」三必填
  if (!String(data.student_name || "").trim()) {
    return { ok: false, err: "請填寫姓名。" };
  }
  if (!String(data.class || "").trim()) {
    return { ok: false, err: "請填寫單位／部門。" };
  }
  if (!/^09\d{8}$/.test(String(data.parent_phone || ""))) {
    return { ok: false, err: "聯絡手機格式錯誤：請填寫 09 開頭共 10 碼。" };
  }
  return { ok: true, normalizedClass: String(data.class).trim() };
}

/* ---------- 全屏成功 / 失敗提示（無法忽視） ---------- */
function showFullscreenResult(type, title, detail) {
  const isOk = (type === "ok");
  const overlay = document.createElement("div");
  overlay.id = "resultOverlay";
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:rgba(0,0,0,.55);
    display:flex;align-items:center;justify-content:center;
    padding:20px;animation:fadeIn .25s ease;
  `;
  const iconColor = isOk ? "#059669" : "#dc2626";
  const bgColor   = isOk ? "#d1fae5" : "#fee2e2";
  const headColor = isOk ? "#047857" : "#991b1b";
  overlay.innerHTML = `
    <style>
      @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      @keyframes pop{0%{transform:scale(.7)}80%{transform:scale(1.05)}100%{transform:scale(1)}}
      #resultBox{animation:pop .35s ease}
    </style>
    <div id="resultBox" style="
      max-width:420px;width:100%;background:#fff;border-radius:16px;
      box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;
      font-family:'Microsoft JhengHei','PingFang TC',sans-serif;text-align:center;">
      <div style="background:${bgColor};padding:30px 20px 20px;">
        <div style="
          width:80px;height:80px;border-radius:50%;background:${iconColor};
          color:#fff;font-size:48px;line-height:80px;margin:0 auto 14px;
          box-shadow:0 4px 16px ${iconColor}40;">${isOk ? "✓" : "✗"}</div>
        <h2 style="color:${headColor};font-size:22px;margin:0;">${title}</h2>
      </div>
      <div style="padding:24px 24px 18px;color:#374151;font-size:15px;line-height:1.7;">
        ${detail}
      </div>
      <div style="padding:0 20px 20px;">
        ${isOk
          ? `<button onclick="window.close();document.getElementById('resultOverlay').remove();"
                style="width:100%;padding:13px;background:#059669;color:#fff;border:none;
                       border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;">
                ✓ 知道了，關閉本頁
             </button>`
          : `<button onclick="document.getElementById('resultOverlay').remove();"
                style="width:100%;padding:13px;background:#dc2626;color:#fff;border:none;
                       border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;">
                返回修改
             </button>`
        }
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  // 防止背景滑動
  document.body.style.overflow = "hidden";
}

/* ---------- 表單送出 ---------- */
async function submitForm(e) {
  e.preventDefault();
  const form = e.target;
  const btn  = document.getElementById("submitBtn");
  const msg  = document.getElementById("msg");
  msg.className = "msg";
  msg.textContent = "";

  if (!hasSignature) {
    msg.className = "msg err";
    msg.textContent = "請先於簽名框內親筆簽名。";
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    return false;
  }
  if (!document.getElementById("agreeCheck").checked) {
    msg.className = "msg err";
    msg.textContent = "請勾選下方確認同意欄位。";
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    return false;
  }

  const data = Object.fromEntries(new FormData(form).entries());

  // 送出前驗證
  const v = validateForm(data);
  if (!v.ok) {
    msg.className = "msg err";
    msg.textContent = v.err;
    window.scrollTo({ top: 0, behavior: "smooth" });
    return false;
  }
  data.class = v.normalizedClass;

  data.signature_image = sigCanvas.toDataURL("image/png");
  data.submit_time     = new Date().toISOString();

  btn.disabled = true;
  btn.textContent = "送出中…請稍候 ⏳";

  try {
    const resp = await fetch(GAS_ENDPOINT, {
      method: "POST",
      mode:   "cors",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data)
    });
    let result = { ok: true };
    try { result = await resp.json(); } catch (_) { /* 若無法解析,視為成功 */ }

    if (result.ok === false) {
      // 後端回報錯誤
      showFullscreenResult("err", "送出失敗",
        `<strong style="color:#dc2626">${result.message || "伺服器拒絕了您的資料"}</strong><br><br>
         請依照訊息修正後重新送出，<br>
         或聯絡學務處 <strong>02-2681-6658</strong>。`);
      btn.disabled = false;
      btn.textContent = "送出簽核";
      return false;
    }

    // 成功 — 顯示全屏成功訊息
    const studentName = String(data.student_name || "").trim();
    const activityName = String(data.activity_name || "").trim();
    showFullscreenResult("ok", "簽核已完成！",
      `<strong style="color:#047857;font-size:17px">感謝您的配合 🙏</strong><br><br>
       ${studentName ? `<span style="background:#ecfdf5;padding:4px 10px;border-radius:14px;font-size:14px">姓名：${studentName}</span><br><br>` : ""}
       您的同意書已成功送出至校方系統，<br>
       資料已記錄完成。本頁可直接關閉。<br><br>
       <span style="color:#888;font-size:13px">${new Date().toLocaleString("zh-TW")}</span>`);

    btn.textContent = "✓ 已送出";
    form.querySelectorAll("input, textarea, select, button").forEach(el => el.disabled = true);
  } catch (err) {
    showFullscreenResult("err", "送出失敗",
      `<strong style="color:#dc2626">網路連線異常</strong><br><br>
       <span style="font-size:13px;color:#666">${err.message || "未知錯誤"}</span><br><br>
       請檢查網路後重新送出，<br>
       或聯絡學務處 <strong>02-2681-6658</strong>。`);
    btn.disabled = false;
    btn.textContent = "送出簽核";
  }
  return false;
}

/* ---------- 學號輸入時即時提示班級 ---------- */
function attachStudentIdHint() {
  const sidInput = document.querySelector('input[name="student_id"]');
  const clsInput = document.querySelector('input[name="class"]');
  if (!sidInput || !clsInput) return;
  // 在學號欄位下方建立提示區
  let hint = document.createElement("div");
  hint.style.cssText = "font-size:12.5px;color:#065f46;margin-top:4px;min-height:1em";
  sidInput.parentNode.appendChild(hint);
  const update = () => {
    const sid = sidInput.value.trim();
    if (!sid) { hint.textContent = ""; return; }
    if (!/^\d{6}$/.test(sid)) { hint.textContent = "⚠ 學號需為 6 位數字"; hint.style.color = "#d93025"; return; }
    const expected = inferDeptFromStudentId(sid);
    if (expected) {
      hint.textContent = `學號推斷：${expected}（請於班級欄填寫完整班別，如 ${expected}忠／${expected}孝 等）`;
      hint.style.color = "#065f46";
      // 若班級欄為空，預填 hint
      if (!clsInput.value && !clsInput.dataset.userTouched) {
        clsInput.placeholder = `例：${expected}忠`;
      }
    } else {
      hint.textContent = "⚠ 學號編碼異常，請確認";
      hint.style.color = "#d93025";
    }
  };
  sidInput.addEventListener("input", update);
  clsInput.addEventListener("input", () => { clsInput.dataset.userTouched = "1"; });
}

/* ---------- 家長陪同：展開／收合 ---------- */
function toggleAccompany(show) {
  const block = document.getElementById("accompanyBlock");
  if (!block) return;
  block.style.display = show ? "block" : "none";
  // 收合時清空欄位，避免使用者改回「否」後仍夾帶舊值送出
  if (!show) {
    block.querySelectorAll("input, select").forEach(el => {
      if (el.type === "text") el.value = "";
      else if (el.tagName === "SELECT") el.selectedIndex = 0;
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initSigPad();
  attachStudentIdHint();
});
