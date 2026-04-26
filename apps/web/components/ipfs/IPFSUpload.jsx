import { useState, useCallback, useRef, useEffect } from "react";

const MOCK_GATEWAY = "https://ipfs.io/ipfs/";

function generateCID() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return "Qm" + Array.from({ length: 44 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getFileType(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  const map = {
    pdf: { label: "PDF", color: "#f87171" },
    png: { label: "PNG", color: "#60a5fa" },
    jpg: { label: "JPG", color: "#60a5fa" },
    jpeg: { label: "JPG", color: "#60a5fa" },
    mp4: { label: "MP4", color: "#c084fc" },
    zip: { label: "ZIP", color: "#fb923c" },
    json: { label: "JSON", color: "#34d399" },
    md: { label: "MD", color: "#a3e635" },
    sol: { label: "SOL", color: "#818cf8" },
    rs: { label: "RS", color: "#fb923c" },
    ts: { label: "TS", color: "#60a5fa" },
    js: { label: "JS", color: "#fbbf24" },
  };
  return map[ext] || { label: (ext || "FILE").toUpperCase().slice(0, 4), color: "#94a3b8" };
}

function validateFile(file) {
  const errors = [];
  if (file.size > 100 * 1024 * 1024) errors.push("File exceeds 100MB limit");
  const blocked = ["exe", "bat", "sh", "cmd"];
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (blocked.includes(ext)) errors.push("File type not permitted");
  return errors;
}

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Syne:wght@400;500;600;700;800&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  .ipfs-root {
    min-height: 100vh;
    background: #09090b;
    background-image: 
      radial-gradient(ellipse 60% 40% at 70% 10%, rgba(16,185,129,0.07) 0%, transparent 60%),
      radial-gradient(ellipse 40% 30% at 10% 80%, rgba(245,158,11,0.05) 0%, transparent 60%);
    font-family: 'Syne', sans-serif;
    color: #e4e4e7;
    padding: 24px;
  }

  .mono { font-family: 'IBM Plex Mono', monospace; }

  .glass {
    background: rgba(24,24,27,0.7);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(63,63,70,0.5);
    border-radius: 12px;
  }

  .glass-sm {
    background: rgba(39,39,42,0.6);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(63,63,70,0.4);
    border-radius: 8px;
  }

  .drop-zone {
    border: 1.5px dashed rgba(63,63,70,0.7);
    border-radius: 16px;
    transition: all 0.15s ease;
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }
  .drop-zone::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at center, rgba(16,185,129,0.03) 0%, transparent 70%);
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .drop-zone:hover::before, .drop-zone.drag-over::before { opacity: 1; }
  .drop-zone:hover, .drop-zone.drag-over {
    border-color: rgba(16,185,129,0.5);
    background: rgba(16,185,129,0.03);
  }
  .drop-zone.drag-over { border-color: #10b981; box-shadow: 0 0 0 1px rgba(16,185,129,0.2); }

  .btn-primary {
    background: linear-gradient(135deg, #10b981, #059669);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 10px 20px;
    font-family: 'Syne', sans-serif;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
    letter-spacing: 0.02em;
  }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(16,185,129,0.25); }
  .btn-primary:active { transform: translateY(0); }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }

  .btn-ghost {
    background: transparent;
    color: #a1a1aa;
    border: 1px solid rgba(63,63,70,0.6);
    border-radius: 8px;
    padding: 8px 16px;
    font-family: 'Syne', sans-serif;
    font-weight: 500;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-ghost:hover { color: #e4e4e7; border-color: rgba(113,113,122,0.8); background: rgba(39,39,42,0.5); }

  .btn-icon {
    background: rgba(39,39,42,0.6);
    border: 1px solid rgba(63,63,70,0.5);
    border-radius: 6px;
    padding: 5px 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    color: #71717a;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .btn-icon:hover { color: #e4e4e7; border-color: rgba(113,113,122,0.7); background: rgba(63,63,70,0.4); }
  .btn-icon.copied { color: #10b981; border-color: rgba(16,185,129,0.4); }

  .progress-track {
    background: rgba(39,39,42,0.8);
    border-radius: 99px;
    height: 3px;
    overflow: hidden;
  }
  .progress-bar {
    height: 100%;
    border-radius: 99px;
    transition: width 0.3s ease;
    background: linear-gradient(90deg, #10b981, #34d399);
    position: relative;
  }
  .progress-bar.uploading::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
    animation: shimmer 1s infinite;
  }
  @keyframes shimmer { from { transform: translateX(-100%); } to { transform: translateX(300%); } }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    font-family: 'IBM Plex Mono', monospace;
  }
  .badge-success { background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.2); }
  .badge-pending { background: rgba(245,158,11,0.12); color: #f59e0b; border: 1px solid rgba(245,158,11,0.2); }
  .badge-error   { background: rgba(239,68,68,0.12);  color: #ef4444; border: 1px solid rgba(239,68,68,0.2); }
  .badge-info    { background: rgba(99,102,241,0.12); color: #818cf8; border: 1px solid rgba(99,102,241,0.2); }

  .stat-dot {
    width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0;
  }
  .dot-success { background: #10b981; box-shadow: 0 0 6px rgba(16,185,129,0.6); }
  .dot-pending { background: #f59e0b; box-shadow: 0 0 6px rgba(245,158,11,0.6); animation: pulse-amber 1.5s infinite; }
  .dot-error   { background: #ef4444; }
  .dot-idle    { background: #52525b; }
  @keyframes pulse-amber { 0%,100%{ box-shadow: 0 0 6px rgba(245,158,11,0.6); } 50%{ box-shadow: 0 0 12px rgba(245,158,11,0.9); } }

  .file-row {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid rgba(63,63,70,0.35);
    background: rgba(24,24,27,0.5);
    transition: all 0.15s ease;
  }
  .file-row:hover { border-color: rgba(63,63,70,0.6); background: rgba(39,39,42,0.5); }

  .cid-chip {
    background: rgba(15,15,15,0.8);
    border: 1px solid rgba(63,63,70,0.5);
    border-radius: 6px;
    padding: 4px 10px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10.5px;
    color: #6366f1;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
    display: block;
  }

  .header-tag {
    display: flex; align-items: center; gap: 6px;
    background: rgba(16,185,129,0.08);
    border: 1px solid rgba(16,185,129,0.2);
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 11px;
    color: #10b981;
    font-weight: 600;
    letter-spacing: 0.06em;
  }

  .sidebar-stat {
    display: flex; flex-direction: column; gap: 4px;
    padding: 12px 16px;
    border-radius: 10px;
    background: rgba(24,24,27,0.6);
    border: 1px solid rgba(63,63,70,0.3);
  }

  .upload-icon-ring {
    width: 64px; height: 64px; border-radius: 50%;
    border: 1.5px dashed rgba(16,185,129,0.3);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 16px;
    transition: all 0.15s ease;
    background: rgba(16,185,129,0.05);
  }
  .drop-zone:hover .upload-icon-ring, .drop-zone.drag-over .upload-icon-ring {
    border-color: rgba(16,185,129,0.7);
    background: rgba(16,185,129,0.1);
  }

  .link-pill {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10.5px;
    color: #6366f1;
    font-family: 'IBM Plex Mono', monospace;
    text-decoration: none;
    transition: color 0.15s;
    cursor: pointer;
  }
  .link-pill:hover { color: #818cf8; }

  .divider { height: 1px; background: rgba(63,63,70,0.4); margin: 4px 0; }

  .scroll-area { max-height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .scroll-area::-webkit-scrollbar { width: 4px; }
  .scroll-area::-webkit-scrollbar-track { background: transparent; }
  .scroll-area::-webkit-scrollbar-thumb { background: rgba(63,63,70,0.5); border-radius: 2px; }

  .validation-err {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(239,68,68,0.08);
    border: 1px solid rgba(239,68,68,0.2);
    font-size: 12px;
    color: #f87171;
    font-family: 'IBM Plex Mono', monospace;
  }

  .tabs { display: flex; gap: 2px; background: rgba(24,24,27,0.8); border-radius: 10px; padding: 4px; }
  .tab {
    flex: 1; padding: 8px; border-radius: 8px; border: none; background: transparent;
    font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 500;
    color: #71717a; cursor: pointer; transition: all 0.15s ease;
  }
  .tab.active { background: rgba(39,39,42,0.9); color: #e4e4e7; box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
  .tab:hover:not(.active) { color: #a1a1aa; }

  input[type=text], input[type=url] {
    background: rgba(24,24,27,0.8);
    border: 1px solid rgba(63,63,70,0.6);
    border-radius: 8px;
    padding: 10px 14px;
    color: #e4e4e7;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12.5px;
    width: 100%;
    outline: none;
    transition: border-color 0.15s ease;
  }
  input[type=text]:focus, input[type=url]:focus { border-color: rgba(16,185,129,0.4); box-shadow: 0 0 0 3px rgba(16,185,129,0.06); }
  input::placeholder { color: #52525b; }
`;

function FileTypeTag({ name }) {
  const ft = getFileType(name);
  return (
    <div style={{
      background: `${ft.color}18`, border: `1px solid ${ft.color}35`,
      borderRadius: 6, padding: "2px 7px",
      fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 500,
      color: ft.color, flexShrink: 0, letterSpacing: "0.04em"
    }}>
      {ft.label}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className={`btn-icon${copied ? " copied" : ""}`} onClick={copy}>
      {copied ? "✓ COPIED" : "COPY"}
    </button>
  );
}

function UploadRow({ item, onRemove }) {
  const isUploading = item.status === "uploading";
  const isSuccess = item.status === "success";
  const isError = item.status === "error";

  return (
    <div className="file-row">
      <FileTypeTag name={item.file.name} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: isUploading ? 6 : 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e4e4e7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.file.name}
          </span>
          <span style={{ fontSize: 10.5, color: "#71717a", flexShrink: 0, fontFamily: "'IBM Plex Mono', monospace" }}>
            {formatBytes(item.file.size)}
          </span>
        </div>
        {isUploading && (
          <div>
            <div className="progress-track">
              <div className="progress-bar uploading" style={{ width: `${item.progress}%` }} />
            </div>
            <div style={{ fontSize: 10, color: "#71717a", marginTop: 3, fontFamily: "'IBM Plex Mono', monospace" }}>
              Pinning to IPFS node… {item.progress}%
            </div>
          </div>
        )}
        {isSuccess && item.cid && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <span className="cid-chip">{item.cid}</span>
          </div>
        )}
        {isError && (
          <div style={{ fontSize: 11, color: "#f87171", fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 }}>
            Upload failed — retry
          </div>
        )}
        {item.validationErrors?.length > 0 && (
          <div style={{ fontSize: 11, color: "#f87171", fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 }}>
            {item.validationErrors[0]}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {isSuccess && (
          <>
            <span className="badge badge-success"><span className="stat-dot dot-success" />PINNED</span>
            <CopyButton text={item.cid} />
          </>
        )}
        {isUploading && <span className="badge badge-pending"><span className="stat-dot dot-pending" />UPLOADING</span>}
        {isError && <span className="badge badge-error">FAILED</span>}
        {item.status === "queued" && <span className="badge badge-info">QUEUED</span>}
        {item.validationErrors?.length > 0 && <span className="badge badge-error">INVALID</span>}
        <button className="btn-icon" onClick={() => onRemove(item.id)} style={{ padding: "5px 7px", fontSize: 13, color: "#52525b" }}>✕</button>
      </div>
    </div>
  );
}

function PinnedFileRow({ item }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${MOCK_GATEWAY}${item.cid}`); } catch { }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="file-row">
      <FileTypeTag name={item.file.name} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e4e4e7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>
          {item.file.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="cid-chip" style={{ maxWidth: 180 }}>{item.cid}</span>
          <span className="link-pill" onClick={copy}>
            {copied ? "✓ Copied link" : "⬡ IPFS link"}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <span className="badge badge-success"><span className="stat-dot dot-success" />PINNED</span>
        <span style={{ fontSize: 10, color: "#52525b", fontFamily: "'IBM Plex Mono', monospace" }}>
          {formatBytes(item.file.size)}
        </span>
      </div>
    </div>
  );
}

export default function IPFSUpload() {
  const [files, setFiles] = useState([]);
  const [pinned, setPinned] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [tab, setTab] = useState("upload");
  const [cidInput, setCidInput] = useState("");
  const [cidResult, setCidResult] = useState(null);
  const [resolving, setResolving] = useState(false);
  const fileInputRef = useRef();
  const uploadingRef = useRef(false);

  const addFiles = useCallback((rawFiles) => {
    const items = Array.from(rawFiles).map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      status: "queued",
      progress: 0,
      cid: null,
      validationErrors: validateFile(file),
    }));
    setFiles((prev) => [...prev, ...items]);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const uploadAll = useCallback(async () => {
    if (uploadingRef.current) return;
    const toUpload = files.filter((f) => f.status === "queued" && !f.validationErrors?.length);
    if (!toUpload.length) return;
    uploadingRef.current = true;

    for (const item of toUpload) {
      setFiles((prev) => prev.map((f) => f.id === item.id ? { ...f, status: "uploading" } : f));
      for (let p = 0; p <= 100; p += Math.floor(Math.random() * 15 + 8)) {
        await new Promise((r) => setTimeout(r, 80 + Math.random() * 60));
        const clamped = Math.min(p, 99);
        setFiles((prev) => prev.map((f) => f.id === item.id ? { ...f, progress: clamped } : f));
      }
      await new Promise((r) => setTimeout(r, 200));
      const success = Math.random() > 0.1;
      const cid = generateCID();
      setFiles((prev) => prev.map((f) =>
        f.id === item.id ? { ...f, status: success ? "success" : "error", progress: 100, cid: success ? cid : null } : f
      ));
      if (success) {
        setPinned((prev) => [...prev, { ...item, cid, status: "success" }]);
      }
    }
    uploadingRef.current = false;
  }, [files]);

  const resolveCID = async () => {
    if (!cidInput.trim()) return;
    setResolving(true);
    setCidResult(null);
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 600));
    const valid = cidInput.startsWith("Qm") || cidInput.startsWith("bafk") || cidInput.startsWith("bafy");
    setCidResult(valid
      ? { ok: true, cid: cidInput.trim(), size: Math.floor(Math.random() * 5000000), type: "file", nodes: Math.floor(Math.random() * 8 + 2) }
      : { ok: false }
    );
    setResolving(false);
  };

  const pendingCount = files.filter((f) => f.status === "queued" && !f.validationErrors?.length).length;
  const uploadingCount = files.filter((f) => f.status === "uploading").length;
  const successCount = files.filter((f) => f.status === "success").length;
  const totalSize = files.reduce((a, f) => a + f.file.size, 0);

  return (
    <>
      <style>{styles}</style>
      <div className="ipfs-root">
        <div style={{ maxWidth: 980, margin: "0 auto" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: "linear-gradient(135deg, #10b981, #059669)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, boxShadow: "0 0 20px rgba(16,185,129,0.25)"
              }}>⬡</div>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f4f4f5", letterSpacing: "-0.02em", lineHeight: 1 }}>
                  IPFS Upload
                </h1>
                <p style={{ fontSize: 12, color: "#71717a", marginTop: 3, fontFamily: "'IBM Plex Mono', monospace" }}>
                  lance / deliverables / pinning
                </p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="header-tag">
                <span className="stat-dot dot-success" style={{ width: 5, height: 5 }} /> IPFS NODE ONLINE
              </div>
              <div className="badge badge-info" style={{ padding: "5px 12px" }}>
                Kubo v0.28.0
              </div>
            </div>
          </div>

          {/* Layout */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, alignItems: "start" }}>

            {/* Main Panel */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Tabs */}
              <div className="tabs">
                {[["upload", "⬆ Upload Files"], ["pinned", `⬡ Pinned (${pinned.length})`], ["resolve", "⌕ Resolve CID"]].map(([key, label]) => (
                  <button key={key} className={`tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Upload Tab */}
              {tab === "upload" && (
                <div className="glass" style={{ padding: 24 }}>

                  {/* Drop Zone */}
                  <div
                    className={`drop-zone${dragOver ? " drag-over" : ""}`}
                    style={{ padding: "40px 24px", textAlign: "center", marginBottom: 20 }}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => addFiles(e.target.files)}
                    />
                    <div className="upload-icon-ring">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 16V4m0 0-3 3m3-3 3 3" />
                        <path d="M20 16.7A4 4 0 0 0 16 9h-.5A7 7 0 1 0 4 15.7" />
                      </svg>
                    </div>
                    <p style={{ fontSize: 15, fontWeight: 700, color: "#e4e4e7", marginBottom: 6 }}>
                      Drop files to pin on IPFS
                    </p>
                    <p style={{ fontSize: 12, color: "#71717a", lineHeight: 1.6 }}>
                      Drag & drop or click to browse · Max 100MB per file<br />
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#52525b", fontSize: 11 }}>
                        All file types accepted (except .exe .bat .sh .cmd)
                      </span>
                    </p>
                  </div>

                  {/* File Queue */}
                  {files.length > 0 && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <span style={{ fontSize: 12, color: "#a1a1aa", fontWeight: 600, letterSpacing: "0.06em" }}>
                          UPLOAD QUEUE ({files.length})
                        </span>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="btn-ghost" onClick={() => setFiles([])}>Clear all</button>
                          <button
                            className="btn-primary"
                            onClick={uploadAll}
                            disabled={!pendingCount || uploadingCount > 0}
                          >
                            {uploadingCount > 0 ? `Uploading…` : `Pin ${pendingCount} file${pendingCount !== 1 ? "s" : ""}`}
                          </button>
                        </div>
                      </div>
                      <div className="scroll-area">
                        {files.map((item) => (
                          <UploadRow key={item.id} item={item} onRemove={removeFile} />
                        ))}
                      </div>
                    </>
                  )}

                  {files.length === 0 && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                      {["contract.sol", "deliverable.pdf", "metadata.json", "screenshot.png"].map((f) => (
                        <div key={f} className="glass-sm" style={{ padding: "5px 12px", fontSize: 11, color: "#71717a", fontFamily: "'IBM Plex Mono', monospace", cursor: "default" }}>
                          {f}
                        </div>
                      ))}
                      <div className="glass-sm" style={{ padding: "5px 12px", fontSize: 11, color: "#52525b", fontFamily: "'IBM Plex Mono', monospace" }}>
                        + drop any file →
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Pinned Tab */}
              {tab === "pinned" && (
                <div className="glass" style={{ padding: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <span style={{ fontSize: 12, color: "#a1a1aa", fontWeight: 600, letterSpacing: "0.06em" }}>
                      PINNED FILES ({pinned.length})
                    </span>
                    {pinned.length > 0 && (
                      <span style={{ fontSize: 11, color: "#71717a", fontFamily: "'IBM Plex Mono', monospace" }}>
                        Total: {formatBytes(pinned.reduce((a, f) => a + f.file.size, 0))}
                      </span>
                    )}
                  </div>
                  {pinned.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px 0", color: "#52525b" }}>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>⬡</div>
                      <p style={{ fontSize: 13 }}>No files pinned yet</p>
                      <p style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", marginTop: 4, color: "#3f3f46" }}>
                        Switch to Upload to add files
                      </p>
                    </div>
                  ) : (
                    <div className="scroll-area">
                      {pinned.map((item) => <PinnedFileRow key={item.id} item={item} />)}
                    </div>
                  )}
                </div>
              )}

              {/* Resolve CID Tab */}
              {tab === "resolve" && (
                <div className="glass" style={{ padding: 24 }}>
                  <p style={{ fontSize: 12, color: "#71717a", marginBottom: 16, lineHeight: 1.6 }}>
                    Enter an IPFS CID (v0 or v1) to resolve its metadata from the network.
                  </p>
                  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    <input
                      type="text"
                      placeholder="QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
                      value={cidInput}
                      onChange={(e) => setCidInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && resolveCID()}
                    />
                    <button className="btn-primary" onClick={resolveCID} disabled={resolving || !cidInput.trim()} style={{ flexShrink: 0 }}>
                      {resolving ? "Resolving…" : "Resolve"}
                    </button>
                  </div>
                  {resolving && (
                    <div className="glass-sm" style={{ padding: 16, display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="stat-dot dot-pending" />
                      <span style={{ fontSize: 12, color: "#f59e0b", fontFamily: "'IBM Plex Mono', monospace" }}>
                        Querying IPFS DHT…
                      </span>
                    </div>
                  )}
                  {cidResult && (
                    <div className={`glass-sm`} style={{ padding: 16 }}>
                      {cidResult.ok ? (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                            <span className="badge badge-success"><span className="stat-dot dot-success" />RESOLVED</span>
                            <span className="mono" style={{ fontSize: 11, color: "#6366f1" }}>{cidResult.cid}</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            {[
                              ["Size", formatBytes(cidResult.size)],
                              ["Peers", cidResult.nodes + " nodes"],
                              ["Type", "UnixFS"],
                            ].map(([k, v]) => (
                              <div key={k} className="sidebar-stat">
                                <span style={{ fontSize: 10, color: "#52525b", letterSpacing: "0.06em", fontWeight: 600 }}>{k}</span>
                                <span style={{ fontSize: 13, color: "#e4e4e7", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 }}>{v}</span>
                              </div>
                            ))}
                          </div>
                          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                            <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => window.open(`${MOCK_GATEWAY}${cidResult.cid}`, "_blank")}>
                              Open in Gateway ↗
                            </button>
                            <CopyButton text={`${MOCK_GATEWAY}${cidResult.cid}`} />
                          </div>
                        </>
                      ) : (
                        <div className="validation-err">
                          ✕ &nbsp;CID not found or invalid format — check the hash and try again
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Node Status */}
              <div className="glass" style={{ padding: 20 }}>
                <p style={{ fontSize: 10, color: "#52525b", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 14 }}>NODE STATUS</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    ["IPFS", "Online", "dot-success"],
                    ["Pinata", "Connected", "dot-success"],
                    ["DHT", "Active", "dot-success"],
                    ["Gateway", "Public", "dot-success"],
                  ].map(([label, val, dot]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "#71717a", fontFamily: "'IBM Plex Mono', monospace" }}>{label}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span className={`stat-dot ${dot}`} />
                        <span style={{ fontSize: 11, color: "#a1a1aa", fontFamily: "'IBM Plex Mono', monospace" }}>{val}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Upload Stats */}
              <div className="glass" style={{ padding: 20 }}>
                <p style={{ fontSize: 10, color: "#52525b", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 14 }}>SESSION STATS</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div className="sidebar-stat">
                    <span style={{ fontSize: 10, color: "#52525b", letterSpacing: "0.06em", fontWeight: 600 }}>PINNED</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "#10b981" }}>{pinned.length}</span>
                  </div>
                  <div className="sidebar-stat">
                    <span style={{ fontSize: 10, color: "#52525b", letterSpacing: "0.06em", fontWeight: 600 }}>QUEUED</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b" }}>{pendingCount}</span>
                  </div>
                </div>
                <div className="sidebar-stat">
                  <span style={{ fontSize: 10, color: "#52525b", letterSpacing: "0.06em", fontWeight: 600 }}>TOTAL SIZE</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "#e4e4e7", fontFamily: "'IBM Plex Mono', monospace" }}>
                    {formatBytes(totalSize)}
                  </span>
                </div>
              </div>

              {/* Gateway */}
              <div className="glass" style={{ padding: 20 }}>
                <p style={{ fontSize: 10, color: "#52525b", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 14 }}>PUBLIC GATEWAY</p>
                <div className="glass-sm" style={{ padding: "8px 10px", marginBottom: 10 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#6366f1", wordBreak: "break-all", lineHeight: 1.5, display: "block" }}>
                    ipfs.io/ipfs/&lt;cid&gt;
                  </span>
                </div>
                <div className="glass-sm" style={{ padding: "8px 10px" }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#818cf8", wordBreak: "break-all", lineHeight: 1.5, display: "block" }}>
                    cloudflare-ipfs.com/ipfs/&lt;cid&gt;
                  </span>
                </div>
              </div>

              {/* Zod Validation Info */}
              <div className="glass" style={{ padding: 20 }}>
                <p style={{ fontSize: 10, color: "#52525b", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 12 }}>VALIDATION RULES</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {[
                    ["Max size", "100 MB", true],
                    ["Blocked", ".exe .bat .sh", true],
                    ["CID format", "v0 / v1", true],
                    ["Pinning", "Auto on upload", true],
                  ].map(([k, v, ok]) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 10.5, color: "#71717a" }}>{k}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span className={`stat-dot ${ok ? "dot-success" : "dot-error"}`} style={{ width: 5, height: 5 }} />
                        <span style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", color: "#a1a1aa" }}>{v}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>

          {/* Footer */}
          <div style={{ marginTop: 24, textAlign: "center", padding: "16px 0", borderTop: "1px solid rgba(63,63,70,0.3)" }}>
            <span style={{ fontSize: 10.5, color: "#3f3f46", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.04em" }}>
              LANCE MARKETPLACE · IPFS PINNING MODULE · DISTRIBUTED STORAGE LAYER
            </span>
          </div>

        </div>
      </div>
    </>
  );
}