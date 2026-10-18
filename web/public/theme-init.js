// Miroven theme & language initializer — runs before first paint to prevent FOUC.
// This file is loaded as a blocking external script. Next.js bootstrap scripts
// are permitted separately with build-specific CSP hashes.
try {
  var theme = localStorage.getItem("miroven-theme");
  if (theme === "light" || theme === "dim" || theme === "dark" || theme === "high-contrast") {
    document.documentElement.dataset.theme = theme;
  } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.dataset.theme = "dark";
  } else {
    document.documentElement.dataset.theme = "light";
  }

  var fontScale = localStorage.getItem("miroven-font-scale");
  if (fontScale === "normal" || fontScale === "large" || fontScale === "xlarge") {
    document.documentElement.dataset.fontScale = fontScale;
  } else {
    document.documentElement.dataset.fontScale = "normal";
  }

  var language = localStorage.getItem("miroven-language");
  if (language === "ko" || language === "en") {
    document.documentElement.lang = language;
  } else {
    var userLang = (navigator.language || "").toLowerCase();
    document.documentElement.lang = userLang.startsWith("ko") ? "ko" : "en";
  }
} catch {}
