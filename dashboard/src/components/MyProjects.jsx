/**
 * MyProjects.jsx — Authenticated Operator Projects Dashboard
 *
 * Industrial dark UI. Monospace metadata. High-density cards.
 * Provides project discovery, search, type & status filtering, sorting,
 * pagination, ZIP download, file exploration, and safe permanent deletion.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { listProjects, getProject, deleteProject, downloadProjectZip } from "../lib/api";
import { useProjectDispatch, loadProject } from "../store/projectStore";

export default function MyProjects({ onOpenProject, onNewProject }) {
  const dispatch = useProjectDispatch();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters & Controls
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortBy, setSortBy] = useState("updated"); // "updated" | "newest" | "oldest"

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  // Actions state
  const [downloadingIds, setDownloadingIds] = useState(new Set());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProjects();
      setProjects(data.projects || []);
    } catch (err) {
      setError(err.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, typeFilter, sortBy]);

  // Filtered and sorted projects
  const filteredProjects = useMemo(() => {
    let result = projects.filter((p) => {
      // Search filter
      const matchesSearch =
        !searchQuery.trim() ||
        (p.name && p.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (p.requirement && p.requirement.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (p.id && p.id.toLowerCase().includes(searchQuery.toLowerCase()));

      // Status filter
      let matchesStatus = true;
      if (statusFilter === "running") {
        matchesStatus = p.status === "running" || p.status === "waiting_input";
      } else if (statusFilter === "completed") {
        matchesStatus = p.status === "completed" || p.status === "complete";
      } else if (statusFilter === "failed") {
        matchesStatus = p.status === "failed" || p.status === "error";
      } else if (statusFilter === "cancelled") {
        matchesStatus = p.status === "cancelled";
      }

      // Project type filter
      let matchesType = true;
      if (typeFilter !== "all") {
        matchesType = (p.projectType || "full_stack") === typeFilter;
      }

      return matchesSearch && matchesStatus && matchesType;
    });

    // Sorting
    if (sortBy === "oldest") {
      result.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    } else if (sortBy === "newest") {
      result.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else {
      // Default: recently updated
      result.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    }

    return result;
  }, [projects, searchQuery, statusFilter, typeFilter, sortBy]);

  // Pagination calculation
  const totalItems = filteredProjects.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedProjects = filteredProjects.slice(startIndex, startIndex + pageSize);

  const handleOpen = useCallback(
    async (project, options = {}) => {
      try {
        const detail = await getProject(project.id);
        dispatch(loadProject({ project, state: detail.state }));
        if (onOpenProject) {
          onOpenProject(project.id, options);
        }
      } catch (err) {
        addToast(`Failed to load project details: ${err.message}`, "error");
      }
    },
    [dispatch, onOpenProject, addToast]
  );

  const handleDownload = useCallback(
    async (project) => {
      if (downloadingIds.has(project.id)) return;

      setDownloadingIds((prev) => new Set(prev).add(project.id));
      addToast(`Packaging source archive for ${project.name || project.id}...`, "info");

      const rawName = project.name || "project";
      const slug =
        rawName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || project.id;
      const filename = `${slug}.zip`;

      try {
        await downloadProjectZip(project.id, filename);
        addToast(`ZIP downloaded: ${filename}`, "success");
      } catch (err) {
        addToast(`Failed to download ${project.name || project.id}: ${err.message}`, "error");
      } finally {
        setDownloadingIds((prev) => {
          const next = new Set(prev);
          next.delete(project.id);
          return next;
        });
      }
    },
    [downloadingIds, addToast]
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteProject(deleteTarget.id);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      addToast(`Project "${deleteTarget.name}" deleted successfully`, "success");
      setDeleteTarget(null);
    } catch (err) {
      addToast(`Delete failed: ${err.message}`, "error");
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, addToast]);

  return (
    <div className="projects-view">
      {/* TOAST ALERTS */}
      {toasts.length > 0 && (
        <div className="toast-container" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.type}`}>
              <span className="toast-dot" />
              <span className="toast-msg">{t.message}</span>
              <button className="toast-close" onClick={() => removeToast(t.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* HEADER */}
      <div className="projects-header">
        <div className="projects-header-left">
          <p className="projects-pre">MISSION CONTROL // WORKSPACES</p>
          <h1 className="projects-title">My Projects</h1>
        </div>
        <div className="projects-header-right">
          <button className="btn btn-secondary btn-sm" onClick={fetchProjects} disabled={loading}>
            {loading ? "SYNCING..." : "REFRESH"}
          </button>
          <button className="btn btn-accent btn-sm" onClick={onNewProject}>
            + NEW PROJECT
          </button>
        </div>
      </div>

      {/* TOOLBAR CONTROLS: SEARCH, FILTERS & SORT */}
      <div className="projects-toolbar">
        {/* Search */}
        <div className="projects-search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="projects-search-input"
            placeholder="Search by name, requirement, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search-btn" onClick={() => setSearchQuery("")} title="Clear search">
              ✕
            </button>
          )}
        </div>

        {/* Status Filters */}
        <div className="projects-filter-pills" role="tablist" aria-label="Filter by execution status">
          <button
            className={`filter-pill ${statusFilter === "all" ? "filter-pill--active" : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            ALL ({projects.length})
          </button>
          <button
            className={`filter-pill ${statusFilter === "running" ? "filter-pill--active" : ""}`}
            onClick={() => setStatusFilter("running")}
          >
            IN PROGRESS ({projects.filter((p) => p.status === "running" || p.status === "waiting_input").length})
          </button>
          <button
            className={`filter-pill ${statusFilter === "completed" ? "filter-pill--active" : ""}`}
            onClick={() => setStatusFilter("completed")}
          >
            COMPLETED ({projects.filter((p) => p.status === "completed" || p.status === "complete").length})
          </button>
          <button
            className={`filter-pill ${statusFilter === "failed" ? "filter-pill--active" : ""}`}
            onClick={() => setStatusFilter("failed")}
          >
            FAILED ({projects.filter((p) => p.status === "failed" || p.status === "error").length})
          </button>
          <button
            className={`filter-pill ${statusFilter === "cancelled" ? "filter-pill--active" : ""}`}
            onClick={() => setStatusFilter("cancelled")}
          >
            CANCELLED ({projects.filter((p) => p.status === "cancelled").length})
          </button>
        </div>

        {/* Secondary Bar: Project Type & Sort Options */}
        <div className="projects-subtoolbar">
          <div className="type-filter-group">
            <span className="filter-group-label">TYPE:</span>
            <button
              className={`type-pill ${typeFilter === "all" ? "type-pill--active" : ""}`}
              onClick={() => setTypeFilter("all")}
            >
              All Types
            </button>
            <button
              className={`type-pill ${typeFilter === "full_stack" ? "type-pill--active" : ""}`}
              onClick={() => setTypeFilter("full_stack")}
            >
              Full Stack
            </button>
            <button
              className={`type-pill ${typeFilter === "frontend_only" ? "type-pill--active" : ""}`}
              onClick={() => setTypeFilter("frontend_only")}
            >
              Frontend Only
            </button>
          </div>

          <div className="sort-group">
            <span className="filter-group-label">SORT:</span>
            <select
              className="projects-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label="Sort projects"
            >
              <option value="updated">Recently Updated</option>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>
        </div>
      </div>

      {/* BODY CONTENT */}
      {loading ? (
        <div className="projects-loading-grid">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="project-card project-card--skeleton">
              <div className="skeleton-line skeleton-title" />
              <div className="skeleton-line skeleton-desc" />
              <div className="skeleton-line skeleton-meta" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="projects-error-box">
          <p className="projects-error-title">FAILED TO RETRIEVE PROJECTS</p>
          <p className="projects-error-msg">{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={fetchProjects}>
            RETRY
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="projects-empty-box">
          <div className="empty-icon-bracket">[ // ]</div>
          <h2 className="empty-title">No projects created yet</h2>
          <p className="empty-desc">
            Describe a software project requirement in Mission Control, and the 27-agent team will
            architect, scaffold, code, review, and persist your application.
          </p>
          <button className="btn btn-accent" onClick={onNewProject}>
            LAUNCH FIRST PROJECT
          </button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="projects-empty-box">
          <p className="empty-title">No projects match your filter criteria</p>
          <p className="empty-desc">Try clearing your search query or resetting the filters.</p>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
              setTypeFilter("all");
              setSortBy("updated");
            }}
          >
            RESET FILTERS
          </button>
        </div>
      ) : (
        <>
          <div className="projects-grid">
            {paginatedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                isDownloading={downloadingIds.has(project.id)}
                onOpen={() => handleOpen(project)}
                onExploreFiles={() => handleOpen(project, { initialTab: "code" })}
                onDownload={() => handleDownload(project)}
                onDelete={() => setDeleteTarget(project)}
              />
            ))}
          </div>

          {/* PAGINATION BAR */}
          {totalItems > pageSize && (
            <div className="pagination-bar">
              <div className="pagination-info">
                Showing {startIndex + 1}–{Math.min(startIndex + pageSize, totalItems)} of {totalItems} projects
              </div>
              <div className="pagination-controls">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safeCurrentPage <= 1}
                >
                  ← PREV
                </button>

                <div className="pagination-pages">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      className={`page-num-btn ${safeCurrentPage === page ? "page-num-btn--active" : ""}`}
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </button>
                  ))}
                </div>

                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safeCurrentPage >= totalPages}
                >
                  NEXT →
                </button>
              </div>

              <div className="pagination-size">
                <span className="pagination-size-label">Per page:</span>
                <select
                  className="pagination-size-select"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  <option value={6}>6</option>
                  <option value={9}>9</option>
                  <option value={12}>12</option>
                  <option value={24}>24</option>
                </select>
              </div>
            </div>
          )}
        </>
      )}

      {/* CONFIRM DELETE MODAL */}
      {deleteTarget && (
        <div
          className="modal-backdrop"
          onClick={() => !isDeleting && setDeleteTarget(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isDeleting) setDeleteTarget(null);
          }}
          tabIndex={-1}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-tag">CONFIRM DESTRUCTION</p>
            <h3 className="modal-title">Delete Project?</h3>
            <p className="modal-desc">
              Are you sure you want to permanently delete <strong>{deleteTarget.name}</strong>?
            </p>
            <p className="modal-subtext">
              Project ID: <code>{deleteTarget.id}</code>
              <br />
              This will remove the project database record, stop any active run, delete the Docker sandbox,
              and purge checkpoint records. This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-text"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                CANCEL
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
              >
                {isDeleting ? "DELETING..." : "DELETE PROJECT"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, isDownloading, onOpen, onExploreFiles, onDownload, onDelete }) {
  const statusDisplay = useMemo(() => {
    switch (project.status) {
      case "running":
        return { label: "IN PROGRESS", cls: "status--running" };
      case "waiting_input":
        return { label: "AWAITING INPUT", cls: "status--waiting" };
      case "completed":
      case "complete":
        return { label: "COMPLETED", cls: "status--completed" };
      case "failed":
      case "error":
        return { label: "FAILED", cls: "status--failed" };
      case "cancelled":
        return { label: "CANCELLED", cls: "status--cancelled" };
      default:
        return { label: (project.status || "IDLE").toUpperCase(), cls: "status--idle" };
    }
  }, [project.status]);

  const typeDisplay = useMemo(() => {
    const t = project.projectType || "full_stack";
    if (t === "frontend_only") return "Frontend Only";
    if (t === "backend_only") return "Backend Only";
    return "Full Stack";
  }, [project.projectType]);

  const techBadges = useMemo(() => {
    const badges = [];
    const tc = project.technologyConstraints || {};
    if (Array.isArray(tc.frontend)) {
      tc.frontend.forEach((f) => badges.push(String(f)));
    }
    if (Array.isArray(tc.backend)) {
      tc.backend.forEach((b) => badges.push(String(b)));
    }
    if (Array.isArray(tc.database)) {
      tc.database.forEach((d) => badges.push(String(d)));
    }
    if (badges.length === 0) {
      if (project.projectType === "frontend_only") badges.push("HTML/CSS/JS");
      else badges.push("Node.js", "Express");
    }
    return Array.from(new Set(badges)).slice(0, 4);
  }, [project]);

  const formattedCreated = useMemo(() => {
    if (!project.createdAt) return "—";
    try {
      return new Date(project.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return project.createdAt;
    }
  }, [project.createdAt]);

  const formattedUpdated = useMemo(() => {
    if (!project.updatedAt) return null;
    try {
      const d = new Date(project.updatedAt);
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return null;
    }
  }, [project.updatedAt]);

  return (
    <div className={`project-card ${project.active ? "project-card--active" : ""}`}>
      <div className="card-top">
        <div className="card-top-left">
          <span className={`project-status-pill ${statusDisplay.cls}`}>
            <span className="status-indicator-dot" />
            {statusDisplay.label}
          </span>
          <span className="project-type-tag">{typeDisplay}</span>
        </div>
        <div className="card-top-right">
          <span className="card-date" title="Created date">{formattedCreated}</span>
        </div>
      </div>

      <div className="card-body">
        <h3 className="project-name" title={project.name}>
          {project.name}
        </h3>
        <p className="project-requirement" title={project.requirement}>
          {project.requirement}
        </p>

        {/* Phase / Task Info */}
        <div className="project-progress-meta">
          <div className="meta-row">
            <span className="meta-label">PHASE:</span>
            <span className="meta-value">{project.currentPhase || "pm"}</span>
          </div>
          {project.currentTask && (
            <div className="meta-row meta-row--task">
              <span className="meta-label">TASK:</span>
              <span className="meta-value" title={project.currentTask}>
                {project.currentTask}
              </span>
            </div>
          )}
        </div>

        {/* Tech Stack Badges */}
        <div className="project-badges">
          {techBadges.map((badge, idx) => (
            <span key={idx} className="tech-badge">
              {badge}
            </span>
          ))}
        </div>
      </div>

      <div className="card-footer">
        <div className="card-actions-left">
          <button className="btn btn-accent btn-sm" onClick={onOpen} title="Open in Mission Control workspace">
            OPEN
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onExploreFiles}
            title="Inspect project source code and directory hierarchy"
          >
            EXPLORE FILES
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onDownload}
            disabled={isDownloading}
            title="Download full project source code as a ZIP archive"
          >
            {isDownloading ? "PACKAGING..." : "ZIP"}
          </button>
        </div>
        <div className="card-actions-right">
          <button
            className="btn btn-ghost-danger btn-sm"
            onClick={onDelete}
            title="Permanently delete project"
          >
            DELETE
          </button>
        </div>
      </div>

      {formattedUpdated && (
        <div className="card-subfooter">
          <span>Updated: {formattedUpdated}</span>
          <span className="project-id-hint" title={project.id}>{project.id}</span>
        </div>
      )}
    </div>
  );
}
