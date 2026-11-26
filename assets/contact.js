// お問い合わせフォーム：入力チェックと送信（送信先は Google Apps Script のウェブアプリ）
//
// 人には見えない自動送信対策（判定はすべてサーバー側の contact.gs でも行う）
//  1. 見えない入力欄（website）に何か入っていたら自動送信
//  2. ページを開いてから送信までが早すぎたら自動送信
//  3. キー入力やタップが一度もなければ自動送信
//  4. 送信のたびに、ブラウザで小さな計算（SHA-256 の計算くじ）を解かせる。
//     人には一瞬で気づかないが、大量送信には手間がかかる
(function () {
  "use strict";
  const form = document.getElementById("contact-form");
  if (!form) return;

  const startedAt = performance.now();
  let interactions = 0;
  ["keydown", "pointerdown", "input"].forEach(function (ev) {
    form.addEventListener(ev, function () { interactions++; }, { passive: true });
  });

  // ?type=intern などで種別を最初から選んでおく
  const preset = new URLSearchParams(location.search).get("type");
  if (preset) {
    const radio = form.querySelector('input[name="type"][data-key="' + CSS.escape(preset) + '"]');
    if (radio) radio.checked = true;
  }

  const errorBox = form.querySelector(".form-error");
  const button = form.querySelector(".btn-submit");
  const done = document.querySelector(".form-done");

  function showError(message, field) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    if (field) field.focus();
  }

  function validate() {
    const f = form.elements;
    if (!f.company.value.trim()) return ["会社名・学校名を入力してください。", f.company];
    if (!f.name.value.trim()) return ["お名前を入力してください。", f.name];
    const email = f.email.value.trim();
    if (!email) return ["メールアドレスを入力してください。", f.email];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ["メールアドレスの形式が正しくありません。", f.email];
    if (!form.querySelector('input[name="type"]:checked')) return ["お問い合わせ種別を選んでください。", form.querySelector('input[name="type"]')];
    return null;
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  // 先頭が "000" になる nonce を探す（平均 4,096 回、通常 1 秒未満）
  async function solve(ts, email) {
    for (let nonce = 0; nonce < 2000000; nonce++) {
      if ((await sha256Hex(ts + "|" + email + "|" + nonce)).startsWith("000")) return nonce;
    }
    return -1;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    const problem = validate();
    if (problem) { showError(problem[0], problem[1]); return; }

    const endpoint = form.dataset.endpoint;
    if (!endpoint) {
      showError("現在フォームの準備中です。しばらくしてから、もう一度お試しください。");
      return;
    }

    button.disabled = true;
    button.textContent = "送信中…";
    const f = form.elements;
    const email = f.email.value.trim();
    const ts = Date.now();
    try {
      const payload = {
        company: f.company.value.trim(),
        name: f.name.value.trim(),
        email: email,
        type: form.querySelector('input[name="type"]:checked').value,
        message: f.message.value.trim(),
        website: f.website.value,
        elapsed: Math.round(performance.now() - startedAt),
        interactions: interactions,
        ts: ts,
        nonce: await solve(ts, email),
        page: location.href
      };
      // Content-Type を付けない（text/plain）ことで、Apps Script へ直接送れる
      const res = await fetch(endpoint, { method: "POST", body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "送信に失敗しました。");
      form.hidden = true;
      done.hidden = false;
      done.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      showError("送信できませんでした。時間をおいて、もう一度お試しください。");
      button.disabled = false;
      button.textContent = "送信する";
    }
  });
})();
