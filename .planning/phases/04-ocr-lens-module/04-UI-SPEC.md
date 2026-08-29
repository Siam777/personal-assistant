# Phase 4 UI Specification: Lens Module

## Layout & Components

### 1. Hub Navigation
- Top navigation bar allows switching between **Vault** and **Lens (OCR)** modes.
- Accessible at all times, including when the vault is locked.

### 2. Lens Screen (`LensScreen.tsx`)
- **Empty / Ingestion State:**
  - Large dropzone card centered on the screen.
  - Dashed border with subtle hover highlight.
  - Supported formats label: "Supports PNG, JPG, WebP, GIF, BMP • Paste with Ctrl+V".
  - Two primary action buttons:
    - `Upload Image` (FileInput trigger)
    - `Open Camera` (Live viewfinder trigger)
- **Live Camera Viewfinder (`CameraCaptureModal.tsx` / inline view):**
  - Displays streaming video feed with rounded corners.
  - Transparent overlay with viewfinder targeting frame / guidelines.
  - Controls: "Capture & Scan" (large shutter button), "Switch Camera" (if multiple devices exist), "Cancel".
- **Processing State:**
  - Progress bar with percentage and stage description.
  - Spinner and "Cancel" option.
- **Results View (`LensResultView.tsx`):**
  - Responsive 2-column layout (stacks on mobile):
    - **Left column (Source View):**
      - Preview of the captured/uploaded image.
      - "Change Image" button.
    - **Right column (Extracted Text):**
      - Header: Status badges (Confidence score, Word count, Character count).
      - Editable Textarea: Auto-resizing or fixed scrollable textarea with clear focus rings.
      - Toolbar / Action row:
        - `Copy Text` (1-action CopyButton with toast confirmation)
        - `Clear`
        - `Scan Another`
