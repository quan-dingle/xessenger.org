const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const legacyForm = document.getElementById("legacy-form");
const statusBox = document.getElementById("status");
const heading = document.getElementById("heading");
const subheading = document.getElementById("subheading");
const loginTab = document.getElementById("login-tab");
const signupTab = document.getElementById("signup-tab");
const legacyToggle = document.getElementById("legacy-toggle");

function showStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className = "status " + (type || "");
}
function showView(view) {
  loginForm.classList.toggle("hidden", view !== "login");
  signupForm.classList.toggle("hidden", view !== "signup");
  legacyForm.classList.toggle("hidden", view !== "legacy");
  loginTab.classList.toggle("active", view === "login");
  signupTab.classList.toggle("active", view === "signup");
  loginTab.setAttribute("aria-selected", String(view === "login"));
  signupTab.setAttribute("aria-selected", String(view === "signup"));
  heading.textContent = view === "signup" ? "Make yourself at home." : view === "legacy" ? "Keep your old rooms." : "Welcome back.";
  subheading.textContent = view === "signup" ? "A username, an email, and one good password. That's it." : view === "legacy" ? "Link an older access token to a proper account." : "Sign in to pick up where your conversations left off.";
  legacyToggle.textContent = view === "legacy" ? "Back to sign in" : "Link an existing token";
  showStatus("");
}
loginTab.addEventListener("click", function(){showView("login");});
signupTab.addEventListener("click", function(){showView("signup");});
legacyToggle.addEventListener("click", function(){showView(legacyForm.classList.contains("hidden") ? "legacy" : "login");});

async function submitForm(form, endpoint, payload) {
  const button = form.querySelector('button[type="submit"]');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Working…";
  showStatus("");
  try {
    const response = await fetch(endpoint, {method:"POST", headers:{"Content-Type":"application/json"}, credentials:"same-origin", body:JSON.stringify(payload)});
    const data = await response.json().catch(function(){return {};});
    if (!response.ok) throw new Error(data.error || ("Request failed (" + response.status + ")"));
    showStatus("Signed in. Opening your conversations…", "success");
    const returnTo = sessionStorage.getItem("xessenger-return") || "/";
    sessionStorage.removeItem("xessenger-return");
    location.replace(returnTo);
  } catch (error) {
    showStatus(error.message || "Could not complete request.", "error");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
loginForm.addEventListener("submit", function(event){
  event.preventDefault();
  const data = new FormData(loginForm);
  submitForm(loginForm, "/api/auth/login", {identifier:data.get("identifier"), password:data.get("password")});
});
signupForm.addEventListener("submit", function(event){
  event.preventDefault();
  if (!signupForm.reportValidity()) return;
  const data = new FormData(signupForm);
  submitForm(signupForm, "/api/auth/signup", {username:data.get("username"), email:data.get("email"), password:data.get("password")});
});
legacyForm.addEventListener("submit", function(event){
  event.preventDefault();
  if (!legacyForm.reportValidity()) return;
  const data = new FormData(legacyForm);
  submitForm(legacyForm, "/api/auth/claim-legacy", {token:data.get("token"), email:data.get("email"), password:data.get("password")});
});
const incoming = new URLSearchParams(location.search);
if (incoming.has("join") && incoming.has("invite")) sessionStorage.setItem("xessenger-return", "/?join=" + encodeURIComponent(incoming.get("join")) + "&invite=" + encodeURIComponent(incoming.get("invite")));
if (incoming.has("legacy")) showView("legacy");
(async function(){
  try {
    const response = await fetch("/api/auth/session", {cache:"no-store"});
    const session = await response.json();
    if (session.authenticated) { const returnTo = sessionStorage.getItem("xessenger-return") || "/"; sessionStorage.removeItem("xessenger-return"); location.replace(returnTo); }
  } catch {}
})();
