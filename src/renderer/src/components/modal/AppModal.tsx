import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useState, type ReactNode } from "react";

export interface AppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
  describedBy?: string;
  labelledBy?: string;
  onExitComplete?: () => void;
}

const overlayMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.24, ease: "easeOut" },
} as const;

const contentMotion = {
  initial: { opacity: 0, scale: 0.92, y: 28, filter: "blur(8px)" },
  animate: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.94, y: 18, filter: "blur(6px)" },
  transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
} as const;

function AppModalComponent({
  open,
  onOpenChange,
  children,
  className = "",
  overlayClassName = "",
  contentClassName = "",
  describedBy,
  labelledBy,
  onExitComplete,
}: AppModalProps): React.JSX.Element {
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) setPresent(true);
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {present && (
        <Dialog.Portal forceMount>
          <AnimatePresence
            onExitComplete={() => {
              setPresent(false);
              onExitComplete?.();
            }}
          >
            {open && (
              <>
                <Dialog.Overlay forceMount asChild>
                  <motion.div
                    key="overlay"
                    {...overlayMotion}
                    className={`app-modal-overlay ${overlayClassName}`.trim()}
                  />
                </Dialog.Overlay>
                <Dialog.Content
                  forceMount
                  asChild
                  aria-describedby={describedBy}
                  aria-labelledby={labelledBy}
                >
                  <motion.div
                    key="content"
                    {...contentMotion}
                    className={`app-modal-content ${className} ${contentClassName}`.trim()}
                  >
                    {children}
                  </motion.div>
                </Dialog.Content>
              </>
            )}
          </AnimatePresence>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
}

export const AppModal = memo(AppModalComponent);
export const AppModalTitle = Dialog.Title;
export const AppModalDescription = Dialog.Description;
