/* ================================================================
   樹人家商 活動家長同意書 共用前端程式
   - 簽名板（滑鼠 / 觸控）
   - 表單送出：fetch POST 至 GAS Web App
   ================================================================ */

// 【部署後請填入你的 GAS Web App URL】
const GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycbwkNswb-wILdKn21cEq0mqLD9UxyMURxOROUeZJV2HSVYp33eslevNXszHsMe7LmhlU/exec";

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
  data.signature_image = sigCanvas.toDataURL("image/png");
  data.submit_time     = new Date().toISOString();

  btn.disabled = true;
  btn.textContent = "送出中…請稍候";

  try {
    await fetch(GAS_ENDPOINT, {
      method: "POST",
      mode:   "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data)
    });
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

document.addEventListener("DOMContentLoaded", initSigPad);
