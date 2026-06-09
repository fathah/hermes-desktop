// Overlays.tsx — global, store-driven overlays (selection toolbar, pickers, and —
// in Phase 9 — command palette, templates, trash, tweaks). Keeps App a thin root.
import { useStore } from "../store";
import { SelectionToolbar } from "../editor/SelectionToolbar";
import { EmojiPicker } from "../components/pickers/EmojiPicker";
import { CoverPicker } from "../components/pickers/CoverPicker";
import { CommandPalette } from "../components/CommandPalette";
import { TaskDrawer } from "../modals/TaskDrawer";
import { TemplatesModal } from "../modals/TemplatesModal";
import { TrashModal } from "../modals/TrashModal";
import { ResearchModal } from "../modals/ResearchModal";
import { ScheduledModal } from "../modals/ScheduledModal";
import { ExternalSessionsModal } from "../modals/ExternalSessionsModal";
import { TelegramSetupWizard } from "../../../components/TelegramSetupWizard";
import { TweaksPanel } from "../tweaks/TweaksPanel";

export function Overlays() {
  const emojiPick = useStore((s) => s.emojiPick);
  const coverPick = useStore((s) => s.coverPick);
  const openTask = useStore((s) => s.openTask);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const templatesOpen = useStore((s) => s.templatesOpen);
  const trashOpen = useStore((s) => s.trashOpen);
  const researchOpen = useStore((s) => s.researchOpen);
  const scheduledOpen = useStore((s) => s.scheduledOpen);
  const externalSessionsOpen = useStore((s) => s.externalSessionsOpen);
  const telegramWizardOpen = useStore((s) => s.telegramWizardOpen);
  const setTelegramWizardOpen = useStore((s) => s.setTelegramWizardOpen);
  const setEmojiPick = useStore((s) => s.setEmojiPick);
  const setCoverPick = useStore((s) => s.setCoverPick);
  const setOpenTask = useStore((s) => s.setOpenTask);
  const setPMeta = useStore((s) => s.setPMeta);
  const addSelectionComment = useStore((s) => s.addSelectionComment);
  const askAbout = useStore((s) => s.askAbout);
  const aiAction = useStore((s) => s.aiAction);

  return (
    <>
      <SelectionToolbar
        onComment={addSelectionComment}
        onAsk={askAbout}
        onAiAction={aiAction}
      />

      {paletteOpen && <CommandPalette />}
      {templatesOpen && <TemplatesModal />}
      {trashOpen && <TrashModal />}
      {researchOpen && <ResearchModal />}
      {scheduledOpen && <ScheduledModal />}
      {externalSessionsOpen && <ExternalSessionsModal />}
      {telegramWizardOpen && (
        <TelegramSetupWizard onClose={() => setTelegramWizardOpen(false)} />
      )}
      <TweaksPanel />

      {openTask && (
        <TaskDrawer task={openTask} onClose={() => setOpenTask(null)} />
      )}

      {emojiPick && (
        <EmojiPicker
          x={emojiPick.x}
          y={emojiPick.y}
          onPick={(e) => {
            setPMeta({ icon: e });
            setEmojiPick(null);
          }}
          onRemove={() => {
            setPMeta({ icon: "📄" });
            setEmojiPick(null);
          }}
          onClose={() => setEmojiPick(null)}
        />
      )}

      {coverPick && (
        <CoverPicker
          x={coverPick.x}
          y={coverPick.y}
          onPick={(c) => {
            setPMeta({ cover: c });
            setCoverPick(null);
          }}
          onImage={() => {
            setPMeta({ cover: "image" });
            setCoverPick(null);
          }}
          onRemove={() => {
            setPMeta({ cover: null });
            setCoverPick(null);
          }}
          onClose={() => setCoverPick(null)}
        />
      )}
    </>
  );
}
