import { useEffect, useMemo, useRef, useState } from "react";

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    const existing = document.querySelector('script[data-google-identity="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity script")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity script"));
    document.head.appendChild(script);
  });
}

export default function AuthScreen({
  googleClientId,
  authError,
  onLogin,
  onRegister,
  onGoogleLogin,
}) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");
  const googleButtonRef = useRef(null);

  const activeError = localError || authError || "";
  const submitLabel = mode === "login" ? "Access Mission Control" : "Create Operator Account";

  const canSubmit = useMemo(() => {
    if (!form.email.trim() || !form.password.trim()) return false;
    if (mode === "register" && !form.name.trim()) return false;
    return true;
  }, [form, mode]);

  useEffect(() => {
    let cancelled = false;

    async function setupGoogle() {
      if (!googleClientId || !googleButtonRef.current) return;

      try {
        await loadGoogleScript();
        if (cancelled || !window.google?.accounts?.id) return;

        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response) => {
            if (!response.credential) return;
            setLocalError("");
            setSubmitting(true);
            try {
              await onGoogleLogin(response.credential);
            } catch (error) {
              setLocalError(error.message);
            } finally {
              setSubmitting(false);
            }
          },
        });

        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "pill",
          width: 320,
        });
      } catch (error) {
        if (!cancelled) {
          setLocalError(error.message);
        }
      }
    }

    setupGoogle();

    return () => {
      cancelled = true;
    };
  }, [googleClientId, onGoogleLogin]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setLocalError("");

    try {
      if (mode === "login") {
        await onLogin({
          email: form.email.trim(),
          password: form.password,
        });
      } else {
        await onRegister({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
        });
      }
    } catch (error) {
      setLocalError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-grid">
        <section className="auth-copy">
          <p className="auth-pre">SECURED OPERATOR ACCESS</p>
          <h1 className="auth-title">
            Authenticate.<br />
            Then deploy.
          </h1>
          <p className="auth-desc">
            Mission Control now requires operator identity before anyone can launch,
            resume, or inspect an AI build pipeline.
          </p>
          <div className="auth-features">
            <div className="auth-feature">JWT-backed httpOnly cookie session</div>
            <div className="auth-feature">Protected REST and WebSocket access</div>
            <div className="auth-feature">Google sign-in support for fast onboarding</div>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-tabs">
            <button
              className={`auth-tab ${mode === "login" ? "auth-tab--active" : ""}`}
              onClick={() => setMode("login")}
              type="button"
            >
              Login
            </button>
            <button
              className={`auth-tab ${mode === "register" ? "auth-tab--active" : ""}`}
              onClick={() => setMode("register")}
              type="button"
            >
              Register
            </button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === "register" && (
              <label className="auth-field">
                <span>Name</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Operator name"
                  autoComplete="name"
                />
              </label>
            )}

            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="operator@mission.dev"
                autoComplete="email"
              />
            </label>

            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Minimum 8 characters"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>

            {activeError && <div className="auth-error">{activeError}</div>}

            <button className="btn btn-accent auth-submit" type="submit" disabled={!canSubmit || submitting}>
              {submitting ? "Authorizing..." : submitLabel}
            </button>
          </form>

          <div className="auth-divider">
            <span>or</span>
          </div>

          {googleClientId ? (
            <div className="google-button-slot" ref={googleButtonRef} />
          ) : (
            <div className="auth-muted">
              Google sign-in is not configured yet. Add `GOOGLE_CLIENT_ID` on the server to enable it.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
