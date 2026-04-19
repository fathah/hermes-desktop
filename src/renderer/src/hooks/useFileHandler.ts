import {
  useState,
  useCallback,
  useRef,
  ChangeEvent,
  DragEvent,
  ClipboardEvent,
} from "react";
import type { Attachment } from "../types/attachment";

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
const MAX_PREVIEW_SIZE = 1024 * 1024; // 1MB for preview
const SUPPORTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];
const SUPPORTED_TEXT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/html",
  "text/css",
  "application/json",
  "application/xml",
  "application/javascript",
];

function isImageType(type: string): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(type) || type.startsWith("image/");
}

function isTextType(type: string): boolean {
  return SUPPORTED_TEXT_TYPES.includes(type) || type.startsWith("text/");
}

function isPdfType(type: string): boolean {
  return type === "application/pdf";
}

const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
};

const createImagePreview = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 100;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) {
            height *= maxSize / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width *= maxSize / height;
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export interface UseFileHandlerReturn {
  attachments: Attachment[];
  addAttachment: (file: File) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  handlePaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  handleDrop: (e: DragEvent<HTMLTextAreaElement>) => void;
  handleDragOver: (e: DragEvent<HTMLTextAreaElement>) => void;
  handleDragLeave: (e: DragEvent<HTMLTextAreaElement>) => void;
  handleFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  isDragging: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  openFileDialog: () => void;
}

export function useFileHandler(): UseFileHandlerReturn {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const createAttachment = useCallback(
    async (file: File): Promise<Attachment | null> => {
      const isLarge = file.size > LARGE_FILE_THRESHOLD;
      const isSupportedImage = isImageType(file.type);
      const isSupportedText = isTextType(file.type);
      const isPdf = isPdfType(file.type);

      if (!isSupportedImage && !isSupportedText && !isPdf) {
        return null;
      }

      const attachment: Attachment = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: file.name,
        type: file.type,
        size: file.size,
        isLarge,
        isSupported: isSupportedImage || isSupportedText,
      };

      if (isSupportedImage) {
        attachment.data = await readFileAsBase64(file);
        if (file.size <= MAX_PREVIEW_SIZE) {
          attachment.preview = attachment.data;
        } else {
          attachment.preview = await createImagePreview(file);
        }
      } else if (isSupportedText) {
        attachment.data = await readFileAsText(file);
        attachment.preview =
          attachment.data.substring(0, 100) +
          (attachment.data.length > 100 ? "..." : "");
      } else if (isPdf) {
        attachment.data = file.name;
        attachment.preview = `PDF: ${file.name} (non inviable come allegato - usa /read_file per file locali)`;
      }

      return attachment;
    },
    [],
  );

  const addAttachment = useCallback(
    async (file: File) => {
      const attachment = await createAttachment(file);
      if (attachment) {
        setAttachments((prev) => [...prev, attachment]);
      }
    },
    [createAttachment],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            addAttachment(file);
          }
        }
      }
    },
    [addAttachment],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer?.files;
      if (!files) return;

      for (const file of Array.from(files)) {
        addAttachment(file);
      }
    },
    [addAttachment],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      for (const file of Array.from(files)) {
        addAttachment(file);
      }
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [addAttachment],
  );

  const openFileDialog = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return {
    attachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    handlePaste,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleFileSelect,
    isDragging,
    inputRef,
    openFileDialog,
  };
}
