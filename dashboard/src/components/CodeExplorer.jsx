/**
 * CodeExplorer.jsx — Interactive Project File Explorer & Read-Only Code Viewer
 *
 * Industrial dark theme. Split-pane layout:
 * - Left: Interactive file tree / search
 * - Right: Read-only source code viewer with line numbers and copy action
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { getSandbox, readFile } from "../lib/api";

function getFileExtension(filePath) {
  const parts = filePath.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function getFileTypeBadge(ext) {
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return { label: "JS", color: "#f7df1e" };
    case "jsx":
      return { label: "JSX", color: "#61dafb" };
    case "ts":
      return { label: "TS", color: "#3178c6" };
    case "tsx":
      return { label: "TSX", color: "#007acc" };
    case "json":
      return { label: "JSON", color: "#ffb347" };
    case "html":
      return { label: "HTML", color: "#e34f26" };
    case "css":
      return { label: "CSS", color: "#4499ff" };
    case "md":
      return { label: "MD", color: "#b0b0c4" };
    case "yml":
    case "yaml":
      return { label: "YAML", color: "#ff4466" };
    case "env":
      return { label: "ENV", color: "#00ffd5" };
    default:
      return { label: ext.toUpperCase() || "FILE", color: "var(--text-2)" };
  }
}

export default function CodeExplorer({ projectId, fileRegistry = [], coderOutput = null }) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Load file list from sandbox, or fallback to fileRegistry / coderOutput
  useEffect(() => {
    let cancelled = false;

    async function loadFiles() {
      if (!projectId) {
        setLoadingList(false);
        return;
      }

      setLoadingList(true);
      setError(null);

      try {
        const sb = await getSandbox(projectId);
        if (!cancelled && sb && Array.isArray(sb.files) && sb.files.length > 0) {
          setFiles(sb.files);
          // Auto-select first meaningful source file
          const first = sb.files.find((f) => !f.endsWith(".log") && !f.endsWith(".lock")) || sb.files[0];
          setSelectedFile(first);
          return;
        }
      } catch (_) {
        // Sandbox might not have files on disk or not created yet
      }

      // Fallback: check fileRegistry
      if (!cancelled) {
        if (Array.isArray(fileRegistry) && fileRegistry.length > 0) {
          const regFiles = fileRegistry.map((r) => (typeof r === "string" ? r : r.path)).filter(Boolean);
          if (regFiles.length > 0) {
            setFiles(regFiles);
            setSelectedFile(regFiles[0]);
            setLoadingList(false);
            return;
          }
        }

        // Fallback: coderOutput
        if (coderOutput && typeof coderOutput === "object") {
          const outFiles = Object.keys(coderOutput);
          if (outFiles.length > 0) {
            setFiles(outFiles);
            setSelectedFile(outFiles[0]);
            setLoadingList(false);
            return;
          }
        }

        setFiles([]);
        setSelectedFile(null);
        setLoadingList(false);
      }
    }

    loadFiles().finally(() => {
      if (!cancelled) setLoadingList(false);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, fileRegistry, coderOutput]);

  // Load content of selected file
  useEffect(() => {
    let cancelled = false;

    async function loadContent() {
      if (!selectedFile || !projectId) {
        setFileContent(null);
        return;
      }

      setLoadingFile(true);
      setError(null);

      // Check if coderOutput has it directly
      if (coderOutput && coderOutput[selectedFile]) {
        const raw = coderOutput[selectedFile];
        setFileContent(typeof raw === "string" ? raw : JSON.stringify(raw, null, 2));
        setLoadingFile(false);
        return;
      }

      try {
        const data = await readFile(projectId, selectedFile);
        if (!cancelled) {
          setFileContent(data.content !== undefined ? data.content : "");
        }
      } catch (err) {
        if (!cancelled) {
          // If file read fails, check if registry has interface summary
          const regItem = Array.isArray(fileRegistry)
            ? fileRegistry.find((r) => (typeof r === "object" ? r.path === selectedFile : r === selectedFile))
            : null;
          if (regItem && typeof regItem === "object") {
            setFileContent(`// ${selectedFile}\n// Interface Summary from File Registry\n\n${regItem.importStatement || ""}\n\nExports:\n${JSON.stringify(regItem, null, 2)}`);
          } else {
            setError(`Unable to read file content: ${err.message}`);
            setFileContent(null);
          }
        }
      } finally {
        if (!cancelled) {
          setLoadingFile(false);
        }
      }
    }

    loadContent();

    return () => {
      cancelled = true;
    };
  }, [selectedFile, projectId, coderOutput, fileRegistry]);

  const handleCopy = useCallback(() => {
    if (!fileContent) return;
    navigator.clipboard.writeText(fileContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [fileContent]);

  const handleDownloadFile = useCallback(() => {
    if (!fileContent || !selectedFile) return;
    const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedFile.split("/").pop();
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 100);
  }, [fileContent, selectedFile]);

  // Filtered files list
  const filteredFiles = useMemo(() => {
    if (!searchFilter.trim()) return files;
    const q = searchFilter.toLowerCase();
    return files.filter((f) => f.toLowerCase().includes(q));
  }, [files, searchFilter]);

  // Group files by root directory (e.g. backend, frontend, root)
  const groupedFiles = useMemo(() => {
    const groups = {
      root: [],
      backend: [],
      frontend: [],
      other: [],
    };

    filteredFiles.forEach((file) => {
      const normalized = file.replace(/\\/g, "/");
      if (normalized.startsWith("backend/")) {
        groups.backend.push(normalized);
      } else if (normalized.startsWith("frontend/")) {
        groups.frontend.push(normalized);
      } else if (!normalized.includes("/")) {
        groups.root.push(normalized);
      } else {
        groups.other.push(normalized);
      }
    });

    return groups;
  }, [filteredFiles]);

  const lines = useMemo(() => {
    if (fileContent === null) return [];
    return fileContent.split("\n");
  }, [fileContent]);

  const fileStats = useMemo(() => {
    if (!fileContent) return null;
    const bytes = new Blob([fileContent]).size;
    const kb = (bytes / 1024).toFixed(1);
    return `${lines.length} lines  //  ${kb} KB`;
  }, [fileContent, lines]);

  return (
    <div className="code-explorer">
      {/* LEFT: FILE TREE EXPLORER */}
      <div className="code-explorer-sidebar">
        <div className="explorer-header">
          <span className="explorer-tag">FILES</span>
          <span className="explorer-count">[{filteredFiles.length}]</span>
        </div>

        <div className="explorer-search">
          <input
            type="text"
            className="explorer-search-input"
            placeholder="Filter files..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
          {searchFilter && (
            <button className="explorer-clear-btn" onClick={() => setSearchFilter("")}>
              ✕
            </button>
          )}
        </div>

        <div className="explorer-tree">
          {loadingList ? (
            <div className="explorer-loading">
              <span className="mini-spinner" /> Loading file tree...
            </div>
          ) : files.length === 0 ? (
            <div className="explorer-empty">No source files available yet. Files appear as tasks complete.</div>
          ) : (
            <>
              {/* BACKEND FILES */}
              {groupedFiles.backend.length > 0 && (
                <div className="tree-group">
                  <div className="tree-group-label">📁 backend/</div>
                  {groupedFiles.backend.map((path) => {
                    const ext = getFileExtension(path);
                    const badge = getFileTypeBadge(ext);
                    const isSelected = selectedFile === path;
                    const fileName = path.replace(/^backend\//, "");
                    return (
                      <button
                        key={path}
                        className={`tree-item ${isSelected ? "tree-item--active" : ""}`}
                        onClick={() => setSelectedFile(path)}
                        title={path}
                      >
                        <span className="file-badge" style={{ color: badge.color }}>
                          {badge.label}
                        </span>
                        <span className="file-name">{fileName}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* FRONTEND FILES */}
              {groupedFiles.frontend.length > 0 && (
                <div className="tree-group">
                  <div className="tree-group-label">📁 frontend/</div>
                  {groupedFiles.frontend.map((path) => {
                    const ext = getFileExtension(path);
                    const badge = getFileTypeBadge(ext);
                    const isSelected = selectedFile === path;
                    const fileName = path.replace(/^frontend\//, "");
                    return (
                      <button
                        key={path}
                        className={`tree-item ${isSelected ? "tree-item--active" : ""}`}
                        onClick={() => setSelectedFile(path)}
                        title={path}
                      >
                        <span className="file-badge" style={{ color: badge.color }}>
                          {badge.label}
                        </span>
                        <span className="file-name">{fileName}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ROOT CONFIG / README */}
              {groupedFiles.root.length > 0 && (
                <div className="tree-group">
                  <div className="tree-group-label">📁 project root/</div>
                  {groupedFiles.root.map((path) => {
                    const ext = getFileExtension(path);
                    const badge = getFileTypeBadge(ext);
                    const isSelected = selectedFile === path;
                    return (
                      <button
                        key={path}
                        className={`tree-item ${isSelected ? "tree-item--active" : ""}`}
                        onClick={() => setSelectedFile(path)}
                        title={path}
                      >
                        <span className="file-badge" style={{ color: badge.color }}>
                          {badge.label}
                        </span>
                        <span className="file-name">{path}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* OTHER FILES */}
              {groupedFiles.other.length > 0 && (
                <div className="tree-group">
                  <div className="tree-group-label">📁 other/</div>
                  {groupedFiles.other.map((path) => {
                    const ext = getFileExtension(path);
                    const badge = getFileTypeBadge(ext);
                    const isSelected = selectedFile === path;
                    return (
                      <button
                        key={path}
                        className={`tree-item ${isSelected ? "tree-item--active" : ""}`}
                        onClick={() => setSelectedFile(path)}
                        title={path}
                      >
                        <span className="file-badge" style={{ color: badge.color }}>
                          {badge.label}
                        </span>
                        <span className="file-name">{path}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* RIGHT: READ-ONLY CODE VIEWER */}
      <div className="code-explorer-viewer">
        {selectedFile ? (
          <>
            <div className="viewer-header">
              <div className="viewer-file-meta">
                <span className="viewer-file-path">{selectedFile}</span>
                {fileStats && <span className="viewer-stats">{fileStats}</span>}
              </div>
              <div className="viewer-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleCopy}
                  disabled={!fileContent || loadingFile}
                  title="Copy full source code to clipboard"
                >
                  {copied ? "COPIED!" : "COPY"}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleDownloadFile}
                  disabled={!fileContent || loadingFile}
                  title="Download file"
                >
                  DOWNLOAD
                </button>
              </div>
            </div>

            <div className="viewer-content">
              {loadingFile ? (
                <div className="viewer-loading">
                  <span className="mini-spinner" /> Loading {selectedFile}...
                </div>
              ) : error ? (
                <div className="viewer-error">
                  <p className="viewer-error-title">ERROR LOADING FILE</p>
                  <p className="viewer-error-msg">{error}</p>
                </div>
              ) : (
                <div className="code-display">
                  <div className="code-gutter">
                    {lines.map((_, i) => (
                      <span key={i} className="gutter-num">
                        {i + 1}
                      </span>
                    ))}
                  </div>
                  <pre className="code-text">
                    <code>{fileContent}</code>
                  </pre>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="viewer-empty">
            <div className="viewer-empty-icon">[ / ]</div>
            <p className="viewer-empty-title">Select a file to view code</p>
            <p className="viewer-empty-desc">
              Browse the file hierarchy on the left to inspect generated models, routes, React components, and configuration.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
