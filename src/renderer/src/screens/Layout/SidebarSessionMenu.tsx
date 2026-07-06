import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useI18n } from "../../components/useI18n";
import {
  Check,
  ChevronRight,
  FolderInput,
  Pencil,
  Pin,
  PinOff,
  Trash,
} from "../../assets/icons";

export interface SidebarMenuProject {
  path: string;
  name: string;
}

export interface SidebarMenuTarget {
  id: string;
  title: string;
  contextFolder: string | null;
  /** Viewport coordinates the menu should anchor to (trigger / cursor). */
  x: number;
  y: number;
}

const MENU_WIDTH = 220;
const VIEWPORT_MARGIN = 8;

// Whole-menu open/close. Fast (a context menu should feel instant, not heavy)
// and scaled from the top-left anchor — see `.sidebar-session-menu` CSS.
const menuMotion = {
  initial: { opacity: 0, scale: 0.95, y: -6, filter: "blur(4px)" },
  animate: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.97, y: -4, filter: "blur(3px)" },
  transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
} as const;

// Horizontal slide between the main page and the "Move to project" page.
// `direction` is +1 going deeper (main → projects) and -1 coming back, so the
// incoming page enters from the side the user is travelling toward.
const pageVariants = {
  enter: (dir: number) => ({ x: dir >= 0 ? 26 : -26, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? -26 : 26, opacity: 0 }),
} as const;

const pageTransition = { duration: 0.2, ease: [0.16, 1, 0.3, 1] } as const;

/**
 * ChatGPT-style context menu for a single sidebar session row. Rendered in a
 * portal at viewport coordinates so it escapes the sidebar's clipped scroll
 * container, and clamped to stay on screen. "Move to project" swaps the menu to
 * a second page (a project picker) instead of a hover flyout, which keeps
 * positioning trivial inside the portal.
 *
 * Transitions are motion-driven: the whole menu fades/scales on open and close
 * (the parent keeps it mounted until `onExitComplete` fires `onClose`), and the
 * two pages cross-slide while the bordered container animates its height via
 * `layout`.
 */
function SidebarSessionMenu({
  target,
  isPinned,
  projects,
  scrollContainer,
  onClose,
  onTogglePin,
  onRename,
  onMoveToProject,
  onPickNewFolder,
  onDelete,
}: {
  target: SidebarMenuTarget;
  isPinned: boolean;
  projects: SidebarMenuProject[];
  /**
   * The sidebar list's scroll container. Scrolling it moves the anchored row
   * away, so the floating menu dismisses — but ONLY this container. A global
   * capture listener would also catch the chat's streaming auto-scroll and
   * close the menu mid-stream (the "blink and gone" bug).
   */
  scrollContainer?: HTMLElement | null;
  onClose: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onMoveToProject: (path: string | null) => void;
  onPickNewFolder: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<"main" | "projects">("main");
  const [direction, setDirection] = useState(1);
  // `open` drives the exit animation; the parent unmounts us only after
  // AnimatePresence reports the exit finished (onExitComplete → onClose).
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  const requestClose = (): void => setOpen(false);

  const goToProjects = (): void => {
    setDirection(1);
    setPage("projects");
  };
  const goToMain = (): void => {
    setDirection(-1);
    setPage("main");
  };

  // Clamp the menu inside the viewport. Uses offset box (not getBounding
  // ClientRect) so an in-flight scale/height animation doesn't skew the
  // measurement. Re-runs on page change because the two pages differ in height.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const width = el.offsetWidth || MENU_WIDTH;
    const height = el.offsetHeight;
    let left = target.x;
    let top = target.y;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - width - VIEWPORT_MARGIN;
    }
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = window.innerHeight - height - VIEWPORT_MARGIN;
    }
    setPos({
      left: Math.max(VIEWPORT_MARGIN, left),
      top: Math.max(VIEWPORT_MARGIN, top),
    });
  }, [target.x, target.y, page]);

  // Close on outside click, Escape, scroll, or window blur.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) requestClose();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
      }
    };
    const onScroll = (): void => requestClose();
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", requestClose);
    // Only the sidebar list's own scroll dismisses the menu — scoped to the
    // container that actually moves the anchored row. A global capture
    // listener here also fired on the chat's streaming auto-scroll, which
    // dismissed the menu the instant a chunk arrived.
    scrollContainer?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", requestClose);
      scrollContainer?.removeEventListener("scroll", onScroll);
    };
  }, [scrollContainer]);

  const currentFolder = target.contextFolder?.trim() || null;

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {open && (
        <motion.div
          key="menu"
          ref={menuRef}
          className="sidebar-session-menu"
          style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          {...menuMotion}
        >
          <motion.div className="sidebar-session-menu-body" layout>
            <AnimatePresence
              mode="popLayout"
              initial={false}
              custom={direction}
            >
              <motion.div
                key={page}
                className="sidebar-session-menu-page"
                custom={direction}
                variants={pageVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={pageTransition}
              >
                {page === "main" ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="sidebar-session-menu-item"
                      onClick={() => {
                        onTogglePin();
                        requestClose();
                      }}
                    >
                      {isPinned ? <PinOff size={15} /> : <Pin size={15} />}
                      <span>
                        {isPinned
                          ? t("navigation.sessionMenu.unpin")
                          : t("navigation.sessionMenu.pin")}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="sidebar-session-menu-item"
                      onClick={() => {
                        onRename();
                        requestClose();
                      }}
                    >
                      <Pencil size={15} />
                      <span>{t("navigation.sessionMenu.rename")}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="sidebar-session-menu-item"
                      onClick={goToProjects}
                    >
                      <FolderInput size={15} />
                      <span>{t("navigation.sessionMenu.moveToProject")}</span>
                      <ChevronRight
                        size={14}
                        className="sidebar-session-menu-chevron"
                      />
                    </button>
                    <div className="sidebar-session-menu-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      className="sidebar-session-menu-item sidebar-session-menu-item--danger"
                      onClick={() => {
                        onDelete();
                        requestClose();
                      }}
                    >
                      <Trash size={15} />
                      <span>{t("navigation.sessionMenu.delete")}</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="sidebar-session-menu-back"
                      onClick={goToMain}
                    >
                      <ChevronRight
                        size={14}
                        className="sidebar-session-menu-back-icon"
                      />
                      <span>{t("navigation.sessionMenu.moveToProject")}</span>
                    </button>
                    <div className="sidebar-session-menu-divider" />
                    <div className="sidebar-session-menu-scroll">
                      {projects.length === 0 ? (
                        <div className="sidebar-session-menu-empty">
                          {t("navigation.sessionMenu.noProjects")}
                        </div>
                      ) : (
                        projects.map((project) => {
                          const active = project.path === currentFolder;
                          return (
                            <button
                              key={project.path}
                              type="button"
                              role="menuitem"
                              className="sidebar-session-menu-item"
                              title={project.path}
                              onClick={() => {
                                if (!active) onMoveToProject(project.path);
                                requestClose();
                              }}
                            >
                              <span className="sidebar-session-menu-project-name">
                                {project.name}
                              </span>
                              {active && (
                                <Check
                                  size={14}
                                  className="sidebar-session-menu-check"
                                />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="sidebar-session-menu-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      className="sidebar-session-menu-item"
                      onClick={() => {
                        onPickNewFolder();
                        requestClose();
                      }}
                    >
                      <FolderInput size={15} />
                      <span>
                        {t("navigation.sessionMenu.newProjectFolder")}
                      </span>
                    </button>
                    {currentFolder && (
                      <button
                        type="button"
                        role="menuitem"
                        className="sidebar-session-menu-item"
                        onClick={() => {
                          onMoveToProject(null);
                          requestClose();
                        }}
                      >
                        <PinOff size={15} />
                        <span>
                          {t("navigation.sessionMenu.removeFromProject")}
                        </span>
                      </button>
                    )}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default SidebarSessionMenu;
