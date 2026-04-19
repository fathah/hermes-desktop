export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  preview?: string;
  data?: string;
  isLarge: boolean;
  isSupported: boolean;
}

export interface ChatFile {
  id: string;
  name: string;
  type: string;
  size: number;
  preview?: string;
}
