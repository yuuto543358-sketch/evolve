// 起動のときに、いちばん最初に動く小さなプログラム（モジュールではなく、ふつうのスクリプト）
// ・安全のためと、更新のためだけの、ごく短い内容です

// 1) 他のサイトの中に埋め込まれて表示されたときは、何も表示しない（クリックを乗っ取られないようにするため）
try {
  if (window.top !== window.self) document.documentElement.style.display = 'none';
} catch (e) {
  document.documentElement.style.display = 'none';
}

// 2) 開いてから少したったら、新しいバージョンがないか探す
//    （アプリの中のプログラムが古いままでも、開き直せば新しい版に気づけるようにするため）
if ('serviceWorker' in navigator) {
  setTimeout(function () {
    navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update(); }).catch(function () {});
  }, 3000);
}
