import { useEffect, useState } from "react";
import { Eye, EyeOff, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export default function LoginPage({ onNavigate }) {
  const { login, token, isLoading } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [fieldErr, setFieldErr] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && token && onNavigate) {
      onNavigate('dashboard');
    }
  }, [token, isLoading, onNavigate]);

  function validate() {
    const e = {};
    if (!username.trim()) e.username = "Username is required";
    if (!password) e.password = "Password is required";
    setFieldErr(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    setError("");

    if (!validate()) return false;

    setSubmitting(true);
    try {
      const result = await login({ username: username.trim(), password });
      if (result.success) {
        if (onNavigate) {
          onNavigate('dashboard');
        }
      } else {
        setError(result.error || "Login failed");
      }
    } catch (err) {
      setError(
          err.userMessage ? err.userMessage
          : err.message ? err.message
          : "Unexpected error. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
    return false;
  }

  if (isLoading) {
    return (
      <div style={styles.loader}>
        <Loader2 size={26} className="spin" />
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes shine {
          0% { left: -100%; }
          20% { left: 100%; }
          100% { left: 100%; }
        }
      `}</style>
      <div style={styles.container}>
        {/* LEFT ORANGE PANEL */}
      <div style={styles.leftPanel}>
        <div>
          <img
            src="/IFS Logo.svg"
            alt="logo"
            style={{ width: 180, marginBottom: 40 }}
          />
        </div>

        <div style={{ marginTop: "auto", marginBottom: "auto" }}>
          <h2 style={styles.heading}>
            Generator Fuel<br />Management<br />System
          </h2>

          <p style={styles.subtext}>
            Live performance tracking, fuel analytics,<br />
            and intelligent alerting for your generators.
          </p>

          <div style={{ marginTop: 25 }}>
            {[
              "Real-time power tracking",
              "AI-driven fuel insights",
              "Scalable generator management",
              "Instant reporting",
            ].map((f) => (
              <div key={f} style={styles.featureRow}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginTop: 2, flexShrink: 0 }}>
                  <path d="M7 0C3.134 0 0 3.134 0 7C0 10.866 3.134 14 7 14C10.866 14 14 10.866 14 7C14 3.134 10.866 0 7 0ZM5.5 10.5L2.5 7.5L3.4 6.6L5.5 8.7L10.6 3.6L11.5 4.5L5.5 10.5Z" fill="white"/>
                </svg>
                <span style={{ fontSize: 13, opacity: 0.9 }}>{f}</span>
              </div>
            ))}
          </div>
        </div>

        <p style={styles.footer}>
          © 2026 iTecknologi · All rights reserved
        </p>
      </div>

      {/* MIDDLE COLUMN - Background Image with Login Form Overlay */}
      <div style={styles.middlePanel}>
        <img
          src="/generaorloginpagepic.png"
          alt=""
          style={styles.bgImage}
        />
        <div style={styles.overlay}></div>
        
        <div style={styles.taglineContainer}>
          <p style={styles.taglineLabel}>FLEET INTELLIGENCE PLATFORM</p>
          <h3 style={styles.tagline}>Monitor. Analyze.<br />Optimize.</h3>
        </div>

        {/* LOGIN FORM OVERLAY */}
        <div style={styles.loginOverlay}>
          <div style={styles.cardWrapper}>
            <div style={styles.card}>
              <div style={styles.cardShine}></div>
              <div style={{ textAlign: "center", marginBottom: 25 }}>
              <img
                src="/IFS Logo.svg"
                alt="logo"
                style={{ width: 140, marginBottom: 20 }}
              />
              <h1 style={{ color: "#fff", fontSize: 24, fontWeight: "600", margin: 0 }}>Welcome back</h1>
                            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 8 }}>Sign in to your iTecknologi account</p>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              {error && (
                <div style={styles.error}>
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              <label style={styles.label}>Username</label>
              <input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={styles.input}
              />
              {fieldErr.username && (
                <p style={styles.errText}>{fieldErr.username}</p>
              )}

              <label style={{ ...styles.label, marginTop: 16 }}>Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPass ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={styles.input}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  style={styles.eye}
                >
                  {showPass ? <EyeOff size={16} color="rgba(255,255,255,0.5)" /> : <Eye size={16} color="rgba(255,255,255,0.5)" />}
                </button>
              </div>

              {fieldErr.password && (
                <p style={styles.errText}>{fieldErr.password}</p>
              )}

              <button type="submit" style={styles.button}>
                {submitting ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <>
                    Sign in <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
            
                          <p style={{ textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 20 }}>
                iTecknologi · Secure Authentication
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

/* ================= STYLES ================= */

const styles = {
  container: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
  },

  leftPanel: {
    width: 340,
    background: "#ea580c",
    color: "#fff",
    padding: "40px 35px",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
  },

  heading: {
    fontSize: 42,
    fontWeight: "700",
    lineHeight: 1.1,
    margin: 0,
  },

  subtext: {
    fontSize: 13,
    opacity: 0.85,
    lineHeight: 1.6,
    marginTop: 15,
  },

  featureRow: {
    display: "flex",
    gap: 10,
    marginBottom: 10,
    alignItems: "flex-start",
  },

  footer: {
    fontSize: 11,
    opacity: 0.6,
    marginTop: "auto",
  },

  middlePanel: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },

  bgImage: {
    position: "absolute",
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },

  overlay: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(to right, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.7) 100%)",
  },

  taglineContainer: {
    position: "absolute",
    bottom: 60,
    left: 40,
    zIndex: 2,
    color: "#fff",
  },

  taglineLabel: {
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    opacity: 0.7,
    margin: 0,
    marginBottom: 10,
  },

  tagline: {
    fontSize: 28,
    fontWeight: "600",
    lineHeight: 1.3,
    margin: 0,
  },

  loginOverlay: {
    position: "absolute",
    right: 60,
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 10,
  },

  cardWrapper: {
    position: "relative",
    borderRadius: 24,
    padding: "1px",
    background: "linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.15) 100%)",
    boxShadow: "0 25px 50px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.08)",
  },

  card: {
    width: 360,
    padding: "40px 35px",
    borderRadius: 24,
    background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
    border: "1px solid rgba(255,255,255,0.12)",
    backdropFilter: "blur(60px) saturate(180%)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(255,255,255,0.03)",
    position: "relative",
    overflow: "hidden",
  },

  cardShine: {
    position: "absolute",
    top: 0,
    left: "-100%",
    width: "100%",
    height: "100%",
    background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)",
    animation: "shine 8s infinite",
    pointerEvents: "none",
  },

  label: {
    display: "block",
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 8,
  },

  input: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    fontSize: 14,
    outline: "none",
    transition: "all 0.2s ease",
    boxSizing: "border-box",
  },

  button: {
    width: "100%",
    marginTop: 24,
    padding: "14px 12px",
    background: "linear-gradient(135deg, rgba(249, 115, 22, 0.7) 0%, rgba(234, 88, 12, 0.6) 100%)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 12,
    cursor: "pointer",
    fontSize: 15,
    fontWeight: "600",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    transition: "all 0.2s ease",
    boxShadow: "0 4px 20px rgba(234, 88, 12, 0.3)",
    backdropFilter: "blur(10px)",
  },

  error: {
    background: "rgba(249, 115, 22, 0.08)",
    color: "#fdba74",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    border: "1px solid rgba(249, 115, 22, 0.2)",
    backdropFilter: "blur(10px)",
  },

  errText: {
    color: "#fdba74",
    fontSize: 12,
    margin: "4px 0 0 0",
  },

  eye: {
    position: "absolute",
    right: 12,
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  loader: {
    height: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
};