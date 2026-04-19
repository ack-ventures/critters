import { useState } from "react";

interface AuthPromptProps {
  onSaved: () => void;
}

export function AuthPrompt({ onSaved }: AuthPromptProps) {
  const [token, setToken] = useState("");

  function save() {
    const trimmed = token.trim();
    if (!trimmed) return;
    localStorage.setItem("critters-token", trimmed);
    onSaved();
  }

  return (
    <div className="auth-prompt">
      <span style={{ color: "var(--fg-3)" }}>Dashboard token required:</span>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Enter token"
      />
      <button type="button" className="btn" onClick={save}>Save</button>
    </div>
  );
}
