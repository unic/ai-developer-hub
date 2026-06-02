/* Nothing redesign mockups — dark/light theme toggle.
   Dark is the default canvas. Choice persists across mockup pages via localStorage. */
(function () {
  var KEY = "nd-mock-theme";
  var root = document.documentElement;

  function apply(theme) {
    if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme"); // dark = absence of attribute
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    document.querySelectorAll(".theme-toggle button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.theme === theme);
    });
  }

  // restore before paint
  var saved = "dark";
  try { saved = localStorage.getItem(KEY) || "dark"; } catch (e) {}
  apply(saved);

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".theme-toggle button");
    if (btn) apply(btn.dataset.theme);
  });

  // re-sync toggle button state once DOM is ready (script may load in <head>)
  document.addEventListener("DOMContentLoaded", function () {
    var current = root.getAttribute("data-theme") === "light" ? "light" : "dark";
    apply(current);
  });
})();
