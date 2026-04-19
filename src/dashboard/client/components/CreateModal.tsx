import { useCallback, useEffect, useState } from "react";
import { createIssue, fetchMetadata, type MetadataResponse, triggerPoll } from "../lib/api.js";

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
  onAuthRequired: () => void;
}

export function CreateModal({ open, onClose, onAuthRequired }: CreateModalProps) {
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [provider, setProvider] = useState("");
  const [teamId, setTeamId] = useState("");
  const [critterType, setCritterType] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ identifier: string; url?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccess(null);
    setSubmitting(false);
    if (metadata) return;

    fetchMetadata()
      .then(setMetadata)
      .catch(() => setError("Failed to load metadata"));
  }, [open, metadata]);

  useEffect(() => {
    if (!metadata) return;
    const providers = Object.keys(metadata.providers);
    setProvider((p) => p || providers[0] || "");
    setCritterType((t) => t || metadata.critterTypes[0]?.name || "");
  }, [metadata]);

  useEffect(() => {
    if (!metadata || !provider) return;
    const teams = metadata.providers[provider]?.teams ?? [];
    setTeamId((t) => (teams.some((x) => x.id === t) ? t : teams[0]?.id ?? ""));
  }, [metadata, provider]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  if (!open || !metadata) {
    return open ? (
      <ModalShell onClose={handleClose}>
        {error ? <div className="error" style={{ display: "block" }}>{error}</div> : <p>Loading…</p>}
      </ModalShell>
    ) : null;
  }

  const providers = Object.keys(metadata.providers);
  const teams = metadata.providers[provider]?.teams ?? [];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    let finalDescription = description;
    let prefix = "";
    if (repo && !/^repo:\s/m.test(description)) prefix += `repo: ${repo}\n`;
    if (branch && !/^branch:\s/m.test(description)) prefix += `branch: ${branch}\n`;
    if (prefix) finalDescription = `${prefix}\n${description}`;

    try {
      const result = await createIssue({ provider, teamId, title, description: finalDescription, critterType });
      if (result.success && result.identifier) {
        setSuccess({ identifier: result.identifier, url: result.url });
        void triggerPoll().catch(() => {});
        setTimeout(handleClose, 4000);
      } else {
        setError(result.error ?? "Unknown error");
        setSubmitting(false);
      }
    } catch (err) {
      if (err instanceof Error && err.message === "Unauthorized") {
        onAuthRequired();
      } else {
        setError(err instanceof Error ? err.message : "Request failed");
      }
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={handleClose}>
        <h2>Create Critter Ticket</h2>
        {error && <div className="error" style={{ display: "block" }}>{error}</div>}
        {success && (
          <div className="success" style={{ display: "block" }}>
            Created {success.identifier}
            {success.url && <> — <a href={success.url} target="_blank" rel="noreferrer">View</a></>}
          </div>
        )}
        <form onSubmit={onSubmit}>
          {providers.length > 1 && (
            <div className="field">
              <label htmlFor="create-provider">Provider</label>
              <select id="create-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {providers.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="create-team">Team / Project</label>
            <select id="create-team" required value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.key})</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="create-type">Critter type</label>
            <select id="create-type" value={critterType} onChange={(e) => setCritterType(e.target.value)}>
              {metadata.critterTypes.map((ct) => (
                <option key={ct.name} value={ct.name}>
                  {ct.name} ({ct.triggerLabel})
                </option>
              ))}
            </select>
          </div>
          {metadata.repos.length > 0 && (
            <div className="field">
              <label htmlFor="create-repo">Repository</label>
              <select id="create-repo" value={repo} onChange={(e) => setRepo(e.target.value)}>
                <option value="">None (specify in description)</option>
                {metadata.repos.map((r) => <option key={r.url} value={r.url}>{r.label}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="create-branch">Base branch (optional)</label>
            <input
              id="create-branch"
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="e.g. dev, beta (defaults to repo default branch)"
            />
          </div>
          <div className="field">
            <label htmlFor="create-title">Title</label>
            <input
              id="create-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
            />
          </div>
          <div className="field">
            <label htmlFor="create-description">Description</label>
            <textarea
              id="create-description"
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Include repo: git@github.com:org/repo.git on its own line if no project mapping exists"
            />
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={handleClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
    </ModalShell>
  );
}

interface ModalShellProps {
  onClose: () => void;
  children: React.ReactNode;
}

function ModalShell({ onClose, children }: ModalShellProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss is a standard pattern; keyboard users get Escape.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismiss lives in parent component via the global keydown listener.
    <div
      className="modal-backdrop open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
