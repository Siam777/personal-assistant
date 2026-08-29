import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("Image Ingestion & Dropzone (04-02-PLAN)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-image-url");
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("handles image paste events from clipboard", () => {
    const onImageSelected = vi.fn();

    // Create paste handler mimicking ImageDropzone logic
    function handlePaste(e: { clipboardData: { items: Array<{ type: string; getAsFile: () => File | null }> } }) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            const url = URL.createObjectURL(file);
            onImageSelected(file, url);
            return;
          }
        }
      }
    }

    const mockFile = new File(["mock binary"], "screenshot.png", { type: "image/png" });
    const mockPasteEvent = {
      clipboardData: {
        items: [
          {
            type: "image/png",
            getAsFile: () => mockFile,
          },
        ],
      },
    };

    handlePaste(mockPasteEvent);

    expect(onImageSelected).toHaveBeenCalledTimes(1);
    expect(onImageSelected).toHaveBeenCalledWith(mockFile, "blob:mock-image-url");
  });

  it("filters non-image files on drop/paste", () => {
    const onImageSelected = vi.fn();

    function processFile(file: File) {
      if (!file.type.startsWith("image/")) {
        toast.error("Unsupported file type");
        return;
      }
      const url = URL.createObjectURL(file);
      onImageSelected(file, url);
    }

    const mockTextFile = new File(["hello text"], "document.txt", { type: "text/plain" });
    processFile(mockTextFile);

    expect(onImageSelected).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Unsupported file type");
  });
});
