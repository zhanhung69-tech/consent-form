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
  // 學號：6 位數字
  if (!/^\d{6}$/.test(String(data.student_id || "").trim())) {
    return { ok: false, err: "學號格式錯誤：請填寫 6 位數字（例：314020）。" };
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
    return { ok: false, err: "班級欄位請填寫完整（例：商二忠）。" };
  }
  // 班級科別與學號是否一致（學號→科年級）
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
    return false;
  }
  if (!document.getElementById("agreeCheck").checked) {
    msg.className = "msg err";
    msg.textContent = "請勾選下方確認同意欄位。";
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
  data.class = v.normalizedClass;  // 寫入正規化後的班級

  data.signature_image = sigCanvas.toDataURL("image/png");
  data.submit_time     = new Date().toISOString();

  btn.disabled = true;
  btn.textContent = "送出中…請稍候";

  try {
    // 改用 cors 模式才能讀取後端回傳的錯誤訊息（重複/班級不符等）
    const resp = await fetch(GAS_ENDPOINT, {
      method: "POST",
      mode:   "cors",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },  // text/plain 不會觸發 CORS preflight
      body: JSON.stringify(data)
    });
    let result = { ok: true };
    try { result = await resp.json(); } catch (_) { /* 若解析失敗則視為成功 */ }

    if (result.ok === false) {
      msg.className = "msg err";
      msg.textContent = "✗ " + (result.message || "送出被伺服器拒絕，請確認資料後重試。");
      btn.disabled = false;
      btn.textContent = "送出簽核";
      window.scrollTo({ top: 0, behavior: "smooth" });
      return false;
    }
    msg.className = "msg ok";
    msg.innerHTML = "✓ 簽核完成，感謝您的配合！<br><span style='font-size:13px;font-weight:400'>本頁可直接關閉。</span>";
    btn.textContent = "✓ 已送出";
    form.querySelectorAll("input, textarea, select, button").forEach(el => el.disabled = true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = "送出失敗：" + err.message + "，請稍後再試或聯絡學務處 02-2681-6658。";
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

document.addEventListener("DOMContentLoaded", () => {
  initSigPad();
  attachStudentIdHint();
});
